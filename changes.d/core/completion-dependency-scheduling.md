---
links:
  '#869': https://github.com/dahlia/optique/issues/869
  '#872': https://github.com/dahlia/optique/issues/872
  '#919': https://github.com/dahlia/optique/issues/919
  '#923': https://github.com/dahlia/optique/pull/923
  '#924': https://github.com/dahlia/optique/issues/924
  '#925': https://github.com/dahlia/optique/issues/925
  '#926': https://github.com/dahlia/optique/pull/926
  '#927': https://github.com/dahlia/optique/pull/927
  '#928': https://github.com/dahlia/optique/issues/928
  '#929': https://github.com/dahlia/optique/issues/929
  '#931': https://github.com/dahlia/optique/pull/931
  '#932': https://github.com/dahlia/optique/pull/932
---
 -  Fixed dependency-aware completion inside `conditional()` so only the
    selected branch determines ordering, effects, provider precedence, and
    cycle detection.  Unselected or rejected speculative branches no longer
    run prompts or create false cycles.  Consumers inside a selected branch
    read its active source values, while later outer occurrences remain in
    effect for consumers outside the branch.
    [[#869], [#872], [#919], [#923], [#924], [#925], [#926], [#927], [#928], [#929], [#931], [#932]]
