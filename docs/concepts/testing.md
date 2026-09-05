---
description: >-
  Choose the execution boundary a CLI test should exercise, and understand what
  each layer of @optique/testing does and does not run.
---

Testing
=======

An Optique application is testable at several points, and the useful question
is rarely “how do I test my CLI?” but “which part of it do I want to run?”
A parser can be checked without rendering help or touching a process.  A runner
can be checked without executing the code that consumes the parsed value.
Neither of those observes what a command handler prints through `console.log()`.

The *@optique/testing* package draws those boundaries as separate entry points,
so the scope of a test is visible from its import:

~~~~ typescript
import { /* ... */ } from "@optique/testing/parser";
import { /* ... */ } from "@optique/testing/run";
import { /* ... */ } from "@optique/testing/discover";
import { /* ... */ } from "@optique/testing/cli";
~~~~


Execution boundaries
--------------------

Each layer runs strictly more of the application than the one above it:

| Layer                       | Runs                                                                     | Does not run                                                     |
| --------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| *@optique/testing/parser*   | The parser, over a complete argument list                                | Help rendering, output, exits, command handlers                  |
| *@optique/testing/run*      | The above, plus help, version, completion, and parse-error output        | The code that consumes the parsed value                          |
| *@optique/testing/discover* | The above, plus command discovery, lifecycle hooks, and handler dispatch | Nothing—but writes that bypass Optique's handlers escape capture |
| *@optique/testing/cli*      | The entire process                                                       | —                                                                |

The gap between the last two rows is the one that catches people out.  The
in-process layers capture output because *@optique/run* accepts injected
`stdout` and `stderr` callbacks, and Optique routes help, version, completion,
and parse errors through them.  A command handler that calls `console.log()`,
[`print()`](./runners.md), or `process.stdout.write()` writes past those
callbacks and is invisible to a `runProgram()` capture.  Asserting on that
output requires a child process.


Choosing a layer
----------------

Prefer the narrowest layer that still exercises what you are asserting about.

`@optique/testing/parser`
:   Grammar questions.  Does this option accept that value, does a bad value
    produce the error you intended, does `or()` pick the branch you expect?
    Nothing is rendered and nothing exits, so the assertions are about values
    and structured errors rather than text.

`@optique/testing/run`
:   Runner behavior.  Does `--help` print the usage you expect, does an unknown
    option exit with the code you configured, does the parser return the value
    your application will receive?

`@optique/testing/discover`
:   Dispatch.  Does the right command module get selected, do program hooks run
    in order, does a failing handler propagate its error?

`@optique/testing/cli`
:   The application as users experience it.  This is also the only layer that
    sees the working directory, the environment, stdin, and the exit code of a
    real process, and the only one that needs the entry point to be runnable.

These layers are complements, not alternatives.  A parser test that runs in
milliseconds is a poor substitute for one end-to-end check that the binary
starts at all, and the reverse is equally true.


Testing a parser
----------------

Use `parseArgsSync()` with a synchronous parser, or `parseArgs()` when the
parser may be asynchronous.  The latter always returns a promise, including
when given a synchronous parser.

~~~~ typescript twoslash
import { command, option } from "@optique/core/primitives";
import { parseArgsSync } from "@optique/testing/parser";

const parser = command("serve", option("--watch"));
const result = parseArgsSync(parser, ["serve", "--watch"]);
//    ^?

if (result.success) {
  result.value; // boolean
} else {
  result.error;
  result.remainingArgs;
  result.commandPath;
}
~~~~

A failure reports the argument suffix that remained where parsing stopped.
`commandPath` contains the canonical names of commands matched before that
point, even when the input used a command alias.  Completion-time failures have
an empty `remainingArgs` array because the complete argument list was already
consumed.

Both helpers accept the same `ParseOptions` as the core parsing APIs, including
annotations.  They return parser failures as values, but exceptions thrown by
the parser still propagate.  `parseArgs()` likewise preserves promise
rejections.  Neither helper renders help, interprets `--help`/`--version`,
writes output, exits, or dispatches a command handler.


Testing a run
-------------

Use `captureRun()` to exercise the same runner behavior as `runAsync()` without
writing to process streams or terminating the test process.  It accepts either
a parser or a `Program` and always returns a promise.

~~~~ typescript twoslash
import { argument } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { captureRun } from "@optique/testing/run";

const parser = argument(string());
const result = await captureRun(parser, {
  args: ["--help"],
  programName: "greet",
  help: "option",
  colors: false,
  maxWidth: 80,
});

if (result.kind === "returned") {
  result.value; // string
} else {
  result.exitCode; // number
}
~~~~

A normal parse produces a `returned` result with the inferred parser value and
an exit code of zero.  Help, version, completion, and parse errors produce an
`exited` result with the requested exit code.  Both variants include separate
`stdout` and `stderr` strings with the same trailing newlines as the default
runner writers.

