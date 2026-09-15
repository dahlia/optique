---
links:
  '#958': https://github.com/dahlia/optique/issues/958
---
 -  Fixed a command-line dependency source inside a nested `object()`,
    `tuple()`, `concat()`, or `merge()` to reach a derived parser declared
    before that construct.  Such a source used to register only when its
    own construct completed, so moving a consumer ahead of it made the
    consumer validate against the source's default instead of the value on
    the command line.  A nested source now takes the enclosing declaration
    position of the construct holding it, so field order no longer changes
    which values a consumer accepts.  Sources reached only through an
    `or()` or `longestMatch()` alternative keep their own scope, and
    neither `group()` nor a `conditional()` error callback changes that.
    [[#958]]
