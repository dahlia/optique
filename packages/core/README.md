Optique: Type-safe combinatorial CLI parser for TypeScript
==========================================================

> [!CAUTION]
> Optique is currently in early development for proof of concept purposes,
> and is not yet ready for production use.  The API is subject to change,
> and there may be bugs or missing features.

Optique is a type-safe combinatorial CLI *parser* for TypeScript inspired by
Haskell's [optparse-applicative] and TypeScript's [Zod]. It provides composable
parsers for building command-line interfaces with full type safety and
automatic type inference.

> [!NOTE]
> Optique is a parsing library that focuses on extracting and
> validating command-line arguments.  It doesn't dictate your application's
> structure, handle command execution, or provide scaffolding—it simply
> transforms command-line input into well-typed data structures that your
> application can use.

Unlike traditional CLI parsers that rely on configuration objects or
string-based definitions, Optique uses a functional approach where parsers
are first-class values that can be combined, transformed, and reused.
This compositional design makes it easy to express complex argument structures
while maintaining complete type safety throughout your application.

> [!TIP]
> *Building CLI apps?* Consider *@optique/run* for automatic `process.argv`
> handling and `process.exit()` integration. This core package is perfect for
> libraries, web apps, or when you need full control over argument parsing.

[optparse-applicative]: https://github.com/pcapriotti/optparse-applicative
[Zod]: https://zod.dev/


Core concepts
-------------

Optique is built around several key concepts:

 -  *Value parsers* convert strings to typed values
    (`string()`, `integer()`, `url()`, etc.)

 -  *Primitive parsers* handle the basic building blocks:

     -  `option()` for command-line flags and their arguments
     -  `argument()` for positional arguments
     -  `command()` for subcommands
     -  `constant()` for literal values (essential for discriminated unions)

 -   *Modifying combinators* transform and combine parsers:
     -  `optional()` makes parsers optional
     -  `withDefault()` provides default values for optional parsers
     -  `multiple()` allows repetition
     -  `or()` creates alternatives
     -  `merge()` combines object parsers

- *Construct combinators* build structured results:

     -  `object()` groups parsers into objects
     -  `tuple()` combines parsers into tuples

The library automatically infers the result type of your parser composition,
ensuring that your parsed CLI arguments are fully typed without manual type
annotations. When parsing fails, you get detailed error messages that help
users understand what went wrong.


Example
-------

~~~~ typescript
import { run } from "@optique/core/facade";
import { formatMessage } from "@optique/core/message";
import {
  argument,
  merge,
  multiple,
  object,
  option,
  optional,
  or,
  withDefault
} from "@optique/core/parser";
import { choice, integer, locale, string, url } from "@optique/core/valueparser";
import process from "node:process";

// Define a sophisticated CLI with grouped and reusable option sets
const networkOptions = object("Network", {
  port: option("-p", "--port", integer({ min: 1, max: 65535 })),
  host: withDefault(
    option("-h", "--host", string({ metavar: "HOST" })),
    "localhost",
  ),
});

const loggingOptions = object("Logging", {
  verbose: optional(option("-v", "--verbose")),
  logFile: optional(option("--log-file", string({ metavar: "FILE" }))),
});

const parser = or(
  // Server mode: merge network and logging options with server-specific config
  merge(
    networkOptions,
    loggingOptions,
    object("Server", {
      locales: multiple(option("-l", "--locale", locale())),
      config: argument(string({ metavar: "CONFIG_FILE" })),
    }),
  ),
  object("Client mode", {
    connect: option(
       "-c", "--connect",
       url({ allowedProtocols: ["http:", "https:"] }),
    ),
    headers: multiple(option("-H", "--header", string())),
    timeout: withDefault(option("-t", "--timeout", integer({ min: 0 })), 30000),
    files: multiple(argument(string({ metavar: "FILE" })), { min: 1, max: 5 }),
  }),
);

const result = run(parser, "myapp", process.argv.slice(2), {
  colors: true,
  help: "both",
  onError: process.exit,
});

// TypeScript automatically infers the complex union type with optional fields
if ("port" in result) {
  const server = result;
  console.log(`Starting server on ${server.host}:${server.port}`);
  console.log(`Supported locales: ${server.locales.join(", ") || "default"}`);
  if (server.verbose) console.log("Verbose mode enabled");
  if (server.logFile) console.log(`Logging to: ${server.logFile}`);
} else {
  const client = result;
  console.log(`Connecting to ${client.connect}`);
  console.log(`Processing ${client.files.length} files`);
  console.log(`Timeout: ${client.timeout}ms`);
}
~~~~

