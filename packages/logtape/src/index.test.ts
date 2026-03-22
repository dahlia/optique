import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, readFile } from "node:fs/promises";
import { parse, suggestSync } from "@optique/core/parser";
import { object } from "@optique/core/constructs";
import { runParser } from "@optique/core/facade";
import { option } from "@optique/core/primitives";
import { withDefault } from "@optique/core/modifiers";
import { message } from "@optique/core/message";
import type { LogLevel } from "@logtape/logtape";

import {
  createConsoleSink,
  createLoggingConfig,
  createSink,
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

  describe("custom errors", () => {
    it("should support static invalidLevel message", () => {
      const parser = logLevel({
        errors: {
          invalidLevel: message`Bad level.`,
        },
      });
      const result = parser.parse("nope");
      assert.ok(!result.success);
      if (!result.success) {
        const text = result.error
          .map((part) => "text" in part ? part.text : "")
          .join("");
        assert.ok(text.includes("Bad level."));
      }
    });

    it("should support function invalidLevel message", () => {
      const parser = logLevel({
        errors: {
          invalidLevel: (input) => message`Unknown level: ${input}`,
        },
      });
      const result = parser.parse("LOUD");
      assert.ok(!result.success);
      if (!result.success) {
        const text = result.error
          .map((part) => "text" in part ? part.text : "")
          .join("");
        assert.ok(text.includes("Unknown level:"));
      }
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

  it("should fall back to warning index for unknown base level at runtime", () => {
    const parser = object({
      level: verbosity({ baseLevel: "invalid" as unknown as LogLevel }),
    });
    const result = parse(parser, ["-v"]);
    assert.ok(result.success);
    assert.equal(result.value.level, "info");
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

  it("should reject empty output path", () => {
    const parser = object({
      output: logOutput(),
    });
    const result = parse(parser, ["--log-output="]);
    assert.ok(!result.success);
  });

  it("should use custom empty path error", () => {
    const parser = object({
      output: logOutput({
        errors: {
          emptyPath: message`Output path is required.`,
        },
      }),
    });
    const result = parse(parser, ["--log-output=   "]);
    assert.ok(!result.success);
  });

  it("should use function-based empty path error", () => {
    const parser = object({
      output: logOutput({
        errors: {
          emptyPath: (input) => message`Output path cannot be blank: ${input}`,
        },
      }),
    });
    const result = parse(parser, ["--log-output=   "]);
    assert.ok(!result.success);
  });

  it("should suggest console and file outputs for value position", () => {
    const parser = object({
      output: logOutput(),
    });
    const suggestions = suggestSync(parser, ["--log-output", ""]);
    assert.ok(
      suggestions.some((s) => s.kind === "literal" && s.text === "-"),
    );
    assert.ok(
      suggestions.some((s) =>
        s.kind === "file" && s.type === "file" && s.pattern === ""
      ),
    );
  });

  it("should request hidden-file completion for dot-prefixed paths", () => {
    const parser = object({
      output: logOutput(),
    });
    const dotSuggestions = suggestSync(parser, ["--log-output", "."]);
    assert.ok(
      dotSuggestions.some((s) =>
        s.kind === "file" && s.type === "file" && s.includeHidden === true
      ),
    );
    const nestedDotSuggestions = suggestSync(parser, [
      "--log-output",
      "src/.",
    ]);
    assert.ok(
      nestedDotSuggestions.some((s) =>
        s.kind === "file" && s.type === "file" && s.includeHidden === true
      ),
    );
    const normalSuggestions = suggestSync(parser, ["--log-output", "src"]);
    assert.ok(
      normalSuggestions.some((s) =>
        s.kind === "file" && s.type === "file" && s.includeHidden === false
      ),
    );
    const dotdotSuggestions = suggestSync(parser, ["--log-output", ".."]);
    assert.ok(
      dotdotSuggestions.some((s) =>
        s.kind === "file" && s.type === "file" && s.includeHidden === false
      ),
    );
    const nestedDotdotSuggestions = suggestSync(parser, [
      "--log-output",
      "src/..",
    ]);
    assert.ok(
      nestedDotdotSuggestions.some((s) =>
        s.kind === "file" && s.type === "file" && s.includeHidden === false
      ),
    );
    const parentDirSuggestions = suggestSync(parser, [
      "--log-output",
      "../",
    ]);
    assert.ok(
      parentDirSuggestions.some((s) =>
        s.kind === "file" && s.type === "file" && s.includeHidden === false
      ),
    );
  });

  it("should format default console output in help text", () => {
    const parser = object({
      output: withDefault(logOutput(), { type: "console" }),
    });

    let helpOutput = "";
    const result = runParser(parser, "myapp", ["--help"], {
      help: { option: true, onShow: () => "shown" },
      showDefault: true,
      stdout: (text) => {
        helpOutput += text;
      },
    });
    assert.equal(result, "shown");
    assert.ok(helpOutput.includes('["-"]'));
  });

  it("should support custom option names", () => {
    const parser = object({
      output: logOutput({
        long: "--output",
        short: "-o",
      }),
    });
    const result = parse(parser, ["-o", "/tmp/optique.log"]);
    assert.ok(result.success);
    assert.deepEqual(result.value.output, {
      type: "file",
      path: "/tmp/optique.log",
    });
  });

  it("should render file default path in help output", () => {
    const parser = object({
      output: withDefault(logOutput(), {
        type: "file",
        path: "/var/log/optique.log",
      }),
    });
    let helpOutput = "";
    const result = runParser(parser, "myapp", ["--help"], {
      help: { option: true, onShow: () => "shown" },
      showDefault: true,
      stdout: (text) => {
        helpOutput += text;
      },
    });
    assert.equal(result, "shown");
    assert.ok(helpOutput.includes("/var/log/optique.log"));
  });

  it("should throw TypeError for empty metavar", () => {
    assert.throws(
      () => logOutput({ metavar: "" as never }),
      TypeError,
      "Expected a non-empty string.",
    );
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

    it("should respect custom option names and default", () => {
      const parser = object({
        logging: loggingOptions({
          level: "option",
          long: "--level",
          short: "-L",
          default: "error",
        }),
      });
      let result = parse(parser, []);
      assert.ok(result.success);
      assert.equal(result.value.logging.logLevel, "error");

      result = parse(parser, ["-L", "trace"]);
      assert.ok(result.success);
      assert.equal(result.value.logging.logLevel, "trace");
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

    it("should respect custom output long option", () => {
      const parser = object({
        logging: loggingOptions({
          level: "debug",
          output: { long: "--output-file" },
        }),
      });
      const result = parse(parser, ["--output-file=/tmp/custom.log"]);
      assert.ok(result.success);
      assert.deepEqual(result.value.logging.logOutput, {
        type: "file",
        path: "/tmp/custom.log",
      });
    });

    it("should force console output when output option is disabled", () => {
      const parser = object({
        logging: loggingOptions({
          level: "verbosity",
          output: { enabled: false },
        }),
      });
      const result = parse(parser, ["-v", "--log-output=/tmp/ignored.log"]);
      assert.ok(!result.success);

      const noOutputResult = parse(parser, ["-v"]);
      assert.ok(noOutputResult.success);
      assert.deepEqual(noOutputResult.value.logging.logOutput, {
        type: "console",
      });
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

  it("should write to stderr by default", () => {
    const sink = createConsoleSink();
    const originalError = console.error;
    const lines: string[] = [];
    console.error = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      sink({
        category: ["optique", "logtape"],
        level: "warning",
        message: ["hello ", "world"],
        rawMessage: "hello world",
        properties: {},
        timestamp: 1,
      });
    } finally {
      console.error = originalError;
    }
    assert.equal(lines.length, 1);
    assert.match(
      lines[0],
      /^1970-01-01T00:00:00\.001Z \[WARNING\] optique\.logtape: hello world$/,
    );
  });

  it("should format timestamp 0 as Unix epoch", () => {
    const sink = createConsoleSink({ stream: "stdout" });
    const originalLog = console.log;
    const lines: string[] = [];
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      sink({
        category: ["test"],
        level: "info",
        message: ["hello"],
        rawMessage: "hello",
        properties: {},
        timestamp: 0,
      });
    } finally {
      console.log = originalLog;
    }
    assert.equal(lines.length, 1);
    assert.match(
      lines[0],
      /^1970-01-01T00:00:00\.000Z \[INFO\s*\] test: hello$/,
    );
  });

  it("should fall back to current time for NaN timestamp", () => {
    const sink = createConsoleSink({ stream: "stdout" });
    const originalLog = console.log;
    const lines: string[] = [];
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      sink({
        category: ["test"],
        level: "info",
        message: ["hello"],
        rawMessage: "hello",
        properties: {},
        timestamp: NaN,
      });
    } finally {
      console.log = originalLog;
    }
    assert.equal(lines.length, 1);
    // Should not throw RangeError; should produce a valid ISO timestamp
    assert.match(
      lines[0],
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \[INFO\s*\] test: hello$/,
    );
  });

  it("should route by stream resolver", () => {
    const sink = createConsoleSink({
      streamResolver: (level) => level === "error" ? "stderr" : "stdout",
    });
    const originalError = console.error;
    const originalLog = console.log;
    const stderrLines: string[] = [];
    const stdoutLines: string[] = [];
    console.error = (line?: unknown) => {
      stderrLines.push(String(line));
    };
    console.log = (line?: unknown) => {
      stdoutLines.push(String(line));
    };
    try {
      sink({
        category: ["app"],
        level: "error",
        message: ["broken ", 500],
        rawMessage: "broken 500",
        properties: {},
        timestamp: 0,
      });
      sink({
        category: ["app"],
        level: "info",
        message: ["ok"],
        rawMessage: "ok",
        properties: {},
        timestamp: 0,
      });
    } finally {
      console.error = originalError;
      console.log = originalLog;
    }
    assert.equal(stderrLines.length, 1);
    assert.equal(stdoutLines.length, 1);
    assert.match(
      stderrLines[0],
      /^1970-01-01T00:00:00\.000Z \[ERROR\s*\] app: broken 500$/,
    );
    assert.match(
      stdoutLines[0],
      /^1970-01-01T00:00:00\.000Z \[INFO\s*\] app: ok$/,
    );
  });

  it("should throw TypeError for invalid static stream option", () => {
    assert.throws(
      () => createConsoleSink({ stream: "stdrr" as never }),
      {
        name: "TypeError",
        message: 'Invalid stream: expected "stdout" or "stderr", got "stdrr".',
      },
    );
  });

  it("should treat null stream as default stderr", () => {
    const sink = createConsoleSink({ stream: null });
    const originalError = console.error;
    const lines: string[] = [];
    console.error = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      sink({
        category: ["test"],
        level: "info",
        message: ["hello"],
        rawMessage: "hello",
        properties: {},
        timestamp: 1,
      });
    } finally {
      console.error = originalError;
    }
    assert.equal(lines.length, 1);
  });

  it("should ignore invalid stream when streamResolver is provided", () => {
    const sink = createConsoleSink({
      stream: "stdrr" as never,
      streamResolver: () => "stdout",
    });
    const originalLog = console.log;
    const lines: string[] = [];
    console.log = (line?: unknown) => {
      lines.push(String(line));
    };
    try {
      sink({
        category: ["test"],
        level: "info",
        message: ["hello"],
        rawMessage: "hello",
        properties: {},
        timestamp: 1,
      });
    } finally {
      console.log = originalLog;
    }
    assert.equal(lines.length, 1);
  });

  it("should throw TypeError for invalid streamResolver return value", () => {
    const sink = createConsoleSink({
      streamResolver: (() => "stdrr") as never,
    });
    assert.throws(
      () =>
        sink({
          category: ["test"],
          level: "info",
          message: ["hello"],
          rawMessage: "hello",
          properties: {},
          timestamp: 1,
        }),
      {
        name: "TypeError",
        message: 'Invalid stream: expected "stdout" or "stderr", got "stdrr".',
      },
    );
  });
});

describe("createSink()", () => {
  it("should declare @logtape/file in deno.json imports", async () => {
    const denoJson = JSON.parse(
      await readFile(
        new URL("../deno.json", import.meta.url),
        "utf-8",
      ),
    ) as Record<string, unknown>;
    const imports = denoJson.imports as Record<string, unknown> | undefined;
    assert.ok(
      imports?.["@logtape/file"],
      "deno.json must declare @logtape/file in imports for Deno to resolve " +
        "the dynamic import in createSink()",
    );
  });

  it("should create console sink for console output", async () => {
    const sink = await createSink({ type: "console" }, { stream: "stdout" });
    assert.equal(typeof sink, "function");
  });

  it("should create file sink for file output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "optique-test-"));
    const sink = await createSink({
      type: "file",
      path: join(dir, "test-sink.log"),
    });
    assert.equal(typeof sink, "function");
  });

  it("should propagate getFileSink() errors as-is", async () => {
    // When @logtape/file is installed but getFileSink() throws (e.g., the
    // target directory does not exist), the original error must propagate
    // without being rewritten as "File sink requires @logtape/file package".
    await assert.rejects(
      () =>
        createSink({
          type: "file",
          path: "/nonexistent/deeply/nested/path/test.log",
        }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(
          error.message,
          /File sink requires @logtape\/file package/,
        );
        return true;
      },
    );
  });
});

describe("createLoggingConfig()", () => {
  it("should create baseline config", async () => {
    const config = await createLoggingConfig({
      logLevel: "info",
      logOutput: { type: "console" },
    });
    assert.ok(typeof config.sinks.default === "function");
    assert.equal(config.loggers[0].lowestLevel, "info");
    assert.deepEqual(config.loggers[0].category, []);
    assert.deepEqual(config.loggers[0].sinks, ["default"]);
  });

  it("should merge additional sinks, loggers, and flags", async () => {
    const otherSink = () => {};
    const config = await createLoggingConfig(
      {
        logLevel: "debug",
        logOutput: { type: "console" },
      },
      {},
      {
        sinks: { other: otherSink },
        loggers: [{
          category: ["extra"],
          lowestLevel: "warning",
          sinks: ["other"],
        }],
        filters: {},
        reset: true,
      },
    );
    assert.ok(typeof config.sinks.default === "function");
    assert.equal(config.sinks.other, otherSink);
    assert.equal(config.loggers.length, 2);
    assert.equal(config.loggers[1].lowestLevel, "warning");
    assert.equal(config.reset, true);
    assert.deepEqual(config.filters, {});
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
