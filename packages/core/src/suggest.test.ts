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
  suggest,
  type Suggestion,
  withDefault,
} from "./index.ts";
import { choice, integer, string } from "./valueparser.ts";
import { message } from "./message.ts";

// Helper function to extract text from suggestions
function extractText(suggestion: Suggestion): string {
  if (suggestion.kind === "literal") {
    return suggestion.text;
  } else {
    // For file suggestions, return the pattern as a fallback for tests
    return suggestion.pattern || "";
  }
}

describe("suggest function", () => {
  describe("basic functionality", () => {
    it("should return empty array for empty args", () => {
      const parser = constant("test");
      const result = suggest(parser, [""]);
      deepStrictEqual(result, []);
    });

    it("should handle single argument prefix", () => {
      const parser = option("-v", "--verbose");
      const result = suggest(parser, ["--v"]);
      deepStrictEqual(result, [{ kind: "literal", text: "--verbose" }]);
    });

    it("should handle multiple argument context", () => {
      const parser = object({
        verbose: option("-v", "--verbose"),
        output: option("-o", "--output", string()),
      });
      const result = suggest(parser, ["-v", "--o"]);
      deepStrictEqual(result, [{ kind: "literal", text: "--output" }]);
    });
  });

  describe("option parser suggestions", () => {
    it("should suggest matching option names with prefix", () => {
      const parser = option("-f", "--format", "--file");
      const result = suggest(parser, ["--f"]);
      const expectedTexts = result.map((s) => extractText(s)).sort();
      deepStrictEqual(expectedTexts, ["--file", "--format"]);
    });

    it("should suggest short options", () => {
      const parser = option("-v", "--verbose", "-q", "--quiet");
      const result = suggest(parser, ["-"]);
      const expectedTexts = result.map((s) => extractText(s)).sort();
      deepStrictEqual(expectedTexts, ["-q", "-v"]);
    });

    it("should not suggest when prefix doesn't match", () => {
      const parser = option("-f", "--format");
      const result = suggest(parser, ["--output"]);
      deepStrictEqual(result, []);
    });

    it("should suggest values after option", () => {
      const parser = option("-f", "--format", choice(["json", "yaml", "xml"]));
      const result = suggest(parser, ["-f", "j"]);
      deepStrictEqual(result, [{ kind: "literal", text: "json" }]);
    });

    it("should handle boolean flags without values", () => {
      const parser = option("-v", "--verbose");
      const result = suggest(parser, ["-v", "something"]);
      deepStrictEqual(result, []);
    });

    it("should suggest --option=value format with matching prefix", () => {
      const parser = option("-f", "--format", choice(["json", "yaml", "xml"]));
      const result = suggest(parser, ["--format=j"]);
      deepStrictEqual(result, [{
        kind: "literal",
        text: "--format=json",
        description: undefined,
      }]);
    });

    it("should suggest all values for --option= format", () => {
      const parser = option("-f", "--format", choice(["json", "yaml", "xml"]));
      const result = suggest(parser, ["--format="]);
      const expectedTexts = result.map((s) => extractText(s)).sort();
      deepStrictEqual(expectedTexts, [
        "--format=json",
        "--format=xml",
        "--format=yaml",
      ]);
    });

    it("should suggest -option=value format for short options", () => {
      const parser = option("-f", "--format", choice(["json", "yaml", "xml"]));
      const result = suggest(parser, ["-f=y"]);
      deepStrictEqual(result, [{
        kind: "literal",
        text: "-f=yaml",
        description: undefined,
      }]);
    });

    it("should return empty for --option=value when option doesn't match", () => {
      const parser = option("-f", "--format", choice(["json", "yaml", "xml"]));
      const result = suggest(parser, ["--output=json"]);
      deepStrictEqual(result, []);
    });

    it("should return empty for --option=value when value doesn't match", () => {
      const parser = option("-f", "--format", choice(["json", "yaml", "xml"]));
      const result = suggest(parser, ["--format=html"]);
      deepStrictEqual(result, []);
    });

    it("should work with exact match in --option=value format", () => {
      const parser = option("-f", "--format", choice(["json", "yaml", "xml"]));
      const result = suggest(parser, ["--format=xml"]);
      deepStrictEqual(result, [{
        kind: "literal",
        text: "--format=xml",
        description: undefined,
      }]);
    });
  });

  describe("flag parser suggestions", () => {
    it("should suggest flag names with prefix", () => {
      const parser = flag("-f", "--force", "--full");
      const result = suggest(parser, ["--f"]);
      const expectedTexts = result.map((s) => extractText(s)).sort();
      deepStrictEqual(expectedTexts, ["--force", "--full"]);
    });

    it("should not suggest values after flag", () => {
      const parser = flag("-f", "--force");
      const result = suggest(parser, ["-f", "something"]);
      deepStrictEqual(result, []);
    });
  });

  describe("argument parser suggestions", () => {
    it("should delegate to value parser", () => {
      const parser = argument(choice(["start", "stop", "restart"]));
      const result = suggest(parser, ["st"]);
      const expectedTexts = result.map((s) => extractText(s)).sort();
      deepStrictEqual(expectedTexts, ["start", "stop"]);
    });

    it("should handle string arguments", () => {
      const parser = argument(string());
      const result = suggest(parser, ["test"]);
      // String parser doesn't provide completions by default
      deepStrictEqual(result, []);
    });
  });

  describe("command parser suggestions", () => {
    it("should suggest command name when not matched", () => {
      const innerParser = option("-v", "--verbose");
      const parser = command("build", innerParser, {
        description: message`Build the project`,
      });
      const result = suggest(parser, ["bu"]);
      deepStrictEqual(result, [{
        kind: "literal",
        text: "build",
        description: message`Build the project`,
      }]);
    });

    it("should delegate to inner parser after command matched", () => {
      const innerParser = option("-v", "--verbose");
      const parser = command("build", innerParser);
      const result = suggest(parser, ["build", "--v"]);
      deepStrictEqual(result, [{ kind: "literal", text: "--verbose" }]);
    });

    it("should not suggest command when prefix doesn't match", () => {
      const innerParser = option("-v", "--verbose");
      const parser = command("build", innerParser);
      const result = suggest(parser, ["deploy"]);
      deepStrictEqual(result, []);
    });
  });

  describe("object parser suggestions", () => {
    it("should combine suggestions from all parsers", () => {
      const parser = object({
        verbose: option("-v", "--verbose"),
        output: option("-o", "--output", string()),
        force: flag("-f", "--force"),
      });
      const result = suggest(parser, ["--"]);
      const expectedTexts = result.map((s) => extractText(s)).sort();
      deepStrictEqual(expectedTexts, ["--force", "--output", "--verbose"]);
    });

    it("should remove duplicate suggestions", () => {
      const parser = object({
        verbose1: option("-v", "--verbose"),
        verbose2: option("-v", "--verbose"), // Same option names
      });
      const result = suggest(parser, ["--v"]);
      deepStrictEqual(result, [{ kind: "literal", text: "--verbose" }]);
    });

    it("should work with complex nested structure", () => {
      const parser = object({
        server: object({
          port: option("-p", "--port", integer()),
          host: option("-h", "--host", string()),
        }),
        debug: option("-d", "--debug"),
      });
      const result = suggest(parser, ["--p"]);
      deepStrictEqual(result, [{ kind: "literal", text: "--port" }]);
    });

    it("should provide context-aware suggestions", () => {
      const parser = object({
        input: option("-i", "--input", string()),
        output: option("-o", "--output", string()),
      });
      const result = suggest(parser, ["-i", "file.txt", "--o"]);
      deepStrictEqual(result, [{ kind: "literal", text: "--output" }]);
    });
  });

  describe("or parser suggestions", () => {
    it("should combine suggestions from all alternatives", () => {
      const parserA = option("-a", "--alpha");
      const parserB = option("-b", "--beta");
      const parser = or(parserA, parserB);
      const result = suggest(parser, ["--"]);
      const expectedTexts = result.map((s) => extractText(s)).sort();
      deepStrictEqual(expectedTexts, ["--alpha", "--beta"]);
    });

    it("should delegate to selected parser", () => {
      const parserA = object({
        verbose: option("-v", "--verbose"),
        file: option("-f", "--file", string()),
      });
      const parserB = object({
        quiet: option("-q", "--quiet"),
        output: option("-o", "--output", string()),
      });
      const parser = or(parserA, parserB);

      // After parsing -v, should only suggest from parserA
      const result = suggest(parser, ["-v", "--f"]);
      deepStrictEqual(result, [{ kind: "literal", text: "--file" }]);
    });

    it("should handle commands in or parser", () => {
      const buildCmd = command("build", option("-v", "--verbose"));
      const testCmd = command("test", option("-c", "--coverage"));
      const parser = or(buildCmd, testCmd);

      const result = suggest(parser, ["t"]);
      deepStrictEqual(result, [{ kind: "literal", text: "test" }]);
    });
  });

  describe("modifier parser suggestions", () => {
    describe("optional", () => {
      it("should delegate to wrapped parser", () => {
        const parser = optional(option("-v", "--verbose"));
        const result = suggest(parser, ["--v"]);
        deepStrictEqual(result, [{ kind: "literal", text: "--verbose" }]);
      });

      it("should work when optional parser not triggered", () => {
        const parser = object({
          verbose: optional(option("-v", "--verbose")),
          output: option("-o", "--output", string()),
        });
        const result = suggest(parser, ["--o"]);
        deepStrictEqual(result, [{ kind: "literal", text: "--output" }]);
      });
    });

    describe("withDefault", () => {
      it("should delegate to wrapped parser", () => {
        const parser = withDefault(option("-p", "--port", integer()), 8080);
        const result = suggest(parser, ["--p"]);
        deepStrictEqual(result, [{ kind: "literal", text: "--port" }]);
      });

      it("should work with function defaults", () => {
        const parser = withDefault(
          option("-u", "--user", string()),
          () => "default-user",
        );
        const result = suggest(parser, ["--u"]);
        deepStrictEqual(result, [{ kind: "literal", text: "--user" }]);
      });
    });

    describe("map", () => {
      it("should delegate to wrapped parser", () => {
        const parser = map(
          option("-n", "--number", integer()),
          (n) => n.toString(),
        );
        const result = suggest(parser, ["--n"]);
        deepStrictEqual(result, [{ kind: "literal", text: "--number" }]);
      });

      it("should preserve original suggestions", () => {
        const parser = map(
          option("-f", "--format", choice(["json", "yaml"])),
          (format) => format.toUpperCase(),
        );
        const result = suggest(parser, ["-f", "j"]);
        deepStrictEqual(result, [{ kind: "literal", text: "json" }]);
      });
    });

    describe("multiple", () => {
      it("should suggest for repeated items", () => {
        const parser = multiple(option("-f", "--file", string()));
        const result = suggest(parser, ["--f"]);
        deepStrictEqual(result, [{ kind: "literal", text: "--file" }]);
      });

      it("should work with multiple occurrences", () => {
        const parser = multiple(option("-i", "--include", string()));
        const result = suggest(parser, ["-i", "first.txt", "--i"]);
        deepStrictEqual(result, [{ kind: "literal", text: "--include" }]);
      });

      // Regression test for https://github.com/dahlia/optique/issues/73
      it("should exclude already selected values from suggestions", () => {
        const parser = multiple(argument(choice(["alpha", "beta", "gamma"])));

        // When no values are selected yet, all choices should be suggested
        const result1 = suggest(parser, [""]);
        const texts1 = result1.map((s) => extractText(s)).sort();
        deepStrictEqual(texts1, ["alpha", "beta", "gamma"]);

        // After selecting "alpha", it should be excluded from suggestions
        const result2 = suggest(parser, ["alpha", ""]);
        const texts2 = result2.map((s) => extractText(s)).sort();
        deepStrictEqual(texts2, ["beta", "gamma"]);

        // After selecting "alpha" and "gamma", both should be excluded
        const result3 = suggest(parser, ["alpha", "gamma", ""]);
        const texts3 = result3.map((s) => extractText(s)).sort();
        deepStrictEqual(texts3, ["beta"]);

        // After selecting all values, no suggestions should remain
        const result4 = suggest(parser, ["alpha", "beta", "gamma", ""]);
        const texts4 = result4.map((s) => extractText(s)).sort();
        deepStrictEqual(texts4, []);
      });

      // Regression test for https://github.com/dahlia/optique/issues/73
      it("should exclude already selected values for options", () => {
        const parser = multiple(
          option("-t", "--tag", choice(["v1", "v2", "v3"])),
        );

        // When no values are selected yet, all choices should be suggested
        const result1 = suggest(parser, ["-t", ""]);
        const texts1 = result1.map((s) => extractText(s)).sort();
        deepStrictEqual(texts1, ["v1", "v2", "v3"]);

        // After selecting "v1", it should be excluded from suggestions
        const result2 = suggest(parser, ["-t", "v1", "-t", ""]);
        const texts2 = result2.map((s) => extractText(s)).sort();
        deepStrictEqual(texts2, ["v2", "v3"]);
      });
    });
  });

  describe("complex real-world scenarios", () => {
    it("should handle CLI tool with subcommands", () => {
      const buildParser = object({
        verbose: option("-v", "--verbose"),
        target: option("-t", "--target", choice(["debug", "release"])),
        output: option("-o", "--output", string()),
      });

      const testParser = object({
        coverage: option("-c", "--coverage"),
        filter: option("-f", "--filter", string()),
        parallel: option("-j", "--jobs", integer()),
      });

      const deployParser = object({
        environment: option("-e", "--env", choice(["staging", "production"])),
        force: flag("--force"),
      });

      const parser = or(
        command("build", buildParser),
        command("test", testParser),
        command("deploy", deployParser),
      );

      // Test command suggestions
      const cmdResult = suggest(parser, ["b"]);
      deepStrictEqual(cmdResult, [{ kind: "literal", text: "build" }]);

      // Test options after command
      const buildResult = suggest(parser, ["build", "--t"]);
      deepStrictEqual(buildResult, [{ kind: "literal", text: "--target" }]);

      // Test value suggestions
      const targetResult = suggest(parser, ["build", "--target", "d"]);
      deepStrictEqual(targetResult, [{ kind: "literal", text: "debug" }]);

      // Test different subcommand
      const testResult = suggest(parser, ["test", "--c"]);
      deepStrictEqual(testResult, [{ kind: "literal", text: "--coverage" }]);
    });

    it("should handle nested object structures", () => {
      const serverConfig = object({
        port: option("-p", "--port", integer()),
        host: option("-h", "--host", string()),
        ssl: object({
          cert: option("--cert", string()),
          key: option("--key", string()),
        }),
      });

      const parser = object({
        server: serverConfig,
        database: object({
          url: option("--db-url", string()),
          pool: option("--db-pool", integer()),
        }),
        verbose: option("-v", "--verbose"),
      });

      // Test top-level suggestions
      const topResult = suggest(parser, ["--p"]);
      deepStrictEqual(topResult, [{ kind: "literal", text: "--port" }]);

      // Test SSL options
      const sslResult = suggest(parser, ["--c"]);
      deepStrictEqual(sslResult, [{ kind: "literal", text: "--cert" }]);

      // Test database options
      const dbResult = suggest(parser, ["--db"]);
      const expectedTexts = dbResult.map((s) => extractText(s)).sort();
      deepStrictEqual(expectedTexts, ["--db-pool", "--db-url"]);
    });

    it("should handle git-like command structure", () => {
      const addParser = object({
        all: flag("-A", "--all"),
        patch: flag("-p", "--patch"),
        files: multiple(argument(string())),
      });

      const commitParser = object({
        message: option("-m", "--message", string()),
        all: flag("-a", "--all"),
        amend: flag("--amend"),
      });

      const pushParser = object({
        force: flag("-f", "--force"),
        upstream: flag("-u", "--set-upstream"),
        remote: argument(choice(["origin", "upstream"])),
        branch: optional(argument(string())),
      });

      const parser = or(
        command("add", addParser),
        command("commit", commitParser),
        command("push", pushParser),
      );

      // Test command suggestions
      const cmdResult = suggest(parser, ["c"]);
      deepStrictEqual(cmdResult, [{ kind: "literal", text: "commit" }]);

      // Test commit options
      const commitResult = suggest(parser, ["commit", "--"]);
      const expectedTexts = commitResult.map((s) => extractText(s)).sort();
      deepStrictEqual(expectedTexts, ["--all", "--amend", "--message"]);

      // Test push with remote suggestions
      const pushResult = suggest(parser, ["push", "o"]);
      deepStrictEqual(pushResult, [{ kind: "literal", text: "origin" }]);
    });

    it("should handle package manager-like structure", () => {
      const installParser = object({
        save: flag("-S", "--save"),
        saveDev: flag("-D", "--save-dev"),
        global: flag("-g", "--global"),
        packages: multiple(argument(string())),
      });

      const runParser = object({
        script: argument(choice(["start", "build", "test", "lint"])),
        args: multiple(argument(string())),
      });

      const parser = object({
        command: or(
          command("install", installParser),
          command("run", runParser),
        ),
        verbose: option("-v", "--verbose"),
      });

      // Test nested command suggestions
      const installResult = suggest(parser, ["install", "--s"]);
      const expectedTexts = installResult.map((s) => extractText(s)).sort();
      deepStrictEqual(expectedTexts, ["--save", "--save-dev"]);

      // Test script suggestions
      const runResult = suggest(parser, ["run", "t"]);
      deepStrictEqual(runResult, [{ kind: "literal", text: "test" }]);
    });
  });

  describe("edge cases", () => {
    it("should handle empty buffer gracefully", () => {
      const parser = option("-v", "--verbose");
      const result = suggest(parser, [""]);
      deepStrictEqual(result, []);
    });

    it("should handle parser with no suggestions", () => {
      const parser = constant("value");
      const result = suggest(parser, ["anything"]);
      deepStrictEqual(result, []);
    });

    it("should handle deeply nested structures", () => {
      const deepParser = object({
        level1: object({
          level2: object({
            level3: option("--deep", string()),
          }),
        }),
      });

      const result = suggest(deepParser, ["--d"]);
      deepStrictEqual(result, [{ kind: "literal", text: "--deep" }]);
    });

    it("should handle circular-like references safely", () => {
      const parser = object({
        recursive: optional(option("-r", "--recursive")),
        output: option("-o", "--output", string()),
      });

      const result = suggest(parser, ["-r", "--o"]);
      deepStrictEqual(result, [{ kind: "literal", text: "--output" }]);
    });

    it("should handle malformed input gracefully", () => {
      const parser = object({
        valid: option("-v", "--valid"),
      });

      // Test with invalid option-like prefix
      const result = suggest(parser, ["---invalid"]);
      deepStrictEqual(result, []);
    });
  });
});
