---
links:
  '#1038': https://github.com/dahlia/optique/issues/1038
  '#1076': https://github.com/dahlia/optique/pull/1076
---
 -  Fixed Nushell completion to quote suggested values and file names that
    contain spaces, quotes, or other characters Nushell would interpret, so
    each completed value stays a single argument with its original text.
    The completion menu still shows the values unquoted.  [[#1038], [#1076]]

    Because quotes keep Nushell from expanding `~`, a quoted path typed
    under the home directory is inserted with the home directory spelled out.
