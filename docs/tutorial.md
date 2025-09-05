---
description: >-
  This tutorial walks you through building type-safe command-line
  applications using Optique's parser combinators, starting from simple options
  to complex subcommands.
---

Optique tutorial: Build type-safe CLIs step by step
====================================================

Optique is a type-safe combinatorial CLI parser that makes building command-line
interfaces both powerful and predictable. Unlike traditional CLI parsers that
rely on configuration objects, Optique uses composable functions that
automatically infer TypeScript types.


What makes Optique different?
-----------------------------

Most CLI parsing libraries ask you to describe your command-line interface
using configuration objects or imperative APIs. You define options, set up
handlers, and hope everything works correctly at runtime. Type safety, if it
exists at all, is often an afterthought requiring manual type annotations.

Optique takes a fundamentally different approach inspired by functional
programming languages like Haskell. Instead of describing what your CLI looks
like, you *build* it using small, composable functions called *parser
combinators*. These functions can be combined in powerful ways to create
complex argument structures, and TypeScript automatically infers the exact
type of data your parser will produce.

This approach has several key advantages:

 -  *Composability*: Small parsers combine into larger ones naturally
 -  *Type safety*: TypeScript knows exactly what data you'll get back
 -  *Reusability*: Parser components can be shared across different commands
 -  *Expressiveness*: Complex CLI patterns become simple to express
 -  *Compile-time verification*: Many errors are caught before your code runs


The philosophy behind parser combinators
----------------------------------------

