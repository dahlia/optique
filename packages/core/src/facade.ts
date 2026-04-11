import {
  bash,
  fish,
  nu,
  pwsh,
  type ShellCompletion,
  zsh,
} from "./completion.ts";
import { group, longestMatch, object } from "./constructs.ts";
import {
  type DocPage,
  type DocSection,
  formatDocPage,
  type ShowChoicesOptions,
  type ShowDefaultOptions,
} from "./doc.ts";
import {
  commandLine,
  formatMessage,
  lineBreak,
  type Message,
  message,
  type MessageTerm,
  optionName,
  text,
  value,
} from "./message.ts";
import { multiple, optional, withDefault } from "./modifiers.ts";
import type { Program } from "./program.ts";
import {
  createParserContext,
  type ExecutionContext,
  getDocPage,
  type InferMode,
  type InferValue,
  type Mode,
  type ModeValue,
  type Parser,
  type ParserContext,
  type ParserResult,
  suggest,
  suggestAsync,
} from "./parser.ts";
import { dispatchByMode } from "./mode-dispatch.ts";
import { createDependencyRuntimeContext } from "./dependency-runtime.ts";
import { createInputTrace } from "./input-trace.ts";
import { completeOrExtractPhase2Seed } from "./phase2-seed.ts";
import { argument, command, constant, flag, option } from "./primitives.ts";
import {
  formatUsage,
  type HiddenVisibility,
  type OptionName,
  type Usage,
} from "./usage.ts";
import { type DeferredMap, string } from "./valueparser.ts";
import {
  type Annotations,
  injectFreshRunAnnotations,
  isInjectedAnnotationWrapper,
  unwrapInjectedAnnotationWrapper,
} from "./annotations.ts";
import {
  type MetaEntry,
  validateCommandNames,
  validateContextIds,
  validateMetaNameCollisions,
  validateOptionNames,
  validateProgramName,
} from "./validate.ts";
import type {
  ParserValuePlaceholder,
  SourceContext,
  SourceContextRequest,
} from "./context.ts";

export type { ParserValuePlaceholder, SourceContext, SourceContextRequest };

type SuppressedErrorConstructor = new (
  error: unknown,
  suppressed: unknown,
  message?: string,
) => Error & { readonly error: unknown; readonly suppressed: unknown };

// Polyfill for runtimes that lack SuppressedError (Node < 24):
const SuppressedErrorCtor: SuppressedErrorConstructor =
  typeof SuppressedError === "function" ? SuppressedError : (() => {
    class SuppressedErrorPolyfill extends Error {
      readonly error: unknown;
      readonly suppressed: unknown;
      constructor(error: unknown, suppressed: unknown, message?: string) {
        super(message);
        this.name = "SuppressedError";
        this.error = error;
        this.suppressed = suppressed;
      }
    }
    return SuppressedErrorPolyfill;
  })();

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function prepareParsedForContexts(
  parsed: unknown,
  deferred?: true,
  deferredKeys?: DeferredMap,
): unknown {
  if (!deferred) return parsed;
  // Non-plain leaf deferred objects (URL, Date, Intl.Locale, Temporal,
  // etc.) from prompt() carry an empty deferredKeys map (size 0) to
  // distinguish them from opaque structured deferred values from map()
  // (which have no deferredKeys at all).
  if (
    deferredKeys != null && deferredKeys.size === 0 &&
    parsed != null && typeof parsed === "object"
  ) {
    return undefined;
  }
  // Selectively replace only the deferred fields with undefined while
  // preserving non-deferred fields for phase-two context annotation
  // collection (e.g., getConfigPath may depend on non-deferred fields).
  // Plain objects and arrays are safe to clone field-by-field; non-plain
  // objects (Set, Map, class instances with deferredKeys) are leaf
  // deferred from prompt() and should be treated as fully deferred.
  if (
    deferredKeys != null && deferredKeys.size > 0 &&
    parsed != null && typeof parsed === "object" &&
    !isPlainObject(parsed) && !Array.isArray(parsed)
  ) {
    return undefined;
  }
  if (
    deferredKeys != null && deferredKeys.size > 0 &&
    parsed != null && typeof parsed === "object" &&
    (isPlainObject(parsed) || Array.isArray(parsed))
  ) {
    // Check that at least one deferredKey matches an own property of the
    // parsed object.  When deferredKeys don't match the current shape
    // (e.g., stale keys after restructuring), return undefined to avoid
    // leaking placeholder-bearing fields into phase-two contexts.
    // Look up a key in deferredKeys, handling the numeric/string
    // mismatch between tuple() (stores number indices like 0) and
    // Reflect.ownKeys() on arrays (returns string indices like "0").
    const getDeferredEntry = (
      key: PropertyKey,
    ): DeferredMap | null | undefined => {
      const entry = deferredKeys.get(key);
      if (entry !== undefined) return entry;
      if (typeof key === "string") {
        const num = Number(key);
        if (Number.isInteger(num)) return deferredKeys.get(num);
      } else if (typeof key === "number") {
        return deferredKeys.get(String(key));
      }
      return undefined;
    };
    const ownKeys = Reflect.ownKeys(parsed as object);
    let hasMatchingKey = false;
    for (const key of ownKeys) {
      if (getDeferredEntry(key) !== undefined) {
        hasMatchingKey = true;
        break;
      }
    }
    if (hasMatchingKey) {
      // If ALL data properties are deferred, the entire object is a
      // placeholder shell — return undefined instead of a truthy
      // object with all-undefined fields.
      const isArray = Array.isArray(parsed);
      let allDeferred = true;
      for (const key of ownKeys) {
        if (isArray && key === "length") continue;
        const desc = Object.getOwnPropertyDescriptor(parsed as object, key);
        if (
          desc != null && "value" in desc && getDeferredEntry(key) === undefined
        ) {
          allDeferred = false;
          break;
        }
      }
      if (allDeferred) return undefined;

      const clone: object = isArray
        ? new Array(parsed.length)
        : Object.create(Object.getPrototypeOf(parsed));
      for (const key of ownKeys) {
        const desc = Object.getOwnPropertyDescriptor(parsed as object, key);
        if (desc == null) continue;
        const entry = getDeferredEntry(key);
        if ("value" in desc && entry !== undefined) {
          if (entry === null) {
            // Fully deferred: replace with undefined
            Object.defineProperty(clone, key, { ...desc, value: undefined });
          } else {
            // Partially deferred sub-object: recurse
            Object.defineProperty(clone, key, {
              ...desc,
              value: prepareParsedForContexts(desc.value, true, entry),
            });
          }
        } else {
          Object.defineProperty(clone, key, desc);
        }
      }
      return clone;
    }
    // deferredKeys are present but none match the object's own properties.
    // The key set is stale relative to the current shape, so return
    // undefined to avoid leaking placeholder values.
    return undefined;
  }
  // Scalar deferred values (string, number, boolean, etc.) are entirely
  // placeholder data and should be hidden from phase-two contexts.
  if (parsed == null || typeof parsed !== "object") {
    return undefined;
  }
  // Structured deferred without per-field info (e.g., after map(), or
  // non-plain objects): pass through as-is so that context annotations can
  // still access non-deferred data inside the value.  This is an
  // intentional trade-off — map() drops deferredKeys because the transform
  // may rename/restructure fields, making the inner key set invalid for
  // the output shape.  Placeholder values may be visible to phase-two
  // contexts in this path; the final parse always resolves them correctly.
  return parsed;
}

function isBufferUnchanged(
  previous: readonly string[],
  current: readonly string[],
): boolean {
  return (
    current.length > 0 &&
    current.length === previous.length &&
    current.every((item, i) => item === previous[i])
  );
}

function getFailureProgress(
  args: readonly string[],
  buffer: readonly string[],
  consumedInStep: number,
): {
  readonly remainingArgs: readonly string[];
  readonly consumedCount: number;
} {
  return {
    remainingArgs: buffer.slice(consumedInStep),
    consumedCount: args.length - buffer.length + consumedInStep,
  };
}

type ParseAttempt<T> =
  | {
    readonly kind: "success";
    readonly value: T;
  }
  | {
    readonly kind: "failure";
    readonly error: Message;
    readonly remainingArgs: readonly string[];
    readonly consumedCount: number;
    readonly optionsTerminated: boolean;
    readonly commandPath: readonly string[];
  };

function createParseExec(
  parser: Parser<Mode, unknown, unknown>,
): ExecutionContext {
  return {
    usage: parser.usage,
    phase: "parse",
    path: [],
    commandPath: [],
    trace: createInputTrace(),
  };
}

function getCommandPath(exec: ExecutionContext | undefined): readonly string[] {
  return exec?.commandPath ?? [];
}

function createCompleteExec(
  exec: ExecutionContext,
  context: {
    readonly exec?: ExecutionContext;
    readonly trace?: ReturnType<typeof createInputTrace>;
  },
): ExecutionContext {
  const runtime = createDependencyRuntimeContext();
  return {
    ...exec,
    phase: "complete",
    dependencyRuntime: runtime,
    dependencyRegistry: runtime.registry,
    commandPath: getCommandPath(context.exec) ?? exec.commandPath,
    trace: context.exec?.trace ?? context.trace ?? exec.trace,
  };
}

function attemptParseSync<T>(
  parser: Parser<"sync", T, unknown>,
  args: readonly string[],
): ParseAttempt<T>;
function attemptParseSync(
  parser: Parser<"sync", unknown, unknown>,
  args: readonly string[],
  mode: "parse-only",
): ParseAttempt<undefined>;
function attemptParseSync<T>(
  parser: Parser<"sync", T, unknown>,
  args: readonly string[],
  mode: "complete" | "parse-only" = "complete",
): ParseAttempt<T | undefined> {
  const shouldUnwrapAnnotatedValue = isInjectedAnnotationWrapper(
    parser.initialState,
  );
  const exec = createParseExec(parser);
  let context: ParserContext<unknown> = createParserContext(
    { buffer: args, state: parser.initialState, optionsTerminated: false },
    exec,
  );

  do {
    const result = parser.parse(context);
    if (!result.success) {
      const progress = getFailureProgress(
        args,
        context.buffer,
        result.consumed,
      );
      return {
        kind: "failure",
        error: result.error,
        remainingArgs: progress.remainingArgs,
        consumedCount: progress.consumedCount,
        optionsTerminated: context.optionsTerminated,
        commandPath: getCommandPath(context.exec),
      };
    }
    const previousBuffer = context.buffer;
    context = result.next;
    if (isBufferUnchanged(previousBuffer, context.buffer)) {
      const progress = getFailureProgress(
        args,
        previousBuffer,
        result.consumed.length,
      );
      return {
        kind: "failure",
        error: message`Unexpected option or argument: ${context.buffer[0]}.`,
        remainingArgs: progress.remainingArgs,
        consumedCount: progress.consumedCount,
        optionsTerminated: context.optionsTerminated,
        commandPath: getCommandPath(context.exec),
      };
    }
  } while (context.buffer.length > 0);

  if (mode === "parse-only") {
    return {
      kind: "success",
      value: undefined,
    };
  }

  const endResult = parser.complete(
    context.state,
    createCompleteExec(exec, context),
  );
  if (!endResult.success) {
    return {
      kind: "failure",
      error: endResult.error,
      remainingArgs: [],
      consumedCount: args.length,
      optionsTerminated: context.optionsTerminated,
      commandPath: getCommandPath(context.exec),
    };
  }
  return {
    kind: "success",
    value: shouldUnwrapAnnotatedValue
      ? unwrapInjectedAnnotationWrapper(endResult.value)
      : endResult.value,
  };
}

async function attemptParseAsync<T>(
  parser: Parser<Mode, T, unknown>,
  args: readonly string[],
): Promise<ParseAttempt<T>>;
async function attemptParseAsync(
  parser: Parser<Mode, unknown, unknown>,
  args: readonly string[],
  mode: "parse-only",
): Promise<ParseAttempt<undefined>>;
async function attemptParseAsync<T>(
  parser: Parser<Mode, T, unknown>,
  args: readonly string[],
  mode: "complete" | "parse-only" = "complete",
): Promise<ParseAttempt<T | undefined>> {
  const shouldUnwrapAnnotatedValue = isInjectedAnnotationWrapper(
    parser.initialState,
  );
  const exec = createParseExec(parser);
  let context: ParserContext<unknown> = createParserContext(
    { buffer: args, state: parser.initialState, optionsTerminated: false },
    exec,
  );

  do {
    const result = await parser.parse(context);
    if (!result.success) {
      const progress = getFailureProgress(
        args,
        context.buffer,
        result.consumed,
      );
      return {
        kind: "failure",
        error: result.error,
        remainingArgs: progress.remainingArgs,
        consumedCount: progress.consumedCount,
        optionsTerminated: context.optionsTerminated,
        commandPath: getCommandPath(context.exec),
      };
    }
    const previousBuffer = context.buffer;
    context = result.next;
    if (isBufferUnchanged(previousBuffer, context.buffer)) {
      const progress = getFailureProgress(
        args,
        previousBuffer,
        result.consumed.length,
      );
      return {
        kind: "failure",
        error: message`Unexpected option or argument: ${context.buffer[0]}.`,
        remainingArgs: progress.remainingArgs,
        consumedCount: progress.consumedCount,
        optionsTerminated: context.optionsTerminated,
        commandPath: getCommandPath(context.exec),
      };
    }
  } while (context.buffer.length > 0);

  if (mode === "parse-only") {
    return {
      kind: "success",
      value: undefined,
    };
  }

  const endResult = await parser.complete(
    context.state,
    createCompleteExec(exec, context),
  );
  if (!endResult.success) {
    return {
      kind: "failure",
      error: endResult.error,
      remainingArgs: [],
      consumedCount: args.length,
      optionsTerminated: context.optionsTerminated,
      commandPath: getCommandPath(context.exec),
    };
  }
  return {
    kind: "success",
    value: shouldUnwrapAnnotatedValue
      ? unwrapInjectedAnnotationWrapper(endResult.value)
      : endResult.value,
  };
}

