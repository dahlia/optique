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


Agent Skills
------------

Optique includes an official [Agent Skill] that gives compatible AI coding
agents concise instructions for using the library and points them to the
maintained documentation when they need more detail.

[Agent Skill]: https://agentskills.io/

### Install from GitHub

The [skills CLI] installs the skill directly from the Optique repository:

::: code-group

~~~~ bash [npx]
npx skills add dahlia/optique --skill optique
~~~~

~~~~ bash [pnpm]
pnpm dlx skills add dahlia/optique --skill optique
~~~~

~~~~ bash [Bun]
bunx skills add dahlia/optique --skill optique
~~~~

:::

[skills CLI]: https://github.com/vercel-labs/skills

### Keep the skill aligned with the npm package

If your project installs *@optique/core* from npm, [skills-npm] can use the
skill bundled with that package.  This keeps the skill on the same version as
the library:

::: code-group

~~~~ bash [npm]
npm add --save-dev skills-npm
npx skills-npm setup
~~~~

~~~~ bash [pnpm]
pnpm add --save-dev skills-npm
pnpm exec skills-npm setup
~~~~

~~~~ bash [Bun]
bun add --dev skills-npm
bunx skills-npm setup
~~~~

:::

[skills-npm]: https://github.com/antfu/skills-npm

### Install for Claude Code

Claude Code users can install the same skill through Optique's
[plugin marketplace]:

~~~~ bash
claude plugin marketplace add dahlia/optique
claude plugin install optique@optique
~~~~

[plugin marketplace]: https://code.claude.com/docs/en/plugin-marketplaces
