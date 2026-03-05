---
layout: home

hero:
  name: Optique
  text: Type-safe combinatorial CLI parser for TypeScript
  tagline: Express CLI constraints in code structure,<br>not validation logic.
  image:
    src: /optique.svg
    alt: Optique logo
  actions:
  - theme: brand
    text: Get started
    link: /install
  - theme: alt
    text: Why Optique?
    link: /why
  - theme: alt
    text: Tutorial
    link: /tutorial
  - theme: alt
    text: GitHub
    link: https://github.com/dahlia/optique

features:
- icon: 🧩
  title: Composable by design
  details: >-
    Build parsers from small functions and combine them with
    <code>merge()</code> for option groups and <code>or()</code> for
    alternatives. Parser components can be shared across commands while
    preserving type information.
  link: /why
  linkText: Why parser combinators?
- icon: ⚡
  title: Automatic type inference
  details: >-
    TypeScript infers result types from parser composition, including
    discriminated unions for subcommands and optional fields. Most code
    requires no manual type annotations.
  link: /tutorial
  linkText: See it in the tutorial
- icon: 🎯
  title: Option group constraints
  details: >-
    <code>or()</code> lets you express mutually exclusive option groups at
    the type level. The constraint is encoded in the parser structure, so
    invalid combinations are rejected at parse time rather than in
    application code.
  link: /why#complex-option-constraints-made-simple
  linkText: See the comparison
- icon: 🐚
  title: Shell completion
  details: >-
    Generates completion scripts for Bash, zsh, fish, PowerShell, and
    Nushell from parser definitions. Completion suggestions for
    <code>choice()</code> values, subcommands, and inter-option dependencies
    stay current with the parser.
  link: /concepts/completion
  linkText: Shell completion docs
- icon: 📄
  title: Man page generation
  details: >-
    <em>@optique/man</em> generates Unix man pages in standard
    <code>man(7)</code> roff format from parser definitions. Options,
    subcommands, and their descriptions are derived from the same structure
    that drives parsing.
  link: /concepts/man
  linkText: Man page docs
- icon: 📦
  title: Integration packages
  details: >-
    Packages for config files (<em>@optique/config</em>), environment
    variables (<em>@optique/env</em>), interactive prompts
    (<em>@optique/inquirer</em>), Zod and Valibot schemas, Git references,
    and Temporal dates.
  link: /integrations/config
  linkText: Browse integrations
---

