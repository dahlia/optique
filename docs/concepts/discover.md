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
> shaking, static bundling, or single-file executable packaging, import command
> modules manually and pass them to `runProgram()` with `commands`.


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
  version: false,
  completion: false,
});
~~~~


Running statically imported commands
------------------------------------

When command modules need to be visible to a bundler or single-file packager,
import them manually and pass them as `commands`.  Each command declares its
own path:

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


File names and extensions
-------------------------

The relative file path becomes the command path after removing the configured
suffix.  Compound suffixes are supported, so `user/add.cmd.ts` can become
`user add` when `.cmd.ts` is listed before `.ts`.

By default, an entry file named `index` maps to its containing command path:

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
| Deno    | `.ts`, `.mts`, `.js`, `.mjs`                        |
| Bun     | `.ts`, `.mts`, `.js`, `.mjs`                        |
| Node.js | `.js`, `.mjs`, `.cjs`, and sometimes TypeScript too |

Node.js also includes `.ts`, `.mts`, and `.cts` when it appears to be running
with native TypeScript support, a TypeScript loader such as `tsx`, `ts-node`,
`tsimp`, or `jiti`, or Node's built-in type-stripping flags.

TypeScript declaration files (`.d.ts`, `.d.mts`, and `.d.cts`) are ignored even
when their suffix matches the configured extension list.

Pass `extensions` when you want an explicit policy:

~~~~ typescript twoslash
import { runProgram } from "@optique/discover";

await runProgram({
  dir: new URL("./commands/", import.meta.url),
  metadata: { name: "admin" },
  extensions: [".cmd.ts"],
});
~~~~

Pass `entryFileName` to use a different entry filename, such as `mod` for a
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
`index.ts` as an ordinary `index` command.

> [!NOTE]
> Command modules are imported eagerly during startup.  This keeps discovery
> simple and makes help, errors, and completion aware of the full command tree.
> Avoid side effects at module top level other than defining the command.


Duplicate paths
---------------

Each discovered file must map to exactly one command path.  Discovery rejects
duplicate paths, such as `build.ts` and `build.cmd.ts` both becoming `build`.
It also rejects duplicates introduced by entry files, such as `user.ts` and
`user/index.ts` both becoming `user`.

A file and directory with the same name are allowed when they map to distinct
command paths:

~~~~ text
commands/
  user.ts          # user
  user/
    add.ts         # user add
~~~~

In that layout, `user` is an executable parent command and `user add` is a
nested command.  You can also write the parent command as `user/index.ts`
instead of `user.ts`, but not both at once unless you change `entryFileName`.


When to use command discovery
-----------------------------

Use *@optique/discover* when:

 -  Your CLI has enough commands that a file-per-command layout is clearer
 -  Each command should keep its parser, help metadata, and handler together
 -  You want *@optique/run* help, version, and completion behavior without
    manually composing the whole command tree

Use static `commands` with manually imported command modules when:

 -  You need tree shaking, static bundling, or single-file executable
    packaging
 -  You want command modules to be visible through ordinary static imports

Use plain *@optique/core* and *@optique/run* when:

 -  The command tree is small enough to define directly with `command()` and
    `or()`
 -  You need lazy command loading or a custom plugin registry
 -  You want to parse commands without coupling them to handlers
