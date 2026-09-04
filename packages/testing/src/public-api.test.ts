import type { CapturedOutput } from "@optique/testing";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

/**
 * The subpaths this package reserves, as they appear in `deno.json` and in
 * `package.json`.  Every other assertion in this file is derived from it.
 */
const SUBPATHS = [".", "./cli", "./discover", "./parser", "./run"] as const;

/**
 * The `dist/` basename backing each subpath.
 */
const DIST_BASENAMES: Record<string, string> = {
  ".": "index",
  "./cli": "cli",
  "./discover": "discover",
  "./parser": "parser",
  "./run": "run",
};

const isDeno = "Deno" in globalThis;

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(
    readFileSync(new URL(relativePath, import.meta.url), "utf8"),
  ) as Record<string, unknown>;
}

function readTsdownEntries(): string[] {
  const config = readFileSync(
    new URL("../tsdown.config.ts", import.meta.url),
    "utf8",
  );
  return [...config.matchAll(/"(src\/[^"]+\.ts)"/g)]
    .map((match) => match[1])
    .sort();
}

function distPath(fileName: string): URL {
  return new URL(`../dist/${fileName}`, import.meta.url);
}

describe("package manifests", () => {
  it("should expose the same subpaths to JSR and npm", () => {
    const packageJson = readJson("../package.json");
    const denoJson = readJson("../deno.json");
    const expected = [...SUBPATHS].sort();

    assert.deepEqual(
      Object.keys(packageJson.exports as Record<string, unknown>).sort(),
      expected,
    );
    assert.deepEqual(
      Object.keys(denoJson.exports as Record<string, unknown>).sort(),
      expected,
    );
  });

  it("should build every subpath it exports", () => {
    assert.deepEqual(
      readTsdownEntries(),
      [...SUBPATHS]
        .map((subpath) => `src/${DIST_BASENAMES[subpath]}.ts`)
        .sort(),
    );
  });

  it("should point each JSR export at its source module", () => {
    const denoExports = readJson("../deno.json").exports as Record<
      string,
      string
    >;

    for (const subpath of SUBPATHS) {
      const source = denoExports[subpath];
      assert.equal(source, `./src/${DIST_BASENAMES[subpath]}.ts`);
      assert.ok(
        existsSync(new URL(source, new URL("../", import.meta.url))),
        `Missing source module for ${subpath}: ${source}`,
      );
    }
  });

  it("should point each npm condition at the matching build output", () => {
    const packageExports = readJson("../package.json").exports as Record<
      string,
      Record<string, unknown>
    >;

    for (const subpath of SUBPATHS) {
      const basename = DIST_BASENAMES[subpath];
      assert.deepEqual(packageExports[subpath], {
        types: {
          import: `./dist/${basename}.d.ts`,
          require: `./dist/${basename}.d.cts`,
        },
        import: `./dist/${basename}.js`,
        require: `./dist/${basename}.cjs`,
      });
    }
  });

  it("should keep the legacy root fields aligned with the root export", () => {
    const packageJson = readJson("../package.json");

    assert.equal(packageJson.module, "./dist/index.js");
    assert.equal(packageJson.main, "./dist/index.cjs");
    assert.equal(packageJson.types, "./dist/index.d.ts");
    assert.equal(packageJson.sideEffects, false);
  });
});

describe("public surface", () => {
  it("should describe captured output", () => {
    const captured = {
      stdout: "Usage: app [options]\n",
      stderr: "",
    } satisfies CapturedOutput;

    assert.equal(captured.stdout, "Usage: app [options]\n");
    assert.equal(captured.stderr, "");
  });

  it("should resolve every reserved subpath", async () => {
    const root = await import("@optique/testing");
    await import("@optique/testing/cli");
    await import("@optique/testing/discover");
    await import("@optique/testing/parser");
    await import("@optique/testing/run");

    // The root is limited to types shared across layers, so it contributes no
    // runtime exports.  Test functions belong to the layer subpaths instead.
    assert.deepEqual(Object.keys(root), []);
  });
});

describe("npm build output", () => {
  it("should emit every artifact the export map promises", {
    skip: isDeno,
  }, () => {
    // Bun ignores the `skip` option, so bail out explicitly as well.
    if (isDeno) return;

    for (const subpath of SUBPATHS) {
      const basename = DIST_BASENAMES[subpath];
      for (const extension of ["js", "cjs", "d.ts", "d.cts"]) {
        const fileName = `${basename}.${extension}`;
        assert.ok(
          existsSync(distPath(fileName)),
          `Missing build output: dist/${fileName}`,
        );
      }
    }
  });

  it("should be requirable from CommonJS", { skip: isDeno }, () => {
    if (isDeno) return;

    const require = createRequire(import.meta.url);

    assert.equal(typeof require("@optique/testing"), "object");
    require("@optique/testing/cli");
    require("@optique/testing/discover");
    require("@optique/testing/parser");
    require("@optique/testing/run");
  });
});
