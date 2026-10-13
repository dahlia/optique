---
links:
  '#1031': https://github.com/dahlia/optique/issues/1031
  '#1032': https://github.com/dahlia/optique/issues/1032
  '#1033': https://github.com/dahlia/optique/pull/1033
  '#1079': https://github.com/dahlia/optique/pull/1079
---
 -  Fixed Bash completion of joined option values with `=` for long `-`
    options or `:` for `/` options and default or customized word-break
    settings, including `:`/`@` in values or option names. Completion respects
    the cursor position, stops at unquoted shell operators, and decodes
    quoted or escaped values, including incomplete ANSI-C control escapes,
    without executing shell substitutions. File values preserve their full
    prefix and filtering metadata when option names overlap, unquoted tilde
    expansion after quoted or split option names, and quoted path prefixes.
    Exact literal candidates, including dot-prefixed values, remain available
    alongside file suggestions when hidden files are excluded. Hidden candidates
    allowed by one file suggestion remain available alongside other file
    suggestions. Option names quoted or escaped from their first character,
    partial option names, and literal values resembling file
    completion markers also complete correctly. File suggestions with fixed
    search patterns enumerate matching paths instead of inserting the pattern
    as literal text, retain wildcard filters as values are typed, and honor
    hidden-file settings without duplicate directory candidates, including on
    older Bash versions. Fixed-pattern completion also preserves a typed `./`
    prefix or its omission, completes explicitly typed hidden directories,
    follows `nocaseglob` when narrowing candidates, and removes
    duplicate matches from overlapping patterns. Control characters in joined
    fixed patterns no longer split or corrupt completion records.
    [[#1031], [#1032], [#1033], [#1079]]
