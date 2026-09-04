/**
 * Reserved for helpers that capture `run()` and `runAsync()` executions.
 *
 * This layer will run a parser or `Program` through `@optique/run` with its
 * output and exit handlers injected, so help, version, completion, and
 * parse-error output become a captured result instead of process output.  It
 * does not run the application code that consumes the parsed value, and it
 * cannot see writes that bypass those handlers, such as `console.log()`,
 * `print()`, or direct writes to a process stream.
 *
 * The helpers themselves are still landing; see
 * {@link https://github.com/dahlia/optique/issues/890}.
 *
 * @module
 * @since 1.3.0
 */
export {};
