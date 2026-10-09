---
links:
  '#1021': https://github.com/dahlia/optique/issues/1021
  '#1022': https://github.com/dahlia/optique/pull/1022
---
 -  Fixed subcommand help to retain the selected command's brief, description,
    and footer when commands are wrapped in `object()`, `tuple()`, or
    `concat()`, including labeled objects and nested command groups.  This also
    preserves page metadata from custom parsers and works across package copies,
    including mixed ESM/CommonJS builds.  [[#1021], [#1022]]
