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
import { object, or } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
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

1.  *Matches a specific keyword* (`"add"`, `"remove"`, etc.) as the first
    argument
2.  *Provides a unique type tag* using
    [`constant()`](./concepts/primitives.md#constant-parser) to distinguish
    commands in the result type
3.  *Defines command-specific arguments* that only apply to that particular
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
import { object, or } from "@optique/core/constructs";
import { withDefault } from "@optique/core/modifiers";
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
import { or } from "@optique/core/constructs";
import { map, withDefault } from "@optique/core/modifiers";
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


Optional mutually exclusive flags
---------------------------------

Sometimes you want mutually exclusive options where *none* of them need to be
provided. For example, a verbosity setting where you can specify `--verbose`
or `--quiet`, but the default behavior applies when neither is given.

The key insight is that [`or()`](./concepts/constructs.md#or-parser) requires
at least one alternative to match. To make all alternatives optional, wrap
the `or()` with [`optional()`](./concepts/modifiers.md#optional-parser):

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import { map, optional, withDefault } from "@optique/core/modifiers";
import { flag } from "@optique/core/primitives";
import { run } from "@optique/run";
// ---cut-before---
// Using optional(): returns undefined when no flag is provided
const outputMode = optional(
  or(
    map(flag("--verbose", "-v"), () => "verbose" as const),
    map(flag("--quiet", "-q"), () => "quiet" as const),
  ),
);

// Using withDefault(): returns a default value when no flag is provided
const outputModeWithDefault = withDefault(
  or(
    map(flag("--verbose", "-v"), () => "verbose" as const),
    map(flag("--quiet", "-q"), () => "quiet" as const),
  ),
  "normal" as const,
);

const result1 = run(outputMode);
//    ^?



const result2 = run(outputModeWithDefault);
//    ^?


console.debug(result1, result2);
~~~~

This pattern differs from the basic
[mutually exclusive flags](#mutually-exclusive-flags) pattern in an important
way:

 -  *Without wrapper*: `or(A, B)` requires at least one to match—parsing fails
    if neither is provided
 -  *With `optional()`*: Returns `undefined` when no alternative matches
 -  *With `withDefault()`*: Returns a fallback value when no alternative matches

Choose based on your needs:

 -  Use `optional(or(...))` when the absence of a choice is meaningful
    (e.g., “use system default”)
 -  Use `withDefault(or(...), fallback)` when you always want a concrete value


Dependent options
-----------------

Some CLI tools have options that only make sense when another option is
present. This creates a dependency relationship where certain options are
only valid in specific contexts.

~~~~ typescript twoslash
import { merge, object } from "@optique/core/constructs";
import { withDefault } from "@optique/core/modifiers";
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


Inter-option value dependencies
-------------------------------

*This API is available since Optique 0.10.0.*

Sometimes one option's *valid values* depend on another option's value.
For example, a `--log-level` option might accept `debug` and `trace` in
development mode, but only `warn` and `error` in production. The
[`dependency()`](./concepts/dependencies.md) system provides type-safe
support for these relationships.

~~~~ typescript twoslash
import { dependency } from "@optique/core/dependency";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
import { run } from "@optique/run";

// Create a dependency source from the mode option
const modeParser = dependency(choice(["dev", "prod"] as const));

// Create a derived parser whose valid values depend on mode
const logLevelParser = modeParser.derive({
  metavar: "LEVEL",
  factory: (mode) =>
    choice(mode === "dev"
      ? ["debug", "info", "warn", "error"]
      : ["warn", "error"]),
  defaultValue: () => "dev" as const,
});

const parser = object({
  mode: option("--mode", modeParser),
  logLevel: option("--log-level", logLevelParser),
});

const config = run(parser);
//    ^?




// In dev mode: --log-level debug ✓
// In prod mode: --log-level debug ✗ (invalid)
~~~~

This pattern differs from the [dependent options](#dependent-options) pattern
above in an important way:

 -  *Dependent options*: Controls whether options are *available* based on
    a flag's presence
 -  *Value dependencies*: Controls which *values are valid* based on another
    option's value

### Multiple dependencies

When an option depends on multiple other options, use `deriveFrom()`:

~~~~ typescript twoslash
import { dependency, deriveFrom } from "@optique/core/dependency";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
import { run } from "@optique/run";

const envParser = dependency(choice(["local", "staging", "prod"] as const));
const regionParser = dependency(choice(["us", "eu", "asia"] as const));

// Server names depend on both environment and region
const serverParser = deriveFrom({
  metavar: "SERVER",
  dependencies: [envParser, regionParser] as const,
  factory: (env, region) =>
    choice(env === "local"
      ? ["localhost"]
      : [`${env}-${region}-1`, `${env}-${region}-2`]),
  defaultValues: () => ["local", "us"] as const,
});

const parser = object({
  env: option("--env", envParser),
  region: option("--region", regionParser),
  server: option("--server", serverParser),
});

const config = run(parser);
// --env prod --region eu --server prod-eu-1 ✓
// --env local --server localhost ✓
// --env local --server prod-us-1 ✗ (invalid for local)
~~~~

The dependency system also integrates with shell completion—when users request
completions for `--server`, they see suggestions appropriate for the current
`--env` and `--region` values.

For more details, see the
[*Inter-option dependencies*](./concepts/dependencies.md) concept guide.


Conditional options based on discriminator
------------------------------------------

*This API is available since Optique 0.8.0.*

When you have options that depend on a specific discriminator value (like
a `--reporter` option determining which additional options are valid), the
[`conditional()`](./concepts/constructs.md#conditional-parser) combinator
provides a clean solution.

~~~~ typescript twoslash
import { conditional, object } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import { run } from "@optique/run";
// ---cut-before---
const reporterParser = conditional(
  option("--reporter", choice(["console", "junit", "html", "json"])),
  {
    console: object({
      colors: optional(option("--colors")),
    }),
    junit: object({
      outputFile: option("--output-file", string({ metavar: "FILE" })),
    }),
    html: object({
      outputDir: option("--output-dir", string({ metavar: "DIR" })),
      title: optional(option("--title", string())),
    }),
    json: object({
      pretty: optional(option("--pretty")),
      indent: optional(option("--indent", integer({ min: 0, max: 8 }))),
    }),
  }
);

const result = run(reporterParser);
// The result type is a tuple union based on the discriminator value.
~~~~

This pattern is different from using
[`or()`](./concepts/constructs.md#or-parser) with
[`constant()`](./concepts/primitives.md#constant-parser) because:

 -  *Explicit discriminator*: The user provides `--reporter junit` rather than
    inferring mode from which options are present
 -  *Clear error messages*: If `--reporter junit` is provided but `--output-file`
    is missing, the error clearly states that `--output-file` is required when
    using the junit reporter
 -  *Tuple result*: The result is `["junit", { outputFile: "..." }]` rather than
    a merged object, making the discriminator value easily accessible

### With default branch

For CLIs where the discriminator is optional, provide a default branch:

~~~~ typescript twoslash
import { conditional, object } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { choice, string } from "@optique/core/valueparser";
import { run } from "@optique/run";
// ---cut-before---
const outputParser = conditional(
  option("--format", choice(["json", "xml", "csv"])),
  {
    json: object({ pretty: optional(option("--pretty")) }),
    xml: object({ indent: optional(option("--indent", string())) }),
    csv: object({ delimiter: optional(option("--delimiter", string())) }),
  },
  // Default: text output with optional color
  object({ color: optional(option("--color")) })
);

const [format, options] = run(outputParser);
//     ^?


if (format === undefined) {
  // Default branch: text output
  console.log(`Text output, color: ${options.color ?? false}`);
} else if (format === "json") {
  // JSON format with pretty option
  console.log(`JSON output, pretty: ${options.pretty ?? false}`);
}
~~~~

When no `--format` option is provided, the default branch is used and the
format is `undefined`.

### Type-safe pattern matching

The tuple result enables concise pattern matching:

~~~~ typescript twoslash
import { conditional, object } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { choice, string, integer } from "@optique/core/valueparser";
import { run } from "@optique/run";

const reporterParser = conditional(
  option("--reporter", choice(["console", "junit", "html", "json"])),
  {
    console: object({
      colors: optional(option("--colors")),
    }),
    junit: object({
      outputFile: option("--output-file", string({ metavar: "FILE" })),
    }),
    html: object({
      outputDir: option("--output-dir", string({ metavar: "DIR" })),
      title: optional(option("--title", string())),
    }),
    json: object({
      pretty: optional(option("--pretty")),
      indent: optional(option("--indent", integer({ min: 0, max: 8 }))),
    }),
  }
);
// ---cut-before---
const [reporter, config] = run(reporterParser);

switch (reporter) {
  case "console":
    // TypeScript knows: config is { colors: boolean | undefined }
    console.log(`Console output with colors: ${config.colors ?? true}`);
    break;
  case "junit":
    // TypeScript knows: config is { outputFile: string }
    console.log(`Writing JUnit report to ${config.outputFile}`);
    break;
  case "html":
    // TypeScript knows: config is { outputDir: string, title: string | undefined }
    console.log(`Writing HTML report to ${config.outputDir}`);
    break;
  case "json":
    // TypeScript knows: config is { pretty: boolean | undefined, indent: number | undefined }
    console.log(`JSON output, pretty: ${config.pretty ?? false}`);
    break;
}
~~~~

The [`conditional()`](./concepts/constructs.md#conditional-parser) combinator
is ideal when your CLI has a discriminator option that determines which set of
additional options becomes valid. It provides better type inference and clearer
error messages than manually building discriminated unions with `or()`.


Key–value pair options
----------------------

Many CLI tools accept configuration as key–value pairs, similar to environment
variables or configuration files. This pattern is common in containerization
tools and configuration management systems.

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import { map, multiple } from "@optique/core/modifiers";
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
function keyValue(separator = "="): ValueParser<"sync", [string, string]> {
  return {
    $mode: "sync",
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
import { object } from "@optique/core/constructs";
import { map, multiple } from "@optique/core/modifiers";
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
import { group, or } from "@optique/core/constructs";
import { map, withDefault } from "@optique/core/modifiers";
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
import { object } from "@optique/core/constructs";
import { map } from "@optique/core/modifiers";
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

This pattern leverages the fact that
[`option()`](./concepts/primitives.md#option-parser) without a value parser
creates a Boolean flag that produces `false` when absent and `true` when
present. The [`map()`](./concepts/modifiers.md#map-parser) combinator inverts
this behavior:

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


Conditional defaults based on input consumption
-----------------------------------------------

*This API is available since Optique 0.10.0.*

Sometimes you need different behavior based on whether the user provided any
options at all. For example, a CLI tool might show help when invoked with no
arguments, but apply default values when at least one option is provided.

The [`nonEmpty()`](./concepts/modifiers.md#nonempty-parser) modifier combined
with [`longestMatch()`](./concepts/constructs.md#longestmatch-parser) enables
this pattern:

~~~~ typescript twoslash
import { longestMatch, object } from "@optique/core/constructs";
import { nonEmpty, optional, withDefault } from "@optique/core/modifiers";
import { constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { run } from "@optique/run";

// Active mode: requires at least one option to be provided
const activeParser = nonEmpty(object({
  mode: constant("active" as const),
  cwd: withDefault(option("--cwd", string()), "./"),
  key: optional(option("--key", string())),
}));

// Help mode: fallback when no options are given
const helpParser = object({
  mode: constant("help" as const),
});

const parser = longestMatch(activeParser, helpParser);

const result = run(parser);
//    ^?








if (result.mode === "help") {
  console.log("No options provided. Showing help.");
} else {
  console.log(`Running with cwd=${result.cwd}, key=${result.key ?? "none"}`);
}
~~~~

### How it works

Without `nonEmpty()`, the `activeParser` would always succeed even with no
input, because all its options have defaults or are optional. This means it
would consume 0 tokens and still produce a valid result, preventing the
`helpParser` from ever being selected.

The `nonEmpty()` modifier changes this behavior:

1.  When no options are provided, `activeParser` succeeds but consumes 0 tokens
2.  `nonEmpty()` detects this and converts the success into a failure
3.  `longestMatch()` then falls back to `helpParser`, which also consumes
    0 tokens but succeeds
4.  The result is the help mode

When at least one option is provided:

1.  `activeParser` succeeds and consumes at least one token
2.  `nonEmpty()` allows this success to pass through
3.  `longestMatch()` selects `activeParser` because it consumed more tokens
4.  Default values are applied to unprovided options

### Usage examples

~~~~ bash
# No options: help mode
myapp dev
# → "No options provided. Showing help."

# With --key: active mode with defaults
myapp dev --key mykey
# → "Running with cwd=./, key=mykey"

# With --cwd: active mode
myapp dev --cwd /tmp
# → "Running with cwd=/tmp, key=none"

# With both options: active mode
myapp dev --cwd /tmp --key mykey
# → "Running with cwd=/tmp, key=mykey"
~~~~

This pattern is ideal for development tools, build systems, or any CLI where
you want to guide users to provide at least some configuration while still
supporting sensible defaults once they start configuring.


Environment variable fallbacks
------------------------------

*This API is available since Optique 1.0.0.*

When a CLI argument is not provided, `bindEnv()` from *@optique/env* checks
the corresponding environment variable before falling back to a default.

~~~~ typescript twoslash
import { bindEnv, bool, createEnvContext } from "@optique/env";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { runAsync } from "@optique/run";

const envContext = createEnvContext({ prefix: "MYAPP_" });

const parser = object({
  host: bindEnv(
    option("-h", "--host", string()),
    { context: envContext, key: "HOST", parser: string(), default: "localhost" },
  ),
  port: bindEnv(
    option("-p", "--port", integer()),
    { context: envContext, key: "PORT", parser: integer(), default: 3000 },
  ),
  debug: bindEnv(
    option("-d", "--debug", bool()),
    { context: envContext, key: "DEBUG", parser: bool(), default: false },
  ),
});

const result = await runAsync(parser, {
  contexts: [envContext],
});
~~~~

The priority order is: CLI argument > environment variable > default value.
With the `MYAPP_` prefix, the parser reads `MYAPP_HOST`, `MYAPP_PORT`, and
`MYAPP_DEBUG`.

For more details, see the
[environment variable guide](./integrations/env.md).


Config file integration
-----------------------

*This API is available since Optique 0.10.0.*

Many CLI tools support configuration files that provide default values for
options. The *@optique/config* package provides type-safe config file
integration with automatic fallback handling.

### Basic setup with schema validation

Use a Standard Schema-compatible library (Zod, Valibot, ArkType, etc.) to
define your config structure:

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { object } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { runAsync } from "@optique/run";

// Define the config schema
const configSchema = z.object({
  host: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  debug: z.boolean().optional(),
});

// Create a config context
const configContext = createConfigContext({ schema: configSchema });

// Build the parser with config bindings
const parser = object({
  config: optional(option("-c", "--config", string())),
  host: bindConfig(option("-h", "--host", string()), {
    context: configContext,
    key: "host",
    default: "localhost",
  }),
  port: bindConfig(option("-p", "--port", integer()), {
    context: configContext,
    key: "port",
    default: 3000,
  }),
  debug: bindConfig(option("-d", "--debug"), {
    context: configContext,
    key: "debug",
    default: false,
  }),
});

// Run with config file support via contexts
const result = await runAsync(parser, {
  contexts: [configContext],
  getConfigPath: (parsed) => parsed.config,
});

// result.host: CLI > config.json > "localhost"
// result.port: CLI > config.json > 3000
~~~~

The `bindConfig()` function wraps a parser to provide fallback behavior:

1.  *CLI argument* (highest priority): User-provided command-line value
2.  *Config file value*: Loaded from config file if path was specified
3.  *Default value*: Specified in `bindConfig()` options
4.  *Error*: If none of the above and no default

### Type-safe config path extraction

The `getConfigPath` option is type-checked against your parser's result type.
TypeScript ensures you're accessing a field that actually exists:

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext } from "@optique/config";
import { object } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { runAsync } from "@optique/run";

const configSchema = z.object({ host: z.string().optional() });
const configContext = createConfigContext({ schema: configSchema });

const parser = object({
  configFile: optional(option("--config-file", string())),
  host: option("--host", string()),
});

const result = await runAsync(parser, {
  contexts: [configContext],
  // `parsed` is typed as { configFile?: string; host: string }
  getConfigPath: (parsed) => parsed.configFile,
});
~~~~

### Nested config values

For nested config structures, use a function instead of a key:

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";

const configSchema = z.object({
  server: z.object({
    host: z.string(),
    port: z.number(),
  }).optional(),
  database: z.object({
    connectionString: z.string(),
  }).optional(),
});

const configContext = createConfigContext({ schema: configSchema });

// Access nested values with a function
const hostParser = bindConfig(option("--host", string()), {
  context: configContext,
  key: (config) => config.server?.host,
  default: "localhost",
});

const dbParser = bindConfig(option("--db", string()), {
  context: configContext,
  key: (config) => config.database?.connectionString,
});
~~~~

### Custom config file formats

By default, config files are parsed as JSON. For YAML, TOML, or other formats,
provide a custom file parser to `createConfigContext()`:

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { runAsync } from "@optique/run";
import { parse as parseYaml } from "yaml";

const configSchema = z.object({
  host: z.string(),
  port: z.number(),
});

// Pass fileParser when creating the context
const configContext = createConfigContext({
  schema: configSchema,
  fileParser: (contents) => parseYaml(new TextDecoder().decode(contents)),
});

const parser = object({
  config: option("--config", string()),
  host: bindConfig(option("--host", string()), {
    context: configContext,
    key: "host",
    default: "localhost",
  }),
  port: bindConfig(option("--port", integer()), {
    context: configContext,
    key: "port",
    default: 3000,
  }),
});

const result = await runAsync(parser, {
  contexts: [configContext],
  getConfigPath: (parsed) => parsed.config,
});
~~~~

### Combining with environment variables

Use `bindEnv()` from *@optique/env* together with `bindConfig()` to create
a four-level fallback chain. The nesting order determines priority:
`bindEnv(bindConfig(option(...)))` gives CLI > env > config > default.

~~~~ typescript twoslash
import { z } from "zod";
import { createConfigContext, bindConfig } from "@optique/config";
import { bindEnv, createEnvContext } from "@optique/env";
import { object } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { runAsync } from "@optique/run";

const configSchema = z.object({
  host: z.string().optional(),
  port: z.number().optional(),
});

const envContext = createEnvContext({ prefix: "MYAPP_" });
const configContext = createConfigContext({ schema: configSchema });

const parser = object({
  config: optional(option("-c", "--config", string())),
  // Priority: CLI > env var > config file > default
  host: bindEnv(
    bindConfig(option("-h", "--host", string()), {
      context: configContext,
      key: "host",
      default: "localhost",
    }),
    { context: envContext, key: "HOST", parser: string() },
  ),
  port: bindEnv(
    bindConfig(option("-p", "--port", integer()), {
      context: configContext,
      key: "port",
      default: 3000,
    }),
    { context: envContext, key: "PORT", parser: integer() },
  ),
});

const result = await runAsync(parser, {
  contexts: [envContext, configContext],
  getConfigPath: (parsed) => parsed.config,
});
~~~~

For more details, see the
[environment variable guide](./integrations/env.md) and
[config file integration guide](./integrations/config.md).


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


Pass-through options for wrapper CLIs
-------------------------------------

*This API is available since Optique 0.8.0.*

When building wrapper tools that need to forward unknown options to an
underlying command, the
[`passThrough()`](./concepts/primitives.md#passthrough-parser) parser captures
unrecognized options without validation errors.

### Basic wrapper pattern

A common use case is wrapping another CLI tool while adding your own options:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { argument, option, passThrough } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { run } from "@optique/run";

const parser = object({
  debug: option("--debug"),
  config: option("-c", "--config", string({ metavar: "FILE" })),
  extraOpts: passThrough(),
});

const result = run(parser);
//    ^?








// Use result.extraOpts to pass through to the underlying tool
~~~~

The key insight is that `passThrough()` has the *lowest priority* (−10), so
your explicit options are always matched first. Only truly unrecognized options
are captured in the pass-through array.

### Subcommand-specific pass-through

For tools that delegate entire subcommands to other processes:

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import { argument, command, constant, option, passThrough } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { run } from "@optique/run";

const parser = or(
  // Local command with known options
  command("local", object({
    action: constant("local"),
    port: option("-p", "--port", integer()),
    host: option("-h", "--host", string()),
  })),
  // Exec command passes everything through
  command("exec", object({
    action: constant("exec"),
    container: argument(string({ metavar: "CONTAINER" })),
    args: passThrough({ format: "greedy" }),
  })),
);

const result = run(parser);

if (result.action === "exec") {
  // result.args contains all remaining tokens
  // Pass them to the container: ["--verbose", "-it", "bash"]
}
~~~~

The `"greedy"` format is crucial here: once the container name is captured, all
remaining tokens (including those that look like options) go into `args`.

### Choosing the right format

The `passThrough()` parser supports three capture formats:

`"equalsOnly"` (default)
:   Only captures `--opt=val` format. The safest choice when you need to
    distinguish between options and positional arguments:

    ~~~~ typescript twoslash
    import { passThrough } from "@optique/core/primitives";
    // ---cut-before---
    const parser = passThrough({ format: "equalsOnly" });
    // Captures: --foo=bar, --baz=123
    // Rejects: --foo bar, --verbose
    ~~~~

`"nextToken"`
:   Captures `--opt val` as two tokens when the value doesn't look like
    an option. Good for wrapping tools that use space-separated values:

    ~~~~ typescript twoslash
    import { passThrough } from "@optique/core/primitives";
    // ---cut-before---
    const parser = passThrough({ format: "nextToken" });
    // --foo bar → ["--foo", "bar"]
    // --foo --bar → ["--foo", "--bar"] (--bar is a separate option)
    ~~~~

`"greedy"`
:   Captures *all* remaining tokens. Use for proxy/wrapper tools where
    everything after a certain point should pass through:

    ~~~~ typescript twoslash
    import { passThrough } from "@optique/core/primitives";
    // ---cut-before---
    const parser = passThrough({ format: "greedy" });
    // git commit -m "message" → ["git", "commit", "-m", "message"]
    ~~~~

> [!CAUTION]
> The `"greedy"` format can shadow explicit parsers. Place it carefully,
> typically as the last field in a subcommand-specific `object()`.


Advanced patterns
-----------------

The cookbook patterns can be combined to create sophisticated CLI interfaces:

~~~~ typescript twoslash
import { merge, object } from "@optique/core/constructs";
import { multiple, withDefault } from "@optique/core/modifiers";
import { argument, command, constant, flag, option } from "@optique/core/primitives";
import { string, type ValueParser,
         type ValueParserResult } from "@optique/core/valueparser";
function keyValue(separator = "="): ValueParser<"sync", [string, string]> {
  return {
    $mode: "sync",
    metavar: `KEY${separator}VALUE`,
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


Shell completion patterns
-------------------------

*This API is available since Optique 0.6.0.*

Modern CLI applications benefit from intelligent shell completion that helps
users discover available options and reduces typing errors. Optique provides
built-in completion support that integrates seamlessly with your parser
definitions.

### Basic completion setup

Enable completion for any CLI application by adding the `completion` option:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { argument, option } from "@optique/core/primitives";
import { string, choice } from "@optique/core/valueparser";
import { run } from "@optique/run";

const parser = object({
  format: option("-f", "--format", choice(["json", "yaml", "xml"])),
  output: option("-o", "--output", string({ metavar: "FILE" })),
  verbose: option("-v", "--verbose"),
  input: argument(string({ metavar: "INPUT" })),
});

const config = run(parser, { completion: "both" });
~~~~

This automatically provides intelligent completion for:

 -  Option names: `--format`, `--output`, `--verbose`
 -  Choice values: `--format json`, `--format yaml`
 -  Help integration: `--help` is included in completions

### Custom value parser suggestions

Create value parsers with domain-specific completion suggestions:

~~~~ typescript twoslash
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import type { Suggestion } from "@optique/core/parser";
import { message } from "@optique/core/message";

// Custom parser for log levels with intelligent completion
function logLevel(): ValueParser<"sync", string> {
  const levels = ["error", "warn", "info", "debug", "trace"];

  return {
    $mode: "sync",
    metavar: "LEVEL",
    parse(input: string): ValueParserResult<string> {
      if (levels.includes(input.toLowerCase())) {
        return { success: true, value: input.toLowerCase() };
      }
      return {
        success: false,
        // Note: For proper formatting of choice lists, see the "Formatting choice lists"
        // section in the Concepts guide on Messages
        error: message`Invalid log level: ${input}. Valid levels: ${levels.join(", ")}.`,
      };
    },
    format(value: string): string {
      return value;
    },
    *suggest(prefix: string): Iterable<Suggestion> {
      for (const level of levels) {
        if (level.startsWith(prefix.toLowerCase())) {
          yield {
            kind: "literal",
            text: level,
            description: message`Set log level to ${level}`
          };
        }
      }
    },
  };
}
~~~~

### Multi-command CLI with rich completion

Complex CLI tools with subcommands benefit greatly from completion:

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { argument, command, constant, option } from "@optique/core/primitives";
import { string, choice } from "@optique/core/valueparser";
import { run } from "@optique/run";

const serverCommand = command("server", object({
  action: constant("server"),
  port: optional(option("-p", "--port", string())),
  host: optional(option("-h", "--host", string())),
  env: optional(option("--env", choice(["dev", "staging", "prod"]))),
}));

const buildCommand = command("build", object({
  action: constant("build"),
  target: argument(choice(["web", "mobile", "desktop"])),
  mode: optional(option("--mode", choice(["debug", "release"]))),
  output: optional(option("-o", "--output", string())),
}));

const parser = or(serverCommand, buildCommand);

const config = run(parser, { completion: "both" });
~~~~

This provides completion for:

 -  Command names: `server`, `build`
 -  Command-specific options: `--port` only for server, `--mode` only for build
 -  Enum values: `--env dev`, `--mode release`
 -  Context-aware suggestions based on the current command

### File path completion integration

For file and directory arguments, Optique delegates to native shell completion:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { argument, option } from "@optique/core/primitives";
import { path } from "@optique/run/valueparser";
import { run } from "@optique/run";

const parser = object({
  config: option("-c", "--config", path({
    extensions: [".json", ".yaml"],
    type: "file"
  })),
  outputDir: option("-o", "--output", path({
    type: "directory"
  })),
  input: argument(path({
    extensions: [".md", ".txt"],
    type: "file"
  })),
});

const config = run(parser, { completion: "both" });
~~~~

The `path()` value parser automatically provides:

 -  Native file system completion using shell built-ins
 -  Extension filtering (*.json*, *.yaml* files only)
 -  Type filtering (files vs directories)
 -  Proper handling of spaces, special characters, and symlinks

### Installation and usage

Once completion is enabled, users install it with simple commands:

::: code-group

~~~~ bash [Bash]
# Generate and install Bash completion
myapp completion bash > ~/.bashrc.d/myapp.bash
source ~/.bashrc.d/myapp.bash
~~~~

~~~~ zsh [zsh]
# Generate and install zsh completion
myapp completion zsh > ~/.zsh/completions/_myapp
~~~~

~~~~ fish [fish]
# Generate and install fish completion
myapp completion fish > ~/.config/fish/completions/myapp.fish
~~~~

~~~~ powershell [PowerShell]
# Generate and install PowerShell completion
myapp completion pwsh > myapp-completion.ps1
~~~~

:::

The completion system leverages the same parser structure used for argument
validation, ensuring suggestions always stay synchronized with your CLI's
actual behavior without requiring separate maintenance.

Users then benefit from intelligent completion:

~~~~ bash
myapp <TAB>                    # Shows: server, build, help
myapp server --<TAB>           # Shows: --port, --host, --env, --help
myapp server --env <TAB>       # Shows: dev, staging, prod
myapp build <TAB>              # Shows: web, mobile, desktop
~~~~


Hidden and deprecated options
-----------------------------

As CLIs evolve, you may need to deprecate old options while maintaining
backward compatibility, or add internal debugging options that shouldn't
appear in user-facing documentation. The `hidden` option lets you keep
parsers functional while controlling visibility:

 -  `hidden: true`: hide from usage, help entries, completions, and
    “Did you mean?” suggestions
 -  `hidden: "usage"`: hide from usage only
 -  `hidden: "doc"`: hide from help entries only

### Deprecation pattern

When renaming or replacing options, keep the old form working but hide it:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const parser = object({
  // The new, preferred option name
  output: optional(option("-o", "--output", string(), {
    description: message`Output file path`,
  })),
  // Legacy option name - still works but hidden from help
  outputLegacy: optional(option("--out", string(), {
    hidden: true,
  })),
});
// Later, merge the values: output ?? outputLegacy
~~~~

This approach ensures existing scripts using `--out` continue to work
while new users learn the preferred `--output` form.

### Internal debugging options

Add options for debugging or development that shouldn't clutter the help:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { withDefault } from "@optique/core/modifiers";
import { flag, option } from "@optique/core/primitives";
import { integer } from "@optique/core/valueparser";

const parser = object({
  verbose: flag("-v", "--verbose", {
    description: message`Enable verbose output`,
  }),
  // Developer-only options
  traceRequests: flag("--trace-requests", { hidden: true }),
  mockDelay: withDefault(option("--mock-delay", integer(), { hidden: true }), 0),
});
~~~~

Developers who know about these options can use them, but they won't
appear in `--help` output or shell completions.

### Experimental features

Hide features that aren't ready for general use:

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import { argument, command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const commands = or(
  command("build", object({
    type: constant("build"),
    target: option("--target", string()),
  })),
  command("test", object({
    type: constant("test"),
    pattern: argument(string()),
  })),
  // Experimental - not yet documented
  command("experimental-watch", object({
    type: constant("watch"),
    paths: argument(string()),
  }), { hidden: true }),
);
~~~~

Hidden commands work normally but don't appear in command listings or
get suggested in “Did you mean?” errors.

   - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -

The patterns in this cookbook provide the building blocks for creating
CLI interfaces that are both powerful and type-safe, with clear separation
between parsing logic, type safety, and user experience.

<!-- cSpell: ignore myapp -->
