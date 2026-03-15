/**
 * Interactive prompt support for Optique via Inquirer.js.
 *
 * @module
 * @since 1.0.0
 */
import {
  checkbox,
  confirm,
  editor,
  expand,
  input,
  number,
  password,
  rawlist,
  select,
  Separator,
} from "@inquirer/prompts";
import {
  annotationKey,
  type Annotations,
  getAnnotations,
  inheritAnnotations,
  unwrapInjectedAnnotationWrapper,
} from "@optique/core/annotations";
import type {
  Mode,
  ModeValue,
  Parser,
  ParserResult,
} from "@optique/core/parser";
import { message } from "@optique/core/message";
import type { ValueParserResult } from "@optique/core/valueparser";

// Re-export Separator for use in choice lists.
export { Separator };

/**
 * Prompt functions used to render Inquirer.js prompts.
 *
 * This interface primarily exists to type-check the module's internal prompt
 * function overrides, especially in tests.
 *
 * @since 1.0.0
 */
interface PromptFunctions {
  readonly confirm: typeof confirm;
  readonly number: typeof number;
  readonly input: typeof input;
  readonly password: typeof password;
  readonly editor: typeof editor;
  readonly select: typeof select;
  readonly rawlist: typeof rawlist;
  readonly expand: typeof expand;
  readonly checkbox: typeof checkbox;
}

const promptFunctionsOverrideSymbol = Symbol.for(
  "@optique/inquirer/prompt-functions",
);

const defaultPromptFunctions: PromptFunctions = {
  confirm,
  number,
  input,
  password,
  editor,
  select,
  rawlist,
  expand,
  checkbox,
};

function promptFunctionKeys(): ReadonlyArray<keyof PromptFunctions> {
  // Safe because defaultPromptFunctions is contextually typed as
  // PromptFunctions, so its enumerable own keys are exactly prompt keys.
  return Object.keys(defaultPromptFunctions) as Array<keyof PromptFunctions>;
}

function assignPromptFunctionOverride<K extends keyof PromptFunctions>(
  override: { -readonly [P in keyof PromptFunctions]?: PromptFunctions[P] },
  key: K,
  candidate: unknown,
): void {
  if (typeof candidate === "function") {
    // Safe because we only accept function-valued overrides for known keys.
    override[key] = candidate as PromptFunctions[K];
  }
}

/**
 * Extracts valid prompt function overrides from an arbitrary value.
 */
function getPromptFunctionsOverride(
  value: unknown,
): Partial<PromptFunctions> | undefined {
  if (typeof value !== "object" || value == null) {
    return undefined;
  }

  const override: {
    -readonly [K in keyof PromptFunctions]?: PromptFunctions[K];
  } = {};
  for (const key of promptFunctionKeys()) {
    assignPromptFunctionOverride(override, key, Reflect.get(value, key));
  }
  return override;
}

/**
 * Returns the active prompt function set, applying any global test overrides.
 */
function getPromptFunctions(): PromptFunctions {
  const override = getPromptFunctionsOverride(
    Reflect.get(globalThis, promptFunctionsOverrideSymbol),
  );
  return override != null
    ? { ...defaultPromptFunctions, ...override }
    : defaultPromptFunctions;
}

/**
 * Determines whether an error came from an interrupted Inquirer prompt.
 */
function isExitPromptError(error: unknown): boolean {
  return typeof error === "object" &&
    error != null &&
    "name" in error &&
    error.name === "ExitPromptError";
}

const deferredPromptValueKey: unique symbol = Symbol.for(
  "@optique/inquirer/deferredPromptValue",
);
const deferPromptUntilConfigResolvesKey = Symbol.for(
  "@optique/config/deferPromptUntilResolved",
);
const inheritParentAnnotationsKey = Symbol.for(
  "@optique/core/inheritParentAnnotations",
);

class DeferredPromptValue {
  readonly [deferredPromptValueKey] = true as const;
}

