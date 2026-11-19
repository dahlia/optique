---
links:
  '#969': https://github.com/dahlia/optique/issues/969
  '#985': https://github.com/dahlia/optique/issues/985
  '#986': https://github.com/dahlia/optique/pull/986
  '#987': https://github.com/dahlia/optique/pull/987
---
 -  Added full environment variable names to the documentation produced by
    `bindEnv()`, including standalone entries for `bindEnv(fail(), ...)`
    and other bindings without a CLI option or argument. Help and man page
    renderers can list these names without reading their values.
    [[#969], [#986], [#985], [#987]]

    Use `documentation.description` or `documentation.hidden` to set the
    binding's own description or visibility. Neither exposes an enclosing
    hidden parser.
