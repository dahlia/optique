import { type Message, text } from "@optique/core/message";
import { printError } from "@optique/run";

/**
 * Converts an unknown error value to a plain Optique message.
 */
export function errorMessage(error: unknown): Message {
  return [text(error instanceof Error ? error.message : String(error))];
}

/**
 * Prints an error message and exits the process.
 */
export function exitWithError(error: unknown): never {
  printError(errorMessage(error), { exitCode: 1 });
}
