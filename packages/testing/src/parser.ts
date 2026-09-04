/**
 * Reserved for helpers that exercise a parser on its own.
 *
 * This layer will drive Optique's parsing protocol over a complete argument
 * list and report the parsed value or a structured parse error.  It renders no
 * help, writes to no stream, dispatches no command handler, and never exits,
 * so it observes neither standard output nor standard error.
 *
 * The helpers themselves are still landing; see
 * {@link https://github.com/dahlia/optique/issues/890}.
 *
 * @module
 * @since 1.3.0
 */
export {};
