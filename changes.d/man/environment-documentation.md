---
links:
  '#969': https://github.com/dahlia/optique/issues/969
  '#985': https://github.com/dahlia/optique/issues/985
  '#986': https://github.com/dahlia/optique/pull/986
  '#987': https://github.com/dahlia/optique/pull/987
---
 -  Added `showEnvironment` and the `optique-man` flag `--show-environment`
    to document environment bindings in man pages. Bindings without a CLI
    option or argument appear in an `ENVIRONMENT` section even in inline
    mode. An explicit `environment` section takes precedence; pass an empty
    section to suppress the generated one.  [[#969], [#986], [#985], [#987]]
