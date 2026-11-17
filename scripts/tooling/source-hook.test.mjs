import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

test("registered hook preserves source ownership, ESM identity and isolated CJS fallback", () => {
  mkdirSync("tmp", { recursive: true });
  const temporary = mkdtempSync(resolve("tmp/source-hook-"));
  const modules = resolve(temporary, "node_modules/@optique");
  mkdirSync(modules, { recursive: true });
  symlinkSync(
    resolve("packages/core"),
    resolve(modules, "core"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const entry = resolve(temporary, "consumer.mjs");
  writeFileSync(entry, "");
  const root = process.cwd();
  const result = spawnSync("node", [
    "--experimental-import-meta-resolve",
    "--import",
    "./scripts/tooling/source-hook.mjs",
    "--input-type=module",
    "--eval",
    `
      import assert from "node:assert/strict";
      import { createRequire } from "node:module";
      import { Temporal } from "@js-temporal/polyfill";
      assert.equal(globalThis.Temporal, Temporal);
      assert.ok(Temporal.Instant.from("2020-01-01T00:00Z") instanceof Temporal.Instant);
      const parent = ${
      JSON.stringify(
        pathToFileURL(resolve(root, "packages/core/src/index.test.ts")).href,
      )
    };
      const expected = ${
      JSON.stringify(
        pathToFileURL(resolve(root, "packages/core/src/parser.ts")).href,
      )
    };
      for (const name of ["@optique/core/parser", "#src/parser.ts"]) {
        const load = (suffix) => {
          const url = import.meta.resolve(name + suffix, parent);
          assert.equal(url, expected + suffix);
          return import(url);
        };
        const first = await load("?v=1#one");
        assert.equal(first, await load("?v=1#one"));
        assert.notEqual(first, await load("?v=2#one"));
        assert.notEqual(first, await load("?v=1#two"));
        assert.equal(typeof first.parseSync, "function");
      }
      const owned = createRequire(parent);
      assert.equal(owned.resolve("#src/parser.ts"), ${
      JSON.stringify(resolve(root, "packages/core/src/parser.ts"))
    });
      const isolated = createRequire(${
      JSON.stringify(pathToFileURL(entry).href)
    });
      assert.equal(isolated.resolve("@optique/core/parser"), ${
      JSON.stringify(resolve(root, "packages/core/dist/parser.cjs"))
    });
    `,
  ], { encoding: "utf8", timeout: 30_000 });
  try {
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
