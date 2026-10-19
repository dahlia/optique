import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  buildInputIdentity,
  expandCommand,
  inputIdentity,
  portableArtifact,
  portableCommand,
  runChecked,
  sha256,
  summarize,
  validateDenoGraph,
  verifyPreparedMap,
} from "./contract.ts";

const testRoot = fileURLToPath(
  new URL("../../tmp/startup-tests/", import.meta.url),
);

describe("summarize", () => {
  it("should define median interpolation and nearest-rank p95", () => {
    assert.deepEqual(summarize([8, 2, 4, 6]), {
      count: 4,
      medianMs: 5,
      p95Ms: null,
    });
    assert.equal(summarize([9, 1, 5]).medianMs, 5);
    assert.equal(
      summarize(Array.from({ length: 100 }, (_, i) => i + 1)).p95Ms,
      95,
    );
  });
  it("should reject empty, negative and nonfinite samples", () => {
    for (const samples of [[], [-1], [NaN], [Infinity]]) {
      assert.throws(() => summarize(samples), /sample/i);
    }
  });
});

describe("runChecked", () => {
  const command = (script: string) => ({
    executable: "node",
    args: ["-e", script],
    cwd: process.cwd(),
    env: { PATH: process.env.PATH ?? "" },
  });
  const expected = { status: 0, stdout: "ok\n", stderr: "" };
  it("should capture and validate streams and exit status", () => {
    const result = runChecked(command("console.log('ok')"), expected);
    assert.equal(result.stdout, "ok\n");
    assert.ok(result.wallMs >= 0);
    assert.equal(result.signal, null);
    assert.equal(result.error, null);
  });
  it("should reject wrong status, missing output and one-byte drift", () => {
    for (
      const script of [
        "process.exit(7)",
        "",
        "console.log('OK')",
        "console.error('ok')",
      ]
    ) {
      assert.throws(
        () => runChecked(command(script), expected),
        /status|output/i,
      );
    }
  });
  it("should reject timeouts, signals and oversized output", () => {
    assert.throws(
      () => runChecked(command("setInterval(() => {}, 1000)"), expected, 30),
      /ETIMEDOUT/,
    );
    assert.throws(
      () =>
        runChecked(command("process.kill(process.pid, 'SIGTERM')"), expected),
      /SIGTERM/,
    );
    assert.throws(
      () =>
        runChecked(
          command("process.stdout.write('x'.repeat(2000000))"),
          expected,
        ),
      /ENOBUFS/,
    );
  });
});

describe("portableCommand", () => {
  it("should losslessly expand exact commands with explicit path tokens", () => {
    const tokens = { REPO_ROOT: "/work/repo", NODE_BIN: "/tools/node" };
    const local = {
      executable: "/tools/node",
      args: ["/work/repo/cli.mjs", "a b"],
      cwd: "/work/repo",
      env: { PATH: "/tools", NO_COLOR: "1" },
    };
    assert.deepEqual(
      expandCommand(portableCommand(local, tokens), tokens),
      local,
    );
  });
});

