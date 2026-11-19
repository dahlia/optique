---
links:
  '#969': https://github.com/dahlia/optique/issues/969
  '#985': https://github.com/dahlia/optique/issues/985
  '#986': https://github.com/dahlia/optique/pull/986
  '#987': https://github.com/dahlia/optique/pull/987
---
 -  Added `showEnvironment` to list environment bindings in help, inline
    next to their options, in a separate section, or both. Bindings with
    no CLI option or argument appear in a separate section even in inline
    mode. Help stays unchanged unless `showEnvironment` is enabled.
    [[#969], [#986], [#985], [#987]]

    Custom renderers can use `DocEntry.envVars` and
    `deriveEnvironmentSection()`. The optional `DocFragments.sourceOnly` and
    `DocFragments.environmentBindings` fields preserve bindings without
    CLI entries through built-in combinators. Tests that snapshot raw
    documentation objects or assert their exact keys may need updating.
