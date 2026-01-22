import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateManPage,
  generateManPageAsync,
  generateManPageSync,
} from "./generator.ts";
import { object } from "@optique/core/constructs";
import { argument, command, flag, option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";

describe("generateManPage()", () => {
  it("generates man page from simple option parser", () => {
    const parser = object({
      verbose: flag("-v", "--verbose", {
        description: message`Enable verbose output.`,
      }),
      port: option("-p", "--port", integer(), {
        description: message`Port to listen on.`,
      }),
    });

    const result = generateManPage(parser, {
      name: "myapp",
      section: 1,
    });

    assert.ok(result.includes(".TH MYAPP 1"));
    assert.ok(result.includes(".SH NAME"));
    assert.ok(result.includes(".SH OPTIONS"));
    assert.ok(result.includes("\\fB\\-\\-verbose\\fR"));
    assert.ok(result.includes("\\fB\\-\\-port\\fR"));
    assert.ok(result.includes("Enable verbose output."));
    assert.ok(result.includes("Port to listen on."));
  });

  it("generates man page with argument", () => {
    const parser = object({
      file: argument(string({ metavar: "FILE" }), {
        description: message`Input file to process.`,
      }),
    });

    const result = generateManPage(parser, {
      name: "myapp",
      section: 1,
    });

    assert.ok(result.includes("\\fIFILE\\fR"));
    assert.ok(result.includes("Input file to process."));
  });

  it("includes version and date", () => {
    const parser = object({});

    const result = generateManPage(parser, {
      name: "myapp",
      section: 1,
      version: "1.0.0",
      date: new Date(2026, 0, 22),
    });

    assert.ok(result.includes('"January 2026"'));
    assert.ok(result.includes('"myapp 1.0.0"'));
  });

  it("generates SYNOPSIS from parser usage", () => {
    const parser = object({
      output: option("-o", "--output", string({ metavar: "FILE" })),
      input: argument(string({ metavar: "INPUT" })),
    });

    const result = generateManPage(parser, {
      name: "myapp",
      section: 1,
    });

    assert.ok(result.includes(".SH SYNOPSIS"));
    assert.ok(result.includes(".B myapp"));
    assert.ok(result.includes("\\fB\\-\\-output\\fR"));
    assert.ok(result.includes("\\fIINPUT\\fR"));
  });

  it("handles subcommands with brief", () => {
    const buildCmd = command(
      "build",
      object({
        target: option("--target", string()),
      }),
      {
        brief: message`Build the project`,
      },
    );

    const parser = object({
      verbose: flag("-v"),
      cmd: buildCmd,
    });

    const result = generateManPage(parser, {
      name: "myapp",
      section: 1,
    });

    assert.ok(result.includes(".TH MYAPP 1"));
    assert.ok(result.includes("\\fBbuild\\fR"));
    assert.ok(result.includes("Build the project"));
  });

  it("includes author information", () => {
    const parser = object({});

    const result = generateManPage(parser, {
      name: "myapp",
      section: 1,
      author: message`Hong Minhee <hong@minhee.org>`,
    });

    assert.ok(result.includes(".SH AUTHOR"));
    assert.ok(result.includes("Hong Minhee <hong@minhee.org>"));
  });

  it("includes see also references", () => {
    const parser = object({});

    const result = generateManPage(parser, {
      name: "myapp",
      section: 1,
      seeAlso: [
        { name: "git", section: 1 },
        { name: "make", section: 1 },
      ],
    });

    assert.ok(result.includes(".SH SEE ALSO"));
    assert.ok(result.includes(".BR git (1)"));
    assert.ok(result.includes(".BR make (1)"));
  });

  it("includes examples", () => {
    const parser = object({});

    const result = generateManPage(parser, {
      name: "myapp",
      section: 1,
      examples: message`Basic usage:\n\n  myapp --verbose file.txt`,
    });

    assert.ok(result.includes(".SH EXAMPLES"));
    assert.ok(result.includes("Basic usage:"));
  });

  it("includes bugs section", () => {
    const parser = object({});

    const result = generateManPage(parser, {
      name: "myapp",
      section: 1,
      bugs: message`Report bugs at https://github.com/dahlia/optique/issues`,
    });

    assert.ok(result.includes(".SH BUGS"));
    assert.ok(result.includes("https://github.com/dahlia/optique/issues"));
  });

  it("handles choice value parser", () => {
    const parser = object({
      format: option(
        "-f",
        "--format",
        choice(["json", "yaml", "xml"]),
        { description: message`Output format.` },
      ),
    });

    const result = generateManPage(parser, {
      name: "myapp",
      section: 1,
    });

    assert.ok(result.includes("\\fB\\-\\-format\\fR"));
    assert.ok(result.includes("Output format."));
  });

  it("generates complete man page", () => {
    const parser = object({
      verbose: flag("-v", "--verbose", {
        description: message`Enable verbose output.`,
      }),
      config: option("-c", "--config", string({ metavar: "FILE" }), {
        description: message`Path to configuration file.`,
      }),
      input: argument(string({ metavar: "INPUT" }), {
        description: message`Input file to process.`,
      }),
    });

    const result = generateManPage(parser, {
      name: "myapp",
      section: 1,
      version: "1.0.0",
      date: "January 2026",
      manual: "User Commands",
      author: message`Hong Minhee <hong@minhee.org>`,
      seeAlso: [{ name: "git", section: 1 }],
    });

    // Check all major sections
    assert.ok(result.includes(".TH MYAPP 1"));
    assert.ok(result.includes(".SH NAME"));
    assert.ok(result.includes(".SH SYNOPSIS"));
    assert.ok(result.includes(".SH OPTIONS"));
    assert.ok(result.includes(".SH SEE ALSO"));
    assert.ok(result.includes(".SH AUTHOR"));

    // Check content
    assert.ok(result.includes("Enable verbose output."));
    assert.ok(result.includes("Path to configuration file."));
    assert.ok(result.includes("Hong Minhee"));
  });
});

describe("generateManPageSync()", () => {
  it("generates man page synchronously", () => {
    const parser = object({
      verbose: flag("-v", "--verbose"),
    });

    const result = generateManPageSync(parser, {
      name: "myapp",
      section: 1,
    });

    assert.ok(typeof result === "string");
    assert.ok(result.includes(".TH MYAPP 1"));
  });
});

describe("generateManPageAsync()", () => {
  it("generates man page asynchronously", async () => {
    const parser = object({
      verbose: flag("-v", "--verbose"),
    });

    const result = await generateManPageAsync(parser, {
      name: "myapp",
      section: 1,
    });

    assert.ok(typeof result === "string");
    assert.ok(result.includes(".TH MYAPP 1"));
  });
});
