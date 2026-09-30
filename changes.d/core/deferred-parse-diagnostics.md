---
links:
  '#989': https://github.com/dahlia/optique/issues/989
  '#997': https://github.com/dahlia/optique/pull/997
---
 -  Deferred typo diagnostics for discarded parser failures, reducing parsing
    time for commands with many positional arguments.  Custom mismatch error
    callbacks now run when their diagnostic is requested, so callbacks used
    for side effects may run fewer times.  [[#989], [#997]]
