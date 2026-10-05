---
links:
  '#1003': https://github.com/dahlia/optique/issues/1003
  '#1006': https://github.com/dahlia/optique/pull/1006
---
 -  Fixed `formatMessage()` and `formatDocPage()` starting automatically
    wrapped lines with a space.  When a text term that begins with a space,
    a `values()` separator, or a `showDefault`/`showChoices` prefix such as
    the default `" ["` wraps onto a new line, its leading whitespace is now
    dropped, so the line starts at the same column as the text above it.
    Leading whitespace at the start of a message, after `lineBreak()`, or in
    `value()` and `values()` items is kept.  [[#1003], [#1006]]