function createPhase2SeedExec(
  parser: Parser<Mode, unknown, unknown>,
  context: {
    readonly trace?: ReturnType<typeof createInputTrace>;
    readonly exec?: ExecutionContext;
  },
): ExecutionContext {
  const exec: ExecutionContext = {
    usage: parser.usage,
    phase: "parse",
    path: [],
    commandPath: [],
    trace: createInputTrace(),
  };
  const runtime = createDependencyRuntimeContext();
  return {
    ...exec,
    phase: "complete",
    dependencyRuntime: runtime,
    dependencyRegistry: runtime.registry,
    commandPath: getCommandPath(context.exec),
    trace: context.exec?.trace ?? context.trace ?? exec.trace,
  };
}

function createPhase2SeedContext(
  parser: Parser<Mode, unknown, unknown>,
  args: readonly string[],
) {
  const exec: ExecutionContext = {
    usage: parser.usage,
    phase: "parse",
    path: [],
    commandPath: [],
    trace: createInputTrace(),
  };
  return createParserContext(
    {
      buffer: args,
      state: parser.initialState,
      optionsTerminated: false,
    },
    exec,
  );
}

function extractPhase2SeedSync(
  parser: Parser<"sync", unknown, unknown>,
  args: readonly string[],
) {
  let context = createPhase2SeedContext(parser, args);
  do {
    const result = parser.parse(context);
    if (!result.success) {
      return completeOrExtractPhase2Seed(
        parser,
        context.state,
        createPhase2SeedExec(parser, context),
      );
    }
    const previousBuffer = context.buffer;
    context = result.next;
    if (isBufferUnchanged(previousBuffer, context.buffer)) {
      return completeOrExtractPhase2Seed(
        parser,
        context.state,
        createPhase2SeedExec(parser, context),
      );
    }
  } while (context.buffer.length > 0);
  return completeOrExtractPhase2Seed(
    parser,
    context.state,
    createPhase2SeedExec(parser, context),
  );
}

async function extractPhase2SeedAsync(
  parser: Parser<Mode, unknown, unknown>,
  args: readonly string[],
) {
  let context = createPhase2SeedContext(parser, args);
  do {
    const result = await parser.parse(context);
    if (!result.success) {
      return await completeOrExtractPhase2Seed(
        parser,
        context.state,
        createPhase2SeedExec(parser, context),
      );
    }
    const previousBuffer = context.buffer;
    context = result.next;
    if (isBufferUnchanged(previousBuffer, context.buffer)) {
      return await completeOrExtractPhase2Seed(
        parser,
        context.state,
        createPhase2SeedExec(parser, context),
      );
    }
  } while (context.buffer.length > 0);
  return await completeOrExtractPhase2Seed(
    parser,
    context.state,
    createPhase2SeedExec(parser, context),
  );
}

/**
 * Helper types for parser generation
 */
interface HelpParsers {
  readonly helpCommand: Parser<"sync", readonly string[], unknown> | null;
  readonly helpOption: Parser<"sync", boolean, unknown> | null;
}

interface VersionParsers {
  readonly versionCommand:
    | Parser<"sync", Record<PropertyKey, never>, unknown>
    | null;
  readonly versionOption: Parser<"sync", boolean, unknown> | null;
}

/**
 * Creates help parsers based on the sub-config.
 */
function createHelpParser(
  commandConfig?: CommandSubConfig,
  optionConfig?: OptionSubConfig,
): HelpParsers {
  let helpCommand: HelpParsers["helpCommand"] = null;
  let helpOption: HelpParsers["helpOption"] = null;

  if (commandConfig) {
    const names = commandConfig.names ?? ["help"];
    const innerParser = multiple(
      argument(string({ metavar: "COMMAND" }), {
        description: message`Command name to show help for.`,
      }),
    );
    const commandParsers: Parser<
      "sync",
      readonly string[],
      unknown
    >[] = [];
    for (let i = 0; i < names.length; i++) {
      commandParsers.push(
        command(names[i], innerParser, {
          description: message`Show help information.`,
          hidden: i === 0 ? commandConfig.hidden : true,
        }),
      );
    }
    helpCommand = commandParsers.length === 1
      ? commandParsers[0]
      : longestMatch(...commandParsers);
  }

  if (optionConfig) {
    const names = optionConfig.names ?? ["--help"];
    helpOption = flag(...names, {
      description: message`Show help information.`,
      hidden: optionConfig.hidden,
    });
  }

  return { helpCommand, helpOption };
}

/**
 * Creates version parsers based on the sub-config.
 */
function createVersionParser(
  commandConfig?: CommandSubConfig,
  optionConfig?: OptionSubConfig,
): VersionParsers {
  let versionCommand: VersionParsers["versionCommand"] = null;
  let versionOption: VersionParsers["versionOption"] = null;

  if (commandConfig) {
    const names = commandConfig.names ?? ["version"];
    const innerParser = object({});
    const commandParsers: Parser<
      "sync",
      Record<PropertyKey, never>,
      unknown
    >[] = [];
    for (let i = 0; i < names.length; i++) {
      commandParsers.push(
        command(names[i], innerParser, {
          description: message`Show version information.`,
          hidden: i === 0 ? commandConfig.hidden : true,
        }),
      );
    }
    versionCommand = commandParsers.length === 1
      ? commandParsers[0]
      : longestMatch(...commandParsers);
  }

  if (optionConfig) {
    const names = optionConfig.names ?? ["--version"];
    versionOption = flag(...names, {
      description: message`Show version information.`,
      hidden: optionConfig.hidden,
    });
  }

  return { versionCommand, versionOption };
}

interface CompletionParsers {
  readonly completionCommand:
    | Parser<
      "sync",
      { shell: string | undefined; args: readonly string[] },
      unknown
    >
    | null;
  readonly completionOption:
    | Parser<
      "sync",
      { shell: string; args: readonly string[] },
      unknown
    >
    | null;
}

const metaResultBrand: unique symbol = Symbol("@optique/core/facade/meta");

interface MetaParseResult {
  readonly [metaResultBrand]: true;
  readonly help: boolean;
  readonly version: boolean;
  readonly completion?: boolean;
  readonly commands?: readonly string[] | { readonly length: number };
  readonly completionData?: {
    readonly shell: string | undefined;
    readonly args: readonly string[] | undefined;
  };
  readonly result?: unknown;
  readonly helpFlag?: boolean;
  readonly versionFlag?: boolean;
}

/**
 * Sub-configuration for a meta command's command form.
 *
 * @since 1.0.0
 */
export interface CommandSubConfig {
  /**
   * Command names.  The first element is the display name shown in help
   * output; additional elements are hidden aliases that are accepted but
   * not shown.
   */
  readonly names?: readonly [string, ...string[]];

  /**
   * Group label for the command in help output.  When specified, the command
   * appears under a titled section with this name instead of alongside
   * user-defined commands.
   */
  readonly group?: string;

  /**
   * Granular visibility control.
   *
   * - `true`: Hidden from usage, documentation, and suggestions.
   * - `"usage"`: Hidden from usage lines only.
   * - `"doc"`: Hidden from documentation only.
   * - `"help"`: Hidden from usage and documentation only.
   */
  readonly hidden?: HiddenVisibility;
}

/**
 * Sub-configuration for a meta command's option form.
 *
 * @since 1.0.0
 */
export interface OptionSubConfig {
  /**
   * Option names (all shown in help, e.g., `"-h"`, `"--help"`).
   */
  readonly names?: readonly [OptionName, ...OptionName[]];

  /**
   * Group label for the option in help output.
   */
  readonly group?: string;

  /**
   * Granular visibility control.
   *
   * - `true`: Hidden from usage, documentation, and suggestions.
   * - `"usage"`: Hidden from usage lines only.
   * - `"doc"`: Hidden from documentation only.
   * - `"help"`: Hidden from usage and documentation only.
   */
  readonly hidden?: HiddenVisibility;
}

/**
 * Creates completion parsers based on the sub-config.
 */
function createCompletionParser(
  programName: string,
  availableShells: Record<string, ShellCompletion>,
  commandConfig?: CommandSubConfig,
  optionConfig?: OptionSubConfig,
): CompletionParsers {
  let completionCommand: CompletionParsers["completionCommand"] = null;
  let completionOption: CompletionParsers["completionOption"] = null;

  const shellList: MessageTerm[] = [];
  for (const shell in availableShells) {
    if (shellList.length > 0) shellList.push(text(", "));
    shellList.push(value(shell));
  }

  const completionInner = object({
    shell: optional(
      argument(string({ metavar: "SHELL" }), {
        description:
          message`Shell type (${shellList}). Generate completion script when used alone, or provide completions when followed by arguments.`,
      }),
    ),
    args: multiple(
      argument(string({ metavar: "ARG" }), {
        description:
          message`Command line arguments for completion suggestions (used by shell integration; you usually don't need to provide this).`,
      }),
    ),
  });

  if (commandConfig) {
    const names = commandConfig.names ?? ["completion"];
    const displayName = names[0];

    const completionCommandConfig = {
      brief: message`Generate shell completion script or provide completions.`,
      description:
        message`Generate shell completion script or provide completions.`,
      footer: message`Examples:${lineBreak()}  Bash:       ${
        commandLine(`eval "$(${programName} ${displayName} bash)"`)
      }${lineBreak()}  zsh:        ${
        commandLine(`eval "$(${programName} ${displayName} zsh)"`)
      }${lineBreak()}  fish:       ${
        commandLine(`eval "$(${programName} ${displayName} fish)"`)
      }${lineBreak()}  PowerShell: ${
        commandLine(
          `${programName} ${displayName} pwsh > ${programName}-completion.ps1; . ./${programName}-completion.ps1`,
        )
      }${lineBreak()}  Nushell:    ${
        commandLine(
          `${programName} ${displayName} nu | save ${programName}-completion.nu; source ./${programName}-completion.nu`,
        )
      }`,
    };

    const commandParsers: Parser<
      "sync",
      { shell: string | undefined; args: readonly string[] },
      unknown
    >[] = [];
    for (let i = 0; i < names.length; i++) {
      commandParsers.push(
        command(names[i], completionInner, {
          ...completionCommandConfig,
          hidden: i === 0 ? commandConfig.hidden : true,
        }),
      );
    }

    completionCommand = commandParsers.length === 1
      ? commandParsers[0]
      : longestMatch(...commandParsers);
  }

  if (optionConfig) {
    const names = optionConfig.names ?? ["--completion"];

    const completionOptions: Parser<"sync", string, unknown>[] = [];
    for (const name of names) {
      completionOptions.push(
        option(name, string({ metavar: "SHELL" }), {
          description: message`Generate shell completion script.`,
          hidden: optionConfig.hidden,
        }),
      );
    }

    const completionOptionParser = completionOptions.length === 1
      ? completionOptions[0]
      : longestMatch(...completionOptions);

    const argsParser = withDefault(
      multiple(
        argument(string({ metavar: "ARG" }), {
          description:
            message`Command line arguments for completion suggestions (used by shell integration; you usually don't need to provide this).`,
        }),
      ),
      [] as readonly string[],
    );

    completionOption = object({
      shell: completionOptionParser,
      args: argsParser,
    }) as Parser<
      "sync",
      { shell: string; args: readonly string[] },
      unknown
    >;
  }

  return { completionCommand, completionOption };
}

/**
 * Result classification types for cleaner control flow.
 */
type ParsedResult =
  | { readonly type: "success"; readonly value: unknown }
  | {
    readonly type: "help";
    readonly commands: readonly string[];
    readonly preferUserCommandDocs?: boolean;
  }
  | { readonly type: "version" }
  | {
    readonly type: "completion";
    readonly source: "command" | "option";
    readonly shell: string;
    readonly commandPath?: readonly string[];
    readonly args: readonly string[];
  }
  | { readonly type: "error"; readonly error: Message };

/**
 * Systematically combines the original parser with help, version, and completion parsers.
 */
interface MetaCommandGroups {
  readonly helpCommandGroup?: string;
  readonly helpOptionGroup?: string;
  readonly versionCommandGroup?: string;
  readonly versionOptionGroup?: string;
  readonly completionCommandGroup?: string;
  readonly completionOptionGroup?: string;
}

