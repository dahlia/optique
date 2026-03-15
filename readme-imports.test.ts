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

const STALE_OPTION_PATTERNS: {
  pattern: RegExp;
  description: string;
  files?: string[];
}[] = [
  {
    pattern: /completion:\s*\{\s*mode:/,
    description:
      'completion should use string shorthand (e.g., "both") in @optique/run, not { mode: "both" }',
    files: ["packages/run/README.md"],
  },
  {
    pattern: /help:\s*"(?:both|command|option)"/,
    description:
      "runParser() help option requires object shape (e.g., { command: true, option: true }), not a string shorthand",
    files: ["packages/core/README.md"],
  },
];

describe("README option shapes", () => {
  it("should not use stale run()/runParser() option shapes", async () => {
    const root = new URL(".", import.meta.url).pathname;
    const readmes = await findReadmeFiles(root);
    const violations: string[] = [];

    for (const readme of readmes) {
      const content = await readFile(readme, "utf-8");
      const rel = readme.replace(root, "");
      for (const { pattern, description, files } of STALE_OPTION_PATTERNS) {
        if (files && !files.some((f) => rel === f)) continue;
        if (pattern.test(content)) {
          violations.push(`${rel}: ${description}`);
        }
      }
    }

    assert.deepStrictEqual(
      violations,
      [],
      `Found stale option shapes in README files:\n${violations.join("\n")}`,
    );
  });
});

describe("README run() usage", () => {
  it("should not call run() with a plain object instead of a parser", async () => {
    const root = new URL(".", import.meta.url).pathname;
    const readmes = await findReadmeFiles(root);
    const violations: string[] = [];
    // Match run({ ... }) but not run(object({ ... })) or run(parser, { ... })
    const runObjectPattern = /\brun\(\s*\{/g;

    for (const readme of readmes) {
      const content = await readFile(readme, "utf-8");
      const rel = readme.replace(root, "");
      // Only check inside code blocks
      const codeBlocks = content.matchAll(
        /~~~~ typescript\n([\s\S]*?)~~~~/g,
      );
      for (const block of codeBlocks) {
        if (runObjectPattern.test(block[1])) {
          violations.push(
            `${rel}: run() should take a parser, not a plain object (use run(object({ ... })))`,
          );
        }
        runObjectPattern.lastIndex = 0;
      }
    }

    assert.deepStrictEqual(
      violations,
      [],
      `Found run() calls with plain objects:\n${violations.join("\n")}`,
    );
  });

  it("should not import object from @optique/core/primitives", async () => {
    const root = new URL(".", import.meta.url).pathname;
    const readmes = await findReadmeFiles(root);
    const violations: string[] = [];
    const pattern =
      /import\s+\{[^}]*\bobject\b[^}]*\}\s+from\s+["']@optique\/core\/primitives["']/g;

    for (const readme of readmes) {
      const content = await readFile(readme, "utf-8");
      if (pattern.test(content)) {
        const rel = readme.replace(root, "");
        violations.push(
          `${rel}: "object" should be imported from "@optique/core/constructs", not "@optique/core/primitives"`,
        );
      }
      pattern.lastIndex = 0;
    }

    assert.deepStrictEqual(
      violations,
      [],
      `Found "object" imported from wrong module:\n${violations.join("\n")}`,
    );
  });

  it("should not use plain strings for option descriptions", async () => {
    const root = new URL(".", import.meta.url).pathname;
    const readmes = await findReadmeFiles(root);
    const violations: string[] = [];
    // Match description: "..." (plain string instead of message`...`)
    const pattern = /description:\s*["'][^"']*["']/g;

    for (const readme of readmes) {
      const content = await readFile(readme, "utf-8");
      const rel = readme.replace(root, "");
      const codeBlocks = content.matchAll(
        /~~~~ typescript\n([\s\S]*?)~~~~/g,
      );
      for (const block of codeBlocks) {
        if (pattern.test(block[1])) {
          violations.push(
            `${rel}: description should use message\`...\` template, not a plain string`,
          );
        }
        pattern.lastIndex = 0;
      }
    }

    assert.deepStrictEqual(
      violations,
      [],
      `Found plain string descriptions:\n${violations.join("\n")}`,
    );
  });
});

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
