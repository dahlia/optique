/**
 * Integration tests for the CLI module.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import process from "node:process";
import { createCliRunner } from "@optique/testing/cli";
import { formatDateForMan } from "#src/man.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(__dirname, "..", "test", "fixtures");
// For Deno, use TypeScript source; for Node.js/Bun, use built JS
const cliPathTs = join(__dirname, "cli.ts");
const cliPathJs = join(__dirname, "..", "dist", "cli.js");

async function isSubprocessReliable(): Promise<boolean> {
  const probe = await createCliRunner({
    command: [process.execPath, "-e", "process.stdout.write('ok')"],
    cwd: __dirname,
  }).invoke();
  return probe.exitCode === 0 && probe.stdout === "ok";
}

const hasReliableSubprocess = await isSubprocessReliable();

// Deno runs the TypeScript source with explicit permissions, while Node.js and
// Bun run the built JavaScript entry point.  Bun still loads the TypeScript
// fixtures by itself.  The generous timeout leaves room for a cold module
// cache and for the on-the-fly fixture transpilation the CLI performs.
const cli = createCliRunner(
  "Deno" in globalThis
    ? {
      entrypoint: cliPathTs,
      runtimeArgs: [
        "--allow-read",
        "--allow-write",
        "--allow-env",
        "--allow-sys",
      ],
      cwd: __dirname,
      timeout: 60_000,
    }
    : "Bun" in globalThis
    ? { entrypoint: cliPathJs, cwd: __dirname, timeout: 60_000 }
    : {
      entrypoint: cliPathJs,
      runtimeArgs: ["--no-warnings"],
      cwd: __dirname,
      timeout: 60_000,
    },
);

describe("optique-man CLI", { skip: !hasReliableSubprocess }, () => {
  describe("help and version", () => {
    it("shows help with --help", async () => {
      const result = await cli.invoke("--help");

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes("optique-man"));
      assert.ok(result.stdout.includes("Generate Unix man pages"));
      assert.ok(result.stdout.includes("--section"));
    });

    it("shows version with --version", async () => {
      const result = await cli.invoke("--version");

      assert.equal(result.exitCode, 0);
      assert.ok(/\d+\.\d+\.\d+/.test(result.stdout));
    });
  });

  describe("man page generation", () => {
    it("generates man page from Program export", async () => {
      const programFile = join(fixturesDir, "program.ts");
      const result = await cli.invoke(programFile, "-s", "1");

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('.TH "GREET" 1'));
      assert.ok(result.stdout.includes(".SH NAME"));
      assert.ok(result.stdout.includes(".SH SYNOPSIS"));
      assert.ok(result.stdout.includes("The name to greet."));
    });

    it("generates man page from Parser export", async () => {
      const parserFile = join(fixturesDir, "parser.ts");
      const result = await cli.invoke(
        parserFile,
        "-s",
        "1",
        "--name",
        "myparser",
      );

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('.TH "MYPARSER" 1'));
      assert.ok(result.stdout.includes("Input file to process."));
    });

    it("generates man page from .tsx input", async () => {
      const tsxFile = join(fixturesDir, "program.tsx");
      const result = await cli.invoke(tsxFile, "-s", "1");

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('.TH "GREET" 1'));
      assert.ok(result.stdout.includes(".SH NAME"));
    });

    it("generates man page from .jsx input", async () => {
      const jsxFile = join(fixturesDir, "program.jsx");
      const result = await cli.invoke(jsxFile, "-s", "1");

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('.TH "GREET" 1'));
      assert.ok(result.stdout.includes(".SH NAME"));
    });

    it("generates man page from .ts entry that imports .tsx", async () => {
      const tsFile = join(fixturesDir, "imports-tsx.ts");
      const result = await cli.invoke(tsFile, "-s", "1");

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('.TH "GREET" 1'));
      assert.ok(result.stdout.includes(".SH NAME"));
    });

    it("generates man page when input path contains #", async () => {
      const sourceFile = join(fixturesDir, "parser.ts");
      const tempDir = await mkdtemp(
        join(fixturesDir, "tmp-optique-man-hash-"),
      );
      const parserFile = join(tempDir, "hash#parser.ts");

      try {
        await writeFile(parserFile, await readFile(sourceFile, "utf-8"));

        const result = await cli.invoke(
          parserFile,
          "-s",
          "1",
          "--name",
          "hashparser",
        );

        assert.equal(result.exitCode, 0);
        assert.ok(result.stdout.includes('.TH "HASHPARSER" 1'));
      } finally {
        await rm(tempDir, { recursive: true });
      }
    });

    it("infers program name from extensionless input file", async () => {
      const sourceFile = join(fixturesDir, "parser.ts");
      const tempDir = await mkdtemp(
        join(fixturesDir, "tmp-optique-man-extless-"),
      );
      const parserFile = join(tempDir, "myapp");

      try {
        await writeFile(parserFile, await readFile(sourceFile, "utf-8"));

        const result = await cli.invoke(
          parserFile,
          "-s",
          "1",
        );

        assert.equal(result.exitCode, 0);
        assert.ok(result.stdout.includes('.TH "MYAPP" 1'));
      } finally {
        await rm(tempDir, { recursive: true });
      }
    });

    it("generates man page from named export", async () => {
      const namedFile = join(fixturesDir, "named-export.ts");
      const result = await cli.invoke(namedFile, "-s", "1", "-e", "myProgram");

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('.TH "NAMED\\-APP" 1'));
      assert.ok(result.stdout.includes("Configuration file path."));
    });

    it("writes output to file", async () => {
      const programFile = join(fixturesDir, "program.ts");
      const tempDir = await mkdtemp(join(tmpdir(), "optique-man-test-"));
      const outputFile = join(tempDir, "greet.1");

      try {
        const result = await cli.invoke(
          programFile,
          "-s",
          "1",
          "-o",
          outputFile,
        );

        assert.equal(result.exitCode, 0);

        const content = await readFile(outputFile, "utf-8");
        assert.ok(content.includes('.TH "GREET" 1'));
      } finally {
        await rm(tempDir, { recursive: true });
      }
    });

    it("defaults --date to the current date", async () => {
      const programFile = join(fixturesDir, "program.ts");
      const before = new Date();
      const result = await cli.invoke(
        programFile,
        "-s",
        "1",
      );
      const after = new Date();

      assert.equal(result.exitCode, 0);
      const thLine = result.stdout.split("\n")[0];
      const thMatch = thLine.match(
        /^\.TH\s+"[^"]+"\s+\S+\s+"([^"]*)"\s+"([^"]*)"/,
      );
      assert.ok(thMatch, `Expected .TH header, got: ${thLine}`);
      const dateField = thMatch[1];
      // Accept the formatted date for either the before or after
      // snapshot to tolerate month/year boundary crossings.
      const allowed = new Set([
        formatDateForMan(before),
        formatDateForMan(after),
      ]);
      assert.ok(
        allowed.has(dateField),
        `Expected date to be one of ${
          JSON.stringify([...allowed])
        }, got: "${dateField}"`,
      );
    });

    it("defaults --date to the current date for Parser export", async () => {
      const parserFile = join(fixturesDir, "parser.ts");
      const before = new Date();
      const result = await cli.invoke(
        parserFile,
        "-s",
        "1",
        "--name",
        "myapp",
      );
      const after = new Date();

      assert.equal(result.exitCode, 0);
      const thLine = result.stdout.split("\n")[0];
      const thMatch = thLine.match(
        /^\.TH\s+"[^"]+"\s+\S+\s+"([^"]*)"/,
      );
      assert.ok(thMatch, `Expected .TH header, got: ${thLine}`);
      const dateField = thMatch[1];
      const allowed = new Set([
        formatDateForMan(before),
        formatDateForMan(after),
      ]);
      assert.ok(
        allowed.has(dateField),
        `Expected date to be one of ${
          JSON.stringify([...allowed])
        }, got: "${dateField}"`,
      );
    });

    it("accepts --date option", async () => {
      const programFile = join(fixturesDir, "program.ts");
      const result = await cli.invoke(
        programFile,
        "-s",
        "1",
        "--date",
        "January 2026",
      );

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('"January 2026"'));
    });

    it("accepts --version-string option", async () => {
      const parserFile = join(fixturesDir, "parser.ts");
      const result = await cli.invoke(
        parserFile,
        "-s",
        "1",
        "--name",
        "myapp",
        "--version-string",
        "2.0.0-beta",
      );

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('"myapp 2.0.0-beta"'));
    });

    it("accepts --manual option", async () => {
      const programFile = join(fixturesDir, "program.ts");
      const result = await cli.invoke(
        programFile,
        "-s",
        "1",
        "--manual",
        "User Commands",
      );

      assert.equal(result.exitCode, 0);
      assert.ok(result.stdout.includes('"User Commands"'));
    });
  });

  describe("error handling", () => {
    it("fails with exit code 1 for non-existent file", async () => {
      const result = await cli.invoke("nonexistent.ts", "-s", "1");

      assert.equal(result.exitCode, 1);
      assert.ok(result.stderr.includes("not found"));
    });

    it("fails with exit code 2 for missing export", async () => {
      const namedFile = join(fixturesDir, "named-export.ts");
      const result = await cli.invoke(
        namedFile,
        "-s",
        "1",
        "-e",
        "nonexistent",
      );

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
      const result = await cli.invoke(noDefaultFile, "-s", "1");

      assert.equal(result.exitCode, 2);
      assert.ok(result.stderr.includes("default export"));
    });

    it("fails with exit code 3 for invalid export type", async () => {
      const invalidFile = join(fixturesDir, "invalid-export.ts");
      const result = await cli.invoke(invalidFile, "-s", "1");

      assert.equal(result.exitCode, 3);
      assert.ok(result.stderr.includes("not a Program or Parser"));
    });

    it("fails with exit code 3 for malformed parser-like export", async () => {
      const malformedFile = join(fixturesDir, "malformed-parser.ts");
      const result = await cli.invoke(malformedFile, "-s", "1");

      assert.equal(result.exitCode, 3);
      assert.ok(result.stderr.includes("not a Program or Parser"));
    });

    it("fails with exit code 3 for malformed program with bad parser", async () => {
      const malformedFile = join(fixturesDir, "malformed-program.ts");
      const result = await cli.invoke(malformedFile, "-s", "1");

      assert.equal(result.exitCode, 3);
      assert.ok(result.stderr.includes("not a Program or Parser"));
    });

    it("fails with exit code 3 for program with missing metadata name", async () => {
      const malformedFile = join(
        fixturesDir,
        "malformed-program-metadata.ts",
      );
      const result = await cli.invoke(malformedFile, "-s", "1");

      assert.equal(result.exitCode, 3);
      assert.ok(result.stderr.includes("not a Program or Parser"));
    });

    it("fails with exit code 3 for parser with throwing getter", async () => {
      const malformedFile = join(
        fixturesDir,
        "throwing-getter-parser.ts",
      );
      const result = await cli.invoke(malformedFile, "-s", "1");

      assert.equal(result.exitCode, 3);
      assert.ok(result.stderr.includes("not a Program or Parser"));
    });

    it("fails with exit code 3 for program with throwing parser getter", async () => {
      const malformedFile = join(
        fixturesDir,
        "throwing-getter-program.ts",
      );
      const result = await cli.invoke(malformedFile, "-s", "1");

      assert.equal(result.exitCode, 3);
      assert.ok(result.stderr.includes("not a Program or Parser"));
    });

    it("rejects empty --name", async () => {
      const programFile = join(fixturesDir, "program.ts");
      const result = await cli.invoke(programFile, "-s", "1", "--name", "");

      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("Program name must not be empty"));
    });

    it("rejects empty --date", async () => {
      const programFile = join(fixturesDir, "program.ts");
      const result = await cli.invoke(programFile, "-s", "1", "--date", "");

      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("Date must not be empty"));
    });

    it("rejects empty --version-string", async () => {
      const programFile = join(fixturesDir, "program.ts");
      const result = await cli.invoke(
        programFile,
        "-s",
        "1",
        "--version-string",
        "",
      );

      assert.notEqual(result.exitCode, 0);
      assert.ok(
        result.stderr.includes("Version string must not be empty"),
      );
    });

    it("rejects empty --manual", async () => {
      const programFile = join(fixturesDir, "program.ts");
      const result = await cli.invoke(programFile, "-s", "1", "--manual", "");

      assert.notEqual(result.exitCode, 0);
      assert.ok(result.stderr.includes("Manual name must not be empty"));
    });
  });
});
