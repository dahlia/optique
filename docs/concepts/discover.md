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
  build.ts
  user/
    add.ts
    remove.ts
~~~~

the discovered command paths are:

~~~~ bash
admin build
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


File names and extensions
-------------------------

The relative file path becomes the command path after removing the configured
suffix.  Compound suffixes are supported, so `user/add.cmd.ts` can become
`user add` when `.cmd.ts` is listed before `.ts`.

By default, *@optique/discover* chooses extensions for the current runtime:

| Runtime | Default extensions           |
| ------- | ---------------------------- |
| Deno    | `.ts`, `.mts`, `.js`, `.mjs` |
| Bun     | `.ts`, `.mts`, `.js`, `.mjs` |
| Node.js | `.js`, `.mjs`, `.cjs`        |

Node.js also includes `.ts`, `.mts`, and `.cts` when it appears to be running
with a TypeScript loader such as `tsx`, `ts-node`, `tsimp`, or `jiti`, or with
Node's built-in type-stripping flags.

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

> [!NOTE]
> Command modules are imported eagerly during startup.  This keeps discovery
> simple and makes help, errors, and completion aware of the full command tree.
> Avoid side effects at module top level other than defining the command.


Path conflicts
--------------

Each discovered file must map to exactly one command path.  Discovery rejects
duplicate paths, such as `build.ts` and `build.cmd.ts` both becoming `build`.
It also rejects file-vs-namespace conflicts such as:

~~~~ text
commands/
  user.ts
  user/
    add.ts
~~~~

In that layout, `user` would need to be both a leaf command and a namespace for
`user add`.  Move the shared behavior into a helper module or choose a deeper
leaf command path instead.


When to use command discovery
-----------------------------

Use *@optique/discover* when:

 -  Your CLI has enough commands that a file-per-command layout is clearer
 -  Each command should keep its parser, help metadata, and handler together
 -  You want *@optique/run* help, version, and completion behavior without
    manually composing the whole command tree

Use plain *@optique/core* and *@optique/run* when:

 -  The command tree is small enough to define directly with `command()` and
    `or()`
 -  You need lazy command loading or a custom plugin registry
 -  You want to parse commands without coupling them to handlers
