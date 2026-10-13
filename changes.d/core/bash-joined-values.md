---
links:
  '#1031': https://github.com/dahlia/optique/issues/1031
  '#1033': https://github.com/dahlia/optique/pull/1033
---
 -  Fixed Bash completion of `--option=value` with default or customized
    word-break settings, including `:`/`@` in values or option names.
    Completion respects the cursor position and decodes quoted or escaped
    values without executing shell substitutions.  File values preserve
    their full prefix, filtering metadata, unquoted tilde expansion after
    split option names, and quoted path prefixes.  Exact literal candidates
    remain available alongside file suggestions.  [[#1031], [#1033]]
