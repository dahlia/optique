/**
 * Interactive prompt support for Optique via Clack.
 *
 * @module
 * @since 1.2.0
 */
import {
  confirm,
  isCancel,
  multiselect,
  password,
  select,
  text,
} from "@clack/prompts";
import type { FluentParser } from "@optique/core/fluent";
import { message } from "@optique/core/message";
import type { Mode, Parser } from "@optique/core/parser";
import type { ValueParserResult } from "@optique/core/valueparser";
import { createPromptAdapter } from "@optique/prompt";

/**
 * Prompt functions used to render Clack prompts.
 *
 * This interface primarily exists to type-check the module's internal prompt
 * function overrides, especially in tests.
 *
 * @since 1.2.0
 */
interface PromptFunctions {
  readonly text: typeof text;
  readonly password: typeof password;
  readonly confirm: typeof confirm;
  readonly select: typeof select;
  readonly multiselect: typeof multiselect;
  readonly isCancel: typeof isCancel;
}

const promptFunctionsOverrideSymbol = Symbol.for(
  "@optique/clack/prompt-functions",
);

const defaultPromptFunctions: PromptFunctions = {
  text,
  password,
  confirm,
  select,
  multiselect,
  isCancel,
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

function getPromptFunctions(): PromptFunctions {
  const override = getPromptFunctionsOverride(
    Reflect.get(globalThis, promptFunctionsOverrideSymbol),
  );
  return override != null
    ? { ...defaultPromptFunctions, ...override }
    : defaultPromptFunctions;
}

/**
 * A choice item for `select` and `multiselect` prompts.
 *
 * @since 1.2.0
 */
export interface Option {
  /**
   * The value returned when this option is selected.
   */
  readonly value: string;

  /**
   * Display label shown in the prompt. Defaults to `value`.
   */
  readonly label?: string;

  /**
   * Additional hint shown next to the option.
   */
  readonly hint?: string;

  /**
   * If truthy, the option cannot be selected.
   */
  readonly disabled?: boolean | string;
}

/**
 * Configuration for a `text` prompt.
 *
 * @since 1.2.0
 */
export interface TextConfig {
  readonly type: "text";
  /** The question to display to the user. */
  readonly message: string;
  /** Placeholder text shown before input. */
  readonly placeholder?: string;
  /** Initial value pre-filled in the prompt. */
  readonly initialValue?: string;
  /** Validation function called when the user submits. */
  readonly validate?: (
    value: string,
  ) => string | void | Promise<string | void>;
  /** Override the prompt execution. Useful for testing. */
  readonly prompter?: () => Promise<string>;
}

/**
 * Configuration for a `password` prompt.
 *
 * @since 1.2.0
 */
export interface PasswordConfig {
  readonly type: "password";
  /** The question to display to the user. */
  readonly message: string;
  /** Mask character shown while typing. */
  readonly mask?: string;
  /** Validation function called when the user submits. */
  readonly validate?: (
    value: string,
  ) => string | void | Promise<string | void>;
  /** Override the prompt execution. Useful for testing. */
  readonly prompter?: () => Promise<string>;
}

/**
 * Configuration for a `confirm` prompt.
 *
 * @since 1.2.0
 */
export interface ConfirmConfig {
  readonly type: "confirm";
  /** The question to display to the user. */
  readonly message: string;
  /** Initial Boolean value. */
  readonly initialValue?: boolean;
  /** Override the prompt execution. Useful for testing. */
  readonly prompter?: () => Promise<boolean>;
}

/**
 * Configuration for a `number` prompt.
 *
 * Clack does not provide a dedicated number prompt, so *@optique/clack* uses a
 * text prompt and converts the submitted value to a number.
 *
 * @since 1.2.0
 */
export interface NumberPromptConfig {
  readonly type: "number";
  /** The question to display to the user. */
  readonly message: string;
  /** Placeholder text shown before input. */
  readonly placeholder?: string;
  /** Initial numeric value. */
  readonly initialValue?: number;
  /** Minimum accepted value. */
  readonly min?: number;
  /** Maximum accepted value. */
  readonly max?: number;
  /** Additional validation after numeric conversion. */
  readonly validate?: (
    value: number,
  ) => string | void | Promise<string | void>;
  /** Override the prompt execution. Useful for testing. */
  readonly prompter?: () => Promise<number | undefined>;
}

/**
 * Configuration for a `select` prompt.
 *
 * @since 1.2.0
 */
export interface SelectConfig {
  readonly type: "select";
  /** The question to display to the user. */
  readonly message: string;
  /** Available options. */
  readonly options: readonly (string | Option)[];
  /** Initially selected option value. */
  readonly initialValue?: string;
  /** Override the prompt execution. Useful for testing. */
  readonly prompter?: () => Promise<string>;
}

/**
 * Configuration for a `multiselect` prompt.
 *
 * @since 1.2.0
 */
export interface MultiselectConfig {
  readonly type: "multiselect";
  /** The question to display to the user. */
  readonly message: string;
  /** Available options. */
  readonly options: readonly (string | Option)[];
  /** Whether at least one option must be selected. */
  readonly required?: boolean;
  /** Override the prompt execution. Useful for testing. */
  readonly prompter?: () => Promise<readonly string[]>;
}

/**
 * A union of all string-valued prompt configurations.
 *
 * @since 1.2.0
 */
export type StringPromptConfig = TextConfig | PasswordConfig | SelectConfig;

/**
 * Type-safe Clack prompt configuration for a given parser value type `T`.
 *
 * @since 1.2.0
 */
export type PromptConfig<T> = BasePromptConfig<Exclude<T, null | undefined>>;

type BasePromptConfig<T> = T extends boolean ? ConfirmConfig
  : T extends number ? NumberPromptConfig
  : T extends string ? StringPromptConfig
  : T extends readonly string[] ? MultiselectConfig
  : never;

type RuntimePromptConfig =
  | ConfirmConfig
  | NumberPromptConfig
  | StringPromptConfig
  | MultiselectConfig;

type ClackText = (config: {
  readonly message: string;
  readonly placeholder?: string;
  readonly initialValue?: string;
  readonly validate?: (
    value: string,
  ) => string | void | Promise<string | void>;
}) => Promise<unknown>;

type ClackPassword = (config: {
  readonly message: string;
  readonly mask?: string;
  readonly validate?: (
    value: string,
  ) => string | void | Promise<string | void>;
}) => Promise<unknown>;

type ClackConfirm = (config: {
  readonly message: string;
  readonly initialValue?: boolean;
}) => Promise<unknown>;

type ClackSelect = (config: {
  readonly message: string;
  readonly options: readonly Option[];
  readonly initialValue?: string;
}) => Promise<unknown>;

type ClackMultiselect = (config: {
  readonly message: string;
  readonly options: readonly Option[];
  readonly required?: boolean;
}) => Promise<unknown>;

/**
 * Wraps a parser with an interactive Clack prompt fallback.
 *
 * @param parser Inner parser that reads CLI values.
 * @param config Type-safe Clack prompt configuration.
 * @returns A parser with interactive prompt fallback, always in async mode.
 * @throws {Error} If prompt execution fails with an unexpected error or if the
 *                 inner parser throws while parsing or completing.
 * @since 1.2.0
 */
export function prompt<M extends Mode, TValue, TState>(
  parser: Parser<M, TValue, TState>,
  config: PromptConfig<TValue>,
): FluentParser<"async", TValue, TState> {
  const promptWithAdapter = createPromptAdapter<PromptConfig<TValue>>({
    execute: <TPromptValue>(cfg: PromptConfig<TValue>) =>
      executePromptRaw<TPromptValue>(cfg as PromptConfig<TPromptValue>),
    getDefaultValue: getConfigDefault,
  });
  return promptWithAdapter(parser, config);
}

function getConfigDefault(config: unknown): unknown {
  if (
    config != null && typeof config === "object" && "initialValue" in config
  ) {
    return (config as { readonly initialValue?: unknown }).initialValue;
  }
  return undefined;
}

async function executePromptRaw<TValue>(
  config: PromptConfig<TValue>,
): Promise<ValueParserResult<TValue>> {
  const cfg = config as RuntimePromptConfig;
  const type = cfg.type;
  if (!isPromptType(type)) {
    throw new TypeError(`Unsupported prompt type: ${String(type)}.`);
  }
  const prompts = getPromptFunctions();

  if ("prompter" in cfg && cfg.prompter != null) {
    const value = await cfg.prompter();
    if (cfg.type === "number" && value === undefined) {
      return { success: false, error: message`No number provided.` };
    }
    return { success: true, value: value as TValue };
  }

  const result = await executeClackPrompt(cfg, prompts);
  if (prompts.isCancel(result)) {
    return { success: false, error: message`Prompt cancelled.` };
  }
  if (cfg.type === "number") {
    return normalizeNumberResult(result);
  }
  return { success: true, value: result as TValue };
}

function isPromptType(value: unknown): value is RuntimePromptConfig["type"] {
  return value === "text" || value === "password" || value === "confirm" ||
    value === "number" || value === "select" || value === "multiselect";
}

function executeClackPrompt(
  cfg: RuntimePromptConfig,
  prompts: PromptFunctions,
): Promise<unknown> {
  switch (cfg.type) {
    case "text":
      return (prompts.text as ClackText)({
        message: cfg.message,
        ...(cfg.placeholder !== undefined
          ? { placeholder: cfg.placeholder }
          : {}),
        ...(cfg.initialValue !== undefined
          ? { initialValue: cfg.initialValue }
          : {}),
        ...(cfg.validate !== undefined ? { validate: cfg.validate } : {}),
      });

    case "password":
      return (prompts.password as ClackPassword)({
        message: cfg.message,
        ...(cfg.mask !== undefined ? { mask: cfg.mask } : {}),
        ...(cfg.validate !== undefined ? { validate: cfg.validate } : {}),
      });

    case "confirm":
      return (prompts.confirm as ClackConfirm)({
        message: cfg.message,
        ...(cfg.initialValue !== undefined
          ? { initialValue: cfg.initialValue }
          : {}),
      });

    case "number":
      return (prompts.text as ClackText)({
        message: cfg.message,
        ...(cfg.placeholder !== undefined
          ? { placeholder: cfg.placeholder }
          : {}),
        ...(cfg.initialValue !== undefined
          ? { initialValue: String(cfg.initialValue) }
          : {}),
        validate: async (value) => {
          const parsed = parseNumberPromptValue(value);
          if (parsed == null) return "Enter a number.";
          if (cfg.min !== undefined && parsed < cfg.min) {
            return `Must be at least ${cfg.min}.`;
          }
          if (cfg.max !== undefined && parsed > cfg.max) {
            return `Must be at most ${cfg.max}.`;
          }
          return await cfg.validate?.(parsed);
        },
      });

    case "select":
      return (prompts.select as ClackSelect)({
        message: cfg.message,
        options: normalizeOptions(cfg.options),
        ...(cfg.initialValue !== undefined
          ? { initialValue: cfg.initialValue }
          : {}),
      });

    case "multiselect":
      return (prompts.multiselect as ClackMultiselect)({
        message: cfg.message,
        options: normalizeOptions(cfg.options),
        ...(cfg.required !== undefined ? { required: cfg.required } : {}),
      });
  }
}

function normalizeNumberResult<TValue>(
  result: unknown,
): ValueParserResult<TValue> {
  const parsed = typeof result === "number"
    ? result
    : typeof result === "string"
    ? parseNumberPromptValue(result)
    : null;
  if (parsed == null) {
    return { success: false, error: message`No number provided.` };
  }
  return { success: true, value: parsed as TValue };
}

function parseNumberPromptValue(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeOptions(
  options: readonly (string | Option)[],
): readonly Option[] {
  return options.map((option) => {
    if (typeof option === "string") {
      return { value: option, label: option };
    }
    return {
      value: option.value,
      ...(option.label !== undefined ? { label: option.label } : {}),
      ...(option.hint !== undefined ? { hint: option.hint } : {}),
      ...(option.disabled !== undefined ? { disabled: option.disabled } : {}),
    };
  });
}
