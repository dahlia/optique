---
description: >-
  Learn about the different ways to execute parsers in Optique: from low-level
  parsing to high-level process integration with automatic error handling and
  help text generation.
---

Runners and execution
=====================

Once you've built a parser using combinators, you need to execute it against
command-line arguments. Optique provides three different approaches with
varying levels of automation and control: the low-level `parse()` function,
the mid-level `run()` function from `@optique/core/facade`, and the high-level
`run()` function from *@optique/run* with full process integration.

Each approach serves different use cases, from fine-grained control over
parsing results to completely automated CLI applications that handle everything
from argument extraction to process exit codes.


Low-level parsing with `parse()`
---------------------------------

The `parse()` function from `@optique/core/parser` provides the most basic
parsing operation. It takes a parser and an array of string arguments, returning
a result object that you must handle manually.

~~~~ typescript twoslash
import { object, option, parse } from "@optique/core/parser";
import { string, integer } from "@optique/core/valueparser";
import { formatMessage } from "@optique/core/message";

const parser = object({
  name: option("-n", "--name", string()),
  port: option("-p", "--port", integer({ min: 1000 })),
});

const result = parse(parser, ["--name", "server", "--port", "8080"]);
//    ^?







if (result.success) {
  console.log(`Starting ${result.value.name} on port ${result.value.port}`);
} else {
  console.error(`Parse error: ${formatMessage(result.error)}`);
  process.exit(1);
}
~~~~

The `parse()` function returns a discriminated union type that indicates
success or failure:

~~~~ typescript twoslash
import { object, option, parse } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
import { formatMessage } from "@optique/core/message";

const parser = object({ name: option("-n", "--name", string()) });
const result = parse(parser, ["--name", "test"]);

// Result type is: { success: true, value: { name: string } } |
//                { success: false, error: Message }
if (result.success) {
  // TypeScript knows this is the success case
  result.value.name; // string
} else {
  // TypeScript knows this is the error case
  formatMessage(result.error); // string
}
~~~~

Use `parse()` when you need complete control over error handling, want to
integrate parsing into a larger application flow, or need to handle multiple
parsing attempts.


Mid-level execution with `@optique/core/facade`
-----------------------------------------------

The `run()` function from `@optique/core/facade` adds automatic help generation
and formatted error messages while still giving you control over program
behavior through callbacks.

~~~~ typescript twoslash
import { run } from "@optique/core/facade";
import { object, option } from "@optique/core/parser";
import { string, integer } from "@optique/core/valueparser";

const parser = object({
  name: option("-n", "--name", string()),
  port: option("-p", "--port", integer({ min: 1000 })),
});

// Manual process integration (Node.js example)
const config = run(
  parser,
  "myserver",                     // program name
  process.argv.slice(2),          // arguments
  {
    help: "both",                 // Enable --help and help command
    colors: process.stdout.isTTY, // Auto-detect color support
    onHelp: process.exit,         // Exit after showing help
    onError: process.exit,        // Exit with error code
  }
);

config // Its result type is:
// ^?






console.log(`Starting ${config.name} on port ${config.port}`);
~~~~

This approach automatically handles:

 -  *Help generation*: Creates formatted help text from parser structure
 -  *Error formatting*: Shows clear error messages with usage information
 -  *Option parsing*: Recognizes `--help` flags and `help` subcommands
 -  *Usage display*: Shows command syntax when errors occur

The `RunOptions` interface provides extensive customization:

~~~~ typescript twoslash
import { run } from "@optique/core/facade";
import { object, option } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";

const parser = object({ name: option("-n", "--name", string()) });

const result = run(parser, "myapp", ["--name", "test"], {
  colors: true,           // Force colored output
  maxWidth: 80,          // Wrap text at 80 columns
  help: "option",        // Only --help option, no help command
  aboveError: "help",    // Show full help before error messages
  stderr: (text) => {    // Custom error output handler
    console.error(`ERROR: ${text}`);
  },
  stdout: console.log,   // Custom help output handler
});
~~~~

