/**
 * Reserved for helpers that invoke a CLI entry point in a child process.
 *
 * This layer will execute the whole application, so it observes everything the
 * process writes—including output the in-process layers cannot see—plus its
 * exit code or terminating signal.  In exchange it needs a runnable entry
 * point, permission to start a process, and whatever build step that entry
 * point depends on.
 *
 * The helpers themselves are still landing; see
 * {@link https://github.com/dahlia/optique/issues/890}.
 *
 * @module
 * @since 1.3.0
 */
export {};
