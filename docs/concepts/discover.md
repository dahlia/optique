---
description: >-
  Build command-oriented CLI applications by discovering Optique command
  modules from the file system and dispatching to command handlers.
---

Command discovery
=================

Optique's core command combinators work well when the whole command tree fits
comfortably in one module.  Larger applications often want a file layout where
each command owns its parser, metadata, and handler.  The *@optique/discover*
package provides that layer: it scans a command directory, imports command
modules, builds a nested parser tree, and dispatches to the matched command
handler.

The package is named *@optique/discover* because its main job is command module
discovery.  The alternative name *@optique/program* would overlap with
`@optique/core/program`, which already provides parser-and-metadata objects for
man pages and runner integration.

> [!WARNING]
> Command discovery is a runtime feature, not a static registry.  It reads the
> command directory and imports matching modules dynamically, so bundlers cannot
> reliably see which command files are used.  If your CLI depends on tree
> shaking, static bundling, or single-file executable packaging, use
> `commandsFromModules()` with a static module map, or import command modules
> manually and pass them to `runProgram()` with `commands`.


Command modules
---------------

A command module default-exports a value created with `defineCommand()`.
The parser describes the command-specific arguments and options, `metadata`
feeds help and completion output, and `handler` receives the parsed value.

~~~~ typescript twoslash
import { defineCommand } from "@optique/discover/command";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

export default defineCommand({
  parser: object({
    name: option("--name", string()),
  }),
  metadata: {
    brief: message`Add a user.`,
  },
  handler(value) {
    console.log(`Adding ${value.name}.`);
  },
});
~~~~

`defineCommand()` preserves the parser's inferred value type for `handler`.
If you change the parser, TypeScript checks the handler against the new shape.
When commands are passed manually to `runProgram()`, add a `path` field to the
command definition.  File-based discovery can omit `path`; if it is present,
it must match the path derived from the file name.  An empty path (`[]`)
defines the root command when commands are passed manually.


Running a discovered program
----------------------------

Point `runProgram()` at a command directory and provide root program metadata:

~~~~ typescript twoslash
import { runProgram } from "@optique/discover";
import { message } from "@optique/core/message";

await runProgram({
  dir: new URL("./commands/", import.meta.url),
  metadata: {
    name: "admin",
    version: "1.0.0",
    brief: message`Administrative command-line tools.`,
  },
});
~~~~

With this file layout:

~~~~ text
commands/
  index.ts
  build.ts
  user/
    index.ts
    add.ts
    remove.ts
~~~~

the discovered command paths are:

~~~~ bash
admin
admin build
admin user
admin user add
admin user remove
~~~~

`runProgram()` uses *@optique/run* internally.  Help and shell completion are
enabled in both command and option forms by default, and version output is
enabled when `metadata.version` is present:

~~~~ bash
admin --help
admin help
admin --version
admin completion bash
admin --completion bash
~~~~

You can disable or customize these runner features with the same option shapes
accepted by `run()`:

~~~~ typescript twoslash
import { runProgram } from "@optique/discover";
import { message } from "@optique/core/message";

await runProgram({
  dir: new URL("./commands/", import.meta.url),
  metadata: {
    name: "admin",
    brief: message`Administrative command-line tools.`,
  },
  help: { option: true },
  showUsage: false,
  commandList: "top-level",
  version: false,
  completion: false,
});
~~~~

`showUsage: false` is useful for larger command trees because root help can
act as a compact command menu: the program brief and command list remain, but
the expanded `Usage:` synopsis is omitted.  The same setting applies when
`aboveError: "help"` renders a full help page above a parse error.  Pass
`commandList: "top-level"` when the root command menu should list only
first-level command groups and let users drill down with `<command> --help`.


Running with static module maps
-------------------------------

Bundlers often provide a static module map API for glob imports.  For example,
Vite and Rollup-based toolchains can statically see `import.meta.glob()` when
the pattern is literal.  `commandsFromModules()` turns that module map into the
same command entries that file-system discovery would have produced:

