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
    field of `exclusive` and `multiple` usage terms.  Custom parsers and
    parsers bound to outside sources keep the notation they declare.
    [[#1013], [#1015], [#1016]]
