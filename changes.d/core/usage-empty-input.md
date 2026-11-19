---
links:
  '#1013': https://github.com/dahlia/optique/issues/1013
  '#1015': https://github.com/dahlia/optique/pull/1015
  '#1016': https://github.com/dahlia/optique/pull/1016
---
 -  Changed usage output to draw `or()`, `longestMatch()`, and `multiple()`
    groups as optional exactly when the parser accepts an empty argument list,
    if that is known from the parsers themselves.  For example,
    `or(optional(argument(FILE)), optional(argument(DIR)))` now reads
    `(FILE | DIR)`, because the choice between two empty alternatives is
    ambiguous and parsing fails, while `or(constant("x"), argument(FILE))`
    reads `[FILE]`.  Such groups record the outcome in the new `acceptsEmpty`
    field of `exclusive` and `multiple` usage terms.
    [[#1013], [#1015], [#1016]]

    The same rules apply to groups using `bindConfig()`, `bindDerivedDefault()`,
    `bindEnv()`, `bindKeyring()`, or `prompt()` when their known parse behavior
    is enough to determine the result. When the result depends on an external
    value, prompt answer, or validation, usage keeps the declared notation.