This example demonstrates Optique's powerful combinators:

 -  **`merge()`** combines multiple `object()` parsers into a single unified
    parser, enabling modular and reusable option groups
 -  **`optional()`** makes parsers optional, returning `undefined` when not
    provided
 -  **`withDefault()`** provides default values instead of `undefined` for
    optional parameters, improving usability
 -  **`multiple()`** allows repeating options/arguments with configurable
    constraints
 -  **`or()`** creates mutually exclusive alternatives
 -  **`object()`** groups related options into structured data

The parser demonstrates modular design by:

 -  Separating network options (`--port`, `--host`) for reusability
 -  Grouping logging configuration (`--verbose`, `--log-file`) separately
 -  Merging reusable groups with server-specific options using `merge()`
 -  Supporting complex scenarios like multiple locales: `-l en-US -l fr-FR`

All with full type safety and automatic inference!


Parser combinators
------------------

Optique provides several types of parsers and combinators for building sophisticated CLI interfaces:

### Primitive parsers

 -  **`option()`**: Handles command-line flags and their arguments

    ~~~~ typescript
    option("-p", "--port", integer({ min: 1, max: 65535 }))
    option("-v", "--verbose")  // Boolean flag
    ~~~~

 -  **`argument()`**: Handles positional arguments

    ~~~~ typescript
    argument(string({ metavar: "FILE" }))
    ~~~~

 -  **`command()`**: Matches subcommands for `git`-like CLI interfaces

    ~~~~ typescript
    command("add", object({ file: argument(string()) }))
    ~~~~

 -  **`constant()`**: Produces a constant value without consuming input, essential for discriminated unions

    ~~~~ typescript
    constant("add")  // Always returns "add"
    constant(42)     // Always returns 42
    ~~~~

### Modifying combinators

 -  **`optional()`**: Makes any parser optional, returning `undefined` if not
    matched

    ~~~~ typescript
    const parser = object({
      name: option("-n", "--name", string()),
      verbose: optional(option("-v", "--verbose")), // undefined if not provided
    });
    ~~~~

 -  **`withDefault()`**: Makes any parser provide a default value instead of
    `undefined` when not matched

    ~~~~ typescript
    const parser = object({
      name: option("-n", "--name", string()),
      port: withDefault(option("-p", "--port", integer()), 8080), // 8080 if not provided
      host: withDefault(option("-h", "--host", string()), "localhost"),
    });
    ~~~~

 -  **`multiple()`**: Allows repeating a parser multiple times with constraints

    ~~~~ typescript
    const parser = object({
      // Multiple locales: -l en -l fr
      locales: multiple(option("-l", "--locale", locale())),
      // 1-3 input files required
      files: multiple(argument(string()), { min: 1, max: 3 }),
    });
    ~~~~

 -  **`or()`**: Creates mutually exclusive alternatives
    (try first, then second, etc.)

    ~~~~ typescript
    or(
      command("add", addParser),
      command("remove", removeParser)
    )
    ~~~~

 -  **`merge()`**: Merges multiple `object()` parsers into a single parser,
    enabling modular composition of option groups

    ~~~~ typescript
    merge(networkOptions, loggingOptions, serverOptions)
    ~~~~

### Construct combinators

 -  **`object()`**: Combines multiple parsers into a structured object

    ~~~~ typescript
    object("Server", {
      port: option("-p", "--port", integer()),
      host: option("-h", "--host", string()),
    })
    ~~~~

 -  **`tuple()`**: Combines multiple parsers into a tuple with preserved order

    ~~~~ typescript
    tuple(
      option("-u", "--user", string()),
      option("-p", "--port", integer())
    )
    ~~~~

### Advanced patterns

The `merge()` combinator enables powerful modular designs by separating concerns
into reusable option groups:

~~~~ typescript
// Define reusable option groups
const databaseOptions = object("Database", {
  dbHost: option("--db-host", string()),
  dbPort: option("--db-port", integer({ min: 1, max: 65535 })),
  dbName: option("--db-name", string()),
});

const authOptions = object("Authentication", {
  username: option("-u", "--user", string()),
  password: optional(option("-p", "--password", string())),
  token: optional(option("-t", "--token", string())),
});

const loggingOptions = object("Logging", {
  logLevel: option("--log-level", choice(["debug", "info", "warn", "error"])),
  logFile: optional(option("--log-file", string())),
});

// Combine groups differently for different modes
const parser = or(
  // Development: all options available
  merge(
    object("Dev", { dev: option("--dev") }),
    databaseOptions,
    authOptions,
    loggingOptions
  ),
  // Production: database and auth required, enhanced logging
  merge(
    object("Prod", { config: option("-c", "--config", string()) }),
    databaseOptions,
    authOptions,
    loggingOptions,
    object("Production", {
      workers: multiple(option("-w", "--worker", integer({ min: 1 }))),
    })
  ),
);
~~~~

