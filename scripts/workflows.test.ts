import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const main = readFileSync(
  new URL(".github/workflows/main.yaml", root),
  "utf8",
).replaceAll("\r\n", "\n");

function job(name: string): string {
  const match = main.match(
    new RegExp(`^  ${name}:\\n([\\s\\S]*?)(?=^  [\\w-]+:|$(?![\\s\\S]))`, "m"),
  );
  assert.ok(match, `Missing ${name} job.`);
  return match[1];
}

function needs(name: string): readonly string[] {
  const match = job(name).match(/^ {4}needs: \[(.*)\]$/m);
  assert.ok(match, `Missing ${name} dependencies.`);
  return match[1]
    .split(",")
    .map((value) => value.trim())
    .sort();
}

test("npm and JSR publish independently after the complete validation graph", () => {
  const gates = [
    "check",
    "test-node",
    "test-deno",
    "test-bun",
    "test-cli-windows",
    "bootstrap-node",
  ].sort();
  assert.deepEqual(needs("publish-npm"), gates);
  assert.deepEqual(needs("publish-jsr"), gates);
  const npmVersionStep = job("publish-npm").match(
    / {4}- run: \|\n([\s\S]*?)(?= {4}- run:)/,
  );
  const jsrVersionStep = job("publish-jsr").match(
    / {4}- run: \|\n([\s\S]*?)(?= {4}- run:)/,
  );
  assert.ok(npmVersionStep);
  assert.ok(jsrVersionStep);
  assert.equal(npmVersionStep[1], jsrVersionStep[1]);
  for (const name of ["publish-npm", "publish-jsr"]) {
    const text = job(name);
    assert.match(text, /if: github.event_name == 'push'/);
    assert.match(text, /id-token: write/);
    assert.match(text, /mise run check:versions --fix/);
    assert.match(text, /GITHUB_RUN_NUMBER/);
    assert.match(text, /GITHUB_SHA::8/);
    assert.match(text, /GITHUB_REF_NAME/);
  }
  assert.doesNotMatch(job("publish-npm"), /deno publish|mise exec deno/);
  assert.match(job("publish-npm"), /NPM_CONFIG_PROVENANCE: "true"/);
  assert.match(job("publish-npm"), /--tag dev/);
  assert.match(job("publish-jsr"), /seq 1 30/);
  assert.match(
    job("publish-jsr"),
    /timeout 60 mise exec deno@2\.9 -- deno publish --allow-dirty/,
  );
  assert.match(job("publish-jsr"), /sleep 10/);
  assert.deepEqual(needs("public-docs"), ["publish-npm"]);
});

test("Node owns real coverage and test reports; Deno keeps compatibility gates", () => {
  assert.match(job("test-node"), /mise run test:node/);
  assert.match(job("test-node"), /mise run coverage/);
  assert.match(job("test-node"), /files: coverage\/junit\/\*\.xml/);
  assert.match(job("test-node"), /files: coverage\/lcov\.info/);
  assert.match(job("test-deno"), /mise run check:deno/);
  assert.match(job("test-deno"), /mise run check:publish/);
  assert.match(job("test-deno"), /mise run test:deno/);
  assert.doesNotMatch(job("test-deno"), /codecov|--coverage|junit/);
  assert.match(job("test-cli-windows"), /runtime: \[deno, node, bun\]/);
  assert.match(
    job("test-cli-windows"),
    /install_args: node deno@2\.9 bun github:pnpm\/pnpm/,
  );
  assert.match(job("test-cli-windows"), /MISE_AUTO_INSTALL: "0"/);
  assert.match(job("test-cli-windows"), /MISE_TASK_RUN_AUTO_INSTALL: "false"/);
});

