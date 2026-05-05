import * as annotations from "@optique/core/annotations";
import * as dependency from "@optique/core/dependency";
import * as extension from "@optique/core/extension";
import * as parser from "@optique/core/parser";
import * as root from "@optique/core";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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

test("package manifests expose only supported public subpaths", () => {
  const packageJson = readJson("../package.json");
  const denoJson = readJson("../deno.json");
  const packageExports = Object.keys(
    packageJson.exports as Record<string, unknown>,
  ).sort();
  const denoExports = Object.keys(
    denoJson.exports as Record<string, unknown>,
  ).sort();
  const tsdownEntries = readTsdownEntries();
  const expected = [
    ".",
    "./annotations",
    "./completion",
    "./constructs",
    "./context",
    "./dependency",
    "./doc",
    "./extension",
    "./facade",
    "./message",
    "./modifiers",
    "./nonempty",
    "./parser",
    "./primitives",
    "./program",
    "./usage",
    "./valueparser",
  ].sort();

  assert.deepEqual(packageExports, expected);
  assert.deepEqual(denoExports, expected);
  assert.deepEqual(tsdownEntries, [
    "src/annotations.ts",
    "src/completion.ts",
    "src/constructs.ts",
    "src/context.ts",
    "src/dependency.ts",
    "src/doc.ts",
    "src/extension.ts",
    "src/facade.ts",
    "src/index.ts",
    "src/message.ts",
    "src/modifiers.ts",
    "src/nonempty.ts",
    "src/parser.ts",
    "src/primitives.ts",
    "src/program.ts",
    "src/usage.ts",
    "src/valueparser.ts",
  ]);
  assert.ok(!packageExports.includes("./mode-dispatch"));
  assert.ok(!denoExports.includes("./mode-dispatch"));
});

test("annotations module only exposes the annotation read API", () => {
  assert.deepEqual(Object.keys(annotations).sort(), ["getAnnotations"]);
});

test("extension module exposes the supported extension helpers", () => {
  assert.deepEqual(Object.keys(extension).sort(), [
    "defineTraits",
    "delegateSuggestNodes",
    "dispatchByMode",
    "getTraits",
    "inheritAnnotations",
    "injectAnnotations",
    "isInjectedAnnotationState",
    "mapModeValue",
    "mapSourceMetadata",
    "unwrapInjectedAnnotationState",
    "withAnnotationView",
    "wrapForMode",
  ]);
});

test("dependency module hides internal replay machinery", () => {
  assert.deepEqual(Object.keys(dependency).sort(), [
    "dependency",
    "deriveFrom",
    "deriveFromAsync",
    "deriveFromSync",
    "isDependencySource",
    "isDerivedValueParser",
  ]);
});

test("parser module hides constructs and parser-internal helpers", () => {
  assert.deepEqual(Object.keys(parser).sort(), [
    "createParserContext",
    "getDocPage",
    "getDocPageAsync",
    "getDocPageSync",
    "parse",
    "parseAsync",
    "parseSync",
    "suggest",
    "suggestAsync",
    "suggestSync",
  ]);
});

test("root module keeps user-facing APIs but not internal machinery", () => {
  assert.equal(typeof root.object, "function");
  assert.equal(typeof root.option, "function");
  assert.equal(typeof root.negatableFlag, "function");
  assert.equal(typeof root.parse, "function");
  assert.equal(typeof root.dependency, "function");
  assert.ok(!Object.hasOwn(root, "annotationKey"));
  assert.ok(!Object.hasOwn(root, "dependencyId"));
  assert.ok(!Object.hasOwn(root, "getParserSuggestRuntimeNodes"));
  assert.ok(!Object.hasOwn(root, "dispatchByMode"));
});
