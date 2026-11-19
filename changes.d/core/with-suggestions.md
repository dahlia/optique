---
links:
  '#1111': https://github.com/dahlia/optique/issues/1111
  '#1114': https://github.com/dahlia/optique/pull/1114
---
 -  Added `withSuggestions()` for value parsers, allowing applications to
    supply shell completion candidates, including ones fetched asynchronously,
    without changing which values the parser accepts or its result type.
    The new candidates replace the parser's own suggestions by default.
    Set `includeExisting: true` to keep both.  [[#1111], [#1114]]