describe("inputIdentity", () => {
  it("should include untracked licenses and executable bits, excluding results and docs", () => {
    mkdirSync(testRoot, { recursive: true });
    const root = mkdtempSync(join(testRoot, "identity-"));
    try {
      mkdirSync(join(root, "benchmarks/startup/results"), { recursive: true });
      mkdirSync(join(root, "packages/core"), { recursive: true });
      writeFileSync(join(root, "LICENSE"), "original");
      writeFileSync(join(root, "benchmarks/startup/main.ts"), "source");
      const first = inputIdentity(root);
      writeFileSync(
        join(root, "benchmarks/startup/results/run.json"),
        "output",
      );
      writeFileSync(join(root, "benchmarks/startup/README.md"), "docs");
      assert.equal(inputIdentity(root).hash, first.hash);
      writeFileSync(join(root, "LICENSE"), "changed");
      const second = inputIdentity(root);
      assert.notEqual(second.hash, first.hash);
      writeFileSync(join(root, "packages/core/LICENSE"), "override");
      const third = inputIdentity(root);
      assert.notEqual(third.hash, second.hash);
      chmodSync(join(root, "benchmarks/startup/main.ts"), 0o755);
      assert.notEqual(inputIdentity(root).hash, third.hash);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("validateDenoGraph", () => {
  it("should allow recognized builtins beside local mapped modules", () => {
    const cwd = fileURLToPath(new URL("../../", import.meta.url));
    validateDenoGraph({
      modules: [{
        specifier: new URL(`file://${cwd}/deno.json`).href,
        kind: "esm",
      }, { specifier: "node:process", kind: "node" }],
    }, [cwd]);
  });
  it("should reject remote, npm, graph errors and escaping files", () => {
    for (
      const specifier of [
        "https://example.com/x.js",
        "npm:evil",
        "file:///outside.js",
        "node:invented",
      ]
    ) {
      assert.throws(() =>
        validateDenoGraph({ modules: [{ specifier, kind: "esm" }] }, [
          process.cwd(),
        ])
      );
    }
    assert.throws(() =>
      validateDenoGraph({
        modules: [{ specifier: "node:process", error: "bad" }],
      }, [process.cwd()])
    );
  });
});

describe("buildInputIdentity", () => {
  it("should invalidate prepared archives after root lock/catalog drift", () => {
    mkdirSync(testRoot, { recursive: true });
    const root = mkdtempSync(join(testRoot, "build-inputs-"));
    try {
      writeFileSync(join(root, "pnpm-lock.yaml"), "first");
      writeFileSync(join(root, "pnpm-workspace.yaml"), "catalog: first");
      const initial = buildInputIdentity(root).hash;
      writeFileSync(join(root, "pnpm-lock.yaml"), "second");
      const changedLock = buildInputIdentity(root).hash;
      assert.notEqual(changedLock, initial);
      writeFileSync(join(root, "pnpm-workspace.yaml"), "catalog: second");
      assert.notEqual(buildInputIdentity(root).hash, changedLock);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("verifyPreparedMap", () => {
  it("should reject output-preserving Deno entry remapping after preparation", () => {
    mkdirSync(testRoot, { recursive: true });
    const root = mkdtempSync(join(testRoot, "deno-map-"));
    try {
      const path = join(root, "import-map.json");
      const original = JSON.stringify({
        imports: { "@optique/run": "src/index.ts" },
      });
      writeFileSync(path, original);
      verifyPreparedMap(path, sha256(original));
      writeFileSync(
        path,
        JSON.stringify({ imports: { "@optique/run": "src/run.ts" } }),
      );
      assert.throws(
        () => verifyPreparedMap(path, sha256(original)),
        /import map/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("portableArtifact", () => {
  it("should tokenize external consumer paths recursively", () => {
    assert.deepEqual(
      portableArtifact(
        { files: ["/var/tmp/owned-consumers/core-run/package.json"] },
        "/var/tmp/owned-consumers",
        "${CONSUMERS_ROOT}",
      ),
      { files: ["${CONSUMERS_ROOT}/core-run/package.json"] },
    );
  });
  it("should sanitize nested validation URLs and preserve portable/system paths", () => {
    const root = "/tmp/contributor/checkouts/project/";
    assert.deepEqual(
      portableArtifact({
        graph: [{
          specifier:
            "file:///tmp/contributor/checkouts/project/packages/core/src/index.ts",
        }],
        path: "/tmp/contributor/checkouts/project/tmp/consumer",
        command: "/usr/bin/git",
        token: "${REPO_ROOT}/fixture.js",
        state: null,
      }, root),
      {
        graph: [{
          specifier: "file://${REPO_ROOT}/packages/core/src/index.ts",
        }],
        path: "${REPO_ROOT}/tmp/consumer",
        command: "/usr/bin/git",
        token: "${REPO_ROOT}/fixture.js",
        state: null,
      },
    );
    assert.equal(
      portableArtifact(
        "C:\\Users\\reader\\repo\\file.js",
        "C:\\Users\\reader\\repo\\",
      ),
      "${REPO_ROOT}\\file.js",
    );
    assert.throws(() => portableArtifact({}, "/"), /root/i);
    assert.throws(() => portableArtifact({}, "C:\\"), /root/i);
  });
});
