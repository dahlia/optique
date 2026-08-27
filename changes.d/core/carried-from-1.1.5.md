---
links:
  '#895': https://github.com/dahlia/optique/issues/895
---
 -  Fixed `merge()` assigning positional arguments according to which options
    appeared earlier in the input.  Fields from merged `object()` parsers now
    compete by their own priority and declaration order, matching the
    equivalent flattened `object()` even through `map()`, `optional()`,
    `withDefault()`, `nonEmpty()`, `group()`, and nested `merge()` wrappers.
    [[#895]]
