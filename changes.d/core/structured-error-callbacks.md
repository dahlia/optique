---
links:
  '#897': https://github.com/dahlia/optique/issues/897
  '#949': https://github.com/dahlia/optique/pull/949
---
 -  Added a structured `Message` argument to core runner `onError` callbacks,
    allowing applications to handle errors without parsing rendered stderr.
    Existing zero-argument and one-argument handlers remain compatible.
    Wrappers that invoke `onError` must now pass the message after the exit
    code.  [[#897], [#949]]
