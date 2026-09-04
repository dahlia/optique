/**
 * Interactive prompt support for Optique via Inquirer.js.
 *
 * @module
 * @since 1.0.0
 */
import process from "node:process";
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
import type { FluentParser } from "@optique/core/fluent";
import { formatMessage, message } from "@optique/core/message";
import type { Mode, Parser } from "@optique/core/parser";
import type { ValueParserResult } from "@optique/core/valueparser";
import {
  createPromptAdapter,
  type DerivedPromptConfig,
  type PromptCondition,
  type PromptExecutionContext,
  type PromptOptions,
} from "@optique/prompt";

export { derivePromptConfig, isDerivedPromptConfig } from "@optique/prompt";
export type {
  DerivedPromptConfig,
  DerivePromptConfigContext,
  DerivePromptConfigOptions,
  DerivePromptConfigsContext,
  DerivePromptConfigsOptions,
  PromptExecutionContext,
  PromptOptions,
  PromptValidator,
} from "@optique/prompt";

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

interface InquirerPromptContext {
  readonly signal?: AbortSignal;
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

function promptFunctionKeys(): readonly (keyof PromptFunctions)[] {
  return Object.keys(
    defaultPromptFunctions,
  ) as readonly (keyof PromptFunctions)[];
}

function assignPromptFunctionOverride<K extends keyof PromptFunctions>(
  override: { -readonly [P in keyof PromptFunctions]?: PromptFunctions[P] },
  key: K,
  candidate: unknown,
): void {
  if (typeof candidate === "function") {
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
 * Determines whether an error came from an interrupted Inquirer.js prompt.
 */
function isExitPromptError(error: unknown): boolean {
  return typeof error === "object" &&
    error != null &&
    "name" in error &&
    error.name === "ExitPromptError";
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
 * A choice item for the `checkbox` prompt type.
 *
 * @since 1.2.0
 */
export interface CheckboxChoice extends Choice {
  /** Whether the choice is initially selected. */
  readonly checked?: boolean;
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
  /** The question to display to the user. */
  readonly message: string;
  /** Default answer when the user just presses Enter. */
  readonly default?: boolean;
  /**
   * Override the prompt execution. Useful for testing.
   * @since 1.3.0 The callback receives the current attempt context.
   */
  readonly prompter?: (context: PromptExecutionContext) => Promise<boolean>;
}

/**
 * Configuration for a `number` prompt.
 *
 * @since 1.0.0
 */
export interface NumberPromptConfig {
  readonly type: "number";
  /** The question to display to the user. */
  readonly message: string;
  /** Default number shown to the user. */
  readonly default?: number;
  /** Minimum accepted value. */
  readonly min?: number;
  /** Maximum accepted value. */
  readonly max?: number;
  /** Granularity of valid values. Use `"any"` for arbitrary decimals. */
  readonly step?: number | "any";
  /**
   * Override the prompt execution. Useful for testing.
   * @since 1.3.0 The callback receives the current attempt context.
   */
  readonly prompter?: (
    context: PromptExecutionContext,
  ) => Promise<number | undefined>;
}

/**
 * Configuration for an `input` prompt (free-text string).
 *
 * @since 1.0.0
 */
export interface InputConfig {
  readonly type: "input";
  /** The question to display to the user. */
  readonly message: string;
  /** Default text pre-filled in the prompt. */
  readonly default?: string;
  /** Validation function called when the user submits. */
  readonly validate?: (
    value: string,
  ) => boolean | string | Promise<boolean | string>;
  /**
   * Override the prompt execution. Useful for testing.
   * @since 1.3.0 The callback receives the current attempt context.
   */
  readonly prompter?: (context: PromptExecutionContext) => Promise<string>;
}

/**
 * Configuration for a `password` prompt (masked input).
 *
 * @since 1.0.0
 */
export interface PasswordConfig {
  readonly type: "password";
  /** The question to display to the user. */
  readonly message: string;
  /** If `true`, show `*` characters for each keystroke. */
  readonly mask?: boolean;
  /** Validation function called when the user submits. */
  readonly validate?: (
    value: string,
  ) => boolean | string | Promise<boolean | string>;
  /**
   * Override the prompt execution. Useful for testing.
   * @since 1.3.0 The callback receives the current attempt context.
   */
  readonly prompter?: (context: PromptExecutionContext) => Promise<string>;
}

/**
 * Configuration for an `editor` prompt (external editor).
 *
 * @since 1.0.0
 */
export interface EditorConfig {
  readonly type: "editor";
  /** The question to display to the user. */
  readonly message: string;
  /** Default content pre-filled in the editor. */
  readonly default?: string;
  /** Validation function called when the editor is closed. */
  readonly validate?: (
    value: string,
  ) => boolean | string | Promise<boolean | string>;
  /**
   * Override the prompt execution. Useful for testing.
   * @since 1.3.0 The callback receives the current attempt context.
   */
  readonly prompter?: (context: PromptExecutionContext) => Promise<string>;
}

/**
 * Configuration for a `select` prompt (arrow-key single-select).
 *
 * @since 1.0.0
 */
export interface SelectConfig {
  readonly type: "select";
  /** The question to display to the user. */
  readonly message: string;
  /** Available choices. */
  readonly choices: readonly (string | Choice | Separator)[];
  /** Initially highlighted choice value. */
  readonly default?: string;
  /**
   * Override the prompt execution. Useful for testing.
   * @since 1.3.0 The callback receives the current attempt context.
   */
  readonly prompter?: (context: PromptExecutionContext) => Promise<string>;
}

/**
 * Configuration for a `rawlist` prompt (numbered list).
 *
 * @since 1.0.0
 */
export interface RawlistConfig {
  readonly type: "rawlist";
  /** The question to display to the user. */
  readonly message: string;
  /** Available choices. */
  readonly choices: readonly (string | Choice)[];
  /** Pre-selected choice value. */
  readonly default?: string;
  /**
   * Override the prompt execution. Useful for testing.
   * @since 1.3.0 The callback receives the current attempt context.
   */
  readonly prompter?: (context: PromptExecutionContext) => Promise<string>;
}

/**
 * Configuration for an `expand` prompt (keyboard shortcut single-select).
 *
 * @since 1.0.0
 */
export interface ExpandConfig {
  readonly type: "expand";
  /** The question to display to the user. */
  readonly message: string;
  /** Available choices. Each choice requires a `key` field. */
  readonly choices: readonly ExpandChoice[];
  /** Default choice key. */
  readonly default?: string;
  /**
   * Override the prompt execution. Useful for testing.
   * @since 1.3.0 The callback receives the current attempt context.
   */
  readonly prompter?: (context: PromptExecutionContext) => Promise<string>;
}

/**
 * Configuration for a `checkbox` prompt (multi-select).
 *
 * @since 1.0.0
 */
export interface CheckboxConfig {
  readonly type: "checkbox";
  /** The question to display to the user. */
  readonly message: string;
  /** Available choices. */
  readonly choices: readonly (string | CheckboxChoice | Separator)[];
  /**
   * Override the prompt execution. Useful for testing.
   * @since 1.3.0 The callback receives the current attempt context.
   */
  readonly prompter?: (
    context: PromptExecutionContext,
  ) => Promise<readonly string[]>;
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
 * @since 1.0.0
 * @since 1.3.0 Added conditional prompt skipping.
 */
export type PromptConfig<T> =
  & BasePromptConfig<Exclude<T, null | undefined>>
  & PromptCondition<T>;

type BasePromptConfig<T> = T extends boolean ? ConfirmConfig
  : T extends number ? NumberPromptConfig
  : T extends string ? StringPromptConfig
  : T extends readonly string[] ? CheckboxConfig
  : never;

/**
 * Union of every prompt configuration this package can execute,
 * regardless of the parser value type.
 *
 * Derived prompt configurations resolve against this union: the adapter's
 * configuration type supplies the resolver's return type, so a resolver
 * may produce any prompt kind the adapter supports.  The resolver author must
 * choose a kind whose result matches the wrapped parser's value type.
 *
 * @since 1.3.0
 */
export type RuntimePromptConfig =
  | ConfirmConfig
  | NumberPromptConfig
  | StringPromptConfig
  | CheckboxConfig;

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

// ---- prompt() implementation ----

/**
 * Wraps a parser with an interactive Inquirer.js prompt fallback.
 *
 * When the inner parser finds a value in the CLI arguments, that value is used
 * directly.  When no CLI value is found, an interactive prompt is shown to the
 * user.  If the supplied signal is aborted, parsing rejects with the signal's
 * reason.
 *
 * @param parser Inner parser that reads CLI values.
 * @param config Type-safe Inquirer.js prompt configuration, or a
 *               configuration derived from dependency sources via
 *               `derivePromptConfig()`.
 * @param options Shared validation, retry, and abort options for the
 *                interactive fallback.
 * @returns A parser with interactive prompt fallback, always in async mode.
 * @throws {RangeError} If `options.maxAttempts` is not a positive integer.
 * @throws {Error} If prompt execution fails with an unexpected error or if the
 *                 inner parser throws while parsing or completing.
 * @since 1.0.0
 * @since 1.3.0 Added the `options` parameter.
 */
export function prompt<M extends Mode, TValue, TState>(
  parser: Parser<M, TValue, TState>,
  config:
    | PromptConfig<TValue>
    | DerivedPromptConfig<RuntimePromptConfig, NoInfer<TValue>>,
  options?: PromptOptions<NoInfer<TValue>>,
): FluentParser<"async", TValue, TState> {
  const promptWithAdapter = createPromptAdapter<RuntimePromptConfig>({
    execute: executePromptRaw,
    getDefaultValue: getConfigDefault,
  });
  return promptWithAdapter(parser, config, options);
}

function getConfigDefault(config: unknown): unknown {
  if (config != null && typeof config === "object" && "default" in config) {
    return (config as { readonly default?: unknown }).default;
  }
  return undefined;
}

async function executePromptRaw<TValue>(
  config: RuntimePromptConfig,
  context: PromptExecutionContext,
): Promise<ValueParserResult<TValue>> {
  const cfg = config;
  const prompts = getPromptFunctions();
  try {
    if (!validPromptTypes.has(cfg.type)) {
      throw new TypeError(
        `Unsupported prompt type: ${String(cfg.type)}.`,
      );
    }

    if ("prompter" in cfg && cfg.prompter != null) {
      const value = await cfg.prompter(context);
      if (cfg.type === "number" && value === undefined) {
        return { success: false, error: message`No number provided.` };
      }
      return { success: true, value: value as TValue };
    }

    if (context.previousValidationMessage !== undefined) {
      process.stderr.write(
        formatMessage(context.previousValidationMessage) + "\n",
      );
    }
    const inquirerContext: InquirerPromptContext = {
      ...(context.signal === undefined ? {} : { signal: context.signal }),
    };

    switch (cfg.type) {
      case "confirm":
        return {
          success: true,
          value: await prompts.confirm({
            message: cfg.message,
            ...(cfg.default !== undefined ? { default: cfg.default } : {}),
          }, inquirerContext) as TValue,
        };

      case "number": {
        const numResult = await prompts.number({
          message: cfg.message,
          ...(cfg.default !== undefined ? { default: cfg.default } : {}),
          ...(cfg.min !== undefined ? { min: cfg.min } : {}),
          ...(cfg.max !== undefined ? { max: cfg.max } : {}),
          ...(cfg.step !== undefined ? { step: cfg.step } : {}),
        }, inquirerContext);
        if (numResult === undefined) {
          return { success: false, error: message`No number provided.` };
        }
        return { success: true, value: numResult as TValue };
      }

      case "input":
        return {
          success: true,
          value: await prompts.input({
            message: cfg.message,
            ...(cfg.default !== undefined ? { default: cfg.default } : {}),
            ...(cfg.validate !== undefined ? { validate: cfg.validate } : {}),
          }, inquirerContext) as TValue,
        };

      case "password":
        return {
          success: true,
          value: await prompts.password({
            message: cfg.message,
            ...(cfg.mask !== undefined ? { mask: cfg.mask } : {}),
            ...(cfg.validate !== undefined ? { validate: cfg.validate } : {}),
          }, inquirerContext) as TValue,
        };

      case "editor":
        return {
          success: true,
          value: await prompts.editor({
            message: cfg.message,
            ...(cfg.default !== undefined ? { default: cfg.default } : {}),
            ...(cfg.validate !== undefined ? { validate: cfg.validate } : {}),
          }, inquirerContext) as TValue,
        };

      case "select":
        return {
          success: true,
          value: await prompts.select({
            message: cfg.message,
            choices: normalizeChoices(cfg.choices),
            ...(cfg.default !== undefined ? { default: cfg.default } : {}),
          }, inquirerContext) as TValue,
        };

      case "rawlist":
        return {
          success: true,
          value: await prompts.rawlist({
            message: cfg.message,
            choices: normalizeChoices(cfg.choices),
            ...(cfg.default !== undefined ? { default: cfg.default } : {}),
          }, inquirerContext) as TValue,
        };

      case "expand":
        return {
          success: true,
          value: await (prompts.expand as (
            config: {
              message: string;
              choices: readonly {
                value: string;
                name?: string;
                key: string;
              }[];
              default?: string;
            },
            context?: InquirerPromptContext,
          ) => Promise<string>)({
            message: cfg.message,
            choices: cfg.choices,
            ...(cfg.default !== undefined ? { default: cfg.default } : {}),
          }, inquirerContext) as TValue,
        };

      case "checkbox":
        return {
          success: true,
          value: await prompts.checkbox({
            message: cfg.message,
            choices: normalizeChoices(cfg.choices),
          }, inquirerContext) as TValue,
        };
    }
  } catch (error) {
    if (isExitPromptError(error)) {
      return { success: false, error: message`Prompt cancelled.` };
    }
    // Inquirer.js uses AbortPromptError for an AbortSignal.  The shared adapter
    // race propagates signal.reason, so do not treat it as user cancellation.
    throw error;
  }
}

// ---- Helpers ----

/** Normalize choices to the format Inquirer.js expects. */
function normalizeChoices(
  choices:
    readonly (string | Choice | CheckboxChoice | ExpandChoice | Separator)[],
): Array<
  {
    value: string;
    name?: string;
    description?: string;
    short?: string;
    disabled?: boolean | string;
    checked?: boolean;
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
      ...("checked" in c && c.checked !== undefined
        ? { checked: c.checked }
        : {}),
    };
  });
}
