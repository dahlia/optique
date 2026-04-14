import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { runParser } from "@optique/core/facade";
import { program } from "./index.ts";

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
});
