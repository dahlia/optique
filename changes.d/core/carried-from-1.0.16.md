---
links:
  '#1097': https://github.com/dahlia/optique/issues/1097
  '#1098': https://github.com/dahlia/optique/issues/1098
  '#1101': https://github.com/dahlia/optique/issues/1101
  '#1104': https://github.com/dahlia/optique/pull/1104
  '#1105': https://github.com/dahlia/optique/pull/1105
  '#1108': https://github.com/dahlia/optique/issues/1108
  '#1109': https://github.com/dahlia/optique/pull/1109
  '#1110': https://github.com/dahlia/optique/issues/1110
  '#1113': https://github.com/dahlia/optique/pull/1113
  '#1122': https://github.com/dahlia/optique/issues/1122
  '#1123': https://github.com/dahlia/optique/issues/1123
  '#1124': https://github.com/dahlia/optique/pull/1124
  '#1128': https://github.com/dahlia/optique/pull/1128
  '#1130': https://github.com/dahlia/optique/pull/1130
---
 -  Fixed fish completion scripts to preserve backslashes in additional
    arguments passed to `fish.generateScript()`, preventing invalid scripts
    and altered argument values.
    [[#1101], [#1105]]
 -  Fixed `formatMessage()` to preserve indentation and other spacing in
    whitespace-only `text()` terms, including before styled command-line
    examples.  CRLF and CR line endings now follow the same formatting rules
    as LF.
    [[#1098], [#1104]]
 -  Fixed hidden commands disappearing from the usage synopsis in their own
    help and their descendants' help.  Commands remain hidden in parent
    synopses according to their visibility setting.
    [[#1110], [#1113]]
 -  Fixed `map()` losing `bindEnv()` and `bindConfig()` fallbacks inside
    composed commands, and making `prompt()` skip mapped `optional()` or
    `withDefault()` parsers when context annotations were present.
    [[#1108], [#1109]]
 -  Fixed the completion option form (`--completion`) leaving its internal `ARG`
    in usage lines and help entries when hidden.  The argument now follows the
    option's `hidden` setting.
    [[#1097], [#1130]]
 -  Improved parsing performance for long lists of positional arguments and
    repeated option values, including `multiple()` state updates, while
    preserving dependency replay and isolation between parser alternatives.
    [[#1122], [#1123], [#1124], [#1128]]
