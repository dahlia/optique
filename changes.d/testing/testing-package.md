---
links:
  '#890': https://github.com/dahlia/optique/issues/890
  '#891': https://github.com/dahlia/optique/issues/891
  '#892': https://github.com/dahlia/optique/issues/892
  '#893': https://github.com/dahlia/optique/issues/893
  '#942': https://github.com/dahlia/optique/pull/942
  '#943': https://github.com/dahlia/optique/pull/943
  '#944': https://github.com/dahlia/optique/pull/944
---
 -  Added the `@optique/testing` package with a shared `CapturedOutput` type
    and layered entry points for parser, runner, command discovery, and
    subprocess testing.  The parser entry point can run a complete argument
    list and report an inferred value or a structured failure with remaining
    arguments and the matched command path.  The runner entry point can capture
    returned values, help, version, completion, parse errors, and intentional
    exit codes without writing to process streams or running downstream
    application handlers.
    [[#890], [#891], [#892], [#893], [#942], [#943], [#944]]
