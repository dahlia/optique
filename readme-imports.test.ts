import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

const PRIMITIVES = [
  "constant",
  "fail",
  "option",
  "flag",
  "argument",
  "command",
  "passThrough",
];

const CONSTRUCTS = [
  "or",
  "longestMatch",
  "object",
  "tuple",
  "merge",
  "concat",
  "group",
  "conditional",
];

const MODIFIERS = [
  "optional",
  "withDefault",
  "map",
  "multiple",
  "nonEmpty",
];

const MOVED_SYMBOLS = new Map<string, string>([
  ...PRIMITIVES.map((s) => [s, "@optique/core/primitives"] as const),
  ...CONSTRUCTS.map((s) => [s, "@optique/core/constructs"] as const),
  ...MODIFIERS.map((s) => [s, "@optique/core/modifiers"] as const),
]);

const IMPORT_RE =
  /import\s+\{([^}]+)\}\s+from\s+["']@optique\/core\/parser["']/g;

async function findReadmeFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const entries = await readdir(dir);
  for (const entry of entries) {
    if (entry === "node_modules" || entry === "dist" || entry === ".git") {
      continue;
    }
    const full = join(dir, entry);
    let info;
    try {
      info = await stat(full);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      results.push(...await findReadmeFiles(full));
    } else if (entry === "README.md") {
      results.push(full);
    }
  }
  return results;
}

describe("README imports", () => {
  it("should not import primitives/constructs/modifiers from @optique/core/parser", async () => {
    const root = new URL(".", import.meta.url).pathname;
    const readmes = await findReadmeFiles(root);
    const violations: string[] = [];

    for (const readme of readmes) {
      const content = await readFile(readme, "utf-8");
      for (const match of content.matchAll(IMPORT_RE)) {
        const symbols = match[1].split(",").map((s) => s.trim());
        for (const symbol of symbols) {
          const correctModule = MOVED_SYMBOLS.get(symbol);
          if (correctModule) {
            const rel = readme.replace(root, "");
            violations.push(
              `${rel}: "${symbol}" should be imported from "${correctModule}", not "@optique/core/parser"`,
            );
          }
        }
      }
    }

    assert.deepStrictEqual(
      violations,
      [],
      `Found stale @optique/core/parser imports in README files:\n${
        violations.join("\n")
      }`,
    );
  });
});
