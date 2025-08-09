Optique: Type-safe combinatorial CLI parser for TypeScript
==========================================================

> [!CAUTION]
> Optique is currently in early development for proof of concept purposes,
> and is not yet ready for production use.  The API is subject to change,
> and there may be bugs or missing features.

Optique is a modern command-line interface parser inspired by
Haskell's [optparse-applicative] and TypeScript's [Zod].  It allows you to
build complex CLI interfaces using composable parsers with full type safety
and automatic type inference.

Unlike traditional CLI parsers that rely on configuration objects or
string-based definitions, Optique uses a functional approach where parsers
are first-class values that can be combined, transformed, and reused.
This compositional design makes it easy to express complex argument structures
while maintaining complete type safety throughout your application.

[optparse-applicative]: https://github.com/pcapriotti/optparse-applicative
[Zod]: https://zod.dev/


Core concepts
-------------

Optique is built around three fundamental concepts: value parsers that convert
strings to typed values, option parsers that handle command-line flags and
their arguments, and combinators like `or()` and `object()` that compose
multiple parsers into sophisticated argument structures.

The library automatically infers the result type of your parser composition,
ensuring that your parsed CLI arguments are fully typed without manual type
annotations. When parsing fails, you get detailed error messages that help
users understand what went wrong.


Example
-------

~~~~ typescript
import { integer, string } from "@optique/core/valueparser";
import { object, option, or, parse } from "@optique/core/parser";

// Define mutually exclusive option groups
const parser = or(
  object("Server mode", {
    port: option("-p", "--port", integer({ min: 1, max: 65535 })),
    host: option("-h", "--host", string({ metavar: "HOST" })),
  }),
  object("Client mode", {
    connect: option("-c", "--connect", string({ metavar: "URL" })),
    timeout: option("-t", "--timeout", integer({ min: 0 })),
  }),
);

const result = parse(parser, process.argv.slice(2));

if (result.success) {
  // TypeScript automatically infers the union type:
  // { port: number | undefined; host: string | undefined } |
  // { connect: string | undefined; timeout: number | undefined }

  if ("port" in result.value) {
    console.log(`Starting server on ${result.value.host}:${result.value.port}`);
  } else {
    console.log(`Connecting to ${result.value.connect}`);
  }
} else {
  console.error(result.error);
}
~~~~

This parser accepts either server options (`--port`, `--host`) or
client options (`--connect`, `--timeout`), but not both.
Optique automatically enforces this mutual exclusivity and provides clear error
messages when invalid combinations are attempted.

The `or()` combinator tries each alternative in order, while the `object()`
combinator groups related options together.  Value parsers like `integer()` and
`string()` handle the conversion from command-line strings to properly typed
values with validation.
