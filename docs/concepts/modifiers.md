---
description: >-
  Modifying combinators enhance existing parsers by making them optional,
  providing defaults, transforming results, or allowing multiple occurrences
  while preserving type safety.
---

Modifying combinators
=====================

Modifying combinators enhance and transform existing parsers without changing
their core parsing logic. They act as decorators or wrappers that add new
capabilities: making parsers optional, providing default values, transforming
results, or allowing multiple occurrences. This compositional approach allows
you to build exactly the CLI behavior you need by combining simple, focused
modifiers.

The power of modifying combinators lies in their composability. You can chain
them together to create sophisticated parsing behavior while maintaining full
type safety. TypeScript automatically infers how each modifier affects
the result type, so you get complete type information without manual annotations.

Each modifier preserves the original parser's essential characteristics—like
priority and usage information—while extending its behavior. This ensures that
modified parsers integrate seamlessly with Optique's priority system and help
text generation.


`optional()` parser
-------------------

The `optional()` modifier makes any parser optional, allowing parsing to succeed
even when the wrapped parser fails to match. If the wrapped parser succeeds,
`optional()` returns its value. If it fails, `optional()` returns `undefined`
without consuming any input or reporting an error.

~~~~ typescript twoslash
import { optional } from "@optique/core/parser";
import { type InferValue, option, object } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";

const parser = object({
  name: option("-n", "--name", string()),        // Required
  email: optional(option("-e", "--email", string())), // Optional
// ^?



  verbose: option("-v", "--verbose")             // Required boolean
});
~~~~

### Type transformation

The `optional()` modifier transforms the result type from `T` to `T | undefined`.
This forces you to handle the case where the value might not be present,
preventing runtime errors from assuming values exist:

~~~~ typescript twoslash
import { optional, parse } from "@optique/core/parser";
import { type InferValue, option, object } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";

const parser = object({
  name: option("-n", "--name", string()),        // Required
  email: optional(option("-e", "--email", string())), // Optional
  verbose: option("-v", "--verbose")             // Required boolean
});
// ---cut-before---
const config = parse(parser, ["--name", "Alice", "--verbose"]);

if (config.success) {
  console.log(`Name: ${config.value.name}`);        // Safe: always present
  console.log(`Verbose: ${config.value.verbose}`);  // Safe: always present

  // Must check for undefined
  if (config.value.email) {
    console.log(`Email: ${config.value.email}`);    // Safe: checked first
  } else {
    console.log("No email provided");
  }
}
~~~~

### Usage patterns

The `optional()` modifier is ideal when:

 -  A parameter might or might not be provided
 -  You want to explicitly handle the “not provided” case
 -  The absence of a value has semantic meaning in your application

~~~~ typescript twoslash
import { argument, object, option, optional, parse } from "@optique/core/parser";
import { choice, string } from "@optique/core/valueparser";
// ---cut-before---
const backupConfig = object({
  source: argument(string({ metavar: "SRC" })), // Required source
  destination: argument(string({ metavar: "DEST" })), // Required destination
  compression: optional(option("-c", "--compress", choice(["gzip", "bzip2"]))),
  encrypt: optional(option("--encrypt", string({ metavar: "KEY_FILE" })))
});

const config = parse(backupConfig, ["-c", "src", "dest"]);

// Handle optional parameters explicitly
if (config.success) {
  const { source, destination, compression, encrypt } = config.value;

  console.log(`Backing up ${source} to ${destination}`);

  if (compression) {
    console.log(`Using ${compression} compression`);
  }

  if (encrypt) {
    console.log(`Encrypting with key from ${encrypt}`);
  }
}
~~~~


`withDefault()` parser
----------------------

The `withDefault()` modifier provides a default value when the wrapped parser
fails to match. The result type is a union of the parser's result type and the
default value's type (`T | TDefault`). This allows for flexible default values
that can be different types from what the parser produces, enabling patterns
like conditional option structures.

~~~~ typescript twoslash
import { object, option } from "@optique/core/parser";
import { integer, string } from "@optique/core/valueparser";
// ---cut-before---
import { withDefault } from "@optique/core/parser";
import { cpus } from "node:os";

