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
import { getAnnotations } from "@optique/core/annotations";
import {
  defineTraits,
  delegateSuggestNodes,
  getTraits,
  inheritAnnotations,
  injectAnnotations,
  mapSourceMetadata,
  type ParserSourceMetadata,
  unwrapInjectedAnnotationState,
  withAnnotationView,
} from "@optique/core/extension";
import type {
  ExecutionContext,
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

function shouldDeferPrompt(
  parser: Parser<Mode, unknown, unknown>,
  state: unknown,
  exec?: ExecutionContext,
): boolean {
  return typeof parser.shouldDeferCompletion === "function" &&
    parser.shouldDeferCompletion(state, exec) === true;
}

function deferredPromptResult<TValue>(
  placeholderValue: TValue,
): ValueParserResult<TValue> {
  if (placeholderValue == null || typeof placeholderValue !== "object") {
    return {
      success: true,
      value: placeholderValue,
      deferred: true,
    };
  }

  // For object/array placeholders, enumerate all own keys as fully
  // deferred so that prepareParsedForContexts() can strip them.
  // Without this, object-valued leaf placeholders (e.g., from
  // zod(z.object(...))) would pass through to phase-two contexts
  // because they look the same as opaque structured deferred values
  // from map().
  const isArray = Array.isArray(placeholderValue);
  const keys = new Map<PropertyKey, null>();
  for (const key of Reflect.ownKeys(placeholderValue as object)) {
    // Skip "length" on arrays — setting it to undefined would throw
    // RangeError: Invalid array length.
    if (isArray && key === "length") continue;
    keys.set(key, null);
  }

  // Always set deferredKeys — even when empty (non-plain objects
  // like URL, Date, Intl.Locale).  An empty map distinguishes leaf
  // deferred objects (from prompt()) from opaque structured deferred
  // (from map()), allowing prepareParsedForContexts() to strip the
  // former while passing through the latter.
  return {
    success: true,
    value: placeholderValue,
    deferred: true,
    deferredKeys: keys,
  };
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
    getAnnotations(innerState) != null
  ) {
    return run(innerState);
  }

  const inheritedState = inheritAnnotations(sourceState, innerState);
  if (inheritedState !== innerState) {
    return run(inheritedState);
  }

  return run(withAnnotationView(innerState, annotations));
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
 * The returned parser always has `mode: "async"` because Inquirer.js prompts
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

  // The initial state for prompt() is a plain PromptBindState with
  // hasCliValue: false and no cliState.  Unlike the previous sentinel-based
  // design, we do not rely on the state *instance* to distinguish the
  // completability probe from the real completion call: that distinction
  // is now carried by {@link ExecutionContext.phase}, which `object()`
  // stamps as `"parse"` during its zero-consumption probe and `"complete"`
  // during the real completion pass.
  //
  // Note: we intentionally do *not* cache prompt results.  Within a single
  // parse invocation `prompt.complete()` is called at most once per
  // (field, phase) pair — probe returns a placeholder without firing the
  // prompter, and real phase runs exactly once.  Caching across parse
  // invocations would be a bug: because `parser.initialState` is a shared
  // object, a WeakMap keyed by state identity would incorrectly reuse a
  // previous invocation's prompted value on subsequent `parse*()` calls
  // of the same parser.

  function shouldAttemptInnerCompletion(
    cliState: unknown,
    state: unknown,
  ): boolean {
    if (cliState == null) {
      return false;
    }
    const cliStateHasAnnotations = getAnnotations(cliState) != null;
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

  function hasSourceBindingMarker(state: unknown): boolean {
    return state != null &&
      typeof state === "object" &&
      "hasCliValue" in state &&
      Object.getOwnPropertySymbols(state).length > 0;
  }

  function shouldCompleteFromSourceBinding(
    cliState: unknown,
    state: unknown,
  ): boolean {
    const cliStateIsInjectedAnnotationWrapper = cliState != null &&
      typeof cliState === "object" &&
      unwrapInjectedAnnotationState(cliState) !== cliState;
    const requiresSourceBindingForAnnotationWrapper =
      getTraits(parser).requiresSourceBinding === true;
    const hasNestedSourceBinding = hasSourceBindingMarker(cliState) ||
      (Array.isArray(cliState) &&
        cliState.length === 1 &&
        (hasSourceBindingMarker(cliState[0]) ||
          (
            cliState[0] != null &&
            typeof cliState[0] === "object" &&
            getAnnotations(cliState[0]) != null
          )));
    if (
      cliStateIsInjectedAnnotationWrapper &&
      requiresSourceBindingForAnnotationWrapper
    ) {
      return hasNestedSourceBinding;
    }
    return shouldAttemptInnerCompletion(cliState, state) ||
      hasNestedSourceBinding;
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

  const promptedParser: Parser<"async", TValue, TState> = {
    mode: "async",
    $valueType: parser.$valueType,
    $stateType: parser.$stateType,
    priority: parser.priority,
    // prompt() makes the CLI argument optional because missing values are
    // handled interactively.  If the inner parser is already optional
    // (e.g., wrapped in optional() or withDefault()), reuse its usage
    // directly to avoid double-bracketed help like [[--name STRING]].
    usage: parser.usage.length === 1 && parser.usage[0].type === "optional"
      ? parser.usage
      : [{ type: "optional", terms: parser.usage }],
    leadingNames: parser.leadingNames,
    acceptingAnyToken: parser.acceptingAnyToken,
    // Missing-CLI prompt completion must run in the outer parser's deferred
    // pass so shared-buffer combinators like object() do not start multiple
    // interactive prompts concurrently.
    shouldDeferCompletion(state: TState): boolean {
      return !isPromptBindState(state) || !state.hasCliValue;
    },
    getSuggestRuntimeNodes(state: TState, path: readonly PropertyKey[]) {
      const innerState = isPromptBindState(state)
        ? (state.cliState === undefined
          ? parser.initialState
          : state.cliState as TState)
        : state;
      return delegateSuggestNodes(
        parser,
        promptedParser,
        state,
        path,
        innerState,
        "prepend",
      );
    },
    // Plain PromptBindState with hasCliValue: false.  We no longer use a
    // class-based sentinel: phase detection is carried by
    // {@link ExecutionContext.phase} instead of state identity, so
    // object()'s zero-consumption pass can now run prompt.parse() without
    // breaking the probe-vs-real distinction.
    initialState: {
      [promptBindStateKey]: true as const,
      hasCliValue: false as const,
    } as unknown as TState,

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
      const effectiveInnerState = annotations != null &&
          innerState == null &&
          getTraits(parser).inheritsAnnotations === true
        ? injectAnnotations(innerState, annotations)
        : innerState;
      // Propagate annotations into the inner context state so that source-
      // binding wrappers (bindEnv, bindConfig) can carry them through into
      // their output state.  This is necessary when parse() is called with
      // an annotation-injected initial state (via parseAsync options) and
      // innerState would otherwise be undefined/null, losing the annotations.
      const processResult = (
        result: ParserResult<TState>,
      ): ParserResult<TState> => {
        if (result.success) {
          const cliState = annotations != null &&
              result.next.state != null &&
              typeof result.next.state === "object" &&
              getAnnotations(result.next.state) !== annotations
            ? injectAnnotations(result.next.state, annotations)
            : result.next.state;
          // Only mark hasCliValue when the inner parser actually consumed
          // input tokens.  Wrappers that return success with consumed: []
          // (e.g., withDefault, bindConfig) should NOT suppress the prompt.
          const cliConsumed = result.consumed.length > 0;
          const nextState = injectAnnotations({
            [promptBindStateKey]: true as const,
            hasCliValue: cliConsumed,
            cliState,
          }, annotations);
          return {
            success: true,
            ...(result.provisional ? { provisional: true as const } : {}),
            next: { ...result.next, state: nextState as TState },
            consumed: result.consumed,
          };
        }

        // If the inner parser consumed tokens before failing, propagate the
        // failure so that specific error messages (e.g., "requires a value")
        // are preserved instead of being suppressed by a prompt.
        if (result.consumed > 0) {
          return result;
        }

        const nextState = injectAnnotations({
          [promptBindStateKey]: true as const,
          hasCliValue: false,
        }, annotations);
        return {
          success: true,
          next: { ...baseInnerContext, state: nextState as TState },
          consumed: [],
        };
      };

      const result = withAnnotatedInnerState(
        context.state,
        effectiveInnerState,
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

    complete: (state, exec?): Promise<ValueParserResult<TValue>> => {
      if (isPromptBindState(state) && state.hasCliValue) {
        // Inner parser consumed CLI tokens — delegate to it directly.
        const r = withAnnotatedInnerState(
          state,
          state.cliState!,
          (annotatedInnerState) => parser.complete(annotatedInnerState, exec),
        );
        if (r instanceof Promise) {
          return r as Promise<ValueParserResult<TValue>>;
        }
        return Promise.resolve(r as ValueParserResult<TValue>);
      }

      // No CLI value provided.  We arrive here in two shapes:
      //
      //  1.  Top level (or `object()` skipping the zero-consumption pass
      //      because the inner parser has leadingNames): `state` is the
      //      `initialState` (or an annotated view of it).  `cliState` is
      //      absent, so we do not yet know whether the inner parser can
      //      satisfy the value from a source binding (bindEnv/bindConfig)
      //      or a completion-deferral hook.  We simulate an empty-buffer
      //      parse to probe the inner's state shape before deciding.
      //
      //  2.  Inside `object()`'s zero-consumption pass when the inner
      //      parser has no leadingNames: `state` is a `PromptBindState`
      //      whose `cliState` field may already have been populated by
      //      that pre-commit parse call, but `hasCliValue` is still
      //      `false` (nothing was consumed).  The current implementation
      //      does not special-case this: it still runs the simulate-parse
      //      step below and ignores `state.cliState`, which is harmless
      //      because the simulate-parse reproduces the same empty-buffer
      //      result.  (This path is only reachable for inner parsers
      //      like `constant()` that have no leadingNames; for the common
      //      `prompt(option(...))` shape `object()` still skips the
      //      zero-consumption pass because of leadingNames.)
      //
      // In both shapes, `ExecutionContext.phase` distinguishes
      // `object()`'s `allCanComplete` probe (`"parse"`) from the real
      // completion pass (`"complete"`).  We only treat `"complete"` as
      // the real pass and every other phase (`"parse"`, `"precomplete"`,
      // `"resolve"`, `"suggest"`, or any future phase) as speculative,
      // so firing the prompter is strictly limited to the single pass
      // whose purpose is to produce the final user-facing value.  If
      // no execution context is provided at all (legacy callers), we
      // fall back to the real-completion behaviour.
      const isProbe = exec != null && exec.phase !== "complete";
      const annotations = getAnnotations(state);

      // Build the effective inner state to feed parse()/complete() with.
      // We propagate annotations into object-shaped and nullish inner
      // initial states so that boolean flag options (whose
      // `initialState` is an object like `{ success: true, value: false }`),
      // source-binding wrappers (`bindEnv()` / `bindConfig()` with a
      // nullish initial state that they rebuild during `parse()`), and
      // class-instance initial states all see the annotations they
      // need.  `inheritAnnotations()` handles the object cases (plain
      // objects and arrays get shallow-cloned with the annotation
      // slot; non-plain class instances are returned unchanged so the
      // proxy-view fallback in `withAnnotatedInnerState()` below takes
      // over), and wraps nullish states with the annotation slot.
      //
      // Non-nullish primitive initial states (e.g. `constant("v")`
      // whose `initialState` IS `"v"`) are returned unchanged.  Routing
      // them through `inheritAnnotations()` would fall back to
      // `injectAnnotations()`, which wraps the primitive into an opaque
      // object; echo-semantics parsers like `constant()` would then
      // return that wrapper from `complete()`, leaking it into the
      // final value under `object({ x: prompt(constant(...)) })` with
      // `parse({ annotations })`.  Mirrors the same guard in
      // `deriveOptionalInnerParseState()` in @optique/core.
      const innerInitialState = parser.initialState;
      const shouldInheritInitialStateAnnotations = annotations != null &&
        (innerInitialState == null || typeof innerInitialState === "object");
      const effectiveInitialState = shouldInheritInitialStateAnnotations
        ? inheritAnnotations(state, innerInitialState)
        : innerInitialState;

      // Read the inner parser's lazy `placeholder` if it exposes one,
      // swallowing any throw from a misbehaving getter.  This is used
      // in two places below (probe phase and `shouldDeferCompletion`
      // deferral), so it is factored out to avoid duplicating the
      // try/catch and the `"placeholder" in parser` check.
      const readPlaceholder = (): TValue | undefined => {
        try {
          return "placeholder" in parser
            ? parser.placeholder as TValue
            : undefined;
        } catch {
          // Lazy getter may throw; treat as "no placeholder".
          return undefined;
        }
      };

      const finalizePrompt = (): Promise<ValueParserResult<TValue>> => {
        // `shouldDeferCompletion` is part of the inner `Parser<TState>`
        // contract, so it must be called with the inner parser's own
        // state shape — not the prompt wrapper's `state` (which is a
        // `PromptBindState` or annotated view of one).  Route through
        // `withAnnotatedInnerState` so the inner state carries the
        // outer annotations exactly the way `parser.complete` /
        // `parser.parse` see them on the lines below.
        const shouldDefer = withAnnotatedInnerState(
          state,
          effectiveInitialState,
          (annotatedInnerState) =>
            shouldDeferPrompt(parser, annotatedInnerState, exec),
        );
        if (shouldDefer) {
          return Promise.resolve(
            deferredPromptResult(readPlaceholder() as TValue),
          );
        }
        if (isProbe) {
          // Probe phase: do not fire the prompter.  Return a placeholder
          // so that `object()`'s allCanComplete check passes.  The real
          // completion pass will re-run this path and actually prompt.
          return Promise.resolve({
            success: true as const,
            value: readPlaceholder() as TValue,
          });
        }
        return executePrompt();
      };

      // Decide whether to try satisfying the value through the inner
      // parser's complete() before prompting.
      //
      // When `shouldDeferCompletion` is present, we always try inner
      // complete — the hook is the whole point.  Otherwise we simulate
      // an empty-buffer parse and inspect the resulting state for
      // source-binding markers (hasCliValue flag plus a symbol-keyed
      // state shape, as bindEnv/bindConfig produce).  This mirrors what
      // the old sentinel path did, without requiring a sentinel state
      // identity — the simulate-parse is driven purely by the phase
      // signal and the inner parser's own parse() output.
      const hasDeferHook = typeof parser.shouldDeferCompletion === "function";

      const decideFromParse = (
        parseResult: ParserResult<TState>,
      ): Promise<ValueParserResult<TValue>> => {
        const consumed = parseResult.success ? parseResult.consumed.length : 0;
        const cliState = parseResult.success && consumed === 0
          ? parseResult.next.state
          : undefined;
        const cliStateIsInjected = cliState != null &&
          typeof cliState === "object" &&
          unwrapInjectedAnnotationState(cliState) !== cliState;
        const isSourceBinding = shouldCompleteFromSourceBinding(
          cliState,
          state,
        );
        if (!isSourceBinding) {
          // Non-source-binding inner (plain option, argument, or an
          // arbitrary value-on-complete parser such as `alwaysCompletes`
          // in the inquirer tests) — go straight to prompting.
          return finalizePrompt();
        }
        // Source-binding wrapper detected.  Complete from the
        // parse-produced state so any derived state the inner parser
        // built during parse is available during completion.
        const completeState = parseResult.success
          ? parseResult.next.state
          : effectiveInitialState;
        const innerR = parser.complete(completeState as TState, exec);
        const handleCompleteResult = (
          res: ValueParserResult<TValue>,
        ): Promise<ValueParserResult<TValue>> => {
          // Prompt when the inner value is undefined and the cliState
          // was merely an injected annotation wrapper (optional() case
          // where no source actually satisfied the value).  In any
          // other case the undefined is a legitimate user-facing value
          // (withDefault(..., undefined), for example).
          if (
            res.success && res.value === undefined && cliStateIsInjected
          ) {
            return finalizePrompt();
          }
          if (!res.success) {
            return finalizePrompt();
          }
          return Promise.resolve(res);
        };
        if (innerR instanceof Promise) {
          return (innerR as Promise<ValueParserResult<TValue>>).then(
            handleCompleteResult,
          );
        }
        return handleCompleteResult(innerR as ValueParserResult<TValue>);
      };

      if (hasDeferHook) {
        // With a defer hook, we skip the simulate-parse step and try
        // inner complete() directly.  The hook itself signals deferral
        // when appropriate.
        const innerR = withAnnotatedInnerState(
          state,
          effectiveInitialState,
          (annotatedInnerState) => parser.complete(annotatedInnerState, exec),
        );
        const handleDeferHookResult = (
          res: ValueParserResult<TValue>,
        ): Promise<ValueParserResult<TValue>> => {
          if (res.success && res.value === undefined) {
            return finalizePrompt();
          }
          if (!res.success) {
            return finalizePrompt();
          }
          return Promise.resolve(res);
        };
        if (innerR instanceof Promise) {
          return (innerR as Promise<ValueParserResult<TValue>>).then(
            handleDeferHookResult,
          );
        }
        return handleDeferHookResult(innerR as ValueParserResult<TValue>);
      }

      // Simulate a parse with an empty buffer and inspect the
      // resulting state for source-binding markers.
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
      if (simParseR instanceof Promise) {
        return (simParseR as Promise<ParserResult<TState>>).then(
          decideFromParse,
        );
      }
      return decideFromParse(simParseR as ParserResult<TState>);
    },

    suggest: (context, prefix) => {
      const innerState = isPromptBindState(context.state)
        ? (context.state.cliState === undefined
          ? parser.initialState
          : context.state.cliState as TState)
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
  defineTraits(promptedParser, { inheritsAnnotations: true });

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
  // Forward value normalization from inner parser so that withDefault()
  // can normalize defaults through prompt() wrappers.
  if (typeof parser.normalizeValue === "function") {
    Object.defineProperty(promptedParser, "normalizeValue", {
      value: parser.normalizeValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  const dependencyMetadata = mapSourceMetadata(
    parser,
    (source: ParserSourceMetadata<M, TValue, TState>) => ({
      ...source,
      extractSourceValue: (state: unknown) => {
        if (!isPromptBindState(state)) {
          return source.extractSourceValue(state);
        }
        return source.extractSourceValue(
          state.cliState ?? state,
        );
      },
    }),
  );
  if (dependencyMetadata != null) {
    Object.defineProperty(promptedParser, "dependencyMetadata", {
      value: dependencyMetadata,
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
