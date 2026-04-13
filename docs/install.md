---
description: >-
  Instructions for installing Optique.
---

Installation
============

Optique is a family of packages. Most users start with the two foundational
packages, each of which is available on both JSR and npm:

::: code-group

~~~~ bash [Deno]
deno add --jsr @optique/core @optique/run
~~~~

~~~~ bash [npm]
npm add @optique/core @optique/run
~~~~

~~~~ bash [pnpm]
pnpm add @optique/core @optique/run
~~~~

~~~~ bash [Yarn]
yarn add @optique/core @optique/run
~~~~

~~~~ bash [Bun]
bun add @optique/core @optique/run
~~~~

:::

Additional packages provide integrations for config files, environment
variables, prompts, Temporal, Git, schema validators, LogTape, and man page
generation.

You may want to use Optique in a web browser, in which case you would only
install the *@optique/core* package:

::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/core
~~~~

~~~~ bash [npm]
npm add @optique/core
~~~~

~~~~ bash [pnpm]
pnpm add @optique/core
~~~~

~~~~ bash [Yarn]
yarn add @optique/core
~~~~

~~~~ bash [Bun]
bun add @optique/core
~~~~

:::
