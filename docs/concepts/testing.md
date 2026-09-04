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

The parser and runner helpers are available now.  The discovery and
child-process helpers remain reserved while their respective parts of
[issue #890] land.

[issue #890]: https://github.com/dahlia/optique/issues/890


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
