---
links:
  '#1047': https://github.com/dahlia/optique/issues/1047
  '#1071': https://github.com/dahlia/optique/pull/1071
---
 -  Fixed zsh/fish completion scripts for program names containing hyphens or
    dots to keep their commands separate when installed together with scripts
    for similarly named programs, such as `foo-bar`, `foo_bar`, and `foo.bar`.
    Regenerate completion scripts for all affected programs after upgrading.
    [[#1047], [#1071]]
