---
links:
  '#1018': https://github.com/dahlia/optique/pull/1018
  '#980': https://github.com/dahlia/optique/issues/980
---
 -  Added `ClackPromptOptions.pendingMessage` to show a spinner while a
    derived prompt configuration resolves.  The indicator stops on success,
    failure, or cancellation, including when the resolver ignores the abort
    signal.  OS-delivered `SIGINT`/`SIGTERM` also stops waiting and rejects with
    an `AbortError`; interactive <kbd>^C</kbd> retains Clack's process-exit
    behavior.  Omit the option to keep resolution silent.  [[#980], [#1018]]
