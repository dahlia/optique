---
links:
  '#1009': https://github.com/dahlia/optique/issues/1009
  '#1017': https://github.com/dahlia/optique/pull/1017
---
 -  Fixed `formatDocPage()` to accept narrow widths when annotation headings
    for defaults, choices, aliases, and environment variables fit after
    removing their leading separator whitespace.  Headings that need trimming
    now start in an empty description column without an extra line break.
    [[#1009], [#1017]]
