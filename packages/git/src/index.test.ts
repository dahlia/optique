/**
 * Tests for @optique/git package.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import * as isomorphicGit from "isomorphic-git";
import type { Suggestion } from "@optique/core/parser";
import type { NonEmptyString } from "@optique/core/nonempty";
import {
  createGitParsers,
  type FileSystem,
  gitBranch,
  gitCommit,
  gitRef,
  gitRemote,
  gitRemoteBranch,
  gitTag,
} from "./index.ts";

const testRepoDir = join(process.cwd(), "packages/tmp/test-repo");

async function getFs(): Promise<FileSystem> {
  const nodeFs = await import("node:fs/promises");
  const { TextDecoder } = await import("node:util");
  const decoder = new TextDecoder();
  return {
    async readFile(path) {
      const data = await nodeFs.readFile(path);
      if (path.endsWith("/index") || path.endsWith(".idx")) {
        return data;
      }
      return decoder.decode(data);
    },
    async writeFile(path, data) {
      await nodeFs.writeFile(path, data);
    },
    async mkdir(path, options) {
      await nodeFs.mkdir(path, options);
    },
    async rmdir(path, options) {
      await nodeFs.rmdir(path, options);
    },
    async unlink(path) {
      await nodeFs.unlink(path);
    },
    async readdir(path) {
      const entries = await nodeFs.readdir(path);
      return entries.filter((e): e is string => typeof e === "string");
    },
    async lstat(path) {
      return await nodeFs.lstat(path);
    },
    async stat(path) {
      return await nodeFs.stat(path);
    },
    async readlink(path) {
      return await nodeFs.readlink(path);
    },
    async symlink(target, path) {
      await nodeFs.symlink(target, path, "file");
    },
    async chmod(path, mode) {
      await nodeFs.chmod(path, mode);
    },
    async chown(path, uid, gid) {
      await nodeFs.chown(path, uid, gid);
    },
    async rename(oldPath, newPath) {
      await nodeFs.rename(oldPath, newPath);
    },
    async copyFile(srcPath, destPath) {
      await nodeFs.copyFile(srcPath, destPath);
    },
    async exists(path) {
      try {
        await nodeFs.stat(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

async function createTestRepo(): Promise<void> {
  const fs = await getFs();
  await mkdir(testRepoDir, { recursive: true });
  await writeFile(`${testRepoDir}/test.txt`, "test content");
  await isomorphicGit.init({ fs, dir: testRepoDir, defaultBranch: "main" });
  const author = { name: "Test User", email: "test@example.com" };
  await isomorphicGit.add({ fs, dir: testRepoDir, filepath: "test.txt" });
  await isomorphicGit.commit({
    fs,
    dir: testRepoDir,
    message: "Initial commit",
    author,
  });
}

async function cleanupTestRepo(): Promise<void> {
  try {
    await rm(testRepoDir, { recursive: true, force: true });
  } catch {
    // Ignore
  }
}

async function _getHeadCommit(): Promise<string> {
  const fs = await getFs();
  const branches = await isomorphicGit.listBranches({ fs, dir: testRepoDir });
  return await isomorphicGit.resolveRef({
    fs,
    dir: testRepoDir,
    ref: branches[0],
  });
}

// TODO: Remove unused getHeadCommit if not needed

describe("git parsers", { concurrency: false }, () => {
  describe("gitBranch()", () => {
    it("should parse existing local branch names", async () => {
      await cleanupTestRepo();
      await createTestRepo();
      const fs = await getFs();
      const parser = gitBranch({ fs, dir: testRepoDir });
      const result = await parser.parse("main");
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "main");
      }
    });

    it("should fail for non-existent branches", async () => {
      await cleanupTestRepo();
      await createTestRepo();
      const fs = await getFs();
      const parser = gitBranch({ fs, dir: testRepoDir });
      const result = await parser.parse("nonexistent-branch");
      assert.ok(!result.success);
    });

    it("should provide branch name suggestions", async () => {
      await cleanupTestRepo();
      await createTestRepo();
      const fs = await getFs();
      await isomorphicGit.branch({ fs, dir: testRepoDir, ref: "feature" });
      const parser = gitBranch({ fs, dir: testRepoDir });
      const suggestions: Suggestion[] = [];
      for await (const s of parser.suggest!("ma")) {
        suggestions.push(s);
      }
      const literals = suggestions.filter(
        (s): s is { kind: "literal"; text: string } => s.kind === "literal",
      );
      assert.ok(literals.some((s) => s.text === "main"));
    });
  });

  describe("gitTag()", () => {
    it("should fail for non-existent tags", async () => {
      await cleanupTestRepo();
      await createTestRepo();
      const fs = await getFs();
      const parser = gitTag({ fs, dir: testRepoDir });
      const result = await parser.parse("v999.0.0");
      assert.ok(!result.success);
    });
  });

  describe("gitRemote()", () => {
    it("should fail for non-existent remotes", async () => {
      await cleanupTestRepo();
      await createTestRepo();
      const fs = await getFs();
      const parser = gitRemote({ fs, dir: testRepoDir });
      const result = await parser.parse("nonexistent");
      assert.ok(!result.success);
    });
  });

  describe("gitRemoteBranch()", () => {
    it("should fail for non-existent remotes", async () => {
      await cleanupTestRepo();
      await createTestRepo();
      const fs = await getFs();
      const parser = gitRemoteBranch("nonexistent", { fs, dir: testRepoDir });
      const result = await parser.parse("main");
      assert.ok(!result.success);
    });
  });

  describe("gitCommit()", () => {
    it("should fail for invalid commit SHAs", async () => {
      await cleanupTestRepo();
      await createTestRepo();
      const fs = await getFs();
      const parser = gitCommit({ fs, dir: testRepoDir });
      const result = await parser.parse(
        "0000000000000000000000000000000000000000",
      );
      assert.ok(!result.success);
    });

    it("should have correct metavar", async () => {
      const fs = await getFs();
      const parser = gitCommit({ fs, dir: testRepoDir });
      assert.equal(parser.metavar, "COMMIT");
    });
  });

  describe("gitRef()", () => {
    it("should parse existing branches and return OID", async () => {
      await cleanupTestRepo();
      await createTestRepo();
      const fs = await getFs();
      const parser = gitRef({ fs, dir: testRepoDir });
      const result = await parser.parse("main");
      assert.ok(result.success);
      if (result.success) {
        assert.ok(result.value.length === 40, "Should return resolved OID");
      }
    });

    it("should fail for non-existent refs", async () => {
      await cleanupTestRepo();
      await createTestRepo();
      const fs = await getFs();
      const parser = gitRef({ fs, dir: testRepoDir });
      const result = await parser.parse("nonexistent-ref");
      assert.ok(!result.success);
    });
  });

  describe("createGitParsers()", () => {
    it("should return parsers with correct types", async () => {
      await cleanupTestRepo();
      await createTestRepo();
      const fs = await getFs();
      const git = createGitParsers({ fs, dir: testRepoDir });
      assert.equal(git.branch().$mode, "async");
      assert.equal(git.tag().$mode, "async");
      assert.equal(git.remote().$mode, "async");
      assert.equal(git.remoteBranch("origin").$mode, "async");
      assert.equal(git.commit().$mode, "async");
      assert.equal(git.ref().$mode, "async");
    });

    it("should use default directory (process.cwd())", async () => {
      const fs = await getFs();
      const git = createGitParsers({ fs });
      assert.ok(git.branch());
      assert.ok(git.tag());
    });
  });

  describe("metavar", () => {
    it("should have appropriate metavar for branch parser", async () => {
      const fs = await getFs();
      const parser = gitBranch({ fs, dir: testRepoDir });
      assert.equal(parser.metavar, "BRANCH");
    });

    it("should have appropriate metavar for tag parser", async () => {
      const fs = await getFs();
      const parser = gitTag({ fs, dir: testRepoDir });
      assert.equal(parser.metavar, "TAG");
    });

    it("should have appropriate metavar for remote parser", async () => {
      const fs = await getFs();
      const parser = gitRemote({ fs, dir: testRepoDir });
      assert.equal(parser.metavar, "REMOTE");
    });

    it("should have appropriate metavar for commit parser", async () => {
      const fs = await getFs();
      const parser = gitCommit({ fs, dir: testRepoDir });
      assert.equal(parser.metavar, "COMMIT");
    });

    it("should have appropriate metavar for ref parser", async () => {
      const fs = await getFs();
      const parser = gitRef({ fs, dir: testRepoDir });
      assert.equal(parser.metavar, "REF");
    });
  });

  describe("format()", () => {
    it("should format branch names correctly", async () => {
      const fs = await getFs();
      const parser = gitBranch({ fs, dir: testRepoDir });
      assert.equal(parser.format("main"), "main");
      assert.equal(parser.format("feature/my-branch"), "feature/my-branch");
    });

    it("should format tag names correctly", async () => {
      const fs = await getFs();
      const parser = gitTag({ fs, dir: testRepoDir });
      assert.equal(parser.format("v1.0.0"), "v1.0.0");
    });

    it("should format commit SHAs correctly", async () => {
      const fs = await getFs();
      const parser = gitCommit({ fs, dir: testRepoDir });
      assert.equal(parser.format("abc123def456"), "abc123def456");
    });
  });

  describe("error messages", () => {
    it("should provide helpful error messages for invalid branches", async () => {
      const fs = await getFs();
      const parser = gitBranch({ fs, dir: testRepoDir });
      const result = await parser.parse("invalid-branch");
      assert.ok(!result.success);
      if (!result.success) {
        assert.ok(result.error);
      }
    });

    it("should provide helpful error messages for invalid tags", async () => {
      const fs = await getFs();
      const parser = gitTag({ fs, dir: testRepoDir });
      const result = await parser.parse("invalid-tag");
      assert.ok(!result.success);
      if (!result.success) {
        assert.ok(result.error);
      }
    });

    it("should provide helpful error messages for invalid commits", async () => {
      const fs = await getFs();
      const parser = gitCommit({ fs, dir: testRepoDir });
      const result = await parser.parse("not-a-sha");
      assert.ok(!result.success);
      if (!result.success) {
        assert.ok(result.error);
      }
    });
  });

  describe("custom metavar", () => {
    it("should support custom metavar for branch parser", async () => {
      const fs = await getFs();
      const parser = gitBranch({
        fs,
        dir: testRepoDir,
        metavar: "BRANCH_NAME" as NonEmptyString,
      });
      assert.equal(parser.metavar, "BRANCH_NAME");
    });

    it("should support custom metavar for tag parser", async () => {
      const fs = await getFs();
      const parser = gitTag({
        fs,
        dir: testRepoDir,
        metavar: "VERSION" as NonEmptyString,
      });
      assert.equal(parser.metavar, "VERSION");
    });
  });
});