~~~~ typescript twoslash
declare global {
  interface ImportMeta {
    glob(
      pattern: string,
      options: { readonly eager: true },
    ): Record<string, unknown>;
  }
}
// ---cut-before---
import { message } from "@optique/core/message";
import { commandsFromModules, runProgram } from "@optique/discover";

const modules = import.meta.glob("./commands/**/*.ts", { eager: true });

await runProgram({
  commands: commandsFromModules(modules, {
    base: "./commands",
    extensions: [".ts"],
  }),
  metadata: {
    name: "admin",
    version: "1.0.0",
    brief: message`Administrative command-line tools.`,
  },
});
~~~~

Each module value must expose a default export created with
`defineCommand()`.  The module map key is treated like a file path relative to
`base`, so *./commands/user/add.ts* becomes `user add`.  Entry files keep the
same meaning as runtime discovery: *./commands/index.ts* defines the root
command, and *./commands/user/index.ts* defines `user`.

Pass `extensions` when the module map keys keep source file suffixes such as
*.ts* after bundling.  Compound suffixes are matched with the same precedence
as dynamic discovery, and TypeScript declaration files such as *.d.ts*,
*.d.mts*, and *.d.cts* are ignored.

The returned entries can also be passed to `createProgramParser()` when you
want to build the parser directly instead of using `runProgram()`.


Generating static module maps
-----------------------------

If your toolchain does not provide an eager glob API, or you do not want to
maintain the static module map by hand, use the `optique-discover` command to
generate a TypeScript module:

~~~~ bash
optique-discover ./commands --output ./commands.generated.ts --extension .ts
~~~~

The generated module imports every command file and exports the
`commandsFromModules()` result as its default export:

~~~~ typescript twoslash
// @noErrors: 2307
// ---cut-before---
// biome-ignore-all lint: generated file
// biome-ignore-all format: generated file
// Generated by optique-discover. Do not edit.
/* eslint-disable */
// @ts-nocheck
// deno-lint-ignore-file
// deno-fmt-ignore-file

import { commandsFromModules } from "@optique/discover";
import * as cmd0 from "./commands/build.ts";
import * as cmd1 from "./commands/user/add.ts";

export default commandsFromModules(
  {
    "./commands/build.ts": cmd0,
    "./commands/user/add.ts": cmd1,
  },
  {
    base: "./commands",
    extensions: [".ts"],
  },
);
~~~~

Use that generated module from your CLI entry point:

~~~~ typescript twoslash
// @noErrors: 2307
// ---cut-before---
import { message } from "@optique/core/message";
import { runProgram } from "@optique/discover";
import commands from "./commands.generated.ts";

await runProgram({
  commands,
  metadata: {
    name: "admin",
    version: "1.0.0",
    brief: message`Administrative command-line tools.`,
  },
});
~~~~

Pass `--watch` during development to regenerate when command files are added,
removed, or renamed:

~~~~ bash
optique-discover ./commands --output ./commands.generated.ts \
  --extension .ts --watch
~~~~

Watch mode tracks the command file set, not file contents.  Editing a command
module does not rewrite the generated module because the module map has not
changed.

Generated modules include a fixed header with lint, formatter, TypeScript
check suppression, and machine-owned marker comments for tools that support
file-level comments.  Biome suppressions appear first because Biome expects
file-level suppressions at the beginning of the file.  The module map imports
command files as static TypeScript specifier strings, but command module
exports are still validated at runtime by `commandsFromModules()`.

Prettier and Oxfmt do not have a portable TypeScript file-level suppression
comment that `optique-discover` can emit by default.  Exclude the generated
module through formatter configuration instead, such as *.prettierignore* or
Oxfmt ignore paths.


Running manually imported commands
----------------------------------

For a small static command registry, or when you want to assign command paths
manually, import modules yourself and pass commands as `commands`.  Each
command declares its own path:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { withDefault } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { defineCommand, runProgram } from "@optique/discover";

