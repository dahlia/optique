 -  Fixed `merge()` reporting a generic no-match error when no child parser
    matched.  It now suggests mistyped option names and reports whether it
    expects options, commands, or arguments, matching `object()`.  [[#888]]
