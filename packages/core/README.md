@optique/core
=============

> [!WARNING]
> The API is stabilizing, but may change before the 1.0 release.

The core package of Optique which provides the shared types and parser
combinators. It is designed to be used in universal JavaScript runtimes,
including Node.js, Deno, Bun, edge functions, and web browsers—although
you usually won't use it directly in browsers.

> [!TIP]
> *Building CLI apps?* Consider *@optique/run* for automatic `process.argv`
> handling and `process.exit()` integration. This core package is perfect for
> libraries, web apps, or when you need full control over argument parsing.


When to use @optique/core
-------------------------

Use *@optique/core* instead when:

 -  Building web applications or libraries
 -  You need full control over argument sources and error handling
 -  Working in environments without `process` (browsers, web workers)
 -  Building reusable parser components

Use *@optique/run* when:

 -  Building CLI applications for Node.js, Bun, or Deno
 -  You want automatic `process.argv` parsing and `process.exit()` handling
 -  You need automatic terminal capability detection (colors, width)
 -  You prefer a simple, batteries-included approach


Quick example
-------------

~~~~ typescript
import { runParser } from "@optique/core/facade";
import { object, option, argument } from "@optique/core/parser";
import { string, integer } from "@optique/core/valueparser";
import process from "node:process";

const parser = object({
  name: argument(string()),
  age: option("-a", "--age", integer()),
  verbose: option("-v", "--verbose"),
});

const config = runParser(parser, "myapp", process.argv.slice(2), {
  help: "both",
  onError: process.exit,
});

console.log(`Hello ${config.name}!`);
if (config.age) console.log(`You are ${config.age} years old.`);
if (config.verbose) console.log("Verbose mode enabled.");
~~~~

For more resources, see the [docs] and the [*examples/*](/examples/) directory.

[docs]: https://optique.dev/
