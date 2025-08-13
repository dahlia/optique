Optique: Type-safe combinatorial CLI parser for TypeScript
==========================================================

> [!CAUTION]
> Optique is currently in early development for proof of concept purposes,
> and is not yet ready for production use.  The API is subject to change,
> and there may be bugs or missing features.

Optique is a modern command-line interface parser inspired by
Haskell's [optparse-applicative] and TypeScript's [Zod].  It allows you to
build complex CLI interfaces using composable parsers with full type safety
and automatic type inference.

Unlike traditional CLI parsers that rely on configuration objects or
string-based definitions, Optique uses a functional approach where parsers
are first-class values that can be combined, transformed, and reused.
This compositional design makes it easy to express complex argument structures
while maintaining complete type safety throughout your application.

[optparse-applicative]: https://github.com/pcapriotti/optparse-applicative
[Zod]: https://zod.dev/


Core concepts
-------------

Optique is built around three fundamental concepts: value parsers that convert
strings to typed values, option parsers that handle command-line flags and
their arguments, and combinators like `or()`, `object()`, `tuple()`,
`optional()`, and `multiple()` that compose parsers into sophisticated
argument structures.

The library automatically infers the result type of your parser composition,
ensuring that your parsed CLI arguments are fully typed without manual type
annotations. When parsing fails, you get detailed error messages that help
users understand what went wrong.


Example
-------

~~~~ typescript
import {
  argument,
  multiple,
  object,
  option,
  optional,
  or,
  parse
} from "@optique/core/parser";
import { integer, locale, string, url } from "@optique/core/valueparser";

// Define a sophisticated CLI with optional and repeatable arguments
const parser = or(
  object("Server mode", {
    port: option("-p", "--port", integer({ min: 1, max: 65535 })),
    host: optional(option("-h", "--host", string({ metavar: "HOST" }))),
    locales: multiple(option("-l", "--locale", locale())),
    verbose: optional(option("-v", "--verbose")),
    config: argument(string({ metavar: "CONFIG_FILE" })),
  }),
  object("Client mode", {
    connect: option("-c", "--connect", url({ protocols: ["http", "https"] })),
    headers: multiple(option("-H", "--header", string())),
    timeout: optional(option("-t", "--timeout", integer({ min: 0 }))),
    files: multiple(argument(string({ metavar: "FILE" })), { min: 1, max: 5 }),
  }),
);

const result = parse(parser, process.argv.slice(2));

if (result.success) {
  // TypeScript automatically infers the complex union type with optional fields
  if ("port" in result.value) {
    const server = result.value;
    console.log(`Starting server on ${server.host ?? "localhost"}:${server.port}`);
    console.log(`Supported locales: ${server.locales.join(", ") || "default"}`);
    if (server.verbose) console.log("Verbose mode enabled");
  } else {
    const client = result.value;
    console.log(`Connecting to ${client.connect}`);
    console.log(`Processing ${client.files.length} files`);
    if (client.timeout) console.log(`Timeout: ${client.timeout}ms`);
  }
} else {
  console.error(result.error);
}
~~~~

This example demonstrates Optique's powerful combinators:

 -  **`optional()`** makes parsers optional, returning `undefined` when not
    provided
 -  **`multiple()`** allows repeating options/arguments with configurable
    constraints
 -  **`or()`** creates mutually exclusive alternatives
 -  **`object()`** groups related options into structured data

The parser handles complex scenarios like:

 -  Optional host (defaults to `undefined`)
 -  Multiple locale specifications: `-l en-US -l fr-FR`
 -  Repeatable headers: `-H "Accept: json" -H "User-Agent: myapp"`
 -  Constrained file arguments (1–5 files required in client mode)

All with full type safety and automatic inference!


Parser combinators
------------------

Optique provides several powerful combinators for composing parsers:

### Core combinators

 -  **`object()`**: Combines multiple parsers into a structured object
 -  **`or()`**: Creates mutually exclusive alternatives
    (try first, then second, etc.)
 -  **`tuple()`**: Combines multiple parsers into a tuple with preserved order

### Modifying combinators

 -  **`optional()`**: Makes any parser optional, returning `undefined` if not
    matched

    ~~~~ typescript
    const parser = object({
      name: option("-n", "--name", string()),
      verbose: optional(option("-v", "--verbose")), // undefined if not provided
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

 -  **`tuple()`**: Combines parsers into a typed tuple, maintaining order

    ~~~~ typescript
    const parser = object({
      // Tuple with mixed types: [name, port, verbose?]
      config: tuple([
        option("-n", "--name", string()),
        option("-p", "--port", integer({ min: 1, max: 65535 })),
        optional(option("-v", "--verbose")),
      ]),
      // Labeled tuple for better readability
      endpoint: tuple("Server", [
        option("-h", "--host", string()),
        option("-p", "--port", integer()),
      ]),
    });
    ~~~~

### Advanced patterns

Combinators can be nested and combined in powerful ways:

~~~~ typescript
const parser = or(
  // Development mode: optional debug flag, multiple log levels
  object("dev", {
    dev: option("--dev"),
    debug: optional(option("--debug")),
    logLevel: multiple(option("--log", string()), { max: 3 }),
  }),
  // Production mode: required config, multiple workers
  object("prod", {
    config: option("-c", "--config", string()),
    workers: multiple(option("-w", "--worker", integer({ min: 1 }))),
    ssl: optional(object({
      cert: option("--cert", string()),
      key: option("--key", string()),
    })),
  }),
);
~~~~

The `multiple()` combinator is especially powerful when combined with `object()`
parsers, as it provides empty arrays as defaults when no matches are found,
allowing for clean optional repeated arguments.

<!-- cSpell: ignore optparse -->
