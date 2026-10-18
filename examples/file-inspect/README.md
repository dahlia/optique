File inspection from source to executable
=========================================

This read-only CLI connects static command registration, typed handlers, program
hooks, and tests to two local distribution recipes. It has two commands:

 -  `file info PATH` prints JSON with the supplied path and size in bytes.
 -  `file lines PATH` counts LF-delimited lines. Use `-` explicitly for stdin.
    Empty input has zero lines; a final unterminated segment counts as a line.
    Counting uses raw bytes, so CRLF input and UTF-8 sequences split across
    chunks need no decoding.

Successful commands write results to stdout and exit 0. Invalid or extra
arguments and file or handler errors write to stderr and exit 1. Handler errors
have a concise `file-inspect:` prefix and no stack trace. There are no prompts,
credentials, network requests, or writes to inspected files.


Run from a checkout
-------------------

Start at the repository root. Install [mise], then use its pinned Node.js 26,
Deno 2.9, Bun 1.3, and pnpm 11 toolchains. Source execution requires Node.js
24.15 or later; the build needs Bun 1.3.14 or later. The verified run used
Bun 1.3.14. The packaging smoke recipe
is verified on Linux x64 with Bash and `tar`; it is not a cross-platform release
pipeline. Exact tool versions and artifact hashes are recorded by the smoke run.

~~~~ bash
mise install
mise file-inspect:deps
mise file-inspect:build
mkdir -p tmp
printf 'one\ntwo\n' > tmp/file-inspect.txt
mise exec -- node examples/file-inspect/src/cli.ts file info tmp/file-inspect.txt
mise exec -- node examples/file-inspect/src/cli.ts file lines tmp/file-inspect.txt
~~~~

The results are `{"path":"tmp/file-inspect.txt","bytes":8}` and `2`.
The `mkdir` and `printf` lines create the sample file. The CLI only reads it.

~~~~ bash
# A parse error, with status 1:
mise exec -- node examples/file-inspect/src/cli.ts file lines tmp/file-inspect.txt extra
# Explicit stdin, with status 0 and output 2:
printf 'one\ntwo' | mise exec -- node examples/file-inspect/src/cli.ts file lines -
mise exec -- node examples/file-inspect/src/cli.ts --help
mise exec -- node examples/file-inspect/src/cli.ts --version
~~~~

Only `file lines -` reads stdin. File operations, help, version, completion and
parse failures finish even when an inherited input pipe remains open.

[mise]: https://mise.jdx.dev/


Follow the command and resource types
-------------------------------------

Paths in this section are relative to *examples/file-inspect*.

*src/commands/info.ts* and *src/commands/lines.ts* export `defineCommand()`
definitions with explicit nested paths. Each parser infers its handler's input;
only the optional `ProgramHookContext<InputScope>` needs an annotation.
*src/program.ts* imports both definitions statically and supplies `commands`
and `metadata` to `runProgram<InputScope>()` in *src/cli.ts*. Definitions can be
imported by tests without starting the executable.

Program-level `beforeEach` creates one lazy input opener. The handler guards
`context?.resource`, then calls `open(value.path)`. The
scope owns read-only file handles and releases them in `afterEach` or `onError`.
A failing `afterEach` also triggers `onError`, so cleanup can run twice and is
idempotent.
The scope never destroys inherited stdin; the runtime may finalize a stream
after natural EOF. Source contexts are disposed after parsing and must not own
these handler-time file handles.

For a larger tree, [generate a static module map] instead of maintaining the
imports by hand. File-system discovery imports command modules at runtime and
is not the registration strategy used by either build in this example.

[generate a static module map]: https://optique.dev/concepts/discover.html#generating-static-module-maps


Test the boundaries
-------------------

~~~~ bash
mise file-inspect:test
~~~~

The task builds the workspace dependencies, including *@optique/testing*, and
runs the example under Deno, Node.js, and Bun. Deno checks the inferred handler
values and checks that a mismatched `runProgram<R>()` resource type fails to
type-check. Node.js and Bun
execute TypeScript without checking those types.

