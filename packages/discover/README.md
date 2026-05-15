@optique/discover
=================

Runtime-aware command discovery for Optique CLI programs.

Use *@optique/discover* when your CLI has many commands and you want the
command tree to come from files instead of one large `or(command(...))`
definition.  Each command module exports a `defineCommand()` result, and
`runProgram()` discovers those modules, builds a parser tree, enables help,
version, and shell completion, then dispatches to the selected command's
handler.


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

By default, Deno and Bun discover `.ts`, `.mts`, `.js`, and `.mjs` files.
Node.js discovers `.js`, `.mjs`, and `.cjs` files unless it is running with a
recognized TypeScript loader.  TypeScript declaration files such as `.d.ts`
are ignored.

For more resources, see the [docs] and the [*examples/*](/examples/)
directory.

[docs]: https://optique.dev/concepts/discover
