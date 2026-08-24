---
links:
  '#869': https://github.com/dahlia/optique/issues/869
  '#874': https://github.com/dahlia/optique/issues/874
  '#889': https://github.com/dahlia/optique/pull/889
---
 -  Removed the unused `DependencyValueOrigin` type and `registerSource()`
    origin argument from `@optique/core/dependency-runtime`.  Both APIs were
    marked `@internal`; dependency resolution behavior is unchanged.
    [[#869], [#874], [#889]]
