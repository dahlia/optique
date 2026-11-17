import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { ownedFiles } from "./files.mjs";

test("lint and format ownership preserve member, docs and fixture exclusions", () => {
  mkdirSync("tmp", { recursive: true });
  const root = mkdtempSync(resolve("tmp/ownership-"));
  const files = {
    "deno.json": JSON.stringify({
      workspace: ["packages/*"],
      exclude: ["docs", "scripts/types/", "scripts/tooling/"],
      fmt: { exclude: ["**/*.md", "**/*.yaml", "packages/a/fixture/*.json"] },
    }),
    "packages/a/deno.json": '{"exclude":["tsdown.config.ts"]}',
    "packages/a/src/index.ts": "",
    "packages/a/tsdown.config.ts": "",
    "packages/a/fixture/data.json": "{}",
    "packages/a/fixture/code.ts": "",
    "packages/a/dist/out.js": "",
    "coverage/raw/report.json": "{}",
    "packages/a/coverage/report.ts": "",
    "packages/a/src/coverage/value.ts": "",
    "docs/test.ts": "",
    "README.md": "",
    "mise.toml": "",
    "root.yaml": "",
    "root.jsonc": "{}",
    "node_modules/dependency/index.ts": "",
    "scripts/types/temporal.d.ts": "",
    "scripts/tooling/check.mjs": "",
  };
  try {
    for (const [name, text] of Object.entries(files)) {
      mkdirSync(join(root, name, ".."), { recursive: true });
      writeFileSync(join(root, name), text);
    }
    assert.deepEqual(ownedFiles(root, "lint"), [
      "packages/a/fixture/code.ts",
      "packages/a/src/coverage/value.ts",
      "packages/a/src/index.ts",
      "scripts/tooling/check.mjs",
      "scripts/types/temporal.d.ts",
    ]);
    assert.deepEqual(ownedFiles(root, "format"), [
      "deno.json",
      "packages/a/deno.json",
      "packages/a/fixture/code.ts",
      "packages/a/src/coverage/value.ts",
      "packages/a/src/index.ts",
      "root.jsonc",
      "scripts/tooling/check.mjs",
      "scripts/types/temporal.d.ts",
    ]);
    assert.throws(() => ownedFiles(root, "everything"), /Unknown/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("formatter helper writes only its inventory and checks idempotently", () => {
  mkdirSync("tmp", { recursive: true });
  const root = mkdtempSync(resolve("tmp/formatter-"));
  const script = fileURLToPath(new URL("./format.mjs", import.meta.url));
  const files = {
    "deno.json":
      '{"workspace":[],"exclude":["docs"],"fmt":{"exclude":["**/*.md","**/*.yaml"]}}\n',
    "code.ts": "export const value={a:1,b:2};\n",
    "docs/code.ts": "export const value={a:1,b:2};\n",
    "note.md": "# title\nsome text",
    "data.yaml": "a:  [1,  2]",
    "mise.toml": "[x]\na=1",
    ".oxfmtrc.json": readFileSync(".oxfmtrc.json", "utf8"),
  };
  try {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(root, file, ".."), { recursive: true });
      writeFileSync(join(root, file), text);
    }
    const run = (mode) =>
      spawnSync("node", [script, mode], {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
      });
    assert.notEqual(run("--check").status, 0);
    const written = run("--write");
    assert.equal(written.status, 0, written.stdout + written.stderr);
    const checked = run("--check");
    assert.equal(checked.status, 0, checked.stdout + checked.stderr);
    assert.notEqual(
      readFileSync(join(root, "code.ts"), "utf8"),
      files["code.ts"],
    );
    for (const file of ["docs/code.ts", "note.md", "data.yaml", "mise.toml"]) {
      assert.equal(readFileSync(join(root, file), "utf8"), files[file]);
    }
    assert.notEqual(run("--write-unrestricted").status, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