This approach promotes:

 -  *Reusability*: Option groups can be shared across different command modes
 -  *Maintainability*: Changes to option groups automatically propagate
 -  *Modularity*: Each concern is separated into its own focused parser
 -  *Flexibility*: Different combinations for different use cases

The `multiple()` combinator is especially powerful when combined with `object()`
parsers, as it provides empty arrays as defaults when no matches are found,
allowing for clean optional repeated arguments.

### Quick subcommand example

For a quick introduction to subcommands, here's a simple `git`-like interface:

~~~~ typescript
import { run } from "@optique/core/facade";
import { argument, command, constant, object, option, or } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
import process from "node:process";

const parser = or(
  command("add", object({
    type: constant("add"),
    all: option("-A", "--all"),
    file: argument(string()),
  })),
  command("commit", object({
    type: constant("commit"),
    message: option("-m", "--message", string()),
    amend: option("--amend"),
  })),
);

const result = run(parser, "git", ["commit", "-m", "Fix parser bug"], {
  help: "both",
  onError: process.exit,
});
// result.type === "commit"
// result.message === "Fix parser bug"
// result.amend === false
~~~~

### Subcommands

The `command()` combinator enables building git-like CLI interfaces with
subcommands. Each subcommand can have its own set of options and arguments:

~~~~ typescript
import { run } from "@optique/core/facade";
import {
  argument,
  command,
  constant,
  multiple,
  object,
  option,
  optional,
  or,
} from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
import process from "node:process";

const parser = or(
  command("show", object({
    type: constant("show"),
    progress: option("-p", "--progress"),
    verbose: optional(option("-v", "--verbose")),
    id: argument(string({ metavar: "ITEM_ID" })),
  })),
  command("edit", object({
    type: constant("edit"),
    editor: optional(option("-e", "--editor", string({ metavar: "EDITOR" }))),
    backup: option("-b", "--backup"),
    id: argument(string({ metavar: "ITEM_ID" })),
  })),
  command("delete", object({
    type: constant("delete"),
    force: option("-f", "--force"),
    recursive: optional(option("-r", "--recursive")),
    items: multiple(argument(string({ metavar: "ITEM_ID" })), { min: 1 }),
  })),
);

const result = run(parser, "myapp", process.argv.slice(2), {
  colors: true,
  help: "both",
  onError: process.exit,
});

// TypeScript infers a union type with discriminated subcommands
switch (result.type) {
  case "show":
    console.log(`Showing item: ${result.id}`);
    if (result.progress) console.log("Progress enabled");
    if (result.verbose) console.log("Verbose mode enabled");
    break;
  case "edit":
    console.log(`Editing item: ${result.id}`);
    if (result.editor) console.log(`Using editor: ${result.editor}`);
    if (result.backup) console.log("Backup enabled");
    break;
  case "delete":
    console.log(`Deleting items: ${result.items.join(", ")}`);
    if (result.force) console.log("Force delete enabled");
    if (result.recursive) console.log("Recursive delete enabled");
    break;
}
~~~~

This example demonstrates:

 -  *Subcommand routing*: `command("show", ...)` matches the first argument
    and applies the inner parser to remaining arguments
 -  *Type discrimination*: Using `constant()` with unique values enables
    TypeScript to discriminate between subcommand types in the result union
 -  *Per-subcommand options*: Each subcommand can have its own unique set
    of options and arguments
 -  *Complex arguments*: The `delete` command shows multiple required arguments

The `constant()` parser is crucial here—it adds a literal value to each
subcommand's result object without consuming any input.  This creates
a discriminated union type that TypeScript can use for type narrowing in
`switch` statements or type guards.

Example usage:

~~~~ bash
# Show command with options
$ myapp show --progress --verbose item123

# Edit command with optional editor
$ myapp edit --editor vim --backup item456

# Delete command with multiple items
$ myapp delete --force item1 item2 item3
~~~~

### Advanced subcommand patterns

You can also combine subcommands with global options using `object()`:

~~~~ typescript
const parser = object({
  // Global options available to all subcommands
  debug: optional(option("--debug")),
  config: optional(option("-c", "--config", string())),

  // Subcommand with its own options
  command: or(
    command("server", object({
      type: constant("server" as const),
      port: option("-p", "--port", integer({ min: 1, max: 65535 })),
      daemon: option("-d", "--daemon"),
    })),
    command("client", object({
      type: constant("client" as const),
      connect: option("--connect", url()),
      timeout: optional(option("-t", "--timeout", integer())),
    })),
  ),
});
~~~~

This allows for commands like:

~~~~ bash
$ myapp --debug --config app.json server --port 8080 --daemon
$ myapp client --connect http://localhost:8080 --timeout 5000
~~~~

<!-- cSpell: ignore optparse myapp -->