The `colors` and `maxWidth` options keep `runAsync()`'s defaults, which depend
on the test process's terminal.  Set both explicitly when asserting rendered
text so the result is stable between local terminals and CI.

The capture helper supplies `stdout`, `stderr`, and `onExit`, so callers cannot
override them.  Exceptions from parsers, contexts, option callbacks, or
resource disposal still reject the returned promise.  Output written directly
through `console.log()`, `print()`, or a process stream bypasses these callbacks
and is not captured.  Use the child-process layer when a test needs to observe
that output or run the application code that consumes the parsed value.


Testing command discovery and dispatch
--------------------------------------

Use `captureProgramRun()` to exercise `runProgram()`, including command loading,
lifecycle hooks, and handler dispatch.  Pass either a `dir` to discover command
modules or `commands` for a static registry, including entries returned by
`commandsFromModules()`.

This test checks both help and a parse error without running the handler:

~~~~ typescript twoslash
import assert from "node:assert/strict";
import { argument } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { defineCommand } from "@optique/discover/command";
import { captureProgramRun } from "@optique/testing/discover";

let calls = 0;
const greet = defineCommand({
  path: ["greet"],
  parser: argument(string()),
  handler() {
    calls++;
  },
});

const options = {
  commands: [greet],
  metadata: { name: "example" },
  colors: false,
  maxWidth: 80,
};

const help = await captureProgramRun({
  ...options,
  args: ["greet", "--help"],
});
assert.equal(help.exitCode, 0);
assert.match(help.stdout, /Usage:/);
assert.equal(help.stderr, "");

const failure = await captureProgramRun({ ...options, args: ["greet"] });
assert.equal(failure.exitCode, 1);
assert.notEqual(failure.stderr, "");
assert.equal(calls, 0);
~~~~

For dispatch, assert on an observable handler effect.  The helper waits for
asynchronous handlers and lifecycle cleanup before resolving:

~~~~ typescript twoslash
import assert from "node:assert/strict";
import { argument } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { defineCommand } from "@optique/discover/command";
import { captureProgramRun } from "@optique/testing/discover";

const greeted: string[] = [];
const greet = defineCommand({
  path: ["greet"],
  parser: argument(string()),
  async handler(name) {
    await Promise.resolve();
    greeted.push(name);
  },
});

const result = await captureProgramRun({
  commands: [greet],
  metadata: { name: "example" },
  args: ["greet", "Ada"],
  colors: false,
  maxWidth: 80,
});
assert.equal(result.exitCode, 0);
assert.deepEqual(greeted, ["Ada"]);
~~~~

`ProgramRunResult` contains `exitCode`, `stdout`, and `stderr`.  A normal
completion has exit code zero; help, version, completion, and parse errors
report the requested exit code.  It has no parsed value or `kind` field because
`runProgram()` dispatches the value to the selected handler.

`CaptureProgramRunOptions<R>` preserves `RunProgramOptions<R>`, including hook
resource types, but reserves `stdout`, `stderr`, and `onExit` for capture.
Each output callback appends its string followed by one newline, matching the
default writers, even when the string is empty or already ends in a newline.
The helper inherits argument, color, and width defaults from `runProgram()`;
set `args`, `colors`, and `maxWidth` explicitly for repeatable tests.

Errors from discovery, imports, handlers, hooks, and resource disposal reject
the promise according to `runProgram()`'s error handling, including its
`onError` rules.  They are not converted into exit results.  Commands and hooks
run in the test process, so their side effects are real.  Direct writes through
`console.log()`, `print()`, or process streams bypass capture; use a child
process to assert on those writes.


Testing a real CLI
------------------

Use `createCliRunner()` when the test needs to observe the complete application,
including direct console output, stdin, and process exit status:

~~~~ typescript twoslash
import assert from "node:assert/strict";
import { createCliRunner } from "@optique/testing/cli";

const cli = createCliRunner({
  entrypoint: new URL("./cli.mjs", import.meta.url),
});
const help = await cli.invoke("--help");
assert.equal(help.exitCode, 0);
assert.match(help.stdout, /Usage:/);

const result = await cli.invoke({
  args: ["greet"],
  stdin: "Ada\n",
  env: { GREETING: "Hello", DEBUG: undefined },
  timeout: 10_000,
});
assert.equal(result.stdout, "Hello, Ada!\n");
~~~~

`CliResult` contains separate UTF-8 `stdout` and `stderr` strings,
`exitCode: number | null`, and `signal: string | null`.  A nonzero exit code
is a result, including a CLI's parse error or uncaught handler exception.
A signal termination reports its signal instead of an exit code.  Output is
preserved without trimming, including CRLF, ANSI escapes, and trailing newlines.
The runner does not force color or terminal width settings; configure these in
your CLI or environment when asserting rendered text.

### Selecting a runtime

