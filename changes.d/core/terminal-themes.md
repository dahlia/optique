---
links:
  '#907': https://github.com/dahlia/optique/issues/907
  '#952': https://github.com/dahlia/optique/pull/952
---
 -  Added semantic terminal themes and `MessageFormatter` injection to customize
    help, usage, and errors, including output without colors.  Added
    `createMessageFormatter()` and public `initialWidth` support so custom
    renderers can account for text already on the first line.  Error formatters
    receive the configured `maxWidth` and the rendered prefix's occupied width.
    Themed output preserves explicit line breaks, spaces, styles, and hyperlinks
    when wrapping.  It measures the width of each line in multiline labels and
    terms separately.
    [[#907], [#952]]
