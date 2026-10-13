---
links:
  '#1042': https://github.com/dahlia/optique/issues/1042
  '#1063': https://github.com/dahlia/optique/pull/1063
---
 -  Fixed Nushell file completion leaving out symbolic links to files and
    directories.  A link is now classified by its target, so a directory link
    gets a trailing slash for navigation, while extension filters still match
    the link's own name.  Broken links stay excluded when completion is
    limited to files or directories.  [[#1042], [#1063]]
