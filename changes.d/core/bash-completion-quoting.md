---
links:
  '#1030': https://github.com/dahlia/optique/issues/1030
  '#1034': https://github.com/dahlia/optique/pull/1034
---
 -  Fixed Bash file completion to quote filenames containing spaces or shell
    metacharacters, preserving them as literal arguments when the completed
    command runs.  Directory paths remain open for further completion.

    Bash 3.2 lacks `compopt`, so filename processing applies to all suggestions
    there.  On that version, a literal suggestion matching
    a local directory receives a trailing slash instead of a space.
    [[#1030], [#1034]]
