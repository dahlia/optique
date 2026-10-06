---
links:
  '#1008': https://github.com/dahlia/optique/issues/1008
  '#1010': https://github.com/dahlia/optique/pull/1010
---
 -  Fixed `run()`, `runSync()`, and `runAsync()` truncating help, version,
    completion, and error output when it was piped into a slow reader on
    Node.js or Bun.  The process used to exit with the expected code after
    only the first few kilobytes had been delivered.  When standard output
    or standard error is a pipe or a file on POSIX systems, the default
    writers now write directly to its file descriptor and return only after
    the whole text has been written, so the exit that follows no longer
    discards the rest.  `printError()` with `exitCode` does the same before
    it exits, which means a mock of `process.stderr.write()` no longer sees
    its message in that case.  Terminals, Windows, and Deno are unaffected,
    and custom `stdout`, `stderr`, and `onExit` callbacks work as before.
    [[#1008], [#1010]]