function combineWithHelpVersion(
  originalParser: Parser<Mode, unknown, unknown>,
  helpParsers: HelpParsers,
  versionParsers: VersionParsers,
  completionParsers: CompletionParsers,
  groups?: MetaCommandGroups,
  helpOptionNames?: readonly string[],
  versionOptionNames?: readonly string[],
): Parser<Mode, unknown, unknown> {
  const parsers: Parser<Mode, unknown, unknown>[] = [];

  const effectiveHelpOptionNames = helpOptionNames ?? ["--help"];
  const effectiveVersionOptionNames = versionOptionNames ?? ["--version"];

  // Add options FIRST - they are more specific and should have priority

  // Add help option (standalone) - accepts any mix of options and arguments
  if (helpParsers.helpOption) {
    // Create a lenient help parser that accepts help flag anywhere
    // and ignores all other options/arguments
    const lenientHelpParser: Parser<"sync", unknown, unknown> = {
      $mode: "sync",
      $valueType: [],
      $stateType: [],
      priority: 200, // Very high priority
      usage: helpParsers.helpOption.usage,
      leadingNames: helpParsers.helpOption.leadingNames,
      acceptingAnyToken: false,
      initialState: null,

      parse(context) {
        const { buffer, optionsTerminated } = context;

        // If options are terminated (after --), don't match
        if (optionsTerminated) {
          return {
            success: false,
            error: message`Options terminated.`,
            consumed: 0,
          };
        }

        let helpFound = false;
        let helpIndex = -1;

        // Look for help option names and version option names to implement
        // last-option-wins
        let versionIndex = -1;
        for (let i = 0; i < buffer.length; i++) {
          if (buffer[i] === "--") break; // Stop at options terminator
          if (effectiveHelpOptionNames.includes(buffer[i])) {
            helpFound = true;
            helpIndex = i;
          }
          if (effectiveVersionOptionNames.includes(buffer[i])) {
            versionIndex = i;
          }
        }

        // If both help and version options are present, but version comes
        // last, don't match
        if (helpFound && versionIndex > helpIndex) {
          return {
            success: false,
            error: message`Version option wins.`,
            consumed: 0,
          };
        }

        // Multiple help options is OK - just show help

        if (helpFound) {
          // Extract command names that appear before the help option
          const commands: string[] = [];
          for (let i = 0; i < helpIndex; i++) {
            const arg = buffer[i];
            // Include non-option arguments as commands (don't start with -)
            if (!arg.startsWith("-")) {
              commands.push(arg);
            }
          }

          // Consume all remaining arguments and return success
          return {
            success: true,
            next: {
              ...context,
              buffer: [],
              state: {
                [metaResultBrand]: true,
                help: true,
                version: false,
                completion: false,
                commands,
                helpFlag: true,
              },
            },
            consumed: buffer.slice(0),
          };
        }

        // Help option not found
        return {
          success: false,
          error: message`Flag ${
            optionName(effectiveHelpOptionNames[0])
          } not found.`,
          consumed: 0,
        };
      },

      complete(state) {
        return { success: true, value: state };
      },

      *suggest(_context, prefix) {
        for (const name of effectiveHelpOptionNames) {
          if (name.startsWith(prefix)) {
            yield { kind: "literal", text: name } as const;
          }
        }
      },

      getDocFragments(state) {
        return helpParsers.helpOption?.getDocFragments(state) ??
          { fragments: [] };
      },
    };

    const wrappedHelp = groups?.helpOptionGroup
      ? group(groups.helpOptionGroup, lenientHelpParser)
      : lenientHelpParser;
    parsers.push(wrappedHelp);
  }

  // Add version option (standalone) - accepts any mix of options and arguments
  if (versionParsers.versionOption) {
    // Create a lenient version parser that accepts version flag anywhere
    // and ignores all other options/arguments
    const lenientVersionParser: Parser<"sync", unknown, unknown> = {
      $mode: "sync",
      $valueType: [],
      $stateType: [],
      priority: 200, // Very high priority
      usage: versionParsers.versionOption.usage,
      leadingNames: versionParsers.versionOption.leadingNames,
      acceptingAnyToken: false,
      initialState: null,

      parse(context) {
        const { buffer, optionsTerminated } = context;

        // If options are terminated (after --), don't match
        if (optionsTerminated) {
          return {
            success: false,
            error: message`Options terminated.`,
            consumed: 0,
          };
        }

        let versionFound = false;
        let versionIndex = -1;

        // Look for version option names and help option names to implement
        // last-option-wins
        let helpIndex = -1;
        for (let i = 0; i < buffer.length; i++) {
          if (buffer[i] === "--") break; // Stop at options terminator
          if (effectiveVersionOptionNames.includes(buffer[i])) {
            versionFound = true;
            versionIndex = i;
          }
          if (effectiveHelpOptionNames.includes(buffer[i])) {
            helpIndex = i;
          }
        }

        // If both version and help options are present, but help comes last,
        // don't match
        if (versionFound && helpIndex > versionIndex) {
          return {
            success: false,
            error: message`Help option wins.`,
            consumed: 0,
          };
        }

        // Multiple version options is OK - just show version

        if (versionFound) {
          // Consume all remaining arguments and return success
          return {
            success: true,
            next: {
              ...context,
              buffer: [],
              state: {
                [metaResultBrand]: true,
                help: false,
                version: true,
                completion: false,
                versionFlag: true,
              },
            },
            consumed: buffer.slice(0),
          };
        }

        // Version option not found
        return {
          success: false,
          error: message`Flag ${
            optionName(effectiveVersionOptionNames[0])
          } not found.`,
          consumed: 0,
        };
      },

      complete(state) {
        return { success: true, value: state };
      },

      *suggest(_context, prefix) {
        for (const name of effectiveVersionOptionNames) {
          if (name.startsWith(prefix)) {
            yield { kind: "literal", text: name } as const;
          }
        }
      },

      getDocFragments(state) {
        return versionParsers.versionOption?.getDocFragments(state) ??
          { fragments: [] };
      },
    };

    const wrappedVersion = groups?.versionOptionGroup
      ? group(groups.versionOptionGroup, lenientVersionParser)
      : lenientVersionParser;
    parsers.push(wrappedVersion);
  }

  // Add version command with optional help flag (enables version --help)
  if (versionParsers.versionCommand) {
    const versionParser = object({
      [metaResultBrand]: constant(true),
      help: constant(false),
      version: constant(true),
      completion: constant(false),
      result: versionParsers.versionCommand,
      helpFlag: helpParsers.helpOption
        ? optional(helpParsers.helpOption)
        : constant(false),
    });
    parsers.push(
      groups?.versionCommandGroup
        ? group(groups.versionCommandGroup, versionParser)
        : versionParser,
    );
  }

  // Add completion command with optional help flag (enables completion --help)
  if (completionParsers.completionCommand) {
    const completionParser = object({
      [metaResultBrand]: constant(true),
      help: constant(false),
      version: constant(false),
      completion: constant(true),
      completionData: completionParsers.completionCommand,
      helpFlag: helpParsers.helpOption
        ? optional(helpParsers.helpOption)
        : constant(false),
    });
    parsers.push(
      groups?.completionCommandGroup
        ? group(groups.completionCommandGroup, completionParser)
        : completionParser,
    );
  }

  // Add help command
  if (helpParsers.helpCommand) {
    const helpParser = object({
      [metaResultBrand]: constant(true),
      help: constant(true),
      version: constant(false),
      completion: constant(false),
      commands: helpParsers.helpCommand,
    });
    parsers.push(
      groups?.helpCommandGroup
        ? group(groups.helpCommandGroup, helpParser)
        : helpParser,
    );
  }

  // NOTE: completion *option* (e.g. `--completion SHELL`) is intentionally
  // NOT added here.  Unlike `--help` and `--version` which use lenient
  // scanners, the completion option requires a value argument and would
  // create a branch that fails when `--completion` is absent.  Completion
  // option requests are handled by the early-return code in `runParser()`
  // before the combined parser runs.  The completion option still appears
  // in help text via the help generation code in `handleResult()`.

  // Add main parser LAST - it's the most general
  parsers.push(object({
    [metaResultBrand]: constant(true),
    help: constant(false),
    version: constant(false),
    completion: constant(false),
    result: originalParser,
  }));

  // Track where the main parser is before building longestMatch
  const mainParserIndex = parsers.length - 1;

  if (parsers.length === 1) {
    return parsers[0];
  }

  let combined: Parser<Mode, unknown, unknown>;
  if (parsers.length === 2) {
    combined = longestMatch(parsers[0], parsers[1]);
  } else {
    // Use variadic longestMatch for all parsers
    // Our lenient help/version parsers will win because they consume all input
    combined = longestMatch(...parsers);
  }

  // Reorder the usage so that the main parser's usage appears before
  // meta-command (version/completion/help) usage.  The parsing order
  // remains unchanged — only the display order is affected.
  // See https://github.com/dahlia/optique/issues/107
  const topUsage = combined.usage[0];
  if (topUsage?.type === "exclusive" && mainParserIndex > 0) {
    const terms = [...topUsage.terms];
    const [mainTerm] = terms.splice(mainParserIndex, 1);
    // Insert main parser usage right after the lenient option parsers
    // (which occupy the first slots) but before meta commands.
    const lenientCount = (helpParsers.helpOption ? 1 : 0) +
      (versionParsers.versionOption ? 1 : 0);
    terms.splice(lenientCount, 0, mainTerm);
    combined = {
      ...combined,
      usage: [{ ...topUsage, terms }],
    };
  }

  return combined;
}

interface CompletionOptionMatch {
  readonly index: number;
  readonly shell: string;
  readonly args: readonly string[];
}

interface MetaAction {
  readonly index: number;
  readonly kind: "help" | "version";
}

function classifyOptionMeta(
  scanArgs: readonly string[],
  fullArgs: readonly string[],
  helpOptionNames: readonly string[],
  versionOptionNames: readonly string[],
  completionOptionNames: readonly string[],
): {
  readonly lastHelpVersion?: MetaAction;
  readonly completion?: CompletionOptionMatch;
} {
  let lastHelpVersion: MetaAction | undefined;
  for (let i = 0; i < scanArgs.length; i++) {
    const arg = scanArgs[i];

    if (helpOptionNames.includes(arg)) {
      lastHelpVersion = { index: i, kind: "help" };
    } else if (versionOptionNames.includes(arg)) {
      lastHelpVersion = { index: i, kind: "version" };
    }

    const equalsMatch = completionOptionNames.find((name) =>
      arg.startsWith(name + "=")
    );
    if (equalsMatch != null) {
      return {
        lastHelpVersion,
        completion: {
          index: i,
          shell: arg.slice(equalsMatch.length + 1),
          args: fullArgs.slice(i + 1),
        },
      };
    }

    if (completionOptionNames.includes(arg)) {
      const shell = scanArgs[i + 1] ?? "";
      return {
        lastHelpVersion,
        completion: {
          index: i,
          shell,
          args: shell === "" ? [] : fullArgs.slice(i + 2),
        },
      };
    }
  }
  return { lastHelpVersion };
}

function getHelpCommandContext(
  commandPath: readonly string[],
  args: readonly string[],
  helpIndex: number,
): readonly string[] {
  const commands = [...commandPath];
  for (let i = 0; i < helpIndex; i++) {
    const arg = args[i];
    if (!arg.startsWith("-")) {
      commands.push(arg);
    }
  }
  return commands;
}

function classifyParseFailure(
  failure: Extract<ParseAttempt<unknown>, { readonly kind: "failure" }>,
  helpOptionNames: readonly string[],
  helpCommandNames: readonly string[],
  versionOptionNames: readonly string[],
  versionCommandNames: readonly string[],
  completionOptionNames: readonly string[],
  completionCommandNames: readonly string[],
): Exclude<ParsedResult, { readonly type: "success" }> {
  if (failure.remainingArgs.length < 1) {
    return { type: "error", error: failure.error };
  }

  const hasConsumedPrefix = failure.consumedCount > 0;
  const firstArg = failure.remainingArgs[0];

  if (
    !hasConsumedPrefix &&
    completionCommandNames.includes(firstArg)
  ) {
    const secondArg = failure.remainingArgs[1];
    if (helpOptionNames.includes(secondArg)) {
      return { type: "help", commands: [firstArg] };
    }
    return {
      type: "completion",
      source: "command",
      shell: secondArg ?? "",
      args: failure.remainingArgs.slice(2),
    };
  }

  const optionArgs = failure.optionsTerminated ? [] : (() => {
    const terminatorIndex = failure.remainingArgs.indexOf("--");
    return terminatorIndex >= 0
      ? failure.remainingArgs.slice(0, terminatorIndex)
      : failure.remainingArgs;
  })();
  const { lastHelpVersion, completion } = classifyOptionMeta(
    optionArgs,
    failure.remainingArgs,
    helpOptionNames,
    versionOptionNames,
    completionOptionNames,
  );

  if (!hasConsumedPrefix && versionCommandNames.includes(firstArg)) {
    const secondArg = failure.remainingArgs[1];
    if (helpOptionNames.includes(secondArg)) {
      return { type: "help", commands: [firstArg] };
    }
    const isCompletionImmediatelyAfter = completion?.index === 1;
    if (
      secondArg == null ||
      isCompletionImmediatelyAfter ||
      (lastHelpVersion?.index === 1 && lastHelpVersion.kind === "version")
    ) {
      return { type: "version" };
    }
    return { type: "error", error: failure.error };
  }

  let commandAction: MetaAction | undefined;
  if (!hasConsumedPrefix && helpCommandNames.includes(firstArg)) {
    commandAction = { index: 0, kind: "help" };
  }

  const winner = lastHelpVersion == null
    ? commandAction
    : commandAction == null || lastHelpVersion.index >= commandAction.index
    ? lastHelpVersion
    : commandAction;

  if (winner?.kind === "help") {
    if (winner === commandAction) {
      return {
        type: "help",
        commands: failure.remainingArgs.slice(1),
      };
    }
    return {
      type: "help",
      commands: getHelpCommandContext(
        failure.commandPath,
        failure.remainingArgs,
        winner.index,
      ),
      preferUserCommandDocs: failure.commandPath.length > 0,
    };
  }

  if (winner?.kind === "version") {
    return { type: "version" };
  }

  if (completion != null) {
    return {
      type: "completion",
      source: "option",
      shell: completion.shell,
      commandPath: failure.commandPath,
      args: completion.args,
    };
  }

  return { type: "error", error: failure.error };
}

/**
 * Configuration options for the {@link run} function.
 *
 * @template THelp The return type when help is shown.
 * @template TError The return type when an error occurs.
 */
export interface RunOptions<THelp, TError> {
  /**
   * Enable colored output in help and error messages.
   *
   * @default `false`
   */
  readonly colors?: boolean;

  /**
   * Maximum width for output formatting. Text will be wrapped to fit within
   * this width.  If not specified, text will not be wrapped.
   */
  readonly maxWidth?: number;

