---
links:
  '#907': https://github.com/dahlia/optique/issues/907
  '#952': https://github.com/dahlia/optique/pull/952
---
 -  Added semantic terminal themes and `MessageFormatter` injection for help,
    usage, and errors. Added `createMessageFormatter()` and public
    `initialWidth` support so custom renderers can honor the space already
    occupied on a description's first line. Scalar value themes also control
    values within lists, including uncolored output. Custom error formatters
    receive the runner's configured `maxWidth` and the rendered error prefix's
    occupied width so wrapping accounts for the prefix. Multiline usage labels
    reserve only their final line's width for wrapping and indentation.
    Multiline examples, author, and bugs labels use their widest line when
    checking the minimum page width. Newlines inside themed text force line
    breaks while preserving styles and hyperlinks. Usage labels and
    annotation prefixes and suffixes are measured per line for minimum widths
    and message continuation. Help entries keep explicitly multiline themed
    terms indented, with descriptions attached to their final line. Usage
    separators between program names, terms, and option values respect explicit
    themed line breaks without adding spaces or blank lines. Empty themed
    usage terms do not leave redundant separators. Usage and error labels
    reserve spacing only when their final line has content. Automatic usage
    wrapping preserves spaces supplied by custom theme fragments.
    [[#907], [#952]]
