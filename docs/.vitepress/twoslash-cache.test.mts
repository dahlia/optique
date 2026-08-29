import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeTwoslashCacheNamespace,
  createLanguageAwareTypesCache,
  extractTwoslashBlocks,
} from "./twoslash-cache.mts";

const compilerOptions = {
  module: 99,
  moduleResolution: 100,
  target: 99,
  lib: ["dom", "esnext"],
};

const typeEnvironmentFiles = new Map([
  ["pnpm-lock.yaml", "lockfileVersion: '9.0'"],
  ["packages/core/dist/index.d.ts", "export type Parser = unknown;"],
]);

describe("computeTwoslashCacheNamespace", () => {
  it("should ignore the input file order", () => {
    // Arrange
    const reversedFiles = new Map(Array.from(typeEnvironmentFiles).reverse());

    // Act
    const first = computeTwoslashCacheNamespace(
      1,
      compilerOptions,
      typeEnvironmentFiles,
    );
    const second = computeTwoslashCacheNamespace(
      1,
      compilerOptions,
      reversedFiles,
    );

    // Assert
    assert.equal(first, second);
  });

  it("should change when the cache format changes", () => {
    // Act
    const first = computeTwoslashCacheNamespace(
      1,
      compilerOptions,
      typeEnvironmentFiles,
    );
    const second = computeTwoslashCacheNamespace(
      2,
      compilerOptions,
      typeEnvironmentFiles,
    );

    // Assert
    assert.notEqual(first, second);
  });

  it("should change when the compiler options change", () => {
    // Arrange
    const changedOptions = { ...compilerOptions, strict: true };

    // Act
    const first = computeTwoslashCacheNamespace(
      1,
      compilerOptions,
      typeEnvironmentFiles,
    );
    const second = computeTwoslashCacheNamespace(
      1,
      changedOptions,
      typeEnvironmentFiles,
    );

    // Assert
    assert.notEqual(first, second);
  });

  it("should change when the lockfile changes", () => {
    // Arrange
    const changedFiles = new Map(typeEnvironmentFiles);
    changedFiles.set("pnpm-lock.yaml", "lockfileVersion: '10.0'");

    // Act
    const first = computeTwoslashCacheNamespace(
      1,
      compilerOptions,
      typeEnvironmentFiles,
    );
    const second = computeTwoslashCacheNamespace(
      1,
      compilerOptions,
      changedFiles,
    );

    // Assert
    assert.notEqual(first, second);
  });

  it("should change when a declaration changes", () => {
    // Arrange
    const changedFiles = new Map(typeEnvironmentFiles);
    changedFiles.set(
      "packages/core/dist/index.d.ts",
      "export interface Parser {}",
    );

    // Act
    const first = computeTwoslashCacheNamespace(
      1,
      compilerOptions,
      typeEnvironmentFiles,
    );
    const second = computeTwoslashCacheNamespace(
      1,
      compilerOptions,
      changedFiles,
    );

    // Assert
    assert.notEqual(first, second);
  });
});

describe("extractTwoslashBlocks", () => {
  it("should extract Twoslash fences with normalized languages", () => {
    // Arrange
    const markdown = [
      "Before.",
      "",
      "~~~~ typescript twoslash",
      'const greeting = "Hello";',
      "~~~~",
      "",
      "~~~~ javascript",
      'console.log("Not checked");',
      "~~~~",
      "",
      "~~~~ ts twoslash",
      "const answer: number = 42;",
      "~~~~",
    ].join("\n");

    // Act
    const blocks = extractTwoslashBlocks(markdown);

    // Assert
    assert.deepEqual(blocks, [
      {
        code: 'const greeting = "Hello";',
        lang: "ts",
        meta: "twoslash",
      },
      {
        code: "const answer: number = 42;",
        lang: "ts",
        meta: "twoslash",
      },
    ]);
  });

  it("should support VitePress fence characters and lengths", () => {
    // Arrange
    const markdown = [
      "```typescript twoslash",
      "const first: number = 1;",
      "```",
      "",
      "~~~~~ ts twoslash",
      "const second: number = 2;",
      "`````",
      "~~~~",
      "~~~~~~",
    ].join("\n");

    // Act
    const blocks = extractTwoslashBlocks(markdown);

    // Assert
    assert.deepEqual(blocks, [
      {
        code: "const first: number = 1;",
        lang: "ts",
        meta: "twoslash",
      },
      {
        code: "const second: number = 2;\n`````\n~~~~",
        lang: "ts",
        meta: "twoslash",
      },
    ]);
  });

  it("should remove trailing blank lines like VitePress", () => {
    // Arrange
    const markdown = [
      "~~~~ typescript twoslash",
      "const answer = 42;",
      "",
      "",
      "~~~~",
    ].join("\n");

    // Act
    const [block] = extractTwoslashBlocks(markdown);

    // Assert
    assert.equal(block.code, "const answer = 42;");
  });

  it("should extract fences from CRLF Markdown", () => {
    // Arrange
    const markdown = [
      "~~~~ typescript twoslash",
      "const answer = 42;",
      "~~~~",
    ].join("\r\n");

    // Act
    const [block] = extractTwoslashBlocks(markdown);

    // Assert
    assert.equal(block.code, "const answer = 42;");
  });

  it("should extract Twoslash fences indented under definition lists", () => {
    // Arrange
    const markdown = [
      "`example`",
      ":   A nested example.",
      "",
      "    ~~~~ typescript twoslash",
      "    const answer: number = 42;",
      "    ~~~~",
    ].join("\n");

    // Act
    const [block] = extractTwoslashBlocks(markdown);

    // Assert
    assert.deepEqual(block, {
      code: "const answer: number = 42;",
      lang: "ts",
      meta: "twoslash",
    });
  });

  it("should extract Twoslash fences nested in GitHub alerts", () => {
    // Arrange
    const markdown = [
      "> [!NOTE]",
      "> A nested example.",
      ">",
      "> ~~~~ typescript twoslash",
      "> const answer: number = 42;",
      ">",
      '> const label = "answer";',
      "> ~~~~",
    ].join("\n");

    // Act
    const [block] = extractTwoslashBlocks(markdown);

    // Assert
    assert.deepEqual(block, {
      code: 'const answer: number = 42;\n\nconst label = "answer";',
      lang: "ts",
      meta: "twoslash",
    });
  });
});

describe("createLanguageAwareTypesCache", () => {
  it("should separate identical source across languages", () => {
    // Arrange
    const keys: string[] = [];
    const cache = createLanguageAwareTypesCache({
      read(code) {
        keys.push(code);
        return null;
      },
      write() {},
    });

    // Act
    cache.read("const answer = 42;", "ts");
    cache.read("const answer = 42;", "js");

    // Assert
    assert.notEqual(keys[0], keys[1]);
  });

  it("should treat malformed cache entries as misses", () => {
    // Arrange
    const cache = createLanguageAwareTypesCache({
      read() {
        throw new SyntaxError("Unterminated string in JSON.");
      },
      write() {},
    });

    // Act
    const result = cache.read("const answer = 42;", "ts");

    // Assert
    assert.equal(result, null);
  });

  it("should preserve non-syntax cache read failures", () => {
    // Arrange
    const failure = new Error("Permission denied.");
    const cache = createLanguageAwareTypesCache({
      read() {
        throw failure;
      },
      write() {},
    });

    // Act and assert
    assert.throws(
      () => cache.read("const answer = 42;", "ts"),
      (error) => error === failure,
    );
  });
});