  /**
   * Whether and how to display default values for options and arguments.
   *
   * - `boolean`: When `true`, displays defaults using format `[value]`
   * - `ShowDefaultOptions`: Custom formatting with configurable prefix and suffix
   *
   * Default values are automatically dimmed when `colors` is enabled.
   *
   * @default `false`
   * @since 0.4.0
   */
  readonly showDefault?: boolean | ShowDefaultOptions;

  /**
   * Whether and how to display valid choices for options and arguments
   * backed by enumerated value parsers (e.g., `choice()`).
   *
   * - `boolean`: When `true`, displays choices using format
   *   `(choices: a, b, c)`
   * - `ShowChoicesOptions`: Custom formatting with configurable prefix,
   *   suffix, label, and maximum number of items
   *
   * Choice values are automatically dimmed when `colors` is enabled.
   *
   * @default `false`
   * @since 0.10.0
   */
  readonly showChoices?: boolean | ShowChoicesOptions;

  /**
   * A custom comparator function to control the order of sections in the
   * help output.  When provided, it is used instead of the default smart
   * sort (command-only sections first, then mixed, then option/argument-only
   * sections).  Sections that compare equal (return `0`) preserve their
   * original relative order.
   *
   * @param a The first section to compare.
   * @param b The second section to compare.
   * @returns A negative number if `a` should appear before `b`, a positive
   *   number if `a` should appear after `b`, or `0` if they are equal.
   * @since 1.0.0
   */
  readonly sectionOrder?: (a: DocSection, b: DocSection) => number;

  /**
   * Help configuration.  When provided, enables help functionality.
   * At least one of `command` or `option` must be specified.
   *
   * @since 1.0.0
   */
  readonly help?:
    & {
      /** Callback invoked when help is requested. */
      readonly onShow?: (() => THelp) | ((exitCode: number) => THelp);
    }
    & (
      | {
        readonly command: true | CommandSubConfig;
        readonly option?: true | OptionSubConfig;
      }
      | {
        readonly option: true | OptionSubConfig;
        readonly command?: true | CommandSubConfig;
      }
    );

  /**
   * Version configuration.  When provided, enables version functionality.
   * At least one of `command` or `option` must be specified.
   *
   * @since 1.0.0
   */
  readonly version?:
    & {
      /** The version string to display when version is requested. */
      readonly value: string;
      /** Callback invoked when version is requested. */
      readonly onShow?: (() => THelp) | ((exitCode: number) => THelp);
    }
    & (
      | {
        readonly command: true | CommandSubConfig;
        readonly option?: true | OptionSubConfig;
      }
      | {
        readonly option: true | OptionSubConfig;
        readonly command?: true | CommandSubConfig;
      }
    );

  /**
   * Completion configuration.  When provided, enables shell completion.
   * At least one of `command` or `option` must be specified.
   *
   * @since 1.0.0
   */
  readonly completion?:
    & {
      /**
       * Available shell completions.  By default, includes `bash`, `fish`,
       * `nu`, `pwsh`, and `zsh`.
       *
       * @default `{ bash, fish, nu, pwsh, zsh }`
       */
      readonly shells?: Record<string, ShellCompletion>;
      /** Callback invoked when completion is requested. */
      readonly onShow?: (() => THelp) | ((exitCode: number) => THelp);
    }
    & (
      | {
        readonly command: true | CommandSubConfig;
        readonly option?: true | OptionSubConfig;
      }
      | {
        readonly option: true | OptionSubConfig;
        readonly command?: true | CommandSubConfig;
      }
    );

  /**
   * What to display above error messages:
   * - `"usage"`: Show usage information
   * - `"help"`: Show help text (if available)
   * - `"none"`: Show nothing above errors
   *
   * @default `"usage"`
   */
  readonly aboveError?: "usage" | "help" | "none";

  /**
   * Callback function invoked when parsing fails. The function can
   * optionally receive an exit code parameter.
   *
   * You usually want to pass `process.exit` on Node.js or Bun and `Deno.exit`
   * on Deno to this option.
   * @default Throws a {@link RunParserError}.
   */
  readonly onError?: (() => TError) | ((exitCode: number) => TError);

  /**
   * Function used to output error messages.  Assumes it prints the ending
   * newline.
   *
   * @default `console.error`
   */
  readonly stderr?: (text: string) => void;

  /**
   * Function used to output help and usage messages.  Assumes it prints
   * the ending newline.
   *
   * @default `console.log`
   */
  readonly stdout?: (text: string) => void;

  /**
   * Brief description shown at the top of help text.
   *
   * @since 0.4.0
   */
  readonly brief?: Message;

  /**
   * Detailed description shown after the usage line.
   *
   * @since 0.4.0
   */
  readonly description?: Message;

  /**
   * Usage examples for the program.
   *
   * @since 0.10.0
   */
  readonly examples?: Message;

  /**
   * Author information.
   *
   * @since 0.10.0
   */
  readonly author?: Message;

  /**
   * Information about where to report bugs.
   *
   * @since 0.10.0
   */
  readonly bugs?: Message;

  /**
   * Footer text shown at the bottom of help text.
   *
   * @since 0.4.0
   */
  readonly footer?: Message;
}

/**
 * Handles shell completion requests.
 * @since 0.6.0
 */
function handleCompletion<M extends Mode, THelp, TError>(
  completionArgs: readonly string[],
  programName: string,
  parser: Parser<M, unknown, unknown>,
  completionParser: Parser<"sync", unknown, unknown> | null,
  stdout: (text: string) => void,
  stderr: (text: string) => void,
  onCompletion: (() => THelp) | ((exitCode: number) => THelp),
  onError: (() => TError) | ((exitCode: number) => TError),
  availableShells: Record<string, ShellCompletion>,
  colors?: boolean,
  maxWidth?: number,
  completionCommandDisplayName?: string,
  completionOptionDisplayName?: string,
  isOptionMode?: boolean,
  sectionOrder?: (a: DocSection, b: DocSection) => number,
): ModeValue<M, THelp | TError> {
  const shellName = completionArgs[0] || "";
  const args = completionArgs.slice(1);

  const callOnError = (code: number): TError => onError(code);

  const callOnCompletion = (code: number): THelp => onCompletion(code);

  // Check if shell name is empty
  if (!shellName) {
    stderr("Error: Missing shell name for completion.\n");

    // Show help for completion command if parser is available
    if (completionParser) {
      const displayName = isOptionMode
        ? (completionOptionDisplayName ?? "--completion")
        : (completionCommandDisplayName ?? "completion");
      const doc = getDocPage(completionParser, [displayName]);
      if (doc) {
        stderr(
          formatDocPage(programName, doc, { colors, maxWidth, sectionOrder }),
        );
      }
    }

    return dispatchByMode(
      parser.$mode,
      () => {
        const result = callOnError(1);
        if (result instanceof Promise) {
          throw new RunParserError("Synchronous parser returned async result.");
        }
        return result;
      },
      // deno-lint-ignore require-await -- async wraps synchronous throws as rejections
      async () => callOnError(1),
    );
  }

  const shell = availableShells[shellName];

  if (!shell) {
    const available: MessageTerm[] = [];
    for (const name in availableShells) {
      if (available.length > 0) available.push(text(", "));
      available.push(value(name));
    }
    stderr(
      formatMessage(
        message`Error: Unsupported shell ${shellName}. Available shells: ${available}.`,
        { colors, quotes: !colors },
      ),
    );
    return dispatchByMode(
      parser.$mode,
      () => {
        const result = callOnError(1);
        if (result instanceof Promise) {
          throw new RunParserError("Synchronous parser returned async result.");
        }
        return result;
      },
      // deno-lint-ignore require-await -- async wraps synchronous throws as rejections
      async () => callOnError(1),
    );
  }

  if (args.length === 0) {
    // Generate completion script
    const completionArg = isOptionMode
      ? (completionOptionDisplayName ?? "--completion")
      : (completionCommandDisplayName ?? "completion");
    const script = shell.generateScript(programName, [
      completionArg,
      shellName,
    ]);
    stdout(script);

    return dispatchByMode(
      parser.$mode,
      () => {
        const result = callOnCompletion(0);
        if (result instanceof Promise) {
          throw new RunParserError("Synchronous parser returned async result.");
        }
        return result;
      },
      // deno-lint-ignore require-await -- async wraps synchronous throws as rejections
      async () => callOnCompletion(0),
    );
  }

  // Provide completion suggestions
  return dispatchByMode(
    parser.$mode,
    () => {
      const syncParser = parser as Parser<"sync", unknown, unknown>;
      const suggestions = suggest(syncParser, args as [string, ...string[]]);
      for (const chunk of shell.encodeSuggestions(suggestions)) {
        stdout(chunk);
      }
      const result = callOnCompletion(0);
      if (result instanceof Promise) {
        throw new RunParserError("Synchronous parser returned async result.");
      }
      return result;
    },
    async () => {
      const suggestions = await suggestAsync(
        parser as Parser<"async", unknown, unknown>,
        args as [string, ...string[]],
      );
      for (const chunk of shell.encodeSuggestions(suggestions)) {
        stdout(chunk);
      }
      return callOnCompletion(0);
    },
  );
}

/**
 * Validates the configured version value.
 *
 * @param value Runtime version value from configuration.
 * @returns The validated version string.
 * @throws {TypeError} If the value is not a string, is empty, or contains
 *         ASCII control characters.
 */
function validateVersionValue(value: unknown): string {
  if (typeof value !== "string") {
    const type = Array.isArray(value) ? "array" : typeof value;
    throw new TypeError(
      `Expected version value to be a string, but got ${type}.`,
    );
  }
  if (value === "") {
    throw new TypeError("Version value must not be empty.");
  }
  // deno-lint-ignore no-control-regex
  if (/[\x00-\x1f\x7f]/.test(value)) {
    throw new TypeError(
      "Version value must not contain control characters.",
    );
  }
  return value;
}

/**
 * Runs a parser against command-line arguments with built-in help and error
 * handling.
 *
 * This function provides a complete CLI interface by automatically handling
 * help commands/options and displaying formatted error messages with usage
 * information when parsing fails. It augments the provided parser with help
 * functionality based on the configuration options.
 *
 * The function will:
 *
 * 1. Add help command/option support (unless disabled)
 * 2. Parse the provided arguments
 * 3. Display help if requested
 * 4. Show formatted error messages with usage/help info on parse failures
 * 5. Return the parsed result or invoke the appropriate callback
 *
 * @template TParser The parser type being run.
 * @template THelp Return type when help is shown (defaults to `void`).
 * @template TError Return type when an error occurs (defaults to `never`).
 * @param parser The parser to run against the command-line arguments.
 * @param programName Name of the program used in usage and help output.
 * @param args Command-line arguments to parse (typically from
 *             `process.argv.slice(2)` on Node.js or `Deno.args` on Deno).
 * @param options Configuration options for output formatting and callbacks.
 * @returns The parsed result value, or the return value of `onHelp`/`onError`
 *          callbacks.
 * @throws {TypeError} If `programName` (or `program.metadata.name`) is not
 *          a string, is empty, is whitespace-only, or contains control
 *          characters.  Also thrown if `options.version.value` is not a
 *          non-empty string without ASCII control characters, or if any
 *          meta command/option name is empty, whitespace-only, contains
 *          whitespace or control characters, or (for option names) lacks a
 *          valid prefix (`--`, `-`, `/`, or `+`).
 * @throws {RunParserError} When parsing fails and no `onError` callback is
 *          provided.
 * @since 0.10.0 Added support for {@link Program} objects.
 */
// Overload: Program with sync parser
export function runParser<T, THelp = void, TError = never>(
  program: Program<"sync", T>,
  args: readonly string[],
  options?: RunOptions<THelp, TError>,
): T;

// Overload: Program with async parser
export function runParser<T, THelp = void, TError = never>(
  program: Program<"async", T>,
  args: readonly string[],
  options?: RunOptions<THelp, TError>,
): Promise<T>;

// Overload: sync parser returns sync result
export function runParser<
  TParser extends Parser<"sync", unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  args: readonly string[],
  options?: RunOptions<THelp, TError>,
): InferValue<TParser>;

// Overload: async parser returns Promise
export function runParser<
  TParser extends Parser<"async", unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  args: readonly string[],
  options?: RunOptions<THelp, TError>,
): Promise<InferValue<TParser>>;

// Overload: generic mode parser returns ModeValue (for internal use)
export function runParser<
  TParser extends Parser<Mode, unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  args: readonly string[],
  options?: RunOptions<THelp, TError>,
): ModeValue<InferMode<TParser>, InferValue<TParser>>;

