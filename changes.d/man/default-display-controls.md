---
links:
  '#1100': https://github.com/dahlia/optique/issues/1100
  '#1129': https://github.com/dahlia/optique/pull/1129
---
 -  Added `showDefault` and `showChoices` options to `formatDocPageAsMan()`
    and the `generateManPage*()` functions to customize or hide default-value
    and choice annotations. Changed the default-value format from `[value]` to
    `(default: value)`, including in the `optique-man` CLI. Restore the
    previous format with `showDefault: { prefix: " [", suffix: "]" }`. Omitting
    `showChoices` keeps the full list; passing `true` or `{}` limits it to
    eight values, and `{ maxItems: Infinity }` shows all values.
    [[#1100], [#1129]]