const parser = object({
  host: withDefault(option("-h", "--host", string()), "localhost"),
// ^?



  port: withDefault(option("-p", "--port", integer()), 8080),
// ^?



  workers: withDefault(option("-w", "--workers", integer()), () => cpus().length)
// ^?



});
~~~~

### Union type patterns

When the default value is a different type from the parser result, `withDefault()`
creates a union type. This is particularly useful for conditional CLI structures:

~~~~ typescript twoslash
import {
  type InferValue,
  flag,
  object,
  option,
  withDefault,
} from "@optique/core/parser";
import { run } from "@optique/run";

// Parser that produces complex object when flag is present
const complexParser = object({
  flag: flag("-f", "--flag"),
  dependentOption: option("-d", "--dependent", { /* ... */ })
});

// Default value with different structure
const conditionalParser = withDefault(
  complexParser,
  { flag: false as const }
);

// Result is a union type that handles both cases
type Result = InferValue<typeof conditionalParser>;
//   ^?








const result: Result = run(conditionalParser);
~~~~

### Static vs dynamic defaults

The `withDefault()` modifier supports both static values and factory functions:

~~~~ typescript twoslash
import { object, option, withDefault } from "@optique/core/parser";
import { choice, integer, string } from "@optique/core/valueparser";
import os from "node:os";
// ---cut-before---
// Static defaults
const staticDefaults = object({
  timeout: withDefault(option("--timeout", integer()), 30),
  format: withDefault(option("--format", choice(["json", "yaml"])), "json")
});

// Dynamic defaults (computed when needed)
const dynamicDefaults = object({
  timestamp: withDefault(option("--time", string()), () => new Date().toISOString()),
  tempDir: withDefault(option("--temp", string()), () => os.tmpdir()),
  cores: withDefault(option("--cores", integer()), () => os.cpus().length)
});
~~~~

Dynamic defaults are useful when:

 -  The default value depends on runtime conditions
 -  You want to compute expensive defaults only when needed
 -  The default value might change between invocations

### Usage patterns

The `withDefault()` modifier is ideal when:

 -  You want to provide sensible defaults for optional parameters
 -  You need different default types than the parser produces (union types)
 -  You're building conditional CLI structures with dependent options
 -  The default value is meaningful and commonly used

~~~~ typescript twoslash
import { object, option, parse, withDefault } from "@optique/core/parser";
import { choice, integer, string } from "@optique/core/valueparser";
class Server {
  constructor(config: {
    name: string;
    host: string;
    port: number;
    logLevel: "debug" | "info" | "warn" | "error";
    maxConnections: number;
  }) {
  }
}
// ---cut-before---
const serverConfig = object({
  // Required parameters
  name: option("-n", "--name", string()),

  // Optional with defaults - no undefined handling needed
  host: withDefault(option("-h", "--host", string()), "0.0.0.0"),
  port: withDefault(option("-p", "--port", integer({ min: 1, max: 65535 })), 3000),
  logLevel: withDefault(
    option("--log-level", choice(["debug", "info", "warn", "error"])),
    "info" as const,
  ),
  maxConnections: withDefault(option("--max-conn", integer({ min: 1 })), 100)
});

// Clean usage without undefined checks
const config = parse(serverConfig, ["--name", "my-server", "--port", "8080"]);
if (config.success) {
  const server = new Server({
    name: config.value.name,
    host: config.value.host,           // Always "0.0.0.0" if not specified
    port: config.value.port,           // 8080 from input
    logLevel: config.value.logLevel,   // Always "info" if not specified
    maxConnections: config.value.maxConnections // Always 100 if not specified
  });
}
~~~~

### Dependent options with union types

A powerful pattern uses `withDefault()` with different types to create conditional
CLI structures where options depend on flags:

~~~~ typescript twoslash
import { flag, object, option, withDefault, parse } from "@optique/core/parser";

// Define conditional configuration
const parser = withDefault(
  object({
    flag: flag("-f", "--flag"),
    dependentFlag: option("-d", "--dependent-flag"),
    dependentFlag2: option("-d2", "--dependent-flag-2"),
  }),
  { flag: false as const } as const,
);

// Result type is automatically inferred as a union
type Config =
  | { readonly flag: false }
  | {
      readonly flag: true;
      readonly dependentFlag: boolean;
      readonly dependentFlag2?: boolean;
    };