// Implementation
export function runParser<
  TParser extends Parser<Mode, unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parserOrProgram: TParser | Program<Mode, unknown>,
  programNameOrArgs: string | readonly string[],
  argsOrOptions?: readonly string[] | RunOptions<THelp, TError>,
  optionsParam?: RunOptions<THelp, TError>,
): ModeValue<InferMode<TParser>, InferValue<TParser>> {
  // Determine if we're using the new Program API or the old API
  const isProgram = typeof programNameOrArgs !== "string";

  let parser: TParser;
  let programName: string;
  let args: readonly string[];
  let options: RunOptions<THelp, TError>;

  if (isProgram) {
    // New API: runParser(program, args, options?)
    const program = parserOrProgram as Program<Mode, unknown>;
    parser = program.parser as TParser;
    programName = program.metadata.name;
    args = programNameOrArgs as readonly string[];
    options = (argsOrOptions as RunOptions<THelp, TError> | undefined) ?? {};

    // Merge program metadata into options
    options = {
      ...options,
      brief: options.brief ?? program.metadata.brief,
      description: options.description ?? program.metadata.description,
      examples: options.examples ?? program.metadata.examples,
      author: options.author ?? program.metadata.author,
      bugs: options.bugs ?? program.metadata.bugs,
      footer: options.footer ?? program.metadata.footer,
    };
  } else {
    // Old API: runParser(parser, programName, args, options?)
    parser = parserOrProgram as TParser;
    programName = programNameOrArgs as string;
    args = argsOrOptions as readonly string[];
    options = optionsParam ?? {};
  }

  validateProgramName(programName);

  // Extract all options first
  const {
    colors,
    maxWidth,
    showDefault,
    showChoices,
    sectionOrder,
    aboveError = "usage",
    onError = () => {
      throw new RunParserError("Failed to parse command line arguments.");
    },
    stderr = console.error,
    stdout = console.log,
    brief,
    description,
    examples,
    author,
    bugs,
    footer,
  } = options;

  // Normalize sub-configs: true -> {}, undefined stays undefined
  const norm = <T>(c: true | T | undefined): T | undefined =>
    c === true ? ({} as T) : c;

  // Extract help configuration
  const helpCommandConfig = norm<CommandSubConfig>(options.help?.command);
  const helpOptionConfig = norm<OptionSubConfig>(options.help?.option);
  const onHelp = options.help?.onShow ?? (() => ({} as THelp));

  // Extract version configuration
  const versionCommandConfig = norm<CommandSubConfig>(options.version?.command);
  const versionOptionConfig = norm<OptionSubConfig>(options.version?.option);
  const versionValue = options.version
    ? validateVersionValue(options.version.value)
    : undefined;
  const onVersion = options.version?.onShow ?? (() => ({} as THelp));

  // Extract completion configuration
  const completionCommandConfig = norm<CommandSubConfig>(
    options.completion?.command,
  );
  const completionOptionConfig = norm<OptionSubConfig>(
    options.completion?.option,
  );
  const onCompletion = options.completion?.onShow ?? (() => ({} as THelp));
  const onCompletionResult = (code: number): InferValue<TParser> =>
    onCompletion(code) as InferValue<TParser>;
  const onErrorResult = (code: number): InferValue<TParser> =>
    onError(code) as InferValue<TParser>;

  // Validate meta names eagerly
  if (helpOptionConfig?.names) {
    validateOptionNames(helpOptionConfig.names, "Help option");
  }
  if (helpCommandConfig?.names) {
    validateCommandNames(helpCommandConfig.names, "Help command");
  }
  if (versionOptionConfig?.names) {
    validateOptionNames(versionOptionConfig.names, "Version option");
  }
  if (versionCommandConfig?.names) {
    validateCommandNames(versionCommandConfig.names, "Version command");
  }
  if (completionOptionConfig?.names) {
    validateOptionNames(completionOptionConfig.names, "Completion option");
  }
  if (completionCommandConfig?.names) {
    validateCommandNames(completionCommandConfig.names, "Completion command");
  }

  // Resolved name arrays for matching
  const helpOptionNames: readonly string[] = helpOptionConfig?.names ??
    ["--help"];
  const helpCommandNames: readonly string[] = helpCommandConfig?.names ??
    ["help"];
  const versionOptionNames: readonly string[] = versionOptionConfig?.names ??
    ["--version"];
  const versionCommandNames: readonly string[] = versionCommandConfig?.names ??
    ["version"];
  const completionCommandNames: readonly string[] =
    completionCommandConfig?.names ?? ["completion"];
  const completionOptionNames: readonly string[] =
    completionOptionConfig?.names ?? ["--completion"];

  // Validate only meta/meta collisions. Parser-defined names may now overlap
  // with meta names; the runner resolves those cases parser-first at runtime.
  const activeMetaEntries: MetaEntry[] = [];
  if (options.help && helpOptionConfig) {
    activeMetaEntries.push(["option", "help option", helpOptionNames]);
  }
  if (options.help && helpCommandConfig) {
    activeMetaEntries.push(["command", "help command", helpCommandNames]);
  }
  if (options.version && versionOptionConfig) {
    activeMetaEntries.push(["option", "version option", versionOptionNames]);
  }
  if (options.version && versionCommandConfig) {
    activeMetaEntries.push([
      "command",
      "version command",
      versionCommandNames,
    ]);
  }
  if (options.completion && completionOptionConfig) {
    activeMetaEntries.push([
      "option",
      "completion option",
      completionOptionNames,
      true, // completion option also matches "name=value" form at runtime
    ]);
  }
  if (options.completion && completionCommandConfig) {
    activeMetaEntries.push([
      "command",
      "completion command",
      completionCommandNames,
    ]);
  }
  validateMetaNameCollisions(activeMetaEntries);

  // Get available shells (defaults + user-provided)
  const defaultShells: Record<string, ShellCompletion> = {
    bash,
    fish,
    nu,
    pwsh,
    zsh,
  };
  const availableShells = options.completion?.shells
    ? { ...defaultShells, ...options.completion.shells }
    : defaultShells;

  // Create help and version parsers using the helper functions
  const helpParsers = options.help
    ? createHelpParser(helpCommandConfig, helpOptionConfig)
    : { helpCommand: null, helpOption: null };

  const versionParsers = options.version
    ? createVersionParser(versionCommandConfig, versionOptionConfig)
    : { versionCommand: null, versionOption: null };

  const completionParsers = options.completion
    ? createCompletionParser(
      programName,
      availableShells,
      completionCommandConfig,
      completionOptionConfig,
    )
    : { completionCommand: null, completionOption: null };

  // Build augmented parser with help, version, and completion functionality
  const augmentedParser = !options.help && !options.version &&
      !options.completion
    ? parser
    : combineWithHelpVersion(
      parser,
      helpParsers,
      versionParsers,
      completionParsers,
      {
        helpCommandGroup: helpCommandConfig?.group,
        helpOptionGroup: helpOptionConfig?.group,
        versionCommandGroup: versionCommandConfig?.group,
        versionOptionGroup: versionOptionConfig?.group,
        completionCommandGroup: completionCommandConfig?.group,
        completionOptionGroup: completionOptionConfig?.group,
      },
      helpOptionConfig ? [...helpOptionNames] : undefined,
      versionOptionConfig ? [...versionOptionNames] : undefined,
    );

  // Helper function to handle parsed result
  // Return type is InferValue<TParser> but callbacks may return THelp/TError
  // which are typically `never` (via process.exit) or a compatible type
  // For async parsers, this may return a Promise when help/error handling
  // requires awaiting getDocPage.
  const handleResult = (
    classified: ParsedResult,
  ): InferValue<TParser> | Promise<InferValue<TParser>> => {
    switch (classified.type) {
      case "success":
        return classified.value;

      case "version":
        stdout(versionValue!);
        return onVersion(0);

      case "completion":
        return handleCompletion<
          InferMode<TParser>,
          InferValue<TParser>,
          InferValue<TParser>
        >(
          [
            classified.shell,
            ...(classified.commandPath ?? []),
            ...classified.args,
          ],
          programName,
          parser,
          classified.source === "command"
            ? completionParsers.completionCommand
            : completionParsers.completionOption,
          stdout,
          stderr,
          onCompletionResult,
          onErrorResult,
          availableShells,
          colors,
          maxWidth,
          completionCommandNames[0],
          completionOptionNames[0],
          classified.source === "option",
          sectionOrder,
        ) as InferValue<TParser>;

      case "help": {
        // Handle help request - determine which parser to use for help
        // generation.  Include completion command in help even though it's
        // handled via early return.
        let helpGeneratorParser: Parser<Mode, unknown, unknown>;
        const helpAsCommand = helpCommandConfig != null;
        const versionAsCommand = versionCommandConfig != null;
        const completionAsCommand = completionCommandConfig != null;
        const helpAsOption = helpOptionConfig != null;
        const versionAsOption = versionOptionConfig != null;
        const completionAsOption = completionOptionConfig != null;

        // Check if user is requesting help for a specific meta-command
        const requestedCommand = classified.commands[0];
        if (
          requestedCommand != null &&
          !classified.preferUserCommandDocs &&
          completionCommandNames.includes(requestedCommand) &&
          completionAsCommand &&
          completionParsers.completionCommand
        ) {
          // User wants help for completion command specifically
          helpGeneratorParser = completionParsers.completionCommand;
        } else if (
          requestedCommand != null &&
          !classified.preferUserCommandDocs &&
          helpCommandNames.includes(requestedCommand) &&
          helpAsCommand &&
          helpParsers.helpCommand
        ) {
          // User wants help for help command specifically
          helpGeneratorParser = helpParsers.helpCommand;
        } else if (
          requestedCommand != null &&
          !classified.preferUserCommandDocs &&
          versionCommandNames.includes(requestedCommand) &&
          versionAsCommand &&
          versionParsers.versionCommand
        ) {
          // User wants help for version command specifically
          helpGeneratorParser = versionParsers.versionCommand;
        } else {
          // General help or help for user-defined commands
          // Collect all command parsers to include in help generation
          const commandParsers: Parser<Mode, unknown, unknown>[] = [parser];

          // Group meta-commands by their group label so that commands
          // sharing the same group name appear under a single section
          const groupedMeta: Record<
            string,
            Parser<Mode, unknown, unknown>[]
          > = {};
          const ungroupedMeta: Parser<Mode, unknown, unknown>[] = [];

          const addMeta = (
            p: Parser<Mode, unknown, unknown>,
            groupLabel?: string,
          ): void => {
            if (groupLabel) {
              (groupedMeta[groupLabel] ??= []).push(p);
            } else {
              ungroupedMeta.push(p);
            }
          };

          if (helpAsCommand && helpParsers.helpCommand) {
            addMeta(helpParsers.helpCommand, helpCommandConfig?.group);
          }
          if (versionAsCommand && versionParsers.versionCommand) {
            addMeta(versionParsers.versionCommand, versionCommandConfig?.group);
          }
          if (completionAsCommand && completionParsers.completionCommand) {
            addMeta(
              completionParsers.completionCommand,
              completionCommandConfig?.group,
            );
          }

          // Add ungrouped meta-commands directly
          commandParsers.push(...ungroupedMeta);

          // Add grouped meta-commands wrapped in group()
          for (const [label, parsers] of Object.entries(groupedMeta)) {
            if (parsers.length === 1) {
              commandParsers.push(group(label, parsers[0]));
            } else {
              // Combine multiple commands in the same group with or()
              commandParsers.push(
                group(
                  label,
                  longestMatch(...parsers),
                ),
              );
            }
          }

          // Include meta options so they appear in the help page usage line and
          // options list.  See https://github.com/dahlia/optique/issues/127
          // Group meta-options by their group label so that options sharing the
          // same group name appear under a single section
          const groupedMetaOptions: Record<
            string,
            Parser<Mode, unknown, unknown>[]
          > = {};
          const ungroupedMetaOptions: Parser<Mode, unknown, unknown>[] = [];

          const addMetaOption = (
            p: Parser<Mode, unknown, unknown>,
            groupLabel?: string,
          ): void => {
            if (groupLabel) {
              (groupedMetaOptions[groupLabel] ??= []).push(p);
            } else {
              ungroupedMetaOptions.push(p);
            }
          };

          if (helpAsOption && helpParsers.helpOption) {
            addMetaOption(helpParsers.helpOption, helpOptionConfig?.group);
          }

          if (versionAsOption && versionParsers.versionOption) {
            addMetaOption(
              versionParsers.versionOption,
              versionOptionConfig?.group,
            );
          }

          if (completionAsOption && completionParsers.completionOption) {
            addMetaOption(
              completionParsers.completionOption,
              completionOptionConfig?.group,
            );
          }

          // Add ungrouped meta-options directly
          commandParsers.push(...ungroupedMetaOptions);

          // Add grouped meta-options wrapped in group()
          for (
            const [label, optParsers] of Object.entries(groupedMetaOptions)
          ) {
            if (optParsers.length === 1) {
              commandParsers.push(group(label, optParsers[0]));
            } else {
              // Combine multiple options in the same group with longestMatch
              commandParsers.push(
                group(
                  label,
                  longestMatch(...optParsers),
                ),
              );
            }
          }

          // Use longestMatch to combine all parsers
          if (commandParsers.length === 1) {
            helpGeneratorParser = commandParsers[0];
          } else if (commandParsers.length === 2) {
            helpGeneratorParser = longestMatch(
              commandParsers[0],
              commandParsers[1],
            );
          } else {
            helpGeneratorParser = longestMatch(...commandParsers);
          }
        }

        // Helper function to report invalid commands before --help
        const reportInvalidHelpCommand = (
          validationError: Message,
        ): InferValue<TParser> => {
          stderr(
            `Usage: ${
              indentLines(
                formatUsage(programName, augmentedParser.usage, {
                  colors,
                  maxWidth: maxWidth == null ? undefined : maxWidth - 7,
                  expandCommands: true,
                }),
                7,
              )
            }`,
          );
          const errorMessage = formatMessage(validationError, {
            colors,
            quotes: !colors,
          });
          stderr(`Error: ${errorMessage}`);
          return onError(1);
        };

        // Helper function to display help and return
        const displayHelp = (doc: DocPage | undefined): InferValue<TParser> => {
          if (doc != null) {
            // Augment the doc page with provided options
            // But if showing help for a specific meta-command or subcommand,
            // don't override its description with run-level docs
            const isMetaCommandHelp = (requestedCommand != null &&
              completionCommandNames.includes(requestedCommand)) ||
              (requestedCommand != null &&
                helpCommandNames.includes(requestedCommand)) ||
              (requestedCommand != null &&
                versionCommandNames.includes(requestedCommand));
            const isSubcommandHelp = classified.commands.length > 0;
            // Check if this is top-level help (empty commands array means top-level)
            const isTopLevel = !isSubcommandHelp;
            // For root-level help, run-level docs (brief/description/footer)
            // take priority over parser-level docs, with parser-level as
            // fallback.
            // For subcommand/meta-command help, run-level brief and
            // description must NOT bleed into the subcommand's help page —
            // only the subcommand's own brief (shown at the top, before
            // Usage) and description (shown after Usage) are displayed.
            // run-level footer still applies as a fallback for subcommands
            // so that operators can add global footer notes across all help
            // pages.
            const shouldOverride = !isMetaCommandHelp && !isSubcommandHelp;
            const augmentedDoc = {
              ...doc,
              brief: shouldOverride ? (brief ?? doc.brief) : doc.brief,
              description: shouldOverride
                ? (description ?? doc.description)
                : doc.description,
              // Only show examples, author, and bugs for top-level help
              examples: isTopLevel && !isMetaCommandHelp
                ? (examples ?? doc.examples)
                : undefined,
              author: isTopLevel && !isMetaCommandHelp
                ? (author ?? doc.author)
                : undefined,
              bugs: isTopLevel && !isMetaCommandHelp
                ? (bugs ?? doc.bugs)
                : undefined,
              footer: shouldOverride
                ? (footer ?? doc.footer)
                : (doc.footer ?? footer),
            };
            stdout(formatDocPage(programName, augmentedDoc, {
              colors,
              maxWidth,
              showDefault,
              showChoices,
              sectionOrder,
            }));
          }
          return onHelp(0);
        };

        // Validate that the commands before --help are actually valid
        // by attempting to parse them step by step against the parser
        if (classified.commands.length > 0) {
          let validationContext: {
            buffer: readonly string[];
            optionsTerminated: boolean;
            state: unknown;
            usage: Usage;
          } = {
            buffer: [...classified.commands],
            optionsTerminated: false,
            state: helpGeneratorParser.initialState as unknown,
            usage: helpGeneratorParser.usage,
          };

          const processStep = (
            stepResult: ParserResult<unknown>,
          ): Message | null | "continue" => {
            if (!stepResult.success) {
              return stepResult.error;
            }
            if (stepResult.consumed.length < 1) {
              // Parser succeeded but didn't consume any input;
              // this means the remaining tokens aren't recognized
              return message`Unexpected option or subcommand: ${
                optionName(validationContext.buffer[0])
              }.`;
            }
            validationContext = {
              ...validationContext,
              buffer: stepResult.next.buffer,
              optionsTerminated: stepResult.next.optionsTerminated,
              state: stepResult.next.state,
              usage: stepResult.next.usage ?? validationContext.usage,
            };
            return validationContext.buffer.length > 0 ? "continue" : null;
          };

          // Iteratively validate each command token
          let validationResult: Message | null | "continue" = "continue";
          while (validationResult === "continue") {
            const stepResult = helpGeneratorParser.parse(validationContext);
            if (stepResult instanceof Promise) {
              // Async parser: chain remaining validation via Promise
              const asyncValidate = async (
                result: ParserResult<unknown>,
              ): Promise<InferValue<TParser>> => {
                let res = processStep(result);
                while (res === "continue") {
                  const next = helpGeneratorParser.parse(validationContext);
                  const resolved = next instanceof Promise ? await next : next;
                  res = processStep(resolved);
                }
                if (res != null) {
                  return reportInvalidHelpCommand(res);
                }
                // Commands are valid; proceed with help display
                const docOrPromise = getDocPage(
                  helpGeneratorParser,
                  classified.commands,
                );
                return docOrPromise instanceof Promise
                  ? docOrPromise.then(displayHelp)
                  : displayHelp(docOrPromise);
              };
              return stepResult.then(asyncValidate);
            }
            validationResult = processStep(stepResult);
          }
          if (validationResult != null) {
            return reportInvalidHelpCommand(validationResult);
          }
        }

        // Get doc page - may return Promise for async parsers
        const docOrPromise = getDocPage(
          helpGeneratorParser,
          classified.commands,
        );
        if (docOrPromise instanceof Promise) {
          return docOrPromise.then(displayHelp);
        }
        return displayHelp(docOrPromise);
      }

      case "error": {
        // Helper function to handle error display after doc is resolved
        const displayError = (
          doc: DocPage | undefined,
          currentAboveError: "help" | "usage" | "none",
        ): InferValue<TParser> => {
          let effectiveAboveError = currentAboveError;
          if (effectiveAboveError === "help") {
            if (doc == null) effectiveAboveError = "usage";
            else {
              // Augment the doc page with provided options
              const augmentedDoc = {
                ...doc,
                brief: brief ?? doc.brief,
                description: description ?? doc.description,
                examples: examples ?? doc.examples,
                author: author ?? doc.author,
                bugs: bugs ?? doc.bugs,
                footer: footer ?? doc.footer,
              };
              stderr(formatDocPage(programName, augmentedDoc, {
                colors,
                maxWidth,
                showDefault,
                showChoices,
              }));
            }
          }
          if (effectiveAboveError === "usage") {
            stderr(
              `Usage: ${
                indentLines(
                  formatUsage(programName, augmentedParser.usage, {
                    colors,
                    maxWidth: maxWidth == null ? undefined : maxWidth - 7,
                    expandCommands: true,
                  }),
                  7,
                )
              }`,
            );
          }
          // classified.error is now typed as Message
          const errorMessage = formatMessage(classified.error, {
            colors,
            quotes: !colors,
          });
          stderr(`Error: ${errorMessage}`);
          return onError(1);
        };

        // Error handling
        if (aboveError === "help") {
          const parserForDoc = args.length < 1 ? augmentedParser : parser;
          const docOrPromise = getDocPage(parserForDoc, args);
          if (docOrPromise instanceof Promise) {
            return docOrPromise.then((doc) => displayError(doc, aboveError));
          }
          return displayError(docOrPromise, aboveError);
        }
        return displayError(undefined, aboveError);
      }

      default:
        // This shouldn't happen but TypeScript doesn't know that
        throw new RunParserError("Unexpected parse result type");
    }
  };

  const parserMode = parser.$mode as InferMode<TParser>;
  return dispatchByMode(
    parserMode,
    () => {
      const attempted = attemptParseSync(
        parser as Parser<"sync", unknown, unknown>,
        args,
      );
      const classified: ParsedResult = attempted.kind === "success"
        ? { type: "success", value: attempted.value }
        : classifyParseFailure(
          attempted,
          helpOptionConfig ? [...helpOptionNames] : [],
          helpCommandConfig ? [...helpCommandNames] : [],
          versionOptionConfig ? [...versionOptionNames] : [],
          versionCommandConfig ? [...versionCommandNames] : [],
          completionOptionConfig ? [...completionOptionNames] : [],
          completionCommandConfig ? [...completionCommandNames] : [],
        );
      const handled = handleResult(classified);
      if (handled instanceof Promise) {
        throw new RunParserError("Synchronous parser returned async result.");
      }
      return handled;
    },
    async () => {
      const attempted = await attemptParseAsync(parser, args);
      const classified: ParsedResult = attempted.kind === "success"
        ? { type: "success", value: attempted.value }
        : classifyParseFailure(
          attempted,
          helpOptionConfig ? [...helpOptionNames] : [],
          helpCommandConfig ? [...helpCommandNames] : [],
          versionOptionConfig ? [...versionOptionNames] : [],
          versionCommandConfig ? [...versionCommandNames] : [],
          completionOptionConfig ? [...completionOptionNames] : [],
          completionCommandConfig ? [...completionCommandNames] : [],
        );
      const handled = handleResult(classified);
      return handled instanceof Promise ? await handled : handled;
    },
  ) as ModeValue<InferMode<TParser>, InferValue<TParser>>;
}

