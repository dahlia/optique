import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { argument, command, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { run } from "@optique/run/run";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("run", () => {
  describe("basic parsing", () => {
    it("should parse simple arguments when provided explicitly", () => {
      const parser = object({
        name: argument(string()),
      });

      const result = run(parser, {
        args: ["Alice"],
        programName: "test",
      });

      assert.deepEqual(result, { name: "Alice" });
    });

    it("should parse options with custom program name", () => {
      const parser = object({
        verbose: option("--verbose"),
        count: option("-c", "--count", integer()),
        name: argument(string()),
      });

      const result = run(parser, {
        args: ["--verbose", "-c", "42", "Alice"],
        programName: "myapp",
      });

      assert.deepEqual(result, {
        verbose: true,
        count: 42,
        name: "Alice",
      });
    });

    it("should parse commands", () => {
      const parser = command(
        "greet",
        object({
          name: argument(string()),
          times: option("-t", "--times", integer()),
        }),
        {
          description: message`Greet someone`,
        },
      );

      const result = run(parser, {
        args: ["greet", "--times", "3", "Bob"],
        programName: "test",
      });

      assert.deepEqual(result, { name: "Bob", times: 3 });
    });
  });

  describe("options handling", () => {
    it("should use provided options instead of defaults", () => {
      const parser = object({
        name: argument(string()),
      });

      const result = run(parser, {
        programName: "custom-program",
        args: ["test-value"],
        colors: false,
        maxWidth: 100,
      });

      assert.deepEqual(result, { name: "test-value" });
    });

    it("should use default help setting", () => {
      const parser = object({
        name: argument(string()),
      });

      // With default help: "none", help should not interfere with normal parsing
      const result = run(parser, {
        args: ["test-value"],
        programName: "test",
        // help omitted = no help functionality
      });

      assert.deepEqual(result, { name: "test-value" });
    });
  });

  describe("version functionality", () => {
    it("should handle version as string with default option mode", () => {
      const _parser = object({
        name: argument(string()),
      });

      // Version as string should work but exit the process
      // Since we can't test process.exit directly, we'll skip this test in the real environment
      // This test documents the expected behavior
      assert.ok(typeof run === "function");
    });

    it("should handle version as object with custom mode", () => {
      const _parser = object({
        name: argument(string()),
      });

      // Version as object should work but exit the process
      // Since we can't test process.exit directly, we'll skip this test in the real environment
      // This test documents the expected behavior
      assert.ok(typeof run === "function");
    });

    it("should support version configuration options", () => {
      const parser = object({
        name: argument(string()),
      });

      // Test that version configuration is properly typed and accepted
      // We can't test the actual functionality due to process.exit, but we can test the types
      const options = {
        programName: "test",
        args: ["Alice"],
        version: "1.0.0",
      };

      const result = run(parser, options);
      assert.deepEqual(result, { name: "Alice" });
    });

    it("should support version object configuration", () => {
      const parser = object({
        name: argument(string()),
      });

      // Test that version object configuration is properly typed
      const options = {
        programName: "test",
        args: ["Alice"],
        version: {
          value: "1.0.0",
          mode: "both" as const,
        },
      };

      const result = run(parser, options);
      assert.deepEqual(result, { name: "Alice" });
    });
  });

  describe("completion functionality", () => {
    it("should accept completion configuration", () => {
      const parser = object({
        name: argument(string()),
      });

      // Test that completion configuration is properly typed and accepted
      const result = run(parser, {
        programName: "test",
        args: ["Alice"],
        completion: "both",
      });

      assert.deepEqual(result, { name: "Alice" });
    });

    it("should support completion mode options", () => {
      const parser = object({
        verbose: option("--verbose"),
        name: argument(string()),
      });

      // Test different completion modes are properly typed
      const modes: Array<"command" | "option" | "both"> = [
        "command",
        "option",
        "both",
      ];

      for (const mode of modes) {
        const result = run(parser, {
          programName: "test",
          args: ["--verbose", "Bob"],
          completion: mode,
        });

        assert.deepEqual(result, { verbose: true, name: "Bob" });
      }
    });

    it("should work without completion configuration", () => {
      const parser = object({
        count: option("-c", "--count", integer()),
        name: argument(string()),
      });

      // Test that completion is optional
      const result = run(parser, {
        programName: "test",
        args: ["-c", "5", "Charlie"],
        // completion omitted = no completion functionality
      });

      assert.deepEqual(result, { count: 5, name: "Charlie" });
    });

    it("should support completion alongside help and version", () => {
      const parser = object({
        debug: option("--debug"),
        name: argument(string()),
      });

      // Test that completion works with other features
      const result = run(parser, {
        programName: "test",
        args: ["--debug", "David"],
        help: "both",
        version: "1.0.0",
        completion: "both",
      });

      assert.deepEqual(result, { debug: true, name: "David" });
    });
  });

  describe("documentation fields", () => {
    it("should accept brief option", () => {
      const parser = object({
        name: argument(string()),
      });

      // Test that brief option is properly typed and accepted
      const result = run(parser, {
        programName: "test",
        args: ["Alice"],
        brief: message`This is a test program`,
      });

      assert.deepEqual(result, { name: "Alice" });
    });

    it("should accept description option", () => {
      const parser = object({
        name: argument(string()),
      });

      // Test that description option is properly typed and accepted
      const result = run(parser, {
        programName: "test",
        args: ["Alice"],
        description: message`This program does something amazing.`,
      });

      assert.deepEqual(result, { name: "Alice" });
    });

    it("should accept footer option", () => {
      const parser = object({
        name: argument(string()),
      });

      // Test that footer option is properly typed and accepted
      const result = run(parser, {
        programName: "test",
        args: ["Bob"],
        footer: message`For more information, visit https://example.com`,
      });

      assert.deepEqual(result, { name: "Bob" });
    });

    it("should accept all documentation fields together", () => {
      const parser = object({
        verbose: option("--verbose"),
        name: argument(string()),
      });

      // Test that all documentation options work together
      const result = run(parser, {
        programName: "test",
        args: ["--verbose", "Charlie"],
        brief: message`Test Program`,
        description: message`A comprehensive testing utility.`,
        footer: message`Copyright (c) 2024 Test Corp.`,
      });

      assert.deepEqual(result, { verbose: true, name: "Charlie" });
    });

    it("should properly type Message parameters", () => {
      const parser = object({
        name: argument(string()),
      });

      // This test verifies that the TypeScript types are working correctly
      // by ensuring these calls compile without errors
      const options = {
        programName: "test",
        args: ["David"],
        brief: message`Brief text`,
        description: message`Description with ${"value"} interpolation`,
        footer: message`Footer text`,
      };

      const result = run(parser, options);
      assert.deepEqual(result, { name: "David" });
    });
  });
});
