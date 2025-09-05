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
import { type InferValue, object, option, argument } from "@optique/core/parser";
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
import { object, option, optional } from "@optique/core/parser";
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
import { type InferValue, tuple, option, argument } from "@optique/core/parser";
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

> [!IMPORTANT]
> You need to use `as const` to ensure the tuple is treated as a fixed-length
> array for type inference. Without `as const`, TypeScript will infer it as a
> variable-length array, losing the tuple type.

### Sequential parsing

The `tuple()` parser processes its component parsers in priority order
(not array order), which means parsers with higher priority are tried first
regardless of their position in the tuple:

~~~~ typescript twoslash
import { argument, command, option, tuple } from "@optique/core/parser";
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
import { type InferValue, option, optional, tuple } from "@optique/core/parser";
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
import { argument, parse, tuple } from "@optique/core/parser";
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
import {
  type InferValue,
  command,
  constant,
  object,
  option,
  or,
} from "@optique/core/parser";
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
import { command, constant, object, option, or, parse } from "@optique/core/parser";
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
import { argument, command, constant, multiple, object, option,
         optional, or, withDefault } from "@optique/core/parser";
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
import { constant, object, option, or } from "@optique/core/parser";
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


`merge()` parser
----------------

The `merge()` parser combines multiple object-generating parsers into a single
unified parser, enabling modular CLI design through reusable option groups.
While originally designed for `object()` parsers, it now accepts any parser
that produces object-like values, including `withDefault()`, `map()`, and other
transformative parsers. This is essential for building maintainable applications
where related options can be shared across different commands or modes.

~~~~ typescript twoslash
import { constant, merge, object, option, optional, or } from "@optique/core/parser";
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
import { merge, object, option } from "@optique/core/parser";
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
import {
  type InferValue,
  flag,
  merge,
  object,
  option,
  withDefault,
  map,
} from "@optique/core/parser";
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
import { flag, merge, object, option, withDefault } from "@optique/core/parser";
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
import { type InferValue, merge, object, option } from "@optique/core/parser";
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
import { type InferValue, flag, merge, object, option, withDefault, map } from "@optique/core/parser";
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
import { concat, tuple, option, parse } from "@optique/core/parser";
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
import { type InferValue, concat, tuple, option } from "@optique/core/parser";
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
import { concat, tuple, option, argument, parse } from "@optique/core/parser";
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
import {
  type InferValue,
  argument,
  constant,
  flag,
  longestMatch,
  object,
} from "@optique/core/parser";
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
import { constant, longestMatch, object, flag, argument, parse } from "@optique/core/parser";
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
import {
  argument,
  command,
  constant,
  flag,
  longestMatch,
  multiple,
  object,
  option,
  optional,
  or,
} from "@optique/core/parser";
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
import { type InferValue, constant, longestMatch, object, option, parse } from "@optique/core/parser";
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
import {
  argument,
  command,
  constant,
  flag,
  longestMatch,
  multiple,
  object,
  option,
  optional,
  or,
} from "@optique/core/parser";
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

<!-- cSpell: ignore myapp -->