/**
 * Runs a synchronous command-line parser with the given options.
 *
 * This is a type-safe version of {@link runParser} that only accepts sync
 * parsers. Use this when you know your parser is sync-only to get direct
 * return values without Promise wrappers.
 *
 * @template TParser The sync parser type being executed.
 * @template THelp The return type of the onHelp callback.
 * @template TError The return type of the onError callback.
 * @param parser The synchronous command-line parser to execute.
 * @param programName The name of the program for help messages.
 * @param args The command-line arguments to parse.
 * @param options Configuration options for customizing behavior.
 * @returns The parsed result if successful.
 * @throws {TypeError} If an async parser is passed at runtime.  Use
 * {@link runParser} or {@link runParserAsync} for async parsers.
 * @since 0.9.0
 */
export function runParserSync<
  TParser extends Parser<"sync", unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  args: readonly string[],
  options?: RunOptions<THelp, TError>,
): InferValue<TParser> {
  if (parser.$mode !== "sync") {
    throw new TypeError(
      "Cannot use an async parser with runParserSync(). " +
        "Use runParser() or runParserAsync() instead.",
    );
  }
  return runParser(parser, programName, args, options);
}

/**
 * Runs any command-line parser asynchronously with the given options.
 *
 * This function accepts parsers of any mode (sync or async) and always
 * returns a Promise. Use this when working with parsers that may contain
 * async value parsers.
 *
 * @template TParser The parser type being executed.
 * @template THelp The return type of the onHelp callback.
 * @template TError The return type of the onError callback.
 * @param parser The command-line parser to execute.
 * @param programName The name of the program for help messages.
 * @param args The command-line arguments to parse.
 * @param options Configuration options for customizing behavior.
 * @returns A Promise of the parsed result if successful.
 * @since 0.9.0
 */
export function runParserAsync<
  TParser extends Parser<Mode, unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  args: readonly string[],
  options?: RunOptions<THelp, TError>,
): Promise<InferValue<TParser>> {
  const result = runParser(parser, programName, args, options);
  return Promise.resolve(result) as Promise<InferValue<TParser>>;
}

/**
 * An error class used to indicate that the command line arguments
 * could not be parsed successfully.
 */
export class RunParserError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RunParserError";
  }
}

function indentLines(text: string, indent: number): string {
  return text.split("\n").join("\n" + " ".repeat(indent));
}

function isMetaEarlyExit(classified: ParsedResult): boolean {
  return classified.type === "help" ||
    classified.type === "version" ||
    classified.type === "completion";
}

function classifyEarlyExitFailure<THelp, TError>(
  failure: Extract<ParseAttempt<unknown>, { readonly kind: "failure" }>,
  options: RunWithOptions<THelp, TError>,
): Exclude<ParsedResult, { readonly type: "success" }> {
  const norm = <T>(c: true | T | undefined): T | undefined =>
    c === true ? ({} as T) : c;
  const helpOptionConfig = norm<OptionSubConfig>(options.help?.option);
  const helpCommandConfig = norm<CommandSubConfig>(options.help?.command);
  const versionOptionConfig = norm<OptionSubConfig>(options.version?.option);
  const versionCommandConfig = norm<CommandSubConfig>(
    options.version?.command,
  );
  const completionOptionConfig = norm<OptionSubConfig>(
    options.completion?.option,
  );
  const completionCommandConfig = norm<CommandSubConfig>(
    options.completion?.command,
  );

  return classifyParseFailure(
    failure,
    helpOptionConfig ? [...(helpOptionConfig.names ?? ["--help"])] : [],
    helpCommandConfig ? [...(helpCommandConfig.names ?? ["help"])] : [],
    versionOptionConfig
      ? [...(versionOptionConfig.names ?? ["--version"])]
      : [],
    versionCommandConfig
      ? [...(versionCommandConfig.names ?? ["version"])]
      : [],
    completionOptionConfig
      ? [...(completionOptionConfig.names ?? ["--completion"])]
      : [],
    completionCommandConfig
      ? [...(completionCommandConfig.names ?? ["completion"])]
      : [],
  );
}

function shouldProbeEarlyExit<THelp, TError>(
  options: RunWithOptions<THelp, TError>,
  needsTwoPhase: boolean,
): boolean {
  return needsTwoPhase &&
    (options.help != null ||
      options.version != null ||
      options.completion != null);
}

/**
 * Checks if the arguments contain parser-visible meta requests that can be
 * handled without collecting source-context annotations first.
 */
function needsEarlyExitSync<THelp, TError>(
  parser: Parser<"sync", unknown, unknown>,
  args: readonly string[],
  options: RunWithOptions<THelp, TError>,
): boolean {
  const attempted = attemptParseSync(parser, args, "parse-only");
  if (attempted.kind === "success") return false;
  return isMetaEarlyExit(classifyEarlyExitFailure(attempted, options));
}

/**
 * Async variant of {@link needsEarlyExitSync}.
 */
async function needsEarlyExitAsync<THelp, TError>(
  parser: Parser<Mode, unknown, unknown>,
  args: readonly string[],
  options: RunWithOptions<THelp, TError>,
): Promise<boolean> {
  const attempted = await attemptParseAsync(parser, args, "parse-only");
  if (attempted.kind === "success") return false;
  return isMetaEarlyExit(classifyEarlyExitFailure(attempted, options));
}

/**
 * Merges multiple annotation objects, with earlier contexts having priority.
 *
 * When the same symbol key exists in multiple annotations, the value from
 * the earlier context (lower index in the array) takes precedence.
 *
 * @param annotationsList Array of annotations to merge.
 * @returns Merged annotations object.
 */
function mergeAnnotations(
  annotationsList: readonly Annotations[],
): Annotations {
  const result: Record<symbol, unknown> = {};
  // Process in reverse order so earlier contexts override later ones
  for (let i = annotationsList.length - 1; i >= 0; i--) {
    const annotations = annotationsList[i];
    for (const key of Object.getOwnPropertySymbols(annotations)) {
      result[key] = annotations[key];
    }
  }
  return result;
}

type CollectedPhase1Annotations = {
  readonly annotations: Annotations;
  readonly needsTwoPhase: boolean;
  readonly snapshots: readonly Annotations[];
};