`captureProgramRun()` tests pin colors and width. They check that metadata and
parse failures skip all handlers and resource hooks. Real file-close counters
verify success, a handler failure after acquisition, and a hook failure after
cleanup. Handler/hook errors remain rejected promises. The injected resource
writer lets these tests assert handler results separately: direct handler writes
to stdout bypass `captureProgramRun()`'s captured runner output.

Subprocess tests invoke *src/cli.ts* itself, checking stdout, stderr, status,
missing files, non-TTY output without ANSI, and stdin EOF. Linux tests also
reject a FIFO without a writer and verify concise output errors with `/dev/full`
(using Bash and `mkfifo`). A separate spawn test
holds stdin open while file and metadata invocations finish. This is a bounded
observation, not a guarantee about arbitrary user-provided callbacks.


Install a local npm package
---------------------------

~~~~ bash
mise file-inspect:smoke
~~~~

On Linux x64 this tests the packed npm command and standalone executable
from outside the checkout. Bun
bundles the checkout's built Optique packages into *dist/package/cli.js* for
Node.js. The build checks its input graph and emitted imports. The private
staging manifest has an ESM JavaScript `bin` and no runtime dependencies. The
only remaining computed import belongs to unused file discovery; the static
application never enters that branch.

The smoke script uses `pnpm pack`, checks the tarball file list and manifest,
then installs it with `--offline`, an empty store and an invalid registry
address. It verifies the installed package resolves inside the temporary
consumer and its bytes match the bundle. No source files or workspace links are
installed. The source package and staged package both stay private; nothing is
published.

The resulting tarball remains at *examples/file-inspect/dist/file-inspect.tgz*.
To install it yourself, run these commands from the repository root:

~~~~ bash
tarball="$PWD/examples/file-inspect/dist/file-inspect.tgz"
consumer=$(mktemp -d)
printf '{"private":true}\n' > "$consumer/package.json"
mise exec -- pnpm --dir "$consumer" add --offline --ignore-scripts \
  --store-dir "$consumer/store" --registry=http://127.0.0.1:9 "$tarball"
mise exec -- "$consumer/node_modules/.bin/file-inspect" --version
~~~~

The installed command needs Node.js on `PATH`. The smoke test runs the same bin
from a working directory outside the repository. Its temporary consumer is
deleted afterward; the manual consumer above remains until you remove it.


Build a standalone executable
-----------------------------

~~~~ bash
mise file-inspect:standalone
./examples/file-inspect/dist/file-inspect file lines tmp/file-inspect.txt
~~~~

The task runs `bun build --compile` on the exact verified JavaScript bundle for
the current host. It records the input hash, actual compiler command/version
and executable hash in *dist/standalone-evidence.json*. Dotenv and bunfig
autoload are disabled. The resulting executable embeds Bun and needs no
separate JavaScript runtime. No cross-compilation target is claimed as tested.

`mise file-inspect:smoke` copies this executable outside the checkout and checks
normal commands, stdin, help/version, parse errors and missing files with an
empty `PATH`. It also places a color-forcing *.env* and invalid *bunfig.toml* in
the consumer to verify those files are not loaded. The bounded report is
*dist/evidence.json*, alongside *dist/build-evidence.json* and
*dist/bundle-meta.json*. CI uploads the reports rather than the executable.

See Bun's [standalone executable guide] for compiler behavior and platform
requirements beyond this tested recipe.

[standalone executable guide]: https://bun.sh/docs/bundler/executables


Bash completion
---------------

After the manual package install, put the installed bin on `PATH` and generate
the script in the same shell, where `$consumer` is still set. These commands
affect only your current shell and the named file:

~~~~ bash
export PATH="$consumer/node_modules/.bin:$PATH"
mkdir -p tmp/completions
mise exec -- file-inspect completion bash > tmp/completions/file-inspect.bash
source tmp/completions/file-inspect.bash
~~~~

Typing `file-inspect file ` then Tab suggests `info` and `lines`. CI sources
the script in `bash --norc --noprofile` with a temporary home directory and the
installed command on `PATH`, sets `COMP_WORDS`/`COMP_CWORD`, and calls the
registered completion function to assert those suggestions. It never edits a
shell profile. Remove the completion with:

~~~~ bash
complete -r file-inspect
rm tmp/completions/file-inspect.bash
~~~~