Parser combinators might seem unfamiliar if you're used to traditional CLI
libraries, but the concept is powerful and elegant. Think of each combinator
as a building block:

 -  An [`option()`](./concepts/primitives.md#option-parser) parser handles
    a single command-line option
 -  An [`argument()`](./concepts/primitives.md#argument-parser) parser handles
    a positional argument
 -  An [`object()`](./concepts/constructs.md#object-parser) combinator groups
    multiple parsers into a structured result
 -  An [`or()`](./concepts/constructs.md#or-parser) combinator creates
    alternatives between different parsers

These building blocks compose naturally. You can take any parser and make it
optional with [`optional()`](./concepts/modifiers.md#optional-parser),
or repeatable with [`multiple()`](./concepts/modifiers.md#multiple-parser).
You can combine unrelated parsers with
[`merge()`](./concepts/constructs.md#merge-parser), or create complex
alternatives with `or()`.
The type system tracks these combinations automatically, ensuring that your
parsed data always matches what your code expects.

In this tutorial, we'll build progressively more complex CLI applications,
starting with simple options and building up to sophisticated multi-command
interfaces with full type safety. By the end, you'll understand not just how
to use each combinator, but when and why to choose different patterns for your
CLI applications.


Getting started
---------------

The journey into parser combinators begins with understanding the fundamental
building blocks. In this section, we'll explore the most basic parsers and see
how TypeScript's type inference makes CLI development both safer and more
enjoyable.

Every CLI parser in Optique is a function that takes command-line arguments
and produces either a successfully parsed value or an error. The key insight
is that these parsers can be composed and combined to create more sophisticated
argument handling without losing type information.

### Your first CLI: Single option

Let's start with the simplest possible CLI—a greeting program that accepts a
name. This example demonstrates the core concepts of value parsers and type
inference.

~~~~ typescript twoslash
import { option } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
import { run, print } from "@optique/run";
import { message } from "@optique/core/message";

// Create a parser for --name option
const nameParser = option("--name", string());
//    ^?



// Run the parser with some example arguments
const result = run(nameParser, {
//    ^?


  args: ["--name", "Alice"]
});

print(message`Hello, ${result}!`);
// Output: Hello, Alice!
~~~~

This simple example demonstrates several important concepts:

[Value parsers](./concepts/valueparsers.md)
:   The [`string()`](./concepts/valueparsers.md#string-parser) function is
    a [*value parser*](./concepts/valueparsers.md)—it knows how to convert
    a raw command-line argument (which is always a string) into a typed
    value. Optique provides many built-in value parsers for common data types.

Type inference
:   Notice how TypeScript automatically infers that `nameParser` returns
    a `Parser<string>`. You don't need to write any type annotations—the
    compiler figures out the types based on how you compose the parsers.

Result handling
:   The *@optique/run* version of `run()` never returns on errors—it displays
    error messages and exits the process automatically. This makes CLI
    applications simpler since you only need to handle the success case.

Boolean flags work differently—they don't take values and simply indicate
presence or absence:

~~~~ typescript twoslash
import { option } from "@optique/core/parser";
import { run } from "@optique/run";

// Boolean flag (no value parser needed)
const verboseParser = option("-v", "--verbose");
//    ^?



const result = run(verboseParser);
//    ^?


// This returns true when present, false when absent
~~~~

### Working with positional arguments

While options use flags like `--name` or `-v`, positional arguments are values
that appear in specific positions on the command line. Think of commands like
`cp source.txt destination.txt`—the filenames are positional arguments
because their meaning depends on their position, not on any flag.

Positional arguments are essential for creating intuitive CLIs. Users expect
to type `git commit message.txt` rather than `git commit --file message.txt`.
Let's create a file processor that demonstrates this pattern:

~~~~ typescript twoslash
import { argument } from "@optique/core/parser";
import { run, print } from "@optique/run";
import { path } from "@optique/run/valueparser";
import { message } from "@optique/core/message";

// Create a parser for a required file argument
const fileParser = argument(path({ metavar: "FILE" }));
//    ^?



const result = run(fileParser, {
//    ^?


  args: ["input.txt"]
});

print(message`Processing file: ${result}`);
// Output: Processing file: input.txt
~~~~

The [`argument()`](./concepts/primitives.md#argument-parser) function creates
a parser that consumes the next positional argument from the command line.
The [`path()`](./concepts/valueparsers.md#path-parser) value parser is perfect
for file and directory paths, and we'll explore its validation capabilities
later in the tutorial.

The `metavar: "FILE"` parameter is used in help text generation. Instead of
showing a generic placeholder, help messages will display `FILE` to indicate
what kind of argument is expected.

### Combining options and arguments

Real CLI programs usually need both options and arguments working together.
This is where Optique's compositional nature shines—the
[`object()`](./concepts/constructs.md#object-parser) combinator
lets us group multiple parsers into a single, structured result.

The `object()` combinator is one of the most important tools in Optique. It
takes multiple named parsers and combines them into a single parser that
produces an object with all the parsed values. The beauty is that TypeScript
automatically infers the exact shape of this object, including which fields
are optional and what types they contain.

~~~~ typescript twoslash
import { type InferValue, argument, object, option } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
import { run, print } from "@optique/run";
import { path } from "@optique/run/valueparser";
import { message } from "@optique/core/message";

const parser = object({
  file: argument(path({ metavar: "FILE" })),
  output: option("-o", "--output", path({ metavar: "OUTPUT" })),
  verbose: option("-v", "--verbose")
});

// TypeScript automatically infers the complete type!
type Config = InferValue<typeof parser>;
//   ^?







const config: Config = run(parser, {
  args: [
    "input.txt",
    "--output", "output.txt",
    "--verbose"
  ]
});

print(message`Converting ${config.file} to ${config.output}.`);
if (config.verbose) {
  print(message`Verbose mode enabled.`);
}
~~~~

This example showcases the power of parser composition. We've created a parser
that handles both positional arguments and options, and TypeScript automatically
infers the complete result type. The `config` object is fully typed—the
compiler knows that `file` and `output` are strings, while `verbose` is a
boolean.

Notice how natural the composition feels. Each parser handles one concern:

 -  `argument(path(...))` handles the required input file
 -  `option("-o", "--output", path(...))` handles the optional output location
 -  `option("-v", "--verbose")` handles the verbose flag

The `object()` combinator weaves them together into a cohesive whole, and the
type system ensures everything fits together correctly.

> [!NOTE]
> The `InferValue<T>` utility type extracts the TypeScript type that a parser
> will produce. This is useful for type annotations and ensuring type safety
> throughout your application. However, in most cases you won't need
> it—TypeScript's inference handles everything automatically.


Value parsers and validation
----------------------------

[Value parsers](./concepts/valueparsers.md) are the foundation of type-safe CLI
parsing. While command-line arguments are always strings, your application needs
them as numbers, URLs, file paths, or other typed values. Value parsers handle
this conversion and provide validation at parse time, catching errors before
they can cause problems in your application logic.

The philosophy behind Optique's value parsers is “fail fast, fail clearly.”
Instead of letting invalid data flow through your application and cause
mysterious errors later, value parsers validate input immediately and provide
clear error messages that help users fix their mistakes.

### Rich value types with built-in validation

Optique provides powerful value parsers that go beyond simple strings. Each
parser not only handles type conversion but also provides meaningful validation
rules. Let's explore the most commonly used ones, with special attention to
the versatile `path()` parser:

~~~~ typescript twoslash
import { object, option } from "@optique/core/parser";
import { integer, url, locale } from "@optique/core/valueparser";
import { run } from "@optique/run";
import { path } from "@optique/run/valueparser"

const parser = object({
  // Path validation - checks if file exists and is readable
  inputFile: option("--input", path({
// ^?


    mustExist: true,   // File must exist
  })),

  // Path for output - ensures parent directory is writable
  outputDir: option("--output", path({
    mustExist: false,  // Path must not exist (for new files)
    allowCreate: true, // Can create the file if it doesn't exist
  })),

  // Integer with bounds checking
  port: option("-p", "--port", integer({ min: 1, max: 0xffff })),
// ^?


  // URL with protocol restrictions
  endpoint: option("--api", url({ allowedProtocols: ["https:"] })),
// ^?


  // Locale validation
  language: option("-l", "--locale", locale())
// ^?


});

// Example usage that would validate at runtime:
// myapp --input ./data.txt --output ./results/ --port 8080 --api https://api.example.com --locale en-US
~~~~

The `path()` value parser is particularly powerful for file system operations.
Unlike generic string parsers, it can validate file system constraints at
parse time, preventing your application from receiving invalid paths:

~~~~ typescript twoslash
import { path } from "@optique/run/valueparser";

// Different path validation modes
const existingFile = path({ mustExist: true });
const newFile = path({ allowCreate: true });
const directory = path({ mustExist: true, type: "directory" });

// All return string paths, but validation happens at parse time
~~~~

*Why path validation matters*: Consider a file conversion tool. Instead of
discovering that the input file doesn't exist or the output directory isn't
writable deep inside your conversion logic, the `path()` parser catches these
issues immediately and provides clear error messages to the user.

The validation options work together naturally:

 -  `mustExist: true` ensures the path points to something that exists
 -  `allowCreate: true` allows creating the file if it doesn't exist
 -  `type: "directory"` ensures the path points to a directory, not a file

### Constraining choices

Many CLI options should only accept specific values. Log levels, output formats,
and operation modes are common examples.
The [`choice()`](./concepts/valueparsers.md#choice-parser) parser creates
type-safe enumerations that catch invalid values at parse time and provide
excellent autocomplete support in TypeScript.

The `choice()` parser is particularly powerful because it creates exact string
literal types rather than generic `string` types. This means TypeScript can
help you handle all possible cases and catch typos at compile time:

~~~~ typescript twoslash
import { run, print } from "@optique/run";
import { object, option } from "@optique/core/parser";
import { choice, integer } from "@optique/core/valueparser";
import { message } from "@optique/core/message";

const parser = object({
  logLevel: option("--log-level", choice(["debug", "info", "warn", "error"])),
// ^?



  format: option("-f", "--format", choice(["json", "yaml", "toml"])),
// ^?



  workers: option("-w", "--workers", integer({ min: 1, max: 16 }))
// ^?


});

const config = run(parser, {
  args: ["--log-level", "info", "--format", "json", "--workers", "4"]
});

// TypeScript knows the exact string literal types!
if (config.logLevel === "debug") {
//         ^?


  print(message`Debug logging enabled.`);
}

switch (config.format) {
//             ^?


  case "json":
    // ...
    break;
  case "yaml":
  case "toml":
    // ...
    break;
}
~~~~

*The power of literal types*: Notice how `logLevel` has the type
`"debug" | "info" | "warn" | "error"` instead of just `string`. This is
incredibly powerful:

 -  TypeScript will autocomplete the available options as you type
 -  The compiler will catch typos in your code (e.g., `"warning"` instead
    of `"warn"`)
 -  You can use exhaustive checking with `switch` statements
 -  The choices are documented in the type system itself

When users provide invalid choices, they get clear error messages listing all
valid options. This eliminates the guesswork and reduces support burden.


Advanced combinators
--------------------

As your CLI applications grow more sophisticated, you'll encounter patterns
that require more than simple options and arguments. You might need mutually
exclusive modes, optional parameters with defaults, or commands that can be
repeated multiple times. This is where Optique's advanced combinators shine.

The combinators in this section represent some of the most powerful features
of functional parsing. They allow you to express complex CLI patterns
declaratively while maintaining complete type safety. More importantly, they
compose naturally—you can combine any of these patterns with each other to
create exactly the CLI interface your application needs.

### Mutually exclusive options with `or()`

Many CLI tools have mutually exclusive modes of operation. Think of `curl`
with its different protocols, or `git` with its various commands. These tools
need to parse completely different sets of options depending on which mode
the user selects.

The [`or()`](./concepts/constructs.md#or-parser) combinator models this pattern
perfectly. It tries alternatives in order, and the first one that successfully
parses determines both the result value and its type. This creates what
TypeScript calls a “discriminated union”—a type where each alternative can
be distinguished from the others:

~~~~ typescript twoslash
import { type InferValue, constant, object, option, or } from "@optique/core/parser";
import { integer, string, url } from "@optique/core/valueparser";
import { run, print } from "@optique/run";
import { message } from "@optique/core/message";

const parser = or(
  object({
    port: option("-p", "--port", integer({ min: 1, max: 0xffff })),
    host: option("-h", "--host", string())
  }),
  object({
    url: option("-u", "--url", url()),
    timeout: option("-t", "--timeout", integer({ min: 0 }))
  })
);

// TypeScript creates a discriminated union automatically
type Config = InferValue<typeof parser>;
//   ^?









const config: Config = run(parser, {
  args: ["-p", "8080", "-h", "localhost"]
});

// TypeScript can't narrow the type yet - we need the discriminator
print(message`Running in ${"port" in config ? 'server' : 'client'} mode.`);
~~~~

### Discriminated unions with `constant()`

The previous example creates a union type, but TypeScript can't yet distinguish
between the alternatives. This is where
the [`constant()`](./concepts/primitives.md#constant-parser) parser becomes
essential. It adds a literal value to the parse result without consuming any
input, creating what's called a “discriminator” or “tag” field.

Discriminated unions are one of TypeScript's most powerful features for
modeling data that can be one of several alternatives. The `constant()` parser
makes it trivial to create these unions from CLI input, enabling type-safe
pattern matching and exhaustive case analysis:

~~~~ typescript twoslash
// @errors: 2339
import { constant, object, option, or } from "@optique/core/parser";
import { integer, string, url } from "@optique/core/valueparser";
import { run, print } from "@optique/run";
import { message } from "@optique/core/message";

const parser = or(
  object({
    mode: constant("server"),  // [!code highlight]
    port: option("-p", "--port", integer()),
    host: option("-h", "--host", string())
  }),
  object({
    mode: constant("client"),  // [!code highlight]
    url: option("-u", "--url", url()),
    timeout: option("-t", "--timeout", integer())
  })
);

const config = run(parser, {
  programName: "app",
  args: ["-p", "8080", "-h", "localhost"]
});

// Now TypeScript can narrow the type based on the discriminator!
if (config.mode === "server") {
  print(message`Server running on ${config.host}:${config.port.toString()}.`);
  // TypeScript error if we try to access client-only properties
  print(message`${config.url.toString()}`);
} else {
  print(message`Connecting to ${config.url.toString()}.`);
  print(message`Timeout: ${config.timeout.toString()}ms.`);
}
~~~~

*The magic of type narrowing*: Notice how TypeScript automatically narrows
the union type in each branch of the `if` statement. Once you check
`config.mode === "server"`, the compiler knows that `config` must be the
server configuration object, so properties like `port` and `host` become
available. Try to access `config.url` in the server branch and TypeScript
will give you a compile-time error.

This pattern is incredibly powerful for building type-safe CLI applications.
Your code is guaranteed to only access properties that are valid for the
current mode, and the compiler will catch mistakes before they reach production.

### Optional values and defaults

Real-world CLI applications need flexibility. Some options should be optional,
some should have sensible defaults, and some should be transformable based on
other values. Optique provides several combinators to handle these patterns
elegantly.

The distinction between [`optional()`](./concepts/modifiers.md#optional-parser)
and [`withDefault()`](./concepts/modifiers.md#withdefault-parser) is important:
`optional()` creates nullable types that you must handle explicitly, while
`withDefault()` always provides a value, eliminating null checks. Choose
`optional()` when the absence of a value is meaningful, and `withDefault()`
when you want to simplify your application logic:

~~~~ typescript twoslash
import { map, object, option, optional, withDefault } from "@optique/core/parser";
import { integer, string } from "@optique/core/valueparser";
import { path, run, print } from "@optique/run";
import { message } from "@optique/core/message";

const parser = object({
  // Optional returns T | undefined
  config: optional(option("-c", "--config", path())),
// ^?



  // withDefault always returns T (never undefined)
  port: withDefault(option("-p", "--port", integer()), 8080),
// ^?



  host: withDefault(option("-h", "--host", string()), "localhost"),
// ^?



  // map() transforms the parsed value
  upperName: map(option("-n", "--name", string()), s => s.toUpperCase()),
// ^?


  // Another transformation example
  portDescription: map(
// ^?



    withDefault(option("--port", integer()), 3000),
    port => `Server will run on port ${port}`
  )
});

const config = run(parser, {
  programName: "server",
  args: ["--name", "my-app"]
});

// Optional properties need checking
if (config.config) {
  print(message`Using config: ${config.config}.`);
}

// Default values are always available
print(message`Starting ${config.upperName} on ${config.host}:${config.port.toString()}.`);
print(message`${config.portDescription}`);
~~~~

*Value transformation with `map()`*: The `map()` combinator deserves special
attention. It allows you to transform parsed values while preserving the
original parsing logic. This is incredibly useful for normalizing data,
computing derived values, or adapting to different data formats your
application expects.

### Repeatable values with `multiple()`

Command-line interfaces often need to accept multiple values for the same
option. Consider `gcc -I include1 -I include2 -I include3` or
`curl -H "Accept: application/json" -H "Authorization: Bearer token"`. The
[`multiple()`](./concepts/modifiers.md#multiple-parser) combinator handles
these patterns naturally.

What makes `multiple()` special is how it handles the common case gracefully.
When no matches are found, it returns an empty array rather than failing to
parse. This means you can make repeated options truly optional—if the user
doesn't provide any, your application gets an empty array and can continue
normally:

~~~~ typescript twoslash
import { argument, multiple, object, option } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
import { path, run, print } from "@optique/run";
import { message } from "@optique/core/message";

const parser = object({
  // Multiple files with constraints
  files: multiple(argument(path()), { min: 1, max: 5 }),
// ^?



  // Multiple options (can be empty)
  headers: multiple(option("-H", "--header", string())),
// ^?



  // Multiple with no constraints
  tags: multiple(option("-t", "--tag", string())),
// ^?



  // Boolean flag (single occurrence)
  verbose: option("-v", "--verbose")
// ^?


});

// Usage: myapp file1.txt file2.txt -H "Accept: application/json" -H "User-Agent: myapp" -t web -t api -v
const config = run(parser, {
  args: [
    "file1.txt", "file2.txt",
    "-H", "Accept: application/json",
    "-H", "User-Agent: myapp",
    "-t", "web", "-t", "api",
    "-v"
  ]
});

print(message`Processing ${config.files.length.toString()} files:`);
//                               ^?


config.files.forEach((file, index) => {
//     ^?


  print(message`  ${(index + 1).toString()}. ${file}`);
});

if (config.headers.length > 0) {
//         ^?


  print(message`Custom headers:`);
  config.headers.forEach(header => {
    print(message`  ${header}`);
  });
}

print(message`Tags: ${config.tags.join(", ")}.`);
//                          ^?

~~~~

*Constraints and validation*: The `{ min: 1, max: 5 }` constraint in the
files example demonstrates another powerful feature. You can specify minimum
and maximum bounds for repeated values, ensuring your application receives a
reasonable number of arguments. This prevents both user error (forgetting to
specify required files) and potential abuse (specifying thousands of files
that might overwhelm your system).

The `multiple()` combinator automatically provides empty arrays as defaults
when no matches are found, making it safe to use without additional null
checking. Your code can always assume arrays exist, simplifying the logic
considerably.


Building subcommands
--------------------

Subcommands are the hallmark of sophisticated CLI tools. They allow you to
group related functionality under a single program while keeping individual
commands focused and easy to understand. Think of `git add`, `docker run`, or
`npm install`—each subcommand is essentially a mini-program with its own
options and behavior.

The [`command()`](./concepts/primitives.md#command-parser) combinator makes
subcommands natural to express in Optique.
Unlike some CLI libraries that require complex routing logic, Optique treats
subcommands as just another form of parser composition. This means you can
combine subcommands with all the other patterns you've learned—they can
have optional parameters, repeated arguments, discriminated unions, and more.

### Git-style CLI

Let's build a `git`-like CLI that demonstrates how subcommands work in
practice. Each subcommand will have its own unique options, but they'll all
be part of a single, type-safe parser:

~~~~ typescript twoslash
import {
  type InferValue,
  argument,
  command,
  constant,
  multiple,
  object,
  option,
  or,
} from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
import { path, run } from "@optique/run";

const parser = or(
  command("add", object({  // [!code highlight]
    type: constant("add"),
    files: multiple(argument(path())),
    all: option("-A", "--all"),
    force: option("-f", "--force")
  })),
  command("commit", object({  // [!code highlight]
    type: constant("commit"),
    message: option("-m", "--message", string()),
    amend: option("--amend"),
    all: option("-a", "--all")
  })),
  command("push", object({  // [!code highlight]
    type: constant("push"),
    remote: option("-r", "--remote", string()),
    force: option("-f", "--force"),
    setUpstream: option("-u", "--set-upstream")
  }))
);

// TypeScript creates a perfect discriminated union
type GitCommand = InferValue<typeof parser>;
//   ^?
















const result = run(parser, {
  args: ["commit", "-m", "Fix parsing bug", "--amend"]
});
~~~~

### Nested subcommands

For more complex tools, you can nest subcommands multiple levels deep:

~~~~ typescript twoslash
import { argument, command, constant, object, option, or } from "@optique/core/parser";
import { choice, string } from "@optique/core/valueparser";
import { run } from "@optique/run";

// Second-level commands for "app config"
const configCommands = or(
  command("get", object({
    action: constant("get"),
    key: argument(string({ metavar: "KEY" })),
    format: option("-f", "--format", choice(["json", "yaml", "plain"]))
  })),
  command("set", object({
    action: constant("set"),
    key: argument(string({ metavar: "KEY" })),
    value: argument(string({ metavar: "VALUE" })),
    global: option("-g", "--global")
  })),
  command("list", object({
    action: constant("list"),
    format: option("-f", "--format", choice(["json", "yaml", "table"]))
  }))
);

// Top-level commands
const parser = or(
  // Nested: app config get/set/list
  command("config", object({
    command: constant("config"),
    subcommand: configCommands
  })),
  // Simple: app init
  command("init", object({
    command: constant("init"),
    template: option("-t", "--template", string()),
    force: option("-f", "--force")
  })),
  // Simple: app build
  command("build", object({
    command: constant("build"),
    watch: option("-w", "--watch"),
    minify: option("-m", "--minify")
  }))
);

// Usage examples:
// app config get database.url --format json
// app config set database.url "postgres://localhost/mydb" --global
// app init --template react --force
// app build --watch --minify

const result = run(parser, {
//    ^?





















  args: ["config", "set", "api.url", "https://api.example.com", "--global"]
});
~~~~

*The power of nested parsing*: Notice how the nested structure mirrors the
command structure itself. The `config` command contains its own subparser that
handles `get`, `set`, and `list`. This compositional approach scales
naturally—you can nest commands as deeply as needed without losing type safety
or clarity.

*Global vs. local options*: This pattern also demonstrates how to handle
global options (like `--global-config`) that apply to all commands, while
still providing command-specific options. The type system ensures that you
can only access the options that are actually available for each command.

This pattern scales well for complex CLI tools with multiple levels of
subcommands, each with their own options and behaviors. The type system
tracks the structure automatically, so you never have to worry about
accessing the wrong properties or forgetting to handle a case.


Modularization and reusability
------------------------------

As CLI applications grow in complexity, you'll find yourself repeating similar
patterns across different commands. Database connection options, logging
configuration, and authentication settings tend to appear in multiple places.
Rather than duplicating this logic, Optique provides powerful tools for
creating reusable, composable option groups.

The [`merge()`](./concepts/constructs.md#merge-parser) combinator is the key to
building modular CLI applications. It allows you to define option groups once
and reuse them across different commands, while maintaining complete type safety.
This approach promotes consistency across your CLI—users learn the database
options once and can apply that knowledge to any command that needs database
access.

### Reusable option groups with `merge()`

The philosophy behind option groups is separation of concerns. Instead of
monolithic parsers that handle everything, you create focused parsers that
handle specific areas of functionality. Then you compose these focused parsers
in different combinations depending on what each command needs:

~~~~ typescript twoslash
import { constant, merge, object, option, optional, or } from "@optique/core/parser";
import { choice, integer, string } from "@optique/core/valueparser";
import { path, run } from "@optique/run";

// Define reusable option groups
const networkOptions = object("Network", {
  host: option("--host", string({ metavar: "HOST" })),
  port: option("--port", integer({ min: 1, max: 0xffff }))
});

const authOptions = object("Authentication", {
  username: option("-u", "--user", string({ metavar: "USER" })),
  password: optional(option("-p", "--password", string({ metavar: "PASS" }))),
  token: optional(option("-t", "--token", string({ metavar: "TOKEN" })))
});

const loggingOptions = object("Logging", {
  logLevel: option("--log-level", choice(["debug", "info", "warn", "error"])),
  logFile: optional(option("--log-file", path({ metavar: "FILE" })))
});

// Combine groups differently for different modes
const parser = or(
  // Development mode: minimal required options
  merge(
    object({ mode: constant("dev") }),
    networkOptions,
    object({ debug: option("--debug") })
  ),

  // Production mode: full configuration required
  merge(
    object({ mode: constant("prod") }),
    networkOptions,
    authOptions,
    loggingOptions,
    object({
      configFile: option("-c", "--config", path({ mustExist: true })),
      workers: option("-w", "--workers", integer({ min: 1, max: 16 }))
    })
  )
);

const config = run(parser, {
//    ^?
























  args: [
    "--host", "0.0.0.0",
    "--port", "8080",
    "--user", "admin",
    "--log-level", "info",
    "--config", "prod.json",
    "--workers", "4"
  ]
});
~~~~

### Real-world example: Deployment tool CLI

Let's build a comprehensive deployment tool that demonstrates all the features
we've learned:

~~~~ typescript twoslash
import {
  type InferValue,
  argument,
  command,
  constant,
  merge,
  multiple,
  object,
  option,
  optional,
  or,
  withDefault,
} from "@optique/core/parser";
import { choice, integer, string, url } from "@optique/core/valueparser";
import { path, run } from "@optique/run";

// Reusable option groups
const commonOptions = object("Common", {
  verbose: optional(option("-v", "--verbose")),
  config: optional(option("-c", "--config", path({ mustExist: true }))),
  dryRun: optional(option("--dry-run"))
});

const environmentOptions = object("Environment", {
  environment: argument(choice(["dev", "staging", "prod"])),
  region: option("-r", "--region", string()),
  timeout: withDefault(option("-t", "--timeout", integer({ min: 0 })), 300)
});

const deployOptions = object("Deploy", {
  image: option("-i", "--image", string({ metavar: "IMAGE:TAG" })),
  replicas: withDefault(option("--replicas", integer({ min: 1, max: 50 })), 1),
  healthCheck: option("--health-check", url()),
  secrets: multiple(option("-s", "--secret", string()))
});

// Main CLI parser
const deploymentTool = object({
  // Global options available to all commands
  globalConfig: optional(option("--global-config", path())),
  quiet: optional(option("-q", "--quiet")),

  // Command with rich subcommand structure
  command: or(
    // Deploy command: merge multiple option groups
    command("deploy", merge(
      object({ action: constant("deploy") }),
      commonOptions,
      environmentOptions,
      deployOptions,
      object({
        // Deploy-specific options
        force: optional(option("-f", "--force")),
        rollback: optional(option("--rollback-on-failure"))
      })
    )),

    // Status command: simpler option set
    command("status", merge(
      object({ action: constant("status") }),
      commonOptions,
      object({
        environment: argument(choice(["dev", "staging", "prod"])),
        watch: optional(option("-w", "--watch")),
        format: withDefault(
          option("--format", choice(["table", "json", "yaml"])),
          "table"
        )
      })
    )),

    // Rollback command: targeted options
    command("rollback", merge(
      object({ action: constant("rollback") }),
      commonOptions,
      environmentOptions,
      object({
        revision: option("--revision", string({ metavar: "REV" })),
        confirm: optional(option("--confirm"))
      })
    )),

    // Logs command: streaming options
    command("logs", merge(
      object({ action: constant("logs") }),
      commonOptions,
      object({
        environment: argument(choice(["dev", "staging", "prod"])),
        service: argument(string({ metavar: "SERVICE" })),
        follow: optional(option("-f", "--follow")),
        lines: withDefault(option("-n", "--lines", integer({ min: 1 })), 100),
        since: optional(option("--since", string({ metavar: "TIME" })))
      })
    ))
  )
});

// The complete inferred type - look how rich this is!
type DeployConfig = InferValue<typeof deploymentTool>;
//   ^?































// Example usage scenarios:
// deploy-tool deploy prod -i myapp:v1.2.3 --replicas 5 --health-check https://api.example.com/health -v
// deploy-tool status staging --watch --format json
// deploy-tool rollback prod --revision v1.2.2 --confirm
// deploy-tool logs prod api-service --follow --lines 1000

const config = run(deploymentTool, {
  args: [
    "deploy", "prod",
    "--image", "myapp:v1.2.3",
    "--replicas", "3",
    "--health-check", "https://api.example.com/health",
    "--secret", "DB_PASSWORD",
    "--secret", "API_KEY",
    "--region", "us-east-1",
    "--verbose",
    "--force"
  ]
});
~~~~

This example showcases:

 -  *Modular design* with reusable option groups (`commonOptions`,
    `environmentOptions`, `deployOptions`)
 -  *Rich type inference* with complex discriminated unions
 -  *Flexible composition* using `merge()` to combine option groups
    differently per command
 -  *Real-world validation* with path checking, URL validation, integer
    bounds, and choice constraints

The `merge()` combinator is particularly powerful here—it lets us define
option groups once and reuse them across different commands, while TypeScript
automatically combines the types correctly.


Production CLI applications
---------------------------

Throughout this tutorial, we've been using *@optique/run* which provides a
batteries-included experience for building CLI applications. This is the
recommended approach for most use cases, as it handles all the common concerns
automatically: reading from [`process.argv`] (or [`Deno.args`] on Deno),
detecting terminal capabilities, displaying help text, and exiting with
appropriate status codes.

However, it's worth understanding the difference between *@optique/run* and
*@optique/core*, and when you might choose one over the other.

[`process.argv`]: https://nodejs.org/api/process.html#processargv
[`Deno.args`]: https://docs.deno.com/api/deno/~/Deno.args

### *@optique/run* vs. *@optique/core*

The difference between *@optique/core* and *@optique/run* is primarily about
convenience and control:

Use *@optique/run* when:

 -  Building standalone CLI applications
 -  You want automatic [`process.argv`] (or [`Deno.args`] on Deno) handling and
    error display
 -  You need terminal capability detection (colors, width)
 -  You prefer convention over configuration

Use *@optique/core* when:

 -  Building libraries that need to parse CLI-like arguments
 -  Working in web applications or environments without [`node:process`]
 -  You need full control over error handling and result processing
 -  You want to integrate parsing into larger application logic

Here's how the same parser would work with *@optique/core*:

~~~~ typescript twoslash
import { run } from "@optique/core/facade";
import { argument, object, option, optional } from "@optique/core/parser";
import { integer, string } from "@optique/core/valueparser";
import process from "node:process";

const parser = object({
  input: argument(string({ metavar: "FILE" })),
  output: option("-o", "--output", string({ metavar: "FILE" })),
  port: optional(option("-p", "--port", integer({ min: 1, max: 0xffff }))),
  verbose: option("-v", "--verbose")
});

// @optique/core requires explicit argument handling
const config = run(parser, "myapp", process.argv.slice(2), {
//    ^?








  onError: process.exit,
  help: { onShow: process.exit },
});

console.log(`Processing ${config.input} -> ${config.output}.`);
if (config.port) {
  console.log(`Server will run on port ${config.port}.`);
}
~~~~

Compare this to the *@optique/run* version we've been using throughout this
tutorial:

~~~~ typescript twoslash
import { argument, object, option, optional } from "@optique/core/parser";
import { integer, string } from "@optique/core/valueparser";
import { path, run, print } from "@optique/run";
import { message } from "@optique/core/message";

const parser = object({
  input: argument(path({ mustExist: true, metavar: "FILE" })),
  output: option("-o", "--output", path({ metavar: "FILE" })),
  port: optional(option("-p", "--port", integer({ min: 1, max: 0xffff }))),
  verbose: option("-v", "--verbose")
});

// @optique/run handles everything automatically
const config = run(parser);
//    ^?








print(message`Processing ${config.input} -> ${config.output}.`);
if (config.port) {
  print(message`Server will run on port ${config.port.toString()}.`);
}
~~~~

The *@optique/run* version is much more concise and handles all error cases
automatically.

[`node:process`]: https://nodejs.org/api/process.html

### Configuration options

*@optique/run* provides several configuration options for fine-tuning behavior:

~~~~ typescript twoslash
import { object, option } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
import { run } from "@optique/run";

const parser = object({
  name: option("-n", "--name", string()),
  debug: option("--debug")
});

const config = run(parser, {
  programName: "my-tool", // Override detected program name (default: process.argv[1])
  help: "both",           // Enable --help option AND help subcommand
 // ^?











  aboveError: "usage",    // Show usage information above errors
// ^?











  colors: true,           // Force colored output (auto-detected by default)
  maxWidth: 100,          // Set help text width (terminal width by default)
  errorExitCode: 2        // Custom exit code for errors (default: 1)
});

// The help system automatically generates comprehensive help text:
// $ my-tool --help
// $ my-tool help
~~~~

### Complete CLI application

Here's a complete, production-ready CLI application using everything we've
learned:

~~~~ typescript twoslash
#!/usr/bin/env node
import {
  type InferValue,
  argument,
  command,
  constant,
  merge,
  multiple,
  object,
  option,
  optional,
  or,
  withDefault,
} from "@optique/core/parser";
import { choice, integer, string } from "@optique/core/valueparser";
import { path, run } from "@optique/run";

// Reusable option groups
const globalOptions = object("Global Options", {
  config: optional(option("-c", "--config", path({ mustExist: true }))),
  verbose: optional(option("-v", "--verbose")),
  quiet: optional(option("-q", "--quiet"))
});

const buildOptions = object("Build Options", {
  watch: optional(option("-w", "--watch")),
  minify: optional(option("--minify")),
  sourcemap: withDefault(option("--sourcemap", choice(["inline", "external", "none"])), "external"),
  outDir: withDefault(option("--out-dir", path()), "./dist")
});

// Complete CLI parser
const cli = merge(
  globalOptions,
  object({
    command: or(
      // Build command
      command("build", merge(
        object({ action: constant("build") }),
        buildOptions,
        object({
          entry: multiple(argument(path({ mustExist: true })), { min: 1 }),
          target: withDefault(option("--target", choice(["es2015", "es2018", "es2022", "esnext"])), "es2018")
        })
      )),

      // Dev command
      command("dev", merge(
        object({ action: constant("dev") }),
        buildOptions,
        object({
          port: withDefault(
            option("-p", "--port", integer({ min: 1, max: 0xffff })),
            3000
          ),
          host: withDefault(option("--host", string()), "localhost"),
          open: optional(option("--open"))
        })
      )),

      // Test command
      command("test", object({
        action: constant("test"),
        watch: optional(option("-w", "--watch")),
        coverage: optional(option("--coverage")),
        pattern: optional(option("--pattern", string())),
        timeout: withDefault(option("--timeout", integer({ min: 1 })), 5000)
      }))
    )
  })
);

type Config = InferValue<typeof cli>;
//   ^?
























// Run with comprehensive configuration
const config: Config = run(cli, {
  programName: "build-tool",
  help: "both",                    // Both --help and help command
  aboveError: "usage",             // Show usage on errors
  colors: true,                    // Colored output
});
~~~~

This complete example demonstrates:

 -  *Process integration* with automatic `process.argv` handling
 -  *Comprehensive help system* with both `--help` and `help` command
 -  *Error handling* with custom exit codes and error formatting
 -  *Type safety* throughout the entire application
 -  *Modular design* with reusable option groups
 -  *Real-world patterns* commonly used in build tools and CLI applications

Usage examples:

~~~~ bash
# Build command
$ build-tool build src/index.ts --target es2022 --minify -v

# Dev server
$ build-tool dev --port 8080 --open --watch

# Testing
$ build-tool test --coverage --pattern "*.spec.ts" --timeout 10000

# Help system
$ build-tool --help
$ build-tool help
$ build-tool help build
~~~~


Conclusion
----------

Congratulations! You've learned how to build type-safe, composable CLI
applications with Optique. Here's what we covered:

 -  *Primitive parsers*: [`option()`](./concepts/primitives.md#option-parser),
    [`argument()`](./concepts/primitives.md#argument-parser),
    [`command()`](./concepts/primitives.md#command-parser) for CLI fundamentals
 -  *Value parsers*: [`string()`](./concepts/valueparsers.md#string-parser),
    [`integer()`](./concepts/valueparsers.md#integer-parser),
    [`path()`](./concepts/valueparsers.md#path-parser),
    [`url()`](./concepts/valueparsers.md#url-parser),
    [`choice()`](./concepts/valueparsers.md#choice-parser)
    with rich validation
 -  *Combinators*: [`object()`](./concepts/constructs.md#object-parser),
    [`or()`](./concepts/constructs.md#or-parser),
    [`optional()`](./concepts/modifiers.md#optional-parser),
    [`multiple()`](./concepts/modifiers.md#multiple-parser),
    [`merge()`](./concepts/constructs.md#merge-parser)
    for composition
 -  *Type discrimination*: [`constant()`](./concepts/primitives.md#constant-parser)
    for discriminated unions and type narrowing
 -  *Advanced patterns*: Nested subcommands, reusable option groups, complex CLIs
 -  *Process integration*: *@optique/run* for production-ready CLI applications

### Key benefits of Optique

 -  *Type safety*: Automatic TypeScript inference eliminates runtime surprises
 -  *Composability*: Build complex CLIs from simple, reusable components
 -  *Validation*: Rich value parsers with built-in constraint checking
 -  *Error messages*: Clear, helpful error messages for users
 -  *Flexibility*: Works in any JavaScript environment
    (Node.js, Bun, Deno, browsers)

<!-- cSpell: ignore myapp mydb -->
