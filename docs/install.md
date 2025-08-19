---
description: >-
  Instructions for installing Optique.
---

Installation
============

Optique consists of two packages, each of which is both a JSR package and
a npm package.  You would typically install both packages:

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
