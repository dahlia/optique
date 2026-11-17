import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

function lint(source) {
  mkdirSync("tmp", { recursive: true });
  const directory = mkdtempSync(resolve("tmp/lint-rules-"));
  const file = resolve(directory, "fixture.ts");
  writeFileSync(file, source);
  try {
    const result = spawnSync(
      "node",
      [
        fileURLToPath(
          new URL("bin/oxlint", import.meta.resolve("oxlint/package.json")),
        ),
        "--config",
        resolve(".oxlintrc.json"),
        "--no-ignore",
        "--deny-warnings",
        "--report-unused-disable-directives-severity=error",
        file,
      ],
      {
        encoding: "utf8",
        timeout: 30_000,
      },
    );
    if (result.error) throw result.error;
    return { status: result.status, output: result.stdout + result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

test("72 mapped counterparts retain all 87 compatibility rules", () => {
  const mappings = JSON.parse(
    readFileSync(new URL("./lint-mapping.json", import.meta.url), "utf8"),
  );
  const config = JSON.parse(readFileSync(".oxlintrc.json", "utf8"));
  assert.equal(mappings.length, 87);
  assert.equal(mappings.filter((mapping) => mapping.oxlint).length, 72);
  for (const { oxlint } of mappings) {
    if (oxlint) assert.ok(config.rules[oxlint]);
  }
});

test("real linter enforces key rules and unused directives", () => {
  for (const [source, rule] of [
    ["export async function f() { return 1; }", "require-await"],
    ["export const value: any = 1;", "no-explicit-any"],
    ["const unused = 1;", "no-unused-vars"],
    ["export const re = /\\x00/;", "no-control-regex"],
    [
      "/* oxlint-disable-next-line no-debugger */\nexport const value = 1;",
      "Unused",
    ],
  ]) {
    const result = lint(source);
    assert.notEqual(result.status, 0, result.output);
    assert.match(result.output.toLowerCase(), new RegExp(rule.toLowerCase()));
  }
});

test("underscore names, paired Deno directives and existing fallthrough comments pass", () => {
  const result = lint(`
    export function f(_arg: string) { const _unused = 1; return 1; }
    /* oxlint-disable require-await -- Intentional async contract. */
    // deno-lint-ignore require-await
    export async function g() { return 1; }
    /* oxlint-enable require-await */
    export function readiness(x: number) {
      switch(x) {
        case 0: x++;
        // Falls through to the ordinary readiness handshake.
        default: return x;
      }
    }
  `);
  assert.equal(result.status, 0, result.output);
});
