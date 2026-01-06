import { describe, it } from "node:test";
import { deepStrictEqual } from "node:assert/strict";
import {
  argument,
  command,
  constant,
  flag,
  map,
  multiple,
  object,
  option,
  optional,
  or,
  type ParserContext,
  withDefault,
} from "./index.ts";
import { choice, integer, string } from "./valueparser.ts";
import { message } from "./message.ts";

describe("Parser suggest() methods", () => {
  describe("constant parser", () => {
    it("should return empty suggestions", () => {
      const parser = constant("test");
      const context: ParserContext<"test"> = {
        buffer: [],
        state: "test",
        optionsTerminated: false,
        usage: parser.usage,
      };
      const result = Array.from(parser.suggest(context, "any"));
      deepStrictEqual(result, []);
    });
  });

  describe("option parser", () => {
    it("should suggest option names matching prefix", () => {
      const parser = option("-f", "--format", "--file");
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result1 = Array.from(parser.suggest(context, "--f"));
      const texts1 = result1.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      ).sort();
      deepStrictEqual(texts1, ["--file", "--format"]);

      const result2 = Array.from(parser.suggest(context, "-f"));
      deepStrictEqual(result2, [{ kind: "literal", text: "-f" }]);
    });

    it("should suggest short options", () => {
      const parser = option("-v", "--verbose", "-q", "--quiet");
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "-"));
      const texts = result.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      ).sort();
      deepStrictEqual(texts, ["-q", "-v"]);
    });

    it("should not suggest when prefix doesn't match", () => {
      const parser = option("-f", "--format");
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--output"));
      deepStrictEqual(result, []);
    });

    it("should delegate to value parser for values", () => {
      const parser = option("-f", "--format", choice(["json", "yaml", "xml"]));
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--format"],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "j"));
      deepStrictEqual(result, [{ kind: "literal", text: "json" }]);
    });

    it("should handle boolean options without value parser", () => {
      const parser = option("-v", "--verbose");
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["-v"],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "something"));
      deepStrictEqual(result, []);
    });

    it("should suggest --option=value format", () => {
      const parser = option("-f", "--format", choice(["json", "yaml", "xml"]));
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--format=j"));
      deepStrictEqual(result, [{
        kind: "literal",
        text: "--format=json",
        description: undefined,
      }]);
    });

    it("should suggest all values for --option= format", () => {
      const parser = option("-f", "--format", choice(["json", "yaml", "xml"]));
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--format="));
      const texts = result.map((r) =>
        r.kind === "literal" ? r.text : r.pattern || ""
      ).sort();
      deepStrictEqual(texts, [
        "--format=json",
        "--format=xml",
        "--format=yaml",
      ]);
    });

    it("should suggest -option=value format for short options", () => {
      const parser = option("-f", "--format", choice(["json", "yaml", "xml"]));
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "-f=y"));
      deepStrictEqual(result, [{
        kind: "literal",
        text: "-f=yaml",
        description: undefined,
      }]);
    });

    it("should return empty for unmatched option in --option=value format", () => {
      const parser = option("-f", "--format", choice(["json", "yaml", "xml"]));
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--output=json"));
      deepStrictEqual(result, []);
    });
  });

  describe("flag parser", () => {
    it("should suggest flag names matching prefix", () => {
      const parser = flag("-f", "--force", "--full");
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--f"));
      const texts = result.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      ).sort();
      deepStrictEqual(texts, ["--force", "--full"]);
    });

    it("should not suggest values after flag", () => {
      const parser = flag("-f", "--force");
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["-f"],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "anything"));
      deepStrictEqual(result, []);
    });
  });

  describe("argument parser", () => {
    it("should delegate to value parser", () => {
      const parser = argument(choice(["start", "stop", "restart", "status"]));
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "st"));
      const texts = result.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      ).sort();
      deepStrictEqual(texts, ["start", "status", "stop"]);
    });

    it("should return empty for value parsers without suggest", () => {
      const parser = argument(string());
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "test"));
      deepStrictEqual(result, []);
    });
  });

  describe("command parser", () => {
    it("should suggest command name when not matched", () => {
      const innerParser = option("-v", "--verbose");
      const parser = command("build", innerParser, {
        description: message`Build the project`,
      });
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "bu"));
      deepStrictEqual(result, [{
        kind: "literal",
        text: "build",
        description: message`Build the project`,
      }]);
    });

    it("should not suggest when command name doesn't match", () => {
      const innerParser = option("-v", "--verbose");
      const parser = command("build", innerParser);
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "deploy"));
      deepStrictEqual(result, []);
    });

    it("should delegate to inner parser after command matched", () => {
      const innerParser = option("-v", "--verbose");
      const parser = command("build", innerParser);
      // Command matched state: ["matched", commandName]
      const context: ParserContext<["matched", string]> = {
        buffer: [],
        state: ["matched", "build"],
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--v"));
      deepStrictEqual(result, [{ kind: "literal", text: "--verbose" }]);
    });

    it("should delegate to inner parser during parsing", () => {
      const innerParser = option("-v", "--verbose");
      const parser = command("build", innerParser);
      // Command parsing state: ["parsing", innerParserState]
      const context: ParserContext<
        ["parsing", typeof innerParser.initialState]
      > = {
        buffer: [],
        state: ["parsing", innerParser.initialState],
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--v"));
      deepStrictEqual(result, [{ kind: "literal", text: "--verbose" }]);
    });
  });

  describe("object parser", () => {
    it("should combine suggestions from all field parsers", () => {
      const parser = object({
        verbose: option("-v", "--verbose"),
        output: option("-o", "--output", string()),
        force: flag("-f", "--force"),
      });
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--"));
      const texts = result.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      ).sort();
      deepStrictEqual(texts, ["--force", "--output", "--verbose"]);
    });

    it("should remove duplicate suggestions", () => {
      const parser = object({
        verbose1: option("-v", "--verbose"),
        verbose2: option("-v", "--verbose"), // Duplicate option names
      });
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--v"));
      deepStrictEqual(result, [{ kind: "literal", text: "--verbose" }]);
    });

    it("should handle field-specific state", () => {
      const parser = object({
        input: option("-i", "--input", string()),
        output: option("-o", "--output", string()),
      });
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: {
          input: { success: true, value: "file.txt" },
          output: parser.initialState.output,
        },
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--o"));
      deepStrictEqual(result, [{ kind: "literal", text: "--output" }]);
    });
  });

  describe("or parser", () => {
    it("should combine suggestions from all alternatives", () => {
      const parserA = option("-a", "--alpha");
      const parserB = option("-b", "--beta");
      const parser = or(parserA, parserB);
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--"));
      const texts = result.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      ).sort();
      deepStrictEqual(texts, ["--alpha", "--beta"]);
    });

    it("should delegate to selected parser when one is chosen", () => {
      const parserA = object({
        verbose: option("-v", "--verbose"),
        file: option("-f", "--file", string()),
      });
      const parserB = object({
        quiet: option("-q", "--quiet"),
        output: option("-o", "--output", string()),
      });
      const parser = or(parserA, parserB);
      // Or parser selected state: [index, ParserResult]
      const context: ParserContext<
        [
          0,
          {
            success: true;
            next: ParserContext<typeof parserA.initialState>;
            consumed: readonly string[];
          },
        ]
      > = {
        buffer: [],
        state: [0, {
          success: true,
          next: {
            buffer: [],
            state: parserA.initialState,
            optionsTerminated: false,
            usage: parserA.usage,
          },
          consumed: [],
        }],
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--f"));
      deepStrictEqual(result, [{ kind: "literal", text: "--file" }]);
    });

    it("should remove duplicates across alternatives", () => {
      const parserA = option("-v", "--verbose");
      const parserB = option("-v", "--verbose"); // Same option
      const parser = or(parserA, parserB);
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--v"));
      deepStrictEqual(result, [{ kind: "literal", text: "--verbose" }]);
    });
  });

  describe("optional parser", () => {
    it("should delegate to wrapped parser", () => {
      const innerParser = option("-v", "--verbose");
      const parser = optional(innerParser);
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--v"));
      deepStrictEqual(result, [{ kind: "literal", text: "--verbose" }]);
    });

    it("should handle undefined state", () => {
      const innerParser = option("-v", "--verbose");
      const parser = optional(innerParser);
      const context: ParserContext<undefined> = {
        buffer: [],
        state: undefined,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--v"));
      deepStrictEqual(result, [{ kind: "literal", text: "--verbose" }]);
    });

    it("should handle existing state", () => {
      const innerParser = option("-v", "--verbose");
      const parser = optional(innerParser);
      // Optional parser with state: [innerParserState]
      const context: ParserContext<[typeof innerParser.initialState]> = {
        buffer: [],
        state: [innerParser.initialState],
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--v"));
      deepStrictEqual(result, [{ kind: "literal", text: "--verbose" }]);
    });
  });

  describe("withDefault parser", () => {
    it("should delegate to wrapped parser", () => {
      const innerParser = option("-p", "--port", integer());
      const parser = withDefault(innerParser, 8080);
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--p"));
      deepStrictEqual(result, [{ kind: "literal", text: "--port" }]);
    });

    it("should handle function defaults", () => {
      const innerParser = option("-u", "--user", string());
      const parser = withDefault(innerParser, () => "default-user");
      const context: ParserContext<undefined> = {
        buffer: [],
        state: undefined,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--u"));
      deepStrictEqual(result, [{ kind: "literal", text: "--user" }]);
    });
  });

  describe("map parser", () => {
    it("should delegate to wrapped parser", () => {
      const innerParser = option("-n", "--number", integer());
      const parser = map(innerParser, (n: number) => n.toString());
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--n"));
      deepStrictEqual(result, [{ kind: "literal", text: "--number" }]);
    });

    it("should preserve value suggestions", () => {
      const innerParser = option("-f", "--format", choice(["json", "yaml"]));
      const parser = map(innerParser, (format: string) => format.toUpperCase());
      const context: ParserContext<typeof parser.initialState> = {
        buffer: ["--format"],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "j"));
      deepStrictEqual(result, [{ kind: "literal", text: "json" }]);
    });
  });

  describe("multiple parser", () => {
    it("should suggest for repeated items", () => {
      const innerParser = option("-f", "--file", string());
      const parser = multiple(innerParser);
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--f"));
      deepStrictEqual(result, [{ kind: "literal", text: "--file" }]);
    });

    it("should use most recent state for suggestions", () => {
      const innerParser = option("-i", "--include", string());
      const parser = multiple(innerParser);
      // Multiple parser state: readonly TState[]
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: [
          innerParser.initialState,
          innerParser.initialState,
          innerParser.initialState,
        ],
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--i"));
      deepStrictEqual(result, [{ kind: "literal", text: "--include" }]);
    });

    it("should handle empty state array", () => {
      const innerParser = option("-f", "--file", string());
      const parser = multiple(innerParser);
      const context: ParserContext<typeof parser.initialState> = {
        buffer: [],
        state: [],
        optionsTerminated: false,
        usage: parser.usage,
      };

      const result = Array.from(parser.suggest(context, "--f"));
      deepStrictEqual(result, [{ kind: "literal", text: "--file" }]);
    });
  });
});

