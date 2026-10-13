---
links:
  '#1041': https://github.com/dahlia/optique/issues/1041
  '#1065': https://github.com/dahlia/optique/pull/1065
---
 -  Fixed Nushell completion to pass the command line to the CLI with the
    same arguments Nushell itself would pass.  Empty quoted arguments such as
    `""` are no longer dropped, so options after them complete again.
    Escaped quotes in double-quoted strings, backtick strings, and raw strings
    such as `r#'...'#` are now decoded instead of being split or merged with
    later arguments, and a space typed inside an unfinished quoted value no
    longer starts a new argument.  [[#1041], [#1065]]
