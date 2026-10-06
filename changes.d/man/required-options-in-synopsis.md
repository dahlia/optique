---
links:
  '#1004': https://github.com/dahlia/optique/issues/1004
  '#1012': https://github.com/dahlia/optique/pull/1012
---
 -  Fixed `formatUsageTermAsRoff()`, `formatDocPageAsMan()`, and the
    `generateManPage*()` functions to render required options without optional
    brackets in the man page SYNOPSIS, including options in exclusive branches
    and required repetitions.  Empty or hidden optional exclusive branches
    keep their visible alternatives optional.  Positive repetition minima
    remain required when their children are omitted optional options, while
    a single zero-token constant repetition stays optional.  Required option
    aliases now use parentheses, such as `(-n | --name) STRING`, to preserve
    their grouping. [[#1004], [#1012]]