describe("ValueParser suggest() methods", () => {
  describe("choice parser", () => {
    it("should suggest matching choices", () => {
      const parser = choice(["json", "yaml", "xml", "text"]);
      const result = Array.from(parser.suggest!("j"));
      deepStrictEqual(result, [{ kind: "literal", text: "json" }]);
    });

    it("should suggest multiple matches", () => {
      const parser = choice(["start", "stop", "status", "restart"]);
      const result = Array.from(parser.suggest!("st"));
      const texts = result.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      ).sort();
      deepStrictEqual(texts, ["start", "status", "stop"]);
    });

    it("should handle case insensitive matching", () => {
      const parser = choice(["JSON", "YAML", "XML"], { caseInsensitive: true });
      const result = Array.from(parser.suggest!("j"));
      deepStrictEqual(result, [{ kind: "literal", text: "JSON" }]);
    });

    it("should return empty for no matches", () => {
      const parser = choice(["json", "yaml", "xml"]);
      const result = Array.from(parser.suggest!("html"));
      deepStrictEqual(result, []);
    });

    it("should return all choices for empty prefix", () => {
      const parser = choice(["json", "yaml", "xml"]);
      const result = Array.from(parser.suggest!(""));
      const texts = result.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      ).sort();
      deepStrictEqual(texts, ["json", "xml", "yaml"]);
    });
  });

  describe("string parser", () => {
    it("should not provide suggestions by default", () => {
      const parser = string();
      // string parser doesn't have suggest method
      deepStrictEqual(parser.suggest, undefined);
    });
  });

  describe("integer parser", () => {
    it("should not provide suggestions by default", () => {
      const parser = integer();
      // integer parser doesn't have suggest method
      deepStrictEqual(parser.suggest, undefined);
    });
  });
});
