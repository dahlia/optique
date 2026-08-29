---
links:
  '#869': https://github.com/dahlia/optique/issues/869
  '#913': https://github.com/dahlia/optique/issues/913
  '#914': https://github.com/dahlia/optique/pull/914
---
 -  Fixed dependency sources inside `conditional()` and `command()` to
    reach derived parsers declared next to those constructs when their
    value comes from the command line, matching how a prompted value
    already reached them.  The `conditional()` discriminator, the fields
    of the selected branch, and a selected command's subtree now register
    their command-line values for sibling consumers, and a value behaves
    identically whether it was typed or answered interactively.  When
    nothing on the command line selects a branch, the branch chosen by
    the discriminator's completion—including a prompted discriminator's
    answer, and the default branch when no named branch applies—is now
    resolved once before derived parsers re-evaluate and reused by the
    conditional's completion, so purely interactive sessions validate
    sibling parsers against the answered values.  A prompted
    discriminator that does not wrap a dependency source cannot take part
    in this early resolution.  [[#869], [#913], [#914]]
