---
links:
  '#1121': https://github.com/dahlia/optique/pull/1121
  '#965': https://github.com/dahlia/optique/issues/965
  '#981': https://github.com/dahlia/optique/pull/981
---
 -  Added attached values for short options, so `-n5` and `-xn5` work like
    `-n 5` and `-x -n 5`. Shell completion also works for attached values,
    including file paths. Unicode short names work in attached forms and
    flag bundles. A declared single-dash option such as `-name` takes
    precedence over splitting when it is reachable at that point in the parse,
    regardless of field order. Options from inactive conditional branches
    do not compete with options in the selected branch, including a default
    branch.
    [[#965], [#981], [#1121]]

    Attached values and their completions also work in default branches.
    Sequences check for full option names beyond steps that can be skipped,
    and command names starting with a dash do not block attached values.