// FIXME: Wrapped config-bound parsers such as optional(bindConfig(...)) and
// group(..., bindConfig(...)) currently drop this hook. See:
// https://github.com/dahlia/optique/issues/385
function shouldDeferPrompt(
  parser: Parser<Mode, unknown, unknown>,
  state: unknown,
): boolean {
  const maybeShouldDefer = Reflect.get(
    parser,
    deferPromptUntilConfigResolvesKey,
  );
  return typeof maybeShouldDefer === "function" &&
    maybeShouldDefer(state) === true;
}

// TODO: Avoid surfacing DeferredPromptValue as a successful TValue result in
// outer combinators during phase one. See:
// https://github.com/dahlia/optique/issues/296
function deferredPromptResult<TValue>(): ValueParserResult<TValue> {
  return {
    success: true,
    value: new DeferredPromptValue() as TValue,
  };
}

function withTemporaryAnnotations<T>(
  state: unknown,
  annotations: Annotations | undefined,
  run: (annotatedState: unknown) => T,
): T {
  if (
    annotations == null || state == null || typeof state !== "object" ||
    annotationKey in state
  ) {
    return run(state);
  }

  const hadOwnAnnotation = Object.prototype.hasOwnProperty.call(
    state,
    annotationKey,
  );
  const previousDescriptor = hadOwnAnnotation
    ? Object.getOwnPropertyDescriptor(state, annotationKey)
    : undefined;

  try {
    Object.defineProperty(state, annotationKey, {
      value: annotations,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } catch {
    return run(state);
  }

  const restore = (): void => {
    if (previousDescriptor != null) {
      Object.defineProperty(state, annotationKey, previousDescriptor);
    } else {
      delete (state as { [annotationKey]?: Annotations })[annotationKey];
    }
  };

  try {
    const result = run(state);
    if (result instanceof Promise) {
      return result.finally(restore) as T;
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function withAnnotatedInnerState<TState, TResult>(
  sourceState: unknown,
  innerState: TState,
  run: (annotatedState: TState) => TResult,
): TResult {
  const annotations = getAnnotations(sourceState);
  if (
    annotations == null ||
    (
      innerState != null &&
      typeof innerState === "object" &&
      annotationKey in innerState
    )
  ) {
    return run(innerState);
  }

  const inheritedState = inheritAnnotations(sourceState, innerState);
  if (inheritedState !== innerState) {
    return run(inheritedState);
  }

  return withTemporaryAnnotations(
    innerState,
    annotations,
    (annotatedState) => run(annotatedState as TState),
  );
}

// ---- Choice types ----

/**
 * A choice item for selection-type prompts (`select`, `rawlist`, `expand`,
 * `checkbox`).
 *
 * @since 1.0.0
 */
export interface Choice {
  /**
   * The value returned when this choice is selected.
   */
  readonly value: string;

  /**
   * Display name shown in the prompt. Defaults to `value`.
   */
  readonly name?: string;

  /**
   * Additional description shown when this choice is highlighted.
   */
  readonly description?: string;

  /**
   * Short text shown after selection. Defaults to `name`.
   */
  readonly short?: string;

  /**
   * If truthy, the choice cannot be selected. A string explains why.
   */
  readonly disabled?: boolean | string;
}

/**
 * A choice item for the `expand` prompt type.
 *
 * Unlike {@link Choice}, this requires a `key` field (a single lowercase
 * alphanumeric character) that the user presses to select the item.
 *
 * @since 1.0.0
 */
export interface ExpandChoice {
  /**
   * The value returned when this choice is selected.
   */
  readonly value: string;

  /**
   * Display name shown in the prompt. Defaults to `value`.
   */
  readonly name?: string;

  /**
   * Single lowercase alphanumeric character used as the keyboard shortcut.
   */
  readonly key: string;
}

// ---- Prompt configuration types ----

/**
 * Configuration for a `confirm` prompt (boolean value).
 *
 * @since 1.0.0
 */
export interface ConfirmConfig {
  readonly type: "confirm";

  /**
   * The question to display to the user.
   */
  readonly message: string;

  /**
   * Default answer when the user just presses Enter.
   */
  readonly default?: boolean;

  /**
   * Override the prompt execution. When provided, this function is called
   * instead of launching an interactive Inquirer.js prompt. Useful for
   * testing.
   */
  readonly prompter?: () => Promise<boolean>;
}

/**
 * Configuration for a `number` prompt.
 *
 * @since 1.0.0
 */
export interface NumberPromptConfig {
  readonly type: "number";

  /**
   * The question to display to the user.
   */
  readonly message: string;

  /**
   * Default number shown to the user.
   */
  readonly default?: number;

  /**
   * Minimum accepted value.
   */
  readonly min?: number;

  /**
   * Maximum accepted value.
   */
  readonly max?: number;

  /**
   * Granularity of valid values. Use `"any"` for arbitrary decimals.
   */
  readonly step?: number | "any";

  /**
   * Override the prompt execution. When provided, this function is called
   * instead of launching an interactive Inquirer.js prompt. Useful for
   * testing.
   *
   * Return `undefined` to simulate the user leaving the field empty (which
   * results in a parse failure).
   */
  readonly prompter?: () => Promise<number | undefined>;
}

/**
 * Configuration for an `input` prompt (free-text string).
 *
 * @since 1.0.0
 */
export interface InputConfig {
  readonly type: "input";

  /**
   * The question to display to the user.
   */
  readonly message: string;

  /**
   * Default text pre-filled in the prompt.
   */
  readonly default?: string;

  /**
   * Validation function called when the user submits.
   * Return `true` or a string error message.
   */
  readonly validate?: (
    value: string,
  ) => boolean | string | Promise<boolean | string>;

  /**
   * Override the prompt execution. When provided, this function is called
   * instead of launching an interactive Inquirer.js prompt. Useful for
   * testing.
   */
  readonly prompter?: () => Promise<string>;
}

/**
 * Configuration for a `password` prompt (masked input).
 *
 * @since 1.0.0
 */
export interface PasswordConfig {
  readonly type: "password";

  /**
   * The question to display to the user.
   */
  readonly message: string;

  /**
   * If `true`, show `*` characters for each keystroke.
   * If `false` or omitted, input is invisible.
   */
  readonly mask?: boolean;

  /**
   * Validation function called when the user submits.
   * Return `true` or a string error message.
   */
  readonly validate?: (
    value: string,
  ) => boolean | string | Promise<boolean | string>;

  /**
   * Override the prompt execution. When provided, this function is called
   * instead of launching an interactive Inquirer.js prompt. Useful for
   * testing.
   */
  readonly prompter?: () => Promise<string>;
}

/**
 * Configuration for an `editor` prompt (external editor).
 *
 * Opens the user's `$VISUAL` or `$EDITOR` for multi-line text input.
 *
 * @since 1.0.0
 */
export interface EditorConfig {
  readonly type: "editor";

  /**
   * The question to display to the user.
   */
  readonly message: string;

  /**
   * Default content pre-filled in the editor.
   */
  readonly default?: string;

  /**
   * Validation function called when the editor is closed.
   * Return `true` or a string error message.
   */
  readonly validate?: (
    value: string,
  ) => boolean | string | Promise<boolean | string>;

  /**
   * Override the prompt execution. When provided, this function is called
   * instead of launching an interactive Inquirer.js prompt. Useful for
   * testing.
   */
  readonly prompter?: () => Promise<string>;
}

/**
 * Configuration for a `select` prompt (arrow-key single-select).
 *
 * @since 1.0.0
 */
export interface SelectConfig {
  readonly type: "select";

  /**
   * The question to display to the user.
   */
  readonly message: string;

  /**
   * Available choices. Plain strings and {@link Choice} objects can be mixed.
   * Use `new Separator(...)` for visual dividers.
   */
  readonly choices: readonly (string | Choice | Separator)[];

  /**
   * Initially highlighted choice value.
   */
  readonly default?: string;

  /**
   * Override the prompt execution. When provided, this function is called
   * instead of launching an interactive Inquirer.js prompt. Useful for
   * testing.
   */
  readonly prompter?: () => Promise<string>;
}

/**
 * Configuration for a `rawlist` prompt (numbered list).
 *
 * @since 1.0.0
 */
export interface RawlistConfig {
  readonly type: "rawlist";

  /**
   * The question to display to the user.
   */
  readonly message: string;

  /**
   * Available choices. Plain strings and {@link Choice} objects can be mixed.
   */
  readonly choices: readonly (string | Choice)[];

  /**
   * Pre-selected choice value.
   */
  readonly default?: string;

  /**
   * Override the prompt execution. When provided, this function is called
   * instead of launching an interactive Inquirer.js prompt. Useful for
   * testing.
   */
  readonly prompter?: () => Promise<string>;
}

/**
 * Configuration for an `expand` prompt (keyboard shortcut single-select).
 *
 * @since 1.0.0
 */
export interface ExpandConfig {
  readonly type: "expand";

  /**
   * The question to display to the user.
   */
  readonly message: string;

  /**
   * Available choices. Each choice requires a `key` field.
   */
  readonly choices: readonly ExpandChoice[];

  /**
   * Default choice key.
   */
  readonly default?: string;

  /**
   * Override the prompt execution. When provided, this function is called
   * instead of launching an interactive Inquirer.js prompt. Useful for
   * testing.
   */
  readonly prompter?: () => Promise<string>;
}

/**
 * Configuration for a `checkbox` prompt (multi-select).
 *
 * Use with parsers that return `string[]`, typically via
 * `multiple(option(...))`.
 *
 * @since 1.0.0
 */
export interface CheckboxConfig {
  readonly type: "checkbox";

  /**
   * The question to display to the user.
   */
  readonly message: string;

  /**
   * Available choices. Plain strings and {@link Choice} objects can be mixed.
   * Use `new Separator(...)` for visual dividers.
   */
  readonly choices: readonly (string | Choice | Separator)[];

  /**
   * Override the prompt execution. When provided, this function is called
   * instead of launching an interactive Inquirer.js prompt. Useful for
   * testing.
   */
  readonly prompter?: () => Promise<readonly string[]>;
}

/**
 * A union of all string-input prompt configurations.
 *
 * @since 1.0.0
 */
export type StringPromptConfig =
  | InputConfig
  | PasswordConfig
  | EditorConfig
  | SelectConfig
  | RawlistConfig
  | ExpandConfig;

/**
 * Type-safe prompt configuration for a given parser value type `T`.
 *
 * The available prompt types are constrained by the expected value type:
 *
 *  - `boolean` or `boolean | undefined` → {@link ConfirmConfig}
 *  - `number` or `number | undefined` → {@link NumberPromptConfig}
 *  - `string` or `string | undefined` → {@link StringPromptConfig}
 *  - `readonly string[]` → {@link CheckboxConfig}
 *
 * @since 1.0.0
 */
export type PromptConfig<T> = BasePromptConfig<Exclude<T, null | undefined>>;

type BasePromptConfig<T> = T extends boolean ? ConfirmConfig
  : T extends number ? NumberPromptConfig
  : T extends string ? StringPromptConfig
  : T extends readonly string[] ? CheckboxConfig
  : never;

// ---- prompt() implementation ----

/**
 * Wraps a parser with an interactive Inquirer.js prompt fallback.
 *
 * When the inner parser finds a value in the CLI arguments (consumed tokens),
 * that value is used directly. When no CLI value is found, an interactive
 * prompt is shown to the user.
 *
 * The returned parser always has `$mode: "async"` because Inquirer.js prompts
 * are inherently asynchronous.
 *
 * Example:
 *
 * ```typescript
 * import { option } from "@optique/core/primitives";
 * import { string } from "@optique/core/valueparser";
 * import { prompt } from "@optique/inquirer";
 *
 * const nameParser = prompt(option("--name", string()), {
 *   type: "input",
 *   message: "Enter your name:",
 * });
 * ```
 *
 * @param parser Inner parser that reads CLI values.
 * @param config Type-safe Inquirer.js prompt configuration.
 * @returns A parser with interactive prompt fallback, always in async mode.
 * @throws {Error} If prompt execution fails with an unexpected error or if
 *                 the inner parser throws while parsing or completing.
 * @since 1.0.0
 */
export function prompt<M extends Mode, TValue, TState>(
  parser: Parser<M, TValue, TState>,
  config: PromptConfig<TValue>,
): Parser<"async", TValue, TState> {
  const promptBindStateKey: unique symbol = Symbol(
    "@optique/inquirer/promptState",
  );

  type PromptBindState =
    & { readonly [K in typeof promptBindStateKey]: true }
    & {
      readonly hasCliValue: boolean;
      readonly cliState?: TState;
    };

  function isPromptBindState(value: unknown): value is PromptBindState {
    return value != null &&
      typeof value === "object" &&
      promptBindStateKey in value;
  }

  const cfg = config as
    | ConfirmConfig
    | NumberPromptConfig
    | StringPromptConfig
    | CheckboxConfig;

  // A sentinel promptBindState used as initialState.  When object() calls
  // complete() with a state structurally equal to this (as part of its
  // completability check), we cache the result so the actual complete() call
  // returns the same value without running the prompter a second time.
  //
  // IMPORTANT: We use a class instance (not a plain object literal) so that
  // resolveDeferredAsync() in constructs.ts does NOT clone it during the
  // Phase 2 dependency-resolution pass.  If it were a plain object, the clone
  // would have a different reference and the `===` sentinel check would fail.
  const PromptBindInitialStateClass = class {
    readonly [promptBindStateKey] = true as const;
    readonly hasCliValue = false as const;
  };
  // Cache for the prompt result during object()'s two-phase complete cycle:
  // 1. completability check (inside object.parse): sets this cache
  // 2. actual complete (inside object.complete): reads and clears this cache
  //
  // The cache is scoped to a specific sentinel state instance so values from
  // one completion cycle are never replayed for another parse invocation.
  let promptCache:
    | {
      readonly state: InstanceType<typeof PromptBindInitialStateClass>;
      readonly result: Promise<ValueParserResult<TValue>>;
    }
    | null = null;

  /**
   * Executes the configured prompt and normalizes its result.
   *
   * Converts `ExitPromptError` into a parse failure and returns prompt values
   * in Optique's `ValueParserResult` shape.
   *
   * @returns The normalized prompt result.
   * @throws {Error} Rethrows unexpected prompt failures after converting
   *                 `ExitPromptError` cancellations into parse failures.
   */
  async function executePrompt(): Promise<ValueParserResult<TValue>> {
    const prompts = getPromptFunctions();
    try {
      // Prompter override (for testing)
      if ("prompter" in cfg && cfg.prompter != null) {
        const value = await cfg.prompter();
        if (cfg.type === "number" && value === undefined) {
          return { success: false, error: message`No number provided.` };
        }
        // Safe because PromptConfig<TValue> constrains the runtime shape, and
        // the number-specific undefined case is rejected just above.
        return { success: true, value: value as TValue };
      }

      switch (cfg.type) {
        case "confirm":
          return {
            success: true,
            // Safe because confirm prompts are only valid for boolean TValue.
            value: await prompts.confirm({
              message: cfg.message,
              ...(cfg.default !== undefined ? { default: cfg.default } : {}),
            }) as TValue,
          };

        case "number": {
          const numResult = await prompts.number({
            message: cfg.message,
            ...(cfg.default !== undefined ? { default: cfg.default } : {}),
            ...(cfg.min !== undefined ? { min: cfg.min } : {}),
            ...(cfg.max !== undefined ? { max: cfg.max } : {}),
            ...(cfg.step !== undefined ? { step: cfg.step } : {}),
          });
          if (numResult === undefined) {
            return { success: false, error: message`No number provided.` };
          }
          // Safe because number prompts are only valid for numeric TValue.
          return { success: true, value: numResult as TValue };
        }

        case "input":
          return {
            success: true,
            // Safe because input prompts are only valid for string TValue.
            value: await prompts.input({
              message: cfg.message,
              ...(cfg.default !== undefined ? { default: cfg.default } : {}),
              ...(cfg.validate !== undefined ? { validate: cfg.validate } : {}),
            }) as TValue,
          };

        case "password":
          return {
            success: true,
            // Safe because password prompts are only valid for string TValue.
            value: await prompts.password({
              message: cfg.message,
              ...(cfg.mask !== undefined ? { mask: cfg.mask } : {}),
              ...(cfg.validate !== undefined ? { validate: cfg.validate } : {}),
            }) as TValue,
          };

        case "editor":
          return {
            success: true,
            // Safe because editor prompts are only valid for string TValue.
            value: await prompts.editor({
              message: cfg.message,
              ...(cfg.default !== undefined ? { default: cfg.default } : {}),
              ...(cfg.validate !== undefined ? { validate: cfg.validate } : {}),
            }) as TValue,
          };

        case "select":
          return {
            success: true,
            // Safe because select prompts are only valid for string TValue.
            value: await prompts.select({
              message: cfg.message,
              choices: normalizeChoices(cfg.choices),
              ...(cfg.default !== undefined ? { default: cfg.default } : {}),
            }) as TValue,
          };

        case "rawlist":
          return {
            success: true,
            // Safe because rawlist prompts are only valid for string TValue.
            value: await prompts.rawlist({
              message: cfg.message,
              choices: normalizeChoices(cfg.choices),
              ...(cfg.default !== undefined ? { default: cfg.default } : {}),
            }) as TValue,
          };

        case "expand":
          return {
            success: true,
            // Safe because expand prompts are only valid for string TValue.
            value: await (prompts.expand as (config: {
              message: string;
              choices: readonly { value: string; name?: string; key: string }[];
              default?: string;
            }) => Promise<string>)({
              message: cfg.message,
              choices: cfg.choices,
              ...(cfg.default !== undefined ? { default: cfg.default } : {}),
            }) as TValue,
          };

        case "checkbox":
          return {
            success: true,
            // Safe because checkbox prompts are only valid for string[] TValue.
            value: await prompts.checkbox({
              message: cfg.message,
              choices: normalizeChoices(cfg.choices),
            }) as TValue,
          };
      }
    } catch (error) {
      if (isExitPromptError(error)) {
        return { success: false, error: message`Prompt cancelled.` };
      }
      throw error;
    }
  }

  function usePromptOrDefer(
    state: unknown,
    result: ValueParserResult<TValue>,
  ): Promise<ValueParserResult<TValue>> {
    if (result.success) {
      return Promise.resolve(result);
    }
    return shouldDeferPrompt(parser, state)
      ? Promise.resolve(deferredPromptResult<TValue>())
      : executePrompt();
  }

  const promptedParser: Parser<"async", TValue, TState> & {
    readonly [inheritParentAnnotationsKey]: true;
  } = {
    $mode: "async",
    $valueType: parser.$valueType,
    $stateType: parser.$stateType,
    priority: parser.priority,
    [inheritParentAnnotationsKey]: true,
    // prompt() makes the CLI argument optional because missing values are
    // handled interactively.
    usage: [{ type: "optional", terms: parser.usage }],
    // Use the sentinel as initialState so complete() can detect the
    // completability-check call and deduplicate prompt execution.
    get initialState(): TState {
      return new PromptBindInitialStateClass() as unknown as TState;
    },

    parse: (context): ModeValue<"async", ParserResult<TState>> => {
      const annotations = getAnnotations(context.state);

      // Unwrap state from a previous parse() call.  After a successful parse,
      // object() stores the wrapped { hasCliValue, cliState } state and passes
      // it back on the next iteration.  The inner parser expects its own
      // native state, so we unwrap cliState before delegating.
      const innerState = isPromptBindState(context.state)
        ? (context.state.hasCliValue
          ? (context.state.cliState as TState)
          : parser.initialState)
        : context.state;
      const baseInnerContext = innerState !== context.state
        ? { ...context, state: innerState }
        : context;
      // Propagate annotations into the inner context state so that source-
      // binding wrappers (bindEnv, bindConfig) can carry them through into
      // their output state.  This is necessary when parse() is called with
      // an annotation-injected initial state (via parseAsync options) and
      // innerState would otherwise be undefined/null, losing the annotations.
      const processResult = (
        result: ParserResult<TState>,
      ): ParserResult<TState> => {
        if (result.success) {
          // Only mark hasCliValue when the inner parser actually consumed
          // input tokens.  Wrappers that return success with consumed: []
          // (e.g., withDefault, bindConfig) should NOT suppress the prompt.
          const cliConsumed = result.consumed.length > 0;
          const nextState = {
            [promptBindStateKey]: true as const,
            hasCliValue: cliConsumed,
            cliState: result.next.state,
            ...(annotations != null ? { [annotationKey]: annotations } : {}),
          } as unknown as TState;
          return {
            success: true,
            next: { ...result.next, state: nextState },
            consumed: result.consumed,
          };
        }

        // If the inner parser consumed tokens before failing, propagate the
        // failure so that specific error messages (e.g., "requires a value")
        // are preserved instead of being suppressed by a prompt.
        if (result.consumed > 0) {
          return result;
        }

        const nextState = {
          [promptBindStateKey]: true as const,
          hasCliValue: false,
          ...(annotations != null ? { [annotationKey]: annotations } : {}),
        } as unknown as TState;
        return {
          success: true,
          next: { ...baseInnerContext, state: nextState },
          consumed: [],
        };
      };

      const result = withAnnotatedInnerState(
        context.state,
        innerState,
        (annotatedInnerState) => {
          const innerContext = annotatedInnerState !== context.state
            ? { ...context, state: annotatedInnerState }
            : context;
          return parser.parse(innerContext);
        },
      );
      if (result instanceof Promise) {
        return result.then(processResult);
      }
      return Promise.resolve(processResult(result));
    },

    complete: (state): Promise<ValueParserResult<TValue>> => {
      if (isPromptBindState(state) && state.hasCliValue) {
        // Inner parser consumed CLI tokens — delegate to it directly.
        const r = withAnnotatedInnerState(
          state,
          state.cliState!,
          (annotatedInnerState) => parser.complete(annotatedInnerState),
        );
        if (r instanceof Promise) {
          return r as Promise<ValueParserResult<TValue>>;
        }
        return Promise.resolve(r as ValueParserResult<TValue>);
      }

      // When state is the sentinel initialState, object() calls complete()
      // twice: once for the completability check and once for the real
      // complete phase.  Cache the result so that if the prompt is needed,
      // it runs only once.
      //
      // In the sentinel path, try the inner parser's complete() first.  This
      // lets source-binding wrappers like bindEnv / bindConfig satisfy the
      // value from their own sources (env var, config file) when no CLI input
      // was provided, avoiding unnecessary interactive prompts.  The cache
      // deduplicates the two calls so the prompt (or inner complete) runs once.
      if (state instanceof PromptBindInitialStateClass) {
        if (promptCache?.state === state) {
          // Second call (real complete phase): consume the cache.
          const cached = promptCache.result;
          promptCache = null;
          return cached;
        }
        // First call: try inner parser, fall back to prompt if it fails.
        const r = withAnnotatedInnerState(
          state,
          parser.initialState,
          (annotatedInnerState) => parser.complete(annotatedInnerState),
        );
        const cachedResult = r instanceof Promise
          ? (r as Promise<ValueParserResult<TValue>>).then((res) =>
            usePromptOrDefer(state, res)
          )
          : usePromptOrDefer(state, r as ValueParserResult<TValue>);
        promptCache = { state, result: cachedResult };
        return cachedResult;
      }

      // Normal case: parse() built a PromptBindState with hasCliValue: false.
      // Only delegate to the inner parser's complete() when the cliState
      // itself carries annotations — i.e., when it came from a source-binding
      // wrapper like bindEnv or bindConfig that injected [annotationKey].
      // Pure combinators such as optional() may preserve the outer
      // annotation-bearing wrapper state even when no CLI value exists, but
      // that is not evidence that complete() can satisfy the value without
      // prompting.
      const cliState = isPromptBindState(state) ? state.cliState : undefined;
      const cliStateHasAnnotations = cliState != null &&
        typeof cliState === "object" &&
        annotationKey in (cliState as object);
      const cliStateIsInjectedAnnotationWrapper = cliState != null &&
        typeof cliState === "object" &&
        unwrapInjectedAnnotationWrapper(cliState) !== cliState;
      const outerAnnotationsAvailable = getAnnotations(state) != null;
      const cliStateIsNonPlainObject = cliState != null &&
        typeof cliState === "object" &&
        !Array.isArray(cliState) &&
        Object.getPrototypeOf(cliState) !== Object.prototype &&
        Object.getPrototypeOf(cliState) !== null;

      if (
        cliState != null &&
        !(cliState instanceof PromptBindInitialStateClass) &&
        (cliStateHasAnnotations ||
          (outerAnnotationsAvailable && cliStateIsNonPlainObject))
      ) {
        const useCompleteResultOrPrompt = (
          result: ValueParserResult<TValue>,
        ): Promise<ValueParserResult<TValue>> => {
          if (
            result.success &&
            result.value === undefined &&
            cliStateIsInjectedAnnotationWrapper
          ) {
            return executePrompt();
          }
          return usePromptOrDefer(state, result);
        };
        const r = withAnnotatedInnerState(
          state,
          cliState as TState,
          (annotatedInnerState) => parser.complete(annotatedInnerState),
        );
        if (r instanceof Promise) {
          return (r as Promise<ValueParserResult<TValue>>).then(
            useCompleteResultOrPrompt,
          );
        }
        return useCompleteResultOrPrompt(r as ValueParserResult<TValue>);
      }

      return shouldDeferPrompt(parser, state)
        ? Promise.resolve(deferredPromptResult<TValue>())
        : executePrompt();
    },

    suggest: (context, prefix) => {
      const innerState = isPromptBindState(context.state)
        ? (context.state.hasCliValue
          ? (context.state.cliState as TState)
          : parser.initialState)
        : context.state;
      const innerContext = innerState !== context.state
        ? { ...context, state: innerState }
        : context;

      const innerResult = parser.suggest(innerContext, prefix) as
        | Iterable<unknown>
        | AsyncIterable<unknown>;

      // Convert sync or async iterable to async iterable to match our mode.
      return (async function* () {
        yield* innerResult;
      })() as AsyncIterable<never>;
    },

    getDocFragments(state, upperDefaultValue?) {
      const configDefault = "default" in cfg
        ? (cfg as { default?: unknown }).default
        : undefined;
      const defaultValue = upperDefaultValue ?? configDefault;
      // Safe because prompt defaults share the same runtime type as TValue.
      return parser.getDocFragments(state, defaultValue as TValue);
    },
  };

  return promptedParser;
}

// ---- Helpers ----

/** Normalize choices to the format Inquirer.js expects. */
function normalizeChoices(
  choices: readonly (string | Choice | ExpandChoice | Separator)[],
): Array<
  {
    value: string;
    name?: string;
    description?: string;
    short?: string;
    disabled?: boolean | string;
  } | Separator
> {
  return choices.map((c) => {
    if (typeof c === "string") return { value: c, name: c };
    if (c instanceof Separator) return c;
    return {
      value: c.value,
      ...(c.name !== undefined ? { name: c.name } : {}),
      ...("description" in c && c.description !== undefined
        ? { description: c.description }
        : {}),
      ...("short" in c && c.short !== undefined ? { short: c.short } : {}),
      ...("disabled" in c && c.disabled !== undefined
        ? { disabled: c.disabled }
        : {}),
    };
  });
}
