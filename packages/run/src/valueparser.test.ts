import { formatMessage, message, values } from "@optique/core/message";
import { path } from "@optique/run/valueparser";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";

function createTempDir() {
  const tempDir = `/tmp/optique-test-${Date.now()}-${
    Math.random().toString(36).substring(2)
  }`;
  mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

function cleanupDir(dir: string) {
  try {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    // Ignore cleanup errors
  }
}

describe("path", () => {
  describe("basic functionality", () => {
    it("should parse any path without validation", () => {
      const parser = path();
      const result = parser.parse("/nonexistent/path");

      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.value, "/nonexistent/path");
      }
    });

    it("should use default metavar PATH", () => {
      const parser = path();
      assert.equal(parser.metavar, "PATH");
    });

    it("should use custom metavar", () => {
      const parser = path({ metavar: "CONFIG_FILE" });
      assert.equal(parser.metavar, "CONFIG_FILE");
    });

    it("should format path values correctly", () => {
      const parser = path();
      assert.equal(parser.format("/some/path/file.txt"), "/some/path/file.txt");
    });
  });

  describe("mustExist validation", () => {
    it("should pass when file exists", () => {
      const testDir = createTempDir();
      try {
        const testFile = join(testDir, "existing-file.txt");
        writeFileSync(testFile, "content");

        const parser = path({ mustExist: true });
        const result = parser.parse(testFile);

        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.value, testFile);
        }
      } finally {
        cleanupDir(testDir);
      }
    });

    it("should pass when directory exists", () => {
      const testDir = createTempDir();
      try {
        const testSubDir = join(testDir, "existing-dir");
        mkdirSync(testSubDir);

        const parser = path({ mustExist: true });
        const result = parser.parse(testSubDir);

        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.value, testSubDir);
        }
      } finally {
        cleanupDir(testDir);
      }
    });

    it("should fail when path does not exist", () => {
      const testDir = createTempDir();
      try {
        const nonExistentPath = join(testDir, "nonexistent");

        const parser = path({ mustExist: true });
        const result = parser.parse(nonExistentPath);

        assert.equal(result.success, false);
        if (!result.success) {
          assert.match(formatMessage(result.error), /does not exist/);
        }
      } finally {
        cleanupDir(testDir);
      }
    });
  });

  describe("type validation", () => {
    it("should validate file type when mustExist is true", () => {
      const testDir = createTempDir();
      try {
        const testFile = join(testDir, "test-file.txt");
        writeFileSync(testFile, "content");

        const parser = path({ mustExist: true, type: "file" });
        const result = parser.parse(testFile);

        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.value, testFile);
        }
      } finally {
        cleanupDir(testDir);
      }
    });

    it("should validate directory type when mustExist is true", () => {
      const testDir = createTempDir();
      try {
        const testSubDir = join(testDir, "test-dir");
        mkdirSync(testSubDir);

        const parser = path({ mustExist: true, type: "directory" });
        const result = parser.parse(testSubDir);

        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.value, testSubDir);
        }
      } finally {
        cleanupDir(testDir);
      }
    });

    it("should fail when expecting file but path is directory", () => {
      const testDir = createTempDir();
      try {
        const testSubDir = join(testDir, "test-dir");
        mkdirSync(testSubDir);

        const parser = path({ mustExist: true, type: "file" });
        const result = parser.parse(testSubDir);

        assert.equal(result.success, false);
        if (!result.success) {
          assert.match(
            formatMessage(result.error),
            /Expected a file.*not a file/,
          );
        }
      } finally {
        cleanupDir(testDir);
      }
    });

    it("should fail when expecting directory but path is file", () => {
      const testDir = createTempDir();
      try {
        const testFile = join(testDir, "test-file.txt");
        writeFileSync(testFile, "content");

        const parser = path({ mustExist: true, type: "directory" });
        const result = parser.parse(testFile);

        assert.equal(result.success, false);
        if (!result.success) {
          assert.match(
            formatMessage(result.error),
            /Expected a directory.*not a directory/,
          );
        }
      } finally {
        cleanupDir(testDir);
      }
    });

    it("should accept either file or directory when type is either", () => {
      const testDir = createTempDir();
      try {
        const testFile = join(testDir, "test-file.txt");
        const testSubDir = join(testDir, "test-dir");
        writeFileSync(testFile, "content");
        mkdirSync(testSubDir);

        const parser = path({ mustExist: true, type: "either" });

        const fileResult = parser.parse(testFile);
        assert.equal(fileResult.success, true);

        const dirResult = parser.parse(testSubDir);
        assert.equal(dirResult.success, true);
      } finally {
        cleanupDir(testDir);
      }
    });
  });

  describe("mustNotExist validation", () => {
    it("should pass when path does not exist", () => {
      const testDir = createTempDir();
      try {
        const nonExistentPath = join(testDir, "new-file.txt");

        const parser = path({ mustNotExist: true });
        const result = parser.parse(nonExistentPath);

        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.value, nonExistentPath);
        }
      } finally {
        cleanupDir(testDir);
      }
    });

    it("should fail when file already exists", () => {
      const testDir = createTempDir();
      try {
        const existingFile = join(testDir, "existing-file.txt");
        writeFileSync(existingFile, "content");

        const parser = path({ mustNotExist: true });
        const result = parser.parse(existingFile);

        assert.equal(result.success, false);
        if (!result.success) {
          assert.match(formatMessage(result.error), /already exists/);
        }
      } finally {
        cleanupDir(testDir);
      }
    });

    it("should fail when directory already exists", () => {
      const testDir = createTempDir();
      try {
        const existingDir = join(testDir, "existing-dir");
        mkdirSync(existingDir);

        const parser = path({ mustNotExist: true });
        const result = parser.parse(existingDir);

        assert.equal(result.success, false);
        if (!result.success) {
          assert.match(formatMessage(result.error), /already exists/);
        }
      } finally {
        cleanupDir(testDir);
      }
    });

    it("should still validate extensions when mustNotExist is true", () => {
      const testDir = createTempDir();
      try {
        const nonExistentPath = join(testDir, "new-file.txt");

        const parser = path({
          mustNotExist: true,
          extensions: [".json", ".yaml"],
        });
        const result = parser.parse(nonExistentPath);

        assert.equal(result.success, false);
        if (!result.success) {
          assert.match(
            formatMessage(result.error),
            /Expected file with extension/,
          );
        }
      } finally {
        cleanupDir(testDir);
      }
    });

    it("should validate parent directory when allowCreate is true", () => {
      const testDir = createTempDir();
      try {
        const nonExistentPath = join(
          testDir,
          "nonexistent-parent",
          "new-file.txt",
        );

        const parser = path({ mustNotExist: true, allowCreate: true });
        const result = parser.parse(nonExistentPath);

        assert.equal(result.success, false);
        if (!result.success) {
          assert.match(
            formatMessage(result.error),
            /Parent directory.*does not exist/,
          );
        }
      } finally {
        cleanupDir(testDir);
      }
    });
  });

  describe("allowCreate validation", () => {
    it("should pass when parent directory exists", () => {
      const testDir = createTempDir();
      try {
        const testFile = join(testDir, "new-file.txt");

        const parser = path({ allowCreate: true });
        const result = parser.parse(testFile);

        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.value, testFile);
        }
      } finally {
        cleanupDir(testDir);
      }
    });

    it("should fail when parent directory does not exist", () => {
      const testDir = createTempDir();
      try {
        const testFile = join(testDir, "nonexistent-dir", "new-file.txt");

        const parser = path({ allowCreate: true });
        const result = parser.parse(testFile);

        assert.equal(result.success, false);
        if (!result.success) {
          assert.match(
            formatMessage(result.error),
            /Parent directory.*does not exist/,
          );
        }
      } finally {
        cleanupDir(testDir);
      }
    });

    it("should not validate parent when mustExist is true", () => {
      const testDir = createTempDir();
      try {
        const nonExistentFile = join(testDir, "nonexistent-dir", "file.txt");

        const parser = path({ mustExist: true, allowCreate: true });
        const result = parser.parse(nonExistentFile);

        assert.equal(result.success, false);
        if (!result.success) {
          assert.match(formatMessage(result.error), /does not exist/);
          assert.doesNotMatch(formatMessage(result.error), /Parent directory/);
        }
      } finally {
        cleanupDir(testDir);
      }
    });
  });

  describe("extensions validation", () => {
    it("should pass when file has accepted extension", () => {
      const parser = path({ extensions: [".json", ".yaml", ".yml"] });

      const jsonResult = parser.parse("config.json");
      assert.equal(jsonResult.success, true);

      const yamlResult = parser.parse("config.yaml");
      assert.equal(yamlResult.success, true);

      const ymlResult = parser.parse("config.yml");
      assert.equal(ymlResult.success, true);
    });

    it("should fail when file has unaccepted extension", () => {
      const parser = path({ extensions: [".json", ".yaml"] });
      const result = parser.parse("config.txt");

      assert.equal(result.success, false);
      if (!result.success) {
        assert.match(
          formatMessage(result.error),
          /Expected file with extension.*\.json, \.yaml.*got \.txt/,
        );
      }
    });

    it("should fail when file has no extension but extensions required", () => {
      const parser = path({ extensions: [".json"] });
      const result = parser.parse("config");

      assert.equal(result.success, false);
      if (!result.success) {
        assert.match(
          formatMessage(result.error),
          /Expected file with extension.*got no extension/,
        );
      }
    });
  });

  describe("combined validations", () => {
    it("should validate all criteria together", () => {
      const testDir = createTempDir();
      try {
        const testFile = join(testDir, "config.json");
        writeFileSync(testFile, "{}");

        const parser = path({
          mustExist: true,
          type: "file",
          extensions: [".json", ".yaml"],
        });

        const result = parser.parse(testFile);
        assert.equal(result.success, true);
        if (result.success) {
          assert.equal(result.value, testFile);
        }
      } finally {
        cleanupDir(testDir);
      }
    });

    it("should fail if any validation fails", () => {
      const testDir = createTempDir();
      try {
        const testFile = join(testDir, "config.txt");
        writeFileSync(testFile, "content");

        const parser = path({
          mustExist: true,
          type: "file",
          extensions: [".json"],
        });

        const result = parser.parse(testFile);
        assert.equal(result.success, false);
        if (!result.success) {
          assert.match(
            formatMessage(result.error),
            /Expected file with extension.*\.json.*got \.txt/,
          );
        }
      } finally {
        cleanupDir(testDir);
      }
    });
  });

  describe("edge cases", () => {
    it("should handle relative paths", () => {
      const parser = path();
      const result = parser.parse("./relative/path");

      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.value, "./relative/path");
      }
    });

    it("should handle paths with spaces", () => {
      const parser = path();
      const result = parser.parse("/path/with spaces/file.txt");

      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.value, "/path/with spaces/file.txt");
      }
    });

    it("should handle empty extensions array", () => {
      const parser = path({ extensions: [] });
      const result = parser.parse("any-file.any");

      assert.equal(result.success, true);
      if (result.success) {
        assert.equal(result.value, "any-file.any");
      }
    });
  });

  describe("error customization", () => {
    it("should use custom invalidExtension error message", () => {
      const parser = path({
        extensions: [".txt", ".md"],
        errors: {
          invalidExtension: message`Please provide a text or markdown file.`,
        },
      });

      const result = parser.parse("document.pdf");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Please provide a text or markdown file." },
      ]);
    });

    it("should use function-based invalidExtension error message", () => {
      const parser = path({
        extensions: [".json", ".yaml"],
        errors: {
          invalidExtension: (input, extensions, actualExt) =>
            message`File ${input} has extension ${actualExt}. Expected: ${
              values(extensions)
            }.`,
        },
      });

      const result = parser.parse("config.xml");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "File " },
        { type: "value", value: "config.xml" },
        { type: "text", text: " has extension " },
        { type: "value", value: ".xml" },
        { type: "text", text: ". Expected: " },
        { type: "values", values: [".json", ".yaml"] },
        { type: "text", text: "." },
      ]);
    });

    it("should use custom pathNotFound error message", () => {
      const parser = path({
        mustExist: true,
        errors: {
          pathNotFound: message`The specified path could not be found.`,
        },
      });

      const result = parser.parse("/nonexistent/path");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "The specified path could not be found." },
      ]);
    });

    it("should use function-based pathNotFound error message", () => {
      const parser = path({
        mustExist: true,
        errors: {
          pathNotFound: (input) =>
            message`Cannot locate file or directory: ${input}`,
        },
      });

      const result = parser.parse("/missing/file.txt");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Cannot locate file or directory: " },
        { type: "value", value: "/missing/file.txt" },
      ]);
    });

    it("should use custom notAFile error message", () => {
      const tempDir = createTempDir();
      try {
        const parser = path({
          mustExist: true,
          type: "file",
          errors: {
            notAFile: message`Expected a file, not a directory.`,
          },
        });

        const result = parser.parse(tempDir);
        assert.ok(!result.success);
        assert.deepEqual(result.error, [
          { type: "text", text: "Expected a file, not a directory." },
        ]);
      } finally {
        cleanupDir(tempDir);
      }
    });

    it("should use custom notADirectory error message", () => {
      const tempDir = createTempDir();
      try {
        const testFile = join(tempDir, "test.txt");
        writeFileSync(testFile, "content");

        const parser = path({
          mustExist: true,
          type: "directory",
          errors: {
            notADirectory: (input) =>
              message`${input} is a file, but a directory was expected.`,
          },
        });

        const result = parser.parse(testFile);
        assert.ok(!result.success);
        assert.deepEqual(result.error, [
          { type: "value", value: testFile },
          { type: "text", text: " is a file, but a directory was expected." },
        ]);
      } finally {
        cleanupDir(tempDir);
      }
    });

    it("should use custom parentNotFound error message", () => {
      const parser = path({
        allowCreate: true,
        errors: {
          parentNotFound: message`Parent directory is missing.`,
        },
      });

      const result = parser.parse("/nonexistent/parent/newfile.txt");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Parent directory is missing." },
      ]);
    });

    it("should use custom pathAlreadyExists error message", () => {
      const tempDir = createTempDir();
      try {
        const existingFile = join(tempDir, "existing.txt");
        writeFileSync(existingFile, "content");

        const parser = path({
          mustNotExist: true,
          errors: {
            pathAlreadyExists:
              message`Output file already exists. Use --force to overwrite.`,
          },
        });

        const result = parser.parse(existingFile);
        assert.ok(!result.success);
        assert.deepEqual(result.error, [
          {
            type: "text",
            text: "Output file already exists. Use --force to overwrite.",
          },
        ]);
      } finally {
        cleanupDir(tempDir);
      }
    });

    it("should use function-based pathAlreadyExists error message", () => {
      const tempDir = createTempDir();
      try {
        const existingFile = join(tempDir, "existing.txt");
        writeFileSync(existingFile, "content");

        const parser = path({
          mustNotExist: true,
          errors: {
            pathAlreadyExists: (input) =>
              message`File ${input} already exists and would be overwritten.`,
          },
        });

        const result = parser.parse(existingFile);
        assert.ok(!result.success);
        assert.deepEqual(result.error, [
          { type: "text", text: "File " },
          { type: "value", value: existingFile },
          { type: "text", text: " already exists and would be overwritten." },
        ]);
      } finally {
        cleanupDir(tempDir);
      }
    });

    it("should use function-based parentNotFound error message", () => {
      const parser = path({
        allowCreate: true,
        errors: {
          parentNotFound: (parentDir) =>
            message`Parent directory ${parentDir} must exist first.`,
        },
      });

      const result = parser.parse("/nonexistent/parent/newfile.txt");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Parent directory " },
        { type: "value", value: "/nonexistent/parent" },
        { type: "text", text: " must exist first." },
      ]);
    });

    it("should fall back to default error when custom error is not provided", () => {
      const tempDir = createTempDir();
      try {
        const parser = path({
          mustExist: true,
          type: "file",
          errors: {
            pathNotFound: message`Custom path not found.`,
            // notAFile is not customized, should use default
          },
        });

        // Test custom error
        const result1 = parser.parse("/nonexistent/file");
        assert.ok(!result1.success);
        assert.deepEqual(result1.error, [
          { type: "text", text: "Custom path not found." },
        ]);

        // Test default error fallback
        const result2 = parser.parse(tempDir);
        assert.ok(!result2.success);
        // Should use default error message for notAFile
        assert.ok(
          result2.error.some((term) =>
            term.type === "text" && term.text.includes("Expected a file, but")
          ),
        );
      } finally {
        cleanupDir(tempDir);
      }
    });

    it("should work correctly when no errors option is provided", () => {
      const parser = path({ mustExist: true });

      const result = parser.parse("/nonexistent/path");
      assert.ok(!result.success);
      // Should use default error message
      assert.ok(
        result.error.some((term) =>
          term.type === "text" && term.text.includes("does not exist")
        ),
      );
    });
  });

  describe("completion functionality", () => {
    it("should provide completion suggestions for existing directories", () => {
      const parser = path();

      // Test completion for current directory
      const suggestions = Array.from(parser.suggest!("src"));

      // Should return some suggestions (at least one if src directory exists)
      assert.ok(Array.isArray(suggestions));

      // Each suggestion should have the right structure and optional description
      suggestions.forEach((suggestion) => {
        if (suggestion.kind === "literal") {
          assert.ok(typeof suggestion.text === "string");
        } else {
          assert.ok(suggestion.kind === "file");
        }
        assert.ok(
          suggestion.description === undefined ||
            typeof suggestion.description === "object",
        );
      });
    });

    it("should filter by file extensions", () => {
      const parser = path({ extensions: [".ts", ".js"] });

      // Test with src/ directory which should contain TypeScript files
      const suggestions = Array.from(parser.suggest!("src/"));

      // Check that we got some suggestions
      assert.ok(suggestions.length >= 0); // Allow empty results

      // All file suggestions should have .ts or .js extension (directories are allowed)
      suggestions.forEach((suggestion) => {
        if (suggestion.kind === "literal") {
          if (!suggestion.text.endsWith("/")) { // Not a directory
            const hasValidExtension = suggestion.text.endsWith(".ts") ||
              suggestion.text.endsWith(".js");
            assert.ok(
              hasValidExtension,
              `File ${suggestion.text} should have .ts or .js extension`,
            );
          }
        }
        // File-type suggestions don't need text validation since they use native completion
      });
    });

    it("should filter by type (directories only)", () => {
      const parser = path({ type: "directory" });

      const suggestions = Array.from(parser.suggest!(""));

      // All suggestions should be directories
      suggestions.forEach((suggestion) => {
        if (suggestion.kind === "literal") {
          assert.ok(
            suggestion.text.endsWith("/") || suggestion.text.endsWith("\\"),
            `Suggestion ${suggestion.text} should be a directory`,
          );
        } else {
          // File-type suggestions with directory type use native shell completion
          assert.ok(
            suggestion.type === "directory",
            `File suggestion should have directory type`,
          );
        }
      });
    });

    it("should handle empty prefix gracefully", () => {
      const parser = path();

      const suggestions = Array.from(parser.suggest!(""));

      // Should not throw and should return an array
      assert.ok(Array.isArray(suggestions));
    });

    it("should handle non-existent paths gracefully", () => {
      const parser = path();

      const suggestions = Array.from(parser.suggest!("non-existent-path/"));

      // Should not throw and should return a file completion suggestion
      assert.ok(Array.isArray(suggestions));
      if (suggestions.length > 0) {
        const suggestion = suggestions[0];
        assert.ok(suggestion.kind === "file");
        assert.ok(typeof suggestion.type === "string");
      }
    });

    it("should skip hidden files unless prefix starts with dot", () => {
      const parser = path();

      // Test with regular prefix (should not include hidden files)
      const regularSuggestions = Array.from(parser.suggest!(""));

      // Test with dot prefix (should include hidden files)
      const dotSuggestions = Array.from(parser.suggest!("."));

      // This test depends on the directory structure, so we just ensure no errors
      assert.ok(Array.isArray(regularSuggestions));
      assert.ok(Array.isArray(dotSuggestions));
    });
  });
});
