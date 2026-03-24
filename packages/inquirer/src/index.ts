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
  injectAnnotations,
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

const inheritParentAnnotationsKey = Symbol.for(
  "@optique/core/inheritParentAnnotations",
);

function shouldDeferPrompt(
  parser: Parser<Mode, unknown, unknown>,
  state: unknown,
): boolean {
  return typeof parser.shouldDeferCompletion === "function" &&
    parser.shouldDeferCompletion(state) === true;
}

function deferredPromptResult<TValue>(
  placeholderValue: TValue,
): ValueParserResult<TValue> {
  const result: ValueParserResult<TValue> & { success: true } = {
    success: true,
    value: placeholderValue,
    deferred: true,
  };
  // For object/array placeholders, enumerate all own keys as fully
  // deferred so that prepareParsedForContexts() can strip them.
  // Without this, object-valued leaf placeholders (e.g., from
  // zod(z.object(...))) would pass through to phase-two contexts
  // because they look the same as opaque structured deferred values
  // from map().
  if (placeholderValue != null && typeof placeholderValue === "object") {
    const keys = new Map<PropertyKey, null>();
    for (const key of Reflect.ownKeys(placeholderValue as object)) {
      keys.set(key, null);
    }
    if (keys.size > 0) {
      (result as { deferredKeys?: ReadonlyMap<PropertyKey, unknown> })
        .deferredKeys = keys;
    }
  }
  return result;
}