With `entrypoint`, the child uses the current runtime's executable.  Deno
receives `run` before the entry point; Node.js and Bun receive the entry point
directly.  `runtimeArgs` goes before the entry point.  Parent runtime flags are
not inherited, and the helper does not install dependencies, build TypeScript,
or infer a loader.  Use runnable JavaScript on Node.js versions that cannot
execute your TypeScript source directly, or supply an explicit loader.

Deno permissions must be explicit:

~~~~ typescript twoslash
import { createCliRunner } from "@optique/testing/cli";

const cli = createCliRunner({
  entrypoint: new URL("./cli.ts", import.meta.url),
  runtimeArgs: ["--allow-read", "--allow-env"],
});
~~~~

To select a different executable, supply a nonempty `command` array instead of
`entrypoint` and `runtimeArgs`:

~~~~ typescript twoslash
import { createCliRunner } from "@optique/testing/cli";

const cli = createCliRunner({ command: ["node", "./dist/cli.js"] });
await cli.invoke("--version");
~~~~

Commands and arguments are passed without a shell.  Spaces and shell
metacharacters remain literal; no quoting, splitting, or expansion is applied.

### Invocation settings

`invoke(...args)` accepts individual string arguments.  `invoke({ args, ... })`
adds per-call options; `args` defaults to an empty array.  `stdin` is a UTF-8
string and the input pipe always receives EOF, even when stdin is omitted.
The runner reads stdout and stderr concurrently while writing input.

`cwd`, `env`, `timeout`, `signal`, and `cleanup` can be set on the factory and
overridden on each invocation.  The factory fixes its working directory and
entry point to absolute paths when created.  A relative invocation `cwd` is
resolved against that factory directory and does not relocate the entry point.
Factory arrays, environment settings, and URL paths are copied, so later edits
to them do not change the runner.

The child inherits the parent's environment at invocation time, then applies
factory and per-call overrides in that order.  An `undefined` value removes a
variable from the supplied environment, although the runtime or operating
system may restore system variables such as `PATH`.  Environment names are
case-insensitive on Windows.  Invocations do
not change the parent process's environment or working directory and can run
concurrently.

The default `timeout` is 5,000 milliseconds; `0` disables it.  Values must be
integers between `0` and `2147483647`.  The limit includes output collection,
so an exited CLI whose descendants keep its pipes open can still time out.
An invocation `signal` replaces the factory signal.  An already-aborted signal
prevents the child from starting.

### Failures and cleanup

Execution failures, timeouts, cancellation, input/output failures, and cleanup
failures reject with `CliInvocationError`.  Its `reason` is `"spawn"`,
`"timeout"`, `"aborted"`, `"io"`, or `"cleanup"`, respectively.  The error
contains partial `stdout` and `stderr`, observed `exitCode` and `signal`, and
an underlying `cause` when available:

~~~~ typescript twoslash
import { CliInvocationError, createCliRunner } from "@optique/testing/cli";

const cli = createCliRunner({ entrypoint: "./cli.mjs", timeout: 1_000 });
try {
  await cli.invoke("serve");
} catch (error) {
  if (!(error instanceof CliInvocationError)) throw error;
  console.error(error.reason, error.stdout, error.stderr);
}
~~~~

Invalid factory options throw `TypeError` or `RangeError`; invalid invocation
options reject the promise.  If cleanup also fails, `reason` becomes
`"cleanup"` and an `AggregateError` cause preserves the original failure and
cleanup errors.

`cleanup: "child"` is the default and terminates only the direct child on
failure.  Choose `cleanup: "tree"` when the CLI starts other processes that
should also be terminated on failure.  On POSIX systems this creates a process
group, sends `SIGTERM`, waits up to one second, and then sends `SIGKILL` if
needed, allowing another second for final cleanup.  Windows terminates the
child forcibly; tree cleanup uses the system `taskkill.exe /T /F` with a
combined two-second bound for the tool and subsequent cleanup.  Cleanup time
is additional to the invocation timeout.

Tree cleanup handles ordinary descendants, not processes that escape their
group or become orphaned.  On Windows, if the direct child has already exited,
the runner does not start a new `taskkill` using its old PID.  Normal completion
does not trigger a process-tree sweep.  This helper is not a process sandbox;
fixtures that deliberately detach descendants need their own cleanup.


Shared contracts
----------------

The package root holds only the contracts that mean the same thing at more than
one boundary.  Today that is `CapturedOutput`, the pair of captured streams:

~~~~ typescript twoslash
import type { CapturedOutput } from "@optique/testing";

function assertQuiet(output: CapturedOutput): void {
  if (output.stderr !== "") throw new Error(output.stderr);
}
~~~~

The two streams stay separate and their text is preserved exactly, including
trailing newlines, so a test can assert which stream a message reached.

Results that differ by layer stay with the layer that produces them.  A parse
failure, an intentional runner exit, and a terminating signal are not the same
kind of outcome, and flattening them into one result shape would hide the
distinction that made these layers worth separating.
