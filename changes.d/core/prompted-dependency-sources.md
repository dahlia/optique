---
links:
  '#869': https://github.com/dahlia/optique/issues/869
  '#870': https://github.com/dahlia/optique/issues/870
  '#912': https://github.com/dahlia/optique/pull/912
---
 -  Fixed prompt fallbacks around dependency sources to publish the selected
    value before dependent parsers and prompts run.  Source prompts now run
    serially in dependency order, with declaration order breaking ties, and
    each prompt occurrence runs at most once per parse or two-pass `runWith()`
    run.  Values from CLI input, bindings, and prompts behave consistently
    across parser compositions, while cancellation stops later prompts.
    [[#869], [#870], [#912]]
