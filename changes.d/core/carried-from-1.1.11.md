---
links:
  '#1021': https://github.com/dahlia/optique/issues/1021
  '#1022': https://github.com/dahlia/optique/pull/1022
---
 -  Fixed subcommand help to retain the selected command's brief, description,
    and footer when commands are wrapped in `object()`, `tuple()`, or
    `concat()`, including labeled objects and nested command groups.  This also
    preserves custom page metadata through `merge()`, decorators that copy or
    edit documentation, and duplicate package instances, including mixed
    ESM/CommonJS builds.  Command page descriptions no longer pick up text
    from sibling custom parsers or edited options.
    [[#1021], [#1022]]
