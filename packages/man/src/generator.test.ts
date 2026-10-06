import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  generateManPage,
  generateManPageAsync,
  generateManPageSync,
} from "./generator.ts";
import { object, or, tuple } from "@optique/core/constructs";
import {
  argument,
  command,
  constant,
  fail,
  flag,
  option,
} from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { defineProgram } from "@optique/core/program";
import { parse, type Parser } from "@optique/core/parser";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import { formatUsage } from "@optique/core/usage";
import { formatUsageTermAsRoff } from "./man.ts";

function getSynopsis(manPage: string): string {
  return manPage.split(".SH SYNOPSIS\n")[1].split("\n.SH ")[0].trimEnd();
}

describe("required options in SYNOPSIS", () => {
  it("keeps a flag required beside a repetition of optional failure", () => {
    const repeated = multiple(optional(fail<true>()), { min: 1 });
    const parser = or(repeated, flag("--visible"));
    assert.ok(!parse(repeated, []).success);
    assert.ok(!parse(parser, []).success);
    assert.equal(
      getSynopsis(generateManPageSync(parser, { name: "repro", section: 1 })),
      '.B "repro"\n\\fB\\-\\-visible\\fR',
    );
  });

  it("recognizes a zero-token repetition item through nested alternatives", () => {
    const repeated = multiple(or(fail<string>(), constant("x")), { min: 1 });
    const parser = or(repeated, flag("--visible"));
    assert.deepEqual(parse(repeated, []), { success: true, value: ["x"] });
    assert.ok(parse(parser, []).success);
    const term = parser.usage[0];
    assert.ok(term != null);
    assert.equal(formatUsageTermAsRoff(term), "[\\fB\\-\\-visible\\fR]");
    assert.equal(
      getSynopsis(generateManPageSync(parser, { name: "repro", section: 1 })),
      '.B "repro"\n[\\fB\\-\\-visible\\fR]',
    );
  });

  for (const min of [1, 2]) {
    it(`formats a zero-token constant repetition with min ${min} directly`, () => {
      const repeated = multiple(constant("x"), { min });
      const parser = or(repeated, flag("--visible"));
      const term = parser.usage[0];
      assert.ok(term != null);
      if (min === 1) {
        assert.deepEqual(parse(repeated, []), { success: true, value: ["x"] });
        assert.ok(parse(parser, []).success);
      } else {
        assert.ok(!parse(repeated, []).success);
        assert.ok(!parse(parser, []).success);
      }
      const visible = "\\fB\\-\\-visible\\fR";
      assert.equal(
        formatUsageTermAsRoff(term),
        min === 1 ? `[${visible}]` : visible,
      );
    });
  }

  for (const min of [1, 2]) {
    it(`keeps a flag required beside a hidden optional repetition with min ${min}`, () => {
      const hidden = multiple(optional(flag("--secret", { hidden: true })), {
        min,
      });
      const parser = or(hidden, flag("--visible"));
      assert.ok(!parse(hidden, []).success);
      assert.ok(!parse(parser, []).success);
      assert.ok(parse(parser, ["--visible"]).success);
      assert.equal(
        getSynopsis(generateManPageSync(parser, { name: "repro", section: 1 })),
        '.B "repro"\n\\fB\\-\\-visible\\fR',
      );
    });
  }

  it("keeps a flag required beside an always-failing branch", () => {
    const parser = or(fail<true>(), flag("--required"));
    assert.ok(!parse(parser, []).success);
    assert.ok(parse(parser, ["--required"]).success);
    assert.equal(
      getSynopsis(generateManPageSync(parser, { name: "repro", section: 1 })),
      '.B "repro"\n\\fB\\-\\-required\\fR',
    );
  });

  it("keeps a flag optional beside an optional always-failing branch", () => {
    const parser = or(optional(fail<true>()), flag("--visible"));
    assert.ok(parse(optional(fail<true>()), []).success);
    assert.equal(
      getSynopsis(generateManPageSync(parser, { name: "repro", section: 1 })),
      '.B "repro"\n[\\fB\\-\\-visible\\fR]',
    );
  });
  it("renders a required value option without brackets", () => {
    const parser = object({ name: option("--name", string()) });
    assert.ok(!parse(parser, []).success);
    assert.deepEqual(parse(parser, ["--name", "Ada"]), {
      success: true,
      value: { name: "Ada" },
    });
    assert.equal(formatUsage("repro", parser.usage), "repro --name STRING");
    assert.equal(
      getSynopsis(generateManPageSync(parser, { name: "repro", section: 1 })),
      '.B "repro"\n\\fB\\-\\-name\\fR \\fISTRING\\fR',
    );
  });

  it("distinguishes a required flag from an optional Boolean option", () => {
    const parser = object({
      force: flag("-f", "--force"),
      verbose: option("-v", "--verbose"),
    });
    assert.ok(!parse(parser, []).success);
    assert.ok(parse(parser, ["--force"]).success);
    assert.equal(
      getSynopsis(generateManPageSync(parser, { name: "repro", section: 1 })),
      '.B "repro"\n(\\fB\\-f\\fR | \\fB\\-\\-force\\fR) [\\fB\\-v\\fR | \\fB\\-\\-verbose\\fR]',
    );
  });

  it("keeps explicitly optional and defaulted value options bracketed", () => {
    const parser = object({
      alpha: optional(option("-a", "--alpha", string())),
      beta: withDefault(option("--beta", string()), "default"),
    });
    assert.ok(parse(parser, []).success);
    assert.equal(
      getSynopsis(generateManPageSync(parser, { name: "repro", section: 1 })),
      '.B "repro"\n[\\fB\\-a\\fR | \\fB\\-\\-alpha\\fR \\fISTRING\\fR] [\\fB\\-\\-beta\\fR \\fISTRING\\fR]',
    );
  });

  it("keeps the flag required in an exclusive branch with an optional topic", () => {
    const parser = or(
      argument(string({ metavar: "FILE" })),
      tuple([
        flag("--help"),
        optional(argument(string({ metavar: "TOPIC" }))),
      ]),
    );
    assert.equal(
      formatUsage("repro", parser.usage),
      "repro (FILE | --help [TOPIC])",
    );
    assert.equal(
      getSynopsis(generateManPageSync(parser, { name: "repro", section: 1 })),
      '.B "repro"\n(\\fIFILE\\fR | \\fB\\-\\-help\\fR [\\fITOPIC\\fR])',
    );
  });

  it("keeps repeated aliased options required when min is one", () => {
    const parser = multiple(option("-t", "--tag", string()), { min: 1 });
    assert.ok(!parse(parser, []).success);
    assert.ok(parse(parser, ["--tag", "one", "-t", "two"]).success);
    assert.equal(
      getSynopsis(generateManPageSync(parser, { name: "repro", section: 1 })),
      '.B "repro"\n(\\fB\\-t\\fR | \\fB\\-\\-tag\\fR) \\fISTRING\\fR ...',
    );
  });

  it("keeps repeated options optional when min is zero", () => {
    const parser = multiple(option("-t", "--tag", string()), { min: 0 });
    assert.ok(parse(parser, []).success);
    assert.equal(
      getSynopsis(generateManPageSync(parser, { name: "repro", section: 1 })),
      '.B "repro"\n[\\fB\\-t\\fR | \\fB\\-\\-tag\\fR \\fISTRING\\fR ...]',
    );
  });

  it("keeps repeated flags required when min is one", () => {
    const parser = multiple(flag("-v", "--verbose"), { min: 1 });
    assert.ok(!parse(parser, []).success);
    assert.ok(parse(parser, ["-v", "--verbose"]).success);
    assert.equal(
      getSynopsis(generateManPageSync(parser, { name: "repro", section: 1 })),
      '.B "repro"\n(\\fB\\-v\\fR | \\fB\\-\\-verbose\\fR) ...',
    );
  });

  it("keeps a flag optional when an exclusive branch accepts no arguments", () => {
    const parser = or(flag("-a", "--all"), constant("fallback"));
    assert.ok(parse(parser, []).success);
    assert.ok(parse(parser, ["--all"]).success);
    assert.equal(
      getSynopsis(generateManPageSync(parser, { name: "repro", section: 1 })),
      '.B "repro"\n[(\\fB\\-a\\fR | \\fB\\-\\-all\\fR)]',
    );
  });

  const hiddenBranches: readonly (readonly [
    string,
    Parser<"sync", unknown, unknown>,
  ])[] = [
    ["optional", optional(flag("--secret", { hidden: true }))],
    ["zero-minimum repeated", multiple(flag("--secret", { hidden: true }))],
  ];
  for (const [name, hidden] of hiddenBranches) {
    it(`keeps a visible flag optional beside a hidden ${name} branch`, () => {
      const parser = or(hidden, flag("--visible"));
      assert.ok(parse(hidden, []).success);
      assert.ok(parse(parser, ["--visible"]).success);
      assert.equal(
        getSynopsis(generateManPageSync(parser, { name: "repro", section: 1 })),
        '.B "repro"\n[\\fB\\-\\-visible\\fR]',
      );
    });
  }
});

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

    assert.ok(result.includes('.TH "MYAPP" 1'));
    assert.ok(result.includes(".SH NAME"));
    assert.ok(result.includes('.SH "OPTIONS"'));
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
    assert.ok(result.includes('.B "myapp"'));
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

    assert.ok(result.includes('.TH "MYAPP" 1'));
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
    assert.ok(result.includes('.BR "git" (1)'));
    assert.ok(result.includes('.BR "make" (1)'));
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
    assert.ok(result.includes('.TH "MYAPP" 1'));
    assert.ok(result.includes(".SH NAME"));
    assert.ok(result.includes(".SH SYNOPSIS"));
    assert.ok(result.includes('.SH "OPTIONS"'));
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
    assert.ok(result.includes('.TH "MYAPP" 1'));
  });

  it("rejects a malformed program-like object", () => {
    const fakeProgram = {
      parser: {},
      metadata: { name: "x" },
    };
    assert.throws(
      () => generateManPageSync(fakeProgram as never, { section: 1 }),
      { name: "TypeError", message: /not a valid.*Parser/ },
    );
  });

  it("rejects a program-like object with null metadata", () => {
    const parser = object({});
    const fakeProgram = {
      parser,
      metadata: null,
    };
    assert.throws(
      () => generateManPageSync(fakeProgram as never, { section: 1 }),
      { name: "TypeError", message: /not a valid.*Parser/ },
    );
  });

  it("rejects a program-like object with metadata missing name", () => {
    const parser = object({});
    const fakeProgram = {
      parser,
      metadata: {},
    };
    assert.throws(
      () => generateManPageSync(fakeProgram as never, { section: 1 }),
      { name: "TypeError", message: /not a valid.*Parser/ },
    );
  });

  it("rejects a malformed parser-like object", () => {
    const fakeParser = {};
    assert.throws(
      () => generateManPageSync(fakeParser as never, { name: "x", section: 1 }),
      { name: "TypeError", message: /not a valid.*Parser/ },
    );
  });

  it("rejects a parser-like object with non-array usage", () => {
    const fakeParser = {
      parse() {},
      mode: "sync",
      usage: {},
      initialState: null,
      getDocFragments() {
        return { fragments: [] };
      },
    };
    assert.throws(
      () => generateManPageSync(fakeParser as never, { name: "x", section: 1 }),
      { name: "TypeError", message: /not a valid.*Parser/ },
    );
  });

  it("rejects a parser-like object missing initialState", () => {
    const fakeParser = {
      parse() {},
      mode: "sync",
      usage: [],
      getDocFragments() {
        return { fragments: [] };
      },
    };
    assert.throws(
      () => generateManPageSync(fakeParser as never, { name: "x", section: 1 }),
      { name: "TypeError", message: /not a valid.*Parser/ },
    );
  });

  it("rejects a parser-like object with invalid mode", () => {
    const fakeParser = {
      parse() {},
      mode: "invalid",
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: null,
      getDocFragments() {
        return { fragments: [] };
      },
    };
    assert.throws(
      () => generateManPageSync(fakeParser as never, { name: "x", section: 1 }),
      { name: "TypeError", message: /not a valid.*Parser/ },
    );
  });

  it("rejects empty name", () => {
    const parser = object({});
    assert.throws(
      () => generateManPageSync(parser, { name: "", section: 1 }),
      TypeError,
    );
  });

  it("rejects invalid section numbers", () => {
    const parser = object({});
    for (const section of [0, 9, -1, 99, 1.5] as never[]) {
      assert.throws(
        () => generateManPageSync(parser, { name: "myapp", section }),
        RangeError,
      );
    }
  });

  it("falls back to empty doc page when getDocPageSync returns undefined", () => {
    const parser: Parser<"sync", string, null> = {
      mode: "sync",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly null[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: null,
      parse() {
        return {
          success: false as const,
          consumed: 0,
          error: message`stop.`,
        };
      },
      complete() {
        return { success: true as const, value: "ok" };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const result = generateManPageSync(parser, {
      name: "fallback",
      section: 1,
    });
    assert.ok(result.includes('.TH "FALLBACK" 1'));
    assert.ok(result.includes(".SH NAME"));
  });

  it("rejects an async parser at runtime", () => {
    const asyncParser: Parser<"async", string, null> = {
      mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly null[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: null,
      parse() {
        return Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`stop.`,
        });
      },
      complete() {
        return Promise.resolve({ success: true as const, value: "ok" });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    assert.throws(
      () =>
        generateManPageSync(asyncParser as never, {
          name: "myapp",
          section: 1,
        }),
      { name: "TypeError", message: /async/ },
    );
  });

  it("rejects an async program at runtime", () => {
    const asyncParser: Parser<"async", string, null> = {
      mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly null[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: null,
      parse() {
        return Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`stop.`,
        });
      },
      complete() {
        return Promise.resolve({ success: true as const, value: "ok" });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const asyncProgram = defineProgram({
      parser: asyncParser,
      metadata: { name: "myapp" },
    });

    assert.throws(
      () =>
        generateManPageSync(asyncProgram as never, {
          section: 1,
        }),
      { name: "TypeError", message: /async/ },
    );
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
    assert.ok(result.includes('.TH "MYAPP" 1'));
  });

  it("rejects a malformed program-like object", async () => {
    const fakeProgram = {
      parser: {},
      metadata: { name: "x" },
    };
    await assert.rejects(
      () => generateManPageAsync(fakeProgram as never, { section: 1 }),
      { name: "TypeError", message: /not a valid.*Parser/ },
    );
  });

  it("rejects a malformed parser-like object", async () => {
    const fakeParser = {};
    await assert.rejects(
      () =>
        generateManPageAsync(fakeParser as never, { name: "x", section: 1 }),
      { name: "TypeError", message: /not a valid.*Parser/ },
    );
  });

  it("rejects empty name", async () => {
    const parser = object({});
    await assert.rejects(
      () => generateManPageAsync(parser, { name: "", section: 1 }),
      TypeError,
    );
  });

  it("rejects invalid section numbers", async () => {
    const parser = object({});
    for (const section of [0, 9, -1, 99, 1.5] as never[]) {
      await assert.rejects(
        () => generateManPageAsync(parser, { name: "myapp", section }),
        RangeError,
      );
    }
  });

  it("falls back to empty doc page when getDocPageAsync returns undefined", async () => {
    const parser: Parser<"async", string, null> = {
      mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly null[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: null,
      parse() {
        return Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`stop.`,
        });
      },
      complete() {
        return Promise.resolve({ success: true as const, value: "ok" });
      },
      suggest() {
        return {
          async *[Symbol.asyncIterator]() {},
        };
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const result = await generateManPageAsync(parser, {
      name: "fallback-async",
      section: 1,
    });
    assert.ok(result.includes('.TH "FALLBACK\\-ASYNC" 1'));
    assert.ok(result.includes(".SH NAME"));
  });
});

describe("generateManPage() mode dispatch", () => {
  it("uses async branch when parser mode is async", async () => {
    const parser: Parser<"async", string, null> = {
      mode: "async",
      $valueType: [] as readonly string[],
      $stateType: [] as readonly null[],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: null,
      parse() {
        return Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`stop.`,
        });
      },
      complete() {
        return Promise.resolve({ success: true as const, value: "ok" });
      },
      suggest() {
        return {
          async *[Symbol.asyncIterator]() {},
        };
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const result = await generateManPage(parser, {
      name: "dispatch",
      section: 1,
    });
    assert.ok(result.includes('.TH "DISPATCH" 1'));
  });
});

describe("Program-based API", () => {
  it("extracts metadata from Program", () => {
    const prog = defineProgram({
      parser: object({
        verbose: flag("-v", "--verbose", {
          description: message`Enable verbose output.`,
        }),
      }),
      metadata: {
        name: "myapp",
        version: "1.0.0",
        author: message`Hong Minhee`,
        bugs: message`https://github.com/dahlia/optique/issues`,
      },
    });

    const result = generateManPage(prog, { section: 1 });

    assert.ok(result.includes('.TH "MYAPP" 1'));
    assert.ok(result.includes('"myapp 1.0.0"'));
    assert.ok(result.includes(".SH AUTHOR"));
    assert.ok(result.includes("Hong Minhee"));
    assert.ok(result.includes(".SH BUGS"));
    assert.ok(result.includes("https://github.com/dahlia/optique/issues"));
  });

  it("allows overriding metadata via options", () => {
    const prog = defineProgram({
      parser: object({}),
      metadata: {
        name: "original",
        version: "1.0.0",
        author: message`Original Author`,
      },
    });

    const result = generateManPage(prog, {
      section: 1,
      name: "overridden",
      version: "2.0.0",
      author: message`Override Author`,
    });

    assert.ok(result.includes('.TH "OVERRIDDEN" 1'));
    assert.ok(result.includes('"overridden 2.0.0"'));
    assert.ok(result.includes("Override Author"));
    assert.ok(!result.includes("Original Author"));
  });

  it("merges man page specific options with metadata", () => {
    const prog = defineProgram({
      parser: object({}),
      metadata: {
        name: "myapp",
        version: "1.0.0",
      },
    });

    const result = generateManPage(prog, {
      section: 1,
      date: "January 2026",
      manual: "User Commands",
      seeAlso: [{ name: "git", section: 1 }],
    });

    assert.ok(result.includes('"January 2026"'));
    assert.ok(result.includes('"User Commands"'));
    assert.ok(result.includes(".SH SEE ALSO"));
    assert.ok(result.includes('.BR "git" (1)'));
  });

  it("works with generateManPageSync()", () => {
    const prog = defineProgram({
      parser: object({
        config: option("-c", "--config", string()),
      }),
      metadata: {
        name: "myapp",
        version: "1.0.0",
      },
    });

    const result = generateManPageSync(prog, { section: 1 });

    assert.ok(typeof result === "string");
    assert.ok(result.includes('.TH "MYAPP" 1'));
    assert.ok(result.includes('"myapp 1.0.0"'));
  });

  it("works with generateManPageAsync()", async () => {
    const prog = defineProgram({
      parser: object({
        config: option("-c", "--config", string()),
      }),
      metadata: {
        name: "myapp",
        version: "1.0.0",
      },
    });

    const result = await generateManPageAsync(prog, { section: 1 });

    assert.ok(typeof result === "string");
    assert.ok(result.includes('.TH "MYAPP" 1'));
    assert.ok(result.includes('"myapp 1.0.0"'));
  });

  it("falls back to empty doc page for Program in generateManPageSync()", () => {
    const prog = defineProgram({
      parser: fail<unknown>(),
      metadata: { name: "myapp" },
    });

    const result = generateManPageSync(prog, { section: 1 });
    assert.ok(result.includes('.TH "MYAPP" 1'));
  });

  it("falls back to empty doc page for Program in generateManPageAsync()", async () => {
    const prog = defineProgram({
      parser: fail<unknown>(),
      metadata: { name: "myapp" },
    });

    const result = await generateManPageAsync(prog, { section: 1 });
    assert.ok(result.includes('.TH "MYAPP" 1'));
  });

  it("includes examples from metadata", () => {
    const prog = defineProgram({
      parser: object({}),
      metadata: {
        name: "myapp",
        examples: message`Basic usage:\n\n  myapp --help`,
      },
    });

    const result = generateManPage(prog, { section: 1 });

    assert.ok(result.includes(".SH EXAMPLES"));
    assert.ok(result.includes("Basic usage:"));
  });

  it("rejects empty name from parser options", () => {
    const parser = object({});
    assert.throws(
      () => generateManPage(parser, { name: "", section: 1 }),
      TypeError,
    );
  });

  it("rejects invalid section numbers from parser options", () => {
    const parser = object({});
    for (const section of [0, 9, -1, 99, 1.5] as never[]) {
      assert.throws(
        () => generateManPage(parser, { name: "myapp", section }),
        RangeError,
      );
    }
  });

  it("rejects invalid section numbers with Program input", () => {
    const prog = defineProgram({
      parser: object({}),
      metadata: { name: "myapp" },
    });
    for (const section of [0, 9, -1, 99, 1.5] as never[]) {
      assert.throws(
        () => generateManPage(prog, { section }),
        RangeError,
      );
    }
  });

  it("rejects empty name from Program metadata", () => {
    assert.throws(
      () =>
        defineProgram({
          parser: object({}),
          metadata: { name: "" },
        }),
      TypeError,
    );
  });

  it("rejects a malformed program-like object", () => {
    const fakeProgram = {
      parser: {},
      metadata: { name: "x" },
    };
    assert.throws(
      () => generateManPage(fakeProgram as never, { section: 1 }),
      { name: "TypeError", message: /not a valid.*Parser/ },
    );
  });

  it("rejects a malformed parser-like object", () => {
    const fakeParser = {};
    assert.throws(
      () => generateManPage(fakeParser as never, { name: "x", section: 1 }),
      { name: "TypeError", message: /not a valid.*Parser/ },
    );
  });

  it("keeps hidden: 'doc' option in SYNOPSIS but omits from OPTIONS", () => {
    const parser = object({
      visible: option("--visible", string({ metavar: "VISIBLE" }), {
        description: message`A visible option.`,
      }),
      docHidden: option("--doc-hidden", string({ metavar: "SECRET" }), {
        hidden: "doc",
        description: message`A doc-hidden option.`,
      }),
    });

    const result = generateManPage(parser, {
      name: "repro",
      section: 1,
    });

    // SYNOPSIS should contain both options
    const synopsisStart = result.indexOf(".SH SYNOPSIS");
    assert.notEqual(synopsisStart, -1);
    const nextSection = result.indexOf(".SH", synopsisStart + 1);
    assert.notEqual(nextSection, -1);
    const synopsis = result.slice(synopsisStart, nextSection);
    assert.ok(synopsis.includes("\\-\\-visible"));
    assert.ok(synopsis.includes("\\-\\-doc\\-hidden"));

    // OPTIONS section should only contain the visible option
    const optionsStart = result.indexOf('.SH "OPTIONS"');
    assert.notEqual(optionsStart, -1);
    const optionsSection = result.slice(optionsStart);
    assert.ok(optionsSection.includes("\\-\\-visible"));
    assert.ok(optionsSection.includes("A visible option."));
    assert.ok(!optionsSection.includes("\\-\\-doc\\-hidden"));
    assert.ok(!optionsSection.includes("A doc-hidden option."));
  });

  it("includes brief, description, and footer from metadata", () => {
    const prog = defineProgram({
      parser: object({
        verbose: flag("-v", "--verbose"),
      }),
      metadata: {
        name: "myapp",
        version: "1.0.0",
        brief: message`A sample application.`,
        description:
          message`This is a detailed description of the application.`,
        footer: message`Copyright 2026 Example Corp.`,
      },
    });

    const result = generateManPage(prog, { section: 1 });

    // NAME section should include brief
    assert.ok(result.includes("\\- A sample application."));
    // DESCRIPTION section should exist
    assert.ok(result.includes(".SH DESCRIPTION"));
    assert.ok(
      result.includes(
        "This is a detailed description of the application.",
      ),
    );
    // Footer should be present
    assert.ok(result.includes("Copyright 2026 Example Corp."));
  });

  it("allows overriding brief, description, and footer via options", () => {
    const prog = defineProgram({
      parser: object({}),
      metadata: {
        name: "myapp",
        brief: message`Original brief.`,
        description: message`Original description.`,
        footer: message`Original footer.`,
      },
    });

    const result = generateManPage(prog, {
      section: 1,
      brief: message`Overridden brief.`,
      description: message`Overridden description.`,
      footer: message`Overridden footer.`,
    });

    assert.ok(result.includes("\\- Overridden brief."));
    assert.ok(result.includes("Overridden description."));
    assert.ok(result.includes("Overridden footer."));
    assert.ok(!result.includes("Original brief."));
    assert.ok(!result.includes("Original description."));
    assert.ok(!result.includes("Original footer."));
  });

  it("accepts brief, description, and footer in parser-based API", () => {
    const parser = object({
      verbose: flag("-v", "--verbose"),
    });

    const result = generateManPage(parser, {
      name: "myapp",
      section: 1,
      brief: message`A CLI tool.`,
      description: message`Detailed description.`,
      footer: message`Footer text.`,
    });

    assert.ok(result.includes("\\- A CLI tool."));
    assert.ok(result.includes(".SH DESCRIPTION"));
    assert.ok(result.includes("Detailed description."));
    assert.ok(result.includes("Footer text."));
  });
});
