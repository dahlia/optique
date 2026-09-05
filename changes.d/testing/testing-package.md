---
links:
  '#887': https://github.com/dahlia/optique/issues/887
  '#890': https://github.com/dahlia/optique/issues/890
  '#891': https://github.com/dahlia/optique/issues/891
  '#892': https://github.com/dahlia/optique/issues/892
  '#893': https://github.com/dahlia/optique/issues/893
  '#894': https://github.com/dahlia/optique/issues/894
  '#942': https://github.com/dahlia/optique/pull/942
  '#943': https://github.com/dahlia/optique/pull/943
  '#944': https://github.com/dahlia/optique/pull/944
  '#945': https://github.com/dahlia/optique/pull/945
  '#946': https://github.com/dahlia/optique/pull/946
---
 -  Added the `@optique/testing` package with a shared `CapturedOutput` type
    and layered entry points for parser, runner, command discovery, and
    subprocess testing.  The parser entry point can run a complete argument
    list and report an inferred value or a structured failure with remaining
    arguments and the matched command path.  The runner entry point can capture
    returned values, help, version, completion, parse errors, and intentional
    exit codes without writing to process streams or running downstream
    application handlers.  The discovery entry point's `captureProgramRun()`
    captures output and exit codes while executing command discovery, hooks,
    and handler dispatch in the test process.  The CLI entry point's
    `createCliRunner()` runs a real process, capturing stdout, stderr, and exit
    status with stdin, environment, timeout, cancellation, and optional
    process-tree cleanup controls.
    [[#887], [#890], [#891], [#892], [#893], [#894], [#942], [#943], [#944], [#945], [#946]]
