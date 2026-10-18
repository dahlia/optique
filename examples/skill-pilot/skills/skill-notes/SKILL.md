---
name: "skill-notes"
description: "Count lines in local notes or save supplied input to a new file with the skill-notes example CLI. Use for the two documented file/stdin workflows, including invalid-input recovery."
license: "MIT"
metadata:
  cli-version: "1.4.0"
---

Using skill-notes
=================

Tested with skill-notes 1.4.0.

This skill is for *using* the private skill-notes example application. It does
not teach Optique library development. Use it to count lines or copy supplied
input into a new file. It supplies facts for an execution decision and grants
no permission to read or write a path.


Install and check the version
-----------------------------

The fixture is unpublished. Obtain its locally packed archive from the Optique
checkout maintainer; do not look for a registry package. Building requires the
checkout's mise-managed pnpm, Bun and Node.js tools. From the checkout root:

~~~~ bash
mise deps
mise skill-pilot:build
pnpm --dir examples/skill-pilot pack --pack-destination ../../tmp
~~~~

Install that archive in a separate project with Node.js 24.15+ and pnpm 11:

~~~~ bash
pnpm add --offline /absolute/path/to/skill-notes-1.4.0.tgz
~~~~

Put that project's *node\_modules/.bin* on PATH, or use its absolute
*skill-notes* path. Copy this entire *skill-notes/* directory, including
*references/*, to the location from which your agent reads skills. Nothing
needs a live documentation site. Check the installed application's version:

<!-- example: version -->

~~~~ bash
skill-notes --version
~~~~

~~~~ text
1.4.0
~~~~

Exit status: 0 (stdout).

Stop if the version differs. Obtain a matching bundle or have the application
author rerun the workflow checks and update it; do not assume newer syntax or
effects match. The examples below start with a file *notes.txt* containing
`alpha` and `beta`, each followed by LF, for 11 UTF-8 bytes.


Count a note file
-----------------

Read the chosen local input path and report its line count to stdout. This
workflow creates or changes no files in the tested working directory. It uses
no credentials or external services and asks no questions. File input ignores
stdin; it does not wait for piped input. An input of `-` instead reads stdin
until EOF, so redirect a file for noninteractive use. At a terminal it waits
for EOF; terminal interaction was not tested.

<!-- example: count-file -->

~~~~ bash
skill-notes count notes.txt
~~~~

~~~~ text
{"lines":2}
~~~~

Exit status: 0 (stdout).

A line ends at LF; a nonempty final fragment is also a line. Empty input has
zero lines. CR is ordinary content, including in CRLF input. See the
[command reference] for redirected stdin and boundary behavior.

[command reference]: references/commands.md


Save supplied input to a new file
---------------------------------

Only run this workflow when the user authorized the destination. Read bytes
from the explicitly selected file or `-` stdin, then create the named output
file exclusively. No parent directories are created. An existing destination,
including a symlink, causes failure without overwriting it. The input is read
completely before the output is opened. stdout reports the byte count; it does
not contain the saved contents.

This workflow needs no credentials or external services and asks no questions.
With `-`, supply redirected/piped input and close it at EOF. At a terminal it
waits for EOF; only redirected UTF-8 stdin was tested. For the sample input:

<!-- example: save-stdin -->

~~~~ bash
skill-notes save - --output saved.txt < notes.txt
~~~~

~~~~ text
Saved 11 bytes.
~~~~

Exit status: 0 (stdout).

The result is a new *saved.txt* containing exactly the 11 input bytes. Choose a
new authorized path if it already exists. A late write failure may leave a
partially written new file: this small fixture does not offer atomic writes or
rollback. See [documented examples] for exact streams, statuses and arguments.

[documented examples]: references/examples.json


Recover from invalid input
--------------------------

An unknown option fails before file IO, prints to stderr, and exits with 1:

<!-- example: invalid -->

~~~~ bash
skill-notes count --bad notes.txt
~~~~

~~~~ text
Error: Unexpected option or subcommand: `--bad`.
~~~~

Exit status: 1 (stderr).

Remove the unsupported option and retry the read-only command:

<!-- example: recovery -->

~~~~ bash
skill-notes count notes.txt
~~~~

~~~~ text
{"lines":2}
~~~~

Exit status: 0 (stdout).

File-operation failures also exit with 1 and write a concise stderr message;
see the [command reference]. Successful commands and version/help exit with 0.
Normal workflow output has no ANSI escapes.


Coverage and limits
-------------------

This bundle covers `count`, `save`, `--version`, invalid-input recovery, file
input and explicit `-` stdin. `--help` is available but its full layout is not
maintained here. Completion and other applications are outside this specimen.
The reference states literal output-path behavior, including `--output -`.

Tests compare the whole test-owned working directory before and after each
documented invocation. They do not prove absence of effects elsewhere. Late
write failures, special files, concurrent path changes and interactive terminals
are untested. Arbitrary bytes are tested through file input, while stdin checks
use UTF-8 text. The observed host is Linux; Windows symlink checks are skipped.
The in-memory read buffers are unbounded, so use small inputs for this pilot.

Before releasing a changed CLI: revise command definitions, update this bundle
and its [documented examples], rerun parser and three-runtime workflow checks,
then review each effect description against the implementation. Revise the
version in both metadata and body. A core error wording change also requires
updating the checked recovery example; English error text is not a protocol.
