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
import { annotationKey, getAnnotations } from "@optique/core/annotations";
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
  const promptBindInitialState = new PromptBindInitialStateClass();

  // Cache for the prompt result during object()'s two-phase complete cycle:
  // 1. completability check (inside object.parse): sets this cache
  // 2. actual complete (inside object.complete): reads and clears this cache
  let promptCache: Promise<ValueParserResult<TValue>> | null = null;

  async function executePrompt(): Promise<ValueParserResult<TValue>> {
    // Prompter override (for testing)
    if ("prompter" in cfg && cfg.prompter != null) {
      const value = await cfg.prompter();
      if (cfg.type === "number" && value === undefined) {
        return { success: false, error: message`No number provided.` };
      }
      return { success: true, value: value as TValue };
    }

    switch (cfg.type) {
      case "confirm":
        return {
          success: true,
          value: await confirm({
            message: cfg.message,
            ...(cfg.default !== undefined ? { default: cfg.default } : {}),
          }) as TValue,
        };

      case "number": {
        const numResult = await number({
          message: cfg.message,
          ...(cfg.default !== undefined ? { default: cfg.default } : {}),
          ...(cfg.min !== undefined ? { min: cfg.min } : {}),
          ...(cfg.max !== undefined ? { max: cfg.max } : {}),
          ...(cfg.step !== undefined ? { step: cfg.step } : {}),
        });
        if (numResult === undefined) {
          return { success: false, error: message`No number provided.` };
        }
        return { success: true, value: numResult as TValue };
      }

      case "input":
        return {
          success: true,
          value: await input({
            message: cfg.message,
            ...(cfg.default !== undefined ? { default: cfg.default } : {}),
            ...(cfg.validate !== undefined ? { validate: cfg.validate } : {}),
          }) as TValue,
        };

      case "password":
        return {
          success: true,
          value: await password({
            message: cfg.message,
            ...(cfg.mask !== undefined ? { mask: cfg.mask } : {}),
            ...(cfg.validate !== undefined ? { validate: cfg.validate } : {}),
          }) as TValue,
        };

      case "editor":
        return {
          success: true,
          value: await editor({
            message: cfg.message,
            ...(cfg.default !== undefined ? { default: cfg.default } : {}),
            ...(cfg.validate !== undefined ? { validate: cfg.validate } : {}),
          }) as TValue,
        };

      case "select":
        return {
          success: true,
          value: await select({
            message: cfg.message,
            choices: normalizeChoices(cfg.choices),
            ...(cfg.default !== undefined ? { default: cfg.default } : {}),
          }) as TValue,
        };

      case "rawlist":
        return {
          success: true,
          value: await rawlist({
            message: cfg.message,
            choices: normalizeChoices(cfg.choices),
            ...(cfg.default !== undefined ? { default: cfg.default } : {}),
          }) as TValue,
        };

      case "expand":
        return {
          success: true,
          value: await (expand as (config: {
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
          value: await checkbox({
            message: cfg.message,
            choices: normalizeChoices(cfg.choices),
          }) as TValue,
        };
    }
  }

  return {
    $mode: "async",
    $valueType: parser.$valueType,
    $stateType: parser.$stateType,
    priority: parser.priority,
    // prompt() makes the CLI argument optional because missing values are
    // handled interactively.
    usage: [{ type: "optional", terms: parser.usage }],
    // Use the sentinel as initialState so complete() can detect the
    // completability-check call and deduplicate prompt execution.
    initialState: promptBindInitialState as unknown as TState,

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
      // Propagate annotations into the inner context state so that source-
      // binding wrappers (bindEnv, bindConfig) can carry them through into
      // their output state.  This is necessary when parse() is called with
      // an annotation-injected initial state (via parseAsync options) and
      // innerState would otherwise be undefined/null, losing the annotations.
      const innerStateWithAnnotations: TState = (
          annotations != null &&
          (innerState == null ||
            (typeof innerState === "object" &&
              !(annotationKey in (innerState as object))))
        )
        ? ({
          ...(innerState != null && typeof innerState === "object"
            ? innerState
            : {}),
          [annotationKey]: annotations,
        } as unknown as TState)
        : innerState;
      const innerContext = innerStateWithAnnotations !== context.state
        ? { ...context, state: innerStateWithAnnotations }
        : context;

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
          next: { ...innerContext, state: nextState },
          consumed: [],
        };
      };

      const result = parser.parse(innerContext);
      if (result instanceof Promise) {
        return result.then(processResult);
      }
      return Promise.resolve(processResult(result));
    },

    complete: (state): Promise<ValueParserResult<TValue>> => {
      if (isPromptBindState(state) && state.hasCliValue) {
        // Inner parser consumed CLI tokens — delegate to it directly.
        const r = parser.complete(state.cliState!);
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
        if (promptCache !== null) {
          // Second call (real complete phase): consume the cache.
          const cached = promptCache;
          promptCache = null;
          return cached;
        }
        // First call: try inner parser, fall back to prompt if it fails.
        const innerState = parser.initialState;
        const r = parser.complete(innerState);
        const fallback = (
          res: ValueParserResult<TValue>,
        ): Promise<ValueParserResult<TValue>> =>
          res.success ? Promise.resolve(res) : executePrompt();
        promptCache = r instanceof Promise
          ? (r as Promise<ValueParserResult<TValue>>).then(fallback)
          : fallback(r as ValueParserResult<TValue>);
        return promptCache;
      }

      // Normal case: parse() built a PromptBindState with hasCliValue: false.
      // Only delegate to the inner parser's complete() when the cliState
      // carries annotations — i.e., when it came from a source-binding
      // wrapper like bindEnv or bindConfig that injected [annotationKey].
      // Pure combinators (optional, multiple, withDefault) do not inject
      // annotations, so their cliState will not carry the key; for those,
      // we skip straight to the interactive prompt.
      const cliState = isPromptBindState(state) ? state.cliState : undefined;
      const cliStateHasAnnotations = cliState != null &&
        typeof cliState === "object" &&
        annotationKey in (cliState as object);

      if (cliStateHasAnnotations) {
        const innerState = cliState as TState;
        const r = parser.complete(innerState);
        const fallback = (
          res: ValueParserResult<TValue>,
        ): Promise<ValueParserResult<TValue>> =>
          res.success ? Promise.resolve(res) : executePrompt();
        if (r instanceof Promise) {
          return (r as Promise<ValueParserResult<TValue>>).then(fallback);
        }
        return fallback(r as ValueParserResult<TValue>);
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
      return parser.getDocFragments(state, defaultValue as TValue);
    },
  };
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
