---
description: >-
  Practical recipes for common command-line interface patterns using Optique:
  subcommands, dependent options, mutually exclusive flags, key-value pairs,
  and more complex CLI designs with detailed explanations.
---

CLI patterns cookbook
=====================

This cookbook provides practical recipes for common command-line interface
patterns using Optique. Each pattern demonstrates not just how to implement
a specific feature, but the underlying principles that make it work, helping
you understand how to adapt these techniques to your own applications.

The examples focus on real-world CLI patterns you'll encounter when building
command-line tools: handling mutually exclusive options, implementing dependent
flags, parsing key-value pairs, and organizing complex subcommand structures.


Subcommands with distinct behaviors
-----------------------------------

Many CLI tools organize functionality into subcommands, where each subcommand
has its own set of options and arguments. This pattern is essential for tools
that perform multiple related operations, like Git (`git commit`, `git push`)
or Docker (`docker run`, `docker build`).

~~~~ typescript twoslash
import { optional } from "@optique/core/modifiers";
import { object, or } from "@optique/core/parser";
import { argument, command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { run } from "@optique/run";
// ---cut-before---
const addCommand = command(
  "add",
  object({
    action: constant("add"),
    key: argument(string({ metavar: "KEY" })),
    value: argument(string({ metavar: "VALUE" })),
  }),
);

const removeCommand = command(
  "remove",
  object({
    action: constant("remove"),
    key: argument(string({ metavar: "KEY" })),
  }),
);

const editCommand = command(
  "edit",
  object({
    action: constant("edit"),
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

const parser = or(addCommand, removeCommand, editCommand, listCommand);

const result = run(parser);
//    ^?

















// The result type consists of a discriminated union of all commands.
~~~~

The key insight here is using [`or()`](./concepts/constructs.md#or-parser)
to create a discriminated union of different command parsers.
Each [`command()`](./concepts/primitives.md#command-parser) parser:

 1. *Matches a specific keyword* (`"add"`, `"remove"`, etc.) as the first
    argument
 2. *Provides a unique type tag* using
    [`constant()`](./concepts/primitives.md#constant-parser) to distinguish
    commands in the result type
 3. *Defines command-specific arguments* that only apply to that particular
    command

The `constant("add")` pattern is crucial because it creates a literal type that
TypeScript can use for exhaustive checking. When you handle the result,
TypeScript knows exactly which fields are available based on the `action` value:

~~~~ typescript twoslash
const result = 0 as unknown as {
    readonly action: "add";
    readonly key: string;
    readonly value: string;
} | {
    readonly action: "remove";
    readonly key: string;
} | {
    readonly action: "edit";
    readonly key: string;
    readonly value: string;
} | {
    readonly action: "list";
    readonly pattern: string | undefined;
};
// ---cut-before---
if (result.action === "add") {
  // TypeScript knows: result.key and result.value are available
  console.log(`Adding ${result.key}=${result.value}`);
} else if (result.action === "remove") {
  // TypeScript knows: only result.key is available
  console.log(`Removing ${result.key}`);
}
~~~~

This pattern scales well because adding new subcommands only requires extending
the `or()` combinator with new command parsers.


Mutually exclusive options
--------------------------

Sometimes you need to accept different sets of options that cannot be used
together. This pattern is common in tools that can operate in different modes,
where each mode requires its own configuration.

~~~~ typescript twoslash
import { withDefault } from "@optique/core/modifiers";
import { object, or } from "@optique/core/parser";
import { argument, constant, option } from "@optique/core/primitives"
import { integer, string, url } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";
// ---cut-before---
const parser = or(
  object({
    mode: constant("server"),
    host: withDefault(
      option(
        "-h",
        "--host",
        string({ metavar: "HOST" }),
      ),
      "0.0.0.0",
    ),
    port: option(
      "-p",
      "--port",
      integer({ metavar: "PORT", min: 1, max: 0xffff }),
    ),
  }),
  object({
    mode: constant("client"),
    url: argument(url()),
  }),
);

const result = run(parser);
//    ^?










// The result type is a discriminated union of server and client modes.
~~~~

This pattern uses [`or()`](./concepts/constructs.md#or-parser) at the parser
level rather than just for individual flags. Each branch of the `or()`
represents a complete, valid configuration:

Server mode
:   Requires `--port` option and accepts optional `--host`

Client mode
:   Requires a URL argument

The [`constant()`](./concepts/primitives.md#constant-parser) combinator in
each branch serves as a discriminator, making it easy to determine which mode
was selected and what options are available. The type system prevents you from
accidentally accessing client-only fields when in server mode.

The [`withDefault()`](./concepts/modifiers.md#withdefault-parser) wrapper
ensures that optional fields have sensible defaults, but only within their
respective modes. The client mode doesn't get a default host because
it doesn't use one.


Mutually exclusive flags
------------------------

For simpler cases where you need exactly one of several flags, you can use
mutually exclusive flags that map to different values.

~~~~ typescript twoslash
import { map, withDefault } from "@optique/core/modifiers";
import { or } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { message } from "@optique/core/message";
import { run } from "@optique/run";
// ---cut-before---
const modeParser = withDefault(
  or(
    map(option("-a", "--mode-a"), () => "a" as const),
    map(option("-b", "--mode-b"), () => "b" as const),
    map(option("-c", "--mode-c"), () => "c" as const),
  ),
  "default" as const,
);

const result = run(modeParser);
//    ^?


// The result type is a union of "a", "b", "c", or "default".
~~~~

This pattern combines [`or()`](./concepts/constructs.md#or-parser) with
[`map()`](./concepts/modifiers.md#map-parser) to transform boolean flag presence
into more meaningful values. Each
[`option()`](./concepts/primitives.md#option-parser) parser only succeeds when
its flag is present, and `map()` transforms the boolean result into a string
literal.

The [`withDefault()`](./concepts/modifiers.md#withdefault-parser) wrapper
handles the case where no flags are provided, giving you a fallback behavior.
This is different from the previous pattern because:

 -  *No validation*: Multiple flags can be provided (last one wins)
 -  *Simpler structure*: Returns a simple string rather than an object
 -  *Default handling*: Has a meaningful fallback when no options are given


Dependent options
-----------------

Some CLI tools have options that only make sense when another option is
present. This creates a dependency relationship where certain options are
only valid in specific contexts.

~~~~ typescript twoslash
import { withDefault } from "@optique/core/modifiers";
import { merge, object } from "@optique/core/parser";
import { flag, option } from "@optique/core/primitives";
import { message } from "@optique/core/message";
import { run } from "@optique/run";
// ---cut-before---
const unionParser = withDefault(
  object({
    flag: flag("-f", "--flag"),
    dependentFlag: option("-d", "--dependent-flag"),
    dependentFlag2: option("-D", "--dependent-flag-2"),
  }),
  { flag: false as const } as const,
);

const parser = merge(
  unionParser,
  object({
    normalFlag: option("-n", "--normal-flag"),
  }),
);

const result = run(parser);
//    ^?











// The result type enforces that dependentFlag and dependentFlag2 are only
// available when flag is true.
~~~~

This pattern uses conditional typing to enforce dependencies at compile time.
The [`withDefault()`](./concepts/modifiers.md#withdefault-parser) combinator
creates a union type where:

When `flag: false`
:   Only the main flag is available

When `flag: true`
:   Additional dependent options become available

This ensures that TypeScript prevents accessing dependent options unless the
main flag is `true`. The [`merge()`](./concepts/constructs.md#merge-parser)
combinator allows you to combine the conditional parser with other independent
options that are always available.

The key insight is that dependent options are often about context: when certain
features are enabled, additional configuration becomes relevant.


Key–value pair options
----------------------

Many CLI tools accept configuration as key–value pairs, similar to environment
variables or configuration files. This pattern is common in containerization
tools and configuration management systems.

~~~~ typescript twoslash
import { map, multiple } from "@optique/core/modifiers";
import { object, or } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { message, text } from "@optique/core/message";
import {
  type ValueParser,
  type ValueParserResult,
} from "@optique/core/valueparser";
import { print, run } from "@optique/run";
// ---cut-before---
/**
 * Custom value parser for key-value pairs with configurable separator
 */
function keyValue(separator = "="): ValueParser<[string, string]> {
  return {
    metavar: `KEY${separator}VALUE`,
    parse(input: string): ValueParserResult<[string, string]> {
      const index = input.indexOf(separator);
      if (index === -1 || index === 0) {
        return {
          success: false,
          error: message`Invalid format. Expected KEY${
            text(separator)
          }VALUE, got ${input}`,
        };
      }
      const key = input.slice(0, index);
      const value = input.slice(index + separator.length);
      return { success: true, value: [key, value] };
    },
    format([key, value]: [string, string]): string {
      return `${key}${separator}${value}`;
    },
  };
}

// Docker-style environment variables
const dockerParser = object({
  env: map(
    multiple(option("-e", "--env", keyValue())),
    (pairs) => Object.fromEntries(pairs),
  ),
  labels: map(
    multiple(option("-l", "--label", keyValue(":"))),
    (pairs) => Object.fromEntries(pairs),
  ),
});

// Kubernetes-style configuration
const k8sParser = object({
  set: map(
    multiple(option("--set", keyValue())),
    (pairs) => Object.fromEntries(pairs),
  ),
  values: map(
    multiple(option("--values", keyValue(":"))),
    (pairs) => Object.fromEntries(pairs),
  ),
});

const parser = or(dockerParser, k8sParser);

const config = run(parser);
//    ^?

















if ("env" in config) {
  // config.env and config.labels are now Record<string, string>
  print(message`Environment: ${JSON.stringify(config.env, null, 2)}`);
  print(message`Labels: ${JSON.stringify(config.labels, null, 2)}`);
} else {
  // config.set and config.values are now Record<string, string>
  print(message`Set: ${JSON.stringify(config.set, null, 2)}`);
  print(message`Values: ${JSON.stringify(config.values, null, 2)}`);
}
~~~~

This pattern demonstrates several advanced techniques:

### Custom value parser

The `keyValue()` function creates a reusable value parser that:

 -  *Validates format*: Ensures the input contains the separator
 -  *Splits correctly*: Handles the separator appearing in values
 -  *Provides meaningful errors*: Shows expected format when parsing fails
 -  *Supports different separators*: Configurable for different use cases

### Multiple collection

Using [`multiple()`](./concepts/modifiers.md#multiple-parser) allows collecting
many key–value pairs:

~~~~ bash
myapp -e DATABASE_URL=postgres://... -e DEBUG=true -l app:web -l version:1.0
~~~~

### Type transformation with `map()`

The example uses [`map()`](./concepts/modifiers.md#map-parser) to transform
the parsed `[string, string][]` array directly into a `Record<string, string>`.

This transformation happens at parse time, so your application receives
structured objects rather than arrays of tuples. The type system correctly
infers `Record<string, string>` for each field, providing better IDE support
and type safety.

This pattern is powerful because it bridges the gap between command-line
interfaces and structured configuration data.


Verbosity levels
----------------

Command-line tools often need different levels of output detail. The traditional
Unix approach uses repeated flags: `-v` for verbose, `-vv` for very verbose,
and so on.

~~~~ typescript twoslash
import { map, multiple } from "@optique/core/modifiers";
import { object } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";
// ---cut-before---
const VERBOSITY_LEVELS = ["debug", "info", "warning", "error"] as const;

const verbosityParser = object({
  verbosity: map(
    multiple(option("-v", "--verbose")),
    (v) =>
      VERBOSITY_LEVELS.at(
        -Math.min(v.length, VERBOSITY_LEVELS.length - 1) - 1,
      )!,
  ),
});

const result = run(verbosityParser);
//    ^?





print(message`Verbosity level: ${result.verbosity}.`);
~~~~

This pattern combines several concepts:

### Repeated flag collection

`multiple(option("-v", "--verbose"))` collects all instances of the flag,
creating an array of boolean values. Each occurrence adds another `true` to
the array.

### Length-based mapping

The [`map()`](./concepts/modifiers.md#map-parser) transformation converts array
length into verbosity levels:

 -  `-v` → `["debug", "info", "warning", "error"].at(-1-1)` → `"error"`
 -  `-vv` → `["debug", "info", "warning", "error"].at(-2-1)` → `"warning"`
 -  `-vvv` → `["debug", "info", "warning", "error"].at(-3-1)` → `"info"`
 -  `-vvvv` → `["debug", "info", "warning", "error"].at(-4-1)` → `"debug"`

The negative indexing with [`Array.at()`] creates an inverse relationship:
more flags mean more verbose output (lower threshold). The [`Math.min()`]
prevents going beyond the available levels.

This pattern is elegant because it:

 -  *Matches user expectations*: More `-v` flags = more output
 -  *Has natural limits*: Caps at maximum verbosity level
 -  *Fails gracefully*: Extra flags don't cause errors

[`Array.at()`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/at
[`Math.min()`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/min


Grouped mutually exclusive options
----------------------------------

When you have many mutually exclusive options, grouping them in help output
improves usability while maintaining the same parsing logic.

~~~~ typescript twoslash
import { map, withDefault } from "@optique/core/modifiers";
import { group, or } from "@optique/core/parser";
import { flag } from "@optique/core/primitives";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";
// ---cut-before---
const formatParser = withDefault(
  group(
    "Formatting options",
    or(
      map(flag("--json", { description: message`Use JSON format.` }),
          () => "json" as const),
      map(flag("--yaml", { description: message`Use YAML format.` }),
          () => "yaml" as const),
      map(flag("--toml", { description: message`Use TOML format.` }),
          () => "toml" as const),
      map(flag("--xml",  { description: message`Use XML format.`  }),
          () => "xml" as const),
    ),
  ),
  "json" as const,
);

const result = run(formatParser, { help: "option" });
//    ^?


print(message`Output format: ${result}.`);
~~~~

This pattern introduces the `group()` combinator to organize related options
in help output. The parsing logic is identical to the basic mutually exclusive
flags pattern, but the help text is better organized:

~~~~ ansi
Formatting options:
  [3m--json[0m                      Use JSON format.
  [3m--yaml[0m                      Use YAML format.
  [3m--toml[0m                      Use TOML format.
  [3m--xml[0m                       Use XML format.
~~~~

The `group()` combinator is purely cosmetic for help generation—it doesn't
change parsing behavior. This separation of concerns allows you to optimize
for both code clarity and user experience independently.


Negatable Boolean options
-------------------------

Linux CLI tools commonly support `--no-` prefix options that negate default
behavior. This pattern allows users to explicitly disable features that are
enabled by default.

~~~~ typescript twoslash
import { map } from "@optique/core/modifiers";
import { object } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";
// ---cut-before---
const configParser = object({
  // Code fence is enabled by default, --no-code-fence disables it
  codeFence: map(option("--no-code-fence"), (o) => !o),

  // Line numbers are disabled by default, --line-numbers enables it
  lineNumbers: option("--line-numbers"),

  // Colors are enabled by default, --no-colors disables them
  colors: map(option("--no-colors"), (o) => !o),

  // Syntax highlighting is enabled by default, --no-syntax disables it
  syntax: map(option("--no-syntax"), (o) => !o),
});

const result = run(configParser);
//    ^?








console.debug(result);
~~~~

This pattern leverages the fact that [`option()`](./concepts/primitives.md#option-parser)
without a value parser creates a Boolean flag that produces `false` when absent
and `true` when present. The [`map()`](./concepts/modifiers.md#map-parser)
combinator inverts this behavior:

When `--no-code-fence` is provided
:   `option()` produces `true` → `map()` inverts to `false`

When `--no-code-fence` is not provided
:   `option()` produces `false` → `map()` inverts to `true`

This creates the expected Linux CLI behavior where features are enabled by
default and can be explicitly disabled with `--no-` prefixed options.

### Usage examples

~~~~ bash
# All defaults: codeFence=true, lineNumbers=false, colors=true, syntax=true
myapp

# Disable colors and syntax, enable line numbers
myapp --no-colors --no-syntax --line-numbers

# Disable code fence only
myapp --no-code-fence
~~~~

This pattern is particularly useful for configuration-heavy tools where users
need fine-grained control over default behaviors, following the Unix tradition
of sensible defaults with explicit override capabilities.


Design principles
-----------------

These patterns demonstrate several key principles for designing CLI parsers:

### Composition over configuration

Instead of complex configuration objects, combine simple parsers using
combinators like [`or()`](./concepts/constructs.md#or-parser),
[`merge()`](./concepts/constructs.md#merge-parser), and
[`multiple()`](./concepts/modifiers.md#multiple-parser). Each combinator has
a single, well-defined purpose.

### Type-driven design

Use TypeScript's type system to enforce correct usage. Discriminated unions,
conditional types, and literal types prevent runtime errors by catching
mistakes at compile time.

### Separation of concerns

Separate parsing logic from presentation logic.
Use [`group()`](./concepts/constructs.md#group-parser) for help organization,
[`withDefault()`](./concepts/modifiers.md#withdefault-parser) for fallback
behavior, and [`map()`](./concepts/modifiers.md#map-parser) for data
transformation.

### Progressive disclosure

Start with simple parsers and add complexity through composition. A basic
flag becomes a mutually exclusive choice, which becomes a grouped set of
options, which becomes part of a larger command structure.

### Fail-safe defaults

Always consider what happens when optional inputs are missing. Use
[`withDefault()`](./concepts/modifiers.md#withdefault-parser) to provide
sensible fallbacks and [`optional()`](./concepts/modifiers.md#optional-parser)
when absence is meaningful.


Advanced patterns
-----------------

The cookbook patterns can be combined to create sophisticated CLI interfaces:

~~~~ typescript twoslash
import { multiple, withDefault } from "@optique/core/modifiers";
import { merge, object } from "@optique/core/parser";
import { argument, command, constant, flag, option } from "@optique/core/primitives";
import { string, type ValueParser,
         type ValueParserResult } from "@optique/core/valueparser";
function keyValue(separator = "="): ValueParser<[string, string]> {
  return {
    metavar: "",
    parse(input: string): ValueParserResult<[string, string]> {
      return { success: true, value: ["", ""] };
    },
    format([key, value]: [string, string]): string {
      return "";
    },
  };
}
// ---cut-before---
// Combining subcommands with dependent options and key-value pairs
const deployCommand = command("deploy", merge(
  object({
    action: constant("deploy"),
    environment: argument(string()),
  }),
  withDefault(
    object({
      dryRun: flag("--dry-run"),
      vars: multiple(option("--var", keyValue())),
      confirm: option("--confirm"),
    }),
    { dryRun: false }
  )
));
~~~~

This creates a deploy command that:

 -  Requires an environment argument
 -  Supports key-value variables
 -  Has optional dry-run mode
 -  Uses dependent confirmation when not in dry-run mode

The patterns in this cookbook provide the building blocks for creating
CLI interfaces that are both powerful and type-safe, with clear separation
between parsing logic, type safety, and user experience.
