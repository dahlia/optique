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
 * Command path used by static command registration.
 *
 * An empty path represents the root command.
 *
 * @since 1.1.0
 */
export type CommandPath = readonly string[];

/**
 * Resource bundle threaded through {@link ProgramHooks} for a single command
 * run.
 *
 * A {@link ProgramHooks.beforeEach} hook returns this object; the dispatcher
 * forwards it to the command handler's second parameter and to the matching
 * {@link ProgramHooks.afterEach} and {@link ProgramHooks.onError} hooks.  This
 * threads handler-time resources without global state.
 *
 * @since 1.2.0
 */
export interface ProgramHookContext {
  /**
   * Caller-defined resource.  Common shapes include a database pool, a logger
   * scope, or a tracing span.
   */
  readonly resource?: unknown;
}

/**
 * The parsed command selected by a discovered command parser.
 *
 * Most applications receive this only indirectly through `runProgram()`, which
 * calls the handler automatically.
 *
 * @since 1.1.0
 */
export interface ProgramInvocation {
  /**
   * The command definition that matched the input.
   */
  readonly command: AnyCommand;

  /**
   * The resolved command path that matched the input.
   *
   * Unlike {@link CommandDefinition.path}, this is always populated: for
   * file-based discovery it is the path derived from the module's location even
   * when the command definition omits an explicit `path`.  The root command
   * uses an empty array.  Lifecycle hooks can use this to identify which
   * command is running.
   */
  readonly path: CommandPath;

  /**
   * Parsed value produced by the command parser.
   */
  readonly value: unknown;

  /**
   * Handler to call with {@link ProgramInvocation.value} and, when a
   * {@link ProgramHooks} `beforeEach` produced one, a {@link ProgramHookContext}.
   *
   * The context is optional: `runProgram()` supplies it only when a program-level
   * or command-level `beforeEach` ran, and callers that dispatch invocations
   * directly can keep passing only the value.
   */
  readonly handler: (
    value: unknown,
    context?: ProgramHookContext,
  ) => void | Promise<void>;
}

/**
 * Lifecycle hooks invoked around a command handler.
 *
 * Hooks let cross-cutting concerns — log scopes, tracing spans, lazy resource
 * setup, structured timing, error reporting — live in a single place instead
 * of being duplicated inside every command handler.  Pass them to
 * `runProgram({ hooks })` to wrap every command, or to
 * {@link CommandDefinition.hooks} to wrap a single command.
 *
 * When both program-level and command-level hooks are present, they nest:
 *
 * ```
 * program.beforeEach → command.beforeEach → handler
 *                                             ↓
 * program.afterEach  ← command.afterEach  ←─┘
 * program.onError    ← command.onError    ← on failure
 * ```
 *
 * @since 1.2.0
 */
export interface ProgramHooks {
  /**
   * Called before the command handler runs, receiving the matched command, its
   * resolved {@link ProgramInvocation.path}, the parsed value, and the handler
   * via {@link ProgramInvocation}.
   *
   * The returned {@link ProgramHookContext} is threaded forward as the second
   * argument to the command handler (when this is the most specific hook scope)
   * and to {@link afterEach} and {@link onError}.
   *
   * Returning a promise is supported; the dispatcher awaits it.  A rejected
   * promise (or a thrown error) aborts the command before the handler runs and
   * invokes {@link onError}.
   */
  readonly beforeEach?: (
    invocation: ProgramInvocation,
  ) => ProgramHookContext | Promise<ProgramHookContext>;

  /**
   * Called after the handler returns successfully, receiving the context from
   * {@link beforeEach} (or an empty object when no `beforeEach` ran) and the
   * handler's return value.
   *
   * Returning a promise is supported; the dispatcher awaits it.  If this hook
   * throws or rejects, the dispatcher treats it as a handler failure and
   * invokes {@link onError} with the thrown error.
   */
  readonly afterEach?: (
    context: ProgramHookContext,
    result: unknown,
  ) => void | Promise<void>;

  /**
   * Called when the handler (or {@link beforeEach}/{@link afterEach}) throws or
   * rejects, receiving the context from {@link beforeEach} (or an empty object)
   * and the thrown error.
   *
   * The dispatcher re-throws the original error after this hook resolves, so
   * process exit-code behavior is unchanged; the hook is for observation and
   * cleanup, not for swallowing the error.  An error thrown by this hook itself
   * is suppressed so it cannot mask the original failure.
   *
   * Returning a promise is supported; the dispatcher awaits it.
   */
  readonly onError?: (
    context: ProgramHookContext,
    error: unknown,
  ) => void | Promise<void>;
}

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
   * Use an empty path (`[]`) to register the root command.
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
   * Lifecycle hooks scoped to this command.
   *
   * These run inside any program-level hooks passed to `runProgram({ hooks })`:
   * the program-level `beforeEach` runs first, then this command's
   * `beforeEach`, then the handler; teardown unwinds in reverse.  Use this when
   * a single command needs its own preflight, such as a `deploy` command that
   * always refreshes an auth token, instead of program-wide logic.
   *
   * @since 1.2.0
   */
  readonly hooks?: ProgramHooks;

  /**
   * Handles the parsed command value.
   *
   * @param value Parsed command value.
   * @param context Resource bundle from the most specific {@link ProgramHooks}
   *                `beforeEach` that ran.  It is omitted when no program-level
   *                or command-level `beforeEach` ran, so a plain command
   *                without hooks receives only the value, exactly as before.
   *                Existing single-argument handlers can ignore it.
   * @returns Nothing, or a promise that resolves when command handling
   *          completes.
   */
  readonly handler: (
    value: T,
    context?: ProgramHookContext,
  ) => void | Promise<void>;
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
  readonly handler: (
    value: never,
    context?: ProgramHookContext,
  ) => void | Promise<void>;
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
  readonly handler: (
    value: never,
    context?: ProgramHookContext,
  ) => void | Promise<void>;
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
 * @throws {TypeError} If the parser, path, handler, or hooks are missing or
 *         malformed.
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
  if (command.hooks != null) validateHooks(command.hooks, "Command");
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

/**
 * Validates a {@link ProgramHooks} value, throwing a descriptive error when it
 * is malformed.
 *
 * @param hooks The value to validate.
 * @param scope Label used in error messages: `"Command"` for command-level
 *              hooks and `"Program"` for program-level hooks.
 * @throws {TypeError} If `hooks` is not an object, or a hook is neither
 *         nullish nor a function.
 * @internal
 */
export function validateHooks(
  hooks: unknown,
  scope: "Command" | "Program",
): asserts hooks is ProgramHooks {
  if (Array.isArray(hooks)) {
    throw new TypeError(`${scope} hooks must be an object, not an array.`);
  }
  if (typeof hooks !== "object" || hooks == null) {
    throw new TypeError(`${scope} hooks must be an object.`);
  }
  for (const name of ["beforeEach", "afterEach", "onError"] as const) {
    const hook = (hooks as Record<string, unknown>)[name];
    if (hook != null && typeof hook !== "function") {
      throw new TypeError(`${scope} hook "${name}" must be a function.`);
    }
  }
}

function validateCommandPath(path: unknown): asserts path is CommandPath {
  if (!isCommandPath(path)) {
    throw new TypeError(
      "Command path must be an array of non-empty strings.",
    );
  }
}

function isCommandPath(path: unknown): path is CommandPath {
  return Array.isArray(path) &&
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
