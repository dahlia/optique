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

Every value parser implements the `ValueParser<T>` interface, which defines how
to parse strings into values of type `T` and how to format those values back
into strings for help text. This consistent interface makes value parsers
composable and allows you to create custom parsers that integrate seamlessly
with Optique's type system.


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

 -  *Format validation*: Ensures input contains only digits
 -  *Range validation*: Enforces minimum and maximum bounds
 -  *Overflow protection*: Prevents values outside safe ranges

~~~~ bash
$ myapp --port "abc"
Error: Expected a valid integer, but got abc.

$ myapp --port "99999"
Error: Expected a value less than or equal to 65,535, but got 99999.
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


`choice()` parser
-----------------

The `choice()` parser creates type-safe enumerations by restricting input to
one of several predefined string values. This is perfect for options like log
levels, output formats, or operation modes where only specific values make sense.

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

By default, matching is case-sensitive. Set `caseInsensitive: true` to accept variations:

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

The parser uses `"LOCALE"` as its default metavar and provides clear error messages for invalid locale identifiers.


`uuid()` parser
---------------

The `uuid()` parser validates [UUID] (Universally Unique Identifier) strings
according to the standard format and optionally restricts to specific UUID
versions. It returns a branded `Uuid` string type for additional type safety.

~~~~ typescript twoslash
import { uuid } from "@optique/core/valueparser";

// Basic UUID parser
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

### UUID format validation

The parser validates the standard UUID format: `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`
where each `x` is a hexadecimal digit:

~~~~
# Valid UUID formats
550e8400-e29b-41d4-a716-446655440000  # Version 1
123e4567-e89b-12d3-a456-426614174000  # Version 1
6ba7b810-9dad-11d1-80b4-00c04fd430c8  # Version 1
6ba7b811-9dad-11d1-80b4-00c04fd430c8  # Version 1

# Invalid formats
550e8400-e29b-41d4-a716-44665544000   # Too short
550e8400-e29b-41d4-a716-446655440000x  # Extra character
550e8400e29b41d4a716446655440000       # Missing hyphens
~~~~

### Version validation

When `allowedVersions` is specified, the parser checks the version digit
(character 14) and validates it matches one of the allowed versions:

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

The parser returns a branded `Uuid` type rather than a plain string, providing additional compile-time safety:

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
messages for format violations and version mismatches.


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
  type?: "file" | "directory" | "either";  // Expected path type (default: "either")
  allowCreate?: boolean;      // Allow creating new files (default: false)
  extensions?: string[];      // Allowed file extensions (e.g., [".json", ".txt"])
}
~~~~

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
~~~~


Temporal parsers
-----------------

*This API is available since Optique 0.4.0.*

The *@optique/temporal* package provides value parsers for the [Temporal API],
a modern JavaScript proposal for working with dates and times. These parsers
offer type-safe parsing of various temporal values including instants,
durations, dates, times, and time zones.

::: code-group

~~~~ bash [Deno]
deno add --jsr @optique/temporal
~~~~

~~~~ bash [npm]
npm add @optique/temporal
~~~~

~~~~ bash [pnpm]
pnpm add @optique/temporal
~~~~

~~~~ bash [Yarn]
yarn add @optique/temporal
~~~~

~~~~ bash [Bun]
bun add @optique/temporal
~~~~

:::

[Temporal API]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal
[@js-temporal/polyfill]: https://www.npmjs.com/package/@js-temporal/polyfill

### `instant()` parser

The `instant()` parser validates ISO 8601 timestamp strings and returns
[`Temporal.Instant`] objects representing precise moments in time:

~~~~ typescript twoslash
import { instant } from "@optique/temporal";

// Basic instant parser
const timestamp = instant();

// Instant with custom metavar
const createdAt = instant({ metavar: "TIMESTAMP" });
~~~~

The parser accepts ISO 8601 strings with timezone information:

~~~~ typescript
// Valid instant formats
"2023-12-25T10:30:00Z"                    // UTC
"2023-12-25T10:30:00+09:00"              // With timezone offset
"2023-12-25T10:30:00.123456789Z"         // With nanosecond precision
"2023-12-25T10:30:00-05:00"              // Negative timezone offset
~~~~

