import { message } from "@optique/core/message";
import { object, or } from "@optique/core/parser";
import { argument, command, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { run } from "@optique/run/run";
import assert from "node:assert/strict";
import process from "node:process";
import { describe, it } from "node:test";

describe("run() integration tests", () => {
  // Store original process values
  let originalArgv: string[];
  let originalExit: typeof process.exit;

  const setup = () => {
    originalArgv = process.argv;
    originalExit = process.exit;
  };

  const teardown = () => {
    process.argv = originalArgv;
    process.exit = originalExit;
  };

  describe("real-world scenarios", () => {
    it("should handle typical CLI patterns", () => {
      setup();
      try {
        process.argv = [
          "node",
          "file-processor.js",
          "input.txt",
          "-o",
          "output.txt",
          "--verbose",
          "-j",
          "4",
        ];

        const parser = object({
          input: argument(string()),
          output: option("-o", "--output", string()),
          verbose: option("-v", "--verbose"),
          jobs: option("-j", "--jobs", integer()),
        });

        const result = run(parser, {
          programName: "file-processor",
        });

        assert.deepEqual(result, {
          input: "input.txt",
          output: "output.txt",
          verbose: true,
          jobs: 4,
        });
      } finally {
        teardown();
      }
    });

    it("should work with command hierarchies", () => {
      setup();
      try {
        process.argv = [
          "node",
          "git-like.js",
          "commit",
          "-m",
          "Initial commit",
          "--author",
          "Alice",
        ];

        const parser = command(
          "commit",
          object({
            message: option("-m", "--message", string()),
            author: option("--author", string()),
          }),
          {
            description: message`Create a new commit`,
          },
        );

        const result = run(parser, {
          programName: "git-like",
          help: "both",
        });

        assert.deepEqual(result, {
          message: "Initial commit",
          author: "Alice",
        });
      } finally {
        teardown();
      }
    });

    it("should handle multiple commands", () => {
      setup();
      try {
        process.argv = ["node", "cli.js", "build", "--minify"];

        const parser = or(
          command(
            "build",
            object({
              minify: option("--minify"),
            }),
          ),
          command(
            "serve",
            object({
              port: option("-p", "--port", integer()),
            }),
          ),
        );

        const result = run(parser);
        assert.deepEqual(result, { minify: true });
      } finally {
        teardown();
      }
    });
  });

  describe("environment integration", () => {
    it("should extract program name correctly", () => {
      setup();
      try {
        process.argv = ["node", "/usr/local/bin/my-awesome-tool", "test"];

        const parser = object({
          value: argument(string()),
        });

        const result = run(parser);
        assert.deepEqual(result, { value: "test" });
      } finally {
        teardown();
      }
    });

    it("should allow overriding all auto-detected settings", () => {
      setup();
      try {
        process.argv = ["node", "script.js", "original-arg"];

        const parser = object({
          value: argument(string()),
        });

        const result = run(parser, {
          programName: "custom-name",
          args: ["custom-arg"],
          colors: false,
          maxWidth: 120,
        });

        assert.deepEqual(result, { value: "custom-arg" });
      } finally {
        teardown();
      }
    });

    it("should work with explicit options instead of auto-detection", () => {
      setup();
      try {
        // Don't modify process.argv, just use explicit options
        const parser = object({
          value: argument(string()),
        });

        const result = run(parser, {
          programName: "test-cli",
          args: ["test-value"],
          colors: false,
          maxWidth: 80,
        });

        assert.deepEqual(result, { value: "test-value" });
      } finally {
        teardown();
      }
    });
  });
});
