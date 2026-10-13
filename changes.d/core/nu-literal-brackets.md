---
links:
  '#1040': https://github.com/dahlia/optique/issues/1040
  '#1060': https://github.com/dahlia/optique/pull/1060
---
 -  Fixed Nushell file completion to treat square brackets in a typed path as
    literal characters.  Completing `report[1]` now suggests *report\[1\].txt*
    instead of matching *report1.txt* as if `[1]` were a glob character class.
    [[#1040], [#1060]]
