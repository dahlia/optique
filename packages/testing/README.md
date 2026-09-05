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

The runner layer is available through `captureRun()`:

~~~~ typescript
import { argument } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { captureRun } from "@optique/testing/run";

const result = await captureRun(argument(string()), {
  args: ["--help"],
  programName: "greet",
  help: "option",
  colors: false,
  maxWidth: 80,
});

console.log(result.kind, result.exitCode, result.stdout, result.stderr);
~~~~

Use `captureProgramRun()` to include command discovery and handler dispatch:

~~~~ typescript
import { captureProgramRun } from "@optique/testing/discover";

const result = await captureProgramRun({
  dir: new URL("./commands/", import.meta.url),
  metadata: { name: "example" },
  args: ["--help"],
  colors: false,
  maxWidth: 80,
});

console.log(result.exitCode, result.stdout, result.stderr);
~~~~

The helper runs real command modules, hooks, and handlers.  It captures
Optique's output callbacks; direct console or process-stream writes bypass
capture.  Unexpected errors reject the promise.

Use `createCliRunner()` to capture the complete process, including direct
console writes and application exit codes:

~~~~ typescript
import { createCliRunner } from "@optique/testing/cli";

const cli = createCliRunner({
  entrypoint: new URL("./cli.mjs", import.meta.url),
});
const result = await cli.invoke("--help");
console.log(result.exitCode, result.signal, result.stdout, result.stderr);
~~~~

The runner uses the current runtime.  Set `runtimeArgs` for explicit runtime
flags, including Deno permissions, or use `command: ["node", "./cli.mjs"]`
for a specific executable.  Calls accept stdin, cwd, environment overrides,
and cancellation.  The default timeout is five seconds; `timeout: 0` disables
it.  Nonzero exits return results; execution failures, timeouts, and
cancellation reject with `CliInvocationError`, including partial output.
See the [testing guide] for process-tree cleanup and runtime details.

[Optique]: https://optique.dev/
[testing guide]: https://optique.dev/concepts/testing


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
