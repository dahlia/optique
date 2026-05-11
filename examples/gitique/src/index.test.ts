import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runParser } from "@optique/core/facade";
import { program } from "./index.ts";

function parseGitique(args: readonly string[]): unknown {
  return runParser(program, args);
}

interface CliRunResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runGitique(args: readonly string[]): CliRunResult {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const result = runParser(program, args, {
    help: {
      command: { group: "Meta commands" },
      option: { group: "Meta commands" },
      onShow: (code) => code,
    },
    version: {
      value: program.metadata.version!,
      command: { group: "Meta commands" },
      option: { group: "Meta commands" },
      onShow: (code) => code,
    },
    completion: {
      command: { group: "Meta commands" },
      option: { group: "Meta commands" },
      onShow: (code) => code,
    },
    aboveError: "usage",
    showDefault: true,
    showChoices: true,
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    onError: (code) => code,
  });

  return {
    exitCode: typeof result === "number" ? result : 0,
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
  };
}

describe("gitique CLI", () => {
  it("shows grouped top-level help", () => {
    const result = runGitique(["--help"]);

    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /Meta commands:/);
    assert.match(result.stdout, /Common commands:/);
    assert.match(
      result.stdout,
      /For more information, visit <https:\/\/github\.com\/dahlia\/optique>\./,
    );
    assert.equal(result.stderr, "");
  });

  it("reports invalid author input at parse time", () => {
    const result = runGitique([
      "commit",
      "--allow-empty",
      "--author",
      "foo",
      "-m",
      "test",
    ]);

    assert.equal(result.exitCode, 1);
    assert.match(
      result.stderr,
      /Error: `--author` is invalid: Invalid author "foo"\. Use Name <email>\./,
    );
  });

  it("shows AUTHOR metavar when --author is missing a value", () => {
    const result = runGitique(["commit", "--author"]);

    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Error: `--author` requires `AUTHOR`\./);
  });

  it("rejects impossible ISO dates before execution", () => {
    const result = runGitique(["log", "--since", "2024-02-31"]);

    assert.equal(result.exitCode, 1);
    assert.match(
      result.stderr,
      /Error: `--since`: Invalid date "2024-02-31"\. Use a real calendar date in YYYY-MM-DD format\./,
    );
  });

  it("uses custom choice errors for status format", () => {
    const result = runGitique(["status", "--format", "weird"]);

    assert.equal(result.exitCode, 1);
    assert.match(
      result.stderr,
      /Error: `--format`: Unknown status format "weird"\. Choose "long", "short", or "porcelain"\./,
    );
  });

  it("parses add command staging and output options", () => {
    const result = parseGitique([
      "add",
      "--all",
      "--force",
      "--verbose",
    ]);

    assert.deepEqual(result, {
      command: "add",
      all: true,
      force: true,
      verbose: true,
      files: [],
    });
  });

  it("parses add command file arguments", () => {
    const result = parseGitique(["add", "src/main.ts", "README.md"]);

    assert.deepEqual(result, {
      command: "add",
      all: false,
      force: false,
      verbose: false,
      files: ["src/main.ts", "README.md"],
    });
  });

  it("parses commit options with a valid author override", () => {
    const result = parseGitique([
      "commit",
      "-a",
      "--allow-empty",
      "--author",
      "Jane Doe <jane@example.com>",
      "-m",
      "Initial commit",
    ]);

    assert.deepEqual(result, {
      command: "commit",
      message: "Initial commit",
      all: true,
      allowEmpty: true,
      author: { name: "Jane Doe", email: "jane@example.com" },
    });
  });

  it("rejects blank commit messages", () => {
    const result = runGitique(["commit", "-m", "   "]);

    assert.equal(result.exitCode, 1);
    assert.match(
      result.stderr,
      /Commit message must contain non-whitespace characters\./,
    );
  });

  it("parses diff options and commit references", () => {
    const result = parseGitique([
      "diff",
      "--staged",
      "--name-status",
      "--unified",
      "0",
      "--diff-algorithm",
      "patience",
      "HEAD~1",
      "HEAD",
    ]);

    assert.deepEqual(result, {
      command: "diff",
      stat: false,
      numstat: false,
      nameOnly: false,
      nameStatus: true,
      unified: 0,
      algorithm: "patience",
      cached: true,
      staged: true,
      commits: ["HEAD~1", "HEAD"],
    });
  });

  it("rejects conflicting diff output modes", () => {
    assert.throws(
      () => parseGitique(["diff", "--stat", "--name-only"]),
      /Only one of --stat, --numstat, --name-only, --name-status may be used at a time\./,
    );
  });

  it("rejects too many diff commit references", () => {
    const result = runGitique(["diff", "HEAD~2", "HEAD~1", "HEAD"]);

    assert.equal(result.exitCode, 1);
    assert.match(
      result.stderr,
      /Unexpected option or subcommand: `HEAD`\./,
    );
  });

  it("parses log filters and shorthand format", () => {
    const result = parseGitique([
      "log",
      "--oneline",
      "--max-count",
      "3",
      "--since",
      "2024-01-02",
      "--until",
      "2024-12-31",
      "--author",
      "jane",
      "--grep",
      "fix",
    ]);

    assert.equal(typeof result, "object");
    assert.notEqual(result, null);
    const parsed = result as {
      readonly command: string;
      readonly format: string;
      readonly maxCount: number;
      readonly since: Date;
      readonly until: Date;
      readonly author: string;
      readonly grep: string;
    };
    assert.equal(parsed.command, "log");
    assert.equal(parsed.format, "oneline");
    assert.equal(parsed.maxCount, 3);
    assert.equal(parsed.since.getFullYear(), 2024);
    assert.equal(parsed.since.getMonth(), 0);
    assert.equal(parsed.since.getDate(), 2);
    assert.equal(parsed.until.getFullYear(), 2024);
    assert.equal(parsed.until.getMonth(), 11);
    assert.equal(parsed.until.getDate(), 31);
    assert.equal(parsed.author, "jane");
    assert.equal(parsed.grep, "fix");
  });

  it("rejects conflicting log format options", () => {
    assert.throws(
      () => parseGitique(["log", "--oneline", "--format", "full"]),
      /Cannot use --oneline together with --format\./,
    );
  });

  it("rejects malformed log dates", () => {
    const result = runGitique(["log", "--until", "yesterday"]);

    assert.equal(result.exitCode, 1);
    assert.match(
      result.stderr,
      /Invalid date "yesterday"\. Use YYYY-MM-DD\./,
    );
  });

  it("parses status shorthand formats", () => {
    assert.deepEqual(parseGitique(["status", "--short", "--branch"]), {
      command: "status",
      format: "short",
      short: true,
      porcelain: false,
      branch: true,
    });
    assert.deepEqual(parseGitique(["status", "--porcelain"]), {
      command: "status",
      format: "porcelain",
      short: false,
      porcelain: true,
      branch: false,
    });
  });

  it("rejects conflicting status format options", () => {
    assert.throws(
      () => parseGitique(["status", "--short", "--format", "long"]),
      /Cannot use --short or --porcelain together with --format\./,
    );
  });

  it("rejects conflicting status shorthand flags", () => {
    assert.throws(
      () => parseGitique(["status", "--short", "--porcelain"]),
      /Cannot use --short and --porcelain together\./,
    );
  });

  it("parses reset mode and file options", () => {
    assert.deepEqual(parseGitique(["reset", "--hard", "HEAD~1"]), {
      command: "reset",
      mode: "hard",
      soft: false,
      hard: true,
      quiet: false,
      commit: "HEAD~1",
      files: [],
    });
    assert.deepEqual(parseGitique(["reset", "--file", "src/main.ts", "-q"]), {
      command: "reset",
      mode: "mixed",
      soft: false,
      hard: false,
      quiet: true,
      commit: undefined,
      files: ["src/main.ts"],
    });
  });

  it("rejects conflicting reset mode options", () => {
    assert.throws(
      () => parseGitique(["reset", "--soft", "--mode", "hard"]),
      /Cannot use --soft or --hard together with --mode\./,
    );
  });

  it("rejects invalid reset mode choices", () => {
    const result = runGitique(["reset", "--mode", "keep"]);

    assert.equal(result.exitCode, 1);
    assert.match(
      result.stderr,
      /Unknown reset mode "keep"\. Choose "soft", "mixed", or "hard"\./,
    );
  });
});
