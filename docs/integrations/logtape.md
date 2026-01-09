---
description: >-
  Integrate LogTape logging with Optique CLI applications using various
  parsing strategies for log levels, verbosity flags, and output destinations.
---

LogTape integration
===================

*This API is available since Optique 0.8.0.*

The *@optique/logtape* package provides seamless integration with [LogTape],
enabling you to configure logging through command-line arguments. This package
offers multiple approaches to control log verbosity and output destinations,
from simple debug flags to sophisticated verbosity accumulation.

::: code-group

~~~~ bash [Deno]
deno add --jsr @optique/logtape @logtape/logtape
~~~~

~~~~ bash [npm]
npm add @optique/logtape @logtape/logtape
~~~~

~~~~ bash [pnpm]
pnpm add @optique/logtape @logtape/logtape
~~~~

~~~~ bash [Yarn]
yarn add @optique/logtape @logtape/logtape
~~~~

~~~~ bash [Bun]
bun add @optique/logtape @logtape/logtape
~~~~

:::

[LogTape]: https://logtape.org/


Quick start
-----------

The fastest way to add logging configuration to your CLI is using the
`loggingOptions()` preset:

~~~~ typescript twoslash
import { loggingOptions, createLoggingConfig } from "@optique/logtape";
import { object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";
import { configure } from "@logtape/logtape";

const parser = object({
  logging: loggingOptions({ level: "verbosity" }),
});

const args = ["-vv", "--log-output=-"];
const result = parse(parser, args);
if (result.success) {
  const config = await createLoggingConfig(result.value.logging);
  await configure(config);
}
~~~~

This example enables:

 -  `-v`, `-vv`, `-vvv` flags for increasing verbosity
 -  `--log-output` option for directing logs to console (`-`) or a file


Log level value parser
----------------------

The `logLevel()` function creates a value parser for LogTape's `LogLevel` type.
It accepts log level strings and validates them against LogTape's supported
levels.

~~~~ typescript twoslash
import { logLevel } from "@optique/logtape";
import { option } from "@optique/core/primitives";
import { withDefault } from "@optique/core/modifiers";
import { object, merge } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";
import type { LogLevel } from "@logtape/logtape";

const parser = object({
  level: withDefault(
    option("--log-level", "-l", logLevel()),
    "info" as LogLevel
  ),
});

// Accepts: "trace", "debug", "info", "warning", "error", "fatal"
const result = parse(parser, ["--log-level=debug"]);
~~~~

### Features

 -  *Case-insensitive parsing*: Accepts `"DEBUG"`, `"Debug"`, `"debug"`
 -  *Shell completion*: Provides suggestions for all valid log levels
 -  *Custom metavar*: Default is `"LEVEL"`, customizable via options

### Options

~~~~ typescript twoslash
import { logLevel } from "@optique/logtape";
// ---cut-before---
const level = logLevel({
  metavar: "LOG_LEVEL",  // Custom metavar for help text
});
~~~~


Verbosity parser
----------------

The `verbosity()` parser implements the common `-v`/`-vv`/`-vvv` pattern for
controlling log verbosity. Each additional `-v` flag increases the verbosity
(decreases the log level severity).

~~~~ typescript twoslash
import { verbosity } from "@optique/logtape";
import { object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";

const parser = object({
  logLevel: verbosity(),
});

// No flags → "warning"
parse(parser, []);

// -v → "info"
parse(parser, ["-v"]);

// -vv → "debug"
parse(parser, ["-v", "-v"]);

// -vvv → "trace"
parse(parser, ["-v", "-v", "-v"]);

// Additional flags beyond -vvv stay at "trace"
parse(parser, ["-v", "-v", "-v", "-v"]);
~~~~

### Level mapping

With the default `baseLevel: "warning"`:

| Flags   | Level       |
| ------- | ----------- |
| (none)  | `"warning"` |
| `-v`    | `"info"`    |
| `-vv`   | `"debug"`   |
| `-vvv`+ | `"trace"`   |

### Options

~~~~ typescript twoslash
import { verbosity } from "@optique/logtape";
// ---cut-before---
const level = verbosity({
  short: "-v",           // Short option (default: "-v")
  long: "--verbose",     // Long option (default: "--verbose")
  baseLevel: "error",    // Starting level (default: "warning")
});
~~~~

With `baseLevel: "error"`:

| Flags    | Level       |
| -------- | ----------- |
| (none)   | `"error"`   |
| `-v`     | `"warning"` |
| `-vv`    | `"info"`    |
| `-vvv`   | `"debug"`   |
| `-vvvv`+ | `"trace"`   |


Debug flag parser
-----------------

The `debug()` parser provides a simple boolean toggle for enabling debug
logging. This is ideal for applications that don't need fine-grained verbosity
control.

~~~~ typescript twoslash
import { debug } from "@optique/logtape";
import { object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";

const parser = object({
  logLevel: debug(),
});

// No flag → "info"
const normal = parse(parser, []);

// --debug or -d → "debug"
const debugging = parse(parser, ["--debug"]);
~~~~

### Options

~~~~ typescript twoslash
import { debug } from "@optique/logtape";
// ---cut-before---
const level = debug({
  short: "-d",            // Short option (default: "-d")
  long: "--debug",        // Long option (default: "--debug")
  debugLevel: "trace",    // Level when flag is present (default: "debug")
  normalLevel: "warning", // Level when flag is absent (default: "info")
});
~~~~


Log output parser
-----------------

The `logOutput()` parser handles log output destinations. Following CLI
conventions, it accepts `-` for console output or a file path for file output.

~~~~ typescript twoslash
import { logOutput } from "@optique/logtape";
import { object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";

const parser = object({
  output: logOutput(),
});

// Console output
const console = parse(parser, ["--log-output=-"]);
// → { type: "console" }

// File output
const file = parse(parser, ["--log-output=/var/log/app.log"]);
// → { type: "file", path: "/var/log/app.log" }

// Optional: undefined when not specified
const none = parse(parser, []);
// → undefined
~~~~

### Options

~~~~ typescript twoslash
import { logOutput } from "@optique/logtape";
// ---cut-before---
const output = logOutput({
  long: "--log-output",   // Long option (default: "--log-output")
  short: "-o",            // Optional short option
  metavar: "FILE",        // Metavar for help text (default: "FILE")
});
~~~~


Logging options preset
----------------------

The `loggingOptions()` function creates a complete logging configuration parser
that combines log level and output options into a single group. It uses a
discriminated union configuration to enforce mutually exclusive level selection
methods.

### Using explicit log level option

~~~~ typescript twoslash
import { loggingOptions } from "@optique/logtape";
import { object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";

const parser = object({
  logging: loggingOptions({ level: "option" }),
});

// --log-level=debug --log-output=/var/log/app.log
const result = parse(parser, ["--log-level=debug", "--log-output=-"]);
~~~~

Configuration options for `level: "option"`:

| Option    | Default         | Description       |
| --------- | --------------- | ----------------- |
| `long`    | `"--log-level"` | Long option name  |
| `short`   | `"-l"`          | Short option name |
| `default` | `"info"`        | Default log level |

### Using verbosity flags

~~~~ typescript twoslash
import { loggingOptions } from "@optique/logtape";
import { object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";

const parser = object({
  logging: loggingOptions({ level: "verbosity" }),
});

// -vv --log-output=-
const result = parse(parser, ["-v", "-v", "--log-output=-"]);
~~~~

Configuration options for `level: "verbosity"`:

| Option      | Default       | Description       |
| ----------- | ------------- | ----------------- |
| `short`     | `"-v"`        | Short option name |
| `long`      | `"--verbose"` | Long option name  |
| `baseLevel` | `"warning"`   | Base log level    |

### Using debug flag

~~~~ typescript twoslash
import { loggingOptions } from "@optique/logtape";
import { object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";

const parser = object({
  logging: loggingOptions({ level: "debug" }),
});

// --debug
const result = parse(parser, ["--debug"]);
~~~~

Configuration options for `level: "debug"`:

| Option        | Default     | Description                |
| ------------- | ----------- | -------------------------- |
| `short`       | `"-d"`      | Short option name          |
| `long`        | `"--debug"` | Long option name           |
| `debugLevel`  | `"debug"`   | Level when flag is present |
| `normalLevel` | `"info"`    | Level when flag is absent  |

### Common options

All three modes share these options:

| Option           | Default             | Description                  |
| ---------------- | ------------------- | ---------------------------- |
| `output.enabled` | `true`              | Enable `--log-output` option |
| `output.long`    | `"--log-output"`    | Long option name for output  |
| `groupLabel`     | `"Logging options"` | Help text group label        |


Creating LogTape configuration
------------------------------

The `createLoggingConfig()` function converts parsed logging options into a
LogTape configuration object that can be passed directly to `configure()`.

~~~~ typescript twoslash
import { loggingOptions, createLoggingConfig } from "@optique/logtape";
import { object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";
import { configure } from "@logtape/logtape";

const parser = object({
  logging: loggingOptions({ level: "verbosity" }),
});

const result = parse(parser, ["-vv"]);
if (result.success) {
  const config = await createLoggingConfig(result.value.logging);
  await configure(config);
}
~~~~

### Console sink options

Customize how console output is handled:

~~~~ typescript twoslash
import { loggingOptions, createLoggingConfig } from "@optique/logtape";
import { object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";

const parser = object({
  logging: loggingOptions({ level: "option" }),
});
const result = parse(parser, ["--log-level=debug"]);
if (!result.success) throw new Error();
// ---cut-before---
// Write all logs to stderr
const config1 = await createLoggingConfig(result.value.logging, {
  stream: "stderr",
});

// Dynamic stream selection based on log level
const config2 = await createLoggingConfig(result.value.logging, {
  streamResolver: (level) =>
    level === "error" || level === "fatal" ? "stderr" : "stdout",
});
~~~~

### Additional LogTape configuration

Extend the generated configuration with custom loggers, filters, or sinks:

~~~~ typescript twoslash
import { loggingOptions, createLoggingConfig } from "@optique/logtape";
import { object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";
import { configure } from "@logtape/logtape";

const parser = object({
  logging: loggingOptions({ level: "option" }),
});
const result = parse(parser, ["--log-level=debug"]);
if (!result.success) throw new Error();
// ---cut-before---
const config = await createLoggingConfig(result.value.logging, {}, {
  loggers: [
    // Add category-specific logging
    { category: ["database"], lowestLevel: "warning", sinks: ["default"] },
    { category: ["http"], lowestLevel: "info", sinks: ["default"] },
  ],
});
await configure(config);
~~~~


Creating sinks
--------------

### Console sink

The `createConsoleSink()` function creates a console sink with configurable
stream selection:

~~~~ typescript twoslash
import { createConsoleSink } from "@optique/logtape";

// Default: write to stderr
const sink1 = createConsoleSink();

// Write to stdout
const sink2 = createConsoleSink({ stream: "stdout" });

// Dynamic stream based on log level
const sink3 = createConsoleSink({
  streamResolver: (level) =>
    level === "error" || level === "fatal" ? "stderr" : "stdout",
});
~~~~

### Creating sink from LogOutput

The `createSink()` function creates a LogTape sink from a `LogOutput` value:

~~~~ typescript twoslash
import { createSink, type LogOutput } from "@optique/logtape";

// Console sink
const consoleSink = await createSink({ type: "console" });

// File sink (requires @logtape/file package)
const fileSink = await createSink({ type: "file", path: "/var/log/app.log" });
~~~~

> [!NOTE]
> File output requires the `@logtape/file` package:
>
> ::: code-group
>
> ~~~~ bash [Deno]
> deno add jsr:@logtape/file
> ~~~~
>
> ~~~~ bash [npm]
> npm add @logtape/file
> ~~~~
>
> ~~~~ bash [pnpm]
> pnpm add @logtape/file
> ~~~~
>
> ~~~~ bash [Yarn]
> yarn add @logtape/file
> ~~~~
>
> ~~~~ bash [Bun]
> bun add @logtape/file
> ~~~~
>
> :::


Complete example
----------------

Here's a complete example showing a CLI application with full logging
configuration:

~~~~ typescript twoslash
import { loggingOptions, createLoggingConfig } from "@optique/logtape";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { withDefault } from "@optique/core/modifiers";
import { parse } from "@optique/core/parser";
import { configure, getLogger } from "@logtape/logtape";

const parser = object({
  // Application options
  host: withDefault(option("--host", "-h", string()), "localhost"),
  port: withDefault(option("--port", "-p", integer({ min: 1, max: 65535 })), 3000),

  // Logging configuration
  logging: loggingOptions({ level: "verbosity" }),
});

const result = parse(parser, ["--host", "0.0.0.0", "-vv"]);

if (result.success) {
  // Configure LogTape
  const config = await createLoggingConfig(result.value.logging, {
    streamResolver: (level) =>
      level === "error" || level === "fatal" ? "stderr" : "stdout",
  });
  await configure(config);

  // Use LogTape
  const logger = getLogger(["myapp"]);
  logger.info`Starting server on ${result.value.host}:${result.value.port}`;
  logger.debug`Debug logging enabled`;
}
~~~~

Usage examples:

~~~~ bash
# Default logging (warning level)
myapp --host 0.0.0.0

# Info level
myapp --host 0.0.0.0 -v

# Debug level
myapp --host 0.0.0.0 -vv

# Trace level with file output
myapp --host 0.0.0.0 -vvv --log-output=/var/log/myapp.log
~~~~

<!-- cSpell: ignore myapp logtape -->
