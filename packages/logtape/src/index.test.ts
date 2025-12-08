import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parse } from "@optique/core/parser";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { withDefault } from "@optique/core/modifiers";
import type { LogLevel } from "@logtape/logtape";

import {
  createConsoleSink,
  debug,
  LOG_LEVELS,
  loggingOptions,
  logLevel,
  logOutput,
  verbosity,
} from "./index.ts";

describe("logLevel()", () => {
  describe("parsing", () => {
    it("should parse valid log levels", () => {
      const parser = logLevel();
      for (const level of LOG_LEVELS) {
        const result = parser.parse(level);
        assert.ok(result.success, `Failed to parse ${level}`);
        assert.equal(result.value, level);
      }
    });

    it("should be case-insensitive", () => {
      const parser = logLevel();
      const testCases: [string, LogLevel][] = [
        ["DEBUG", "debug"],
        ["Debug", "debug"],
        ["INFO", "info"],
        ["WARNING", "warning"],
        ["ERROR", "error"],
        ["FATAL", "fatal"],
        ["TRACE", "trace"],
      ];

      for (const [input, expected] of testCases) {
        const result = parser.parse(input);
        assert.ok(result.success, `Failed to parse ${input}`);
        assert.equal(result.value, expected);
      }
    });

    it("should reject invalid levels", () => {
      const parser = logLevel();
      const invalidLevels = ["verbose", "warn", "err", "critical", ""];

      for (const level of invalidLevels) {
        const result = parser.parse(level);
        assert.ok(!result.success, `Should have rejected ${level}`);
      }
    });
  });

  describe("metavar", () => {
    it("should use default metavar", () => {
      const parser = logLevel();
      assert.equal(parser.metavar, "LEVEL");
    });

    it("should use custom metavar", () => {
      const parser = logLevel({ metavar: "LOG_LEVEL" });
      assert.equal(parser.metavar, "LOG_LEVEL");
    });
  });

  describe("suggestions", () => {
    it("should suggest matching levels", () => {
      const parser = logLevel();
      const suggestions = [...parser.suggest!("d")];
      assert.ok(suggestions.length > 0);
      assert.ok(
        suggestions.some((s) => s.kind === "literal" && s.text === "debug"),
      );
    });

    it("should suggest all levels for empty prefix", () => {
      const parser = logLevel();
      const suggestions = [...parser.suggest!("")];
      assert.equal(suggestions.length, LOG_LEVELS.length);
    });
  });
});

describe("verbosity()", () => {
  it("should return base level with no flags", () => {
    const parser = object({
      level: verbosity(),
    });
    const result = parse(parser, []);
    assert.ok(result.success);
    assert.equal(result.value.level, "warning");
  });

  it("should increase level with -v flags", () => {
    const parser = object({
      level: verbosity(),
    });

    // One -v flag -> info
    let result = parse(parser, ["-v"]);
    assert.ok(result.success);
    assert.equal(result.value.level, "info");

    // Two -v flags -> debug
    result = parse(parser, ["-v", "-v"]);
    assert.ok(result.success);
    assert.equal(result.value.level, "debug");

    // Three -v flags -> trace
    result = parse(parser, ["-v", "-v", "-v"]);
    assert.ok(result.success);
    assert.equal(result.value.level, "trace");
  });

  it("should cap at trace level", () => {
    const parser = object({
      level: verbosity(),
    });
    const result = parse(parser, ["-v", "-v", "-v", "-v", "-v"]);
    assert.ok(result.success);
    assert.equal(result.value.level, "trace");
  });

  it("should respect custom base level", () => {
    const parser = object({
      level: verbosity({ baseLevel: "error" }),
    });

    // No flags -> error
    let result = parse(parser, []);
    assert.ok(result.success);
    assert.equal(result.value.level, "error");

    // One flag -> warning
    result = parse(parser, ["-v"]);
    assert.ok(result.success);
    assert.equal(result.value.level, "warning");
  });

  it("should support long option", () => {
    const parser = object({
      level: verbosity(),
    });
    const result = parse(parser, ["--verbose", "--verbose"]);
    assert.ok(result.success);
    assert.equal(result.value.level, "debug");
  });
});

describe("debug()", () => {
  it("should return normal level without flag", () => {
    const parser = object({
      level: debug(),
    });
    const result = parse(parser, []);
    assert.ok(result.success);
    assert.equal(result.value.level, "info");
  });

  it("should return debug level with --debug flag", () => {
    const parser = object({
      level: debug(),
    });
    const result = parse(parser, ["--debug"]);
    assert.ok(result.success);
    assert.equal(result.value.level, "debug");
  });

  it("should return debug level with -d flag", () => {
    const parser = object({
      level: debug(),
    });
    const result = parse(parser, ["-d"]);
    assert.ok(result.success);
    assert.equal(result.value.level, "debug");
  });

  it("should respect custom levels", () => {
    const parser = object({
      level: debug({
        debugLevel: "trace",
        normalLevel: "warning",
      }),
    });

    // Without flag -> warning
    let result = parse(parser, []);
    assert.ok(result.success);
    assert.equal(result.value.level, "warning");

    // With flag -> trace
    result = parse(parser, ["--debug"]);
    assert.ok(result.success);
    assert.equal(result.value.level, "trace");
  });
});

