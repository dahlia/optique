---
links:
  '#1037': https://github.com/dahlia/optique/issues/1037
  '#1062': https://github.com/dahlia/optique/pull/1062
---
 -  Fixed fish completion to offer files matching a file suggestion's wildcard
    pattern, such as `*.txt`, `file?.txt`, or `src/*.txt`.  These patterns
    previously produced no candidates.  Hidden entries are now included for
    such patterns when `includeHidden` is enabled, and a pattern under `/`
    now lists the root directory.  [[#1037], [#1062]]
