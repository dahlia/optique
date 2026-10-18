import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createCliRunner } from "@optique/testing/cli";

const exampleRoot = fileURLToPath(new URL("./", import.meta.url));
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const work = await mkdtemp(join(tmpdir(), "optique-skill-pilot-"));
console.log(`Pilot workspace: ${work}`);
const archives = join(work, "archives");
const consumer = join(work, "consumer");
await mkdir(archives);
await mkdir(consumer);
function command(executable: string, args: readonly string[], cwd: string) {
  const result = spawnSync(executable, args, {
    cwd,
    encoding: "utf8",
    timeout: 120_000,
  });
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `${executable} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  );
  return result.stdout;
}
command("pnpm", ["pack", "--pack-destination", archives], exampleRoot);
const packed = (await readdir(archives)).filter((name) =>
  name.endsWith(".tgz")
);
assert.equal(packed.length, 1);
const archive = join(archives, packed[0]);
const manifest = JSON.parse(
  command("tar", ["-xOf", archive, "package/package.json"], work),
);
for (
  const field of ["dependencies", "optionalDependencies", "peerDependencies"]
) {
  assert.deepEqual(
    Object.keys(manifest[field] ?? {}),
    [],
    `Packed ${field} must be empty.`,
  );
}
await writeFile(
  join(consumer, "package.json"),
  JSON.stringify(
    {
      private: true,
      dependencies: { "skill-notes": `file:${archive}` },
    },
    null,
    2,
  ) + "\n",
);
const store = join(work, "empty-store");
await mkdir(store);
assert.deepEqual(await readdir(store), []);
command("pnpm", [
  "install",
  "--offline",
  "--ignore-scripts",
  "--store-dir",
  store,
  "--package-import-method",
  "copy",
], consumer);
const installed = join(consumer, "node_modules/skill-notes");
assert.ok(
  (await realpath(installed)).startsWith(await realpath(consumer) + sep),
);
const bin = join(
  consumer,
  "node_modules/.bin",
  process.platform === "win32" ? "skill-notes.cmd" : "skill-notes",
);
const copiedBundle = join(work, "skill-notes");
await cp(join(installed, "skills/skill-notes"), copiedBundle, {
  recursive: true,
});
for (
  const path of [
    "SKILL.md",
    "references/commands.md",
    "references/examples.json",
  ]
) {
  assert.deepEqual(
    await readFile(join(copiedBundle, path)),
    await readFile(join(exampleRoot, "skills/skill-notes", path)),
  );
}
const examples: readonly {
  readonly id: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly redirect?: string;
  readonly output?: string;
}[] = JSON.parse(
  await readFile(join(copiedBundle, "references/examples.json"), "utf8"),
);
const results = [];
for (const example of examples) {
  const cwd = join(work, `smoke-${example.id}`);
  await mkdir(cwd);
  await writeFile(join(cwd, "notes.txt"), "alpha\nbeta\n");
  const runner = createCliRunner({
    command: [bin],
    cwd,
    env: {
      PATH: dirname(process.execPath) + delimiter + (process.env.PATH ?? ""),
      NO_COLOR: "1",
      FORCE_COLOR: undefined,
      CLICOLOR_FORCE: undefined,
      NODE_OPTIONS: undefined,
      NODE_PATH: undefined,
    },
  });
  if (example.redirect != null) {
    assert.equal(
      example.stdin,
      await readFile(join(cwd, example.redirect), "utf8"),
      "Redirected input must match the documented file.",
    );
  }
  const result = await runner.invoke({
    args: example.args,
    stdin: example.stdin,
  });
  assert.deepEqual(
    [result.stdout, result.stderr, result.exitCode, result.signal],
    [example.stdout, example.stderr, example.exitCode, null],
    example.id,
  );
  assert.equal(await readFile(join(cwd, "notes.txt"), "utf8"), "alpha\nbeta\n");
  assert.deepEqual(
    (await readdir(cwd)).sort(),
    ["notes.txt", ...(example.output ? [example.output] : [])].sort(),
  );
  if (example.output) {
    assert.equal(
      await readFile(join(cwd, example.output), "utf8"),
      example.args[1] === "-" ? example.stdin : "alpha\nbeta\n",
    );
  }
  results.push({ id: example.id, ...result });
}
const pilotCwd = join(work, "tasks");
await mkdir(pilotCwd);
await writeFile(join(pilotCwd, "notes.txt"), "alpha\nbeta\n");
const prompts = [
  "Using the copied skill bundle, report how many lines notes.txt contains. Do not change files for this task.",
  "Save the contents of notes.txt, supplied through redirected stdin, into a new saved.txt. You are authorized to create saved.txt in this task directory, but must not overwrite an existing file. Report what was written.",
];
const hash = async (path: string) =>
  createHash("sha256").update(await readFile(path)).digest("hex");
const git = (args: readonly string[]) => command("git", args, repoRoot).trim();
const receipt = {
  work,
  bin,
  resolvedBin: await realpath(bin),
  consumer,
  copiedBundle,
  pilotCwd,
  prompts,
  archive,
  archiveSha256: await hash(archive),
  cliSha256: await hash(join(installed, "dist/cli.js")),
  skillSha256: await hash(join(copiedBundle, "SKILL.md")),
  revision: git(["rev-parse", "HEAD"]),
  dirty: git(["status", "--porcelain"]) !== "",
  node: process.version,
  pnpm: command("pnpm", ["--version"], consumer).trim(),
  platform: process.platform,
  results,
};
await writeFile(
  join(work, "receipt.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);
await mkdir(join(repoRoot, "tmp/skill-pilot"), { recursive: true });
await writeFile(
  join(repoRoot, "tmp/skill-pilot/latest.json"),
  JSON.stringify(receipt, null, 2) + "\n",
);
console.log(
  `Verified ${results.length} installed examples; receipt: ${
    join(work, "receipt.json")
  }`,
);
console.log(
  `Copied bundle: ${copiedBundle}\nTask directory: ${pilotCwd}\nExecutable: ${bin}`,
);
for (const [index, prompt] of prompts.entries()) {
  console.log(`Task ${index + 1}: ${prompt}`);
}