test("fresh Linux and Windows bootstrap exercises routine tasks under an audited sentinel", () => {
  const text = job("bootstrap-node");
  assert.match(text, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(text, /cache: false/);
  assert.match(text, /install: false/);
  assert.match(text, /MISE_AUTO_INSTALL: "0"/);
  assert.match(text, /MISE_TASK_RUN_AUTO_INSTALL: "false"/);
  assert.match(text, /DENO_DIR=.*RUNNER_TEMP/);
  assert.match(text, /deno\.exe/);
  assert.match(text, /csc\.exe/);
  assert.match(text, /File\.AppendAllText/);
  assert.match(text, /DENO_SENTINEL_LOG/);
  assert.match(text, /if: \$\{\{ always\(\) \}\}/);
  assert.match(text, /Test-Path \$env:DENO_SENTINEL_LOG/);
  for (const command of [
    "mise install",
    "mise deps",
    "mise run fmt",
    "mise run check",
    "mise run check:versions --fix",
    "mise run dev",
    "mise run docs:build",
    "mise run coverage",
  ]) {
    assert.ok(text.includes(command), `Missing bootstrap command: ${command}`);
  }
  assert.doesNotMatch(text, /mise run test(?:\s|$)/m);
});

test("auxiliary compatibility workflows explicitly install Deno 2.9", () => {
  for (const file of ["file-inspect.yaml", "startup-baseline.yaml"]) {
    const text = readFileSync(
      new URL(`.github/workflows/${file}`, root),
      "utf8",
    );
    assert.match(text, /mise install deno@2\.9/);
    assert.match(text, /MISE_AUTO_INSTALL: "0"/);
    assert.match(text, /MISE_TASK_RUN_AUTO_INSTALL: "false"/);
  }
});

test("editor defaults use Oxfmt without import sorting or Deno activation", () => {
  const vscode = JSON.parse(
    readFileSync(new URL(".vscode/settings.json", root), "utf8"),
  );
  assert.ok(!vscode["deno.enable"]);
  for (const language of [
    "javascript",
    "javascriptreact",
    "typescript",
    "typescriptreact",
    "json",
    "jsonc",
  ]) {
    assert.equal(
      vscode[`[${language}]`]["editor.defaultFormatter"],
      "oxc.oxc-vscode",
    );
  }
  const zed = readFileSync(new URL(".zed/settings.json", root), "utf8");
  assert.doesNotMatch(zed, /"deno"\s*:/);
  assert.match(zed, /--stdin-filepath/);
  assert.doesNotMatch(JSON.stringify(vscode), /source.sortImports/);
});

const hasPowerShell =
  spawnSync("pwsh", ["-NoProfile", "-Command", "exit 0"], {
    timeout: 10_000,
  }).status === 0;

test("workflow checks accept a CRLF checkout", () => {
  const tmp = fileURLToPath(new URL("tmp/", root));
  mkdirSync(tmp, { recursive: true });
  const directory = mkdtempSync(join(tmp, "workflow-crlf-"));
  try {
    mkdirSync(join(directory, "scripts"));
    mkdirSync(join(directory, ".github/workflows"), { recursive: true });
    writeFileSync(join(directory, "package.json"), '{"type":"module"}');
    writeFileSync(
      join(directory, ".github/workflows/main.yaml"),
      main.replaceAll(/\r?\n/g, "\r\n"),
    );
    const script = join(directory, "scripts/workflows.test.ts");
    writeFileSync(script, readFileSync(new URL(import.meta.url)));
    const result = spawnSync(
      "node",
      [
        "--test",
        "--test-reporter=spec",
        "--test-name-pattern=npm and JSR|the actual workflow sentinel",
        script,
      ],
      {
        cwd: directory,
        env: Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => key !== "NODE_TEST_CONTEXT",
          ),
        ),
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /npm and JSR publish independently/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  "the actual workflow sentinel records direct launches and rejects ignored failures",
  {
    skip: !hasPowerShell,
  },
  () => {
    // Bun also needs the early return for conditional skips.
    if (!hasPowerShell) return;
    const tmp = fileURLToPath(new URL("tmp/", root));
    mkdirSync(tmp, { recursive: true });
    const directory = mkdtempSync(join(tmp, "workflow-sentinel-"));
    try {
      const text = job("bootstrap-node");
      const setup = text
        .split("    - name: Install and prove the failing Deno sentinel\n")[1]
        .split("      run: |\n")[1]
        .split("    - name:")[0]
        .replace(/^ {8}/gm, "");
      const audit = text
        .split(
          "    - name: Reject every attempted Deno launch, even an ignored failure\n",
        )[1]
        .split("      run: |\n")[1]
        .replace(/^ {8}/gm, "");
      const setupPath = join(directory, "setup.ps1");
      const auditPath = join(directory, "audit.ps1");
      writeFileSync(setupPath, setup);
      writeFileSync(auditPath, audit);
      const marker = join(directory, "attempts.log");
      const env = {
        ...process.env,
        RUNNER_TEMP: directory,
        DENO_DIR: join(directory, "deno-empty"),
        DENO_SENTINEL_LOG: marker,
        GITHUB_PATH: join(directory, "github-path"),
      };
      const setupResult = spawnSync(
        "pwsh",
        ["-NoProfile", "-File", setupPath],
        {
          env,
          encoding: "utf8",
          timeout: 30_000,
        },
      );
      assert.equal(setupResult.status, 0, setupResult.stderr);
      assert.ok(!existsSync(marker), "The self-test must clear its marker.");
      const cleanAudit = spawnSync("pwsh", ["-NoProfile", "-File", auditPath], {
        env,
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(cleanAudit.status, 0, cleanAudit.stderr);
      const path = `${join(directory, "deno-sentinel")}${delimiter}${process.env.PATH ?? ""}`;
      const launchEnv = Object.fromEntries(
        Object.entries(env).filter(([key]) => key.toLowerCase() !== "path"),
      );
      const ignoredFailure = spawnSync(
        "node",
        [
          "--input-type=module",
          "-e",
          `
      import { spawnSync } from "node:child_process";
      spawnSync("deno", ["--version"]);
      // Deliberately ignore the failed launch and report success.
    `,
        ],
        {
          env: { ...launchEnv, PATH: path },
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      assert.equal(ignoredFailure.status, 0, ignoredFailure.stderr);
      assert.match(readFileSync(marker, "utf8"), /--version/);
      const failedAudit = spawnSync(
        "pwsh",
        ["-NoProfile", "-File", auditPath],
        {
          env,
          encoding: "utf8",
          timeout: 10_000,
        },
      );
      assert.notEqual(failedAudit.status, 0);
      assert.match(
        failedAudit.stderr,
        /Node-only bootstrap attempted to launch Deno/,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
