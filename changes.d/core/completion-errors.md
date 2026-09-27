---
links:
  '#967': https://github.com/dahlia/optique/issues/967
  '#982': https://github.com/dahlia/optique/pull/982
---
 -  Added `completion.errors` to the Core runners to customize messages for
    missing or unsupported completion shells.  `unsupportedShell` also accepts
    a callback receiving the requested shell name and available shell names.
    [[#967], [#982]]
 -  Fixed completion requests for inherited object names such as `toString`
    to report an unsupported shell instead of throwing, unless the name is
    explicitly registered as a custom shell.  [[#967], [#982]]
