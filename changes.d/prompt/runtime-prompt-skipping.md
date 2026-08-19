---
links:
  '#882': https://github.com/dahlia/optique/issues/882
---
 -  Added runtime conditions to prompt adapters.  Generated prompt wrappers can
    now skip a fallback with a synchronous or asynchronous `when` check and
    return a typed `otherwise` value.  The check runs only when parsing reaches
    the prompt fallback.  [[#882]]
