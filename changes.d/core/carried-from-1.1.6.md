---
links:
  '#951': https://github.com/dahlia/optique/issues/951
---
 -  Fixed `formatMessage()` leaving text green after a single-item `values()`
    term.  The term now resets its color and restores `resetSuffix` when
    provided, with or without quotes.
    [[#951]]