const build = defineCommand({
  path: ["build"],
  parser: object({
    target: withDefault(option("--target", string()), "app"),
  }),
  metadata: {
    brief: message`Build the project.`,
  },
  handler(value) {
    console.log(`Building ${value.target}.`);
  },
});

await runProgram({
  commands: [build],
  metadata: {
    name: "admin",
    version: "1.0.0",
    brief: message`Administrative command-line tools.`,
  },
});
~~~~

`commands` and `dir` are mutually exclusive.  Use `commands` when static
imports matter; use `dir` when the runtime file layout is the command registry.
Prefer `commandsFromModules()` when you want to keep deriving paths from a
command directory layout.


Lifecycle hooks
---------------

*This API is available since Optique 1.2.0.*

`runProgram()` normally dispatches straight to the matched command's handler.
A `hooks` option wraps every handler with `beforeEach`, `afterEach`, and
`onError`, so cross-cutting concerns such as log scopes, tracing spans, lazy
resource setup, and failure reporting can live in one place instead of inside
every command.  Hooks are opt-in: a `runProgram()` call without them behaves
exactly as before.

~~~~ typescript twoslash
import { runProgram } from "@optique/discover";

interface HookResource {
  readonly label: string;
  readonly startedAt: number;
}

await runProgram<HookResource>({
  dir: new URL("./commands/", import.meta.url),
  metadata: { name: "admin", version: "1.0.0" },
  hooks: {
    beforeEach({ path }) {
      const label = path.length > 0 ? path.join(" ") : "admin";
      return { resource: { label, startedAt: Date.now() } };
    },
    afterEach(context) {
      const resource = context.resource;
      if (resource == null) return;
      const { label, startedAt } = resource;
      console.log(`${label} finished in ${Date.now() - startedAt}ms.`);
    },
    onError(_context, error) {
      console.error("Handler failed:", error);
    },
  },
});
~~~~

`beforeEach` receives the invocation: the matched command, its resolved command
`path` (always populated, even when a discovered command omits an explicit
`path`), the parsed value, and the handler.  It returns a context object whose
`resource` is threaded forward to the handler's second parameter and to
`afterEach`/`onError`, so handlers and later hooks reach the resource without
global state.  Each hook may be synchronous or return a promise; `runProgram()`
awaits it.

The type argument to `runProgram()` checks the resource returned by
`beforeEach` and exposes the same type to the later hooks.  The `resource`
property remains optional because `beforeEach` may return `null` or `void`.
File-discovered command handlers live in separate modules, so annotate their
second parameter with `ProgramHookContext<HookResource>` when they consume the
same program-level resource.

Hooks can also be attached to a single command through
`defineCommand({ hooks })` for a per-command preflight.  Command-level hooks
nest inside the program-level ones, and teardown unwinds in reverse:

~~~~ mermaid
flowchart TB
  pb["program.beforeEach"] --> cb["command.beforeEach"] --> h["handler"]
  h -- success --> ca["command.afterEach"] --> pa["program.afterEach"]
  h -- failure --> ce["command.onError"] --> pe["program.onError"]
~~~~

A *parse error*, such as a missing option or an invalid value, is handled by
*@optique/run*'s error display before any handler or hook runs; `beforeEach`
does not fire for it.  A *handler error*, anything the handler, `beforeEach`, or
`afterEach` throws or rejects, is passed to `onError`.  `onError` observes and
cleans up but does not swallow the error: `runProgram()` re-throws it afterward,
so process exit codes are unchanged.

