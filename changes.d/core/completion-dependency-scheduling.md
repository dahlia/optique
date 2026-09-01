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
---
 -  Added scheduling support for effectful completions that consume
    dependency values, such as prompts with derived configurations.  The
    dependency scheduler now orders such a parser after the sources its
    completion reads, propagates demand to them when the parser's own value
    is demanded, and includes them in failure-chain diagnostics.  The same
    ordering and demand rules apply inside a `conditional()` whose branch is
    selected only during completion: the branches' completion dependencies
    propagate through the conditional's scheduling barrier, so a branch
    configuration can read a source declared after the conditional.  Once
    the discriminator resolves the selection, the scheduler replaces the
    static estimate with the selected branch's actual dependencies, and a
    branch occurrence hides an outer provider only when it will actively
    publish the source itself—an unconditional prompt, a `withDefault()`
    fallback, a nested conditional providing the source on every route, or
    a value the branch already parsed or bound—so an absent `optional()`
    occurrence or an unselected nested alternative no longer keeps a
    provider declared after the conditional from serving the branch.
    Cycles among the selected branch's actual providers and consumers
    are rejected with the existing circular-dependency error, while an
    apparent cycle whose edges belong to branches that cannot be
    selected together is no longer rejected.  The discriminator's
    resolution is also the boundary for branch-only effects: under the
    demand-only seed pass a prerequisite that only a branch
    configuration reads is demanded once the resolved selection
    consumes it, never on the strength of the pre-selection estimate,
    and a speculative parse-time guess the discriminator rejects now
    fails the run at that boundary—so a prompt needed only by the
    rejected guess is no longer asked right before the branch-mismatch
    error.  When a guessed branch's prerequisites chain through an
    earlier conditional, that discriminator now answers after the
    confirming one instead of before it.
    [[#869], [#872], [#919], [#923], [#924], [#925], [#926], [#927]]
