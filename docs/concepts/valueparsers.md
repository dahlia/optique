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

The parser validates the standard UUID format:
`xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` where each `x` is a hexadecimal digit:

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
messages for format violations and version mismatches.


`port()` parser
---------------

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

The `ipv4()` parser validates IPv4 addresses in dotted-decimal notation with
comprehensive filtering options for different IP address types. It's commonly
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
 -  Invalid: `"-example.com"` (starts with hyphen), `"example..com"` (empty label),
    `"a".repeat(64) + ".com"` (label too long)

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

Convert email addresses to lowercase with the `lowercase` option:

~~~~ typescript twoslash
import { email } from "@optique/core/valueparser";
import { option } from "@optique/core";
// ---cut-before---
// Normalize email to lowercase
const normalizedEmail = option("--email", email({ lowercase: true }));
~~~~

~~~~ bash
$ example --email "User@Example.COM"  # Returns: "user@example.com"
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

The `ValueParser<M, T>` interface defines three required properties plus a mode
marker:

~~~~ typescript twoslash
import type { Mode, ModeValue, NonEmptyString, ValueParserResult } from "@optique/core/valueparser";
// ---cut-before---
interface ValueParser<M extends Mode, T> {
  readonly $mode: M;
  readonly metavar: NonEmptyString;
  parse(input: string): ModeValue<M, ValueParserResult<T>>;
  format(value: T): string;
}
~~~~

`metavar`
:   The placeholder text shown in help messages (usually uppercase).
    Must be a non-empty string—TypeScript will reject empty string literals
    at compile time, and factory functions will throw `TypeError` at runtime
    if given an empty string.

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

function ipv4(): ValueParser<"sync", IPv4Address> {
  return {
    $mode: "sync",
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
    $mode: "sync",
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
    $mode: "sync",
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
  metavar?: NonEmptyString;
  format?: 'iso' | 'us' | 'eu';
  allowFuture?: boolean;
}

function date(options: DateParserOptions = {}): ValueParser<"sync", Date> {
  const { metavar = "DATE", format = 'iso', allowFuture = true } = options;
  return {
    $mode: "sync",
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
function parser<T>(): ValueParser<"sync", T> {
return {
$mode: "sync",
metavar: "VALUE",
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
(`"async"`) mode. The mode is declared via the `$mode` property, which affects
the return types of the `parse()` and `suggest()` methods.

All built-in value parsers are synchronous, but you can create async parsers
for scenarios like:

 -  Validating values against a remote API
 -  Reading configuration from external sources
 -  Performing I/O-based validation (e.g., checking DNS records)

### Creating async value parsers

An async value parser declares `$mode: "async"` and returns a `Promise` from
its `parse()` method:

~~~~ typescript twoslash
import { type ValueParser, type ValueParserResult } from "@optique/core/valueparser";
import { message } from "@optique/core/message";

// An async value parser that validates a URL by checking if it's reachable
function reachableUrl(): ValueParser<"async", URL> {
  return {
    $mode: "async",
    metavar: "URL",
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
// parser.$mode is "async"
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
    $mode: "async",
    metavar: "USER_ID",
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
    $mode: "sync",
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

function configFile(): ValueParser<"sync", string> {
  return {
    $mode: "sync",
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
