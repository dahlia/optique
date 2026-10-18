import assert from "node:assert/strict";
import process from "node:process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createCliRunner } from "@optique/testing/cli";

const fixture = fileURLToPath(
  new URL("../test/fixtures/markdown-reference/", import.meta.url),
);
const sourceRuntime = "Deno" in globalThis;

describe("optional documentation imports", () => {
  it("does not load traversal or rendering during ordinary npm imports", {
    skip: sourceRuntime,
  }, async () => {
    if (sourceRuntime) return;
    const result = await createCliRunner({
      command: ["node", "trace-imports.mjs"],
      cwd: fixture,
    }).invoke();
    assert.equal(result.exitCode, 0, result.stderr);
    const loaded: unknown = JSON.parse(result.stdout);
    assert.ok(
      Array.isArray(loaded) && loaded.length > 0 &&
        loaded.every((url) => typeof url === "string"),
    );
  });

  it("shares constructor registries and exports Markdown in npm ESM and CJS", {
    skip: sourceRuntime,
  }, async () => {
    if (sourceRuntime) return;
    const result = await createCliRunner({
      command: ["node", "registry-formats.mjs"],
      cwd: fixture,
    }).invoke();
    assert.equal(result.exitCode, 0, result.stderr);
    assert.match(result.stdout, /esm: registry shared/);
    assert.match(result.stdout, /cjs: registry shared/);
    for (
      const entry of [
        "../../core/dist/doc-pages.d.ts",
        "../../core/dist/doc-pages.d.cts",
        "../dist/markdown.d.ts",
        "../dist/markdown.d.cts",
      ]
    ) {
      assert.ok(
        readFileSync(new URL(entry, import.meta.url), "utf8").length > 0,
      );
    }
  });
  it("keeps optional documentation out of ordinary Deno source graphs", {
    skip: !sourceRuntime,
  }, async () => {
    if (!sourceRuntime) return;
    for (
      const entry of [
        "../../core/src/index.ts",
        "../../run/src/index.ts",
        "./index.ts",
      ]
    ) {
      const result = await createCliRunner({
        command: [
          process.execPath,
          "info",
          "--json",
          fileURLToPath(new URL(entry, import.meta.url)),
        ],
        cwd: fixture,
      }).invoke();
      assert.equal(result.exitCode, 0, result.stderr);
      const graph: unknown = JSON.parse(result.stdout);
      assert.ok(
        graph != null && typeof graph === "object" && "modules" in graph &&
          Array.isArray(graph.modules),
      );
      for (const module of graph.modules) {
        assert.ok(
          module != null && typeof module === "object" &&
            "specifier" in module && typeof module.specifier === "string",
        );
        assert.ok(
          !module.specifier.endsWith("/src/doc-pages.ts"),
          module.specifier,
        );
        assert.ok(
          !module.specifier.endsWith("/src/markdown.ts"),
          module.specifier,
        );
      }
    }
  });
});