describe("logOutput()", () => {
  it("should parse - as console output", () => {
    const parser = object({
      output: logOutput(),
    });
    const result = parse(parser, ["--log-output=-"]);
    assert.ok(result.success);
    assert.deepEqual(result.value.output, { type: "console" });
  });

  it("should parse file path", () => {
    const parser = object({
      output: logOutput(),
    });
    const result = parse(parser, ["--log-output=/var/log/app.log"]);
    assert.ok(result.success);
    assert.deepEqual(result.value.output, {
      type: "file",
      path: "/var/log/app.log",
    });
  });

  it("should return undefined when not specified", () => {
    const parser = object({
      output: logOutput(),
    });
    const result = parse(parser, []);
    assert.ok(result.success);
    assert.equal(result.value.output, undefined);
  });

  it("should parse relative file path", () => {
    const parser = object({
      output: logOutput(),
    });
    const result = parse(parser, ["--log-output=./logs/app.log"]);
    assert.ok(result.success);
    assert.deepEqual(result.value.output, {
      type: "file",
      path: "./logs/app.log",
    });
  });
});

describe("loggingOptions()", () => {
  describe("with level option", () => {
    it("should parse log level option", () => {
      const parser = object({
        logging: loggingOptions({ level: "option" }),
      });
      const result = parse(parser, ["--log-level=debug"]);
      assert.ok(result.success);
      assert.equal(result.value.logging.logLevel, "debug");
    });

    it("should use default level when not specified", () => {
      const parser = object({
        logging: loggingOptions({ level: "option" }),
      });
      const result = parse(parser, []);
      assert.ok(result.success);
      assert.equal(result.value.logging.logLevel, "info");
    });

    it("should parse log output option", () => {
      const parser = object({
        logging: loggingOptions({ level: "option" }),
      });
      const result = parse(parser, [
        "--log-level=debug",
        "--log-output=/tmp/app.log",
      ]);
      assert.ok(result.success);
      assert.equal(result.value.logging.logLevel, "debug");
      assert.deepEqual(result.value.logging.logOutput, {
        type: "file",
        path: "/tmp/app.log",
      });
    });

    it("should use short option", () => {
      const parser = object({
        logging: loggingOptions({ level: "option" }),
      });
      const result = parse(parser, ["-l", "warning"]);
      assert.ok(result.success);
      assert.equal(result.value.logging.logLevel, "warning");
    });
  });

  describe("with verbosity", () => {
    it("should parse verbosity flags", () => {
      const parser = object({
        logging: loggingOptions({ level: "verbosity" }),
      });

      let result = parse(parser, ["-v"]);
      assert.ok(result.success);
      assert.equal(result.value.logging.logLevel, "info");

      result = parse(parser, ["-v", "-v"]);
      assert.ok(result.success);
      assert.equal(result.value.logging.logLevel, "debug");
    });

    it("should use base level when no flags", () => {
      const parser = object({
        logging: loggingOptions({ level: "verbosity" }),
      });
      const result = parse(parser, []);
      assert.ok(result.success);
      assert.equal(result.value.logging.logLevel, "warning");
    });
  });

  describe("with debug flag", () => {
    it("should parse debug flag", () => {
      const parser = object({
        logging: loggingOptions({ level: "debug" }),
      });
      const result = parse(parser, ["--debug"]);
      assert.ok(result.success);
      assert.equal(result.value.logging.logLevel, "debug");
    });

    it("should use normal level without flag", () => {
      const parser = object({
        logging: loggingOptions({ level: "debug" }),
      });
      const result = parse(parser, []);
      assert.ok(result.success);
      assert.equal(result.value.logging.logLevel, "info");
    });
  });

  describe("default log output", () => {
    it("should default to console output", () => {
      const parser = object({
        logging: loggingOptions({ level: "option" }),
      });
      const result = parse(parser, []);
      assert.ok(result.success);
      assert.deepEqual(result.value.logging.logOutput, { type: "console" });
    });
  });
});

describe("createConsoleSink()", () => {
  it("should create a sink function", () => {
    const sink = createConsoleSink();
    assert.equal(typeof sink, "function");
  });

  it("should accept stream option", () => {
    const stderrSink = createConsoleSink({ stream: "stderr" });
    const stdoutSink = createConsoleSink({ stream: "stdout" });
    assert.equal(typeof stderrSink, "function");
    assert.equal(typeof stdoutSink, "function");
  });

  it("should accept streamResolver option", () => {
    const sink = createConsoleSink({
      streamResolver: (level) =>
        level === "error" || level === "fatal" ? "stderr" : "stdout",
    });
    assert.equal(typeof sink, "function");
  });
});

describe("integration", () => {
  it("should work with withDefault", () => {
    const parser = object({
      level: withDefault(option("--log-level", logLevel()), "info" as LogLevel),
    });

    // Without option -> default
    let result = parse(parser, []);
    assert.ok(result.success);
    assert.equal(result.value.level, "info");

    // With option -> specified value
    result = parse(parser, ["--log-level=debug"]);
    assert.ok(result.success);
    assert.equal(result.value.level, "debug");
  });
});
