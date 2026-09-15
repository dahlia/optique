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
  '#953': https://github.com/dahlia/optique/issues/953
  '#954': https://github.com/dahlia/optique/pull/954
  '#959': https://github.com/dahlia/optique/issues/959
---
 -  Added the `@optique/testing` package with separate entry points for testing
    parser results, runner output, command dispatch, and real CLI processes.
    The package also exports `CapturedOutput` for captured stdout and stderr.
    [[#887], [#890], [#891], [#892], [#893], [#894], [#942], [#943], [#944], [#945], [#946], [#953], [#954], [#959]]

     -  `@optique/testing/parser` parses a complete argument list and reports an
        inferred value or a structured failure, including remaining arguments
        and the matched command path.
     -  `@optique/testing/run` captures returned values, help, version,
        completion, parse errors, and intentional exit codes without writing
        to process streams or running application handlers.
     -  `@optique/testing/discover` provides `captureProgramRun()` to exercise
        command discovery, lifecycle hooks, and handler dispatch in the test
        process.  It captures output routed through Optique's callbacks;
        direct process writes such as `console.log()` are not captured.
     -  `@optique/testing/cli` provides `createCliRunner()` to run a real
        process and capture stdout, stderr, and exit status.  It supports
        stdin, environment overrides, timeouts, cancellation, and optional
        process-tree cleanup with a bounded deadline on POSIX and Windows.
