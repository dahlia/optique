---
description: >-
  Primitive parsers are the foundational building blocks that handle basic
  CLI elements like options, arguments, commands, and constants with full
  type safety and clear error messages.
---

Primitive parsers
=================

Primitive parsers are the foundational building blocks of Optique.
They handle the most basic elements of command-line interfaces: flags,
options, positional arguments, and subcommands. Unlike higher-level combinators
that compose multiple parsers together, primitives interact directly with
the command-line input, consuming and validating individual pieces.

Understanding primitive parsers is essential because they form the core of
every CLI parser you'll build. Whether you're creating a simple utility with
a single flag or a complex multi-command application, you'll combine
these primitives to express your CLI's structure and behavior.

Each primitive parser follows Optique's consistent design principles: they are
type-safe, composable, and provide clear error messages when parsing fails.
The type system automatically infers the result types, so you get full type
safety without manual type annotations.


`constant()` parser
-------------------

The `constant()` parser always succeeds without consuming any input and produces
a fixed value. While this might seem trivial, it plays a crucial role in
creating discriminated unions that allow TypeScript to distinguish between
different parsing alternatives.

~~~~ typescript twoslash
import { constant } from "@optique/core/parser";

// Always produces the string "add" without consuming input
const addCommand = constant("add");

// Can produce any type of constant value
const defaultPort = constant(8080);
const defaultConfig = constant({ debug: false, verbose: true });
~~~~

The `constant()` parser is particularly important when building subcommands or
mutually exclusive options. It provides the discriminator field that enables
type-safe pattern matching:

~~~~ typescript twoslash
import { command, constant, object, option, or, parse } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";

const parser = or(
  command("add", object({
    type: constant("add"),
    file: option("-f", "--file", string())
  })),
  command("remove", object({
    type: constant("remove"),
    force: option("--force")
  }))
);

// TypeScript can now distinguish between the two commands
const result = parse(parser, ["add", "--file", "example.txt"]);
if (result.success && result.value.type === "add") {
  // TypeScript knows this is the "add" command result
  console.log(`Adding file: ${result.value.file}`);
} else if (result.success && result.value.type === "remove") {
  // TypeScript knows this is the "remove" command result
  console.log(`Force remove: ${result.value.force}`);
}
~~~~

The `constant()` parser has the lowest priority (0), meaning it never interferes
with other parsers that need to consume input.


`option()` parser
-----------------

The `option()` parser handles command-line options in various formats: long
options (`--verbose`), short options (`-v`), combined short options (`-abc`),
and options with values (`--port=8080` or `--port 8080`).

### Boolean flags

When no [value parser](./valueparsers.md) is provided, `option()` creates
a Boolean flag that returns `true` when present and `false` when absent:

~~~~ typescript twoslash
import { option } from "@optique/core/parser";

// Boolean flag with short and long form
const verbose = option("-v", "--verbose");

// Multiple option names are supported
const help = option("-h", "--help", "-?");
~~~~

### Options with values

When a [value parser](./valueparsers.md) is provided, the option expects and
validates a value:

~~~~ typescript twoslash
import { option } from "@optique/core/parser";
import { integer, string } from "@optique/core/valueparser";

// String option
const name = option("-n", "--name", string());

// Integer option with validation
const port = option("-p", "--port", integer({ min: 1, max: 65535 }));

// Option with custom metavar for help text
const config = option("-c", "--config", string({ metavar: "FILE" }));
~~~~

### Supported option formats

The `option()` parser recognizes multiple input formats:

Space-separated
:   `-p 8080`, `--port 8080`

Equals-separated
:   `--port=8080`

Java-style
:   `-port 8080`

DOS-style
:   `/port:8080`

Bundled short options
:   `-abc` (equivalent to `-a -b -c` for boolean flags)

### Option ordering

The `option()` parser has high priority (10) to ensure options are matched
before positional arguments.

### Option descriptions

You can provide descriptions for help text generation:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import { option } from "@optique/core/parser";
// ---cut-before---
const parser = option("-v", "--verbose", {
  description: message`Enable verbose output for debugging`
});
~~~~

> [!TIP]
> Descriptions use Optique's [structured message system](./messages.md) rather
> than plain strings. This provides consistent formatting and enables rich text
> with semantic components like option names and metavariables.


`flag()` parser
---------------

*This API is available since Optique 0.3.0.*

The `flag()` parser creates required Boolean flags that must be explicitly
provided on the command line. Unlike `option()` which defaults to `false` when
absent, `flag()` fails parsing entirely when not provided. This makes it ideal
for scenarios where a flag's presence fundamentally changes the CLI's behavior
or when implementing dependent options.

~~~~ typescript twoslash
import { flag } from "@optique/core/parser";

// A flag that must be explicitly provided
const force = flag("-f", "--force");

// Multiple names are supported
const confirm = flag("-y", "--yes", "--confirm");
~~~~

### Key differences from `option()`

While both `flag()` and `option()` can create Boolean flags, they differ in
how they handle absence:

~~~~ typescript twoslash
import { flag, option, parse } from "@optique/core/parser";

