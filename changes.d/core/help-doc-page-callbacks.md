---
links:
  '#899': https://github.com/dahlia/optique/issues/899
  '#950': https://github.com/dahlia/optique/pull/950
---
 -  Added the final `DocPage` as the second argument to `help.onShow`, so
    custom help renderers can use runner-provided entries and selected
    command documentation without reconstructing them. Existing zero-argument
    and one-argument handlers remain compatible. Wrappers that invoke the
    callback must now pass the page after the exit code.  [[#899], [#950]]
