---
links:
  '#1140': https://github.com/dahlia/optique/issues/1140
  '#1142': https://github.com/dahlia/optique/pull/1142
---
 -  Fixed `withDefault(multiple(...), fallback)` to return an empty array when
    a repeatable option is omitted and `min` is zero, including inside
    `object()` and when the input contains only `--`.  To use the fallback when
    the option is omitted, pass `{ min: 1 }` to `multiple()`.
    [[#1140], [#1142]]