function validateContextPhases(
  contexts: readonly SourceContext<unknown>[],
): void {
  for (const context of contexts) {
    const phase = (context as { readonly phase?: unknown }).phase;
    if (phase !== "single-pass" && phase !== "two-pass") {
      throw new TypeError(
        `Context ${String(context.id)} must declare phase as ` +
          '"single-pass" or "two-pass".',
      );
    }
  }
}

/**
 * Collects phase 1 annotations from all contexts and determines whether
 * two-phase parsing is needed.
 *
 * @param contexts Source contexts to collect annotations from.
 * @param options Optional context-required options to pass to each context.
 * @returns Promise with merged annotations, per-context snapshots, and a
 * two-phase hint.
 */
async function collectPhase1Annotations(
  contexts: readonly SourceContext<unknown>[],
  options?: unknown,
): Promise<CollectedPhase1Annotations> {
  const annotationsList: Annotations[] = [];
  let snapshots: Annotations[] | undefined;

  for (const context of contexts) {
    const request: SourceContextRequest = { phase: "phase1" };
    const result = context.getAnnotations(request, options);
    const annotations = result instanceof Promise ? await result : result;
    const internalAnnotations = context.getInternalAnnotations?.(
      request,
      annotations,
    );
    const snapshot = internalAnnotations == null
      ? annotations
      : mergeAnnotations([annotations, internalAnnotations]);
    annotationsList.push(snapshot);
    if (snapshots != null) {
      snapshots.push(snapshot);
    } else if (context.phase === "two-pass") {
      snapshots = [...annotationsList];
    }
  }

  return {
    annotations: mergeAnnotations(annotationsList),
    needsTwoPhase: snapshots != null,
    snapshots: snapshots ?? [],
  };
}

/**
 * Collects final annotations from all contexts.
 *
 * `single-pass` contexts reuse their phase-1 snapshot. `two-pass` contexts
 * are recollected with the parsed value and replace their own phase-1
 * snapshot in the final merge.
 *
 * @param contexts Source contexts to collect annotations from.
 * @param phase1Snapshots Per-context snapshots collected during phase 1.
 * @param parsed Optional parsed result from a previous parse pass.
 * @param options Optional context-required options to pass to each context.
 * @returns Promise that resolves to merged annotations.
 */
async function collectFinalAnnotations(
  contexts: readonly SourceContext<unknown>[],
  phase1Snapshots: readonly Annotations[],
  parsed?: unknown,
  options?: unknown,
  deferred?: true,
  deferredKeys?: DeferredMap,
): Promise<{ readonly annotations: Annotations }> {
  const annotationsList: Annotations[] = [];
  const preparedParsed = prepareParsedForContexts(
    parsed,
    deferred,
    deferredKeys,
  );

  for (let index = 0; index < contexts.length; index++) {
    const context = contexts[index];
    if (context.phase === "single-pass") {
      annotationsList.push(phase1Snapshots[index]);
      continue;
    }

    const request: SourceContextRequest = {
      phase: "phase2",
      parsed: preparedParsed,
    };
    const result = context.getAnnotations(request, options);
    const annotations = result instanceof Promise ? await result : result;
    const internalAnnotations = context.getInternalAnnotations?.(
      request,
      annotations,
    );
    const mergedAnnotations = internalAnnotations == null
      ? annotations
      : mergeAnnotations([annotations, internalAnnotations]);
    annotationsList.push(mergedAnnotations);
  }

  return {
    annotations: mergeAnnotations(annotationsList),
  };
}

/**
 * Collects phase 1 annotations from all contexts synchronously and determines
 * whether two-phase parsing is needed.
 *
 * @param contexts Source contexts to collect annotations from.
 * @param options Optional context-required options to pass to each context.
 * @returns Merged annotations, per-context snapshots, and a two-phase hint.
 * @throws {TypeError} If any context returns a Promise.
 */
function collectPhase1AnnotationsSync(
  contexts: readonly SourceContext<unknown>[],
  options?: unknown,
): CollectedPhase1Annotations {
  const annotationsList: Annotations[] = [];
  let snapshots: Annotations[] | undefined;

  for (const context of contexts) {
    const request: SourceContextRequest = { phase: "phase1" };
    const result = context.getAnnotations(request, options);
    if (result instanceof Promise) {
      throw new TypeError(
        `Context ${String(context.id)} returned a Promise in sync mode. ` +
          "Use runWith() or runWithAsync() for async contexts.",
      );
    }
    const internalAnnotations = context.getInternalAnnotations?.(
      request,
      result,
    );
    const snapshot = internalAnnotations == null
      ? result
      : mergeAnnotations([result, internalAnnotations]);
    annotationsList.push(snapshot);
    if (snapshots != null) {
      snapshots.push(snapshot);
    } else if (context.phase === "two-pass") {
      snapshots = [...annotationsList];
    }
  }

  return {
    annotations: mergeAnnotations(annotationsList),
    needsTwoPhase: snapshots != null,
    snapshots: snapshots ?? [],
  };
}

/**
 * Collects final annotations from all contexts synchronously.
 *
 * `single-pass` contexts reuse their phase-1 snapshot. `two-pass` contexts
 * are recollected with the parsed value and replace their own phase-1
 * snapshot in the final merge.
 *
 * @param contexts Source contexts to collect annotations from.
 * @param phase1Snapshots Per-context snapshots collected during phase 1.
 * @param parsed Optional parsed result from a previous parse pass.
 * @param options Optional context-required options to pass to each context.
 * @returns Merged annotations.
 * @throws {TypeError} If any context returns a Promise.
 */
function collectFinalAnnotationsSync(
  contexts: readonly SourceContext<unknown>[],
  phase1Snapshots: readonly Annotations[],
  parsed?: unknown,
  options?: unknown,
  deferred?: true,
  deferredKeys?: DeferredMap,
): { readonly annotations: Annotations } {
  const annotationsList: Annotations[] = [];
  const preparedParsed = prepareParsedForContexts(
    parsed,
    deferred,
    deferredKeys,
  );

  for (let index = 0; index < contexts.length; index++) {
    const context = contexts[index];
    if (context.phase === "single-pass") {
      annotationsList.push(phase1Snapshots[index]);
      continue;
    }

    const request: SourceContextRequest = {
      phase: "phase2",
      parsed: preparedParsed,
    };
    const result = context.getAnnotations(request, options);
    if (result instanceof Promise) {
      throw new TypeError(
        `Context ${String(context.id)} returned a Promise in sync mode. ` +
          "Use runWith() or runWithAsync() for async contexts.",
      );
    }
    const internalAnnotations = context.getInternalAnnotations?.(
      request,
      result,
    );
    const mergedAnnotations = internalAnnotations == null
      ? result
      : mergeAnnotations([result, internalAnnotations]);
    annotationsList.push(mergedAnnotations);
  }

  return {
    annotations: mergeAnnotations(annotationsList),
  };
}

/**
 * Disposes all contexts that implement `AsyncDisposable` or `Disposable`.
 * Prefers `[Symbol.asyncDispose]` over `[Symbol.dispose]`.
 *
 * @param contexts Source contexts to dispose.
 */
async function disposeContexts(
  contexts: readonly SourceContext<unknown>[],
): Promise<void> {
  const errors: unknown[] = [];

  for (const context of contexts) {
    try {
      if (
        Symbol.asyncDispose in context &&
        typeof context[Symbol.asyncDispose] === "function"
      ) {
        await context[Symbol.asyncDispose]!();
      } else if (
        Symbol.dispose in context &&
        typeof context[Symbol.dispose] === "function"
      ) {
        context[Symbol.dispose]!();
      }
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      "Failed to dispose one or more source contexts.",
    );
  }
}

/**
 * Disposes all contexts that implement `Disposable` synchronously.
 * Falls back to `[Symbol.asyncDispose]` when it completes synchronously.
 *
 * @param contexts Source contexts to dispose.
 */
function disposeContextsSync(
  contexts: readonly SourceContext<unknown>[],
): void {
  const errors: unknown[] = [];

  for (const context of contexts) {
    try {
      if (
        Symbol.dispose in context &&
        typeof context[Symbol.dispose] === "function"
      ) {
        context[Symbol.dispose]!();
      } else if (
        Symbol.asyncDispose in context &&
        typeof context[Symbol.asyncDispose] === "function"
      ) {
        const result = context[Symbol.asyncDispose]!();
        if (
          typeof result === "object" &&
          result !== null &&
          "then" in result &&
          typeof result.then === "function"
        ) {
          throw new TypeError(
            `Context ${
              String(context.id)
            } returned a Promise from Symbol.asyncDispose in sync mode. ` +
              "Use runWith() or runWithAsync() for async disposal.",
          );
        }
      }
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length === 1) {
    throw errors[0];
  }
  if (errors.length > 1) {
    throw new AggregateError(
      errors,
      "Failed to dispose one or more source contexts.",
    );
  }
}

/**
 * Substitutes {@link ParserValuePlaceholder} with the actual parser value type.
 *
 * This type recursively traverses `T` and replaces any occurrence of
 * `ParserValuePlaceholder` with `TValue`. Used by `runWith()` to compute
 * the required options type based on the parser's result type.
 *
 * @template T The type to transform.
 * @template TValue The parser value type to substitute.
 * @since 0.10.0
 */
export type SubstituteParserValue<T, TValue> = T extends ParserValuePlaceholder
  ? TValue
  : T extends (...args: infer A) => infer R ? (
      ...args: { [K in keyof A]: SubstituteParserValue<A[K], TValue> }
    ) => SubstituteParserValue<R, TValue>
  : T extends object ? { [K in keyof T]: SubstituteParserValue<T[K], TValue> }
  : T;

/**
 * Converts a union type to an intersection type.
 * @internal
 */
type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void ? I
  : never;

/**
 * Extracts and merges required options from an array of source contexts.
 *
 * For each context in the array, extracts its `TRequiredOptions` type parameter,
 * substitutes any `ParserValuePlaceholder` with `TValue`, and intersects all
 * the resulting option types.
 *
 * @template TContexts The tuple/array type of source contexts.
 * @template TValue The parser value type for placeholder substitution.
 * @since 0.10.0
 */
export type ExtractRequiredOptions<
  TContexts extends readonly SourceContext<unknown>[],
  TValue,
> = [
  TContexts[number] extends SourceContext<infer O> ? O extends void ? never
    : SubstituteParserValue<O, TValue>
    : never,
] extends [never] ? unknown
  : UnionToIntersection<
    TContexts[number] extends SourceContext<infer O> ? O extends void ? never
      : SubstituteParserValue<O, TValue>
      : never
  >;

/**
 * Options for runWith functions.
 * Extends RunOptions with additional context-related settings.
 *
 * @template THelp The return type when help is shown.
 * @template TError The return type when an error occurs.
 * @since 0.10.0
 */
export interface RunWithOptions<THelp, TError>
  extends RunOptions<THelp, TError> {
  /**
   * Command-line arguments to parse. If not provided, defaults to
   * `process.argv.slice(2)` on Node.js/Bun or `Deno.args` on Deno.
   */
  readonly args?: readonly string[];

  /**
   * Options to forward to source contexts.  When contexts declare
   * required options (via `$requiredOptions`), pass them here to
   * avoid name collisions with runner-level options such as `args`,
   * `help`, or `colors`.
   *
   * @since 1.0.0
   */
  readonly contextOptions?: Record<string, unknown>;
}

/**
 * When contexts require options, demands a `contextOptions` property
 * typed to those requirements.  When no context needs options
 * (`void`, `unknown`, or `{}`), resolves to `unknown` (intersection no-op).
 * When all context option keys are optional, `contextOptions` itself becomes
 * optional so callers are not forced to pass an empty wrapper.
 *
 * @template TContexts The tuple/array type of source contexts.
 * @template TValue The parser value type for placeholder substitution.
 * @since 1.0.0
 */
export type ContextOptionsParam<
  TContexts extends readonly SourceContext<unknown>[],
  TValue,
> = keyof ExtractRequiredOptions<TContexts, TValue> extends never ? unknown
  : Record<string, never> extends ExtractRequiredOptions<TContexts, TValue>
    ? { readonly contextOptions?: ExtractRequiredOptions<TContexts, TValue> }
  : { readonly contextOptions: ExtractRequiredOptions<TContexts, TValue> };

/**
 * Body of {@link runWith}, extracted so that the caller can handle
 * disposal outside a `finally` block (avoiding `no-unsafe-finally` lint).
 */
async function runWithBody<
  TParser extends Parser<Mode, unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  contexts: readonly SourceContext<unknown>[],
  args: readonly string[],
  options: RunWithOptions<THelp, TError>,
): Promise<InferValue<TParser>> {
  validateContextIds(contexts);
  validateContextPhases(contexts);

  // Phase 1: Collect initial annotations
  const ctxOptions = options.contextOptions;
  const {
    annotations: phase1Annotations,
    needsTwoPhase,
    snapshots: phase1Snapshots,
  } = await collectPhase1Annotations(contexts, ctxOptions);
  if (shouldProbeEarlyExit(options, needsTwoPhase)) {
    const earlyExitParser = injectAnnotationsIntoParser(
      parser,
      phase1Annotations,
    );

    // Early exit: skip phase-two processing for genuine help/version/
    // completion requests, but only after phase-1 annotations have been
    // injected because they may change what the parser accepts as ordinary
    // data.
    if (await needsEarlyExitAsync(earlyExitParser, args, options)) {
      if (parser.$mode === "async") {
        return runParser(
          earlyExitParser,
          programName,
          args,
          options,
        ) as Promise<InferValue<TParser>>;
      }
      return Promise.resolve(
        runParser(
          earlyExitParser,
          programName,
          args,
          options,
        ) as InferValue<TParser>,
      );
    }
  }
  const augmentedParser1 = injectAnnotationsIntoParser(
    parser,
    phase1Annotations,
  );

  if (!needsTwoPhase) {
    // All contexts are single-pass.
    if (parser.$mode === "async") {
      return runParser(
        augmentedParser1,
        programName,
        args,
        options,
      ) as Promise<InferValue<TParser>>;
    }
    return Promise.resolve(
      runParser(augmentedParser1, programName, args, options) as InferValue<
        TParser
      >,
    );
  }

  // Two-phase parsing for two-pass contexts.
  // First pass: parse with Phase 1 annotations to get initial result
  const firstPassSeed = await dispatchByMode(
    parser.$mode,
    () =>
      extractPhase2SeedSync(
        augmentedParser1 as Parser<"sync", unknown, unknown>,
        args,
      ),
    () => extractPhase2SeedAsync(augmentedParser1, args),
  );

  // First pass failed - run through runParser for proper error handling.
  // This is done outside the try-catch to prevent the catch block from
  // re-invoking runParser when it throws (which caused double error output).
  if (firstPassSeed == null) {
    const fallbackParser = injectAnnotationsIntoParser(
      parser,
      phase1Annotations,
    );
    if (parser.$mode === "async") {
      return runParser(
        fallbackParser,
        programName,
        args,
        options,
      ) as Promise<
        InferValue<TParser>
      >;
    }
    return Promise.resolve(
      runParser(fallbackParser, programName, args, options) as InferValue<
        TParser
      >,
    );
  }

  // Phase 2: Collect annotations with parsed result
  const { annotations: finalAnnotations } = await collectFinalAnnotations(
    contexts,
    phase1Snapshots,
    firstPassSeed.value,
    ctxOptions,
    firstPassSeed.deferred,
    firstPassSeed.deferredKeys,
  );

  // Final parse with phase-two annotations as the final per-context snapshot.
  const augmentedParser2 = injectAnnotationsIntoParser(
    parser,
    finalAnnotations,
  );

  if (parser.$mode === "async") {
    return runParser(augmentedParser2, programName, args, options) as Promise<
      InferValue<TParser>
    >;
  }
  return Promise.resolve(
    runParser(augmentedParser2, programName, args, options) as InferValue<
      TParser
    >,
  );
}

