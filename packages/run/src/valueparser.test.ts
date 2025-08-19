import { formatMessage } from "@optique/core/message";
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
});
