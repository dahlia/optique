---
links:
  '#1046': https://github.com/dahlia/optique/issues/1046
  '#1068': https://github.com/dahlia/optique/pull/1068
---
 -  Fixed PowerShell completion to quote literal values and file/directory
    paths when needed, preserving their argument values when the completed
    command runs.  Completion labels remain readable, and completing a quoted
    directory keeps the cursor ready for its child paths.  [[#1046], [#1068]]
