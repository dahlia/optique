@optique/run
============

> [!CAUTION]
> Optique is currently in early development and may change significantly.
> Expect breaking changes as we refine the API and features.

Process-integrated CLI parser for Node.js, Bun, and Deno that provides a
batteries-included interface for *@optique/core* with automatic `process.argv`
handling, `process.exit()`, and terminal capabilities.


When to use @optique/run
------------------------

Use *@optique/run* when:

 -  Building CLI applications for Node.js, Bun, or Deno
 -  You want automatic `process.argv` parsing and `process.exit()` handling
 -  You need automatic terminal capability detection (colors, width)
 -  You prefer a simple, batteries-included approach

Use *@optique/core* instead when:

 -  Building web applications or libraries
 -  You need full control over argument sources and error handling
 -  Working in environments without `process` (browsers, web workers)
 -  Building reusable parser components


Installation
------------

~~~~ bash
deno add jsr:@optique/run jsr:@optique/core
npm  add     @optique/run     @optique/core
pnpm add     @optique/run     @optique/core
yarn add     @optique/run     @optique/core
~~~~


Quick example
-------------

~~~~ typescript
import { run } from "@optique/run";
import { object, option, argument } from "@optique/core/parser";
import { string, integer } from "@optique/core/valueparser";

const parser = object({
  name: argument(string()),
  age: option("-a", "--age", integer()),
  verbose: option("-v", "--verbose"),
});

// Automatically uses process.argv, handles errors and help, exits on completion
const config = run(parser);

console.log(`Hello ${config.name}!`);
if (config.age) console.log(`You are ${config.age} years old.`);
if (config.verbose) console.log("Verbose mode enabled.");
~~~~

Run it:

~~~~ bash
$ node cli.js Alice --age 25 --verbose
Hello Alice!
You are 25 years old.
Verbose mode enabled.
~~~~

For more resources, see the [docs] and the [*examples/*](/examples/) directory.

[docs]: https://optique.dev/
