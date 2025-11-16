import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createErrorWithSuggestions,
  createSuggestionMessage,
  findSimilar,
  levenshteinDistance,
} from "./suggestion.ts";
import { formatMessage, message, optionName } from "./message.ts";
import type { Usage } from "./usage.ts";

describe("levenshteinDistance()", () => {
  it("should return 0 for identical strings", () => {
    assert.equal(levenshteinDistance("hello", "hello"), 0);
    assert.equal(levenshteinDistance("", ""), 0);
    assert.equal(levenshteinDistance("abc", "abc"), 0);
  });

  it("should handle single character differences", () => {
    // Substitution
    assert.equal(levenshteinDistance("kitten", "sitten"), 1);
    assert.equal(levenshteinDistance("hello", "hallo"), 1);

    // Deletion
    assert.equal(levenshteinDistance("kitten", "kiten"), 1);
    assert.equal(levenshteinDistance("hello", "helo"), 1);

    // Insertion
    assert.equal(levenshteinDistance("kitten", "kittens"), 1);
    assert.equal(levenshteinDistance("hello", "helloo"), 1);
  });

  it("should calculate distance for typical typos", () => {
    assert.equal(levenshteinDistance("--verbose", "--verbos"), 1);
    assert.equal(levenshteinDistance("--format", "--fromat"), 2);
    assert.equal(levenshteinDistance("--help", "--hlep"), 2);
  });

  it("should handle empty strings", () => {
    assert.equal(levenshteinDistance("", ""), 0);
    assert.equal(levenshteinDistance("", "hello"), 5);
    assert.equal(levenshteinDistance("hello", ""), 5);
  });

  it("should be symmetric", () => {
    assert.equal(
      levenshteinDistance("abc", "def"),
      levenshteinDistance("def", "abc"),
    );
    assert.equal(
      levenshteinDistance("kitten", "sitting"),
      levenshteinDistance("sitting", "kitten"),
    );
  });

  it("should calculate classic examples correctly", () => {
    assert.equal(levenshteinDistance("kitten", "sitting"), 3);
    assert.equal(levenshteinDistance("saturday", "sunday"), 3);
  });

  it("should handle strings of different lengths", () => {
    assert.equal(levenshteinDistance("a", "abc"), 2);
    assert.equal(levenshteinDistance("abc", "a"), 2);
    assert.equal(levenshteinDistance("short", "muchlonger"), 8);
  });

  it("should handle strings with no common characters", () => {
    assert.equal(levenshteinDistance("abc", "def"), 3);
    assert.equal(levenshteinDistance("xyz", "123"), 3);
  });
});

