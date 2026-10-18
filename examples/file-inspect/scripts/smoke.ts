import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createCliRunner } from "@optique/testing/cli";
import manifest from "../package.json" with { type: "json" };

assert.equal(
  process.platform,
  "linux",
  "Packaging smoke is verified only on Linux x64.",
);
assert.equal(
  process.arch,
  "x64",
  "Packaging smoke is verified only on Linux x64.",
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(root, "../..");
const dist = join(root, "dist");
const temporary = await mkdtemp(join(tmpdir(), "file-inspect-package-"));
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const env = {
  FORCE_COLOR: undefined,
  CLICOLOR_FORCE: undefined,
  NO_COLOR: undefined,
  NODE_DISABLE_COLORS: undefined,
  NODE_OPTIONS: undefined,
  NODE_PATH: undefined,
  BASH_ENV: undefined,
  ENV: undefined,
  COLUMNS: "80",
  TERM: "dumb",
};
const registry = "http://127.0.0.1:9";
try {
  assert.ok(!temporary.startsWith(`${repo}/`));
  const stage = join(temporary, "stage");
  const consumer = join(temporary, "consumer");
  await mkdir(stage);
  await mkdir(consumer);
  for (const name of ["cli.js", "package.json"]) {
    await copyFile(join(dist, "package", name), join(stage, name));
  }
  const tarball = join(dist, "file-inspect.tgz");
  execFileSync("pnpm", ["pack", "--out", tarball], {
    cwd: stage,
    stdio: "pipe",
  });
  const contents = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" })
    .trim().split("\n").sort();
  assert.deepEqual(contents, ["package/cli.js", "package/package.json"]);
  const packed: {
    readonly private: boolean;
    readonly type: string;
    readonly bin: Readonly<Record<string, string>>;
    readonly dependencies?: unknown;
    readonly optionalDependencies?: unknown;
    readonly peerDependencies?: unknown;
  } = JSON.parse(
    execFileSync("tar", ["-xOzf", tarball, "package/package.json"], {
      encoding: "utf8",
    }),
  );
  assert.ok(packed.private);
  assert.equal(packed.type, "module");
  assert.deepEqual(packed.bin, { "file-inspect": "./cli.js" });
  assert.equal(packed.dependencies, undefined);
  assert.equal(packed.optionalDependencies, undefined);
  assert.equal(packed.peerDependencies, undefined);
  assert.ok(!JSON.stringify(packed).includes("workspace:"));
  await writeFile(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      dependencies: { "file-inspect": `file:${tarball}` },
    }),
  );
  const installCommand = [
    "install",
    "--offline",
    "--ignore-scripts",
    "--store-dir",
    join(temporary, "empty-store"),
    "--package-import-method=copy",
    `--registry=${registry}`,
  ];
  execFileSync("pnpm", installCommand, {
    cwd: consumer,
    env: { ...process.env, ...env, npm_config_registry: registry },
    stdio: "pipe",
  });
  const installed = await realpath(join(consumer, "node_modules/file-inspect"));
  assert.ok(installed.startsWith(`${consumer}/`));
  assert.ok(!installed.startsWith(`${repo}/`));
  const bundle = await readFile(join(dist, "package/cli.js"));
  const installedBundle = await readFile(join(installed, "cli.js"));
  assert.equal(hash(installedBundle), hash(bundle));
  assert.ok((await stat(join(installed, "cli.js"))).mode & 0o111);
  const buildEvidence: { readonly bundleSha256: string } = JSON.parse(
    await readFile(join(dist, "build-evidence.json"), "utf8"),
  );
  assert.equal(hash(bundle), buildEvidence.bundleSha256);
  const dependencyGraph = JSON.parse(
    execFileSync("pnpm", ["list", "--prod", "--depth=Infinity", "--json"], {
      cwd: consumer,
      encoding: "utf8",
    }),
  );
  assert.deepEqual(Object.keys(dependencyGraph[0].dependencies), [
    "file-inspect",
  ]);
  assert.equal(
    dependencyGraph[0].dependencies["file-inspect"].dependencies,
    undefined,
  );
  await writeFile(join(consumer, "sample.txt"), "one\ntwo\n");
  // A compiled executable must not load consumer dotenv/bunfig files.
  await writeFile(join(consumer, ".env"), "FORCE_COLOR=1\n");
  await writeFile(join(consumer, "bunfig.toml"), "invalid TOML !!!\n");
  const binary = join(temporary, "file-inspect");
  await copyFile(join(dist, "file-inspect"), binary);
  const standalone: {
    readonly inputSha256: string;
    readonly outputSha256: string;
  } = JSON.parse(
    await readFile(join(dist, "standalone-evidence.json"), "utf8"),
  );
  assert.equal(standalone.inputSha256, hash(bundle));
  assert.equal(standalone.outputSha256, hash(await readFile(binary)));
  const bin = join(consumer, "node_modules/.bin/file-inspect");
  const checks: string[] = [];
  for (
    const [kind, command, extraEnv] of [
      ["npm", bin, {}],
      ["standalone", binary, { PATH: "" }],
    ] as const
  ) {
    const cli = createCliRunner({
      command: [command],
      cwd: consumer,
      env: { ...env, ...extraEnv },
    });
    for (
      const [args, stdin, expected, exitCode] of [
        [["--version"], undefined, `${manifest.version}\n`, 0],
        [
          ["file", "info", "sample.txt"],
          undefined,
          '{"path":"sample.txt","bytes":8}\n',
          0,
        ],
        [["file", "lines", "sample.txt"], undefined, "2\n", 0],
        [["file", "lines", "-"], "one\ntwo", "2\n", 0],
        [["--help"], undefined, "Usage: file-inspect", 0],
        [["file", "lines", "sample.txt", "extra"], undefined, "Error:", 1],
        [["file", "info", "missing.txt"], undefined, "file-inspect:", 1],
      ] as const
    ) {
      const result = await cli.invoke({ args, stdin });
      assert.equal(result.exitCode, exitCode, JSON.stringify(result));
      assert.ok(!(result.stdout + result.stderr).includes("\x1b["));
      if (exitCode === 0) {
        assert.equal(result.stderr, "");
        if (args[0] === "--help") assert.ok(result.stdout.includes(expected));
        else assert.equal(result.stdout, expected);
      } else {
        assert.equal(result.stdout, "");
        assert.ok(result.stderr.includes(expected));
      }
      checks.push(`${kind}: ${args.join(" ")}`);
    }
  }
  const cli = createCliRunner({ command: [bin], cwd: consumer, env });
  const completion = await cli.invoke("completion", "bash");
  assert.equal(completion.exitCode, 0);
  const script = join(temporary, "completion.bash");
  await writeFile(script, completion.stdout);
  const home = join(temporary, "home");
  await mkdir(home);
  const bash = createCliRunner({
    command: [
      "bash",
      "--norc",
      "--noprofile",
      "-c",
      `
source "$1"
registration=$(complete -p file-inspect)
function_name=\${registration#* -F }
function_name=\${function_name%% *}
COMP_WORDS=(file-inspect file '')
COMP_CWORD=2
"$function_name"
printf '%s\\n' "\${COMPREPLY[@]}"
`,
      "bash",
      script,
    ],
    cwd: consumer,
    env: {
      ...env,
      HOME: home,
      PATH: `${join(consumer, "node_modules/.bin")}:${process.env.PATH ?? ""}`,
    },
  });
  const suggestions = await bash.invoke();
  assert.equal(suggestions.exitCode, 0, suggestions.stderr);
  assert.ok(suggestions.stdout.split("\n").includes("info"));
  assert.ok(suggestions.stdout.split("\n").includes("lines"));
  checks.push("isolated Bash: file -> info, lines");
  assert.equal(
    await readFile(join(consumer, "sample.txt"), "utf8"),
    "one\ntwo\n",
  );
  const evidence = {
    host: { platform: process.platform, arch: process.arch },
    versions: {
      node: process.version,
      bun: execFileSync("bun", ["--version"], { encoding: "utf8" }).trim(),
      pnpm: execFileSync("pnpm", ["--version"], { encoding: "utf8" }).trim(),
      bash: execFileSync("bash", ["--version"], { encoding: "utf8" }).split(
        "\n",
      )[0],
    },
    tarball: {
      sha256: hash(await readFile(tarball)),
      contents,
      manifest: packed,
    },
    bundleSha256: hash(bundle),
    standalone,
    offlineInstall: {
      command: ["pnpm", ...installCommand],
      registry,
      dependencyGraph,
      installed,
    },
    outsideCheckout: true,
    checks,
  };
  const serialized = JSON.stringify(evidence, null, 2) + "\n";
  assert.ok(Buffer.byteLength(serialized) < 256 * 1024);
  await writeFile(join(dist, "evidence.json"), serialized);
  console.log(
    `Verified ${checks.length} packaging checks; evidence: ${
      join(dist, "evidence.json")
    }`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
