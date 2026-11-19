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

The npm package for *@optique/core* bundles the Optique skill. Linking the
bundled copy keeps the skill on the same version as the library.

#### pnpm 12.11.0 and later

With [pnpm's built-in Agent Skills support], you don't need *skills-npm*.
After adding *@optique/core* as a direct dependency, run:

~~~~ bash
pnpm approve
~~~~

Select *@optique/core* in the approval prompt. The first time you approve
a skill in the project, pnpm also asks where to link it. pnpm records the
approval in *pnpm-workspace.yaml*.

#### npm, Bun, and older pnpm versions

Use [skills-npm] if you install with npm, Bun, or a version of pnpm older than
12.11.0:

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

[pnpm's built-in Agent Skills support]: https://pnpm.io/agent-skills
[skills-npm]: https://github.com/antfu/skills-npm

### Install for Claude Code

Claude Code users can install the same skill through Optique's
[plugin marketplace]:

~~~~ bash
claude plugin marketplace add dahlia/optique
claude plugin install optique@optique
~~~~

[plugin marketplace]: https://code.claude.com/docs/en/plugin-marketplaces
