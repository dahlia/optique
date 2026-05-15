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
 * Non-empty command path used by static command registration.
 *
 * @since 1.1.0
 */
export type CommandPath = readonly [string, ...string[]];

/**
 * Input accepted by {@link defineCommand}.
 *
 * @template M The mode of the command parser.
 * @template T The parsed value passed to the command handler.
 * @since 1.1.0
 */
export interface CommandDefinition<M extends Mode, T> {
  /**
   * Command path used when commands are passed directly to `runProgram()`.
   *
   * File-based discovery derives the command path from the file name and uses
   * this field only to validate that the declared path matches.
   */
  readonly path?: CommandPath;

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
  readonly handler: (value: T) => void | Promise<void>;
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
 * A command that declares its own command path.
 *
 * Static `runProgram({ commands })` registration accepts this shape.
 *
 * @template M The mode of the command parser.
 * @template T The parsed value passed to the command handler.
 * @since 1.1.0
 */
export interface StaticCommand<M extends Mode, T> extends Command<M, T> {
  /**
   * Command path used by static command registration.
   */
  readonly path: CommandPath;
}

/**
 * A command with its handler value type erased.
 *
 * This type is used by discovery APIs that collect commands with different
 * parsed value types.  The handler cannot be called directly without first
 * recovering the parser's value type.
 *
 * @since 1.1.0
 */
export type AnyCommand = Omit<Command<Mode, unknown>, "handler"> & {
  /**
   * Erased command handler.
   */
  readonly handler: (value: never) => void | Promise<void>;
};

/**
 * A statically registered command with its handler value type erased.
 *
 * @since 1.1.0
 */
export type AnyStaticCommand = Omit<StaticCommand<Mode, unknown>, "handler"> & {
  /**
   * Erased command handler.
   */
  readonly handler: (value: never) => void | Promise<void>;
};

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
 * @throws {TypeError} If the parser, path, or handler is missing or malformed.
 * @since 1.1.0
 */
export function defineCommand<M extends Mode, T>(
  command: CommandDefinition<M, T> & { readonly path: CommandPath },
): StaticCommand<M, T>;
export function defineCommand<M extends Mode, T>(
  command: CommandDefinition<M, T>,
): Command<M, T>;
export function defineCommand<M extends Mode, T>(
  command: CommandDefinition<M, T>,
): Command<M, T> {
  if (!isParser(command.parser)) {
    throw new TypeError("Command parser must be an Optique parser.");
  }
  if (command.path != null) validateCommandPath(command.path);
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
export function isCommand(value: unknown): value is AnyCommand {
  return (
    value != null &&
    typeof value === "object" &&
    (value as { readonly [commandBrand]?: unknown })[commandBrand] === true &&
    (
      (value as { readonly path?: unknown }).path == null ||
      isCommandPath((value as { readonly path?: unknown }).path)
    ) &&
    isParser((value as { readonly parser?: unknown }).parser) &&
    typeof (value as { readonly handler?: unknown }).handler === "function"
  );
}

function validateCommandPath(path: unknown): asserts path is CommandPath {
  if (!isCommandPath(path)) {
    throw new TypeError(
      "Command path must be a non-empty array of non-empty strings.",
    );
  }
}

function isCommandPath(path: unknown): path is CommandPath {
  return Array.isArray(path) &&
    path.length > 0 &&
    path.every((segment) => typeof segment === "string" && segment.length > 0);
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
