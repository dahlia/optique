---
links:
  '#1035': https://github.com/dahlia/optique/issues/1035
  '#1064': https://github.com/dahlia/optique/pull/1064
---
 -  Fixed fish completion to decode quotes and backslash escapes in the word
    being completed, so `--format "tw` or `--file two\ w` now offers the same
    choices and file names as the unquoted word.  A quoted or escaped `~` now
    stays a literal path, as in fish's own file completion.  [[#1035], [#1064]]
