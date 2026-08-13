 -  Fixed shell completion omitting descriptions for `option()` and `flag()`
    suggestions.  Descriptions now appear in zsh, fish, PowerShell, and
    Nushell; command suggestions also prefer `brief` over the longer
    `description`, matching command lists.  Bash completion remains unchanged
    because Bash cannot associate descriptions with completion candidates.
    [[#883]]
