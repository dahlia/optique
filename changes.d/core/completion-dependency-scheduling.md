---
links:
  '#869': https://github.com/dahlia/optique/issues/869
  '#872': https://github.com/dahlia/optique/issues/872
---
 -  Added scheduling support for effectful completions that consume
    dependency values, such as prompts with derived configurations.  The
    dependency scheduler now orders such a parser after the sources its
    completion reads, propagates demand to them when the parser's own value
    is demanded, and includes them in failure-chain diagnostics.  Cycles
    introduced this way are rejected with the existing circular-dependency
    error.  [[#869], [#872]]
