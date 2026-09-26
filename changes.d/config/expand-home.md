---
links:
  '#973': https://github.com/dahlia/optique/issues/973
  '#977': https://github.com/dahlia/optique/pull/977
---
 -  Added the `expandHome` runtime option for config contexts.  When it is
    `true`, a leading `~` in the path returned by `getConfigPath()` is
    expanded to the current user's home directory, so a default config path
    such as `"~/.myapp.json"` finds the file there.  It defaults to `false`,
    since `~` is a valid file name character on most platforms.
    [[#973], [#977]]
