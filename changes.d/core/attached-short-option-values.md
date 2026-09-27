---
links:
  '#965': https://github.com/dahlia/optique/issues/965
  '#981': https://github.com/dahlia/optique/pull/981
---
 -  Added attached values for short options, so `-n5` and `-xn5` work like
    `-n 5` and `-x -n 5`, with value completion for attached forms.  Declared
    single-dash full names now take precedence over short-option splitting,
    independently of field order.  Unicode short-option names work in attached
    forms and bundles too.  [[#965], [#981]]
