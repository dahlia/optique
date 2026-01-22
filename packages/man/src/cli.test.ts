/**
 * Integration tests for the CLI module.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "test", "fixtures");
// For Deno, use TypeScript source; for Node.js/Bun, use built JS
const cliPathTs = join(__dirname, "cli.ts");
const cliPathJs = join(__dirname, "..", "dist", "cli.js");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Runs the CLI with the given arguments and returns the result.
 */
function runCli(args: readonly string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    // Determine which runtime to use
    let child: ChildProcess;

    // deno-lint-ignore no-explicit-any
    if (typeof (globalThis as any).Deno !== "undefined") {
      // Deno: use TypeScript source directly
      child = spawn("deno", [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-sys",
        cliPathTs,
        ...args,
      ], { cwd: __dirname });
      // deno-lint-ignore no-explicit-any
    } else if (typeof (globalThis as any).Bun !== "undefined") {
      // Bun: use built JS file (fixtures are still TS, Bun handles them)
      child = spawn("bun", [cliPathJs, ...args], { cwd: __dirname });
    } else {
      // Node.js: use built JS file
      child = spawn("node", [
        "--no-warnings",
        cliPathJs,
        ...args,
      ], { cwd: __dirname });
    }

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

describe("optique-man CLI", () => {
  describe("help and version", () => {
    it("shows help with --help", async () => {
      const result = await runCli(["--help"]);

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes("optique-man"));
      assert.ok(result.stdout.includes("Generate Unix man pages"));
      assert.ok(result.stdout.includes("--section"));
    });

    it("shows version with --version", async () => {
      const result = await runCli(["--version"]);

      assert.equal(result.exitCode, 0);
      assert.ok(/\d+\.\d+\.\d+/.test(result.stdout));
    });
  });

  describe("man page generation", () => {
    it("generates man page from Program export", async () => {
      const programFile = join(fixturesDir, "program.ts");
      const result = await runCli([programFile, "-s", "1"]);

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes(".TH GREET 1"));
      assert.ok(result.stdout.includes(".SH NAME"));
      assert.ok(result.stdout.includes(".SH SYNOPSIS"));
      assert.ok(result.stdout.includes("The name to greet."));
    });

    it("generates man page from Parser export", async () => {
      const parserFile = join(fixturesDir, "parser.ts");
      const result = await runCli([
        parserFile,
        "-s",
        "1",
        "--name",
        "myparser",
      ]);

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes(".TH MYPARSER 1"));
      assert.ok(result.stdout.includes("Input file to process."));
    });

    it("generates man page from named export", async () => {
      const namedFile = join(fixturesDir, "named-export.ts");
      const result = await runCli([namedFile, "-s", "1", "-e", "myProgram"]);

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes(".TH NAMED-APP 1"));
      assert.ok(result.stdout.includes("Configuration file path."));
    });

    it("writes output to file", async () => {
      const programFile = join(fixturesDir, "program.ts");
      const tempDir = await mkdtemp(join(tmpdir(), "optique-man-test-"));
      const outputFile = join(tempDir, "greet.1");

      try {
        const result = await runCli([
          programFile,
          "-s",
          "1",
          "-o",
          outputFile,
        ]);

        assert.equal(result.exitCode, 0);

        const content = await readFile(outputFile, "utf-8");
        assert.ok(content.includes(".TH GREET 1"));
      } finally {
        await rm(tempDir, { recursive: true });
      }
    });

    it("accepts --date option", async () => {
      const programFile = join(fixturesDir, "program.ts");
      const result = await runCli([
        programFile,
        "-s",
        "1",
        "--date",
        "January 2026",
      ]);

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('"January 2026"'));
    });

    it("accepts --version-string option", async () => {
      const parserFile = join(fixturesDir, "parser.ts");
      const result = await runCli([
        parserFile,
        "-s",
        "1",
        "--name",
        "myapp",
        "--version-string",
        "2.0.0-beta",
      ]);

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('"myapp 2.0.0-beta"'));
    });

    it("accepts --manual option", async () => {
      const programFile = join(fixturesDir, "program.ts");
      const result = await runCli([
        programFile,
        "-s",
        "1",
        "--manual",
        "User Commands",
      ]);

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('"User Commands"'));
    });
  });

  describe("error handling", () => {
    it("fails with exit code 1 for non-existent file", async () => {
      const result = await runCli(["nonexistent.ts", "-s", "1"]);

      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("not found"));
    });

    it("fails with exit code 2 for missing export", async () => {
      const namedFile = join(fixturesDir, "named-export.ts");
      const result = await runCli([namedFile, "-s", "1", "-e", "nonexistent"]);

      assert.equal(result.exitCode, 2);
      assert.ok(result.stderr.includes("No"));
      assert.ok(result.stderr.includes("found"));
      assert.ok(
        result.stderr.includes("myProgram") ||
          result.stderr.includes("anotherProgram"),
      );
    });

    it("fails with exit code 2 for missing default export", async () => {
      const noDefaultFile = join(fixturesDir, "no-default.ts");
      const result = await runCli([noDefaultFile, "-s", "1"]);

      assert.equal(result.exitCode, 2);
      assert.ok(result.stderr.includes("default export"));
    });

    it("fails with exit code 3 for invalid export type", async () => {
      const invalidFile = join(fixturesDir, "invalid-export.ts");
      const result = await runCli([invalidFile, "-s", "1"]);

      assert.equal(result.exitCode, 3);
      assert.ok(result.stderr.includes("not a Program or Parser"));
    });
  });
});
