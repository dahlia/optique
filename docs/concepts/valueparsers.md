---
description: >-
  Value parsers convert string arguments into strongly-typed values with
  validation, supporting built-in types like integers, URLs, and UUIDs,
  plus custom parser creation.
---

Value parsers
=============

Value parsers are the specialized components responsible for converting raw
string input from command-line arguments into strongly-typed values.
While command-line arguments are always strings, your application needs them as
numbers, URLs, file paths, or other typed values. Value parsers handle this
critical transformation and provide validation at parse time.

The philosophy behind Optique's value parsers is “fail fast, fail clearly.”
Rather than letting invalid data flow through your application and cause
mysterious errors later, value parsers validate input immediately when parsing
occurs. When validation fails, they provide clear, actionable error messages
that help users understand what went wrong and how to fix it.

Every value parser implements the `ValueParser<M, T>` interface, which defines
how to parse strings into values of type `T` and how to format those values
back into strings for help text. This consistent interface makes value parsers
composable and allows you to create custom parsers that integrate seamlessly
with Optique's type system.

### Parser catalog

| Parser                           | Module              | Return type                    | Description                                         |
| -------------------------------- | ------------------- | ------------------------------ | --------------------------------------------------- |
| `string()`                       | *@optique/core*     | `string`                       | Any string, with optional pattern validation        |
| `keyValue()`                     | *@optique/core*     | readonly `[key, value]`        | Key–value pair such as `KEY=VALUE`                  |
| `integer()`                      | *@optique/core*     | `number` or `bigint`           | Integer with range validation                       |
| `float()`                        | *@optique/core*     | `number`                       | Floating-point number                               |
| `fileSize()`                     | *@optique/core*     | `number` or `bigint`           | Human-readable data size (bytes)                    |
| `color()`                        | *@optique/core*     | `Color`                        | CSS color (hex, rgb, hsl, or named)                 |
| `choice()`                       | *@optique/core*     | string or number literal union | Enumerated values                                   |
| `firstOf()`                      | *@optique/core*     | union of constituent types     | First-match union of value parsers                  |
| `json()`                         | *@optique/core*     | `Json`                         | Any JSON value, with optional root type restriction |
| `cron()`                         | *@optique/core*     | `CronExpression`               | Cron schedule expression                            |
| `url()`                          | *@optique/core*     | `URL`                          | URL with protocol filtering                         |
| `locale()`                       | *@optique/core*     | `Intl.Locale`                  | BCP 47 locale identifier                            |
| `uuid()`                         | *@optique/core*     | `string`                       | UUID with RFC 9562 validation                       |
| `semVer()`                       | *@optique/core*     | `SemVerString` or `SemVer`     | Semantic Versioning 2.0.0                           |
| `port()`                         | *@optique/core*     | `number` or `bigint`           | TCP/UDP port number                                 |
| `ipv4()`                         | *@optique/core*     | `string`                       | IPv4 address with restrictions                      |
| `ipv6()`                         | *@optique/core*     | `string`                       | IPv6 address                                        |
| `ip()`                           | *@optique/core*     | `string`                       | IPv4 or IPv6 address                                |
| `cidr()`                         | *@optique/core*     | `string`                       | CIDR notation                                       |
| `hostname()`                     | *@optique/core*     | `string`                       | DNS hostname                                        |
| `domain()`                       | *@optique/core*     | `string`                       | DNS domain with TLD validation                      |
| `email()`                        | *@optique/core*     | `string`                       | Email address                                       |
| `socketAddress()`                | *@optique/core*     | `{ host, port }`               | Host:port pair                                      |
| `portRange()`                    | *@optique/core*     | `{ start, end }`               | Port range                                          |
| `macAddress()`                   | *@optique/core*     | `string`                       | MAC-48 address                                      |
| `path()`                         | *@optique/run*      | `string`                       | File/directory path with existence checks           |
| `gitBranch()`, `gitTag()`, etc.  | *@optique/git*      | `string`                       | [Git references](../integrations/git.md)            |
| `instant()`, `plainDate()`, etc. | *@optique/temporal* | Temporal types                 | [Temporal dates/times](../integrations/temporal.md) |
| `zod()`                          | *@optique/zod*      | schema output                  | [Zod schema](../integrations/zod.md)                |
| `valibot()`                      | *@optique/valibot*  | schema output                  | [Valibot schema](../integrations/valibot.md)        |


`string()` parser
-----------------

The `string()` parser is the most basic value parser—it accepts any string
input and performs optional pattern validation. While all command-line arguments
start as strings, the `string()` parser provides a way to explicitly document
that you want string values and optionally validate their format.

~~~~ typescript twoslash
import { string } from "@optique/core/valueparser";

// Basic string parser
const name = string();

// String with custom metavar for help text
const hostname = string({ metavar: "HOST" });

// String with pattern validation
const identifier = string({
  metavar: "ID",
  pattern: /^[a-zA-Z][a-zA-Z0-9_]*$/
});
~~~~

### Pattern validation

The optional `pattern` parameter accepts a regular expression that the input
must match:

~~~~ typescript twoslash
import { string } from "@optique/core/valueparser";
// ---cut-before---
// Email-like pattern
const email = string({
  pattern: /^[^@]+@[^@]+\.[^@]+$/,
  metavar: "EMAIL"
});

// Semantic version pattern
const version = string({
  pattern: /^\d+\.\d+\.\d+$/,
  metavar: "VERSION"
});
~~~~

When pattern validation fails, the parser provides a clear error message
indicating what pattern was expected:

~~~~ bash
$ myapp --version 1.2
Error: Expected a string matching pattern ^\d+\.\d+\.\d+$, but got 1.2.
~~~~

The `string()` parser uses `"STRING"` as its default metavar, which appears in
help text to indicate what kind of input is expected.


`keyValue()` parser
-------------------

*This API is available since Optique 1.1.0.*

The `keyValue()` parser accepts a single command-line value shaped like
`KEY=VALUE` and returns a readonly tuple.  It is useful for Docker-style
environment variables, Kubernetes or Helm `--set` values, build-time defines,
labels, and other repeated configuration overrides.

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { map, multiple } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { keyValue } from "@optique/core/valueparser";

const parser = object({
  env: map(
    multiple(option("-e", "--env", keyValue())),
    (pairs) => Object.fromEntries(pairs),
  ),
  set: map(
    multiple(option("--set", keyValue())),
    (pairs) => Object.fromEntries(pairs),
  ),
});
~~~~

By default, `keyValue()`:

 -  uses `=` as the separator;
 -  rejects input without the separator;
 -  rejects an empty key such as `=VALUE`;
 -  allows an empty value such as `KEY=`;
 -  splits repeated separators at the first separator, so `A=B=C` becomes
    `["A", "B=C"]`;
 -  does not trim whitespace.

Use `separator` for other key–value styles and `split: "last"` when the last
separator should divide the key from the value:

~~~~ typescript twoslash
import { keyValue } from "@optique/core/valueparser";

const label = keyValue({ separator: ":" });
const override = keyValue({ split: "last" });

const labelResult = label.parse("app:web");
labelResult;
// ^?

const overrideResult = override.parse("image.repository=ghcr.io=example/app");
// Parsed as ["image.repository=ghcr.io", "example/app"].
overrideResult;
// ^?
~~~~

The `key` and `value` options accept normal value parsers.  Their result types
are preserved in the tuple, so a constrained key or numeric value remains
visible to TypeScript:

~~~~ typescript twoslash
import { choice, integer, keyValue } from "@optique/core/valueparser";

const portSetting = keyValue({
  key: choice(["port"] as const),
  value: integer({ min: 1, max: 65535 }),
});

const parsed = portSetting.parse("port=5432");
if (parsed.success) {
  parsed.value;
  //     ^?
}
~~~~

For string policies, use child `string()` parsers:

~~~~ typescript twoslash
import { keyValue, string } from "@optique/core/valueparser";

const label = keyValue({
  key: string({
    metavar: "KEY",
    pattern: /^[a-z][a-z0-9_.-]*$/,
  }),
  value: string({ metavar: "VALUE" }),
});
~~~~

`format([key, value])` formats both sides through their child parsers before
joining them with the separator.  Completion suggestions are composed when
the child parsers provide suggestions: key suggestions get the separator
appended, and value suggestions are prefixed with the already typed key and
separator.

Shell escaping and quote handling happen before Optique receives arguments.
For example, a shell may pass `--set name="hello world"` to Optique as one
token whose value is `name=hello world`; `keyValue()` then splits that token.
It does not parse dotenv files, nested paths, or shell syntax.


`integer()` parser
------------------

The `integer()` parser converts string input to numeric values with validation.
It supports both regular JavaScript numbers (safe up to
`Number.MAX_SAFE_INTEGER`) and arbitrary-precision `bigint` values for very
large integers.

### Number mode (default)

By default, `integer()` returns JavaScript numbers and validates that input
contains only digits:

~~~~ typescript twoslash
import { integer } from "@optique/core/valueparser";

// Basic integer
const count = integer();

// Integer with bounds checking
const port = integer({ min: 1, max: 0xffff });

// Integer with custom metavar
const timeout = integer({ min: 0, metavar: "SECONDS" });
~~~~

### Bigint mode

For very large integers that exceed JavaScript's safe integer range,
specify `type: "bigint"`:

~~~~ typescript twoslash
import { integer } from "@optique/core/valueparser";
// ---cut-before---
// BigInt integer with bounds
const largeNumber = integer({
  type: "bigint",
  min: 0n,
  max: 999999999999999999999n
});
~~~~

### Validation and error messages

The `integer()` parser provides detailed validation:

 -  *Format validation*: Ensures input contains only digits with an optional
    leading `-`
 -  *Range validation*: Enforces minimum and maximum bounds
 -  *Safe integer protection*: Rejects values outside `Number.MIN_SAFE_INTEGER`
    to `Number.MAX_SAFE_INTEGER` (use `type: "bigint"` for larger values)

~~~~ bash
$ myapp --port "abc"
Error: Expected a valid integer, but got abc.

$ myapp --port "99999"
Error: Expected a value less than or equal to 65,535, but got 99999.

$ myapp --count "9007199254740993"
Error: Expected a safe integer between -9,007,199,254,740,991 and
9,007,199,254,740,991, but got 9007199254740993.
Use type: "bigint" for large values.
~~~~

The parser uses `"INTEGER"` as its default metavar.


`float()` parser
----------------

The `float()` parser handles floating-point numbers with comprehensive
validation options. It recognizes standard decimal notation, scientific
notation, and optionally special values like `NaN` and `Infinity`.

~~~~ typescript twoslash
import { float } from "@optique/core/valueparser";

// Basic float
const rate = float();

// Float with bounds
const percentage = float({ min: 0.0, max: 100.0 });

// Float allowing special values
const scientific = float({
  allowNaN: true,
  allowInfinity: true,
  metavar: "NUMBER"
});
~~~~

#### Supported formats

The `float()` parser recognizes multiple numeric formats:

 -  *Integers*: `42`, `-17`
 -  *Decimals*: `3.14`, `-2.5`, `.5`, `42.`
 -  *Scientific notation*: `1.23e10`, `5.67E-4`, `1e+5`
 -  *Special values*: `NaN`, `Infinity`, `-Infinity` (when allowed)

#### Special values

By default, `NaN` and `Infinity` are not allowed, which prevents accidental
acceptance of these values. Enable them explicitly when they're meaningful
for your use case:

~~~~ typescript twoslash
import { float } from "@optique/core/valueparser";
// ---cut-before---
// Mathematics application that handles infinite limits
const limit = float({
  allowInfinity: true,
  metavar: "LIMIT"
});

// Statistical application that handles missing data
const value = float({
  allowNaN: true,
  allowInfinity: true,
  metavar: "VALUE"
});
~~~~

The parser uses `"NUMBER"` as its default metavar and provides clear error
messages for invalid formats and out-of-range values.


`fileSize()` parser
-------------------

*This API is available since Optique 1.1.0.*

The `fileSize()` parser converts human-readable data size strings into a
`number` representing the equivalent byte count.  It is useful for CLI tools
that accept storage limits, upload caps, log rotation thresholds, or similar
size values.

~~~~ typescript twoslash
import { fileSize } from "@optique/core/valueparser";

// Parses "10MB", "1.5GiB", "512B", etc. → number (bytes)
const maxUpload = fileSize();

// Custom metavar shown in help text
const cacheSize = fileSize({ metavar: "SIZE" });
~~~~

### Supported units

The parser accepts both SI (decimal) and IEC (binary) unit suffixes,
matched case-insensitively:

| Unit | Bytes (SI/default)     | Unit | Bytes (IEC)           |
| ---- | ---------------------- | ---- | --------------------- |
| B    | 1                      |      |                       |
| KB   | 1 000                  | KiB  | 1 024                 |
| MB   | 1 000 000              | MiB  | 1 048 576             |
| GB   | 1 000 000 000          | GiB  | 1 073 741 824         |
| TB   | 1 000 000 000 000      | TiB  | 1 099 511 627 776     |
| PB   | 10^15                  | PiB  | 2^50                  |
| EB   | 10^18 [^filesize-safe] | EiB  | 2^60 [^filesize-safe] |

Unit suffixes are matched case-insensitively: `"1kb"`, `"1KB"`, and `"1Kb"`
are all treated as 1 000 bytes.  Optional whitespace between the number and
unit is also accepted (`"1 MB"`).