const optionParser = option("-v", "--verbose");
const flagParser = flag("-f", "--force");

// option() succeeds with false when not provided
const optionResult = parse(optionParser, []);
// => { success: true, value: false }

// flag() fails when not provided
const flagResult = parse(flagParser, []);
// => { success: false, error: "Expected an option, but got end of input." }
~~~~

### Use cases for `flag()`

The `flag()` parser is particularly useful for:

Required confirmation flags
:   Operations that need explicit user confirmation

    ~~~~ typescript twoslash
    import { argument, flag, object } from "@optique/core/parser";
    import { string } from "@optique/core/valueparser";
    // ---cut-before---
    const deleteParser = object({
      confirm: flag("--yes-i-am-sure"),  // User must explicitly confirm
      target: argument(string()),
    });
    ~~~~

Dependent options
:   When a flag's presence enables additional options

    ~~~~ typescript twoslash
    import { flag, object, option, withDefault } from "@optique/core/parser";

    // When --advanced is not provided, parser fails and defaults are used
    const parser = withDefault(
      object({
        advanced: flag("--advanced"),
        maxThreads: option("--threads"),  // Only meaningful with --advanced
        cacheSize: option("--cache")      // Only meaningful with --advanced
      }),
      { advanced: false, maxThreads: false, cacheSize: false }
    );
    ~~~~

Mode selection
:   When different flags trigger different parsing modes

    ~~~~ typescript twoslash
    import { flag, object, optional } from "@optique/core/parser";
    // ---cut-before---
    const parser = object({
      interactive: optional(flag("-i", "--interactive")),
      batch: optional(flag("-b", "--batch")),
      daemon: optional(flag("-d", "--daemon"))
    });

    // At most one mode can be selected, enforced by application logic
    ~~~~

### Flag descriptions

Like other parsers, `flag()` supports descriptions for help text:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import { flag } from "@optique/core/parser";
// ---cut-before---
const parser = flag("-f", "--force", {
  description: message`Skip all confirmation prompts`
});
~~~~

The `flag()` parser has the same priority (10) as `option()` to ensure
consistent option handling.


`argument()` parser
-------------------

The `argument()` parser handles positional arguments—values that appear in
specific positions on the command line without option flags.
Positional arguments are essential for intuitive CLI design, as users expect
commands like `cp source.txt dest.txt` rather than `cp --source source.txt
--dest dest.txt`.

~~~~ typescript twoslash
import { argument } from "@optique/core/parser";
import { integer, string } from "@optique/core/valueparser";

// Single positional argument
const filename = argument(string({ metavar: "FILE" }));

// Argument with validation
const port = argument(integer({ min: 1, max: 65535, metavar: "PORT" }));
~~~~

The `argument()` parser automatically handles the `--` separator, which
conventionally signals the end of options. Arguments after `--` are treated
as positional arguments even if they look like options:

~~~~ bash
# Both "file" arguments are treated as positional arguments
$ myapp --verbose -- --file1 --file2
~~~~

### Argument ordering

Arguments are consumed in the order they appear, and the parser will fail
if it encounters an option where it expects a positional argument:

~~~~ typescript twoslash
import { object, option, argument } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";

const parser = object({
  input: argument(string({ metavar: "INPUT" })),
  output: argument(string({ metavar: "OUTPUT" })),
  verbose: option("-v", "--verbose")
});

// Valid: myapp input.txt output.txt -v
// Invalid: myapp -v input.txt  (expects INPUT but got option)
~~~~

The `argument()` parser has medium priority (5) to ensure it runs after options
but before lower-priority parsers.

### Argument descriptions

You can provide descriptions for help text generation:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import { argument } from "@optique/core/parser";
import { path } from "@optique/run/valueparser"
// ---cut-before---
const parser = argument(path(), {
  description: message`The file where data are read from.`
});
~~~~

> [!TIP]
> Like option descriptions, argument descriptions use the [structured message
> system](./messages.md) for consistent formatting and rich text capabilities.


`command()` parser
------------------

The `command()` parser enables building `git`-like CLI interfaces with
subcommands. It matches a specific command name and then applies an inner parser
to the remaining arguments.

~~~~ typescript twoslash
import { command, object, option, or } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";

const addCommand = command("add", object({
  file: option("-f", "--file", string()),
  all: option("-A", "--all")
}));

const removeCommand = command("remove", object({
  force: option("--force"),
  recursive: option("-r", "--recursive")
}));

const parser = or(addCommand, removeCommand);
~~~~

### Command priority and matching

The `command()` parser has the highest priority (15) to ensure subcommands are
matched before other parsers attempt to process the input. This prevents
conflicts where option parsers might try to interpret command names as invalid
options.

~~~~ typescript twoslash
import { command, object, option, or, parse } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";

const addCommand = command("add", object({
  file: option("-f", "--file", string()),
  all: option("-A", "--all")
}));

const removeCommand = command("remove", object({
  force: option("--force"),
  recursive: option("-r", "--recursive")
}));

