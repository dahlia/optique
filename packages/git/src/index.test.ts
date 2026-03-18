/**
 * Tests for @optique/git package.
 */
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import * as isomorphicGit from "isomorphic-git";
import type { Suggestion } from "@optique/core/parser";
import type { NonEmptyString } from "@optique/core/nonempty";
import { formatMessage, message, valueSet } from "@optique/core/message";
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

function createTestRepoWithAmbiguousPrefix(): Promise<{
  readonly dir: string;
  readonly prefix: string;
}> {
  return createTestRepoWithAmbiguousPrefixLength(2);
}

async function createTestRepoWithAmbiguousPrefixLength(
  prefixLength: number,
): Promise<{
  readonly dir: string;
  readonly prefix: string;
}> {
  const dir = await fs.mkdtemp(join(tmpdir(), "optique-git-ambiguous-test-"));
  await fs.writeFile(join(dir, "test.txt"), "seed");
  await isomorphicGit.init({ fs, dir, defaultBranch: "main" });
  const author = { name: "Test User", email: "test@example.com" };

  const seen = new Set<string>();
  for (let i = 0; i < 5000; i++) {
    await fs.writeFile(join(dir, "test.txt"), `${i}-${Math.random()}`);
    await isomorphicGit.add({ fs, dir, filepath: "test.txt" });
    const oid = await isomorphicGit.commit({
      fs,
      dir,
      message: `Commit ${i}`,
      author,
    });
    const prefix = oid.slice(0, prefixLength);
    if (seen.has(prefix)) {
      return { dir, prefix };
    }
    seen.add(prefix);
  }

  throw new Error(
    `Failed to create ambiguous commit prefix of length ${prefixLength}.`,
  );
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

    it("should resolve repository dir from process.cwd() when dir is omitted", async () => {
      const testRepoDir = await createTestRepo();
      const originalCwd = process.cwd();
      try {
        process.chdir(testRepoDir);
        const parser = gitBranch();
        const result = await parser.parse("main");
        assert.ok(result.success);
      } finally {
        process.chdir(originalCwd);
        await cleanupTestRepo(testRepoDir);
      }
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
    it("should parse existing remotes", async () => {
      const testRepoDir = await createTestRepo();
      try {
        await isomorphicGit.addRemote({
          fs,
          dir: testRepoDir,
          remote: "origin",
          url: "https://example.com/repo.git",
          force: true,
        });
        const parser = gitRemote({ dir: testRepoDir });
        const result = await parser.parse("origin");
        assert.ok(result.success);
        if (result.success) {
          assert.equal(result.value, "origin");
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should provide remote suggestions", async () => {
      const testRepoDir = await createTestRepo();
      try {
        await isomorphicGit.addRemote({
          fs,
          dir: testRepoDir,
          remote: "origin",
          url: "https://example.com/repo.git",
          force: true,
        });
        const parser = gitRemote({ dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!("or")) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.ok(literals.some((s) => s.text === "origin"));
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

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
    it("should parse existing remote branch names", async () => {
      const testRepoDir = await createTestRepo();
      try {
        await isomorphicGit.addRemote({
          fs,
          dir: testRepoDir,
          remote: "origin",
          url: "https://example.com/repo.git",
          force: true,
        });
        const head = await isomorphicGit.resolveRef({
          fs,
          dir: testRepoDir,
          ref: "HEAD",
        });
        await fs.mkdir(join(testRepoDir, ".git", "refs", "remotes", "origin"), {
          recursive: true,
        });
        await fs.writeFile(
          join(testRepoDir, ".git", "refs", "remotes", "origin", "main"),
          `${head}\n`,
        );

        const parser = gitRemoteBranch("origin", { dir: testRepoDir });
        const result = await parser.parse("main");
        assert.ok(result.success);
        if (result.success) {
          assert.equal(result.value, "main");
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should suggest existing remote branch names", async () => {
      const testRepoDir = await createTestRepo();
      try {
        await isomorphicGit.addRemote({
          fs,
          dir: testRepoDir,
          remote: "origin",
          url: "https://example.com/repo.git",
          force: true,
        });
        const head = await isomorphicGit.resolveRef({
          fs,
          dir: testRepoDir,
          ref: "HEAD",
        });
        await fs.mkdir(join(testRepoDir, ".git", "refs", "remotes", "origin"), {
          recursive: true,
        });
        await fs.writeFile(
          join(testRepoDir, ".git", "refs", "remotes", "origin", "main"),
          `${head}\n`,
        );

        const parser = gitRemoteBranch("origin", { dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!("ma")) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.ok(literals.some((s) => s.text === "main"));
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should report missing remote when remote does not exist", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitRemoteBranch("nonexistent", { dir: testRepoDir });
        const result = await parser.parse("main");
        assert.ok(!result.success);
        if (!result.success) {
          const msg = formatMessage(result.error);
          assert.match(msg, /remote/i);
          assert.match(msg, /nonexistent/);
          assert.ok(
            !msg.includes("Remote branch"),
            "Should not say 'Remote branch' when the remote itself is missing",
          );
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should report missing branch when remote exists but branch does not", async () => {
      const testRepoDir = await createTestRepo();
      try {
        await isomorphicGit.addRemote({
          fs,
          dir: testRepoDir,
          remote: "origin",
          url: "https://example.com/repo.git",
          force: true,
        });

        const parser = gitRemoteBranch("origin", { dir: testRepoDir });
        const result = await parser.parse("nonexistent");
        assert.ok(!result.success);
        if (!result.success) {
          const msg = formatMessage(result.error);
          assert.match(msg, /Remote branch/);
          assert.match(msg, /nonexistent/);
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should have async mode", () => {
      const parser = gitRemoteBranch("origin", { dir: "/tmp/dummy" });
      assert.equal(parser.$mode, "async");
    });

    it("should return no suggestions on invalid repository", async () => {
      const parser = gitRemoteBranch("origin", {
        dir: "/nonexistent/path/to/repo",
      });
      const suggestions: Suggestion[] = [];
      for await (const s of parser.suggest!("ma")) {
        suggestions.push(s);
      }
      assert.deepEqual(suggestions, []);
    });
  });

  describe("gitCommit()", () => {
    it("should parse existing abbreviated commit SHAs", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const head = await isomorphicGit.resolveRef({
          fs,
          dir: testRepoDir,
          ref: "HEAD",
        });
        const parser = gitCommit({ dir: testRepoDir });
        const result = await parser.parse(head.slice(0, 7));
        assert.ok(result.success);
        if (result.success) {
          assert.equal(result.value, head);
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

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

    it("should suggest commit OIDs at least as long as the prefix", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const oid = await isomorphicGit.resolveRef({
          fs,
          dir: testRepoDir,
          ref: "main",
        });
        const longPrefix = oid.slice(0, 10);
        const parser = gitCommit({ dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!(longPrefix)) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.ok(literals.length > 0, "Should suggest at least one commit");
        for (const s of literals) {
          assert.ok(
            s.text.length >= longPrefix.length,
            `Suggestion '${s.text}' should be at least as long as ` +
              `prefix '${longPrefix}'`,
          );
          assert.ok(
            s.text.startsWith(longPrefix),
            `Suggestion '${s.text}' should start with prefix '${longPrefix}'`,
          );
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should suggest only unique and parseable commit SHAs", async () => {
      const { dir, prefix } = await createTestRepoWithAmbiguousPrefixLength(4);
      try {
        const parser = gitCommit({ dir, suggestionDepth: 5000 });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!(prefix)) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.ok(
          literals.length >= 2,
          `Should have at least 2 suggestions sharing prefix '${prefix}', ` +
            `got ${literals.length}`,
        );
        const texts = literals.map((s) => s.text);
        const unique = new Set(texts);
        assert.equal(
          unique.size,
          texts.length,
          `Suggestions should be unique, got: ${JSON.stringify(texts)}`,
        );
        for (const s of literals) {
          const result = await parser.parse(s.text);
          assert.ok(
            result.success,
            `Suggestion '${s.text}' should be parseable`,
          );
        }
      } finally {
        await cleanupTestRepo(dir);
      }
    });

    it("should report ambiguous abbreviated commit SHAs", async () => {
      const { dir, prefix } = await createTestRepoWithAmbiguousPrefixLength(4);
      try {
        const parser = gitCommit({ dir });
        const result = await parser.parse(prefix);
        assert.ok(!result.success);
        if (!result.success) {
          assert.match(formatMessage(result.error), /ambiguous/i);
        }
      } finally {
        await cleanupTestRepo(dir);
      }
    });
  });

  describe("gitRef()", () => {
    it("should parse abbreviated commit SHAs as refs", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const head = await isomorphicGit.resolveRef({
          fs,
          dir: testRepoDir,
          ref: "HEAD",
        });
        const parser = gitRef({ dir: testRepoDir });
        const result = await parser.parse(head.slice(0, 7));
        assert.ok(result.success);
        if (result.success) {
          assert.equal(result.value, head);
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

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

    it("should report ambiguous abbreviated refs", async () => {
      const { dir, prefix } = await createTestRepoWithAmbiguousPrefix();
      try {
        const parser = gitRef({ dir });
        const result = await parser.parse(prefix);
        assert.ok(!result.success);
        if (!result.success) {
          assert.match(formatMessage(result.error), /ambiguous/i);
        }
      } finally {
        await cleanupTestRepo(dir);
      }
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

    it("should not suggest duplicates when branch and tag share a name", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const oid = await isomorphicGit.resolveRef({
          fs,
          dir: testRepoDir,
          ref: "main",
        });
        await isomorphicGit.tag({
          fs,
          dir: testRepoDir,
          ref: "main",
          object: oid,
        });

        const parser = gitRef({ dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!("mai")) {
          suggestions.push(s);
        }
        const mainSuggestions = suggestions.filter(
          (s) => s.kind === "literal" && s.text === "main",
        );
        assert.equal(
          mainSuggestions.length,
          1,
          "Should suggest 'main' only once",
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

    it("should suggest commit OIDs at least as long as the prefix", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const oid = await isomorphicGit.resolveRef({
          fs,
          dir: testRepoDir,
          ref: "main",
        });
        // Use a prefix longer than 7 characters
        const longPrefix = oid.slice(0, 10);
        const parser = gitRef({ dir: testRepoDir });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!(longPrefix)) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.ok(
          literals.length > 0,
          "Should suggest at least one commit",
        );
        for (const s of literals) {
          assert.ok(
            s.text.length >= longPrefix.length,
            `Suggestion '${s.text}' should be at least as long as prefix '${longPrefix}'`,
          );
          assert.ok(
            s.text.startsWith(longPrefix),
            `Suggestion '${s.text}' should start with prefix '${longPrefix}'`,
          );
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should suggest only unique and parseable commit SHAs", async () => {
      const { dir, prefix } = await createTestRepoWithAmbiguousPrefixLength(4);
      try {
        const parser = gitRef({ dir, suggestionDepth: 5000 });
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!(prefix)) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        // Filter to only commit SHA suggestions (not branches/tags)
        const commitSuggestions = literals.filter(
          (s) => /^[0-9a-f]+$/i.test(s.text),
        );
        assert.ok(
          commitSuggestions.length >= 2,
          `Should have at least 2 commit suggestions sharing prefix ` +
            `'${prefix}', got ${commitSuggestions.length}`,
        );
        const texts = commitSuggestions.map((s) => s.text);
        const unique = new Set(texts);
        assert.equal(
          unique.size,
          texts.length,
          `Suggestions should be unique, got: ${JSON.stringify(texts)}`,
        );
        for (const s of commitSuggestions) {
          const result = await parser.parse(s.text);
          assert.ok(
            result.success,
            `Suggestion '${s.text}' should be parseable`,
          );
        }
      } finally {
        await cleanupTestRepo(dir);
      }
    });

    it("should not yield commits when prefix is non-hex", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitRef({ dir: testRepoDir });
        // "main" is not a valid hex prefix, so no commit OIDs can match;
        // only the "main" branch should be suggested.
        const suggestions: Suggestion[] = [];
        for await (const s of parser.suggest!("main")) {
          suggestions.push(s);
        }
        const literals = suggestions.filter(
          (s): s is { kind: "literal"; text: string } => s.kind === "literal",
        );
        assert.equal(literals.length, 1, "Should only suggest 'main' branch");
        assert.equal(literals[0].text, "main");
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

    it("should return empty remote suggestions for missing directory", async () => {
      const parser = gitRemote({ dir: missingDir });
      const suggestions: Suggestion[] = [];
      for await (const s of parser.suggest!("or")) {
        suggestions.push(s);
      }
      assert.deepEqual(suggestions, []);
    });

    it("should return empty commit suggestions for missing directory", async () => {
      const parser = gitCommit({ dir: missingDir });
      const suggestions: Suggestion[] = [];
      for await (const s of parser.suggest!("a")) {
        suggestions.push(s);
      }
      assert.deepEqual(suggestions, []);
    });

    it("should return empty ref suggestions for missing directory", async () => {
      const parser = gitRef({ dir: missingDir });
      const suggestions: Suggestion[] = [];
      for await (const s of parser.suggest!("m")) {
        suggestions.push(s);
      }
      assert.deepEqual(suggestions, []);
    });

    it("should return empty branch suggestions for missing directory", async () => {
      const parser = gitBranch({ dir: missingDir });
      const suggestions: Suggestion[] = [];
      for await (const s of parser.suggest!("m")) {
        suggestions.push(s);
      }
      assert.deepEqual(suggestions, []);
    });

    it("should return empty tag suggestions for missing directory", async () => {
      const parser = gitTag({ dir: missingDir });
      const suggestions: Suggestion[] = [];
      for await (const s of parser.suggest!("v")) {
        suggestions.push(s);
      }
      assert.deepEqual(suggestions, []);
    });

    it("should fail to parse remote in non-existent directory", async () => {
      const parser = gitRemote({ dir: missingDir });
      const result = await parser.parse("origin");
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

    it("should use custom remoteNotFound error for gitRemoteBranch", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const parser = gitRemoteBranch("nonexistent", {
          dir: testRepoDir,
          errors: {
            remoteNotFound: (remote, availableRemotes) =>
              message`No such remote ${remote}. Try: ${
                valueSet(availableRemotes)
              }`,
          },
        });
        const result = await parser.parse("main");
        assert.ok(!result.success, "Should fail for nonexistent remote");
        if (!result.success) {
          const msg = formatMessage(result.error);
          assert.match(msg, /No such remote/);
          assert.match(msg, /nonexistent/);
        }
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });
  });

  describe("error branch coverage", () => {
    it("should fail when process.cwd() is unavailable and dir is omitted", async () => {
      const parser = gitBranch();
      const processLike = process as unknown as {
        cwd: (() => string) | undefined;
      };
      const originalCwd = processLike.cwd;
      try {
        processLike.cwd = undefined;
        await assert.rejects(
          async () => await parser.parse("main"),
          /requires a `dir` option/,
        );
      } finally {
        processLike.cwd = originalCwd;
      }
    });

    it("should report ambiguous short SHA for commit and ref parsers", async () => {
      const testRepoDir = await createTestRepo();
      try {
        const author = { name: "Test User", email: "test@example.com" };
        const seen = new Map<string, string>();
        let ambiguousPrefix: string | undefined;

        for (let i = 0; i < 1200; i++) {
          await fs.writeFile(join(testRepoDir, "test.txt"), `content-${i}`);
          await isomorphicGit.add({
            fs,
            dir: testRepoDir,
            filepath: "test.txt",
          });
          await isomorphicGit.commit({
            fs,
            dir: testRepoDir,
            message: `commit ${i}`,
            author,
          });
          const oid = await isomorphicGit.resolveRef({
            fs,
            dir: testRepoDir,
            ref: "HEAD",
          });
          const prefix = oid.slice(0, 4);
          const prev = seen.get(prefix);
          if (prev != null && prev !== oid) {
            ambiguousPrefix = prefix;
            break;
          }
          seen.set(prefix, oid);
        }

        assert.ok(
          ambiguousPrefix != null,
          "Failed to find an ambiguous 4-char commit prefix.",
        );
        const prefix = ambiguousPrefix!;

        const commitResult = await gitCommit({ dir: testRepoDir }).parse(
          prefix,
        );
        assert.ok(!commitResult.success);

        const refResult = await gitRef({ dir: testRepoDir }).parse(prefix);
        assert.ok(!refResult.success);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should execute parse catch fallback when notFound callback throws", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const throwingNotFound = () => {
          throw new Error("forced notFound callback failure");
        };

        const branchResult = await gitBranch({
          dir: testRepoDir,
          errors: { notFound: throwingNotFound },
        }).parse("missing-branch");
        assert.ok(!branchResult.success);

        const remoteBranchResult = await gitRemoteBranch("origin", {
          dir: testRepoDir,
          errors: { notFound: throwingNotFound },
        }).parse("missing-remote-branch");
        assert.ok(!remoteBranchResult.success);

        const tagResult = await gitTag({
          dir: testRepoDir,
          errors: { notFound: throwingNotFound },
        }).parse("missing-tag");
        assert.ok(!tagResult.success);

        const remoteResult = await gitRemote({
          dir: testRepoDir,
          errors: { notFound: throwingNotFound },
        }).parse("missing-remote");
        assert.ok(!remoteResult.success);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should execute parse catch custom listFailed path when callback throws", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const parser = gitBranch({
          dir: testRepoDir,
          errors: {
            notFound: () => {
              throw new Error("forced branch notFound throw");
            },
            listFailed: (dir) => message`custom list failed: ${dir}`,
          },
        });
        const result = await parser.parse("missing-branch");
        assert.ok(!result.success);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should execute suggest catch branches with non-string prefix values", async () => {
      const testRepoDir = await createTestRepoWithBranchesAndTags();
      try {
        const badPrefix = Symbol("bad-prefix") as unknown as string;

        const branchSuggestions: Suggestion[] = [];
        for await (
          const s of gitBranch({ dir: testRepoDir }).suggest!(badPrefix)
        ) {
          branchSuggestions.push(s);
        }
        assert.deepEqual(branchSuggestions, []);

        const remoteBranchSuggestions: Suggestion[] = [];
        for await (
          const s of gitRemoteBranch("origin", { dir: testRepoDir }).suggest!(
            badPrefix,
          )
        ) {
          remoteBranchSuggestions.push(s);
        }
        assert.deepEqual(remoteBranchSuggestions, []);

        const tagSuggestions: Suggestion[] = [];
        for await (
          const s of gitTag({ dir: testRepoDir }).suggest!(badPrefix)
        ) {
          tagSuggestions.push(s);
        }
        assert.deepEqual(tagSuggestions, []);

        const remoteSuggestions: Suggestion[] = [];
        for await (
          const s of gitRemote({ dir: testRepoDir }).suggest!(badPrefix)
        ) {
          remoteSuggestions.push(s);
        }
        assert.deepEqual(remoteSuggestions, []);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should hit suggest catch logging for invalid non-directory paths", async () => {
      const baseDir = await fs.mkdtemp(join(tmpdir(), "optique-git-suggest-"));
      const filePath = join(baseDir, "not-a-dir");
      await fs.writeFile(filePath, "x");
      try {
        const remoteBranchSuggestions: Suggestion[] = [];
        for await (
          const s of gitRemoteBranch("origin", { dir: filePath }).suggest!("ma")
        ) {
          remoteBranchSuggestions.push(s);
        }
        assert.deepEqual(remoteBranchSuggestions, []);

        const tagSuggestions: Suggestion[] = [];
        for await (const s of gitTag({ dir: filePath }).suggest!("v")) {
          tagSuggestions.push(s);
        }
        assert.deepEqual(tagSuggestions, []);

        const remoteSuggestions: Suggestion[] = [];
        for await (const s of gitRemote({ dir: filePath }).suggest!("or")) {
          remoteSuggestions.push(s);
        }
        assert.deepEqual(remoteSuggestions, []);
      } finally {
        await cleanupTestRepo(baseDir);
      }
    });

    it("should hit listFailed not-a-repository branch for existing non-git directory", async () => {
      const nonGitDir = await fs.mkdtemp(
        join(tmpdir(), "optique-git-nonrepo-"),
      );
      try {
        const result = await gitBranch({ dir: nonGitDir }).parse("main");
        assert.ok(!result.success);
      } finally {
        await cleanupTestRepo(nonGitDir);
      }
    });

    it("should hit remoteBranch suggest catch when prefix type is invalid", async () => {
      const testRepoDir = await createTestRepo();
      try {
        await isomorphicGit.addRemote({
          fs,
          dir: testRepoDir,
          remote: "origin",
          url: "https://example.com/repo.git",
          force: true,
        });
        const head = await isomorphicGit.resolveRef({
          fs,
          dir: testRepoDir,
          ref: "HEAD",
        });
        await fs.mkdir(join(testRepoDir, ".git", "refs", "remotes", "origin"), {
          recursive: true,
        });
        await fs.writeFile(
          join(testRepoDir, ".git", "refs", "remotes", "origin", "main"),
          `${head}\n`,
        );

        const badPrefix = Symbol("bad-prefix") as unknown as string;
        const suggestions: Suggestion[] = [];
        for await (
          const s of gitRemoteBranch("origin", { dir: testRepoDir }).suggest!(
            badPrefix,
          )
        ) {
          suggestions.push(s);
        }
        assert.deepEqual(suggestions, []);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });

    it("should hit remote suggest catch when prefix type is invalid", async () => {
      const testRepoDir = await createTestRepo();
      try {
        await isomorphicGit.addRemote({
          fs,
          dir: testRepoDir,
          remote: "origin",
          url: "https://example.com/repo.git",
          force: true,
        });

        const badPrefix = Symbol("bad-prefix") as unknown as string;
        const suggestions: Suggestion[] = [];
        for await (
          const s of gitRemote({ dir: testRepoDir }).suggest!(badPrefix)
        ) {
          suggestions.push(s);
        }
        assert.deepEqual(suggestions, []);
      } finally {
        await cleanupTestRepo(testRepoDir);
      }
    });
  });

  describe("suggestionDepth validation", () => {
    for (
      const depth of [
        0,
        -1,
        1.5,
        NaN,
        Infinity,
        -Infinity,
        "2",
        "foo",
        BigInt(2),
      ] as never[]
    ) {
      const label = `${typeof depth} ${String(depth)}`;
      it(`gitCommit() rejects suggestionDepth: ${label}`, () => {
        assert.throws(
          () => gitCommit({ suggestionDepth: depth }),
          RangeError,
        );
      });

      it(`gitRef() rejects suggestionDepth: ${label}`, () => {
        assert.throws(
          () => gitRef({ suggestionDepth: depth }),
          RangeError,
        );
      });
    }

    for (const depth of [1, 2, 15, 100]) {
      it(`gitCommit() accepts suggestionDepth: ${depth}`, () => {
        assert.doesNotThrow(() => gitCommit({ suggestionDepth: depth }));
      });

      it(`gitRef() accepts suggestionDepth: ${depth}`, () => {
        assert.doesNotThrow(() => gitRef({ suggestionDepth: depth }));
      });
    }

    it("gitCommit() accepts omitted suggestionDepth", () => {
      assert.doesNotThrow(() => gitCommit());
    });

    it("gitRef() accepts omitted suggestionDepth", () => {
      assert.doesNotThrow(() => gitRef());
    });

    it("gitBranch() rejects invalid suggestionDepth", () => {
      assert.throws(
        () => gitBranch({ suggestionDepth: 0 as never }),
        RangeError,
      );
    });

    it("createGitParsers() propagates validation to methods", () => {
      const parsers = createGitParsers({ suggestionDepth: -1 as never });
      assert.throws(() => parsers.commit(), RangeError);
      assert.throws(() => parsers.ref(), RangeError);
      assert.throws(() => parsers.branch(), RangeError);
    });
  });
});
