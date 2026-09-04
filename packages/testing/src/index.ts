/**
 * Testing support for Optique command-line interfaces.
 *
 * An Optique application can be exercised at four distinct execution
 * boundaries, and this package gives each one its own entry point:
 *
 * - `@optique/testing/parser` runs a parser against an argument list without
 *   help rendering, process integration, or command dispatch.
 * - `@optique/testing/run` captures what `run()` and `runAsync()` write
 *   through their injected output callbacks, along with intentional exits.
 * - `@optique/testing/discover` captures a `runProgram()` invocation,
 *   including command discovery and handler dispatch.
 * - `@optique/testing/cli` invokes a real CLI entry point in a child process.
 *
 * This module holds only the contracts that mean the same thing at more than
 * one of those boundaries.  Results that differ by layer—parsed values,
 * intentional exits, terminating signals—belong to the subpath that produces
 * them.
 *
 * @module
 * @since 1.3.0
 */

/**
 * Text captured from a program's standard output and standard error streams.
 *
 * The two streams are kept apart and their text is preserved exactly, so a
 * test can assert on trailing newlines and on which stream a message reached.
 * Each layer documents how it fills these fields: the in-process layers
 * accumulate the text their injected writers receive, while the subprocess
 * layer decodes whatever the child actually wrote.
 *
 * @since 1.3.0
 */
export interface CapturedOutput {
  /**
   * The text written to standard output.  Empty when nothing was written.
   */
  readonly stdout: string;

  /**
   * The text written to standard error.  Empty when nothing was written.
   */
  readonly stderr: string;
}