// Usage handles both cases cleanly
const result = parse(parser, []);
if (result.success) {
  if (result.value.flag) {
    // TypeScript knows dependent flags are available
    console.log(`Dependent flag: ${result.value.dependentFlag}`);
    if (result.value.dependentFlag2) {
      console.log(`Second dependent flag: ${result.value.dependentFlag2}`);
    }
  } else {
    // TypeScript knows this is the simple case
    console.log("Flag is disabled");
  }
}
~~~~


`map()` parser
--------------

The `map()` modifier transforms the parsed result using a mapping function while
preserving the original parser's logic. This allows you to convert values to
different types, apply formatting, or compute derived values without changing
how the parsing itself works.

~~~~ typescript twoslash
import { map, multiple, object, option } from "@optique/core/parser";
import { integer, string } from "@optique/core/valueparser";

const parser = object({
  // Transform boolean flag to its inverse
  disallow: map(option("--allow"), allowFlag => !allowFlag),
// ^?


  // Transform string to uppercase
  upperName: map(option("-n", "--name", string()), name => name.toUpperCase()),
// ^?


  // Transform integer to formatted string
  portDisplay: map(option("-p", "--port", integer()), port => `port:${port}`),
// ^?


  // Transform multiple values
  tags: map(
// ^?



    multiple(option("-t", "--tag", string())),
    tags => new Set(tags.map(tag => tag.toLowerCase()))
  )
});
~~~~

### Transformation patterns

The `map()` modifier supports various transformation patterns:

~~~~ typescript twoslash
import { map, multiple, option } from "@optique/core/parser";
import { integer, string } from "@optique/core/valueparser";
// ---cut-before---
// Type conversions
const convertedValue = map(option("--count", integer()), count => BigInt(count));

// Data structure transformations
const keyValuePairs = map(
  multiple(option("-D", string())),
  pairs => Object.fromEntries(pairs.map(pair => pair.split('=')))
);

// Validation transformations
const validatedEmail = map(
  option("--email", string()),
  email => {
    if (!email.includes('@')) throw new Error(`Invalid email: ${email}`);
    return email.toLowerCase();
  }
);

// Computed values
const expiryTime = map(
  option("--ttl", integer()),
  ttlSeconds => new Date(Date.now() + ttlSeconds * 1000)
);
~~~~


`multiple()` parser
-------------------

The `multiple()` modifier allows a parser to match multiple times, collecting
all results into an array. This is essential for CLI options that can be
repeated, such as multiple input files, include paths, or environment variables.

~~~~ typescript twoslash
import { argument, multiple, object, option } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";

const parser = object({
  // Multiple files (at least 1 required)
  files: multiple(argument(string()), { min: 1, max: 5 }),
// ^?



  // Multiple include paths (optional)
  includes: multiple(option("-I", "--include", string())),
// ^?



  // Multiple environment variables (optional)
  env: multiple(option("-e", "--env", string()))
// ^?



});
~~~~

### Constraint options

The `multiple()` modifier accepts constraint options—`min` and `max`—to
control how many occurrences are required:

~~~~ typescript twoslash
import { argument, multiple, option } from "@optique/core/parser";
import { integer, string } from "@optique/core/valueparser";
// ---cut-before---
// Exactly 2-4 files required
const requiredFiles = multiple(argument(string()), { min: 2, max: 4 });

// At least 1 server required
const servers = multiple(option("--server", string()), { min: 1 });

// At most 3 retries allowed
const retries = multiple(option("--retry", integer()), { max: 3 });
~~~~

### Default behavior

When no matches are found, `multiple()` returns an empty array rather than
failing. This makes repeated options truly optional:

~~~~ typescript twoslash
import { multiple, object, option, parse } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
// ---cut-before---
const parser = object({
  // These all return empty arrays when not provided
  headers: multiple(option("-H", "--header", string())),
  excludes: multiple(option("-x", "--exclude", string())),
  defines: multiple(option("-D", "--define", string()))
});

const config = parse(parser, ["-H", "Accept: text/plain"]);

// Safe to use without checking - arrays are always present
if (config.success) {
  config.value.headers.forEach(header => console.log(`Header: ${header}`));
  console.log(`Found ${config.value.excludes.length} exclusions`);
}
~~~~
