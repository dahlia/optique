@optique/logtape
================

LogTape logging integration for Optique CLI parser.

This package provides parsers and utilities for integrating [LogTape] logging
library with [Optique] CLI applications. It offers various ways to configure
logging through command-line arguments.

[LogTape]: https://github.com/dahlia/logtape
[Optique]: https://github.com/dahlia/optique


Installation
------------

~~~~ bash
# Deno
deno add jsr:@optique/logtape jsr:@logtape/logtape

# npm
npm install @optique/logtape @logtape/logtape
~~~~


Quick start
-----------

~~~~ typescript
import { loggingOptions, createLoggingConfig } from "@optique/logtape";
import { object, parse } from "@optique/core";
import { configure } from "@logtape/logtape";

const parser = object({
  logging: loggingOptions({ level: "verbosity" }),
});

const result = parse(parser, process.argv.slice(2));
if (result.success) {
  const config = await createLoggingConfig(result.value.logging);
  await configure(config);
}
~~~~


API
---

### `logLevel()`

A value parser for LogTape log levels. Parses strings like `"debug"`, `"info"`,
`"warning"`, etc. into LogTape's `LogLevel` type.

~~~~ typescript
import { logLevel } from "@optique/logtape";
import { option, withDefault, object, parse } from "@optique/core";

const parser = object({
  level: withDefault(option("--log-level", "-l", logLevel()), "info"),
});

const result = parse(parser, ["--log-level=debug"]);
// result.value.level === "debug"
~~~~

Features:

 -  Case-insensitive parsing (`"DEBUG"`, `"Debug"`, `"debug"` all work)
 -  Valid levels: `"trace"`, `"debug"`, `"info"`, `"warning"`, `"error"`,
    `"fatal"`
 -  Provides suggestions for shell completion


### `verbosity()`

A parser for accumulating `-v` flags to determine log level.

~~~~ typescript
import { verbosity } from "@optique/logtape";
import { object, parse } from "@optique/core";

const parser = object({
  logLevel: verbosity(),
});

// No flags -> "warning"
parse(parser, []);

// -v -> "info"
parse(parser, ["-v"]);

// -vv -> "debug"
parse(parser, ["-v", "-v"]);

// -vvv -> "trace"
parse(parser, ["-v", "-v", "-v"]);
~~~~

Options:

 -  `short`: Short option name (default: `"-v"`)
 -  `long`: Long option name (default: `"--verbose"`)
 -  `baseLevel`: Starting log level (default: `"warning"`)


### `debug()`

A simple boolean flag parser for enabling debug logging.

~~~~ typescript
import { debug } from "@optique/logtape";
import { object, parse } from "@optique/core";

const parser = object({
  logLevel: debug(),
});

// No flag -> "info"
parse(parser, []);

// --debug or -d -> "debug"
parse(parser, ["--debug"]);
~~~~

Options:

 -  `short`: Short option name (default: `"-d"`)
 -  `long`: Long option name (default: `"--debug"`)
 -  `debugLevel`: Level when flag is present (default: `"debug"`)
 -  `normalLevel`: Level when flag is absent (default: `"info"`)


### `logOutput()`

A parser for log output destination. Accepts `-` for console output or a file
path for file output.

~~~~ typescript
import { logOutput, createSink } from "@optique/logtape";
import { object, parse } from "@optique/core";

const parser = object({
  output: logOutput(),
});

// --log-output=- -> console output
const result1 = parse(parser, ["--log-output=-"]);
// result1.value.output === { type: "console" }

// --log-output=/var/log/app.log -> file output
const result2 = parse(parser, ["--log-output=/var/log/app.log"]);
// result2.value.output === { type: "file", path: "/var/log/app.log" }

// Create a LogTape sink from the output
const sink = await createSink(result1.value.output);
~~~~


### `loggingOptions()`

A preset that combines log level and log output options into a single group.
Uses a discriminated union configuration to enforce mutually exclusive options.

~~~~ typescript
import { loggingOptions, createLoggingConfig } from "@optique/logtape";
import { object, parse } from "@optique/core";
import { configure } from "@logtape/logtape";

// Using explicit --log-level option
const parser1 = object({
  logging: loggingOptions({ level: "option" }),
});
// Usage: --log-level=debug --log-output=/var/log/app.log

// Using -v verbosity flags
const parser2 = object({
  logging: loggingOptions({ level: "verbosity" }),
});
// Usage: -vv --log-output=-

// Using --debug flag
const parser3 = object({
  logging: loggingOptions({ level: "debug" }),
});
// Usage: --debug
~~~~

Configuration options vary by level type:

**`level: "option"`**:

 -  `long`: Long option name (default: `"--log-level"`)
 -  `short`: Short option name (default: `"-l"`)
 -  `default`: Default log level (default: `"info"`)

**`level: "verbosity"`**:

 -  `short`: Short option name (default: `"-v"`)
 -  `long`: Long option name (default: `"--verbose"`)
 -  `baseLevel`: Base log level (default: `"warning"`)

**`level: "debug"`**:

 -  `short`: Short option name (default: `"-d"`)
 -  `long`: Long option name (default: `"--debug"`)
 -  `debugLevel`: Level when flag is present (default: `"debug"`)
 -  `normalLevel`: Level when flag is absent (default: `"info"`)

Common options:

 -  `output.enabled`: Whether to enable log output option (default: `true`)
 -  `output.long`: Long option name for output (default: `"--log-output"`)
 -  `groupLabel`: Label for option group in help text (default:
    `"Logging options"`)


### `createLoggingConfig()`

Converts parsed logging options into a LogTape configuration object.

~~~~ typescript
import { loggingOptions, createLoggingConfig } from "@optique/logtape";
import { object, parse } from "@optique/core";
import { configure } from "@logtape/logtape";

const parser = object({
  logging: loggingOptions({ level: "verbosity" }),
});

const result = parse(parser, ["-vv"]);
if (result.success) {
  const config = await createLoggingConfig(result.value.logging, {
    // Optional: configure console sink
    stream: "stderr",
    // Or use dynamic stream selection:
    // streamResolver: (level) =>
    //   level === "error" || level === "fatal" ? "stderr" : "stdout"
  });
  await configure(config);
}
~~~~


### `createConsoleSink()`

Creates a console sink with configurable stream selection.

~~~~ typescript
import { createConsoleSink } from "@optique/logtape";

// Write to stderr (default)
const sink1 = createConsoleSink();

// Write to stdout
const sink2 = createConsoleSink({ stream: "stdout" });

// Dynamic stream selection based on log level
const sink3 = createConsoleSink({
  streamResolver: (level) =>
    level === "error" || level === "fatal" ? "stderr" : "stdout",
});
~~~~


### `createSink()`

Creates a LogTape sink from a `LogOutput` value.

~~~~ typescript
import { createSink, type LogOutput } from "@optique/logtape";

// Console sink
const consoleSink = await createSink({ type: "console" });

// File sink (requires @logtape/file package)
const fileSink = await createSink({ type: "file", path: "/var/log/app.log" });
~~~~

> [!NOTE]
> File output requires the `@logtape/file` package to be installed:
>
> ~~~~ bash
> deno add jsr:@logtape/file
> # or
> npm install @logtape/file
> ~~~~


License
-------

Distributed under the MIT License. See the *LICENSE* file for details.
