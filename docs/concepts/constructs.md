---
description: >-
  Construct combinators compose multiple parsers into complex structures
  using object(), tuple(), or(), and merge() to build sophisticated CLI
  interfaces with full type inference.
---

Construct combinators
=====================

Construct combinators are the high-level combinators that compose multiple
parsers into complex, structured CLI interfaces. While primitive parsers handle
individual options and arguments, construct combinators orchestrate them into
cohesive applications with sophisticated behavior patterns like mutually
exclusive commands, structured configuration, and modular option groups.

Understanding construct combinators is essential for building real-world CLI
applications. They provide the architectural patterns you need to create
maintainable, user-friendly interfaces that can grow in complexity without
becoming unwieldy. Each construct combinator follows Optique's compositional
philosophy: complex behavior emerges from combining simple, well-understood
pieces.

The power of construct combinators lies in their ability to preserve full type
safety while enabling complex composition. TypeScript automatically infers
the result types of even deeply nested parser structures, ensuring that your
parsed CLI data is fully typed without manual type annotations.


`object()` parser
-----------------

The `object()` parser combines multiple named parsers into a single parser that
produces a structured object. This is the primary way to group related options
and arguments into logical units, creating the foundation for most CLI
applications.

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import type { InferValue } from "@optique/core/parser";
import { argument, option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

const serverConfig = object({
  name: argument(string({ metavar: "NAME" })),
  port: option("-p", "--port", integer({ min: 1, max: 0xffff })),
  host: option("-h", "--host", string()),
  verbose: option("-v", "--verbose")
});

type ServerConfig = InferValue<typeof serverConfig>;
//   ^?








// Type automatically inferred as above.
~~~~

### Labeled objects

You can provide a label for documentation and error reporting purposes.
This label appears in help text to group related options:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
// ---cut-before---
const networkOptions = object("Network Configuration", {
  host: option("--host", string()),
  port: option("--port", integer()),
  ssl: option("--ssl")
});

const loggingOptions = object("Logging Options", {
  logLevel: option("--log-level", choice(["debug", "info", "warn", "error"])),
  logFile: optional(option("--log-file", string()))
});
~~~~

### Parser priority

The `object()` parser uses the highest priority among its constituent parsers.
This ensures that higher-priority parsers (like commands) within the object are
tried before lower-priority parsers in other parts of the CLI structure.


`tuple()` parser
----------------

The `tuple()` parser combines multiple parsers into a sequential parser that
produces a tuple (ordered heterogenous array) of results. Unlike `object()`
which uses named fields, `tuple()` preserves the order and positional nature of
its components.

~~~~ typescript twoslash
import { tuple } from "@optique/core/constructs";
import type { InferValue } from "@optique/core/parser";
import { argument, option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

const connectionTuple = tuple([
  option("--host", string()),
  option("--port", integer()),
  argument(string({ metavar: "DATABASE" }))
] as const);

type Connection = InferValue<typeof connectionTuple>;
//   ^?


// Type automatically inferred as above.
~~~~

### Sequential parsing

The `tuple()` parser processes its component parsers in priority order
(not array order), which means parsers with higher priority are tried first
regardless of their position in the tuple:

~~~~ typescript twoslash
import { tuple } from "@optique/core/constructs";
import { argument, command, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
// ---cut-before---
// Even though argument is last in the array, it might be parsed first
// depending on the current parsing context and available input
const mixedTuple = tuple([
  option("-v", "--verbose"),            // Priority 10
  command("start", argument(string())), // Priority 15 - tried first
  argument(string())                    // Priority 5
] as const);
~~~~

### Labeled tuples

Like `object()`, `tuple()` supports labels for documentation:

~~~~ typescript twoslash
import { tuple } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { float, string } from "@optique/core/valueparser";
// ---cut-before---
const coordinates = tuple("Location", [
  option("--lat", float({ metavar: "LATITUDE" })),
  option("--lon", float({ metavar: "LONGITUDE" })),
  optional(option("--alt", float({ metavar: "ALTITUDE" })))
] as const);

type Coordinate = InferValue<typeof coordinates>;
//   ^?


// Type automatically inferred as above.
~~~~

### Usage patterns

Tuples are useful when you need:

 -  Ordered results where position matters
 -  Integration with APIs that expect arrays
 -  Processing of homogeneous but positionally significant data

~~~~ typescript twoslash
import { tuple } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";
import { argument } from "@optique/core/primitives";
import { integer } from "@optique/core/valueparser";
// ---cut-before---
const rangeParser = tuple([
  argument(integer({ metavar: "START" })),
  argument(integer({ metavar: "END" }))
]);

// Usage: myapp 10 20
// Result: [10, 20]

const config = parse(rangeParser, ["10", "20"]);
if (config.success) {
  const [start, end] = config.value;
  console.log(`Processing range ${start} to ${end}.`);
}
~~~~


`or()` parser
-------------

The `or()` parser creates mutually exclusive alternatives, trying each
alternative in order until one succeeds. This is fundamental for building CLIs
with different modes of operation, subcommands, or mutually exclusive option
sets.

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import type { InferValue } from "@optique/core/parser";
import { command, constant, option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

const parser = or(
  // Server mode
  object({
    mode: constant("server"),
    port: option("-p", "--port", integer()),
    host: option("-h", "--host", string())
  }),

  // Client mode
  object({
    mode: constant("client"),
    connect: option("-c", "--connect", string()),
    timeout: option("-t", "--timeout", integer())
  })
);

type Result = InferValue<typeof parser>;
//   ^?











// Type automatically inferred as discriminated union.
~~~~

### Discriminated unions

The `or()` parser creates TypeScript discriminated unions when used with
`constant()` parsers. This enables type-safe pattern matching:

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";
import { command, constant, option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

const parser = or(
  // Server mode
  object({
    mode: constant("server"),
    port: option("-p", "--port", integer()),
    host: option("-h", "--host", string())
  }),

  // Client mode
  object({
    mode: constant("client"),
    connect: option("-c", "--connect", string()),
    timeout: option("-t", "--timeout", integer())
  })
);
// ---cut-before---
const config = parse(parser, ["-p", "8080", "-h", "localhost"]);

if (config.success) {
  switch (config.value.mode) {
    case "server":
      // TypeScript knows this is server config
      console.log(`Server running on ${config.value.host}:${config.value.port}.`);
      break;
    case "client":
      // TypeScript knows this is client config
      console.log(`Connecting to ${config.value.connect} with timeout ${config.value.timeout}.`);
      break;
  }
}
~~~~

### Command alternatives

The most common use of `or()` is for subcommand dispatch:

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import { argument, command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
// ---cut-before---
const gitLike = or(
  command("add", object({
    type: constant("add"),
    files: multiple(argument(string())),
    all: optional(option("-A", "--all"))
  })),

  command("commit", object({
    type: constant("commit"),
    message: option("-m", "--message", string()),
    amend: optional(option("--amend"))
  })),

  command("push", object({
    type: constant("push"),
    remote: withDefault(option("-r", "--remote", string()), "origin"),
    force: optional(option("-f", "--force"))
  }))
);

// Usage examples:
// myapp add file1.txt file2.txt --all
// myapp commit -m "Fix parser bug" --amend
// myapp push --remote upstream --force
~~~~

### Alternative parsing strategies

You can also use `or()` for different parsing approaches of the same logical concept:

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import { constant, option } from "@optique/core/primitives";
import { integer, string, url } from "@optique/core/valueparser";
// ---cut-before---
const flexibleConfig = or(
  // Configuration via individual options
  object({
    source: constant("options"),
    host: option("--host", string()),
    port: option("--port", integer()),
    ssl: option("--ssl")
  }),

  // Configuration via config file
  object({
    source: constant("file"),
    configFile: option("-c", "--config", string())
  }),

  // Configuration via URL
  object({
    source: constant("url"),
    connectionString: option("--url", url())
  })
);
~~~~

### Error message customization

*This feature is available since Optique 0.9.0.*

The `or()` parser generates contextual error messages by analyzing what types of
inputs are expected (options, commands, or arguments). You can customize these
messages using the `errors.noMatch` option, which supports both static messages
and dynamic functions for advanced use cases like internationalization:

~~~~ typescript twoslash
import { message, or } from "@optique/core";
import { command, constant } from "@optique/core/primitives";
// ---cut-before---
// Static custom error message
const parser1 = or(
  command("add", constant("add")),
  command("remove", constant("remove")),
  {
    errors: {
      noMatch: message`Invalid command. Please use 'add' or 'remove'.`
    }
  }
);

// Dynamic error message for internationalization
const parser2 = or(
  command("add", constant("add")),
  command("remove", constant("remove")),
  {
    errors: {
      noMatch: ({ hasOptions, hasCommands, hasArguments }) => {
        if (hasCommands && !hasOptions && !hasArguments) {
          return message`일치하는 명령을 찾을 수 없습니다.`; // Korean
        }
        return message`잘못된 입력입니다.`;
      }
    }
  }
);
~~~~

The function form receives a `NoMatchContext` object with three boolean flags:

 -  `hasOptions`: Whether any parsers expect options
 -  `hasCommands`: Whether any parsers expect commands
 -  `hasArguments`: Whether any parsers expect arguments

This enables precise, context-aware error messages. For example, if all parsers
expect only commands, you can show "No matching command found" instead of the
generic "No matching option or command found."

**Default behavior** (when no custom error is provided):

| Context                          | Default error message                           |
| -------------------------------- | ----------------------------------------------- |
| Only arguments expected          | `Missing required argument.`                    |
| Only commands expected           | `No matching command found.`                    |
| Only options expected            | `No matching option found.`                     |
| Commands and options expected    | `No matching option or command found.`          |
| Arguments and options expected   | `No matching option or argument found.`         |
| Arguments and commands expected  | `No matching command or argument found.`        |
| All three types expected         | `No matching option, command, or argument found.` |

The default messages automatically adapt to your parser structure, but you can
override them for custom formatting or localization needs.


`merge()` parser
----------------

The `merge()` parser combines multiple object-generating parsers into a single
unified parser, enabling modular CLI design through reusable option groups.
While originally designed for `object()` parsers, it now accepts any parser
that produces object-like values, including `withDefault()`, `map()`, and other
transformative parsers. This is essential for building maintainable applications
where related options can be shared across different commands or modes.

~~~~ typescript twoslash
import { merge, object, or } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { constant, option } from "@optique/core/primitives";
import { string, integer, choice } from "@optique/core/valueparser";

// Define reusable option groups
const networkOptions = object("Network", {
  host: option("--host", string()),
  port: option("--port", integer({ min: 1, max: 0xffff }))
});

const authOptions = object("Authentication", {
  username: option("-u", "--user", string()),
  password: optional(option("-p", "--pass", string())),
  token: optional(option("-t", "--token", string()))
});

const loggingOptions = object("Logging", {
  logLevel: option("--log-level", choice(["debug", "info", "warn", "error"])),
  logFile: optional(option("--log-file", string()))
});

// Combine groups for different application modes
const devMode = merge(
  object({ mode: constant("development") }),
  networkOptions,
  loggingOptions
);

const prodMode = merge(
  object({ mode: constant("production") }),
  networkOptions,
  authOptions,
  loggingOptions,
  object("Production", {
    workers: option("-w", "--workers", integer({ min: 1 })),
    configFile: option("-c", "--config", string())
  })
);

const applicationConfig = or(devMode, prodMode);
~~~~

### Labeled merge groups

*This feature is available since Optique 0.4.0.*

Like `object()`, the `merge()` parser can accept an optional label as its first
parameter. This label appears in help text to organize the combined options into
a logical group, making documentation clearer when merging parsers that don't
already have their own labels:

~~~~ typescript twoslash
import { merge, object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string, integer, choice } from "@optique/core/valueparser";

// Define simple option groups without labels
const connectionOptions = object({
  host: option("--host", string()),
  port: option("--port", integer())
});

const performanceOptions = object({
  workers: option("-w", "--workers", integer({ min: 1 })),
  timeout: option("-t", "--timeout", integer()),
  cache: option("--cache", choice(["none", "memory", "disk"]))
});

// Combine with a label for organized help text
const serverConfig = merge(
  "Server Configuration",  // Label for the merged group
  connectionOptions,
  performanceOptions
);

// The label "Server Configuration" will appear in help text,
// grouping all options from both parsers under this section
~~~~

This is particularly useful when combining parsers from different modules or
when the constituent parsers don't have their own labels. It ensures that the
merged options appear as a cohesive group in help documentation rather than
scattered individual options.

### Advanced parser combinations

*This feature is available since Optique 0.3.0.*

The `merge()` parser can now combine various types of object-generating parsers,
not just `object()` parsers. This enables sophisticated patterns like dependent
options and conditional configurations:

~~~~ typescript twoslash
import { merge, object } from "@optique/core/constructs";
import { map, withDefault } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { flag, option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { run } from "@optique/run";

// Dependent options pattern: options that are only available when a flag is set
const dependentOptions = withDefault(
  object({
    feature: flag("-f", "--feature"),
    config: option("-c", "--config", string()),
    level: option("-l", "--level", integer())
  }),
  { feature: false as const } as const
);

// Transform parser results
const transformedConfig = map(
  object({
    host: option("--host", string()),
    port: option("--port", integer())
  }),
  ({ host, port }) => ({ endpoint: `${host}:${port}` })
);

// Combine different parser types
const advancedParser = merge(
  dependentOptions,           // withDefault() parser
  transformedConfig,          // map() result
  object({                    // traditional object() parser
    verbose: option("-v", "--verbose")
  })
);

type Result = InferValue<typeof advancedParser>;
//   ^?













const result: Result = run(advancedParser);
~~~~

### Dependent options pattern

A common use case is creating options that are only relevant when certain
conditions are met:

~~~~ typescript twoslash
import { merge, object } from "@optique/core/constructs";
import { withDefault } from "@optique/core/modifiers";
import { flag, option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
// ---cut-before---
const serverMode = withDefault(
  object({
    server: flag("-s", "--server"),
    port: option("-p", "--port", integer()),
    host: option("-h", "--host", string()),
    workers: option("-w", "--workers", integer())
  }),
  { server: false as const } as const
);

const globalOptions = object({
  verbose: option("-v", "--verbose"),
  config: option("-c", "--config", string())
});

const appConfig = merge(serverMode, globalOptions);

// Usage examples:
// myapp -v -c config.json              → server mode disabled
// myapp -s -p 8080 -h localhost -v     → server mode with port and host
// myapp -s -p 3000 -w 4 -c prod.json   → full server configuration
~~~~

### Type inference and merging

The `merge()` parser intelligently combines the types of all merged parsers,
regardless of their original parser type:

~~~~ typescript twoslash
import { merge, object } from "@optique/core/constructs";
import type { InferValue } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { integer } from "@optique/core/valueparser";
// ---cut-before---
const basicOptions = object({
  verbose: option("-v", "--verbose"),
  quiet: option("-q", "--quiet")
});

const advancedOptions = object({
  timeout: option("--timeout", integer()),
  retries: option("--retries", integer())
});

const allOptions = merge(basicOptions, advancedOptions);

type Options = InferValue<typeof allOptions>;
//    ^?









// Type automatically inferred as above.
~~~~

When combining different parser types, the merge result maintains full type
safety while accounting for the unique characteristics of each parser:

~~~~ typescript twoslash
import { merge, object } from "@optique/core/constructs";
import { map, withDefault } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { flag, option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
// ---cut-before---
const conditionalFeatures = withDefault(
  object({
    experimental: flag("--experimental"),
    debugLevel: option("--debug-level", integer())
  }),
  { experimental: false as const } as const
);

const transformedSettings = map(
  object({
    theme: option("--theme", string()),
    lang: option("--language", string())
  }),
  ({ theme, lang }) => ({
    locale: `${lang}_${theme.toUpperCase()}`,
    settings: { theme, lang }
  })
);

const complexConfig = merge(
  conditionalFeatures,
  transformedSettings,
  object({
    version: option("--version", string())
  })
);

type ComplexConfig = InferValue<typeof complexConfig>;
//   ^?
















// Type automatically inferred with conditional fields and transformations.
~~~~


`concat()` parser
-----------------

*This API is available since Optique 0.2.0.*

The `concat()` parser combines multiple `tuple()` parsers into a single unified
parser, enabling modular tuple design through reusable tuple groups. This is
the tuple equivalent of `merge()` for objects, providing compositional
flexibility for sequential, positional argument structures.

~~~~ typescript twoslash
import { concat, tuple } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

// Define reusable tuple groups
const basicFlags = tuple([
  option("-v", "--verbose"),
  option("-q", "--quiet"),
] as const);

const serverConfig = tuple([
  option("-p", "--port", integer({ min: 1, max: 0xffff })),
  option("-h", "--host", string()),
] as const);

const logConfig = tuple([
  option("--log-level", string()),
  option("--log-file", string()),
] as const);

// Combine tuples for different application modes
const webServer = concat(basicFlags, serverConfig);
const fullServer = concat(basicFlags, serverConfig, logConfig);

const result = parse(fullServer, [
  "-v", "-p", "8080", "-h", "localhost",
  "--log-level", "info", "--log-file", "app.log"
]);

if (result.success) {
  const [verbose, quiet, port, host, logLevel, logFile] = result.value;
  console.log(`Server: ${host}:${port}, verbose: ${verbose}.`);
  console.log(`Logging: ${logLevel} to ${logFile}.`);
}
~~~~

### Type concatenation

The `concat()` parser intelligently flattens the types of all concatenated
tuple parsers into a single tuple type:

~~~~ typescript twoslash
import { concat, tuple } from "@optique/core/constructs";
import type { InferValue } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
// ---cut-before---
const userInfo = tuple([
  option("-n", "--name", string()),
  option("-a", "--age", integer()),
] as const);

const preferences = tuple([
  option("-t", "--theme", string()),
  option("-v", "--verbose"),
] as const);

const combined = concat(userInfo, preferences);

type CombinedType = InferValue<typeof combined>;
//   ^?


// Type automatically inferred as above.
~~~~

### Usage patterns

Concatenation is useful when you need:

 -  Modular tuple construction from reusable components
 -  Sequential argument processing with clear grouping
 -  Building complex CLIs from simpler tuple building blocks
 -  Maintaining positional semantics across grouped options

~~~~ typescript twoslash
import { concat, tuple } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";
import { argument, option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
// ---cut-before---
// Build authentication tuple
const authTuple = tuple([
  option("-u", "--user", string()),
  option("-p", "--pass", string()),
] as const);

// Build connection tuple
const connectionTuple = tuple([
  option("--host", string()),
  option("--port", integer()),
  option("--ssl"),
] as const);

// Build command arguments tuple
const commandTuple = tuple([
  argument(string()), // command name
  argument(string()), // target file
] as const);

// Combine all for a database client
const dbClient = concat(authTuple, connectionTuple, commandTuple);

// Usage: myapp -u admin -p secret --host db.example.com --port 5432 --ssl backup users.sql
const config = parse(dbClient, [
  "-u", "admin", "-p", "secret",
  "--host", "db.example.com", "--port", "5432", "--ssl",
  "backup", "users.sql"
]);

if (config.success) {
  const [user, pass, host, port, ssl, command, file] = config.value;
  console.log(`Connecting as ${user} to ${host}:${port}.`);
  console.log(`Running ${command} on ${file}.`);
}
~~~~

### Relationship to `merge()`

While `merge()` combines object parsers by merging their properties, `concat()`
combines tuple parsers by flattening their positional elements:

| Combinator | Input parsers      | Result type                       |
| ---------- | ------------------ | --------------------------------- |
| `merge()`  | `object()` parsers | Merged object with all properties |
| `concat()` | `tuple()` parsers  | Flattened tuple with all elements |

Both provide compositional design patterns but serve different structural needs
in CLI applications.


`longestMatch()` parser
-----------------------

*This API is available since Optique 0.3.0.*

The `longestMatch()` parser combines multiple mutually exclusive parsers by
selecting the parser that consumes the most input tokens. Unlike `or()` which
returns the first successful match, `longestMatch()` tries all parsers and
selects the one with the longest match. This enables context-aware parsing
where more specific patterns take precedence over general ones.

~~~~ typescript twoslash
import { longestMatch, object } from "@optique/core/constructs";
import type { InferValue } from "@optique/core/parser";
import { argument, constant, flag } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const globalHelp = object({
  type: constant("global"),
  help: flag("--help"),
});

const contextualHelp = object({
  type: constant("contextual"),
  command: argument(string({ metavar: "COMMAND" })),
  help: flag("--help"),
});

const parser = longestMatch(globalHelp, contextualHelp);

type Result = InferValue<typeof parser>;
//   ^?










// Usage examples:
// myapp --help              → globalHelp (1 token: --help)
// myapp list --help         → contextualHelp (2 tokens: list --help)
~~~~

### Longest match selection

The key behavior of `longestMatch()` is selecting the parser that consumes
the most tokens from the input:

~~~~ typescript twoslash
import { longestMatch, object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";
import { argument, constant, flag } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
// ---cut-before---
const shortPattern = object({
  type: constant("short"),
  help: flag("--help"),
});

const longPattern = object({
  type: constant("long"),
  command: argument(string()),
  help: flag("--help"),
});

const parser = longestMatch(shortPattern, longPattern);

// Short pattern matches: consumes 1 token (--help)
const shortResult = parse(parser, ["--help"]);
if (shortResult.success) {
  console.log(shortResult.value.type); // "short"
}

// Long pattern matches: consumes 2 tokens (list --help)
const longResult = parse(parser, ["list", "--help"]);
if (longResult.success) {
  console.log(longResult.value.type); // "long"
}
~~~~

### Context-aware help systems

The most common use case for `longestMatch()` is implementing context-aware
help systems where `command --help` shows help for that specific command:

~~~~ typescript twoslash
import { longestMatch, object, or } from "@optique/core/constructs";
import { multiple, optional } from "@optique/core/modifiers";
import {
  argument,
  command,
  constant,
  flag,
  option,
} from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
// ---cut-before---
// Define your application commands
const addCommand = command(
  "add",
  object({
    action: constant("add"),
    key: argument(string({ metavar: "KEY" })),
    value: argument(string({ metavar: "VALUE" })),
  }),
);

const listCommand = command(
  "list",
  object({
    action: constant("list"),
    pattern: optional(
      option("-p", "--pattern", string({ metavar: "PATTERN" })),
    ),
  }),
);

// Normal command parsing
const normalParser = object({
  help: constant(false),
  result: or(addCommand, listCommand),
});

// Context-aware help parsing
const contextualHelpParser = object({
  help: constant(true),
  commands: multiple(argument(string({ metavar: "COMMAND" }))),
  flag: flag("--help"),
});

// Combine with longestMatch for intelligent help selection
const parser = longestMatch(normalParser, contextualHelpParser);

// Normal usage works as expected:
// myapp add key1 value1     → normalParser (3 tokens)
// myapp list -p "*.txt"     → normalParser (3 tokens)

// Context-aware help automatically activates:
// myapp list --help         → contextualHelpParser (2 tokens: ["list"])
// myapp add --help          → contextualHelpParser (2 tokens: ["add"])
~~~~

### Type inference and unions

Like `or()`, `longestMatch()` creates discriminated union types when used with
parsers that produce different shaped objects:

~~~~ typescript twoslash
import { longestMatch, object } from "@optique/core/constructs";
import { type InferValue, parse } from "@optique/core/parser";
import { constant, option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
// ---cut-before---
const stringMode = object({
  mode: constant("string" as const),
  value: option("-s", "--string", string()),
});

const numberMode = object({
  mode: constant("number" as const),
  value: option("-n", "--number", integer()),
});

const parser = longestMatch(stringMode, numberMode);

type Config = InferValue<typeof parser>;
//   ^?










// Type-safe pattern matching
const result = parse(parser, ["-s", "hello"]);
if (result.success) {
  switch (result.value.mode) {
    case "string":
      // TypeScript knows this is string config
      console.log(`String value: ${result.value.value}.`);
      break;
    case "number":
      // TypeScript knows this is number config
      console.log(`Number value: ${result.value.value}.`);
      break;
  }
}
~~~~

### Usage patterns and best practices

Use `longestMatch()` when you need:

 -  *Context-aware behavior*: Different parsing based on how much input is
    consumed
 -  *Precedence by specificity*: More specific patterns should win over
    general ones
 -  *Greedy matching*: Always prefer the parser that consumes the most tokens
 -  *Help system integration*: Context-sensitive help that shows relevant
    information

~~~~ typescript twoslash
import { longestMatch, object, or } from "@optique/core/constructs";
import { multiple, optional } from "@optique/core/modifiers";
import {
  argument,
  command,
  constant,
  flag,
  option,
} from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
// ---cut-before---
// Example: Git-like CLI with context-aware help
const gitAdd = command("add", object({
  action: constant("add"),
  files: multiple(argument(string())),
  all: optional(option("-A", "--all")),
}));

const gitCommit = command("commit", object({
  action: constant("commit"),
  message: option("-m", "--message", string()),
}));

const normalCommands = object({
  help: constant(false),
  command: or(gitAdd, gitCommit),
});

const helpParser = object({
  help: constant(true),
  commands: multiple(argument(string())),
  helpFlag: flag("--help"),
});

const cli = longestMatch(normalCommands, helpParser);

// Usage patterns:
// git add file.txt --all      → normalCommands (gitAdd)
// git commit -m "message"     → normalCommands (gitCommit)
// git add --help              → helpParser (commands: ["add"])
// git commit --help           → helpParser (commands: ["commit"])
// git --help                  → helpParser (commands: [])
~~~~

### Relationship to other combinators

| Combinator       | Selection strategy     | Use case                         |
| ---------------- | ---------------------- | -------------------------------- |
| `or()`           | First successful match | Mutually exclusive alternatives  |
| `longestMatch()` | Most tokens consumed   | Context-aware and greedy parsing |
| `merge()`        | Combines all parsers   | Composing complementary parsers  |

The `longestMatch()` combinator bridges the gap between simple alternatives
(`or()`) and complex composition (`merge()`) by providing intelligent selection
based on input consumption.


`group()` parser
----------------

*This API is available since Optique 0.4.0.*

The `group()` parser is a documentation-only wrapper that applies a group label
to any parser for help text organization. This allows you to maintain clean code
structure with combinators like `or()`, `flag()`, or `multiple()` while
providing well-organized help output through group labeling.

Unlike `merge()` and `object()` which have built-in label support, many parsers
don't natively support labeling. The `group()` parser fills this gap by wrapping
any parser with a labeled section that appears in help documentation.

~~~~ typescript twoslash
import { group, or } from "@optique/core/constructs";
import { map, multiple } from "@optique/core/modifiers";
import { argument, flag } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

// Group mutually exclusive output format options
const outputFormat = group(
  "Output Format",
  or(
    map(flag("--json"), () => "json" as const),
    map(flag("--yaml"), () => "yaml" as const),
    map(flag("--xml"), () => "xml" as const),
  ),
);

// Group multiple file inputs
const inputFiles = group(
  "Input Files",
  multiple(argument(string({ metavar: "FILE" })), { min: 1 }),
);

// The labels "Output Format" and "Input Files" will appear as
// section headers in help text, organizing related options
~~~~

### Documentation-only wrapper

The `group()` parser has identical parsing behavior to its wrapped parser.
All parsing operations, state management, and type information are preserved
unchanged:

~~~~ typescript twoslash
import { group, or } from "@optique/core/constructs";
import { map } from "@optique/core/modifiers";
import { type InferValue, parse } from "@optique/core/parser";
import { flag } from "@optique/core/primitives";

const formatParser = or(
  map(flag("--json"), () => "json" as const),
  map(flag("--yaml"), () => "yaml" as const),
);

const groupedParser = group("Format Options", formatParser);

// Type inference is preserved
type FormatType = InferValue<typeof groupedParser>;
//   ^?


// Parsing behavior is identical
const result1 = parse(formatParser, ["--json"]);
const result2 = parse(groupedParser, ["--json"]);

if (result1.success && result2.success) {
  // Both produce the same result
  console.assert(result1.value === result2.value); // "json"
}
~~~~

### Realistic usage patterns

The `group()` parser is most useful with parsers that don't have built-in
labeling support:

~~~~ typescript twoslash
import { group, or, object } from "@optique/core/constructs";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import { argument, flag, option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
// ---cut-before---
// Logging level selection (mutually exclusive)
const loggingOptions = group(
  "Logging Options",
  or(
    map(flag("--debug"), () => "debug" as const),
    map(flag("--verbose"), () => "verbose" as const),
    map(flag("--quiet"), () => "quiet" as const),
  ),
);

// Multiple input files
const inputSources = group(
  "Input Sources",
  multiple(argument(string({ metavar: "FILE" })), { min: 1 }),
);

// Optional output configuration
const outputConfig = group(
  "Output Configuration",
  optional(option("--output", string({ metavar: "PATH" }))),
);

// Single debug flag
const debugMode = group(
  "Debug Mode",
  flag("--debug-mode"),
);

// Default server configuration
const serverSettings = group(
  "Server Configuration",
  withDefault(
    object({
      port: option("--port", integer()),
      host: option("--host", string()),
    }),
    { port: 3000, host: "localhost" },
  ),
);
~~~~

### Help text organization

The primary benefit of `group()` is organizing help output into logical sections:

~~~~ ansi
Usage: [1mmyapp[0m [2m([0m[3m--debug[0m | [3m--verbose[0m | [3m--quiet[0m[2m)[0m [2m[[0m[3m--output[0m [4m[2mPATH[0m[2m][0m [3m--debug-mode[0m [2m[[0m[3m--port[0m [4m[2mINTEGER[0m [3m--host[0m [4m[2mSTRING[0m[2m][0m [4mFILE[0m[2m...[0m

Logging Options:
  [3m--debug[0m
  [3m--verbose[0m
  [3m--quiet[0m

Output Configuration:
  [3m--output[0m [4m[2mPATH[0m

Debug Mode:
  [3m--debug-mode[0m

Server Configuration:
  [3m--port[0m [4m[2mINTEGER[0m
  [3m--host[0m [4m[2mSTRING[0m

Input Sources:
  [4mFILE[0m


~~~~

Without `group()`, these options would appear as a flat list without clear
organization, making it harder for users to understand the relationship between
related options.

### Nested groups

The `group()` parser supports nesting, allowing you to create hierarchical
documentation structures:

~~~~ typescript twoslash
import { group, object } from "@optique/core/constructs";
import { flag, option } from "@optique/core/primitives";
import { integer } from "@optique/core/valueparser";
// ---cut-before---
const debugOptions = object({
  verbose: flag("--verbose"),
  trace: flag("--trace"),
});

const serverOptions = object({
  port: option("--port", integer()),
  workers: option("--workers", integer()),
});

// First level grouping
const innerDebugGroup = group("Debug Options", debugOptions);
const innerServerGroup = group("Server Options", serverOptions);

// Second level grouping
const applicationConfig = group("Application Configuration", object({
  debug: innerDebugGroup,
  server: innerServerGroup,
}));

// This creates a nested structure in help documentation
~~~~

### Best practices

Use `group()` when you need:

 -  *Section organization*: Grouping related options under meaningful headers
 -  *Parser flexibility*: Labeling parsers that don't have built-in label support
 -  *Help text clarity*: Making complex CLIs more user-friendly
 -  *Clean code structure*: Maintaining modular parser composition

~~~~ typescript twoslash
import { group, object, or } from "@optique/core/constructs";
import { map, multiple, withDefault } from "@optique/core/modifiers";
import { argument, flag, option } from "@optique/core/primitives";
import { string, integer, choice } from "@optique/core/valueparser";
// ---cut-before---
// Example: File processing tool with organized help
const processingMode = group(
  "Processing Mode",
  or(
    map(flag("--compress"), () => "compress" as const),
    map(flag("--extract"), () => "extract" as const),
    map(flag("--list"), () => "list" as const),
  ),
);

const compressionSettings = group(
  "Compression Settings",
  object({
    level: withDefault(
      option("--level", integer({ min: 1, max: 9 })),
      6,
    ),
    algorithm: withDefault(
      option("--algorithm", choice(["gzip", "bzip2", "xz"])),
      "gzip",
    ),
  }),
);

const inputOutput = group(
  "Input/Output",
  object({
    input: multiple(argument(string({ metavar: "INPUT_FILE" })), { min: 1 }),
    output: option("-o", "--output", string({ metavar: "OUTPUT_FILE" })),
  }),
);

// Each group appears as a distinct section in help text,
// making the CLI interface much more approachable
~~~~


Duplicate option detection
---------------------------

Optique automatically detects and prevents duplicate option names within parser
combinators to avoid ambiguous behavior. When the same option name appears in
multiple fields or parsers, an error is raised at parse time.

### Detected duplicates

The `object()`, `tuple()`, and `merge()` combinators validate that option names
are unique across their child parsers:

~~~~ typescript twoslash
import { object, option } from "@optique/core";
import { parse } from "@optique/core/parser";
// ---cut-before---
// ❌ This will error - duplicate "-v" option
const parser = object({
  verbose: option("-v", "--verbose"),
  version: option("-v", "--version"),  // Duplicate: -v
});

const result = parse(parser, ["-v"]);
// Error: Duplicate option name `-v` found in fields: "verbose" "version".
//        Each option name must be unique within a parser combinator.
~~~~

This applies to nested structures as well:

~~~~ typescript twoslash
import { object, option } from "@optique/core";
import { parse } from "@optique/core/parser";
// ---cut-before---
// ❌ Nested duplicate detected
const parser = object({
  opts: object({
    verbose: option("-v"),
  }),
  flags: object({
    version: option("-v"),  // Duplicate across nested objects
  }),
});
~~~~

### Allowed duplicates in `or()`

The `or()` combinator allows duplicate option names because branches are
mutually exclusive—only one branch can match:

~~~~ typescript twoslash
import { or, option } from "@optique/core";
import { parse } from "@optique/core/parser";
// ---cut-before---
// ✅ This is valid - branches are mutually exclusive
const parser = or(
  option("-v", "--verbose"),
  option("-v", "--version"),
);

const result = parse(parser, ["-v"]);
// First matching branch wins
~~~~

### Opting out with `allowDuplicates`

For advanced use cases, you can disable duplicate detection using the
`allowDuplicates` option:

~~~~ typescript twoslash
import { object, option } from "@optique/core";
import { parse } from "@optique/core/parser";
// ---cut-before---
const parser = object({
  verbose: option("-v", "--verbose"),
  version: option("-v", "--version"),
}, { allowDuplicates: true });

const result = parse(parser, ["-v"]);
// Succeeds - first parser wins
~~~~

> [!CAUTION]
> Using `allowDuplicates` can lead to unpredictable behavior where the first
> matching parser consumes the option and subsequent parsers receive their
> default values. Only use this option when you fully understand the
> implications.

<!-- cSpell: ignore myapp -->
