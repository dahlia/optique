import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { object } from "./constructs.ts";
import { option } from "./primitives.ts";
import { string } from "./valueparser.ts";
import { message } from "./message.ts";
import { withDefault } from "./modifiers.ts";
import type { Program, ProgramMetadata } from "./program.ts";
import { defineProgram } from "./program.ts";

describe("ProgramMetadata", () => {
  test("should accept minimal metadata", () => {
    const metadata: ProgramMetadata = {
      name: "myapp",
    };
    assert.equal(metadata.name, "myapp");
    assert.equal(metadata.version, undefined);
  });

  test("should accept full metadata", () => {
    const metadata: ProgramMetadata = {
      name: "myapp",
      version: "1.0.0",
      brief: message`A brief description`,
      description: message`A longer description`,
      author: message`Jane Doe <jane@example.com>`,
      bugs: message`Report bugs at https://example.com/bugs`,
      examples: message`myapp --help`,
      footer: message`Visit https://example.com for more info`,
    };
    assert.equal(metadata.name, "myapp");
    assert.equal(metadata.version, "1.0.0");
    assert.ok(metadata.brief);
    assert.ok(metadata.description);
    assert.ok(metadata.author);
    assert.ok(metadata.bugs);
    assert.ok(metadata.examples);
    assert.ok(metadata.footer);
  });
});

describe("Program", () => {
  test("should bundle parser with metadata", () => {
    const parser = object({
      name: withDefault(option("--name", string()), "World"),
    });
    const prog: Program<"sync", { name: string }> = {
      parser,
      metadata: {
        name: "greet",
        version: "1.0.0",
        brief: message`A greeting CLI tool`,
      },
    };

    assert.ok(prog.parser);
    assert.equal(prog.metadata.name, "greet");
    assert.equal(prog.metadata.version, "1.0.0");
  });

  test("should work with minimal metadata", () => {
    const parser = option("-v");
    const prog: Program<"sync", boolean> = {
      parser,
      metadata: {
        name: "minimal",
      },
    };

    assert.ok(prog.parser);
    assert.equal(prog.metadata.name, "minimal");
    assert.equal(prog.metadata.version, undefined);
  });
});

describe("defineProgram", () => {
  test("should infer types automatically for sync parser", () => {
    const parser = object({
      name: option("--name", string()),
      count: option("--count", string()),
    });

    const prog = defineProgram({
      parser,
      metadata: {
        name: "myapp",
        version: "1.0.0",
      },
    });

    // Verify it returns the same object
    assert.ok(prog.parser);
    assert.equal(prog.metadata.name, "myapp");
    assert.equal(prog.metadata.version, "1.0.0");
  });

  test("should work with minimal metadata", () => {
    const parser = option("-v");

    const prog = defineProgram({
      parser,
      metadata: {
        name: "minimal",
      },
    });

    assert.ok(prog.parser);
    assert.equal(prog.metadata.name, "minimal");
    assert.equal(prog.metadata.version, undefined);
  });

  test("should preserve all metadata fields", () => {
    const parser = option("--help");

    const prog = defineProgram({
      parser,
      metadata: {
        name: "fullapp",
        version: "2.0.0",
        brief: message`A brief description`,
        description: message`A longer description`,
        author: message`John Doe <john@example.com>`,
        bugs: message`Report bugs at https://example.com/bugs`,
        examples: message`fullapp --help`,
        footer: message`Visit https://example.com for more info`,
      },
    });

    assert.ok(prog.parser);
    assert.equal(prog.metadata.name, "fullapp");
    assert.equal(prog.metadata.version, "2.0.0");
    assert.ok(prog.metadata.brief);
    assert.ok(prog.metadata.description);
    assert.ok(prog.metadata.author);
    assert.ok(prog.metadata.bugs);
    assert.ok(prog.metadata.examples);
    assert.ok(prog.metadata.footer);
  });

  test("should work with complex parser types", () => {
    const parser = object({
      verbose: withDefault(option("-v", "--verbose"), false),
      output: option("-o", "--output", string()),
    });

    const prog = defineProgram({
      parser,
      metadata: {
        name: "complex",
        version: "1.0.0",
      },
    });

    assert.ok(prog.parser);
    assert.equal(prog.metadata.name, "complex");
  });

  test("should be identity function", () => {
    const parser = option("--test");
    const input = {
      parser,
      metadata: {
        name: "test",
        version: "1.0.0",
      },
    };

    const result = defineProgram(input);

    // Should return the same object (identity function)
    assert.equal(result, input);
  });
});