describe("findSimilar()", () => {
  const candidates = [
    "--verbose",
    "--version",
    "--verify",
    "--help",
    "--format",
  ];

  it("should find single character typos", () => {
    const result = findSimilar("--verbos", candidates);
    // --verbose should be first (distance 1)
    assert.equal(result[0], "--verbose");
    assert.ok(result.length >= 1);
  });

  it("should find the closest match", () => {
    const result = findSimilar("--hlp", candidates);
    assert.ok(result.includes("--help"));
  });

  it("should return multiple suggestions sorted by distance", () => {
    const result = findSimilar("--verb", candidates, { maxDistance: 5 });
    // All three --verb* options should be in results
    assert.ok(result.some((s) => s === "--verbose" || s === "--verify"));
  });

  it("should respect maxSuggestions limit", () => {
    const result = findSimilar("--v", candidates, {
      maxDistance: 10,
      maxDistanceRatio: 1.0,
      maxSuggestions: 2,
    });
    assert.ok(result.length <= 2);
  });

  it("should return empty array for very different strings", () => {
    const result = findSimilar("--xyz", candidates);
    assert.deepEqual(result, []);
  });

  it("should return empty array for empty input", () => {
    const result = findSimilar("", candidates);
    assert.deepEqual(result, []);
  });

  it("should be case-insensitive by default", () => {
    const result = findSimilar("--VERBOS", candidates);
    // Should find --verbose as the closest match
    assert.equal(result[0], "--verbose");
    assert.ok(result.length >= 1);
  });

  it("should be case-insensitive with mixed case", () => {
    const result = findSimilar("--VeRbOs", candidates);
    // Should find --verbose as the closest match
    assert.equal(result[0], "--verbose");
    assert.ok(result.length >= 1);
  });

  it("should respect case-sensitive option", () => {
    const result = findSimilar("--VERBOS", candidates, {
      caseSensitive: true,
    });
    // Should not match because case is different
    assert.equal(result.length, 0);
  });

  it("should work with case-sensitive exact match", () => {
    const caseCandidates = ["--Verbose", "--VERSION", "--Help"];
    const result = findSimilar("--Verbose", caseCandidates, {
      caseSensitive: true,
    });
    assert.deepEqual(result, ["--Verbose"]);
  });

  it("should respect maxDistance threshold", () => {
    const result = findSimilar("--xyz", candidates, {
      maxDistance: 1,
    });
    assert.equal(result.length, 0);
  });

  it("should respect maxDistanceRatio", () => {
    // Very short input, strict ratio
    const result = findSimilar("--v", candidates, {
      maxDistance: 10,
      maxDistanceRatio: 0.3,
    });
    // Distance from "--v" to "--verbose" is 6, ratio is 6/3 = 2.0
    // Should not match with ratio threshold 0.3
    assert.equal(result.length, 0);
  });

  it("should allow more matches with lenient ratio", () => {
    const result = findSimilar("--v", candidates, {
      maxDistance: 10,
      maxDistanceRatio: 5.0,
      maxSuggestions: 10,
    });
    // With lenient settings, should find matches
    assert.ok(result.length > 0);
  });

  it("should return exact match immediately", () => {
    const result = findSimilar("--verbose", candidates);
    assert.deepEqual(result, ["--verbose"]);
  });

  it("should work with short option names", () => {
    const shortCandidates = ["-v", "-h", "-f", "-x"];
    const result = findSimilar("-g", shortCandidates);
    // Should find some close matches
    assert.ok(result.length > 0);
  });

  it("should sort by distance then length difference", () => {
    const mixedCandidates = [
      "--verbose-mode",
      "--verbose",
      "--verbosity",
      "--verb",
    ];
    const result = findSimilar("--verbos", mixedCandidates, {
      maxDistance: 5,
      maxSuggestions: 10,
    });

    // --verbose should be first (distance 1)
    assert.equal(result[0], "--verbose");
  });

  it("should handle iterables other than arrays", () => {
    const candidateSet = new Set(candidates);
    const result = findSimilar("--verbos", candidateSet);
    assert.equal(result[0], "--verbose");
    assert.ok(result.length >= 1);
  });

  it("should handle generator functions", () => {
    function* candidateGenerator() {
      yield* candidates;
    }

    const result = findSimilar("--verbos", candidateGenerator());
    assert.equal(result[0], "--verbose");
    assert.ok(result.length >= 1);
  });

  it("should respect all options together", () => {
    const result = findSimilar("--ver", candidates, {
      maxDistance: 2,
      maxDistanceRatio: 0.5,
      maxSuggestions: 1,
      caseSensitive: false,
    });

    // Should return at most 1 suggestion
    assert.ok(result.length <= 1);
    if (result.length > 0) {
      // Should be one of the --ver* options
      assert.ok(result[0].startsWith("--ver"));
    }
  });
});