function withAnnotationView<T extends object, TResult>(
  state: T,
  annotations: Annotations,
  run: (annotatedState: T) => TResult,
): TResult {
  const annotatedState = new Proxy(state, {
    get(target, key) {
      if (key === annotationKey) {
        return annotations;
      }
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    has(target, key) {
      return key === annotationKey || Reflect.has(target, key);
    },
  });
  return run(annotatedState);
}

function withAnnotatedInnerState<TState, TResult>(
  sourceState: unknown,
  innerState: TState,
  run: (annotatedState: TState) => TResult,
): TResult {
  const annotations = getAnnotations(sourceState);
  if (
    annotations == null ||
    innerState == null ||
    typeof innerState !== "object" ||
    (typeof innerState === "object" && annotationKey in innerState)
  ) {
    return run(innerState);
  }

  const inheritedState = inheritAnnotations(sourceState, innerState);
  if (inheritedState !== innerState) {
    return run(inheritedState);
  }

  return withAnnotationView(
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
  // Uses a WeakMap keyed by sentinel state instance so concurrent parse
  // invocations maintain independent caches.  WeakMap ensures entries are
  // garbage-collected if phase 2 never fires (e.g., after a parse failure).
  const promptCache = new WeakMap<
    InstanceType<typeof PromptBindInitialStateClass>,
    Promise<ValueParserResult<TValue>>
  >();

  function shouldAttemptInnerCompletion(
    cliState: unknown,
    state: unknown,
  ): boolean {
    if (
      cliState == null || cliState instanceof PromptBindInitialStateClass
    ) {
      return false;
    }
    const cliStateHasAnnotations = typeof cliState === "object" &&
      annotationKey in cliState;
    if (cliStateHasAnnotations) {
      return true;
    }
    if (getAnnotations(state) == null || typeof cliState !== "object") {
      return false;
    }
    if ("hasCliValue" in cliState) {
      return true;
    }
    if (Array.isArray(cliState)) {
      // Arrays from optional() normally mean "no inner completion needed".
      // However, when the parser carries a config-prompt deferral hook
      // (e.g., optional(bindConfig(...))), the inner parser still needs a
      // chance to resolve from config during phase-two completion.
      return typeof parser.shouldDeferCompletion === "function";
    }
    const prototype = Object.getPrototypeOf(cliState);
    return prototype !== Object.prototype && prototype !== null;
  }

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
  // Prompted values are trusted as-is without re-validation through the inner
  // parser's constraint pipeline.  The prompter returns a value of type TValue,
  // which may belong to a different domain than the inner parser's input (e.g.,
  // when map() transforms the value).  Runtime validation of prompted values
  // should be handled by the prompt config's `validate` option instead.
  function validatePromptedValue(
    result: ValueParserResult<TValue>,
  ): ValueParserResult<TValue> {
    return result;
  }

  const validPromptTypes: ReadonlySet<string> = new Set([
    "confirm",
    "number",
    "input",
    "password",
    "editor",
    "select",
    "rawlist",
    "expand",
    "checkbox",
  ]);

  async function executePromptRaw(): Promise<ValueParserResult<TValue>> {
    const prompts = getPromptFunctions();
    try {
      if (!validPromptTypes.has(cfg.type)) {
        throw new TypeError(
          `Unsupported prompt type: ${(cfg as { readonly type: string }).type}`,
        );
      }

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

  async function executePrompt(): Promise<ValueParserResult<TValue>> {
    const result = await executePromptRaw();
    return validatePromptedValue(result);
  }

  function usePromptOrDefer(
    state: unknown,
    result: ValueParserResult<TValue>,
  ): Promise<ValueParserResult<TValue>> {
    if (result.success) {
      return Promise.resolve(result);
    }
    // Defer when the outer parser (e.g., runWith's two-phase machinery)
    // signals deferral, regardless of whether the wrapped parser exposes
    // a placeholder.  Wrappers that forward shouldDeferCompletion without
    // forwarding placeholder would otherwise fall through to executePrompt
    // and prompt interactively during phase 1.
    if (!shouldDeferPrompt(parser, state)) return executePrompt();
    let ph: TValue | undefined;
    try {
      ph = "placeholder" in parser ? parser.placeholder as TValue : undefined;
    } catch { /* lazy getter may throw before dependencies are ready */ }
    return Promise.resolve(deferredPromptResult(ph as TValue));
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
    // handled interactively.  If the inner parser is already optional
    // (e.g., wrapped in optional() or withDefault()), reuse its usage
    // directly to avoid double-bracketed help like [[--name STRING]].
    usage: parser.usage.length === 1 && parser.usage[0].type === "optional"
      ? parser.usage
      : [{ type: "optional", terms: parser.usage }],
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
        if (promptCache.has(state)) {
          // Second call (real complete phase): consume the cache.
          const cached = promptCache.get(state)!;
          promptCache.delete(state);
          return cached;
        }
        // First call: try inner parser, fall back to prompt if it fails.
        const hasDeferHook = typeof parser.shouldDeferCompletion === "function";

        const annotations = getAnnotations(state);

        // When parser.initialState is null/undefined (e.g., optional()),
        // inject annotations directly so wrapper combinators can forward
        // them to inner source-binding parsers like bindConfig/bindEnv
        // during phase-two resolution and simulated-parse detection.
        const innerInitialState = parser.initialState;
        const effectiveInitialState = annotations != null &&
            innerInitialState == null
          ? injectAnnotations(innerInitialState, annotations)
          : innerInitialState;

        if (hasDeferHook) {
          // Has defer hook — try inner complete, fall back to prompt.
          // Treat { success: true, value: undefined } as "not resolved"
          // so the prompt still fires.  This handles
          // optional(bindConfig(...)) inside object() where optional
          // returns undefined when config is absent.
          const annotatedR = withAnnotatedInnerState(
            state,
            effectiveInitialState,
            (annotatedInnerState) => parser.complete(annotatedInnerState),
          );
          const usePromptOrDeferSentinel = (
            res: ValueParserResult<TValue>,
          ): Promise<ValueParserResult<TValue>> => {
            if (res.success && res.value === undefined) {
              return usePromptOrDefer(state, { success: false, error: [] });
            }
            return usePromptOrDefer(state, res);
          };
          const cachedResult = annotatedR instanceof Promise
            ? (annotatedR as Promise<ValueParserResult<TValue>>).then(
              usePromptOrDeferSentinel,
            )
            : usePromptOrDeferSentinel(
              annotatedR as ValueParserResult<TValue>,
            );
          promptCache.set(state, cachedResult);
          return cachedResult;
        }

        // No defer hook — simulate a parse with an empty buffer (the
        // same thing prompt().parse() does at top level) and inspect the
        // resulting cliState.  Source-binding wrappers (bindEnv) inject
        // hasCliValue or annotationKey into their output state during
        // parse, whereas pure combinators (optional, withDefault) don't.
        const simParseR = withAnnotatedInnerState(
          state,
          effectiveInitialState,
          (annotatedState) =>
            parser.parse({
              buffer: [],
              state: annotatedState,
              optionsTerminated: false,
              usage: parser.usage,
            }),
        );
        const decideFromParse = (
          parseResult: ParserResult<TState>,
        ): Promise<ValueParserResult<TValue>> => {
          // Extract cliState the same way processResult does at top level.
          const consumed = parseResult.success
            ? parseResult.consumed.length
            : 0;
          const cliState = parseResult.success && consumed === 0
            ? parseResult.next.state
            : undefined;
          // Detect source-binding wrappers in the simulated parse state.
          // shouldAttemptInnerCompletion checks annotation markers, but
          // may return true when cliState is merely a pass-through of
          // the injected annotation wrapper (e.g., withDefault returns
          // the context state unchanged).  Exclude injected annotation
          // wrappers: at top level these are PromptBindInitialStateClass
          // instances and shouldAttemptInnerCompletion returns false for
          // them, so the sentinel path must match.
          //
          // The hasCliValue fallback catches bindEnv without annotations
          // (it can still resolve via the active env source registry).
          // When optional/withDefault wraps the inner state in an array
          // (e.g., [envBindState]), unwrap it to check the inner element.
          // Source-binding wrappers (bindEnv) brand their state with a
          // Symbol key plus a hasCliValue flag.  Check for both to avoid
          // false positives from unrelated objects that happen to have a
          // hasCliValue property.
          const hasSourceBindingMarker = (
            s: unknown,
          ): boolean =>
            s != null &&
            typeof s === "object" &&
            "hasCliValue" in s &&
            Object.getOwnPropertySymbols(s).length > 0;
          const cliStateIsPassthrough = cliState != null &&
            typeof cliState === "object" &&
            unwrapInjectedAnnotationWrapper(cliState) !== cliState;
          const isSourceBinding =
            (shouldAttemptInnerCompletion(cliState, state) &&
              !cliStateIsPassthrough) ||
            hasSourceBindingMarker(cliState) ||
            (Array.isArray(cliState) &&
              cliState.length === 1 &&
              (hasSourceBindingMarker(cliState[0]) ||
                (typeof cliState[0] === "object" &&
                  cliState[0] != null &&
                  annotationKey in cliState[0])));
          if (isSourceBinding) {
            // Source-binding wrapper detected — complete from the state
            // produced by parse() (not from initialState) so that any
            // derived state the inner parser built during parse is
            // available during completion.
            const cliStateIsInjected = cliState != null &&
              typeof cliState === "object" &&
              unwrapInjectedAnnotationWrapper(cliState) !== cliState;
            const handleCompleteResult = (
              res: ValueParserResult<TValue>,
            ): Promise<ValueParserResult<TValue>> => {
              // Mirror the top-level useCompleteResultOrPrompt logic:
              // prompt when value is undefined and the cliState is an
              // injected annotation wrapper (handles optional()), but
              // use the value otherwise (handles withDefault(), bindEnv).
              if (
                res.success && res.value === undefined && cliStateIsInjected
              ) {
                return executePrompt();
              }
              return usePromptOrDefer(state, res);
            };
            // Complete from the parse-produced state, not initialState.
            const completeState = parseResult.success
              ? parseResult.next.state
              : effectiveInitialState;
            const completeR = parser.complete(completeState);
            if (completeR instanceof Promise) {
              return (completeR as Promise<ValueParserResult<TValue>>).then(
                handleCompleteResult,
              );
            }
            return handleCompleteResult(
              completeR as ValueParserResult<TValue>,
            );
          }
          // Non-source-binding wrapper → prompt.
          return executePrompt();
        };
        const cachedResult = simParseR instanceof Promise
          ? (simParseR as Promise<ParserResult<TState>>).then(decideFromParse)
          : decideFromParse(simParseR as ParserResult<TState>);
        promptCache.set(state, cachedResult);
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
      const cliStateIsInjectedAnnotationWrapper = cliState != null &&
        typeof cliState === "object" &&
        unwrapInjectedAnnotationWrapper(cliState) !== cliState;

      if (shouldAttemptInnerCompletion(cliState, state)) {
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

      if (shouldDeferPrompt(parser, state)) {
        let ph: TValue | undefined;
        try {
          ph = "placeholder" in parser
            ? parser.placeholder as TValue
            : undefined;
        } catch { /* lazy getter may throw */ }
        return Promise.resolve(deferredPromptResult(ph as TValue));
      }
      return executePrompt();
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

  // Lazily forward placeholder from inner parser so that outer wrappers
  // (withDefault, group, etc.) can see it without triggering eager
  // evaluation.
  if ("placeholder" in parser) {
    Object.defineProperty(promptedParser, "placeholder", {
      get() {
        try {
          return parser.placeholder as TValue;
        } catch {
          return undefined;
        }
      },
      configurable: true,
      enumerable: false,
    });
  }

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
