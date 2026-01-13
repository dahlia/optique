/**
 * Tests for @optique/git package.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import * as isomorphicGit from "isomorphic-git";
import type { Suggestion } from "@optique/core/parser";
import type { NonEmptyString } from "@optique/core/nonempty";
import { message, valueSet } from "@optique/core/message";
import {
  createGitParsers,
  gitBranch,
  gitCommit,
  gitRef,
  gitRemote,
  gitRemoteBranch,
  gitTag,
} from "./index.ts";

async function createTestRepo(): Promise<string> {
  const testRepoDir = await fs.mkdtemp(join(tmpdir(), "optique-git-test-"));
  await fs.writeFile(join(testRepoDir, "test.txt"), "test content");
  await isomorphicGit.init({ fs, dir: testRepoDir, defaultBranch: "main" });
  const author = { name: "Test User", email: "test@example.com" };
  await isomorphicGit.add({ fs, dir: testRepoDir, filepath: "test.txt" });
  await isomorphicGit.commit({
    fs,
    dir: testRepoDir,
    message: "Initial commit",
    author,
  });
  return testRepoDir;
}

async function createTestRepoWithBranchesAndTags(): Promise<string> {
  const testRepoDir = await fs.mkdtemp(join(tmpdir(), "optique-git-test-"));
  await fs.writeFile(join(testRepoDir, "test.txt"), "test content");
  await isomorphicGit.init({ fs, dir: testRepoDir, defaultBranch: "main" });
  const author = { name: "Test User", email: "test@example.com" };
  await isomorphicGit.add({ fs, dir: testRepoDir, filepath: "test.txt" });
  await isomorphicGit.commit({
    fs,
    dir: testRepoDir,
    message: "Initial commit",
    author,
  });
  await isomorphicGit.branch({ fs, dir: testRepoDir, ref: "feature/test" });
  await isomorphicGit.branch({
    fs,
    dir: testRepoDir,
    ref: "feature/my-branch-123",
  });
  await isomorphicGit.branch({ fs, dir: testRepoDir, ref: "release/1.0.x" });
  await isomorphicGit.tag({
    fs,
    dir: testRepoDir,
    ref: "v1.0.0",
    object: "HEAD",
  });
  await isomorphicGit.tag({
    fs,
    dir: testRepoDir,
    ref: "v2.0.0-beta",
    object: "HEAD",
  });
  await isomorphicGit.tag({
    fs,
    dir: testRepoDir,
    ref: "feature/test-tag",
    object: "HEAD",
  });
  return testRepoDir;
}

async function cleanupTestRepo(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

describe("git parsers", () => {
  describe("gitBranch()", () => {
    it("should parse existing local branch names", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitBranch({ dir: testRepoDir });
        const result = await parser.parse("main");
        assert.ok(result.success);
        if (result.success) {
          assert.equal(result.value, "main");
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should fail for non-existent branches", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitBranch({ dir: testRepoDir });
        const result = await parser.parse("nonexistent-branch");
        assert.ok(!result.success);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should provide branch name suggestions", async () => {
      const testRepoDir = await createTestRepo();
      try {
        await isomorphicGit.branch({ fs, dir: testRepoDir, ref: "develop" });
        const parser = gitBranch({ dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!("deve")) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.ok(
          literals.some((s) => s.text === "develop"),
          "Should suggest 'develop' for prefix 'deve'",
        );
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should parse branches with slashes", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitBranch({ dir: testRepoDir });
        const result = await parser.parse("feature/test");
        assert.ok(result.success, "Should parse branch with slash");
        if (result.success) {
          assert.equal(result.value, "feature/test");
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should parse branches with hyphens and numbers", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitBranch({ dir: testRepoDir });
        const result = await parser.parse("feature/my-branch-123");
        assert.ok(
          result.success,
          "Should parse branch with hyphens and numbers",
        );
        if (result.success) {
          assert.equal(result.value, "feature/my-branch-123");
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should parse release branches", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitBranch({ dir: testRepoDir });
        const result = await parser.parse("release/1.0.x");
        assert.ok(result.success, "Should parse release branch");
        if (result.success) {
          assert.equal(result.value, "release/1.0.x");
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should have async mode", () => {
      const parser = gitBranch({ dir: "/tmp/dummy" });
      assert.equal(parser.$mode, "async");
    });

    it("should format branch names correctly", () => {
      const parser = gitBranch({ dir: "/tmp/dummy" });
      assert.equal(parser.format("main"), "main");
      assert.equal(parser.format("feature/my-branch"), "feature/my-branch");
    });
  });

  describe("gitTag()", () => {
    it("should parse existing tag names", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitTag({ dir: testRepoDir });
        const result = await parser.parse("v1.0.0");
        assert.ok(result.success);
        if (result.success) {
          assert.equal(result.value, "v1.0.0");
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should fail for non-existent tags", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitTag({ dir: testRepoDir });
        const result = await parser.parse("v999.0.0");
        assert.ok(!result.success);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should parse tags with prerelease versions", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitTag({ dir: testRepoDir });
        const result = await parser.parse("v2.0.0-beta");
        assert.ok(result.success, "Should parse tag with prerelease");
        if (result.success) {
          assert.equal(result.value, "v2.0.0-beta");
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should parse tags with slashes", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitTag({ dir: testRepoDir });
        const result = await parser.parse("feature/test-tag");
        assert.ok(result.success, "Should parse tag with slash");
        if (result.success) {
          assert.equal(result.value, "feature/test-tag");
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should provide tag suggestions", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitTag({ dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!("v1")) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.ok(
          literals.some((s) => s.text === "v1.0.0"),
          "Should suggest v1.0.0 for prefix v1",
        );
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should have async mode", () => {
      const parser = gitTag({ dir: "/tmp/dummy" });
      assert.equal(parser.$mode, "async");
    });

    it("should format tag names correctly", () => {
      const parser = gitTag({ dir: "/tmp/dummy" });
      assert.equal(parser.format("v1.0.0"), "v1.0.0");
    });
  });

  describe("gitRemote()", () => {
    it("should fail for non-existent remotes", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitRemote({ dir: testRepoDir });
        const result = await parser.parse("nonexistent");
        assert.ok(!result.success);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should have async mode", () => {
      const parser = gitRemote({ dir: "/tmp/dummy" });
      assert.equal(parser.$mode, "async");
    });
  });

  describe("gitRemoteBranch()", () => {
    it("should fail for non-existent remotes", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitRemoteBranch("nonexistent", { dir: testRepoDir });
        const result = await parser.parse("main");
        assert.ok(!result.success);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should have async mode", () => {
      const parser = gitRemoteBranch("origin", { dir: "/tmp/dummy" });
      assert.equal(parser.$mode, "async");
    });
  });

  describe("gitCommit()", () => {
    it("should fail for invalid commit SHAs", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitCommit({ dir: testRepoDir });
        const result = await parser.parse(
          "0000000000000000000000000000000000000000",
        );
        assert.ok(!result.success);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should fail for malformed commit SHAs", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitCommit({ dir: testRepoDir });
        const result = await parser.parse("not-a-sha-at-all");
        assert.ok(!result.success);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should fail for too-short commit SHAs", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitCommit({ dir: testRepoDir });
        const result = await parser.parse("abc");
        assert.ok(!result.success);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should have correct metavar", () => {
      const parser = gitCommit({ dir: "/tmp/dummy" });
      assert.equal(parser.metavar, "COMMIT");
    });

    it("should have async mode", () => {
      const parser = gitCommit({ dir: "/tmp/dummy" });
      assert.equal(parser.$mode, "async");
    });

    it("should format commit SHAs correctly", () => {
      const parser = gitCommit({ dir: "/tmp/dummy" });
      assert.equal(parser.format("abc123def456789"), "abc123def456789");
    });

    it("should provide commit SHA suggestions", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitCommit({ dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!("")) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.ok(
          literals.length > 0,
          "Should suggest recent commits",
        );
        assert.ok(
          literals[0].text.length === 7,
          "Should suggest short (7-char) commit SHAs",
        );
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });
  });

  describe("gitRef()", () => {
    it("should parse existing branches and return OID", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitRef({ dir: testRepoDir });
        const result = await parser.parse("main");
        assert.ok(result.success);
        if (result.success) {
          assert.ok(result.value.length === 40, "Should return resolved OID");
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should fail for non-existent refs", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitRef({ dir: testRepoDir });
        const result = await parser.parse("nonexistent-ref");
        assert.ok(!result.success);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should parse existing tags and return OID", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitRef({ dir: testRepoDir });
        const result = await parser.parse("v1.0.0");
        assert.ok(result.success, "Should parse existing tag");
        if (result.success) {
          assert.ok(result.value.length === 40, "Should return resolved OID");
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should have async mode", () => {
      const parser = gitRef({ dir: "/tmp/dummy" });
      assert.equal(parser.$mode, "async");
    });

    it("should format ref values correctly", () => {
      const parser = gitRef({ dir: "/tmp/dummy" });
      assert.equal(parser.format("abc123def456"), "abc123def456");
    });
  });

  describe("createGitParsers()", () => {
    it("should return parsers with correct types", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const git = createGitParsers({ dir: testRepoDir });
        assert.equal(git.branch().$mode, "async");
        assert.equal(git.tag().$mode, "async");
        assert.equal(git.remote().$mode, "async");
        assert.equal(git.remoteBranch("origin").$mode, "async");
        assert.equal(git.commit().$mode, "async");
        assert.equal(git.ref().$mode, "async");
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should allow overriding options per parser", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const git = createGitParsers({ dir: testRepoDir });
        const parser = git.branch({
          metavar: "CUSTOM_BRANCH" as NonEmptyString,
        });
        assert.equal(parser.metavar, "CUSTOM_BRANCH");
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should merge per-parser options with factory options", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const git = createGitParsers({ dir: testRepoDir });
        // Per-parser metavar should override, but factory dir should be preserved
        const parser = git.branch({
          metavar: "CUSTOM_BRANCH" as NonEmptyString,
        });
        assert.equal(parser.metavar, "CUSTOM_BRANCH");
        // Verify the parser still works (uses factory dir)
        const result = await parser.parse("main");
        assert.ok(result.success);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });
  });

  describe("metavar", () => {
    it("should have appropriate metavar for branch parser", () => {
      const parser = gitBranch({ dir: "/tmp/dummy" });
      assert.equal(parser.metavar, "BRANCH");
    });

    it("should have appropriate metavar for tag parser", () => {
      const parser = gitTag({ dir: "/tmp/dummy" });
      assert.equal(parser.metavar, "TAG");
    });

    it("should have appropriate metavar for remote parser", () => {
      const parser = gitRemote({ dir: "/tmp/dummy" });
      assert.equal(parser.metavar, "REMOTE");
    });

    it("should have appropriate metavar for commit parser", () => {
      const parser = gitCommit({ dir: "/tmp/dummy" });
      assert.equal(parser.metavar, "COMMIT");
    });

    it("should have appropriate metavar for ref parser", () => {
      const parser = gitRef({ dir: "/tmp/dummy" });
      assert.equal(parser.metavar, "REF");
    });
  });

  describe("format()", () => {
    it("should format branch names correctly", () => {
      const parser = gitBranch({ dir: "/tmp/dummy" });
      assert.equal(parser.format("main"), "main");
      assert.equal(parser.format("feature/my-branch"), "feature/my-branch");
    });

    it("should format tag names correctly", () => {
      const parser = gitTag({ dir: "/tmp/dummy" });
      assert.equal(parser.format("v1.0.0"), "v1.0.0");
    });

    it("should format commit SHAs correctly", () => {
      const parser = gitCommit({ dir: "/tmp/dummy" });
      assert.equal(parser.format("abc123def456"), "abc123def456");
    });
  });

  describe("error messages", () => {
    it("should provide helpful error messages for invalid branches", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitBranch({ dir: testRepoDir });
        const result = await parser.parse("invalid-branch");
        assert.ok(!result.success);
        if (!result.success) {
          assert.ok(result.error);
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should provide helpful error messages for invalid tags", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitTag({ dir: testRepoDir });
        const result = await parser.parse("invalid-tag");
        assert.ok(!result.success);
        if (!result.success) {
          assert.ok(result.error);
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should provide helpful error messages for invalid commits", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitCommit({ dir: testRepoDir });
        const result = await parser.parse("not-a-sha");
        assert.ok(!result.success);
        if (!result.success) {
          assert.ok(result.error);
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should provide helpful error messages for invalid refs", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitRef({ dir: testRepoDir });
        const result = await parser.parse("nonexistent-ref");
        assert.ok(!result.success);
        if (!result.success) {
          assert.ok(result.error);
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });
  });

  describe("custom metavar", () => {
    it("should support custom metavar for branch parser", () => {
      const parser = gitBranch({
        dir: "/tmp/dummy",
        metavar: "BRANCH_NAME" as NonEmptyString,
      });
      assert.equal(parser.metavar, "BRANCH_NAME");
    });

    it("should support custom metavar for tag parser", () => {
      const parser = gitTag({
        dir: "/tmp/dummy",
        metavar: "VERSION" as NonEmptyString,
      });
      assert.equal(parser.metavar, "VERSION");
    });

    it("should support custom metavar for commit parser", () => {
      const parser = gitCommit({
        dir: "/tmp/dummy",
        metavar: "SHA" as NonEmptyString,
      });
      assert.equal(parser.metavar, "SHA");
    });

    it("should support custom metavar for remote parser", () => {
      const parser = gitRemote({
        dir: "/tmp/dummy",
        metavar: "REMOTE_NAME" as NonEmptyString,
      });
      assert.equal(parser.metavar, "REMOTE_NAME");
    });

    it("should support custom metavar for ref parser", () => {
      const parser = gitRef({
        dir: "/tmp/dummy",
        metavar: "GIT_REF" as NonEmptyString,
      });
      assert.equal(parser.metavar, "GIT_REF");
    });
  });

  describe("suggestions", () => {
    it("should filter suggestions by prefix", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitBranch({ dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!("feature/")) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.ok(
          literals.some((s) => s.text === "feature/test"),
          "Should suggest feature/test for prefix feature/",
        );
        assert.ok(
          literals.some((s) => s.text === "feature/my-branch-123"),
          "Should suggest feature/my-branch-123 for prefix feature/",
        );
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should return empty suggestions for non-matching prefix", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitBranch({ dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!("nonexistent/")) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.equal(
          literals.length,
          0,
          "Should return no suggestions for non-matching prefix",
        );
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should suggest tags with prefix matching", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitTag({ dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!("v2")) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.ok(
          literals.some((s) => s.text === "v2.0.0-beta"),
          "Should suggest v2.0.0-beta for prefix v2",
        );
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should suggest both branches and tags for gitRef", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitRef({ dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!("v1")) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.ok(
          literals.some((s) => s.text === "v1.0.0"),
          "Should suggest v1.0.0 tag",
        );
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should suggest commits for gitRef", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitRef({ dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!("")) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        // Should have at least the main branch and a commit
        assert.ok(
          literals.some((s) => s.text === "main"),
          "Should suggest main branch",
        );
        assert.ok(
          literals.some((s) => s.text.length === 7),
          "Should suggest short commit SHAs",
        );
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });
  });

  describe("non-existent directory", () => {
    const missingDir = "/nonexistent/path/to/repo";

    it("should handle non-existent repository directory", async () => {
      const parser = gitBranch({ dir: missingDir });
      const result = await parser.parse("main");
      assert.ok(!result.success, "Should fail for non-existent directory");
      if (!result.success) {
        assert.ok(result.error);
      }
    });

    it("should handle non-existent directory for gitTag", async () => {
      const parser = gitTag({ dir: missingDir });
      const result = await parser.parse("v1.0.0");
      assert.ok(!result.success, "Should fail for non-existent directory");
    });

    it("should handle non-existent directory for gitCommit", async () => {
      const parser = gitCommit({ dir: missingDir });
      const result = await parser.parse("abc123");
      assert.ok(!result.success, "Should fail for non-existent directory");
    });

    it("should handle non-existent directory for gitRef", async () => {
      const parser = gitRef({ dir: missingDir });
      const result = await parser.parse("main");
      assert.ok(!result.success, "Should fail for non-existent directory");
    });
  });

  describe("edge cases", () => {
    it("should handle empty prefix for existing branches", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitBranch({ dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!("")) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.ok(
          literals.length > 0,
          "Should suggest existing branches for empty prefix",
        );
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should return no suggestions for tags when no matching tags exist", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitTag({ dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!("nonexistent-tag")) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.ok(
          literals.length === 0,
          "Should return no suggestions for non-matching prefix",
        );
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should handle special characters in branch names", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const branchName = "feature/test_feature-v2";
        await isomorphicGit.branch({ fs, dir: testRepoDir, ref: branchName });
        const parser = gitBranch({ dir: testRepoDir });
        const result = await parser.parse(branchName);
        assert.ok(
          result.success,
          "Should parse branch with special characters",
        );
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should handle case-sensitive branch names", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitBranch({ dir: testRepoDir });
        const result = await parser.parse("Main");
        assert.ok(
          !result.success,
          "Should fail for case-mismatched branch name",
        );
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });
  });

  describe("reusability", () => {
    it("should produce consistent results when reusing parser", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitBranch({ dir: testRepoDir });
        const result1 = await parser.parse("main");
        const result2 = await parser.parse("main");
        assert.ok(result1.success);
        assert.ok(result2.success);
        if (result1.success && result2.success) {
          assert.equal(result1.value, result2.value);
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should not accumulate state across parse calls", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitBranch({ dir: testRepoDir });
        const result1 = await parser.parse("main");
        const result2 = await parser.parse("main");
        assert.ok(result1.success);
        assert.ok(result2.success);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });
  });

  describe("custom errors", () => {
    it("should use custom notFound error for gitBranch", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitBranch({
          dir: testRepoDir,
          errors: {
            notFound: (input, available) =>
              message`Custom error: ${input} not found. Try: ${
                available ? valueSet(available) : "none"
              }`,
          },
        });
        const result = await parser.parse("nonexistent");
        assert.ok(!result.success, "Should fail for nonexistent branch");
        assert.ok(result.error != null, "Should have custom error message");
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should use custom listFailed error for gitBranch", async () => {
      const parser = gitBranch({
        dir: "/nonexistent/path",
        errors: {
          listFailed: (dir) => message`Cannot read git repository at ${dir}`,
        },
      });
      const result = await parser.parse("main");
      assert.ok(!result.success, "Should fail for nonexistent path");
      assert.ok(result.error != null, "Should have custom error message");
    });

    it("should use custom notFound error for gitTag", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitTag({
          dir: testRepoDir,
          errors: {
            notFound: (input) => message`Tag ${input} does not exist`,
          },
        });
        const result = await parser.parse("v999.0.0");
        assert.ok(!result.success, "Should fail for nonexistent tag");
        assert.ok(result.error != null, "Should have custom error message");
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should use custom notFound error for gitRemote", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitRemote({
          dir: testRepoDir,
          errors: {
            notFound: (input) => message`Remote ${input} is not configured`,
          },
        });
        const result = await parser.parse("nonexistent");
        assert.ok(!result.success, "Should fail for nonexistent remote");
        assert.ok(result.error != null, "Should have custom error message");
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should use custom invalidFormat error for gitCommit", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitCommit({
          dir: testRepoDir,
          errors: {
            invalidFormat: (input) =>
              message`${input} is not a valid commit identifier`,
          },
        });
        const result = await parser.parse("abc");
        assert.ok(!result.success, "Should fail for invalid SHA format");
        assert.ok(result.error != null, "Should have custom error message");
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should use custom notFound error for gitCommit", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitCommit({
          dir: testRepoDir,
          errors: {
            notFound: (input) => message`Commit ${input} not found in history`,
          },
        });
        const result = await parser.parse(
          "0000000000000000000000000000000000000000",
        );
        assert.ok(!result.success, "Should fail for nonexistent commit");
        assert.ok(result.error != null, "Should have custom error message");
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should use custom notFound error for gitRef", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitRef({
          dir: testRepoDir,
          errors: {
            notFound: (input) => message`${input} is not a valid reference`,
          },
        });
        const result = await parser.parse("nonexistent-ref");
        assert.ok(!result.success, "Should fail for nonexistent reference");
        assert.ok(result.error != null, "Should have custom error message");
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should use custom notFound error for gitRemoteBranch", async () => {
      const testRepoDir = await createTestRepo();
      try {
        await isomorphicGit.addRemote({
          fs,
          dir: testRepoDir,
          remote: "origin",
          url: "https://github.com/example/repo.git",
        });
        const parser = gitRemoteBranch("origin", {
          dir: testRepoDir,
          errors: {
            notFound: (input, available) =>
              message`Branch ${input} not found on origin. Available: ${
                available ? valueSet(available) : "none"
              }`,
          },
        });
        const result = await parser.parse("nonexistent-branch");
        assert.ok(!result.success, "Should fail for nonexistent remote branch");
        assert.ok(result.error != null, "Should have custom error message");
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });
  });
});
