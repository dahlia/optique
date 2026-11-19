---
links:
  '#1002': https://github.com/dahlia/optique/issues/1002
  '#1005': https://github.com/dahlia/optique/pull/1005
---
 -  Added a way to show command aliases in help output, so users can discover
    them without relying on shell completion.  Set `showAliases: true` on
    `command()` to list a command's aliases next to its description, as in
    `install  Install a package. (aliases: i, add)`, or pass `showAliases` to
    `formatDocPage()` and the runner functions to do so for every command.
    A command's own setting takes precedence over the runner option in both
    directions.  Aliases stay hidden by default, and usage lines keep showing
    only canonical names.  [[#1002], [#1005]]

    Customize the annotation's prefix, suffix, and label with
    `ShowAliasesOptions` and its style with
    `TerminalTheme.annotationStyles.aliases`. Custom renderers can read visible
    aliases from command entry terms and override display per entry with
    `DocEntry.showAliases`.