[^filesize-safe]: In `number` mode (the default), the result must be a safe
                  integer (≤ `Number.MAX_SAFE_INTEGER` ≈ 9 × 10^15). Values in
                  the `EB`/`EiB` range and values above roughly 9 PB or 8 PiB
                  are therefore rejected. Use `type: "bigint"` to lift this
                  restriction—see the [bigint mode](#bigint-mode) section.

### Default unit

When a bare number is provided without a unit, `fileSize()` rejects it by
default.  Use the `defaultUnit` option to assume a unit in that case:

~~~~ typescript twoslash
import { fileSize } from "@optique/core/valueparser";
// ---cut-before---
// "100" → 100 000 000 bytes; "100MB" → still 100 000 000 bytes
const parser = fileSize({ defaultUnit: "MB" });
~~~~

### Allowing negative values

By default, negative values are rejected.  Pass `allowNegative: true` to
accept them:

~~~~ typescript twoslash
import { fileSize } from "@optique/core/valueparser";
// ---cut-before---
const delta = fileSize({ allowNegative: true });
~~~~

### SI-as-binary mode

Some tools use `KB`, `MB`, `GB` etc. to mean powers of 1 024 rather than
1 000—a widespread but technically incorrect convention.  Enable
`siAsBinary: true` to match that behaviour:

~~~~ typescript twoslash
import { fileSize } from "@optique/core/valueparser";
// ---cut-before---
// "1KB" → 1 024 bytes instead of 1 000
const legacySize = fileSize({ siAsBinary: true });
~~~~

IEC suffixes (`KiB`, `MiB`, …) are unaffected by this option and always
use powers of 1 024.

### Bigint mode

By default, `fileSize()` returns `number`, which cannot represent byte counts
above roughly 9 PB exactly.  Pass `type: "bigint"` to get a `bigint` result
instead—this lifts the safe-integer restriction and makes `EB`/`EiB` values
usable:

~~~~ typescript twoslash
import { fileSize } from "@optique/core/valueparser";
// ---cut-before---
const diskLimit = fileSize({ type: "bigint" });
// "1EB" → 1_000_000_000_000_000_000n
// "1EiB" → 1_152_921_504_606_846_976n
~~~~

All options (`allowNegative`, `defaultUnit`, `siAsBinary`, `metavar`) work
the same way in bigint mode.

### Error messages

~~~~ bash
$ myapp --max-upload "abc"
Error: Expected a file size like 10MB or 1.5GiB, but got abc.

$ myapp --max-upload "100"
Error: Expected a file size like 10MB or 1.5GiB, but got 100.

$ myapp --max-upload "-1MB"
Error: Expected a non-negative file size, but got -1MB.
~~~~

The parser uses `"SIZE"` as its default metavar.


`color()` parser
----------------

*This API is available since Optique 1.1.0.*

The `color()` parser converts CSS color strings into a structured `Color`
object with normalized `r`, `g`, `b`, and `a` fields.  It is useful for CLI
tools that accept theme colors, background colors, or any other color
configuration from users.

~~~~ typescript twoslash
import { color } from "@optique/core/valueparser";

// Accepts any CSS color notation
const background = color();

// Custom metavar shown in help text
const fg = color({ metavar: "FG_COLOR" });
~~~~

### Supported formats

The parser accepts four CSS color notations by default:

| Format  | Examples                                       |
| ------- | ---------------------------------------------- |
| `hex`   | `#f00`, `#ff0000`, `#f00f`, `#ff0000ff`        |
| `rgb`   | `rgb(255, 0, 0)`, `rgba(255, 0, 0, 0.5)`       |
| `hsl`   | `hsl(0, 100%, 50%)`, `hsla(0, 100%, 50%, 0.5)` |
| `named` | `red`, `rebeccapurple`, `transparent`, …       |

Hex digits are matched case-insensitively.  The `rgb` and `hsl` function
names are also case-insensitive.  Named colors are matched
case-insensitively as well.

### Return type

The returned `Color` object has four fields:

 -  `r`, `g`, `b` — red, green, and blue channels as integers in the range
    0–255
 -  `a` — alpha channel as a float in the range 0–1, where 1 is fully opaque
    and 0 is fully transparent

~~~~ typescript twoslash
import { color, type Color } from "@optique/core/valueparser";
// ---cut-before---
const result = color().parse("#ff8000");
if (result.success) {
  const c: Color = result.value;
  // c.r === 255, c.g === 128, c.b === 0, c.a === 1
}
~~~~

### Restricting accepted formats

Use the `formats` option to limit which notations are accepted:

~~~~ typescript twoslash
import { color } from "@optique/core/valueparser";
// ---cut-before---
// Only hex notation
const hexOnly = color({ formats: ["hex"] });

// Hex and named colors
const hexOrNamed = color({ formats: ["hex", "named"] });
~~~~

### Named colors

The parser recognizes all 148 CSS Level 4 named colors, including
`transparent` (which has alpha 0) and `rebeccapurple`.  Named color lookup
is case-insensitive, so `"Red"`, `"RED"`, and `"red"` all parse to the same
value.

When shell completion is active, named colors are suggested based on the
current prefix.

### `format()` output

The `format()` method always outputs canonical lowercase hex: `#rrggbb`
when alpha is 1, or `#rrggbbaa` when alpha is less than 1.  This means
`format()` output can always be re-parsed with `formats: ["hex"]`.

### Error messages

~~~~ bash
$ myapp --bg "notacolor"
Error: Expected a CSS color like #ff0000, rgb(255, 0, 0), or red, but got notacolor.
~~~~

The parser uses `"COLOR"` as its default metavar.


`choice()` parser
-----------------

The `choice()` parser creates type-safe enumerations by restricting input to
one of several predefined string values. This is perfect for options like log
levels, output formats, or operation modes where only specific values make
sense.

~~~~ typescript twoslash
import { choice } from "@optique/core/valueparser";

// Log level choice
const logLevel = choice(["debug", "info", "warn", "error"]);

// Output format choice
const format = choice(["json", "yaml", "xml", "csv"]);

// Case-insensitive choice
const protocol = choice(["http", "https", "ftp"], {
  caseInsensitive: true
});
~~~~

### Type-safe string literals

The `choice()` parser creates exact string literal types rather than generic
`string` types, providing excellent TypeScript integration:

~~~~ typescript twoslash
import { choice } from "@optique/core/valueparser";
// ---cut-before---
const level = choice(["debug", "info", "warn", "error"]);
//    ^?
~~~~

### Case sensitivity

By default, matching is case-sensitive. Set `caseInsensitive: true` to accept
variations:

~~~~ typescript twoslash
import { choice } from "@optique/core/valueparser";
// ---cut-before---
const format = choice(["JSON", "XML"], {
  caseInsensitive: true,
  metavar: "FORMAT"
});

// Accepts: "json", "JSON", "Json", "xml", "XML", "Xml"
~~~~

### Error messages

When invalid choices are provided, the parser lists all valid options:

~~~~ bash
$ myapp --format "txt"
Error: Expected one of json, yaml, xml, csv, but got txt.
~~~~

The parser uses `"TYPE"` as its default metavar.

### Number choices

*This feature is available since Optique 0.9.0.*

The `choice()` parser also supports number literals, which is useful for options
like bit depths, port numbers, or other numeric values where only specific
values are valid:

~~~~ typescript twoslash
import { choice } from "@optique/core/valueparser";

// Bit depth choice
const bitDepth = choice([8, 10, 12]);

// Port selection
const port = choice([80, 443, 8080]);
~~~~

Number choices provide the same type-safe literal types as string choices:

~~~~ typescript twoslash
import { choice } from "@optique/core/valueparser";
// ---cut-before---
const depth = choice([8, 10, 12]);
//    ^?
~~~~

> [!NOTE]
> The `caseInsensitive` option is only available for string choices.
> TypeScript will report an error if you try to use it with number choices.

> [!TIP]
> You can display valid choices in help text by enabling the `showChoices`
> option in your runner configuration.  See the
> [choice display](./runners.md#choice-display) section in the runners guide
> for details.


`firstOf()` combinator
----------------------

*This combinator is available since Optique 1.1.0.*

Some options accept values of multiple incompatible types: a `--count` that
takes either a number or the literal `auto`, an `--output` that is either a
file path or `-` for standard output, a `--log-level` that accepts both named
levels and numeric verbosity.  The `firstOf()` combinator composes existing
value parsers into such a union.  It tries each constituent parser in
declaration order and returns the result of the first one that succeeds:

~~~~ typescript twoslash
import { choice, firstOf, integer } from "@optique/core/valueparser";

const count = firstOf(choice(["auto"]), integer({ min: 1 }));
//    ^?
~~~~

The result type is inferred as the union of the constituent types, so the
example above produces `"auto" | number` without manual type annotations or
hand-written parsing logic.  Each constituent keeps its own validation and
error messages, which is the main advantage over parsing with `string()` and
converting the result in a `map()`.

### Declaration order

The first constituent that accepts the input wins.  When inputs overlap (for
example, `choice(["1"])` and `integer()` both accept the input `1`), the
earlier constituent claims them, so put more specific parsers first:

~~~~ typescript twoslash
import { choice, firstOf, string } from "@optique/core/valueparser";
// ---cut-before---
// Correct: the specific alias list comes before the catch-all string()
const target = firstOf(choice(["production", "staging"]), string());

// Wrong: string() accepts everything, so choice() never gets a chance
const broken = firstOf(string(), choice(["production", "staging"]));
~~~~

### Help text

The default metavar joins the constituent metavars with `|` (for the example
above, `TYPE|INTEGER`), and the `metavar` option overrides it:

~~~~ typescript twoslash
import { choice, firstOf, integer } from "@optique/core/valueparser";
// ---cut-before---
const count = firstOf(choice(["auto"]), integer({ min: 1 }), {
  metavar: "COUNT",
});
~~~~

Completion suggestions are merged across all constituents that provide them.
When every constituent enumerates its valid values (e.g. a `firstOf()` of
multiple `choice()` parsers), the merged list is also exposed for the
`showChoices` display option; if any constituent is open-ended, no choice
list is shown.

### Dynamic parser lists

The variadic form requires at least two statically known arguments.  When
the constituents are built dynamically, pass them as a single array
instead:

~~~~ typescript twoslash
import {
  choice,
  firstOf,
  integer,
  type ValueParser,
} from "@optique/core/valueparser";
// ---cut-before---
const parsers: ValueParser<"sync", "auto" | number>[] = [
  choice(["auto"]),
  integer({ min: 1 }),
];
const count = firstOf(parsers, { metavar: "COUNT" });
~~~~

The array must still contain at least two parsers; shorter arrays are
rejected with a `TypeError` at construction time.

### Error messages

When every constituent fails, the error lists each constituent's error on
its own line:

~~~~ bash
$ myapp --count abc
Error: `--count`: Expected one of the following:
- Expected one of "auto", but got "abc".
- Expected a valid integer, but got "abc".
~~~~

The `errors.noMatch` option replaces this combined message with a static
message or one computed from the input and the constituent errors:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import { choice, firstOf, integer } from "@optique/core/valueparser";
// ---cut-before---
const count = firstOf(choice(["auto"]), integer({ min: 1 }), {
  errors: {
    noMatch: (input) =>
      message`Expected ${"auto"} or a positive integer, but got ${input}.`,
  },
});
~~~~

> [!NOTE]
> `firstOf()` only supports synchronous value parsers.  Passing an async
> value parser (such as the Git parsers from *@optique/git*) throws a
> `TypeError` at construction time.  Dependency-derived value parsers
> (created via `deriveFrom()` or `dependency().derive()`) are rejected the
> same way: invoked through `firstOf()` they would parse with default
> dependency values instead of the ones resolved during the current parse.


`json()` parser
---------------

*This API is available since Optique 1.1.0.*

The `json()` parser accepts any well-formed JSON string and returns the
corresponding JavaScript value.  It is a lightweight way to accept structured
data on the command line without pulling in a full schema library.

~~~~ typescript twoslash
import { json } from "@optique/core/valueparser";

// Accept any JSON value
const data = json();

const result = data.parse('{"name":"Alice","age":30}');
if (result.success) {
  console.log(result.value); // { name: "Alice", age: 30 }
}
~~~~

The return type is the exported `Json` union, which covers all
JSON-serializable values:

~~~~ typescript
type Json =
  | string
  | number
  | boolean
  | null
  | { readonly [property: string]: Json }
  | readonly Json[];
~~~~

### Root type restriction

Use the `rootType` option to restrict which JSON root type is accepted.
When `rootType` is set, the TypeScript return type is narrowed accordingly:

~~~~ typescript twoslash
import { json, type Json } from "@optique/core/valueparser";

// Only accept JSON objects — return type is { readonly [p: string]: Json }
const objParser = json({ rootType: "object" });

// Only accept JSON arrays — return type is readonly Json[]
const arrParser = json({ rootType: "array" });

// Only accept JSON strings — return type is string
const strParser = json({ rootType: "string" });

// Only accept JSON numbers — return type is number
const numParser = json({ rootType: "number" });

// Only accept JSON booleans — return type is boolean
const boolParser = json({ rootType: "boolean" });

// Only accept JSON null — return type is null
const nullParser = json({ rootType: "null" });
~~~~

### Error messages

The `json()` parser provides two customizable error messages.

`invalidJson` fires when the input cannot be parsed as JSON at all:

~~~~ bash
$ myapp --config '{bad json}'
Error: `JSON`: Not a valid JSON: Expected property name or '}' in JSON at position 1
~~~~

`invalidRootType` fires when the JSON is valid but the root type does not
match `rootType`:

~~~~ bash
$ myapp --count '{"a":1}'
Error: `JSON`: Expected JSON number, but got object.
~~~~

Both messages can be overridden with a static `Message` or a callback:

~~~~ typescript twoslash
import { json } from "@optique/core/valueparser";
import { text } from "@optique/core/message";

const parser = json({
  rootType: "object",
  errors: {
    invalidJson: [text("Config must be a valid JSON string.")],
    invalidRootType: (_value, expected) =>
      [text(`Expected a JSON ${expected}.`)],
  },
});
~~~~

The parser uses `"JSON"` as its default metavar.

> [!TIP]
> For schema-validated JSON with complex shapes, consider the
> *@optique/zod* or *@optique/valibot* integrations instead.


`cron()` parser
---------------

*This API is available since Optique 1.2.0.*

The `cron()` parser validates cron schedule expressions and returns a
`CronExpression` object with one property per field.  By default it accepts
standard five-field cron expressions: minute, hour, day of month, month, and
day of week.

~~~~ typescript twoslash
import { cron } from "@optique/core/valueparser";

const schedule = cron();

const result = schedule.parse("*/5 9-17 * JAN MON-FRI");
if (result.success) {
  result.value;
  //     ^?
}
~~~~

The parser validates values, ranges, lists, and intervals in each field:

~~~~ typescript twoslash
import { cron } from "@optique/core/valueparser";
const schedule = cron();
// ---cut-before---
schedule.parse("0,15,30,45 9-17/2 1,15 JAN,MAR MON-FRI");
schedule.parse("60 * * * *");   // Error: minute is out of range
schedule.parse("* 23-0 * * *"); // Error: descending range
schedule.parse("*/0 * * * *");  // Error: interval must be positive
~~~~

Month and weekday names are accepted case-insensitively.  The original field
text is preserved in the returned object:

~~~~ typescript twoslash
import { cron } from "@optique/core/valueparser";

const result = cron().parse("0 0 * jan mon-fri");
if (result.success) {
  result.value.month;     // "jan"
  result.value.dayOfWeek; // "mon-fri"
}
~~~~

### Seconds and years

Use `seconds: true` to require a leading seconds field, and `years: true` to
require a trailing year field.  When both are enabled, the parser expects
seven fields:

~~~~ typescript twoslash
import { cron } from "@optique/core/valueparser";

const withSeconds = cron({ seconds: true });
withSeconds.parse("0 */5 9-17 * * MON-FRI");

const withYears = cron({ years: true });
withYears.parse("*/5 9-17 * * MON-FRI 2026");

const withSecondsAndYears = cron({ seconds: true, years: true });
withSecondsAndYears.parse("0 */5 9-17 * * MON-FRI 2026");
~~~~

The `year` field accepts years from 1970 through 2099.

### Return value

The returned `CronExpression` stores each validated field expression as a
string.  Its `second` and `year` properties are optional in the general type,
but the parser result type preserves the options passed to `cron()`: when
`seconds: true` is set, `second` is required, and when `years: true` is set,
`year` is required.

~~~~ typescript
interface CronExpression {
  readonly second?: string;
  readonly minute: string;
  readonly hour: string;
  readonly dayOfMonth: string;
  readonly month: string;
  readonly dayOfWeek: string;
  readonly year?: string;
}
~~~~

`format()` joins the fields back in the order configured by the parser:

~~~~ typescript twoslash
import { cron } from "@optique/core/valueparser";

const parser = cron({ seconds: true, years: true });

parser.format({
  second: "0",
  minute: "*/10",
  hour: "9-17",
  dayOfMonth: "*",
  month: "*",
  dayOfWeek: "MON-FRI",
  year: "2026",
});
// "0 */10 9-17 * * MON-FRI 2026"
~~~~

### Quartz extensions

By default, Quartz-only day-field tokens are rejected.  Set `quartz: true` to
allow common Quartz day-of-month and day-of-week extensions:

~~~~ typescript twoslash
import { cron } from "@optique/core/valueparser";

const schedule = cron({ quartz: true });

schedule.parse("0 0 ? * MON");   // no specific day of month
schedule.parse("0 0 L * *");     // last day of month
schedule.parse("0 0 LW * *");    // last weekday of month
schedule.parse("0 0 15W * *");   // weekday nearest the 15th
schedule.parse("0 0 ? * MON#2"); // second Monday
schedule.parse("0 0 ? * 5L");    // last Friday
~~~~

Quartz tokens remain limited to day fields.  Tokens such as `?` in the minute
field or `L` in the month field are still rejected.  Day-of-week suffixes such
as `5L` and `MON#2` accept weekday names or numeric days from `1` to `7`.

### Error messages

The `invalidCron` error can be customized with a static message or a callback:

~~~~ typescript twoslash
import { text } from "@optique/core/message";
import { cron } from "@optique/core/valueparser";

const schedule = cron({
  metavar: "SCHEDULE",
  errors: {
    invalidCron: [text("Schedule must be a valid cron expression.")],
  },
});
~~~~

The parser uses `"CRON"` as its default metavar.


`url()` parser
--------------

The `url()` parser validates that input is a well-formed URL and optionally
restricts the allowed protocols. The parsed result is a JavaScript [`URL`]
object with all the benefits of the native URL API.

~~~~ typescript twoslash
import { url } from "@optique/core/valueparser";

// Basic URL parser
const endpoint = url();

// URL with protocol restrictions
const apiUrl = url({
  allowedProtocols: ["https:"],
  metavar: "HTTPS_URL"
});

// URL allowing multiple protocols
const downloadUrl = url({
  allowedProtocols: ["http:", "https:", "ftp:"],
  metavar: "URL"
});
~~~~

[`URL`]: https://developer.mozilla.org/en-US/docs/Web/API/URL

### Protocol validation

The `allowedProtocols` option restricts which URL schemes are acceptable.
Protocol names must include the trailing colon:

~~~~ typescript twoslash
import { url } from "@optique/core/valueparser";
// ---cut-before---
// Only secure protocols
const secureUrl = url({
  allowedProtocols: ["https:", "wss:"]
});

// Web protocols only
const webUrl = url({
  allowedProtocols: ["http:", "https:"]
});
~~~~

### URL object benefits

The parser returns native [`URL`] objects, providing immediate access to URL
components:

~~~~ typescript twoslash
import { parse } from "@optique/core/parser";
import { argument } from "@optique/core/primitives";
import { url } from "@optique/core/valueparser";
const apiUrl = argument(url());
// ---cut-before---
const result = parse(apiUrl, ["https://api.example.com:8080/v1/users"]);
if (result.success) {
  const url = result.value;
  console.log(`Host: ${url.hostname}`);     // "api.example.com"
  console.log(`Port: ${url.port}`);        // "8080"
  console.log(`Path: ${url.pathname}`);    // "/v1/users"
  console.log(`Protocol: ${url.protocol}`); // "https:"
}
~~~~

### Validation errors

The parser provides specific error messages for different validation failures:

~~~~ bash
$ myapp --url "not-a-url"
Error: Invalid URL: not-a-url.

$ myapp --url "ftp://example.com"  # when only HTTPS allowed
Error: URL protocol ftp: is not allowed. Allowed protocols: https:.
~~~~

The parser uses `"URL"` as its default metavar.


`locale()` parser
-----------------

The `locale()` parser validates locale identifiers according to the Unicode
Locale Identifier standard ([BCP 47]). It returns [`Intl.Locale`] objects that
provide rich locale information and integrate with JavaScript's
internationalization APIs.

~~~~ typescript twoslash
import { locale } from "@optique/core/valueparser";

// Basic locale parser
const userLocale = locale();

// Locale with custom metavar
const displayLocale = locale({ metavar: "LANG" });
~~~~

[BCP 47]: https://www.rfc-editor.org/info/bcp47
[`Intl.Locale`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Locale

### Locale validation

The parser uses the native [`Intl.Locale`] constructor for validation,
ensuring compliance with international standards:

~~~~ typescript
// Valid locales
const validLocales = [
  "en",              // Language only
  "en-US",           // Language and region
  "zh-Hans-CN",      // Language, script, and region
  "de-DE-u-co-phonebk" // With Unicode extension
];

// Invalid locales will be rejected
const invalidLocales = [
  "invalid-locale",
  "en_US",           // Underscore instead of hyphen
  "toolong-language-tag-name"
];
~~~~

### Locale object benefits

The parser returns [`Intl.Locale`] objects with rich locale information:

~~~~ typescript twoslash
import { parse } from "@optique/core/parser";
import { argument } from "@optique/core/primitives";
import { locale } from "@optique/core/valueparser";
const userLocale = argument(locale());
// ---cut-before---
const result = parse(userLocale, ["zh-Hans-CN"]);
if (result.success) {
  const locale = result.value;
  console.log(`Language: ${locale.language}`); // "zh"
  console.log(`Script: ${locale.script}`);     // "Hans"
  console.log(`Region: ${locale.region}`);     // "CN"
  console.log(`Base name: ${locale.baseName}`); // "zh-Hans-CN"
}
~~~~

The parser uses `"LOCALE"` as its default metavar and provides clear error
messages for invalid locale identifiers.


`uuid()` parser
---------------

The `uuid()` parser validates [UUID] (Universally Unique Identifier) strings
according to [RFC 9562] and optionally restricts to specific UUID versions.
It returns a branded `Uuid` string type for additional type safety.

~~~~ typescript twoslash
import { uuid } from "@optique/core/valueparser";

// Basic UUID parser (strict RFC 9562 validation by default)
const id = uuid();

// UUID with version restrictions
const uuidV4 = uuid({
  allowedVersions: [4],
  metavar: "UUID_V4"
});

// UUID allowing multiple versions
const trackingId = uuid({
  allowedVersions: [1, 4, 5]
});
~~~~

[UUID]: https://en.wikipedia.org/wiki/Universally_unique_identifier
[RFC 9562]: https://www.rfc-editor.org/rfc/rfc9562

### UUID format validation

The parser validates the standard UUID format:
`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` where each `x` is a hexadecimal digit:

~~~~
# Valid UUID formats
550e8400-e29b-41d4-a716-446655440000  # Version 4
123e4567-e89b-12d3-a456-426614174000  # Version 1
6ba7b810-9dad-11d1-80b4-00c04fd430c8  # Version 1
6ba7b811-9dad-11d1-80b4-00c04fd430c8  # Version 1

# Invalid formats
550e8400-e29b-41d4-a716-44665544000   # Too short
550e8400-e29b-41d4-a716-446655440000x  # Extra character
550e8400e29b41d4a716446655440000       # Missing hyphens
~~~~

### Strict RFC 9562 validation

By default, the parser enforces strict RFC 9562 compliance:

 -  The *version digit* (index 14, 0-based) must be one of the currently
    standardized versions: 1 through 8.
 -  The *variant nibble* (index 19) must have the RFC 9562 layout (`10xx`
    in binary), meaning hex digits `8`, `9`, `a`, or `b`.

The *nil UUID* (`00000000-0000-0000-0000-000000000000`) and *max UUID*
(`ffffffff-ffff-ffff-ffff-ffffffffffff`) are accepted as special standard
values regardless of strict mode or `allowedVersions`.

Set `strict: false` to disable version and variant validation, accepting
any well-formed UUID string:

~~~~ typescript twoslash
import { uuid } from "@optique/core/valueparser";
// ---cut-before---
// Accept any UUID-like string without RFC 9562 checks
const lenient = uuid({ strict: false });
~~~~

### Version validation

When `allowedVersions` is specified, the parser checks the version digit
(index 14) and validates it matches one of the allowed versions.
This takes precedence over the strict default version set (1-8), but
variant validation still applies in strict mode:

~~~~ typescript twoslash
import { uuid } from "@optique/core/valueparser";
// ---cut-before---
const uuidV4Only = uuid({ allowedVersions: [4] });

// This will pass validation (version 4 UUID)
const validV4 = "550e8400-e29b-41d4-a716-446655440000";

// This will fail validation (version 1 UUID)
const invalidV1 = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
~~~~

### UUID type safety

The parser returns a branded `Uuid` type rather than a plain string, providing
additional compile-time safety:

~~~~ typescript twoslash
// @errors: 2345
import { parse } from "@optique/core/parser";
import { argument } from "@optique/core/primitives";
import { uuid } from "@optique/core/valueparser";
const uuidParser = argument(uuid())
// ---cut-before---
type Uuid = `${string}-${string}-${string}-${string}-${string}`;

// The branded type prevents accidental usage of regular strings as UUIDs
function processUuid(id: Uuid) {
  // Implementation here
}

const result = parse(uuidParser, ["550e8400-e29b-41d4-a716-446655440000"]);
if (result.success) {
  processUuid(result.value); // ✓ Type-safe
}

// This would cause a TypeScript error:
processUuid("not-a-uuid");  // ✗ Type error
~~~~

The parser uses `"UUID"` as its default metavar and provides specific error
messages for format violations, version mismatches, and variant violations.


`semVer()` parser
-----------------

*This API is available since Optique 1.1.0.*

The `semVer()` parser validates strings according to the
[Semantic Versioning 2.0.0] specification.  It ensures that major, minor, and
patch components are non-negative integers without leading zeros, and that
pre-release and build metadata identifiers contain only permitted characters.

~~~~ typescript twoslash
import { semVer } from "@optique/core/valueparser";

// String mode (default): returns a SemVerString template-literal type
const version = semVer();

// Object mode: returns a structured SemVer object
const structuredVersion = semVer({ type: "object" });
~~~~

[Semantic Versioning 2.0.0]: https://semver.org/

### String mode

By default, `semVer()` returns a `SemVerString` template-literal type that
covers all four valid forms of a SemVer string:

~~~~ typescript twoslash
import { semVer, type SemVerString } from "@optique/core/valueparser";

const parser = semVer();

const result = parser.parse("1.2.3-rc.1+build.42");
if (result.success) {
  const v: SemVerString = result.value;  // "1.2.3-rc.1+build.42"
}
~~~~

The output is always the canonical form with no leading `v` prefix, even when
the `v` prefix was accepted as input (see [V prefix](#v-prefix) below).

### Object mode

Pass `type: "object"` to receive a structured `SemVer` value with individual
components:

~~~~ typescript twoslash
import { semVer, type SemVer } from "@optique/core/valueparser";

const parser = semVer({ type: "object" });

const result = parser.parse("2.0.0-alpha.1+build.42");
if (result.success) {
  const v: SemVer = result.value;
  // v.major    → 2
  // v.minor    → 0
  // v.patch    → 0
  // v.preRelease → "alpha.1"
  // v.metadata   → "build.42"
}
~~~~

The `preRelease` and `metadata` fields are absent (not `undefined`) when the
input contains no pre-release or build metadata.

> [!NOTE]
> Object mode stores `major`, `minor`, and `patch` as JavaScript `number`
> values, so it rejects inputs whose version components exceed
> `Number.MAX_SAFE_INTEGER` (2⁵³ − 1 = 9,007,199,254,740,991).  In the
> unlikely event that you need to handle version numbers of that magnitude,
> use string mode instead.

### V prefix

By default the parser rejects a leading `v` character.  Set `allowPrefix: true`
to accept the common `v1.2.3` convention:

~~~~ typescript twoslash
import { semVer } from "@optique/core/valueparser";

const parser = semVer({ allowPrefix: true });

const result = parser.parse("v1.2.3");
if (result.success) {
  console.log(result.value);  // "1.2.3" — prefix stripped from output
}
~~~~

The `v` prefix is stripped from the output regardless of mode; the canonical
form never includes it.

### Error messages

When input is not a valid SemVer 2.0.0 string, the parser returns an error:

~~~~ bash
$ myapp --version "1.02.0"
Error: Expected a valid Semantic Versioning 2.0.0 string (e.g. 1.0.0), but got 1.02.0.
~~~~

Custom error messages can be provided as a static message or a function:

~~~~ typescript twoslash
import { semVer } from "@optique/core/valueparser";
import { message } from "@optique/core/message";

const parser = semVer({
  errors: {
    invalidSemVer: (input) =>
      message`${input} is not a valid version string.`,
  },
});
~~~~


`port()` parser
---------------

> [!TIP]
> See also: [`portRange()`](#portrange-parser),
> [`socketAddress()`](#socketaddress-parser).

The `port()` parser validates TCP/UDP port numbers with support for both
`number` and `bigint` types, range validation, and well-known port restrictions.
Port numbers are commonly used in network applications for server addresses,
database connections, and service configurations.

~~~~ typescript twoslash
import { port } from "@optique/core/valueparser";

// Basic port parser (1-65535)
const serverPort = port();

// Non-privileged ports only (1024-65535)
const userPort = port({ min: 1024, max: 65535 });

// Development ports
const devPort = port({ min: 3000, max: 9000 });

// Disallow well-known ports (1-1023)
const appPort = port({ disallowWellKnown: true });
~~~~

### Port number validation

By default, the `port()` parser validates that the input is a valid port number
between 1 and 65535 (the full range of valid TCP/UDP ports). You can customize
this range using the `min` and `max` options:

~~~~ typescript twoslash
import { port } from "@optique/core/valueparser";
// ---cut-before---
// Web server ports (typically 80 or 443)
const webPort = port({ min: 1, max: 65535 });

// Custom application ports
const customPort = port({ min: 8000, max: 8999 });
~~~~

### Well-known port restrictions

The `disallowWellKnown` option rejects ports 1–1023, which typically require
elevated privileges (root/administrator) to bind on most systems. This is useful
for applications that should run without special permissions:

~~~~ typescript twoslash
import { port } from "@optique/core/valueparser";
// ---cut-before---
const unprivilegedPort = port({
  disallowWellKnown: true,
  metavar: "PORT"
});
~~~~

When a well-known port is rejected, the error message explains why:

~~~~ bash
$ myapp --port 80
Error: Port 80 is a well-known port (1-1023) and may require elevated privileges.
~~~~

### Number and bigint modes

Like the `integer()` parser, `port()` supports both `number` (default) and
`bigint` types. While all valid port numbers fit safely in JavaScript's `number`
type, the `bigint` option is provided for consistency with other numeric
parsers:

~~~~ typescript twoslash
import { port } from "@optique/core/valueparser";
// ---cut-before---
// Default: returns number
const numPort = port();

// Bigint mode: returns bigint
const bigintPort = port({ type: "bigint" });
~~~~

### Common use cases

The `port()` parser is commonly used in network applications:

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { port } from "@optique/core/valueparser";
// ---cut-before---
// HTTP server
const httpPort = option("--port", port({ min: 1024 }));

// Database connection
const dbPort = option("--db-port", port());

// Redis connection (default port 6379)
const redisPort = option("--redis-port", port());
~~~~

The parser uses `"PORT"` as its default metavar and provides specific error
messages for invalid port numbers, range violations, and well-known port
restrictions.


`ipv4()` parser
---------------

> [!TIP]
> See also: [`ipv6()`](#ipv6-parser), [`ip()`](#ip-parser) (accepts both),
> [`cidr()`](#cidr-parser), [`hostname()`](#hostname-parser),
> [`socketAddress()`](#socketaddress-parser).

The `ipv4()` parser validates IPv4 addresses in dotted-decimal notation with
comprehensive filtering options for different IP address types. It is commonly
used for network configuration, server addresses, and IP allowlists/blocklists.

~~~~ typescript twoslash
import { ipv4 } from "@optique/core/valueparser";

// Basic IPv4 parser (allows all types)
const address = ipv4();

// Public IPs only (no private/loopback)
const publicIp = ipv4({
  allowPrivate: false,
  allowLoopback: false
});

// Server binding (allow 0.0.0.0 and private IPs)
const bindAddress = ipv4({
  allowZero: true,
  allowPrivate: true
});
~~~~

### IPv4 format validation

The `ipv4()` parser validates that input matches the standard IPv4 format: four
decimal octets (0-255) separated by dots (e.g., “192.168.1.1”). Each octet must
be in the valid range, and the parser strictly rejects:

 -  *Leading zeros*: “192.168.001.1” is invalid (except single “0”)
 -  *Whitespace*: Leading, trailing, or embedded spaces are rejected
 -  *Empty octets*: “192.168..1” is invalid
 -  *Out-of-range values*: Octets must be 0-255

~~~~ typescript twoslash
import { ipv4 } from "@optique/core/valueparser";
// ---cut-before---
const parser = ipv4();

// Valid IPv4 addresses
parser.parse("192.168.1.1");   // ✓
parser.parse("10.0.0.1");      // ✓
parser.parse("255.255.255.255"); // ✓
parser.parse("0.0.0.0");       // ✓

// Invalid formats
parser.parse("192.168.001.1"); // ✗ Leading zero
parser.parse("256.1.1.1");     // ✗ Octet > 255
parser.parse("192.168.1");     // ✗ Only 3 octets
parser.parse("192.168..1");    // ✗ Empty octet
~~~~

### IP address filtering

The parser provides fine-grained control over which IP address types are
accepted through boolean filter options. All filters default to `true`
(permissive), allowing you to selectively restrict specific address types:

`allowPrivate`
:   Controls private IP ranges (RFC 1918): 10.0.0.0/8, 172.16.0.0/12,
    192.168.0.0/16. Set to `false` to reject these addresses.

`allowLoopback`
:   Controls loopback addresses (127.0.0.0/8). Set to `false` to reject
    addresses like 127.0.0.1.

`allowLinkLocal`
:   Controls link-local addresses (169.254.0.0/16). Set to `false` to reject
    APIPA/link-local addresses.

`allowMulticast`
:   Controls multicast addresses (224.0.0.0/4). Set to `false` to reject
    addresses in the 224-239 range.

`allowBroadcast`
:   Controls the broadcast address (255.255.255.255). Set to `false` to reject
    the all-hosts broadcast address.

`allowZero`
:   Controls the zero address (0.0.0.0). Set to `false` to reject the “any”
    or “unspecified” address.

~~~~ typescript twoslash
import { option } from "@optique/core/primitives";
import { ipv4 } from "@optique/core/valueparser";
// ---cut-before---
// Public-facing API endpoint (no private/loopback IPs)
const publicEndpoint = option("--api-endpoint", ipv4({
  allowPrivate: false,
  allowLoopback: false,
  allowLinkLocal: false
}));

// Server binding address (allow 0.0.0.0 and private IPs)
const bindAddr = option("--bind", ipv4({
  allowZero: true,
  allowPrivate: true
}));

// Client IP address (no special addresses)
const clientIp = option("--client-ip", ipv4({
  allowZero: false,
  allowBroadcast: false,
  allowMulticast: false
}));
~~~~

### Error messages

The parser provides specific error messages for different validation failures:

~~~~ bash
$ myapp --ip "192.168.001.1"
Error: Expected a valid IPv4 address, but got 192.168.001.1.

$ myapp --public-ip "192.168.1.1"  # when private IPs are disallowed
Error: 192.168.1.1 is a private IP address.

$ myapp --endpoint "127.0.0.1"  # when loopback is disallowed
Error: 127.0.0.1 is a loopback address.

$ myapp --bind "255.255.255.255"  # when broadcast is disallowed
Error: 255.255.255.255 is the broadcast address.
~~~~

### Common use cases

The `ipv4()` parser is commonly used in network applications:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { ipv4, port } from "@optique/core/valueparser";
// ---cut-before---
// HTTP server configuration
const serverConfig = object({
  bind: option("--bind", ipv4({ allowPrivate: true })),
  port: option("--port", port({ min: 1024 }))
});

// Firewall rule configuration
const firewallRule = object({
  source: option("--source", ipv4()),
  dest: option("--dest", ipv4())
});

// DNS server configuration
const dnsConfig = option("--nameserver", ipv4({
  allowLoopback: false,  // Loopback doesn't make sense for DNS
  allowZero: false       // 0.0.0.0 not valid for nameserver
}));
~~~~

The parser uses `"IPV4"` as its default metavar and returns the normalized
IPv4 address as a string (e.g., “192.168.1.1”).


`hostname()` parser
-------------------

> [!TIP]
> See also: [`domain()`](#domain-parser), [`email()`](#email-parser),
> [`socketAddress()`](#socketaddress-parser),
> [`ipv4()`](#ipv4-parser)/[`ipv6()`](#ipv6-parser).

The `hostname()` parser validates DNS hostnames according to RFC 1123. It
supports flexible options for wildcard hostnames, underscores, localhost
filtering, and length constraints.

~~~~ typescript twoslash
import { hostname } from "@optique/core/valueparser";

// Basic hostname parser
const host = hostname();

// Allow wildcards for certificate validation
const domain = hostname({ allowWildcard: true });

// Reject localhost
const remoteHost = hostname({ allowLocalhost: false });

// Service discovery records (with underscores)
const srvRecord = hostname({ allowUnderscore: true });
~~~~

### Hostname validation rules

The parser validates hostnames according to RFC 1123:

 -  Labels are separated by dots (`.`)
 -  Each label must be 1-63 characters long
 -  Labels can contain alphanumeric characters and hyphens (`-`)
 -  Labels cannot start or end with a hyphen
 -  Total hostname length must not exceed 253 characters (by default)

For example:

 -  Valid: `"example.com"`, `"sub.example.com"`, `"server-01.local"`
 -  Invalid: `"-example.com"` (starts with hyphen), `"example..com"` (empty
    label), `"a".repeat(64) + ".com"` (label too long)

### Wildcard hostnames

By default, wildcard hostnames (starting with `*.`) are rejected. Enable them
with the `allowWildcard` option:

~~~~ typescript twoslash
import { hostname } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Allow wildcards for SSL certificate domains
const certDomain = option("--domain", hostname({ allowWildcard: true }));
~~~~

~~~~ bash
$ example --domain "*.example.com"   # Valid
$ example --domain "*.*.example.com" # Invalid: multiple wildcards not allowed
~~~~

### Underscores in hostnames

While technically invalid per RFC 1123, underscores are commonly used in some
contexts like service discovery records. Enable them with `allowUnderscore`:

~~~~ typescript twoslash
import { hostname } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Allow underscores for service discovery
const service = option("--srv", hostname({ allowUnderscore: true }));
~~~~

~~~~ bash
$ example --srv "_http._tcp.example.com"  # Valid with allowUnderscore
$ example --srv "_http._tcp.example.com"  # Invalid by default
~~~~

### Localhost filtering

The parser accepts `"localhost"` by default. Reject it with
`allowLocalhost: false`:

~~~~ typescript twoslash
import { hostname } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Require remote hosts only
const remoteHost = option("--remote", hostname({ allowLocalhost: false }));
~~~~

~~~~ bash
$ example --remote "localhost"    # Error: Hostname 'localhost' is not allowed.
$ example --remote "example.com"  # Valid
~~~~

### Length constraints

The default maximum hostname length is 253 characters (the RFC 1123 limit).
Customize it with the `maxLength` option:

~~~~ typescript twoslash
import { hostname } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Limit hostname length to 50 characters
const shortHost = option("--host", hostname({ maxLength: 50 }));
~~~~

### Custom error messages

Customize error messages for various validation failures:

~~~~ typescript twoslash
import { hostname } from "@optique/core/valueparser";
import { message, text } from "@optique/core/message";
import { option } from "@optique/core";
// ---cut-before---
const host = option("--host", hostname({
  allowWildcard: false,
  allowLocalhost: false,
  errors: {
    invalidHostname: (input) => message`Not a valid hostname: ${input}`,
    wildcardNotAllowed: message`Wildcards are forbidden`,
    localhostNotAllowed: message`Remote hosts only`,
    tooLong: (hostname, max) =>
      message`Hostname too long (max ${text(max.toString())} chars)`,
  },
}));
~~~~

### Common use cases

**Web server host configuration:**

~~~~ typescript twoslash
import { hostname } from "@optique/core/valueparser";
// ---cut-before---
// Allow localhost for local development
const serverHost = hostname({ allowLocalhost: true });
~~~~

**Remote database connections:**

~~~~ typescript twoslash
import { hostname } from "@optique/core/valueparser";
// ---cut-before---
// Require remote hosts only
const dbHost = hostname({ allowLocalhost: false });
~~~~

**SSL certificate domain validation:**

~~~~ typescript twoslash
import { hostname } from "@optique/core/valueparser";
// ---cut-before---
// Allow wildcards for certificate domains
const certDomain = hostname({ allowWildcard: true });
~~~~

The parser uses `"HOST"` as its default metavar and returns the hostname
as-is, preserving the original case.


`email()` parser
----------------

The `email()` parser validates email addresses according to simplified RFC 5322
addr-spec format. It supports display names, multiple addresses, domain
filtering, and quoted local parts for practical email validation use cases.

~~~~ typescript twoslash
import { email } from "@optique/core/valueparser";

// Basic email parser
const userEmail = email();

// Multiple comma-separated addresses
const recipients = email({ allowMultiple: true });

// Allow display names
const from = email({ allowDisplayName: true });

// Restrict to specific domains
const workEmail = email({ allowedDomains: ["company.com"] });
~~~~

### Email validation rules

The parser validates email addresses using simplified RFC 5322 rules:

 -  Format: `local-part@domain`
 -  Local part: alphanumeric characters, dots (`.`), hyphens (`-`), underscores
    (`_`), and plus signs (`+`)
 -  Domain part: valid hostname with at least one dot
 -  Quoted local parts (e.g., `"user name"@example.com`) allow spaces and
    special characters

For example:

 -  Valid: `"user@example.com"`, `"first.last@example.com"`,
    `"user+tag@mail.example.com"`
 -  Invalid: `"userexample.com"` (no @ sign), `"user@example"` (no dot in
    domain), `"user..name@example.com"` (consecutive dots)

### Display name support

By default, display names are rejected. Enable them with the `allowDisplayName`
option:

~~~~ typescript twoslash
import { email } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Allow "Name <email@example.com>" format
const from = option("--from", email({ allowDisplayName: true }));
~~~~

~~~~ bash
$ example --from "John Doe <john@example.com>"  # Valid
$ example --from "john@example.com"             # Also valid
~~~~

The parser extracts the email address and discards the display name. Both
formats (`"Name <email>"` and `Name <email>`) are accepted.

### Multiple email addresses

Parse comma-separated email lists with `allowMultiple`:

~~~~ typescript twoslash
import { email } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Accept multiple comma-separated emails
const to = option("--to", email({ allowMultiple: true }));
~~~~

~~~~ bash
$ example --to "alice@example.com,bob@example.com"  # Valid
$ example --to "alice@example.com, bob@example.com" # Whitespace trimmed
~~~~

When `allowMultiple` is `true`, the parser returns a `readonly string[]` instead
of a single `string`.

### Domain filtering

Restrict accepted email addresses to specific domains with `allowedDomains`:

~~~~ typescript twoslash
import { email } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Only accept company email addresses
const workEmail = option(
  "--email",
  email({ allowedDomains: ["company.com", "company.org"] })
);
~~~~

~~~~ bash
$ example --email "user@company.com"  # Valid
$ example --email "user@gmail.com"    # Error: domain not allowed
~~~~

Domain matching is case-insensitive.

### Lowercase conversion

Normalize the domain part of email addresses to lowercase with
the `lowercase` option.  The local part is preserved as-is, since it is
technically case-sensitive per RFC 5321.

~~~~ typescript twoslash
import { email } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Normalize email domain to lowercase
const normalizedEmail = option("--email", email({ lowercase: true }));
~~~~

~~~~ bash
$ example --email "User@Example.COM"  # Returns: "User@example.com"
~~~~

### Quoted local parts

The parser supports quoted strings in local parts for special characters:

~~~~ typescript twoslash
import { email } from "@optique/core/valueparser";
// ---cut-before---
const parser = email();
const result = parser.parse('"user name"@example.com');
// result.value = '"user name"@example.com'
~~~~

Quoted strings allow spaces and special characters that are normally forbidden
in local parts, such as `@` signs inside the quotes.

### Custom error messages

Customize error messages for validation failures:

~~~~ typescript twoslash
import { email } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { option } from "@optique/core";
// ---cut-before---
const workEmail = option("--email", email({
  allowedDomains: ["company.com"],
  errors: {
    invalidEmail: (input) => message`Invalid email format: ${input}`,
    domainNotAllowed: (email, domains) =>
      message`Email ${email} must use company domain`,
  },
}));
~~~~

### Common use cases

**User registration email:**

~~~~ typescript twoslash
import { email } from "@optique/core/valueparser";
// ---cut-before---
// Normalize email for consistent storage
const userEmail = email({ lowercase: true });
~~~~

**Notification recipients:**

~~~~ typescript twoslash
import { email } from "@optique/core/valueparser";
// ---cut-before---
// Multiple recipients with display names
const recipients = email({ allowMultiple: true, allowDisplayName: true });
~~~~

**Corporate email restriction:**

~~~~ typescript twoslash
import { email } from "@optique/core/valueparser";
// ---cut-before---
// Only accept company domain emails
const corporateEmail = email({
  allowedDomains: ["company.com", "company.org"],
  lowercase: true,
});
~~~~

The parser uses `"EMAIL"` as its default metavar.


`socketAddress()` parser
------------------------

The `socketAddress()` parser validates socket addresses in “host:port” format.
It supports hostnames, IPv4 addresses, and IPv6 literals, configurable
separators, default ports, and comprehensive host/port validation options. The
parser returns a `SocketAddressValue` object containing both the host and port
components.

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";

// Basic socket address (requires port)
const endpoint = socketAddress({ requirePort: true });

// With default port
const server = socketAddress({ defaultPort: 80 });

// IP addresses only
const bind = socketAddress({
  defaultPort: 8080,
  host: { type: "ip", version: "both" },
});

// Non-privileged ports only
const listen = socketAddress({
  defaultPort: 8080,
  port: { min: 1024 },
});
~~~~

### Socket address format

The parser accepts addresses in the following format:

 -  With port: `host:port` (e.g., `"localhost:3000"`, `"192.168.1.1:80"`)
 -  With an IPv6 literal and port: `[host]:port` (e.g., `"[::1]:8080"`,
    `"[2001:db8::1]:443"`)
 -  Without port: `host` (only when `defaultPort` is set, e.g., `"example.com"`)
 -  Without port for IPv6: `host` or `[host]` (only when `defaultPort` is set,
    e.g., `"::1"` or `"[::1]"`)

When the separator is the default `":"`, IPv6 host-and-port values use bracket
notation so the parser can distinguish colons inside the address from the port
separator.  Bare IPv6 literals such as `"::1"` and `"2001:db8::1"` are accepted
only when `defaultPort` supplies the port.  Unbracketed forms such as
`"::1:8080"` are treated as bare IPv6 hosts, not as host-and-port pairs; use
`"[::1]:8080"` when the port is explicit.

The separator between host and port can be customized using the `separator`
option.  Custom separators keep the ordinary split behavior; bracket notation
is intended for the default `":"` separator.

### Port requirements

By default, the port is optional if `defaultPort` is specified. Control this
behavior with the `requirePort` option:

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Port always required
const endpoint = option(
  "--endpoint",
  socketAddress({ requirePort: true })
);
~~~~

~~~~ bash
$ example --endpoint "localhost:3000"  # Valid
$ example --endpoint "localhost"       # Error: port required
~~~~

When `requirePort` is `false` (default) and `defaultPort` is set, the port may
be omitted:

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Port optional, defaults to 80
const server = option(
  "--server",
  socketAddress({ defaultPort: 80 })
);
~~~~

~~~~ bash
$ example --server "example.com:443"  # Uses port 443
$ example --server "example.com"      # Uses default port 80
~~~~

### Host type filtering

The `host.type` option controls what types of hosts are accepted:

 -  `"hostname"`: Accept only valid hostnames
 -  `"ip"`: Accept only IP addresses
 -  `"both"`: Accept both hostnames and IP addresses (default)

For IP hosts, `host.version` controls which IP versions are accepted:

 -  `4`: Accept IPv4 only
 -  `6`: Accept IPv6 only
 -  `"both"`: Accept IPv4 and IPv6 (default)

For compatibility with earlier versions, configurations that use only the
legacy `host.ip` field keep the previous IPv4-only behavior unless
`host.version` or the new `host.ipv4`/`host.ipv6` fields are also set.

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Only accept IP addresses for binding
const bind = option(
  "--bind",
  socketAddress({
    defaultPort: 8080,
    host: { type: "ip", version: "both" },
  })
);
~~~~

~~~~ bash
$ example --bind "0.0.0.0:8080"     # Valid IPv4
$ example --bind "[::1]:8080"       # Valid IPv6
$ example --bind "localhost:8080"   # Error: hostname not allowed
~~~~

### Host validation options

Pass options to the underlying hostname or IP parser using `host.hostname`,
`host.ipv4`, or `host.ipv6`:

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Remote hosts only (no localhost)
const remote = option(
  "--remote",
  socketAddress({
    defaultPort: 80,
    host: {
      type: "hostname",
      hostname: { allowLocalhost: false },
    },
  })
);
~~~~

~~~~ bash
$ example --remote "localhost:80"     # Error: localhost not allowed
$ example --remote "example.com:80"   # Valid
~~~~

For IPv4 addresses, use `host.ipv4` to pass options like `allowPrivate`.
The older `host.ip` field is still accepted as a compatibility alias for IPv4
options:

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Public IPs only
const publicServer = option(
  "--server",
  socketAddress({
    defaultPort: 443,
    host: {
      type: "ip",
      version: 4,
      ipv4: { allowPrivate: false },
    },
  })
);
~~~~

For IPv6 addresses, use `host.ipv6`:

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// IPv6 addresses only, excluding loopback
const publicV6 = option(
  "--listen-v6",
  socketAddress({
    defaultPort: 443,
    host: {
      type: "ip",
      version: 6,
      ipv6: { allowLoopback: false },
    },
  })
);
~~~~

### Port validation options

Pass port validation options using the `port` field:

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Non-privileged ports only
const listen = option(
  "--listen",
  socketAddress({
    defaultPort: 8080,
    port: { min: 1024, max: 65535 },
  })
);
~~~~

~~~~ bash
$ example --listen "localhost:80"    # Error: port too low
$ example --listen "localhost:8080"  # Valid
~~~~

Disallow well-known ports (1-1023):

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
const server = option(
  "--server",
  socketAddress({
    defaultPort: 8080,
    port: { disallowWellKnown: true },
  })
);
~~~~

### Custom separator

Change the separator between host and port:

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Use space as separator
const proxy = option(
  "--proxy",
  socketAddress({ separator: " ", defaultPort: 8080 })
);
~~~~

~~~~ bash
$ example --proxy "localhost 3000"  # Valid
$ example --proxy "localhost:3000"  # Invalid: wrong separator
~~~~

The parser tries splitting at the separator to find a valid host+port pair
before falling back to the host-only interpretation.  This ensures that
`parse(format(value))` always recovers the original value.  If no split
produces both a valid host and a valid port because the suffix is non-numeric
(e.g., the separator appears inside the hostname), the entire input is treated
as a hostname with the default port.  If the suffix is numeric but not a valid
port (e.g., out of range), parsing reports an invalid format error instead of
falling back to host-only.  For example, `"toronto"` with
`separator: "to"` has no valid split and is correctly treated as a hostname.

### Return value

The parser returns a `SocketAddressValue` object:

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
// ---cut-before---
const parser = socketAddress({ defaultPort: 80 });
const result = parser.parse("example.com:443");

if (result.success) {
  console.log(result.value.host);  // "example.com"
  console.log(result.value.port);  // 443
}
~~~~

Parsed IPv6 hosts are normalized with the same canonicalization behavior as
`ipv6()`.  When formatting, the default `":"` separator emits bracket notation
for IPv6 hosts:

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
// ---cut-before---
const parser = socketAddress();

parser.format({ host: "::1", port: 8080 });  // "[::1]:8080"
parser.format({
  host: "2001:0db8:0:0:0:0:0:1",
  port: 443,
});  // "[2001:db8::1]:443"
~~~~

### Custom error messages

Customize error messages for validation failures:

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { option } from "@optique/core";
// ---cut-before---
const endpoint = option(
  "--endpoint",
  socketAddress({
    requirePort: true,
    errors: {
      invalidFormat: (input) => message`Invalid endpoint: ${input}`,
      missingPort: message`You must specify a port number`,
    },
  })
);
~~~~

### Common use cases

**Web server configuration:**

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
// ---cut-before---
// Allow any host, default to port 8080
const listen = socketAddress({ defaultPort: 8080 });
~~~~

**Database connections:**

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
// ---cut-before---
// Require explicit host and port
const dbServer = socketAddress({ requirePort: true });
~~~~

**Proxy configuration:**

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
// ---cut-before---
// Accept hostnames and IPs, default port 3128
const proxy = socketAddress({
  defaultPort: 3128,
  host: { type: "both" },
});
~~~~

**Service binding (IP addresses only):**

~~~~ typescript twoslash
import { socketAddress } from "@optique/core/valueparser";
// ---cut-before---
// Bind to IP addresses only, non-privileged ports
const bind = socketAddress({
  defaultPort: 8080,
  host: { type: "ip", version: "both" },
  port: { min: 1024 },
});
~~~~

The parser uses `"HOST:PORT"` as its default metavar.


`portRange()` parser
--------------------

The `portRange()` parser validates port ranges in the format `start-end`
(e.g., `8000-8080`). It supports both number and bigint types, custom
separators, and comprehensive validation options including min/max constraints
and well-known port filtering.

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";

// Basic port range (number type)
const range = portRange();

// Custom separator
const colonRange = portRange({ separator: ":" });

// Allow single ports (returns {start: 8080, end: 8080})
const flexibleRange = portRange({ allowSingle: true });

// Restrict to non-privileged ports
const unprivilegedRange = portRange({ min: 1024 });

// BigInt type for consistency with other APIs
const bigintRange = portRange({ type: "bigint" });
~~~~

### Port range format

The parser accepts port ranges in `start-end` format where both start and end
must be valid port numbers (1-65535):

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";
const parser = portRange();
// ---cut-before---
parser.parse("8000-8080");  // { start: 8000, end: 8080 }
parser.parse("80-443");     // { start: 80, end: 443 }
parser.parse("1-65535");    // { start: 1, end: 65535 }
~~~~

The start port must be less than or equal to the end port:

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";
const parser = portRange();
// ---cut-before---
parser.parse("8080-8000");  // Error: start port must not be greater than end port
~~~~

### Single port mode

When `allowSingle` is enabled, the parser accepts single port numbers and
returns a range where start equals end:

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";

const parser = portRange({ allowSingle: true });
parser.parse("8080");       // { start: 8080, end: 8080 }
parser.parse("80-443");     // { start: 80, end: 443 }
~~~~

Without `allowSingle`, single ports are rejected:

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";

const parser = portRange();
parser.parse("8080");       // Error: must be in the format PORT-PORT
~~~~

### Custom separator

The default separator is `"-"`, but you can specify any string:

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";

// Colon separator
const colonRange = portRange({ separator: ":" });
colonRange.parse("8000:8080");  // { start: 8000, end: 8080 }

// Multi-character separator
const toRange = portRange({ separator: " to " });
toRange.parse("8000 to 8080");  // { start: 8000, end: 8080 }
~~~~

The separator is also used in the metavar and error messages:

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";

portRange({ separator: ":" }).metavar;     // "PORT:PORT"
portRange({ separator: " to " }).metavar;  // "PORT to PORT"
~~~~

### Min/max constraints

Restrict the allowed port range using `min` and `max` options. These
constraints apply to both the start and end ports:

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";

// Only non-privileged ports
const unprivileged = portRange({ min: 1024 });
unprivileged.parse("1024-8080");  // { start: 1024, end: 8080 }
unprivileged.parse("80-443");     // Error: must be at least 1024

// Limit to ephemeral port range
const ephemeral = portRange({ min: 49152, max: 65535 });
ephemeral.parse("50000-51000");  // { start: 50000, end: 51000 }
ephemeral.parse("8000-8080");    // Error: must be at least 49152
~~~~

### Well-known port filtering

The `disallowWellKnown` option rejects well-known ports (1-1023) in both the
start and end positions:

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";

const parser = portRange({ disallowWellKnown: true });
parser.parse("1024-8080");  // { start: 1024, end: 8080 }
parser.parse("80-443");     // Error: must not be a well-known port (1-1023)
parser.parse("1024-1023");  // Error: must not be a well-known port (1-1023)
~~~~

### Number vs bigint types

The parser supports both `number` (default) and `bigint` types:

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";

// Number type (default)
const numRange = portRange();
numRange.parse("8000-8080");  // { start: 8000, end: 8080 }

// BigInt type
const bigintRange = portRange({ type: "bigint" });
bigintRange.parse("8000-8080");  // { start: 8000n, end: 8080n }
~~~~

The bigint type is useful for consistency when working with APIs that use
bigint for port numbers.

### Return value

The parser returns a `PortRangeValue` object with `start` and `end` properties:

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";

interface PortRangeValueNumber {
  readonly start: number;
  readonly end: number;
}

interface PortRangeValueBigInt {
  readonly start: bigint;
  readonly end: bigint;
}
~~~~

The type is inferred based on the `type` option:

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";

const numRange = portRange();
const result1 = numRange.parse("8000-8080");
if (result1.success) {
  result1.value.start;  // type: number
}

const bigintRange = portRange({ type: "bigint" });
const result2 = bigintRange.parse("8000-8080");
if (result2.success) {
  result2.value.start;  // type: bigint
}
~~~~

### Custom error messages

All error messages can be customized via the `errors` option:

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";
import { message, text } from "@optique/core/message";
import { option } from "@optique/core";
// ---cut-before---
const portOpt = option("--ports", portRange({
  errors: {
    invalidFormat: message`Port range must be START-END`,
    invalidRange: message`START must be ≤ END`,
    invalidPort: message`Ports must be 1-65535`,
    belowMinimum: (port, min) =>
      message`Port ${text(port.toString())} is below minimum ${text(min.toString())}`,
    aboveMaximum: (port, max) =>
      message`Port ${text(port.toString())} is above maximum ${text(max.toString())}`,
    wellKnownNotAllowed: message`System ports (1-1023) are not allowed`,
  },
}));
~~~~

The `invalidFormat` and `invalidRange` errors are specific to port ranges,
while other errors (`invalidPort`, `belowMinimum`, `aboveMaximum`,
`wellKnownNotAllowed`) are inherited from the underlying `port()` parser.

### Common use cases

**Dynamic server port pools:**

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";
// ---cut-before---
// Accept ranges or single ports for service binding
const ports = portRange({
  allowSingle: true,
  min: 1024,
  metavar: "PORTS",
});
~~~~

**Load balancer configuration:**

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";
// ---cut-before---
// Backend server port range
const backendPorts = portRange({
  min: 8000,
  max: 9000,
});
~~~~

**Firewall rules:**

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";
// ---cut-before---
// Allow specifying port ranges for firewall configuration
const allowedPorts = portRange({
  allowSingle: true,
  disallowWellKnown: true,
});
~~~~

**Container port mapping:**

~~~~ typescript twoslash
import { portRange } from "@optique/core/valueparser";
// ---cut-before---
// Map container port ranges (colon separator for Docker-style syntax)
const portMapping = portRange({
  separator: ":",
  min: 1024,
});
~~~~

The parser uses `"PORT-PORT"` as its default metavar (or `"PORT{separator}PORT"`
when a custom separator is specified).


`macAddress()` parser
---------------------

The `macAddress()` parser validates MAC (Media Access Control) addresses,
commonly used to identify network interface hardware. It accepts MAC-48
addresses (6 octets, 12 hexadecimal digits) in multiple common formats with
support for case conversion and output normalization.

### Supported formats

The parser accepts MAC addresses in four standard formats:

~~~~ typescript twoslash
import { macAddress } from "@optique/core/valueparser";

const parser = macAddress();
const result1 = parser.parse("00:1A:2B:3C:4D:5E");  // Colon-separated
const result2 = parser.parse("00-1A-2B-3C-4D-5E");  // Hyphen-separated
const result3 = parser.parse("001A.2B3C.4D5E");     // Cisco format (dot-separated)
const result4 = parser.parse("001A2B3C4D5E");       // No separator
~~~~

Colon-separated and hyphen-separated formats also accept single-digit octets
(1 hex digit), which are automatically zero-padded to canonical two-digit form:

~~~~ typescript twoslash
import { macAddress } from "@optique/core/valueparser";

const parser = macAddress();
const result = parser.parse("0:1:2:3:4:5");
if (result.success) {
  result.value;  // "00:01:02:03:04:05"
}
~~~~

> [!NOTE]
> Dot-separated (Cisco) and no-separator formats require exactly the original
> fixed widths (4 hex digits per group and 12 hex digits total, respectively)
> and do not accept short-form input.

By default, the parser accepts any of these formats. You can restrict it to
a specific format using the `separator` option:

~~~~ typescript twoslash
import { macAddress } from "@optique/core/valueparser";
// ---cut-before---
// Accept only colon-separated format
const colonOnly = macAddress({ separator: ":" });

const result = colonOnly.parse("00:1A:2B:3C:4D:5E");
if (result.success) {
  result.value;  // "00:1A:2B:3C:4D:5E"
}

// Rejects other formats
const invalid = colonOnly.parse("00-1A-2B-3C-4D-5E");
if (!invalid.success) {
  invalid.error;  // "Invalid MAC address."
}
~~~~

The `separator` option accepts:

 -  `":"` - Colon-separated format (e.g., `00:1A:2B:3C:4D:5E`)
 -  `"-"` - Hyphen-separated format (e.g., `00-1A-2B-3C-4D-5E`)
 -  `"."` - Cisco dot notation (e.g., `001A.2B3C.4D5E`)
 -  `"none"` - No separator (e.g., `001A2B3C4D5E`)
 -  `"any"` - Accept any format (default)

### Case conversion

The parser provides case conversion options for hexadecimal digits:

~~~~ typescript twoslash
import { macAddress } from "@optique/core/valueparser";
// ---cut-before---
// Preserve original case (default)
const preserveCase = macAddress({ case: "preserve" });
const result1 = preserveCase.parse("00:1a:2B:3c:4D:5e");
if (result1.success) {
  result1.value;  // "00:1a:2B:3c:4D:5e"
}

// Convert to uppercase
const upperCase = macAddress({ case: "upper" });
const result2 = upperCase.parse("00:1a:2b:3c:4d:5e");
if (result2.success) {
  result2.value;  // "00:1A:2B:3C:4D:5E"
}

// Convert to lowercase
const lowerCase = macAddress({ case: "lower" });
const result3 = lowerCase.parse("00:1A:2B:3C:4D:5E");
if (result3.success) {
  result3.value;  // "00:1a:2b:3c:4d:5e"
}
~~~~

### Output normalization

The `outputSeparator` option normalizes the output format regardless of the
input format:

~~~~ typescript twoslash
import { macAddress } from "@optique/core/valueparser";
// ---cut-before---
// Normalize all inputs to colon-separated
const normalize = macAddress({
  outputSeparator: ":",
  case: "upper",
});

const result1 = normalize.parse("00-1a-2b-3c-4d-5e");
if (result1.success) {
  result1.value;  // "00:1A:2B:3C:4D:5E"
}

const result2 = normalize.parse("001a.2b3c.4d5e");
if (result2.success) {
  result2.value;  // "00:1A:2B:3C:4D:5E"
}
~~~~

Single-digit octets are also zero-padded during output normalization,
ensuring canonical MAC-48 strings and correct round-tripping:

~~~~ typescript twoslash
import { macAddress } from "@optique/core/valueparser";
// ---cut-before---
const dotNormalize = macAddress({ outputSeparator: ".", case: "upper" });
const result3 = dotNormalize.parse("0:1:2:3:4:5");
if (result3.success) {
  result3.value;  // "0001.0203.0405"
}
~~~~

The `outputSeparator` option accepts the same values as `separator` except
`"any"`. When not specified, the output preserves the input format.

### Return value

The parser returns a formatted string according to the `case` and
`outputSeparator` options:

~~~~ typescript twoslash
import { macAddress } from "@optique/core/valueparser";
// ---cut-before---
const parser = macAddress({
  outputSeparator: ":",
  case: "upper",
});

const result = parser.parse("00-1a-2b-3c-4d-5e");
if (result.success) {
  const mac: string = result.value;  // "00:1A:2B:3C:4D:5E"
}
~~~~

### Custom error messages

You can customize error messages using the `errors` option:

~~~~ typescript twoslash
import { macAddress } from "@optique/core/valueparser";
import { message, text } from "@optique/core/message";
// ---cut-before---
const parser = macAddress({
  errors: {
    invalidMacAddress: (input) =>
      message`Invalid MAC address: ${text(input)}. Expected format: XX:XX:XX:XX:XX:XX`,
  },
});

const result = parser.parse("not-a-mac");
if (!result.success) {
  result.error;  // "Invalid MAC address: not-a-mac. Expected format: XX:XX:XX:XX:XX:XX"
}
~~~~

### Common use cases

**Network device configuration:**

~~~~ typescript twoslash
import { macAddress } from "@optique/core/valueparser";
// ---cut-before---
// Standardize MAC addresses to uppercase colon format
const deviceMac = macAddress({
  outputSeparator: ":",
  case: "upper",
});
~~~~

**Cisco router configuration:**

~~~~ typescript twoslash
import { macAddress } from "@optique/core/valueparser";
// ---cut-before---
// Accept only Cisco dot notation format
const ciscoMac = macAddress({
  separator: ".",
  case: "lower",
});
~~~~

**Access control lists:**

~~~~ typescript twoslash
import { macAddress } from "@optique/core/valueparser";
// ---cut-before---
// Accept any format but normalize for storage
const aclMac = macAddress({
  outputSeparator: "none",
  case: "upper",
});
~~~~

**Network monitoring tools:**

~~~~ typescript twoslash
import { macAddress } from "@optique/core/valueparser";
// ---cut-before---
// Accept any format for user convenience
const monitorMac = macAddress();
~~~~

The parser uses `"MAC"` as its default metavar.


`domain()` parser
-----------------

The `domain()` parser validates domain names according to RFC 1035 with
configurable options for subdomain filtering, TLD restrictions, minimum label
requirements, and case normalization.

### Basic validation

The parser validates domain names with the following rules:

 -  Each label (part separated by dots) must be 1-63 characters
 -  Labels can contain alphanumeric characters and hyphens
 -  Labels cannot start or end with a hyphen
 -  By default, requires at least 2 labels (e.g., `example.com`)

~~~~ typescript twoslash
import { domain } from "@optique/core/valueparser";

const parser = domain();
const result1 = parser.parse("example.com");
if (result1.success) {
  result1.value;  // "example.com"
}

const result2 = parser.parse("www.example.com");
if (result2.success) {
  result2.value;  // "www.example.com"
}

const result3 = parser.parse("api.staging.example.com");
if (result3.success) {
  result3.value;  // "api.staging.example.com"
}
~~~~

### Subdomain filtering

Use the `allowSubdomains` option to restrict to root domains only:

~~~~ typescript twoslash
import { domain } from "@optique/core/valueparser";
// ---cut-before---
// Accept only root domains (2 labels)
const rootOnly = domain({ allowSubdomains: false });

const result1 = rootOnly.parse("example.com");
if (result1.success) {
  result1.value;  // "example.com"
}

// Rejects subdomains
const result2 = rootOnly.parse("www.example.com");
if (!result2.success) {
  result2.error;  // "Subdomains are not allowed, but got www.example.com."
}
~~~~

### TLD restrictions

Use the `allowedTlds` option to restrict accepted top-level domains:

~~~~ typescript twoslash
import { domain } from "@optique/core/valueparser";
// ---cut-before---
// Accept only specific TLDs
const restrictedTLD = domain({ allowedTlds: ["com", "org", "net"] });

const result1 = restrictedTLD.parse("example.com");
if (result1.success) {
  result1.value;  // "example.com"
}

// Case-insensitive TLD matching
const result2 = restrictedTLD.parse("example.COM");
if (result2.success) {
  result2.value;  // "example.COM"
}

// Rejects disallowed TLDs
const result3 = restrictedTLD.parse("example.io");
if (!result3.success) {
  result3.error;  // "Top-level domain io is not allowed. Allowed TLDs: com, org, net."
}
~~~~

### Minimum labels

Use the `minLabels` option to require a specific number of labels:

~~~~ typescript twoslash
import { domain } from "@optique/core/valueparser";
// ---cut-before---
// Require at least 3 labels
const threeLabels = domain({ minLabels: 3 });

const result1 = threeLabels.parse("www.example.com");
if (result1.success) {
  result1.value;  // "www.example.com"
}

const result2 = threeLabels.parse("example.com");
if (!result2.success) {
  result2.error;  // "Domain example.com must have at least 3 labels."
}

// Allow single-label domains (e.g., "localhost")
const singleLabel = domain({ minLabels: 1 });
const result3 = singleLabel.parse("localhost");
if (result3.success) {
  result3.value;  // "localhost"
}
~~~~

### Case normalization

Use the `lowercase` option to normalize domain names to lowercase:

~~~~ typescript twoslash
import { domain } from "@optique/core/valueparser";
// ---cut-before---
// Preserve original case (default)
const preserveCase = domain();
const result1 = preserveCase.parse("Example.COM");
if (result1.success) {
  result1.value;  // "Example.COM"
}

// Convert to lowercase
const lowerCase = domain({ lowercase: true });
const result2 = lowerCase.parse("Example.COM");
if (result2.success) {
  result2.value;  // "example.com"
}
~~~~

### Return value

The parser returns a string representing the domain name, optionally
normalized to lowercase:

~~~~ typescript twoslash
import { domain } from "@optique/core/valueparser";
// ---cut-before---
const parser = domain({ lowercase: true });
const result = parser.parse("WWW.Example.COM");
if (result.success) {
  const domainName: string = result.value;  // "www.example.com"
}
~~~~

### Custom error messages

You can customize error messages using the `errors` option:

~~~~ typescript twoslash
import { domain } from "@optique/core/valueparser";
import { message, text } from "@optique/core/message";
// ---cut-before---
const parser = domain({
  allowSubdomains: false,
  allowedTlds: ["com", "org"],
  errors: {
    invalidDomain: (input) =>
      message`Invalid domain: ${text(input)}`,
    subdomainsNotAllowed: (domain) =>
      message`Only root domains allowed, got: ${text(domain)}`,
    tldNotAllowed: (tld, allowed) =>
      message`TLD ${text(tld)} not in: ${text(allowed.join(", "))}`,
    tooFewLabels: (domain, min) =>
      message`${text(domain)} needs ${text(min.toString())} labels`,
  },
});

const result = parser.parse("example..com");
if (!result.success) {
  result.error;  // Custom error message
}
~~~~

### Common use cases

**Website configuration:**

~~~~ typescript twoslash
import { domain } from "@optique/core/valueparser";
// ---cut-before---
// Accept any valid domain, normalize to lowercase
const websiteDomain = domain({ lowercase: true });
~~~~

**Email domain validation:**

~~~~ typescript twoslash
import { domain } from "@optique/core/valueparser";
// ---cut-before---
// Restrict to specific TLDs for corporate email
const emailDomain = domain({
  allowedTlds: ["com", "org", "edu"],
  lowercase: true,
});
~~~~

**DNS configuration:**

~~~~ typescript twoslash
import { domain } from "@optique/core/valueparser";
// ---cut-before---
// Root domains only for DNS zone setup
const zoneDomain = domain({
  allowSubdomains: false,
  lowercase: true,
});
~~~~

**API endpoint configuration:**

~~~~ typescript twoslash
import { domain } from "@optique/core/valueparser";
// ---cut-before---
// Any valid domain with minimum 2 labels
const apiDomain = domain({
  minLabels: 2,
  lowercase: true,
});
~~~~

The parser uses `"DOMAIN"` as its default metavar.


`ipv6()` parser
---------------

The `ipv6()` parser validates and normalizes IPv6 addresses to canonical form
(lowercase, compressed using `::` notation where appropriate). It supports full
addresses, compressed notation, and IPv4-mapped IPv6 addresses, with
configurable address type restrictions.

### Basic validation

The parser validates IPv6 addresses in various formats:

~~~~ typescript twoslash
import { ipv6 } from "@optique/core/valueparser";

const parser = ipv6();

// Full format
const result1 = parser.parse("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
if (result1.success) {
  result1.value;  // "2001:db8:85a3::8a2e:370:7334" (compressed)
}

// Compressed format
const result2 = parser.parse("2001:db8::1");
if (result2.success) {
  result2.value;  // "2001:db8::1"
}

// IPv4-mapped IPv6
const result3 = parser.parse("::ffff:192.0.2.1");
if (result3.success) {
  result3.value;  // "::ffff:c000:201"
}

// Loopback
const result4 = parser.parse("::1");
if (result4.success) {
  result4.value;  // "::1"
}
~~~~

### Address type filtering

The parser provides options to restrict specific address types:

~~~~ typescript twoslash
import { ipv6 } from "@optique/core/valueparser";
// ---cut-before---
// No loopback addresses
const noLoopback = ipv6({ allowLoopback: false });
const result1 = noLoopback.parse("::1");
if (!result1.success) {
  result1.error;  // "::1 is a loopback address."
}

// Global unicast only (no link-local, no unique local)
const publicOnly = ipv6({
  allowLinkLocal: false,
  allowUniqueLocal: false,
});

const result2 = publicOnly.parse("fe80::1");
if (!result2.success) {
  result2.error;  // "fe80::1 is a link-local address."
}

const result3 = publicOnly.parse("fc00::1");
if (!result3.success) {
  result3.error;  // "fc00::1 is a unique local address."
}
~~~~

### Address type categories

The parser recognizes these IPv6 address types:

 -  **Loopback** (`::1`): Local loopback address
 -  **Link-local** (`fe80::/10`): Addresses for single network segment
 -  **Unique local** (`fc00::/7`): Private addresses for local communication
 -  **Multicast** (`ff00::/8`): Addresses for multicast groups
 -  **Zero** (`::`): All-zeros address

### Normalization

The parser automatically normalizes IPv6 addresses to canonical form:

 -  Converts to lowercase
 -  Removes leading zeros from each group
 -  Compresses the longest sequence of consecutive zero groups with `::`

~~~~ typescript twoslash
import { ipv6 } from "@optique/core/valueparser";
// ---cut-before---
const parser = ipv6();

// Uppercase converted to lowercase
const result1 = parser.parse("2001:DB8:85A3::8A2E:370:7334");
if (result1.success) {
  result1.value;  // "2001:db8:85a3::8a2e:370:7334"
}

// Leading zeros removed and compressed
const result2 = parser.parse("2001:0db8:0000:0000:0000:0000:0000:0001");
if (result2.success) {
  result2.value;  // "2001:db8::1"
}
~~~~

### Return value

The parser returns a string representing the normalized IPv6 address in
canonical form (lowercase, compressed).

The parser uses `"IPV6"` as its default metavar.


`ip()` parser
-------------

The `ip()` parser accepts both IPv4 and IPv6 addresses, delegating to the
`ipv4()` and `ipv6()` parsers based on the detected format. It can be
configured to accept only IPv4, only IPv6, or both (default).

### Basic validation

By default, the parser accepts both IP versions:

~~~~ typescript twoslash
import { ip } from "@optique/core/valueparser";

const parser = ip();

// IPv4 address
const result1 = parser.parse("192.0.2.1");
if (result1.success) {
  result1.value;  // "192.0.2.1"
}

// IPv6 address
const result2 = parser.parse("2001:db8::1");
if (result2.success) {
  result2.value;  // "2001:db8::1"
}
~~~~

### Version filtering

Use the `version` option to restrict to a specific IP version:

~~~~ typescript twoslash
import { ip } from "@optique/core/valueparser";
// ---cut-before---
// IPv4 only
const ipv4Only = ip({ version: 4 });
const result1 = ipv4Only.parse("192.0.2.1");
if (result1.success) {
  result1.value;  // "192.0.2.1"
}

const result2 = ipv4Only.parse("2001:db8::1");
if (!result2.success) {
  result2.error;  // "Expected a valid IP address, but got 2001:db8::1."
}

// IPv6 only
const ipv6Only = ip({ version: 6 });
const result3 = ipv6Only.parse("2001:db8::1");
if (result3.success) {
  result3.value;  // "2001:db8::1"
}
~~~~

### Passing options to IPv4/IPv6 parsers

The parser accepts separate options for IPv4 and IPv6 validation:

~~~~ typescript twoslash
import { ip } from "@optique/core/valueparser";
// ---cut-before---
// Public IPs only (both versions)
const publicOnly = ip({
  ipv4: { allowPrivate: false, allowLoopback: false },
  ipv6: { allowLinkLocal: false, allowUniqueLocal: false },
});

const result1 = publicOnly.parse("192.168.1.1");
if (!result1.success) {
  result1.error;  // "192.168.1.1 is a private IP address."
}

const result2 = publicOnly.parse("fe80::1");
if (!result2.success) {
  result2.error;  // "fe80::1 is a link-local address."
}
~~~~

### Shared error messages

The parser supports shared error messages that apply to both IP versions:

~~~~ typescript twoslash
import { ip } from "@optique/core/valueparser";
import type { Message } from "@optique/core/message";
// ---cut-before---
const parser = ip({
  errors: {
    loopbackNotAllowed: [
      { type: "text", text: "Loopback addresses are not allowed" },
    ] satisfies Message,
  },
  ipv4: { allowLoopback: false },
  ipv6: { allowLoopback: false },
});

const result1 = parser.parse("127.0.0.1");
if (!result1.success) {
  result1.error;  // "Loopback addresses are not allowed"
}

const result2 = parser.parse("::1");
if (!result2.success) {
  result2.error;  // "Loopback addresses are not allowed"
}
~~~~

### Return value

The parser returns a normalized IP address string. IPv4 addresses are returned
as-is, while IPv6 addresses are normalized to canonical form (lowercase,
compressed).

When `version` is `"both"`, the parser tries IPv4 first, then IPv6 if IPv4
fails. This means IPv4-mapped IPv6 addresses like `::ffff:192.0.2.1` are
parsed as IPv6. However, IPv4 restrictions (e.g., `allowPrivate: false`,
`allowLoopback: false`) are still applied to the embedded IPv4 address in
IPv4-mapped IPv6 addresses, so they cannot be used to bypass IPv4 policy.

The parser uses `"IP"` as its default metavar.


`cidr()` parser
---------------

The `cidr()` parser validates CIDR notation (IP address with prefix length)
and returns a structured object containing the normalized IP address, prefix
length, and IP version.

### Basic validation

The parser validates CIDR notation for both IPv4 and IPv6:

~~~~ typescript twoslash
import { cidr } from "@optique/core/valueparser";

const parser = cidr();

// IPv4 CIDR
const result1 = parser.parse("192.0.2.0/24");
if (result1.success) {
  result1.value.address;  // "192.0.2.0"
  result1.value.prefix;   // 24
  result1.value.version;  // 4
}

// IPv6 CIDR
const result2 = parser.parse("2001:db8::/32");
if (result2.success) {
  result2.value.address;  // "2001:db8::"
  result2.value.prefix;   // 32
  result2.value.version;  // 6
}
~~~~

### Prefix validation

The parser validates prefix lengths based on IP version:

 -  IPv4: 0-32
 -  IPv6: 0-128

~~~~ typescript twoslash
import { cidr } from "@optique/core/valueparser";
// ---cut-before---
const parser = cidr();

// Valid IPv4 prefix
const result1 = parser.parse("192.0.2.0/32");
if (result1.success) {
  result1.value.prefix;  // 32
}

// Invalid IPv4 prefix (>32)
const result2 = parser.parse("192.0.2.0/33");
if (!result2.success) {
  result2.error;  // "Expected a prefix length between 0 and 32 for IPv4, but got 33."
}

// Valid IPv6 prefix
const result3 = parser.parse("2001:db8::/128");
if (result3.success) {
  result3.value.prefix;  // 128
}
~~~~

### Prefix constraints

Use `minPrefix` and `maxPrefix` options to constrain the prefix length:

~~~~ typescript twoslash
import { cidr } from "@optique/core/valueparser";
// ---cut-before---
// Subnet sizes between /16 and /24
const subnet = cidr({
  version: 4,
  minPrefix: 16,
  maxPrefix: 24,
});

const result1 = subnet.parse("192.0.2.0/20");
if (result1.success) {
  result1.value.prefix;  // 20
}

const result2 = subnet.parse("192.0.2.0/8");
if (!result2.success) {
  result2.error;  // "Expected a prefix length greater than or equal to 16, but got 8."
}

const result3 = subnet.parse("192.0.2.0/28");
if (!result3.success) {
  result3.error;  // "Expected a prefix length less than or equal to 24, but got 28."
}
~~~~

### Version filtering

Use the `version` option to restrict to IPv4 or IPv6 CIDR:

~~~~ typescript twoslash
import { cidr } from "@optique/core/valueparser";
// ---cut-before---
// IPv4 CIDR only
const ipv4Cidr = cidr({ version: 4 });
const result1 = ipv4Cidr.parse("192.0.2.0/24");
if (result1.success) {
  result1.value.version;  // 4
}

const result2 = ipv4Cidr.parse("2001:db8::/32");
if (!result2.success) {
  result2.error;  // "Expected a valid CIDR notation, but got 2001:db8::/32."
}
~~~~

### IP address validation

The parser delegates IP address validation to `ipv4()` and `ipv6()` parsers,
so you can pass IPv4 and IPv6 options:

~~~~ typescript twoslash
import { cidr } from "@optique/core/valueparser";
// ---cut-before---
// Public IP ranges only
const publicCidr = cidr({
  ipv4: { allowPrivate: false },
  ipv6: { allowLinkLocal: false, allowUniqueLocal: false },
});

const result1 = publicCidr.parse("192.168.0.0/24");
if (!result1.success) {
  result1.error;  // "192.168.0.0 is a private IP address."
}
~~~~

### Return value

The parser returns a `CidrValue` object with three fields:

 -  `address`: The normalized IP address (string)
 -  `prefix`: The prefix length (number)
 -  `version`: The IP version (4 or 6)

~~~~ typescript twoslash
import { cidr } from "@optique/core/valueparser";
// ---cut-before---
const parser = cidr();
const result = parser.parse("192.0.2.0/24");
if (result.success) {
  const { address, prefix, version } = result.value;
  console.log(`${address}/${prefix} (IPv${version})`);
  // "192.0.2.0/24 (IPv4)"
}
~~~~

IPv6 addresses are normalized to canonical form (lowercase, compressed):

~~~~ typescript twoslash
import { cidr } from "@optique/core/valueparser";
// ---cut-before---
const parser = cidr();
const result = parser.parse("2001:0DB8:0000:0000:0000:0000:0000:0000/32");
if (result.success) {
  result.value.address;  // "2001:db8::"
  result.value.prefix;   // 32
}
~~~~

The parser uses `"CIDR"` as its default metavar.


`path()` parser
---------------

The `path()` parser validates file system paths with comprehensive options for
existence checking, type validation, and file extension filtering. Unlike other
built-in value parsers, `path()` is provided by the *@optique/run* package since
it uses Node.js file system APIs.

~~~~ typescript twoslash
import { path } from "@optique/run/valueparser";

// Basic path parser (any path, no validation)
const configPath = path({ metavar: "CONFIG" });

// File must exist
const inputFile = path({ metavar: "FILE", mustExist: true, type: "file" });

// Directory must exist
const outputDir = path({ metavar: "DIR", mustExist: true, type: "directory" });

// Config files with specific extensions
const configFile = path({
  metavar: "CONFIG",
  mustExist: true,
  type: "file",
  extensions: [".json", ".yaml", ".yml"]
});
~~~~

### Path validation options

The `path()` parser accepts comprehensive configuration options:

~~~~ typescript twoslash
interface PathOptions {
  metavar?: string;           // Custom metavar (default: "PATH")
  mustExist?: boolean;        // Path must exist on filesystem (default: false)
  mustNotExist?: boolean;     // Path must not exist (default: false)
  type?: "file" | "directory" | "either";  // Expected path type (default: "either")
  allowCreate?: boolean;      // Allow creating new files (default: false)
  extensions?: string[];      // Allowed file extensions (e.g., [".json", ".txt"])
}
~~~~

> [!NOTE]
> The `mustExist` and `mustNotExist` options are mutually exclusive.
> You cannot set both to `true` at the same time—TypeScript will catch this
> as a compile-time error.

### Existence validation

When `mustExist: true`, the parser verifies that the path exists on the file
system:

~~~~ typescript twoslash
import { path } from "@optique/run/valueparser";

// Must exist (file or directory)
const existingPath = path({ mustExist: true });

// Must be an existing file
const existingFile = path({
  mustExist: true,
  type: "file",
  metavar: "INPUT_FILE"
});

// Must be an existing directory
const existingDir = path({
  mustExist: true,
  type: "directory",
  metavar: "OUTPUT_DIR"
});
~~~~

### Non-existence validation

When `mustNotExist: true`, the parser rejects paths that already exist on the
file system.  This is useful for output files where you want to prevent
accidental overwrites:

~~~~ typescript twoslash
import { path } from "@optique/run/valueparser";

// Output file must not exist (prevent accidental overwrites)
const outputFile = path({
  mustNotExist: true,
  type: "file",
  metavar: "OUTPUT_FILE"
});

// Output file with extension validation
const reportFile = path({
  mustNotExist: true,
  extensions: [".json", ".csv"],
  metavar: "REPORT"
});

// Combine with allowCreate to also check parent directory
const logFile = path({
  mustNotExist: true,
  allowCreate: true,
  metavar: "LOG_FILE"
});
~~~~

### File creation validation

With `allowCreate: true`, the parser validates that the parent directory exists
for new files:

~~~~ typescript twoslash
import { path } from "@optique/run/valueparser";

// Allow creating new files (parent directory must exist)
const newFile = path({
  allowCreate: true,
  type: "file",
  metavar: "LOG_FILE"
});

// Combination: file can be new or existing
const flexibleFile = path({
  type: "file",
  allowCreate: true,
  extensions: [".log", ".txt"]
});
~~~~

### Extension filtering

Restrict file paths to specific extensions using the `extensions` option:

~~~~ typescript twoslash
import { path } from "@optique/run/valueparser";

// Configuration files only
const configFile = path({
  mustExist: true,
  type: "file",
  extensions: [".json", ".yaml", ".yml", ".toml"],
  metavar: "CONFIG_FILE"
});

// Image files only
const imageFile = path({
  mustExist: true,
  type: "file",
  extensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
  metavar: "IMAGE_FILE"
});

// Script files (existing or new)
const scriptFile = path({
  allowCreate: true,
  type: "file",
  extensions: [".js", ".ts", ".py", ".sh"],
  metavar: "SCRIPT"
});
~~~~

### Error messages

The `path()` parser provides specific error messages for different validation
failures:

~~~~ bash
$ myapp --config "nonexistent.json"
Error: Path nonexistent.json does not exist.

$ myapp --input "directory_not_file"
Error: Expected a file, but directory_not_file is not a file.

$ myapp --config "config.txt"
Error: Expected file with extension .json, .yaml, .yml, got .txt.

$ myapp --output "new_file/in/nonexistent/dir.txt"
Error: Parent directory new_file/in/nonexistent does not exist.

$ myapp --output "existing_file.txt"
Error: Path existing_file.txt already exists.
~~~~


Git integration
---------------

See the [Git integration](../integrations/git.md) page for documentation on
using Git reference parsers with Optique.


Temporal integration
--------------------

See the [Temporal integration](../integrations/temporal.md) page for
documentation on using Temporal API parsers with Optique.


Zod integration
---------------

See the [Zod integration](../integrations/zod.md) page for documentation on
using Zod schemas with Optique.


Valibot integration
-------------------

See the [Valibot integration](../integrations/valibot.md) page for documentation
on using Valibot schemas with Optique.


Creating custom value parsers
-----------------------------

When the built-in value parsers don't meet your needs, you can create custom
value parsers by implementing the `ValueParser<T>` interface. Custom parsers
integrate seamlessly with Optique's type system and provide the same error
handling and help text generation as built-in parsers.

### ValueParser interface

The `ValueParser<M, T>` interface defines four required properties plus a mode
marker, and two optional methods:

~~~~ typescript twoslash
import type { Mode, ModeValue, NonEmptyString, ValueParserResult } from "@optique/core/valueparser";
// ---cut-before---
interface ValueParser<M extends Mode, T> {
  readonly mode: M;
  readonly metavar: NonEmptyString;
  readonly placeholder: T;
  parse(input: string): ModeValue<M, ValueParserResult<T>>;
  format(value: T): string;
  normalize?(value: T): T;
  validate?(value: T): ValueParserResult<T>;
}
~~~~

`mode`
:   The parser's runtime execution mode. Use `"sync"` for value parsers that
    return values directly and `"async"` for value parsers that return
    `Promise`s. Unlike parser type markers such as `$valueType` and
    `$stateType`, this field is consumed at runtime.

`metavar`
:   The placeholder text shown in help messages (usually uppercase).
    Must be a non-empty string—TypeScript will reject empty string literals
    at compile time, and factory functions will throw `TypeError` at runtime
    if given an empty string.

`placeholder`
:   A type-appropriate stand-in value of type `T`.  During phase-one parsing
    (e.g., while a prompt is deferred), this value keeps downstream
    combinators and `map()` transforms working with the expected shape.
    Before phase-two context collection, deferred values may still be
    replaced with `undefined`, so contexts must not rely on seeing the
    placeholder itself.  It does not need to be meaningful—only a valid
    inhabitant of the result type that will not crash downstream transforms.

`parse()`
:   Converts string input to typed value or returns error

`format()`
:   Converts typed value back to string for display

`normalize()`
:   Optional.  Canonicalizes a value of type `T` according to the parser's
    configuration (e.g., case conversion, separator normalization).
    Built-in implementations delegate to `parse()` internally and
    return invalid values unchanged when parsing fails.  When present,
    `withDefault()` calls this on default
    values so that runtime defaults match the representation that `parse()`
    would produce.

    > [!NOTE]
    > For dependency-derived value parsers (`deriveFrom()`,
    > `dependency().derive()`), `normalize()` uses the default dependency
    > value to build the inner parser, not the dependency value resolved
    > during the current parse—the same trade-off that `format()` makes.
    > Exclusive combinators (`or()`, `longestMatch()`) and multi-source
    > combinators (`merge()`) intentionally do not forward normalization
    > because the active branch or key ownership is unknown at default time.

`validate()`
:   Optional.  *Available since Optique 1.1.0.*  Validates a value of type
    `T` as if it had been parsed from CLI input, returning a success result
    with the possibly canonicalized value or a failure with an error
    message.  When present, `option()` and `argument()` use this method to
    validate fallback values (e.g. from `bindEnv()`/`bindConfig()`) instead
    of the generic `format()`+`parse()` round-trip.  Most parsers do not
    need it: implement it only when the round-trip cannot faithfully
    express validation for some values, as with `firstOf()` whose
    constituents may produce overlapping string representations.  Like
    `normalize()`, this method is synchronous regardless of the parser's
    mode.

### Basic custom parser

Here's a simple custom parser for IPv4 addresses:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";

interface IPv4Address {
  octets: [number, number, number, number];
  toString(): string;
}

function ipv4(): ValueParser<"sync", IPv4Address> {
  return {
    mode: "sync",
    metavar: "IP_ADDRESS",
    placeholder: {
      octets: [0, 0, 0, 0],
      toString() { return "0.0.0.0"; },
    },

    parse(input: string): ValueParserResult<IPv4Address> {
      const parts = input.split('.');
      if (parts.length !== 4) {
        return {
          success: false,
          error: message`Expected IPv4 address in format a.b.c.d, but got ${input}.`
        };
      }

      const octets: number[] = [];
      for (const part of parts) {
        const num = parseInt(part, 10);
        if (isNaN(num) || num < 0 || num > 255) {
          return {
            success: false,
            error: message`Invalid IPv4 octet: ${part}. Must be 0-255.`
          };
        }
        octets.push(num);
      }

      return {
        success: true,
        value: {
          octets: octets as [number, number, number, number],
          toString() {
            return octets.join('.');
          }
        }
      };
    },

    format(value: IPv4Address): string {
      return value.toString();
    }
  };
}
~~~~

### Parser with options

More sophisticated parsers can accept configuration options:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import type {
  NonEmptyString,
  ValueParser,
  ValueParserResult,
} from "@optique/core/valueparser";

interface DateParserOptions {
  metavar?: NonEmptyString;
  format?: 'iso' | 'us' | 'eu';
  allowFuture?: boolean;
}

function date(options: DateParserOptions = {}): ValueParser<"sync", Date> {
  const { metavar = "DATE", format = 'iso', allowFuture = true } = options;

  return {
    mode: "sync",
    metavar,
    placeholder: new Date(0),

    parse(input: string): ValueParserResult<Date> {
      let date: Date;

      // Parse according to format
      switch (format) {
        case 'iso':
          date = new Date(input);
          break;
        case 'us':
          // MM/DD/YYYY format
          const usMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (!usMatch) {
            return {
              success: false,
              error: message`Expected US date format MM/DD/YYYY, but got ${input}.`
            };
          }
          date = new Date(parseInt(usMatch[3]), parseInt(usMatch[1]) - 1, parseInt(usMatch[2]));
          break;
        case 'eu':
          // DD/MM/YYYY format
          const euMatch = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
          if (!euMatch) {
            return {
              success: false,
              error: message`Expected EU date format DD/MM/YYYY, but got ${input}.`
            };
          }
          date = new Date(parseInt(euMatch[3]), parseInt(euMatch[2]) - 1, parseInt(euMatch[1]));
          break;
      }

      // Validate parsed date
      if (isNaN(date.getTime())) {
        return {
          success: false,
          error: message`Invalid date: ${input}.`
        };
      }

      // Check future constraint
      if (!allowFuture && date > new Date()) {
        return {
          success: false,
          error: message`Future dates not allowed, but got ${input}.`
        };
      }

      return { success: true, value: date };
    },

    format(value: Date): string {
      switch (format) {
        case 'iso':
          return value.toISOString().split('T')[0];
        case 'us':
          return `${value.getMonth() + 1}/${value.getDate()}/${value.getFullYear()}`;
        case 'eu':
          return `${value.getDate()}/${value.getMonth() + 1}/${value.getFullYear()}`;
      }
    }
  };
}

// Usage
const birthDate = date({
  format: 'us',
  allowFuture: false,
  metavar: "BIRTH_DATE"
});
~~~~

### Integration with parsers

Custom value parsers work seamlessly with Optique's parser combinators:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import type {
  NonEmptyString,
  ValueParser,
  ValueParserResult,
} from "@optique/core/valueparser";

interface IPv4Address {
  octets: [number, number, number, number];
  toString(): string;
}

function ipv4(): ValueParser<"sync", IPv4Address> {
  return {
    mode: "sync",
    metavar: "IP_ADDRESS",
    placeholder: {
      octets: [0, 0, 0, 0],
      toString() { return "0.0.0.0"; },
    },
    parse(input: string): ValueParserResult<IPv4Address> {
      return { success: false, error: message`` };
    },
    format(value: IPv4Address): string {
      return value.toString();
    }
  };
}

interface DateParserOptions {
  metavar?: NonEmptyString;
  format?: 'iso' | 'us' | 'eu';
  allowFuture?: boolean;
}

function date(options: DateParserOptions = {}): ValueParser<"sync", Date> {
  const { metavar = "DATE", format = 'iso', allowFuture = true } = options;
  return {
    mode: "sync",
    metavar,
    placeholder: new Date(0),
    parse(input: string): ValueParserResult<Date> {
      return { success: false, error: message`` };
    },
    format(value: Date): string {
      return "";
    }
  };
}
// ---cut-before---
import { object } from "@optique/core/constructs";
import { parse } from "@optique/core/parser";
import { argument, option } from "@optique/core/primitives";
import { integer } from "@optique/core/valueparser";

const serverConfig = object({
  address: option("--bind", ipv4()),
  startDate: argument(date({ format: 'iso' })),
  port: option("-p", "--port", integer({ min: 1, max: 0xffff }))
});

// Full type safety with custom types
const config = parse(serverConfig, [
  "--bind", "192.168.1.100",
  "--port", "8080",
  "2023-12-25"
]);

if (config.success) {
  console.log(`Binding to ${config.value.address.toString()}:${config.value.port}.`);
  console.log(`Start date: ${config.value.startDate.toDateString()}.`);
}
~~~~

### Validation best practices

When creating custom value parsers, follow these best practices:

#### Clear error messages

Provide specific, actionable error messages that help users understand what
went wrong:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
function _(input: string) {
// ---cut-before---
// Good: Specific and helpful
return {
  success: false,
  error: message`Expected IPv4 address in format a.b.c.d, but got ${input}.`
};

// Bad: Vague and unhelpful
return {
  success: false,
  error: message`Invalid input.`
};
// ---cut-after---
}
~~~~

#### Comprehensive validation

Validate all aspects of your input format:

~~~~ typescript twoslash
// @noErrors: 2391 2389
import { message } from "@optique/core/message";
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
function parseValue<T>(i: string): T;
const formatError = message``;
const boundsError = message``;
const semanticError = message``;
function correctFormat(input: string): boolean;
function withinBounds(input: string): boolean;
function semanticallyValid(input: string): boolean;
function parser<T>(placeholder: T): ValueParser<"sync", T> {
return {
mode: "sync",
metavar: "VALUE",
// Generic T has no intrinsic default, so accept a stand-in from the caller.
placeholder,
format() { return ""; },
// ---cut-before---
parse(input: string): ValueParserResult<T> {
  // 1. Format validation
  if (!correctFormat(input)) {
    return { success: false, error: formatError };
  }

  // 2. Range/constraint validation
  if (!withinBounds(input)) {
    return { success: false, error: boundsError };
  }

  // 3. Semantic validation
  if (!semanticallyValid(input)) {
    return { success: false, error: semanticError };
  }

  return { success: true, value: parseValue(input) };
}
// ---cut-after---
}
}
~~~~

#### Consistent metavar naming

Use descriptive, uppercase metavar names that clearly indicate the expected
input:

~~~~ typescript
// Good metavar examples
metavar: "EMAIL"
metavar: "FILE"
metavar: "PORT"
metavar: "UUID"

// Poor metavar examples
metavar: "input"
metavar: "value"
metavar: "thing"
~~~~

Custom value parsers extend Optique's type safety and validation capabilities to
handle domain-specific data types while maintaining consistency with
the built-in parsers and providing excellent integration with TypeScript's
type system.


Async value parsers
-------------------

*This API is available since Optique 0.9.0.*

Value parsers can operate in either synchronous (`"sync"`) or asynchronous
(`"async"`) mode. The mode is declared via the `mode` property, which affects
the return types of the `parse()` and `suggest()` methods.

All built-in value parsers are synchronous, but you can create async parsers
for scenarios like:

 -  Validating values against a remote API
 -  Reading configuration from external sources
 -  Performing I/O-based validation (e.g., checking DNS records)

### Creating async value parsers

An async value parser declares `mode: "async"` and returns a `Promise` from
its `parse()` method:

~~~~ typescript twoslash
import { type ValueParser, type ValueParserResult } from "@optique/core/valueparser";
import { message } from "@optique/core/message";

// An async value parser that validates a URL by checking if it's reachable
function reachableUrl(): ValueParser<"async", URL> {
  return {
    mode: "async",
    metavar: "URL",
    placeholder: new URL("http://0.invalid"),
    async parse(input: string): Promise<ValueParserResult<URL>> {
      // First validate URL format
      let url: URL;
      try {
        url = new URL(input);
      } catch {
        return {
          success: false,
          error: message`Invalid URL format: ${input}.`,
        };
      }

      // Then check if the URL is reachable
      try {
        const response = await fetch(url, { method: "HEAD" });
        if (!response.ok) {
          return {
            success: false,
            error: message`URL ${input} returned status ${response.status.toString()}.`,
          };
        }
      } catch (e) {
        return {
          success: false,
          error: message`Could not reach URL ${input}.`,
        };
      }

      return { success: true, value: url };
    },
    format(value: URL): string {
      return value.toString();
    },
  };
}
~~~~

### Mode propagation

When you use an async value parser with primitives and combinators, the mode
automatically propagates through the parser tree. If any value parser in
a composite parser is async, the entire parser becomes async:

~~~~ typescript twoslash
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

declare function reachableUrl(): ValueParser<"async", URL>;
// ---cut-before---
// This parser is async because reachableUrl() is async
const parser = object({
  endpoint: option("--endpoint", reachableUrl()),  // async
  name: option("-n", "--name", string()),          // sync
});
// parser.mode is "async"
~~~~

The mode is tracked at compile time through TypeScript's type system,
ensuring type safety when working with async parsers.

### Parsing with async parsers

For async parsers, use `parseAsync()` instead of `parse()`:

~~~~ typescript twoslash
import type { Parser, ValueParser, ValueParserResult } from "@optique/core";
import { message } from "@optique/core/message";
import { object } from "@optique/core/constructs";
import { parseAsync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

declare function reachableUrl(): ValueParser<"async", URL>;
const parser = object({
  endpoint: option("--endpoint", reachableUrl()),
  name: option("-n", "--name", string()),
});
// ---cut-before---
// parseAsync() returns a Promise
const result = await parseAsync(parser, ["--endpoint", "https://api.example.com"]);

if (result.success) {
  console.log(`Connecting to ${result.value.endpoint.toString()}.`);
}
~~~~

The `parseAsync()` function works with both sync and async parsers, always
returning a `Promise`. For sync-only parsers, use `parseSync()` which returns
the result directly.

### Async suggestions

Async value parsers can also provide async completion suggestions by returning
an `AsyncIterable` from the `suggest()` method:

~~~~ typescript twoslash
import type { Suggestion, ValueParser, ValueParserResult } from "@optique/core";
import { message } from "@optique/core/message";

// A value parser that suggests valid user IDs from a remote service
function userId(): ValueParser<"async", string> {
  return {
    mode: "async",
    metavar: "USER_ID",
    placeholder: "",
    async parse(input: string): Promise<ValueParserResult<string>> {
      // Validate against remote service...
      return { success: true, value: input };
    },
    format(value: string): string {
      return value;
    },
    async *suggest(prefix: string): AsyncIterable<Suggestion> {
      // Fetch matching user IDs from remote service
      const response = await fetch(
        `https://api.example.com/users?prefix=${encodeURIComponent(prefix)}`
      );
      const users = await response.json() as { id: string; name: string }[];

      for (const user of users) {
        yield {
          kind: "literal",
          text: user.id,
          description: message`${user.name}`,
        };
      }
    },
  };
}
~~~~

Similarly, use `suggestAsync()` to get suggestions from async parsers:

~~~~ typescript twoslash
import type { Parser, ValueParser, ValueParserResult } from "@optique/core";
import { message } from "@optique/core/message";
import { suggestAsync } from "@optique/core/parser";
import { argument } from "@optique/core/primitives";

declare function userId(): ValueParser<"async", string>;
const parser = argument(userId());
// ---cut-before---
// suggestAsync() returns a Promise with an array of suggestions
const suggestions = await suggestAsync(parser, ["us"]);

for (const suggestion of suggestions) {
  if (suggestion.kind === "literal") {
    console.log(suggestion.text);
  }
}
~~~~


Completion suggestions
----------------------

*This API is available since Optique 0.6.0.*

Value parsers can implement an optional `suggest()` method to provide
intelligent completion suggestions for shell completion. This method enables
users to discover valid values by pressing Tab, improving usability and
reducing input errors.

### Built-in parser suggestions

Many built-in value parsers automatically provide completion suggestions:

~~~~ typescript twoslash
import { choice, locale, url } from "@optique/core/valueparser";
import { timeZone } from "@optique/temporal";

// Choice parser suggests all available options
const format = choice(["json", "yaml", "xml"]);
// Completing "j" suggests: ["json"]

// URL parser suggests protocol completions when allowedProtocols is set
const apiUrl = url({ allowedProtocols: ["https:", "http:"] });
// Completing "ht" suggests: ["http://", "https://"]

// Locale parser suggests common locale identifiers
const userLocale = locale();
// Completing "en" suggests: ["en", "en-US", "en-GB", "en-CA", ...]

// Timezone parser uses Intl.supportedValuesOf for dynamic suggestions
const timezone = timeZone();
// Completing "America/" suggests: ["America/New_York", "America/Chicago", ...]
~~~~

### Custom suggestion implementation

Implement the `suggest()` method in custom value parsers to provide
domain-specific completions:

~~~~ typescript twoslash
import { type ValueParser, type ValueParserResult } from "@optique/core/valueparser";
import { type Suggestion } from "@optique/core/parser";
import { message } from "@optique/core/message";

function httpMethod(): ValueParser<"sync", string> {
  const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

  return {
    mode: "sync",
    metavar: "METHOD",
    placeholder: "",
    parse(input: string): ValueParserResult<string> {
      const method = input.toUpperCase();
      if (methods.includes(method)) {
        return { success: true, value: method };
      }
      return {
        success: false,
        // Note: For proper formatting of choice lists, see the "Formatting choice lists"
        // section in the Concepts guide on Messages
        error: message`Invalid HTTP method: ${input}. Valid methods: ${methods.join(", ")}.`,
      };
    },
    format(value: string): string {
      return value;
    },
    *suggest(prefix: string): Iterable<Suggestion> {
      for (const method of methods) {
        if (method.toLowerCase().startsWith(prefix.toLowerCase())) {
          yield {
            kind: "literal",
            text: method,
            description: message`HTTP ${method} request method`
          };
        }
      }
    },
  };
}
~~~~

### File completion delegation

For file and directory inputs, delegate completion to the shell's native
file system integration using file-type suggestions:

~~~~ typescript twoslash
import { type ValueParser, type ValueParserResult } from "@optique/core/valueparser";
import { type Suggestion } from "@optique/core/parser";
import { message } from "@optique/core/message";

function configFile(): ValueParser<"sync", string> {
  return {
    mode: "sync",
    metavar: "CONFIG",
    placeholder: "",
    parse(input: string): ValueParserResult<string> {
      // Validation logic here
      return { success: true, value: input };
    },
    format(value: string): string {
      return value;
    },
    *suggest(prefix: string): Iterable<Suggestion> {
      yield {
        kind: "file",
        type: "file",
        extensions: [".json", ".yaml", ".yml"],
        includeHidden: false,
        description: message`Configuration file`
      };
    },
  };
}
~~~~

The `suggest()` method receives the current input prefix and should yield
`Suggestion` objects. The shell completion system handles filtering and
display, while native file completion provides better performance and
platform-specific behavior for file system operations.

Completion suggestions improve user experience by making CLI applications
more discoverable and reducing typing errors, while maintaining the same
type safety and validation guarantees as the parsing logic.

<!-- cSpell: ignore myapp phonebk toolong -->
