---
links:
  '#869': https://github.com/dahlia/optique/issues/869
  '#870': https://github.com/dahlia/optique/issues/870
  '#912': https://github.com/dahlia/optique/pull/912
---
 -  Fixed `prompt()` so that a prompted value for a wrapped dependency
    source registers in the dependency runtime, letting derived parsers
    observe the selected value during the same parse operation.  The fix
    applies to every adapter built on `createPromptAdapter()`, including
    *@optique/inquirer* and *@optique/clack*.  A dependency-source prompt
    now runs before dependency replay, so it may be displayed before an
    earlier-declared non-source prompt.  [[#869], [#870], [#912]]
