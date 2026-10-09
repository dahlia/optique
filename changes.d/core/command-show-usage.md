---
links:
  '#1020': https://github.com/dahlia/optique/issues/1020
  '#1023': https://github.com/dahlia/optique/pull/1023
---
 -  Added `showUsage` to `command()` options so subcommands can override the
    runner's usage visibility.  Descendants inherit the nearest explicit
    command setting.  `DocPage.showUsage` preserves the resolved default for
    custom help rendering, and explicit `formatDocPage()` options override it.
    [[#1020], [#1023]]