/**
 * Runs a parser with multiple source contexts.
 *
 * This function automatically handles single-pass and two-pass contexts with
 * proper priority. Earlier contexts in the array override later ones.
 *
 * The function uses a smart two-phase approach:
 *
 * 1. *Phase 1*: Collect annotations from all contexts.
 * 2. *First parse*: Parse with Phase 1 annotations. If that pass finishes
 *    successfully, its value becomes the phase-two input. If the parser
 *    reaches a usable intermediate state but still does not complete
 *    successfully, the runner extracts a best-effort seed from that state
 *    instead.
 * 3. *Phase 2*: Call `getAnnotations({ phase: "phase2", parsed })` on all
 *    two-pass contexts with the first pass value. Deferred or otherwise
 *    unresolved fields in `parsed` may be `undefined`. Each two-pass
 *    context's phase-two return
 *    value replaces its own phase-one contribution for the final parse, so
 *    returning `{}` clears any annotations that context provided during
 *    phase 1. Single-pass contexts reuse their phase-one snapshot.
 * 4. *Second parse*: Parse again with the merged phase-two annotations.
 *
 * If all contexts are single-pass, the second parse is skipped for
 * optimization. Phase 2 is also skipped when the first pass does not yield
 * any usable seed at all.
 *
 * @template TParser The parser type.
 * @template THelp Return type when help is shown.
 * @template TError Return type when an error occurs.
 * @param parser The parser to execute.
 * @param programName Name of the program for help/error output.
 * @param contexts Source contexts to use (priority: earlier overrides later).
 * @param options Run options including args, help, version, etc.
 * @returns Promise that resolves to the parsed result.
 * @throws {TypeError} If two or more contexts share the same
 * {@link SourceContext.id}.
 * @throws {TypeError} If any context omits `phase` or declares an invalid
 * phase value.
 * @throws {SuppressedError} If the runner throws and a context's disposal
 * also throws.  The original error is available via `.suppressed` and the
 * disposal error via `.error`.
 * @since 0.10.0
 *
 * @example
 * ```typescript
 * import { runWith } from "@optique/core/facade";
 * import type { SourceContext } from "@optique/core/context";
 *
 * const envContext: SourceContext = {
 *   id: Symbol.for("@myapp/env"),
 *   phase: "single-pass",
 *   getAnnotations() {
 *     return { [Symbol.for("@myapp/env")]: process.env };
 *   }
 * };
 *
 * const result = await runWith(
 *   parser,
 *   "myapp",
 *   [envContext],
 *   { args: process.argv.slice(2) }
 * );
 * ```
 */
export async function runWith<
  TParser extends Parser<Mode, unknown, unknown>,
  TContexts extends readonly SourceContext<unknown>[],
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  contexts: TContexts,
  options:
    & RunWithOptions<THelp, TError>
    & ContextOptionsParam<TContexts, InferValue<TParser>>,
): Promise<InferValue<TParser>> {
  const args = options?.args ?? [];

  // If no contexts, just run the parser directly
  if (contexts.length === 0) {
    if (parser.$mode === "async") {
      return runParser(parser, programName, args, options) as Promise<
        InferValue<TParser>
      >;
    }
    return Promise.resolve(
      runParser(parser, programName, args, options) as InferValue<TParser>,
    );
  }

  let result!: InferValue<TParser>;
  let primaryError: unknown;
  let hasPrimaryError = false;
  try {
    result = await runWithBody(parser, programName, contexts, args, options);
  } catch (error) {
    hasPrimaryError = true;
    primaryError = error;
  }

  // Disposal runs unconditionally (success and error paths both reach here)
  try {
    await disposeContexts(contexts);
  } catch (disposeError) {
    if (hasPrimaryError) {
      throw new SuppressedErrorCtor(
        disposeError,
        primaryError,
        "An error was suppressed during context disposal.",
      );
    }
    throw disposeError;
  }

  if (hasPrimaryError) {
    throw primaryError;
  }
  return result;
}

/**
 * Body of {@link runWithSync}, extracted so that the caller can handle
 * disposal outside a `finally` block (avoiding `no-unsafe-finally` lint).
 */
function runWithSyncBody<
  TParser extends Parser<"sync", unknown, unknown>,
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  contexts: readonly SourceContext<unknown>[],
  args: readonly string[],
  options: RunWithOptions<THelp, TError>,
): InferValue<TParser> {
  validateContextIds(contexts);
  validateContextPhases(contexts);

  // Phase 1: Collect initial annotations
  const ctxOptions = options.contextOptions;
  const {
    annotations: phase1Annotations,
    needsTwoPhase,
    snapshots: phase1Snapshots,
  } = collectPhase1AnnotationsSync(contexts, ctxOptions);
  if (shouldProbeEarlyExit(options, needsTwoPhase)) {
    const earlyExitParser = injectAnnotationsIntoParser(
      parser,
      phase1Annotations,
    );

    // Early exit: skip phase-two processing for genuine help/version/
    // completion requests, but only after phase-1 annotations have been
    // injected because they may change what the parser accepts as ordinary
    // data.
    if (needsEarlyExitSync(earlyExitParser, args, options)) {
      return runParser(earlyExitParser, programName, args, options);
    }
  }
  const augmentedParser1 = injectAnnotationsIntoParser(
    parser,
    phase1Annotations,
  );

  if (!needsTwoPhase) {
    // All contexts are single-pass.
    return runParser(augmentedParser1, programName, args, options);
  }

  // Two-phase parsing for two-pass contexts.
  // First pass: parse with Phase 1 annotations
  const firstPassSeed = extractPhase2SeedSync(augmentedParser1, args);
  if (firstPassSeed == null) {
    const fallbackParser = injectAnnotationsIntoParser(
      parser,
      phase1Annotations,
    );
    return runParser(fallbackParser, programName, args, options);
  }

  // Phase 2: Collect annotations with parsed result
  const { annotations: finalAnnotations } = collectFinalAnnotationsSync(
    contexts,
    phase1Snapshots,
    firstPassSeed.value,
    ctxOptions,
    firstPassSeed.deferred,
    firstPassSeed.deferredKeys,
  );

  // Final parse with phase-two annotations as the final per-context snapshot.
  const augmentedParser2 = injectAnnotationsIntoParser(
    parser,
    finalAnnotations,
  );

  return runParser(augmentedParser2, programName, args, options);
}

/**
 * Runs a synchronous parser with multiple source contexts.
 *
 * This is the sync-only variant of {@link runWith}. All contexts must return
 * annotations synchronously (not Promises). It uses the same two-phase
 * best-effort seed extraction as {@link runWith} when two-pass contexts are
 * present. In two-phase runs, each two-pass context's phase-two return value
 * replaces that context's phase-one contribution for the final parse, so
 * returning `{}` clears any annotations that context provided during phase 1.
 *
 * @template TParser The sync parser type.
 * @template THelp Return type when help is shown.
 * @template TError Return type when an error occurs.
 * @param parser The synchronous parser to execute.
 * @param programName Name of the program for help/error output.
 * @param contexts Source contexts to use (priority: earlier overrides later).
 * @param options Run options including args, help, version, etc.
 * @returns The parsed result.
 * @throws {TypeError} If an async parser is passed at runtime.  Use
 * {@link runWith} or {@link runWithAsync} for async parsers.
 * @throws {TypeError} If two or more contexts share the same
 * {@link SourceContext.id}.
 * @throws {TypeError} If any context omits `phase` or declares an invalid
 * phase value.
 * @throws {TypeError} If any context returns a Promise or if a context's
 * `[Symbol.asyncDispose]` returns a Promise.
 * @throws {SuppressedError} If the runner throws and a context's disposal
 * also throws.  The original error is available via `.suppressed` and the
 * disposal error via `.error`.
 * @since 0.10.0
 */
export function runWithSync<
  TParser extends Parser<"sync", unknown, unknown>,
  TContexts extends readonly SourceContext<unknown>[],
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  contexts: TContexts,
  options:
    & RunWithOptions<THelp, TError>
    & ContextOptionsParam<TContexts, InferValue<TParser>>,
): InferValue<TParser> {
  if (parser.$mode !== "sync") {
    throw new TypeError(
      "Cannot use an async parser with runWithSync(). " +
        "Use runWith() or runWithAsync() instead.",
    );
  }

  const args = options?.args ?? [];

  // If no contexts, just run the parser directly
  if (contexts.length === 0) {
    return runParser(parser, programName, args, options);
  }

  let result!: InferValue<TParser>;
  let primaryError: unknown;
  let hasPrimaryError = false;
  try {
    result = runWithSyncBody(parser, programName, contexts, args, options);
  } catch (error) {
    hasPrimaryError = true;
    primaryError = error;
  }

  // Disposal runs unconditionally (success and error paths both reach here)
  try {
    disposeContextsSync(contexts);
  } catch (disposeError) {
    if (hasPrimaryError) {
      throw new SuppressedErrorCtor(
        disposeError,
        primaryError,
        "An error was suppressed during context disposal.",
      );
    }
    throw disposeError;
  }

  if (hasPrimaryError) {
    throw primaryError;
  }
  return result;
}

/**
 * Runs any parser asynchronously with multiple source contexts.
 *
 * This function accepts parsers of any mode (sync or async) and always
 * returns a Promise. Use this when working with async contexts or parsers.
 *
 * @template TParser The parser type.
 * @template THelp Return type when help is shown.
 * @template TError Return type when an error occurs.
 * @param parser The parser to execute.
 * @param programName Name of the program for help/error output.
 * @param contexts Source contexts to use (priority: earlier overrides later).
 * @param options Run options including args, help, version, etc.
 * @returns Promise that resolves to the parsed result.
 * @throws {TypeError} If two or more contexts share the same
 * {@link SourceContext.id}.
 * @throws {SuppressedError} If the runner throws and a context's disposal
 * also throws.  The original error is available via `.suppressed` and the
 * disposal error via `.error`.
 * @since 0.10.0
 */
export function runWithAsync<
  TParser extends Parser<Mode, unknown, unknown>,
  TContexts extends readonly SourceContext<unknown>[],
  THelp = void,
  TError = never,
>(
  parser: TParser,
  programName: string,
  contexts: TContexts,
  options:
    & RunWithOptions<THelp, TError>
    & ContextOptionsParam<TContexts, InferValue<TParser>>,
): Promise<InferValue<TParser>> {
  return runWith(parser, programName, contexts, options);
}

/**
 * Creates a new parser with annotations injected into its initial state.
 *
 * @param parser The original parser.
 * @param annotations Annotations to inject.
 * @returns A new parser with annotations in its initial state.
 */
function injectAnnotationsIntoParser<
  M extends Mode,
  TValue,
  TState,
>(
  parser: Parser<M, TValue, TState>,
  annotations: Annotations,
): Parser<M, TValue, TState> {
  const newInitialState = injectFreshRunAnnotations(
    parser.initialState,
    annotations,
  ) as TState;
  const descriptors: PropertyDescriptorMap = {
    ...Object.getOwnPropertyDescriptors(parser),
  };
  const initialState = descriptors.initialState;
  descriptors.initialState = initialState == null
    ? {
      value: newInitialState,
      writable: true,
      enumerable: true,
      configurable: true,
    }
    : "get" in initialState || "set" in initialState
    ? {
      value: newInitialState,
      writable: true,
      enumerable: initialState.enumerable ?? true,
      configurable: initialState.configurable ?? true,
    }
    : {
      value: newInitialState,
      writable: initialState.writable ?? true,
      enumerable: initialState.enumerable ?? true,
      configurable: initialState.configurable ?? true,
    };
  return Object.create(
    Object.getPrototypeOf(parser),
    descriptors,
  ) as Parser<M, TValue, TState>;
}