[`Temporal.Instant`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Instant

### `duration()` parser

The `duration()` parser validates ISO 8601 duration strings and returns
[`Temporal.Duration`] objects for representing spans of time:

~~~~ typescript twoslash
import { duration } from "@optique/temporal";

// Basic duration parser
const timeout = duration();

// Duration with custom metavar
const interval = duration({ metavar: "INTERVAL" });
~~~~

The parser accepts ISO 8601 duration format:

~~~~ typescript
// Valid duration formats
"PT30M"           // 30 minutes
"P1D"             // 1 day
"PT1H30M"         // 1 hour 30 minutes
"P1Y2M3DT4H5M6S"  // 1 year, 2 months, 3 days, 4 hours, 5 minutes, 6 seconds
"PT0.123S"        // 123 milliseconds
~~~~

[`Temporal.Duration`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Duration

### `zonedDateTime()` parser

The `zonedDateTime()` parser validates ISO 8601 datetime strings with timezone
information and returns [`Temporal.ZonedDateTime`] objects:

~~~~ typescript twoslash
import { zonedDateTime } from "@optique/temporal";

// Basic zoned datetime parser
const appointment = zonedDateTime();

// Zoned datetime with custom metavar
const meetingTime = zonedDateTime({ metavar: "MEETING_TIME" });
~~~~

The parser accepts ISO 8601 strings with timezone identifiers or offsets:

~~~~ typescript
// Valid zoned datetime formats
"2023-12-25T10:30:00[Asia/Seoul]"         // With IANA timezone
"2023-12-25T10:30:00+09:00[Asia/Seoul]"   // With offset and timezone
"2023-12-25T10:30:00-05:00[America/New_York]" // Different timezone
~~~~

[`Temporal.ZonedDateTime`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/ZonedDateTime

### `plainDate()` parser

The `plainDate()` parser validates ISO 8601 date strings and returns
[`Temporal.PlainDate`] objects representing calendar dates without time
information:

~~~~ typescript twoslash
import { plainDate } from "@optique/temporal";

// Basic date parser
const birthDate = plainDate();

// Date with custom metavar
const deadline = plainDate({ metavar: "DEADLINE" });
~~~~

The parser accepts ISO 8601 date format:

~~~~ typescript
// Valid date formats
"2023-12-25"      // Basic date format
"2023-01-01"      // New Year's Day
"1999-12-31"      // Y2K eve
~~~~

[`Temporal.PlainDate`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainDate

### `plainTime()` parser

The `plainTime()` parser validates ISO 8601 time strings and returns
[`Temporal.PlainTime`] objects representing wall-clock time without date or
timezone:

~~~~ typescript twoslash
import { plainTime } from "@optique/temporal";

// Basic time parser
const startTime = plainTime();

// Time with custom metavar
const alarmTime = plainTime({ metavar: "ALARM_TIME" });
~~~~

The parser accepts ISO 8601 time format:

~~~~ typescript
// Valid time formats
"10:30:00"           // Hour, minute, second
"14:15"              // Hour, minute (seconds default to 00)
"09:30:00.123"       // With milliseconds
"23:59:59.999999999" // With nanosecond precision
~~~~

[`Temporal.PlainTime`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainTime

### `plainDateTime()` parser

The `plainDateTime()` parser validates ISO 8601 datetime strings without
timezone information and returns [`Temporal.PlainDateTime`] objects:

~~~~ typescript twoslash
import { plainDateTime } from "@optique/temporal";

// Basic datetime parser
const localTime = plainDateTime();

// Datetime with custom metavar
const eventTime = plainDateTime({ metavar: "EVENT_TIME" });
~~~~

The parser accepts ISO 8601 datetime format:

~~~~ typescript
// Valid datetime formats
"2023-12-25T10:30:00"       // Basic datetime
"2023-12-25T14:15"          // Without seconds
"2023-12-25T09:30:00.123"   // With milliseconds
"2023-12-25 10:30:00"       // Space separator (also valid)
~~~~

[`Temporal.PlainDateTime`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainDateTime

### `plainYearMonth()` parser

The `plainYearMonth()` parser validates year-month strings and returns
[`Temporal.PlainYearMonth`] objects for representing specific months:

~~~~ typescript twoslash
import { plainYearMonth } from "@optique/temporal";

// Basic year-month parser
const reportMonth = plainYearMonth();

// Year-month with custom metavar
const billingPeriod = plainYearMonth({ metavar: "BILLING_PERIOD" });
~~~~

The parser accepts year-month format:

~~~~ typescript
// Valid year-month formats
"2023-12"         // December 2023
"2024-01"         // January 2024
"1999-06"         // June 1999
~~~~

[`Temporal.PlainYearMonth`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainYearMonth

### `plainMonthDay()` parser

The `plainMonthDay()` parser validates month-day strings and returns
[`Temporal.PlainMonthDay`] objects for representing recurring dates:

~~~~ typescript twoslash
import { plainMonthDay } from "@optique/temporal";

// Basic month-day parser
const birthday = plainMonthDay();

// Month-day with custom metavar
const holiday = plainMonthDay({ metavar: "HOLIDAY_DATE" });
~~~~

The parser accepts month-day format:

~~~~ typescript
// Valid month-day formats
"--12-25"         // Christmas (December 25)
"--01-01"         // New Year's Day (January 1)
"--07-04"         // Independence Day (July 4)
"--02-29"         // Leap day (February 29)
~~~~

[`Temporal.PlainMonthDay`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainMonthDay

### `timeZone()` parser

The `timeZone()` parser validates IANA Time Zone Database identifiers and returns
a branded `TimeZone` string type for type safety:

~~~~ typescript twoslash
import { timeZone } from "@optique/temporal";

// Basic timezone parser
const userTimezone = timeZone();

// Timezone with custom metavar
const displayTimezone = timeZone({ metavar: "DISPLAY_TZ" });
~~~~

The parser accepts valid IANA timezone identifiers:

~~~~ typescript
// Valid timezone identifiers
"UTC"                 // Coordinated Universal Time
"Asia/Seoul"          // South Korea
"America/New_York"    // Eastern Time (US)
"Europe/London"       // Greenwich Mean Time
"Australia/Sydney"    // Australian Eastern Time
"America/Los_Angeles" // Pacific Time (US)
"Asia/Tokyo"          // Japan Standard Time
~~~~

### Error messages

All temporal parsers provide clear, specific error messages for different validation failures:

~~~~ bash
$ myapp --timestamp "not-a-timestamp"
Error: Invalid instant format: not-a-timestamp. Expected ISO 8601 format like 2023-12-25T10:30:00Z.

$ myapp --duration "invalid-duration"
Error: Invalid duration format: invalid-duration. Expected ISO 8601 duration like PT30M or P1DT2H.

$ myapp --timezone "Invalid/Timezone"
Error: Invalid timezone identifier: Invalid/Timezone. Must be a valid IANA timezone like Asia/Seoul or UTC.
~~~~

### Integration with Temporal API

The temporal parsers return native Temporal objects with rich functionality:

~~~~ typescript twoslash
import { parse } from "@optique/core/parser";
import { argument } from "@optique/core/primitives";
import { instant, duration } from "@optique/temporal";
// ---cut-before---
const timestampArg = argument(instant());
const result = parse(timestampArg, ["2023-12-25T10:30:00Z"]);
if (result.success) {
  const instant = result.value;
  console.log(`Epoch milliseconds: ${instant.epochMilliseconds}`);
  console.log(`UTC string: ${instant.toString()}`);
  console.log(`In timezone: ${instant.toZonedDateTimeISO("Asia/Seoul")}`);
}

const timeoutArg = argument(duration());
const durationResult = parse(timeoutArg, ["PT1H30M"]);
if (durationResult.success) {
  const duration = durationResult.value;
  console.log(`Total seconds: ${duration.total("seconds")}`);
  console.log(`Hours: ${duration.hours}, Minutes: ${duration.minutes}`);
}
~~~~

The temporal parsers provide comprehensive date and time handling capabilities
with full type safety and integration with the modern Temporal API.


Creating custom value parsers
-----------------------------

When the built-in value parsers don't meet your needs, you can create custom
value parsers by implementing the `ValueParser<T>` interface. Custom parsers
integrate seamlessly with Optique's type system and provide the same error
handling and help text generation as built-in parsers.

### ValueParser interface

The `ValueParser<T>` interface defines three required properties:

~~~~ typescript twoslash
import type { ValueParserResult } from "@optique/core/valueparser";
// ---cut-before---
interface ValueParser<T> {
  readonly metavar: string;
  parse(input: string): ValueParserResult<T>;
  format(value: T): string;
}
~~~~

`metavar`
:   The placeholder text shown in help messages (usually uppercase)

`parse()`
:   Converts string input to typed value or returns error

`format()`
:   Converts typed value back to string for display

### Basic custom parser

Here's a simple custom parser for IPv4 addresses:

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";

interface IPv4Address {
  octets: [number, number, number, number];
  toString(): string;
}

function ipv4(): ValueParser<IPv4Address> {
  return {
    metavar: "IP_ADDRESS",

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
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";

interface DateParserOptions {
  metavar?: string;
  format?: 'iso' | 'us' | 'eu';
  allowFuture?: boolean;
}

function date(options: DateParserOptions = {}): ValueParser<Date> {
  const { metavar = "DATE", format = 'iso', allowFuture = true } = options;

  return {
    metavar,

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
import type { ValueParser, ValueParserResult } from "@optique/core/valueparser";

interface IPv4Address {
  octets: [number, number, number, number];
  toString(): string;
}

function ipv4(): ValueParser<IPv4Address> {
  return {
    metavar: "IP_ADDRESS",
    parse(input: string): ValueParserResult<IPv4Address> {
      return { success: false, error: message`` };
    },
    format(value: IPv4Address): string {
      return value.toString();
    }
  };
}

interface DateParserOptions {
  metavar?: string;
  format?: 'iso' | 'us' | 'eu';
  allowFuture?: boolean;
}

function date(options: DateParserOptions = {}): ValueParser<Date> {
  const { metavar = "DATE", format = 'iso', allowFuture = true } = options;
  return {
    metavar,
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
function parser<T>(): ValueParser<T> {
return {
metavar: "",
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

function httpMethod(): ValueParser<string> {
  const methods = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];

  return {
    metavar: "METHOD",
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

function configFile(): ValueParser<string> {
  return {
    metavar: "CONFIG",
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
