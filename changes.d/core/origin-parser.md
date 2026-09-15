---
links:
  '#961': https://github.com/dahlia/optique/issues/961
  '#962': https://github.com/dahlia/optique/pull/962
---
 -  Added `origin()` to `@optique/core/valueparser` for parsing a web origin:
    a scheme, a host, and an optional port.  It returns a `URL` whose pathname
    is `/`, normalizes the host and port, strips a trailing root-zone dot by
    default, and rejects credentials and schemes whose origin is opaque or
    borrowed.  [[#961], [#962]]