For a worked example with LogTape scopes and tracing spans, plus a per-command
preflight, see the [program-level lifecycle hooks
recipe](../cookbook.md#program-level-lifecycle-hooks) in the cookbook.


File names and extensions
-------------------------

The relative file path becomes the command path after removing the configured
suffix.  `commandsFromModules()` applies the same rule to module map keys after
stripping its `base` option.  Compound suffixes are supported, so
*user/add.cmd.ts* can become `user add` when *.cmd.ts* is listed before *.ts*.

By default, an entry file named *index* maps to its containing command path:

~~~~ text
commands/
  index.ts         # admin
  stash/
    index.ts       # admin stash
    list.ts        # admin stash list
    pop.ts         # admin stash pop
~~~~

This is useful for executable parent commands.  In the example above,
`admin stash` has its own parser and handler, while `admin stash list` and
`admin stash pop` remain nested commands.

By default, *@optique/discover* chooses extensions for the current runtime:

| Runtime | Default extensions                                  |
| ------- | --------------------------------------------------- |
| Deno    | *.ts*, *.mts*, *.js*, *.mjs*                        |
| Bun     | *.ts*, *.mts*, *.js*, *.mjs*                        |
| Node.js | *.js*, *.mjs*, *.cjs*, and sometimes TypeScript too |

Node.js also includes *.ts*, *.mts*, and *.cts* when it appears to be running
with native TypeScript support, a TypeScript loader such as `tsx`, `ts-node`,
`tsimp`, or `jiti`, or Node's built-in type-stripping flags.

TypeScript declaration files (*.d.ts*, *.d.mts*, and *.d.cts*) and test files
(*.spec.*, *.test.*) are ignored even when their suffix matches the configured
extension list.

Pass `extensions` when you want an explicit policy:

~~~~ typescript twoslash
import { runProgram } from "@optique/discover";

await runProgram({
  dir: new URL("./commands/", import.meta.url),
  metadata: { name: "admin" },
  extensions: [".cmd.ts"],
});
~~~~

Pass `entryFileName` to use a different entry filename, such as *mod* for a
Deno-style layout:

~~~~ typescript twoslash
import { runProgram } from "@optique/discover";

await runProgram({
  dir: new URL("./commands/", import.meta.url),
  metadata: { name: "admin" },
  entryFileName: "mod",
});
~~~~

Pass `entryFileName: false` to disable entry-file handling and treat
*index.ts* as an ordinary `index` command.

> [!NOTE]
> Command modules are imported eagerly during startup.  This keeps discovery
> simple and makes help, errors, and completion aware of the full command tree.
> Avoid side effects at module top level other than defining the command.


Duplicate paths
---------------

Each discovered file must map to exactly one command path.  Discovery rejects
duplicate paths, such as *build.ts* and *build.cmd.ts* both becoming `build`.
It also rejects duplicates introduced by entry files, such as *user.ts* and
*user/index.ts* both becoming `user`.

A file and directory with the same name are allowed when they map to distinct
command paths:

~~~~ text
commands/
  user.ts          # user
  user/
    add.ts         # user add
~~~~

In that layout, `user` is an executable parent command and `user add` is a
nested command.  You can also write the parent command as *user/index.ts*
instead of *user.ts*, but not both at once unless you change `entryFileName`.


When to use command discovery
-----------------------------

Use *@optique/discover* when:

 -  Your CLI has enough commands that a file-per-command layout is clearer
 -  Each command should keep its parser, help metadata, and handler together
 -  You want *@optique/run* help, version, and completion behavior without
    manually composing the whole command tree

Use static `commands` with manually imported command modules when:

 -  You need tree shaking, static bundling, or single-file executable
    packaging, and your toolchain does not provide a static module map
 -  You want to assign command paths by hand instead of deriving them from
    module paths

Use `commandsFromModules()` with a static module map when:

 -  You need tree shaking, static bundling, or single-file executable
    packaging
 -  You want command modules to be visible to the bundler while keeping the
    file layout as the command registry

Use `optique-discover` when:

 -  You want a checked-in or generated static command module instead of a
    bundler-specific glob API
 -  You want watch mode to keep the generated module in sync when command files
    are added, removed, or renamed

Use plain *@optique/core* and *@optique/run* when:

 -  The command tree is small enough to define directly with `command()` and
    `or()`
 -  You need lazy command loading or a custom plugin registry
 -  You want to parse commands without coupling them to handlers
