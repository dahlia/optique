---
layout: home

hero:
  name: Optique
  text: Type-safe combinatorial CLI parser for TypeScript
  tagline: Express CLI constraints in code structure,<br>not validation logic
  image:
    src: /optique.svg
    alt: Optique logo
  actions:
  - theme: brand
    text: Install
    link: /install
  - theme: alt
    text: Why
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
    Build CLI interfaces from simple, reusable parser components.
    Share option groups across commands while preserving type information,
    making it easier to maintain consistent interfaces.
- icon: ⚡
  title: Automatic type inference
  details: >-
    TypeScript infers result types from your parser composition automatically.
    No manual type annotations needed—get type safety with discriminated unions
    and exhaustive checking out of the box.
- icon: ✅
  title: Rich value validation
  details: >-
    Built-in parsers for common types like paths, URLs, and integers with
    constraint checking. Validate input at parse time with helpful error
    messages rather than handling errors later.
- icon: 🎯
  title: Express complex constraints
  details: >-
    Handle mutually exclusive option groups and relationships naturally
    through parser structure. Avoid scattered validation logic by embedding
    constraints directly in your parser definition.
- icon: 📈
  title: Grows with your needs
  details: >-
    Start with simple scripts and extend to multi-command tools as needed.
    The same composition patterns work for both basic flags and complex
    nested subcommands.
- icon: 🔧
  title: Functional approach
  details: >-
    Transform and adapt parsers using functional programming techniques.
    Create variations with defaults, apply transformations, and build
    reusable components that fit your specific needs.
---

