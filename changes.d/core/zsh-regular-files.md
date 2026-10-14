---
links:
  '#1053': https://github.com/dahlia/optique/issues/1053
  '#1073': https://github.com/dahlia/optique/pull/1073
---
 -  Fixed Zsh completion for regular-file suggestions, including
    `path({ type: "file" })`, to exclude named pipes and other non-regular paths
    even without an extension filter.  Symlinks to regular files and directory
    navigation remain available.  [[#1053], [#1073]]

    File suggestions now consistently use the `files`/`directories` completion
    tags.  The `file-patterns` style and `globbed-files`/`all-files` tag styles
    no longer control suggestions without an extension filter.  The
    `list-dirs-first` style still lists directories before regular files.
