---
links:
  '#873': https://github.com/dahlia/optique/issues/873
  '#937': https://github.com/dahlia/optique/issues/937
  '#939': https://github.com/dahlia/optique/pull/939
---
 -  Added shared validation, retry limits, and abort signals to `prompt()`.
    Every Inquirer.js prompt type can now reject a returned answer and prompt
    again, while `input`, `password`, and `editor` retain their native
    validation.  Custom prompters receive the shared attempt context, whose
    types are re-exported for convenience.  [[#873], [#937], [#939]]