const parser = or(addCommand, removeCommand);
// ---cut-before---
// Command matching happens first
const result = parse(parser, ["add", "--file", "example.txt"]);
// 1. "add" matches the command name
// 2. Remaining ["--file", "example.txt"] is passed to the inner parser
~~~~

### Command descriptions

Commands support descriptions for help text generation:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import { command, constant } from "@optique/core/parser";
const innerParser = constant(1);
// ---cut-before---
const addCommand = command("add", innerParser, {
  description: message`Add files to the project` // [!code highlight]
});
~~~~

> [!TIP]
> Command descriptions also use the [structured message system](./messages.md),
> enabling rich descriptions with semantic components for better help text
> formatting.

### Nested subcommands

You can nest commands multiple levels deep by using `command()` parsers as inner
parsers:

~~~~ typescript twoslash
import { argument, command, object, option, or } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
// ---cut-before---
const configCommands = or(
  command("get", object({
    key: argument(string({ metavar: "KEY" }))
  })),
  command("set", object({
    key: argument(string({ metavar: "KEY" })),
    value: argument(string({ metavar: "VALUE" }))
  }))
);

const parser = or(
  command("config", configCommands),
  command("init", object({
    template: option("-t", "--template", string())
  }))
);

// Usage: myapp config get database.url
// Usage: myapp config set database.url "postgres://localhost/mydb"
// Usage: myapp init --template react
~~~~


Parser priority and state management
------------------------------------

### Priority system

Optique uses a priority system to determine the order in which parsers are
applied when multiple parsers are available. This ensures that more specific
parsers (like commands) are tried before more general ones (like arguments):

 -  *Priority 15*: `command()` parsers
 -  *Priority 10*: `option()` and `flag()` parsers
 -  *Priority 5*: `argument()` parsers
 -  *Priority 0*: `constant()` parsers

Higher priority parsers are always tried first, which prevents ambiguous parsing
situations and ensures predictable behavior.

### State management

Each primitive parser manages its own internal state during the parsing process.
The state tracks whether the parser has been invoked, what values have been
consumed, and any validation results.

For example, an `option()` parser's state might be:

 -  `undefined`: Option not yet encountered
 -  `{ success: true, value: "hello" }`: Option successfully parsed with value
 -  `{ success: false, error: "Invalid value" }`: Option encountered but value
    parsing failed

This state management enables features like preventing duplicate options,
validating that required arguments are provided, and generating helpful error
messages.

### Error handling

When primitive parsers encounter invalid input, they return detailed error
messages that help users understand what went wrong:

~~~~ typescript
// Parsing ["--port", "invalid"] with integer value parser
{
  success: false,
  error: "Expected a valid integer, but got invalid."
}
~~~~

~~~~ typescript
// Parsing ["--missing-option"] where no parser matches
{
  success: false,
  error: "No matched option for --missing-option."
}
~~~~

The error messages are designed to be user-friendly while providing enough detail for developers to understand parsing failures.


Working with primitive parsers
------------------------------

### Single primitive usage

You can use primitive parsers directly for simple CLI applications:

~~~~ typescript twoslash
import { option, parse } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";

const nameParser = option("--name", string());
const result = parse(nameParser, ["--name", "Alice"]);

if (result.success) {
  console.log(`Hello, ${result.value}!`);
} else {
  console.error(result.error);
}
~~~~

### Combining primitives

More commonly, you'll combine multiple primitive parsers using
[structural combinators](./constructs.md) like `object()`:

~~~~ typescript twoslash
import { type InferValue, object, option, argument } from "@optique/core/parser";
import { string, integer } from "@optique/core/valueparser";

const parser = object({ // [!code highlight]
  input: argument(string({ metavar: "INPUT" })),
  output: option("-o", "--output", string({ metavar: "OUTPUT" })),
  port: option("-p", "--port", integer({ min: 1, max: 65535 })),
  verbose: option("-v", "--verbose")
});

type Result = InferValue<typeof parser>;
//   ^?








// TypeScript automatically infers the result type!
~~~~

### Common patterns

#### Required vs optional

By default, `option()` and `argument()` parsers are required—parsing fails
if they're not provided. Use [modifying combinators](./modifiers.md) like
`optional()` or `withDefault()` to make them optional:

~~~~ typescript twoslash
import { argument, object, option, optional, withDefault } from "@optique/core/parser";
import { integer, string } from "@optique/core/valueparser";

const parser = object({
  input: argument(string()), // Required
  output: optional(option("-o", string())), // Optional (returns string | undefined) // [!code highlight]
  port: withDefault(option("-p", integer()), 8080) // Optional with default // [!code highlight]
});
~~~~

#### Multiple occurrences

Use the `multiple()` combinator to allow repeated options or arguments:

~~~~ typescript twoslash
import { argument, multiple, object, option } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";

const parser = object({
  files: multiple(argument(string())), // Multiple files // [!code highlight]
  includes: multiple(option("-I", string())) // Multiple -I options // [!code highlight]
});
~~~~

These patterns demonstrate how primitive parsers serve as the foundation for more complex CLI structures, providing the building blocks that higher-level combinators orchestrate into complete parsing solutions.

<!-- cSpell: ignore myapp mydb -->
