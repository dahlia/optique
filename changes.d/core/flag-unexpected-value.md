---
links:
  '#968': https://github.com/dahlia/optique/issues/968
  '#984': https://github.com/dahlia/optique/pull/984
---
 -  Added `errors.unexpectedValue` to `flag()` for customizing errors when a
    value is attached to a flag.  It accepts a static message or a callback
    receiving the matched option name and the supplied value.  [[#968], [#984]]
