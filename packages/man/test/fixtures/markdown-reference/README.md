Markdown reference example
==========================

This small CLI has three application commands: `serve`, `config`, and `docs`.
`config` contains `get` and `set`. Commands print parsed example data or the
reference; they start no server and change no settings.

*pages.ts* contains inert, authored documentation. *definitions.ts* contains
parser definitions. *cli.ts* owns startup and imports the Markdown renderer only
for `docs`. *build.ts* imports only pages and rendering, then writes the
requested file. The pages explicitly document this runner's help/version
options and completion command; they declare coverage rather than inspect
augmented grammar. The `REF_PORT` text demonstrates documentation of a binding
name and states that this fixture does not read that variable.

From the repository root:

~~~~ bash
mise deps
mise build
mise exec -- node packages/man/test/fixtures/markdown-reference/cli.ts serve --tag demo
mise exec -- node packages/man/test/fixtures/markdown-reference/cli.ts config get theme
mise exec -- node packages/man/test/fixtures/markdown-reference/cli.ts config set theme --format text
mise exec -- node packages/man/test/fixtures/markdown-reference/cli.ts docs
mise exec -- node packages/man/test/fixtures/markdown-reference/build.ts REFERENCE.md
~~~~

Deno can run these entries with
`deno run --allow-read --allow-write --allow-env`; Bun can run them with
`bun run`. Build and runtime reference outputs are tested for byte equality
under all three runtimes. *three-commands.expected.txt* is a hand-authored
golden for the renderer's caller-order contract.
