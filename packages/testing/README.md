@optique/testing
================

Testing support for [Optique] command-line interfaces.

An Optique application can be exercised at four distinct execution boundaries,
and this package gives each one its own entry point, so the scope of a test is
visible from its import:

 -  *@optique/testing/parser*: a parser on its own, without help rendering,
    process integration, or command dispatch.
 -  *@optique/testing/run*: what `run()` and `runAsync()` write through their
    injected output callbacks, plus intentional exits.
 -  *@optique/testing/discover*: a `runProgram()` invocation, including command
    discovery and handler dispatch.
 -  *@optique/testing/cli*: a real CLI entry point in a child process.

The package root holds only the contracts that mean the same thing at more than
one boundary.  It depends on no test framework and no assertion library.

The parser layer is available through `parseArgs()` and `parseArgsSync()`:

~~~~ typescript
import { option } from "@optique/core/primitives";
import { parseArgsSync } from "@optique/testing/parser";

const result = parseArgsSync(option("--verbose"), ["--verbose"]);
if (result.success) {
  console.log(result.value);
} else {
  console.error(result.error, result.remainingArgs, result.commandPath);
}
~~~~

The runner, discovery, and child-process entry points remain reserved while
their helpers are developed.

[Optique]: https://optique.dev/


Installation
------------

~~~~ bash
deno add jsr:@optique/testing
npm add @optique/testing
pnpm add @optique/testing
yarn add @optique/testing
bun add @optique/testing
~~~~


Documentation
-------------

For full documentation, visit the [testing guide], which explains what each
layer does and does not execute, and how to choose between them.

[testing guide]: https://optique.dev/concepts/testing
