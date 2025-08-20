---
description: >-
  Construct combinators compose multiple parsers into complex structures
  using object(), tuple(), or(), merge(), and concat() to build sophisticated CLI
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
  port: option("-p", "--port", integer({ min: 1, max: 65535 })),
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
  console.log(`Processing range ${start} to ${end}`);
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
      console.log(`Server running on ${config.value.host}:${config.value.port}`);
      break;
    case "client":
      // TypeScript knows this is client config
      console.log(`Connecting to ${config.value.connect} with timeout ${config.value.timeout}`);
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

The `merge()` parser combines multiple `object()` parsers into a single unified
parser, enabling modular CLI design through reusable option groups. This is
essential for building maintainable applications where related options can be
shared across different commands or modes.

~~~~ typescript twoslash
import { constant, merge, object, option, optional, or } from "@optique/core/parser";
import { string, integer, choice } from "@optique/core/valueparser";

// Define reusable option groups
const networkOptions = object("Network", {
  host: option("--host", string()),
  port: option("--port", integer({ min: 1, max: 65535 }))
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

### Type merging

The `merge()` parser intelligently combines the types of all merged parsers:

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

<!-- cSpell: ignore myapp -->


`concat()` parser
-----------------

The `concat()` parser combines multiple `tuple()` parsers into a single unified
parser that produces a flattened tuple containing all values from the individual
parsers in sequence. This enables compositional construction of sequential
argument patterns by combining simpler tuple parsers.

~~~~ typescript twoslash
import { concat, tuple, option, argument } from "@optique/core/parser";
import { string, integer } from "@optique/core/valueparser";

// Define reusable tuple components
const fileOptions = tuple([
  option("-f", "--file", string()),
  argument(string({ metavar: "INPUT" }))
]);

const outputOptions = tuple([
  option("-o", "--output", string()),
  optional(option("-v", "--verbose"))
]);

// Combine tuple parsers sequentially
const processCommand = concat(fileOptions, outputOptions);

// Usage: myapp --file config.json input.txt --output result.json --verbose
// Result: [string, string, string, boolean | undefined]
~~~~

### Sequential parsing

The `concat()` parser applies each tuple parser in sequence, with each parser
processing the remaining input after the previous parser completes:

~~~~ typescript twoslash
import { concat, tuple, option, argument } from "@optique/core/parser";
import { string, integer } from "@optique/core/valueparser";
// ---cut-before---
const setupPhase = tuple([
  option("--host", string()),
  option("--port", integer())
]);

const actionPhase = tuple([
  argument(string({ metavar: "COMMAND" })),
  option("-v", "--verbose")
]);

const fullCommand = concat(setupPhase, actionPhase);

// Parse: ["--host", "localhost", "--port", "8080", "start", "--verbose"]
// Result: ["localhost", 8080, "start", true]
~~~~

### Type concatenation

The `concat()` parser flattens tuple types by concatenating them in order:

~~~~ typescript twoslash
import { type InferValue, concat, tuple, option, argument } from "@optique/core/parser";
import { string, integer } from "@optique/core/valueparser";
// ---cut-before---
const partA = tuple([
  option("-a", string()),    // string
  argument(integer())        // number
]);

const partB = tuple([
  option("-b"),             // boolean
  argument(string())        // string
]);

const combined = concat(partA, partB);

type CombinedType = InferValue<typeof combined>;
//   ^?




// Type automatically inferred as [string, number, boolean, string]
~~~~

### Multiple parser support

Like `merge()`, `concat()` supports combining 2-5 tuple parsers in a single call:

~~~~ typescript twoslash
import { concat, tuple, option } from "@optique/core/parser";
// ---cut-before---
const step1 = tuple([option("--init")]);
const step2 = tuple([option("--configure")]);
const step3 = tuple([option("--build")]);
const step4 = tuple([option("--deploy")]);

const pipeline = concat(step1, step2, step3, step4);
// Result type: [boolean, boolean, boolean, boolean]
~~~~

<!-- cSpell: ignore myapp -->
