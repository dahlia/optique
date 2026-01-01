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
import { object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { formatMessage } from "@optique/core/message";

const parser = object({
  name: option("-n", "--name", string()),
  port: option("-p", "--port", integer({ min: 1000 })),
});

const result = parse(parser, ["--name", "server", "--port", "8080"]);
//    ^?







if (result.success) {
  console.log(`Starting ${result.value.name} on port ${result.value.port}.`);
} else {
  console.error(`Parse error: ${formatMessage(result.error)}.`);
  process.exit(1);
}
~~~~

The `parse()` function returns a discriminated union type that indicates
success or failure:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
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

The `runParser()` function from `@optique/core/facade` adds automatic help
generation and formatted error messages while still giving you control over
program behavior through callbacks.

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { runParser } from "@optique/core/facade";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

const parser = object({
  name: option("-n", "--name", string()),
  port: option("-p", "--port", integer({ min: 1000 })),
});

// Manual process integration (Node.js example)
const config = runParser(
  parser,
  "myserver",                     // program name
  process.argv.slice(2),          // arguments
  {
    help: {                       // New grouped API
      mode: "both",               // Enable --help and help command
      onShow: process.exit,       // Exit after showing help
    },
    version: {                    // Version functionality
      mode: "option",             // Enable --version flag
      value: "1.0.0",             // Version string to display
      onShow: process.exit,       // Exit after showing version
    },
    colors: process.stdout.isTTY, // Auto-detect color support
    onError: process.exit,        // Exit with error code
  }
);

config // Its result type is:
// ^?






console.log(`Starting ${config.name} on port ${config.port}.`);
~~~~

This approach automatically handles:

 -  *Help generation*: Creates formatted help text from parser structure
 -  *Version display*: Shows version information via `--version` or `version` command
 -  *Error formatting*: Shows clear error messages with usage information
 -  *Option parsing*: Recognizes `--help`/`--version` flags and `help`/`version` subcommands
 -  *Usage display*: Shows command syntax when errors occur

The `RunOptions` interface provides extensive customization:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { runParser } from "@optique/core/facade";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";

const parser = object({ name: option("-n", "--name", string()) });

const result = runParser(parser, "myapp", ["--name", "test"], {
  colors: true,           // Force colored output
  maxWidth: 80,          // Wrap text at 80 columns
  showDefault: true,     // Show default values in help text
  brief: message`A powerful CLI tool`,                    // Brief description at top
  description: message`This tool processes data efficiently.`, // Detailed description
  footer: message`Visit https://example.com for more info`,   // Footer at bottom
  help: {                // New grouped API
    mode: "option",      // Only --help option, no help command
  },
  version: {             // Version functionality
    mode: "both",        // Both --version option and version command
    value: "2.1.0",      // Version string to display
  },
  completion: {          // Shell completion functionality
    mode: "both",        // "command" | "option" | "both"
    name: "plural",      // "singular" | "plural" | "both"
  },
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
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { run, print } from "@optique/run";

const parser = object({
  name: option("-n", "--name", string()),
  port: option("-p", "--port", integer({ min: 1000 })),
});

// Completely automated - just run the parser
const config = run(parser);
//    ^?







// If we reach this point, parsing succeeded
print(message`Starting ${config.name} on port ${config.port.toString()}.`);
~~~~

The function automatically:

 -  *Extracts arguments* from `process.argv.slice(2)`
 -  *Detects program name* from `process.argv[1]`
 -  *Auto-detects colors* from `process.stdout.isTTY`
 -  *Auto-detects width* from `process.stdout.columns`
 -  *Exits on help* with code 0
 -  *Exits on version* with code 0
 -  *Exits on error* with code 1

You can still customize behavior when needed:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { run } from "@optique/run";

const parser = object({ name: option("-n", "--name", string()) });

const config = run(parser, {
  programName: "custom-name",  // Override detected program name
  brief: message`Custom CLI Tool`,                       // Brief description
  description: message`A tool for processing files.`,   // Detailed description
  footer: message`Report bugs at github.com/user/repo`, // Footer information
  help: "both",               // Enable both --help and help command
  version: "1.2.0",           // Simple version string (uses default "option" mode)
  colors: true,               // Force colors even for non-TTY
  errorExitCode: 2,           // Exit with code 2 on errors
});
~~~~

Use this approach for standalone CLI applications where you want maximum
convenience and standard CLI behavior.

### Configuration options

*@optique/run*'s `run()` function provides several configuration options
for fine-tuning behavior:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { run } from "@optique/run";

const parser = object({
  name: option("-n", "--name", string()),
  debug: option("--debug")
});

const config = run(parser, {
  programName: "my-tool",     // Override detected program name
  args: ["custom", "args"],   // Override process.argv
  colors: true,               // Force colored output
  maxWidth: 100,              // Set output width
  showDefault: true,          // Show default values in help text
  brief: message`My CLI Tool`,                    // Brief description
  description: message`Processes files efficiently`, // Detailed description
  footer: message`Visit example.com for help`,    // Footer information
  help: "both",               // Enable both --help and help command
  version: {                  // Advanced version configuration
    value: "2.0.0",           // Version string
    mode: "command"           // Only version command, no --version option
  },
  aboveError: "usage",        // Show usage on errors
  errorExitCode: 2            // Exit code for errors
});
~~~~

### Help system options

Enable built-in help functionality with different modes:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { run } from "@optique/run";

const parser = object({ name: option("-n", "--name", string()) });

// Simple string-based API
const result1 = run(parser, {
  help: "option",  // Adds --help option only
});

const result2 = run(parser, {
  help: "command", // Adds help subcommand only
});

const result3 = run(parser, {
  help: "both",    // Adds both --help and help command
});

// No help (default) - simply omit the help option
const result4 = run(parser, {});
~~~~

### Version system options

Enable built-in version functionality with flexible configuration:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { run } from "@optique/run";

const parser = object({ name: option("-n", "--name", string()) });

// Simple string-based API (uses default "option" mode)
const result1 = run(parser, {
  version: "1.0.0",  // Adds --version option only
});

// Advanced object-based API with mode selection
const result2 = run(parser, {
  version: {
    value: "1.0.0",
    mode: "option",   // Adds --version option only
  }
});

const result3 = run(parser, {
  version: {
    value: "1.0.0",
    mode: "command",  // Adds version subcommand only
  }
});

const result4 = run(parser, {
  version: {
    value: "1.0.0",
    mode: "both",     // Adds both --version and version command
  }
});

// No version (default) - simply omit the version option
const result5 = run(parser, {});
~~~~

### Shell completion

*This API is available since Optique 0.6.0.*

Enable shell completion support for Bash, zsh, fish, PowerShell, and Nushell
with simple configuration.  The `run()` function automatically handles
completion script generation and runtime completion requests:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option, argument } from "@optique/core/primitives";
import { string, choice } from "@optique/core/valueparser";
import { run } from "@optique/run";

const parser = object({
  format: option("-f", "--format", choice(["json", "yaml"])),
  input: argument(string()),
});

const config = run(parser, {
  completion: "both",  // "command" | "option" | "both"
});
~~~~

### Completion modes

The `mode` option controls how completion is triggered:

`"command"`
:   Completion via subcommand (`myapp completion bash`)

`"option"`
:   Completion via option (`myapp --completion bash`)

`"both"`
:   Both patterns supported

### Naming conventions

*This API is available since Optique 0.7.0.*

You can configure whether to use singular (`completion`), plural (`completions`),
or both naming conventions for the completion command and option:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { run } from "@optique/run";

const parser = object({});

const config = run(parser, {
  completion: {
    mode: "both",
    name: "plural", // Use "completions" and "--completions"
  }
});
~~~~

The `name` option accepts:

`"singular"`
:   Use `completion` command and `--completion` option.

`"plural"`
:   Use `completions` command and `--completions` option.

`"both"` (default)
:   Use both singular and plural forms.

Users can generate and install completion scripts:

::: code-group

~~~~ bash [Bash]
myapp completion bash > ~/.bashrc.d/myapp.bash
source ~/.bashrc.d/myapp.bash
~~~~

~~~~ zsh [zsh]
myapp completion zsh > ~/.zsh/completions/_myapp
~~~~

~~~~ fish [fish]
myapp completion fish > ~/.config/fish/completions/myapp.fish
~~~~

~~~~ powershell [PowerShell]
myapp completion pwsh > myapp-completion.ps1
~~~~

~~~~ nushell [Nushell]
myapp completion nu | save myapp-completion.nu
source myapp-completion.nu
~~~~

:::

Shell completion works automatically with all parser types and value parsers,
providing intelligent suggestions based on your parser structure. For detailed
information, see the [*Shell completion* section](./completion.md).

### Default value display

Both runner functions support displaying default values in help text when
options or arguments are created with `withDefault()`:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { withDefault } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { run } from "@optique/run";

const parser = object({
  name: option("-n", "--name", string()),
  port: withDefault(option("-p", "--port", integer()), 3000),
  format: withDefault(option("-f", "--format", string()), "json"),
});

const config = run(parser, {
  showDefault: true,  // Shows: --port [3000], --format [json]
});

// Custom formatting
const config2 = run(parser, {
  showDefault: {
    prefix: " (default: ",
    suffix: ")"
  }  // Shows: --port (default: 3000), --format (default: json)
});
~~~~

Default values are automatically dimmed when colors are enabled, making them
visually distinct from the main help text.

### Rich documentation support

*This API is available since Optique 0.4.0.*

Both runner functions support adding rich documentation to help text through
the `brief`, `description`, and `footer` options. These fields allow you to
provide comprehensive documentation without modifying parser definitions:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { run } from "@optique/run";

const parser = object("Options", {
  input: option("-i", "--input", string()),
  output: option("-o", "--output", string()),
});

const config = run(parser, {
  brief: message`A powerful file processing tool`,
  description: message`This utility processes files with various transformations.

Supports multiple input formats including JSON, YAML, and plain text. Output can be customized with different formatting options.`,
  footer: message`Examples:
  myapp -i data.json -o result.txt
  myapp --input config.yaml --output processed.json

For more information, visit: https://example.com/docs
Report bugs at: https://github.com/user/myapp/issues`,
  help: "option",
  version: "1.0.0",
});
~~~~

The documentation fields appear in the following order in help output:

~~~~ ansi
A powerful file processing tool
Usage: [1mmyapp[0m [3m-i[0m[2m/[0m[3m--input[0m [4m[2mSTRING[0m [3m-o[0m[2m/[0m[3m--output[0m [4m[2mSTRING[0m

This utility processes files with various transformations.

Supports multiple input formats including JSON, YAML, and plain text. Output can be
customized with different formatting options.

Options:
  [3m-i[0m[2m, [0m[3m--input[0m [4m[2mSTRING[0m
  [3m-o[0m[2m, [0m[3m--output[0m [4m[2mSTRING[0m

Examples:
  myapp -i data.json -o result.txt
  myapp --input config.yaml --output processed.json

For more information, visit: https://example.com/docs

Report bugs at: https://github.com/user/myapp/issues
~~~~

These same fields also appear when errors are displayed with `aboveError: "help"`,
providing context even when parsing fails. The user-provided documentation takes
precedence over any documentation generated from parser structure.

### Error handling behavior

The *@optique/run* `run()` function automatically:

 -  Prints usage information and error messages to stderr
 -  Exits with code `0` for help requests
 -  Exits with code `0` for version requests
 -  Exits with code `1` (or custom) for parse errors
 -  Never returns on errors (always calls `process.exit()`)


Async parser execution
----------------------

*This API is available since Optique 0.9.0.*

Parsers in Optique can be either synchronous or asynchronous. The mode is
tracked at compile time through the `$mode` property and the `Mode` type
parameter. When any component of a parser (such as a value parser) is async,
the entire composite parser becomes async.

### Using `parseAsync()` and `suggestAsync()`

For parsers that may be async, use the explicit async functions:

~~~~ typescript twoslash
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import { object } from "@optique/core/constructs";
import { parseAsync, suggestAsync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";

// A custom async value parser
function apiKey(): ValueParser<"async", string> {
  return {
    $mode: "async",
    metavar: "KEY",
    async parse(input: string): Promise<ValueParserResult<string>> {
      // Validate API key against remote service
      const response = await fetch(`https://api.example.com/validate?key=${input}`);
      if (!response.ok) {
        return { success: false, error: message`Invalid API key.` };
      }
      return { success: true, value: input };
    },
    format: (v) => v,
  };
}

const parser = object({
  key: option("--api-key", apiKey()),
  name: option("-n", "--name", string()),
});

// parseAsync() returns a Promise
const result = await parseAsync(parser, ["--api-key", "abc123", "-n", "test"]);

if (result.success) {
  console.log(`Using key for ${result.value.name}.`);
}

// suggestAsync() also returns a Promise
const suggestions = await suggestAsync(parser, ["--"]);
~~~~

### Sync-only functions

For parsers that are guaranteed to be sync, you can use the sync-only
variants which provide direct return values without `Promise` wrappers:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { parseSync, suggestSync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

// A parser using only sync value parsers
const parser = object({
  name: option("-n", "--name", string()),
  port: option("-p", "--port", integer()),
});

// parseSync() returns directly (no Promise)
const result = parseSync(parser, ["--name", "server", "--port", "8080"]);

// suggestSync() also returns directly
const suggestions = suggestSync(parser, ["--"]);
~~~~

The generic `parse()` and `suggest()` functions automatically return the
appropriate type based on the parser's mode:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const syncParser = object({
  name: option("-n", "--name", string()),
});

// Returns Result<T> directly for sync parsers
const result = parse(syncParser, ["--name", "test"]);
~~~~

For more details on creating async value parsers, see the
[*Async value parsers*](./valueparsers.md#async-value-parsers) section.

### Using `runSync()` and `runAsync()`

*This API is available since Optique 0.9.0.*

The *@optique/run* package also provides explicit sync/async variants of
the `run()` function:

~~~~ typescript twoslash
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";

function apiKey(): ValueParser<"async", string> {
  return {
    $mode: "async",
    metavar: "KEY",
    async parse(input: string): Promise<ValueParserResult<string>> {
      return { success: true, value: input };
    },
    format: (v) => v,
  };
}
const args = ["--api-key", "abc123", "-n", "test"];
// ---cut-before---
import { run, runSync, runAsync } from "@optique/run";

// Sync parser with runSync() - returns directly
const syncParser = object({
  name: option("-n", "--name", string()),
});
const syncResult = runSync(syncParser, { args });

// Async parser with runAsync() - returns Promise
const asyncParser = object({
  key: option("--api-key", apiKey()),
  name: option("-n", "--name", string()),
});
const asyncResult = await runAsync(asyncParser, { args });
~~~~

`runSync()`
:   Only accepts sync parsers. Returns the parsed value directly.
    Provides a compile-time error if you pass an async parser.

`runAsync()`
:   Accepts any parser (sync or async). Always returns a `Promise`.
    Use this when working with parsers that may contain async value parsers.

`run()`
:   The generic function that automatically returns the appropriate type
    based on the parser's mode. For sync parsers it returns directly;
    for async parsers it returns a `Promise`.


Type inference with `InferValue<T>`
-----------------------------------

The `InferValue<T>` utility type extracts the result type from any parser,
enabling type-safe code when working with parser results programmatically.

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import type { InferValue, Parser } from "@optique/core/parser";
import { command, constant, option } from "@optique/core/primitives";
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
    console.log(`Starting on port ${config.port || "default"}.`);
  } else {
    // TypeScript knows this is the stop command
    console.log(`Stopping ${config.force ? "forcefully" : "gracefully"}.`);
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

### Use *@optique/run* when:

 -  Building CLI applications for Node.js, Bun, or Deno
 -  You want automatic `process.argv` parsing and `process.exit()` handling
 -  You need automatic terminal capability detection (colors, width)
 -  You prefer a simple, batteries-included approach

### Use *@optique/core* instead when:

 -  Building web applications or libraries
 -  You need full control over argument sources and error handling
 -  Working in environments without `process` (browsers, web workers)
 -  Building reusable parser components

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

<!-- cSpell: ignore myapp mmyapp -->