Use this approach when you need automatic help and error handling but want
control over process behavior, or when integrating with frameworks that
manage process lifecycle.


High-level execution with *@optique/run*
----------------------------------------

The `run()` function from *@optique/run* provides complete process integration
with zero configuration required. It automatically handles argument extraction,
terminal detection, and process exit.

~~~~ typescript twoslash
import { run } from "@optique/run";
import { object, option } from "@optique/core/parser";
import { string, integer } from "@optique/core/valueparser";

const parser = object({
  name: option("-n", "--name", string()),
  port: option("-p", "--port", integer({ min: 1000 })),
});

// Completely automated - just run the parser
const config = run(parser);
//    ^?







// If we reach this point, parsing succeeded
console.log(`Starting ${config.name} on port ${config.port}`);
~~~~

The function automatically:

 -  *Extracts arguments* from `process.argv.slice(2)`
 -  *Detects program name* from `process.argv[1]`
 -  *Auto-detects colors* from `process.stdout.isTTY`
 -  *Auto-detects width* from `process.stdout.columns`
 -  *Exits on help* with code 0
 -  *Exits on error* with code 1

You can still customize behavior when needed:

~~~~ typescript twoslash
import { run } from "@optique/run";
import { object, option } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";

const parser = object({ name: option("-n", "--name", string()) });

const config = run(parser, {
  programName: "custom-name",  // Override detected program name
  help: "both",               // Enable --help and help command
  colors: true,               // Force colors even for non-TTY
  errorExitCode: 2,           // Exit with code 2 on errors
});
~~~~

Use this approach for standalone CLI applications where you want maximum
convenience and standard CLI behavior.


Type inference with `InferValue<T>`
-----------------------------------

The `InferValue<T>` utility type extracts the result type from any parser,
enabling type-safe code when working with parser results programmatically.

~~~~ typescript twoslash
import type { InferValue, Parser } from "@optique/core/parser";
import { object, option, or, command, constant } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";

// Complex parser with union types
const parser = or(
  command("start", object({
    type: constant("start"),
    port: option("-p", "--port", string()),
  })),
  command("stop", object({
    type: constant("stop"),
    force: option("--force"),
  }))
);

// InferValue extracts the union type automatically
type Config = InferValue<typeof parser>;
//   ^?










function handleConfig(config: Config) {
  if (config.type === "start") {
    // TypeScript knows this is the start command
    console.log(`Starting on port ${config.port || "default"}`);
  } else {
    // TypeScript knows this is the stop command
    console.log(`Stopping ${config.force ? "forcefully" : "gracefully"}`);
  }
}
~~~~

`InferValue<T>` is particularly useful when:

 -  Creating functions that work with parser results
 -  Building generic utilities around parsers
 -  Extracting types for external APIs or storage


When to use each approach
-------------------------

Choose your execution strategy based on your application's needs:

### Use `parse()` when:

 -  *Testing parsers*: You need to inspect parsing results in tests
 -  *Complex integration*: Parsing is part of a larger application flow
 -  *Custom error handling*: You need application-specific error recovery
 -  *Multiple attempts*: You want to try different parsers or arguments

### Use `run()` from `@optique/core/facade` when:

 -  *Framework integration*: Working with web frameworks or custom runtimes
 -  *Library development*: Building CLI libraries for other applications
 -  *Custom I/O*: You need non-standard input/output handling
 -  *Controlled exit*: The application manages its own lifecycle

### Use `run()` from `@optique/run` when:

 -  *Standalone CLIs*: Building command-line applications
 -  *Rapid prototyping*: You want to get a CLI running quickly
 -  *Standard behavior*: Your application follows typical CLI conventions
 -  *Node.js/Bun/Deno*: You're running in a standard JavaScript runtime

The progression from `parse()` to *@optique/run*'s `run()` trades control for
convenience. Start with the highest-level approach that meets your needs, then
move to lower-level functions only when you need the additional control.
