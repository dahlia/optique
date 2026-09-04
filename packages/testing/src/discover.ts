/**
 * Reserved for helpers that capture `runProgram()` executions.
 *
 * This layer will add command discovery, lifecycle hooks, and handler dispatch
 * to what `@optique/testing/run` covers, so a test can assert on which command
 * ran.  Because a handler runs for real, output it writes outside Optique's
 * injected handlers still escapes capture, and an error it throws still
 * propagates to the caller.
 *
 * The helpers themselves are still landing; see
 * {@link https://github.com/dahlia/optique/issues/890}.
 *
 * @module
 * @since 1.3.0
 */
export {};
