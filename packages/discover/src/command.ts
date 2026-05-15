import type { CommandOptions } from "@optique/core/primitives";
import type { Mode, Parser } from "@optique/core/parser";

const commandBrand = Symbol.for("@optique/discover/command");

/**
 * Metadata shown for a discovered command.
 *
 * This uses the same shape as Optique's `command()` options so discovered
 * commands can provide descriptions, usage overrides, visibility, and custom
 * command-level errors.
 *
 * @since 1.1.0
 */
export type CommandMetadata = CommandOptions;

/**
 * Input accepted by {@link defineCommand}.
 *
 * @template M The mode of the command parser.
 * @template T The parsed value passed to the command handler.
 * @since 1.1.0
 */
export interface CommandDefinition<M extends Mode, T> {
  /**
   * Parser for this command's command-specific arguments and options.
   */
  readonly parser: Parser<M, T, unknown>;

  /**
   * Metadata used in help output and shell completion.
   */
  readonly metadata?: CommandMetadata;

  /**
   * Handles the parsed command value.
   *
   * @param value Parsed command value.
   * @returns Nothing, or a promise that resolves when command handling
   *          completes.
   */
  handler(value: T): void | Promise<void>;
}

/**
 * A discovered command module definition.
 *
 * @template M The mode of the command parser.
 * @template T The parsed value passed to the command handler.
 * @since 1.1.0
 */
export interface Command<M extends Mode, T> extends CommandDefinition<M, T> {
  /**
   * Internal marker used to validate discovered modules.
   *
   * @internal
   */
  readonly [commandBrand]: true;
}

/**
 * Defines a command module for `@optique/discover`.
 *
 * This helper returns its argument unchanged while preserving parser value
 * inference for the handler callback.
 *
 * @template M The mode of the command parser.
 * @template T The parsed value passed to the command handler.
 * @param command The command definition.
 * @returns The same command definition with inferred types.
 * @throws {TypeError} If the parser or handler is missing or malformed.
 * @since 1.1.0
 */
export function defineCommand<M extends Mode, T>(
  command: CommandDefinition<M, T>,
): Command<M, T> {
  if (!isParser(command.parser)) {
    throw new TypeError("Command parser must be an Optique parser.");
  }
  if (typeof command.handler !== "function") {
    throw new TypeError("Command handler must be a function.");
  }
  return {
    ...command,
    [commandBrand]: true,
  };
}

/**
 * Returns whether a value is a command created by {@link defineCommand}.
 *
 * @param value The value to inspect.
 * @returns `true` when the value is a discovered command definition.
 * @since 1.1.0
 */
export function isCommand(value: unknown): value is Command<Mode, unknown> {
  return (
    value != null &&
    typeof value === "object" &&
    (value as { readonly [commandBrand]?: unknown })[commandBrand] === true &&
    isParser((value as { readonly parser?: unknown }).parser) &&
    typeof (value as { readonly handler?: unknown }).handler === "function"
  );
}

function isParser(value: unknown): value is Parser<Mode, unknown, unknown> {
  return (
    value != null &&
    typeof value === "object" &&
    typeof (value as { readonly parse?: unknown }).parse === "function" &&
    typeof (value as { readonly complete?: unknown }).complete ===
      "function" &&
    typeof (value as { readonly suggest?: unknown }).suggest === "function" &&
    typeof (value as { readonly getDocFragments?: unknown })
        .getDocFragments === "function" &&
    ((value as { readonly mode?: unknown }).mode === "sync" ||
      (value as { readonly mode?: unknown }).mode === "async")
  );
}
