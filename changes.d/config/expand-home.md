---
links:
  '#973': https://github.com/dahlia/optique/issues/973
  '#977': https://github.com/dahlia/optique/pull/977
---
 -  Added `expandHome: true` for single-file config contexts, so a path
    such as `"~/.myapp.json"` from `getConfigPath()` resolves under the
    current user's home directory. Expansion applies only to a path that
    is exactly `~` or starts with `~/` or, on Windows, `~\`. Paths such as
    `~other/settings.json` are unchanged.
    Expansion is off by default and requires `--allow-sys=homedir` on Deno.
    [[#973], [#977]]