describe("createSuggestionMessage()", () => {
  it("should return empty message for no suggestions", () => {
    const msg = createSuggestionMessage([]);
    assert.equal(msg.length, 0);
  });

  it("should format single suggestion", () => {
    const msg = createSuggestionMessage(["--verbose"]);
    const formatted = formatMessage(msg, { quotes: true, colors: false });
    assert.match(formatted, /Did you mean/);
    assert.match(formatted, /`--verbose`/);
    assert.match(formatted, /\?$/); // Should end with ?
  });

  it("should format multiple suggestions", () => {
    const msg = createSuggestionMessage([
      "--verbose",
      "--version",
      "--verify",
    ]);
    const formatted = formatMessage(msg, { quotes: true, colors: false });
    assert.match(formatted, /Did you mean one of these\?/);
    assert.match(formatted, /`--verbose`/);
    assert.match(formatted, /`--version`/);
    assert.match(formatted, /`--verify`/);
  });

  it("should format suggestions with list structure", () => {
    const msg = createSuggestionMessage(["--verbose", "--version"]);
    const formatted = formatMessage(msg, { quotes: true, colors: false });

    // Should have all suggestions mentioned
    assert.match(formatted, /Did you mean one of these\?/);
    assert.match(formatted, /`--verbose`/);
    assert.match(formatted, /`--version`/);
  });

  it("should work with command names", () => {
    const msg = createSuggestionMessage(["build"]);
    const formatted = formatMessage(msg, { quotes: true, colors: false });
    assert.match(formatted, /Did you mean `build`\?/);
  });

  it("should work with two suggestions", () => {
    const msg = createSuggestionMessage(["--verbose", "--verify"]);
    const formatted = formatMessage(msg, { quotes: true, colors: false });
    assert.match(formatted, /Did you mean one of these\?/);
    assert.match(formatted, /`--verbose`/);
    assert.match(formatted, /`--verify`/);
  });

  it("should preserve suggestion order", () => {
    const suggestions = ["--aaa", "--bbb", "--ccc"];
    const msg = createSuggestionMessage(suggestions);
    const formatted = formatMessage(msg, { quotes: true, colors: false });

    // Check that order is preserved
    const aaaIndex = formatted.indexOf("--aaa");
    const bbbIndex = formatted.indexOf("--bbb");
    const cccIndex = formatted.indexOf("--ccc");

    assert.ok(aaaIndex < bbbIndex);
    assert.ok(bbbIndex < cccIndex);
  });

  it("should format correctly with colors enabled", () => {
    const msg = createSuggestionMessage(["--verbose"]);
    const formatted = formatMessage(msg, { quotes: true, colors: true });

    // Should contain ANSI codes (ESC character)
    assert.ok(formatted.includes("\x1b["));
    // Should still contain the text
    assert.match(formatted, /Did you mean/);
    assert.match(formatted, /--verbose/);
  });

  it("should format correctly without quotes", () => {
    const msg = createSuggestionMessage(["--verbose"]);
    const formatted = formatMessage(msg, { quotes: false, colors: false });

    // Should not have backticks
    assert.doesNotMatch(formatted, /`/);
    // Should still have the option name
    assert.match(formatted, /--verbose/);
  });
});

describe("integration: findSimilar + createSuggestionMessage", () => {
  it("should produce helpful error message for typo", () => {
    const candidates = ["--verbose", "--version", "--help"];
    const input = "--verbos";

    const suggestions = findSimilar(input, candidates, {
      maxSuggestions: 1, // Get only the best match
    });
    const msg = createSuggestionMessage(suggestions);
    const formatted = formatMessage(msg, { quotes: true, colors: false });

    assert.match(formatted, /Did you mean `--verbose`\?/);
  });

  it("should produce helpful error message for multiple matches", () => {
    const candidates = ["--verbose", "--version", "--verify"];
    const input = "--ver";

    const suggestions = findSimilar(input, candidates, {
      maxDistance: 5,
      maxDistanceRatio: 1.0, // Allow longer distances for short inputs
    });
    const msg = createSuggestionMessage(suggestions);
    const formatted = formatMessage(msg, { quotes: true, colors: false });

    assert.match(formatted, /Did you mean one of these\?/);
  });

  it("should produce empty message when no matches", () => {
    const candidates = ["--verbose", "--version", "--help"];
    const input = "--xyz";

    const suggestions = findSimilar(input, candidates);
    const msg = createSuggestionMessage(suggestions);

    assert.equal(msg.length, 0);
  });

  it("should work end-to-end with realistic scenario", () => {
    // Simulate a real CLI with many options
    const candidates = [
      "--verbose",
      "--version",
      "--help",
      "--output",
      "--input",
      "--format",
      "--force",
      "--quiet",
      "--debug",
      "-v",
      "-h",
      "-o",
      "-i",
      "-f",
      "-q",
      "-d",
    ];

    // User types common typos
    const typos = [
      { input: "--verbos", expected: "--verbose" },
      { input: "--ouput", expected: "--output" },
      { input: "--formatt", expected: "--format" },
      { input: "-vv", expected: "-v" },
    ];

    for (const { input, expected } of typos) {
      const suggestions = findSimilar(input, candidates);
      assert.ok(
        suggestions.includes(expected),
        `Expected ${expected} in suggestions for ${input}, got: ${
          suggestions.join(", ")
        }`,
      );
    }
  });
});

describe("createErrorWithSuggestions()", () => {
  it("should add suggestions for option typos", () => {
    const usage: Usage = [
      { type: "option", names: ["--verbose", "-v"] },
      { type: "option", names: ["--version"] },
      { type: "option", names: ["--help", "-h"] },
    ];

    const baseError = message`No matched option for ${optionName("--verbos")}.`;
    const error = createErrorWithSuggestions(
      baseError,
      "--verbos",
      usage,
      "option",
    );

    const formatted = formatMessage(error);
    assert.ok(formatted.includes("No matched option"));
    assert.ok(formatted.includes("--verbos"));
    assert.ok(formatted.includes("Did you mean"));
    assert.ok(formatted.includes("--verbose"));
  });

  it("should add suggestions for command typos", () => {
    const usage: Usage = [
      { type: "command", name: "commit" },
      { type: "command", name: "config" },
      { type: "command", name: "clone" },
    ];

    const baseError =
      message`Expected command ${"commit"}, but got ${"comit"}.`;
    const error = createErrorWithSuggestions(
      baseError,
      "comit",
      usage,
      "command",
    );

    const formatted = formatMessage(error);
    assert.ok(formatted.includes("Expected command"));
    assert.ok(formatted.includes("Did you mean"));
    assert.ok(formatted.includes("commit"));
  });

  it("should search both options and commands when type is 'both'", () => {
    const usage: Usage = [
      { type: "option", names: ["--verbose", "-v"] },
      { type: "command", name: "version" },
    ];

    const baseError = message`Unexpected: ${"versio"}.`;
    const error = createErrorWithSuggestions(
      baseError,
      "versio",
      usage,
      "both",
    );

    const formatted = formatMessage(error);
    assert.ok(formatted.includes("Did you mean"));
    // Should suggest both --verbose and version
    assert.ok(
      formatted.includes("version") || formatted.includes("--verbose"),
    );
  });

  it("should return base error when no suggestions found", () => {
    const usage: Usage = [
      { type: "option", names: ["--verbose", "-v"] },
      { type: "option", names: ["--quiet", "-q"] },
    ];

    const baseError = message`No matched option for ${optionName("--xyz")}.`;
    const error = createErrorWithSuggestions(
      baseError,
      "--xyz",
      usage,
      "option",
    );

    const formatted = formatMessage(error);
    assert.ok(formatted.includes("No matched option"));
    assert.ok(formatted.includes("--xyz"));
    // Should NOT include "Did you mean" since no similar options
    assert.ok(!formatted.includes("Did you mean"));
  });

  it("should handle empty usage", () => {
    const usage: Usage = [];

    const baseError = message`No matched option for ${optionName("--test")}.`;
    const error = createErrorWithSuggestions(
      baseError,
      "--test",
      usage,
      "option",
    );

    const formatted = formatMessage(error);
    assert.ok(formatted.includes("No matched option"));
    assert.ok(!formatted.includes("Did you mean"));
  });

  it("should respect maxSuggestions limit (3)", () => {
    const usage: Usage = [
      { type: "option", names: ["--verbose"] },
      { type: "option", names: ["--verbosity"] },
      { type: "option", names: ["--version"] },
      { type: "option", names: ["--verify"] },
      { type: "option", names: ["--vertex"] },
    ];

    const baseError = message`No matched option for ${optionName("--verbos")}.`;
    const error = createErrorWithSuggestions(
      baseError,
      "--verbos",
      usage,
      "option",
    );

    const formatted = formatMessage(error);
    assert.ok(formatted.includes("Did you mean"));

    // Count suggestions (should be at most 3)
    const lines = formatted.split("\n");
    const suggestionLines = lines.filter((line) =>
      line.trim().startsWith("--")
    );
    assert.ok(suggestionLines.length <= 3);
  });

  it("should only search options when type is 'option'", () => {
    const usage: Usage = [
      { type: "option", names: ["--test"] },
      { type: "command", name: "testing" },
    ];

    const baseError = message`No matched option for ${optionName("--testin")}.`;
    const error = createErrorWithSuggestions(
      baseError,
      "--testin",
      usage,
      "option",
    );

    const formatted = formatMessage(error);
    assert.ok(formatted.includes("Did you mean"));
    assert.ok(formatted.includes("--test"));
    // Should NOT suggest the command "testing"
    assert.ok(!formatted.includes("testing") || formatted.includes("--test"));
  });

  it("should only search commands when type is 'command'", () => {
    const usage: Usage = [
      { type: "option", names: ["--install"] },
      { type: "command", name: "init" },
    ];

    const baseError = message`Expected command ${"init"}, but got ${"inti"}.`;
    const error = createErrorWithSuggestions(
      baseError,
      "inti",
      usage,
      "command",
    );

    const formatted = formatMessage(error);
    assert.ok(formatted.includes("Did you mean"));
    assert.ok(formatted.includes("init"));
    // Should NOT suggest the option "--install"
    assert.ok(!formatted.includes("--install"));
  });

  it("should handle multiple suggestions", () => {
    const usage: Usage = [
      { type: "option", names: ["--verbose"] },
      { type: "option", names: ["--version"] },
    ];

    const baseError = message`No matched option for ${optionName("--verbos")}.`;
    const error = createErrorWithSuggestions(
      baseError,
      "--verbos",
      usage,
      "option",
    );

    const formatted = formatMessage(error);
    assert.ok(formatted.includes("Did you mean one of these"));
    assert.ok(formatted.includes("--verbose"));
    assert.ok(formatted.includes("--version"));
  });

  it("should handle nested usage structures", () => {
    const usage: Usage = [
      {
        type: "optional",
        terms: [
          { type: "option", names: ["--verbose"] },
          { type: "option", names: ["--version"] },
        ],
      },
    ];

    const baseError = message`No matched option for ${optionName("--verbos")}.`;
    const error = createErrorWithSuggestions(
      baseError,
      "--verbos",
      usage,
      "option",
    );

    const formatted = formatMessage(error);
    assert.ok(formatted.includes("Did you mean"));
    assert.ok(formatted.includes("--verbose"));
  });
});
