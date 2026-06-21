@optique/discover
=================

Runtime-aware command discovery for Optique CLI programs.

Use *@optique/discover* when your CLI has many commands and you want the
command tree to come from files instead of one large `or(command(...))`
definition.  Each command module exports a `defineCommand()` result, and
`runProgram()` discovers those modules, builds a parser tree, enables help,
version, and shell completion, then dispatches to the selected command's
handler.

> [!WARNING]
> *@optique/discover* reads command files and imports them dynamically at
> runtime.  It is a poor fit for CLIs that rely on aggressive tree shaking,
> static bundling, or single-file executable packaging.  In those cases, use
> manually imported commands with `runProgram({ commands })`.


Installation
------------

~~~~ bash
deno add jsr:@optique/discover jsr:@optique/core jsr:@optique/run
npm  add     @optique/discover     @optique/core     @optique/run
pnpm add     @optique/discover     @optique/core     @optique/run
yarn add     @optique/discover     @optique/core     @optique/run
~~~~


Quick example
-------------

Create command modules under a directory:

~~~~ typescript
// commands/user/add.ts
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

Then run the discovered program from your entry point:

~~~~ typescript
// cli.ts
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

The file path becomes the command path, so the example above is available as:

~~~~ bash
admin user add --name Ada
admin --help
admin completion bash
~~~~

For bundlers and single-file packagers, import commands manually and declare
their paths in the command definitions:

~~~~ typescript
// cli.ts
import { defineCommand, runProgram } from "@optique/discover";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const addUser = defineCommand({
  path: ["user", "add"],
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

await runProgram({
  commands: [addUser],
  metadata: {
    name: "admin",
    version: "1.0.0",
    brief: message`Administrative command-line tools.`,
  },
});
~~~~

By default, Deno and Bun discover `.ts`, `.mts`, `.js`, and `.mjs` files.
Node.js discovers `.js`, `.mjs`, and `.cjs` files, plus `.ts`, `.mts`, and
`.cts` when it reports native TypeScript support or runs with a recognized
TypeScript loader.  TypeScript declaration files such as `.d.ts` are ignored.
Entry files named `index` map to their containing command path, so
`commands/index.ts` defines the root command and `commands/user/index.ts`
defines `user`.  Use `entryFileName` to choose another entry name or disable
this rule.

For more resources, see the [docs] and the [*examples/*](/examples/)
directory.

[docs]: https://optique.dev/concepts/discover
