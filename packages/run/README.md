@optique/run
============

> [!CAUTION]
> Optique is currently in early development for proof of concept purposes,
> and is not yet ready for production use.  The API is subject to change,
> and there may be bugs or missing features.

*Process-integrated CLI parser for Node.js, Bun, and Deno.*

*@optique/run* provides a convenient high-level interface for *@optique/core*
that automatically handles `process.argv`, `process.exit()`, and terminal
capabilities.  It eliminates the manual setup required by the core library,
making it perfect for building CLI applications in server-side JavaScript
runtimes.


When to use @optique/run
------------------------

Use `@optique/run` when:

 -  Building CLI applications for Node.js, Bun, or Deno
 -  You want automatic `process.argv` parsing and `process.exit()` handling
 -  You need automatic terminal capability detection (colors, width)
 -  You prefer a simple, batteries-included approach

Use `@optique/core` instead when:

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
if (config.age) {
  console.log(`You are ${config.age} years old.`);
}
if (config.verbose) {
  console.log("Verbose mode enabled.");
}
~~~~

Run it:

~~~~ bash
$ node cli.js Alice --age 25 --verbose
Hello Alice!
You are 25 years old.
Verbose mode enabled.
~~~~


API differences from @optique/core
----------------------------------

| Feature            | @optique/core                           | @optique/run                     |
|--------------------|-----------------------------------------|----------------------------------|
| Argument source    | Manual (`run(parser, "program", args)`) | Automatic (`process.argv`)       |
| Error handling     | Return value or callback                | Automatic `process.exit()`       |
| Help display       | Manual implementation                   | Automatic help option/command    |
| Terminal detection | Manual specification                    | Automatic TTY/width detection    |
| Program name       | Manual parameter                        | Automatic from `process.argv[1]` |


Configuration options
---------------------

~~~~ typescript
const result = run(parser, {
  programName: "my-cli",           // Override detected program name
  args: ["custom", "args"],        // Override process.argv
  colors: true,                    // Force colored output
  maxWidth: 100,                   // Set output width
  help: "both",                    // Enable --help and help command
  aboveError: "usage",             // Show usage on errors
  errorExitCode: 1,                // Exit code for errors
});
~~~~


Help system
-----------

Enable built-in help functionality:

~~~~ typescript
const result = run(parser, {
  help: "option",    // Adds --help option
  help: "command",   // Adds help subcommand
  help: "both",      // Adds both --help and help command
  help: "none",      // No help (default)
});
~~~~


Error handling
--------------

The `run()` function automatically:

 -  Prints usage information and error messages to stderr
 -  Exits with code `0` for help requests
 -  Exits with code `1` (or custom) for parse errors
 -  Never returns on errors (always calls `process.exit()`)
