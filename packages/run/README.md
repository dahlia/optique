@optique/run
============

> [!WARNING]
> The API is stabilizing, but may change before the 1.0 release.

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


Shell completion
----------------

*@optique/run* automatically supports shell completion for Bash and zsh.
Enable completion by adding the `completion` option to your `run()`
configuration:

~~~~ typescript
import { run } from "@optique/run";
import { object, option, argument } from "@optique/core/parser";
import { string, choice } from "@optique/core/valueparser";

const parser = object({
  format: option("-f", "--format", choice(["json", "yaml", "xml"])),
  input: argument(string({ metavar: "FILE" })),
  verbose: option("-v", "--verbose"),
});

const config = run(parser, {
  completion: { mode: "both" }
});
~~~~

Users can then generate and install completion scripts:

~~~~ bash
# Generate Bash completion script
myapp completion bash > ~/.bashrc.d/myapp.bash
source ~/.bashrc.d/myapp.bash

# Generate zsh completion script
myapp completion zsh > ~/.zsh/completions/_myapp
~~~~

The completion system automatically provides intelligent suggestions for:

 -  Option names and aliases (`--format`, `-f`)
 -  Option values (`--format json`, `--format=yaml`)
 -  Subcommands and arguments
 -  File paths (when using `path()` value parser)

For more details, see the [completion guide].

[completion guide]: https://optique.dev/concepts/completion

---

For more resources, see the [docs] and the [*examples/*](/examples/) directory.

[docs]: https://optique.dev/
