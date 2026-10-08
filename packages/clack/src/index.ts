/**
 * Interactive prompt support for Optique via Clack.
 *
 * @module
 * @since 1.2.0
 */
import {
  confirm,
  isCancel,
  log,
  multiselect,
  password,
  select,
  spinner,
  text,
} from "@clack/prompts";
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
  type PromptPendingContext,
} from "@optique/prompt";

export { derivePromptConfig, isDerivedPromptConfig } from "@optique/prompt";
export type {
  DerivedPromptConfig,
  DerivePromptConfigContext,
  DerivePromptConfigNoDepsContext,
  DerivePromptConfigNoDepsOptions,
  DerivePromptConfigOptions,
  DerivePromptConfigsContext,
  DerivePromptConfigsOptions,
  PromptExecutionContext,
  PromptOptions,
  PromptValidator,
} from "@optique/prompt";

/**
 * Prompt functions used to render Clack prompts.
 *
 * This interface primarily exists to type-check the module's internal prompt
 * function overrides, especially in tests.
 *
 * @since 1.2.0
 */
interface PromptFunctions {
  readonly spinner: typeof spinner;
  readonly text: typeof text;
  readonly password: typeof password;
  readonly confirm: typeof confirm;
  readonly select: typeof select;
  readonly multiselect: typeof multiselect;
  readonly isCancel: typeof isCancel;
  readonly logError: (value: string) => void;
}

const promptFunctionsOverrideSymbol = Symbol.for(
  "@optique/clack/prompt-functions",
);

const defaultPromptFunctions: PromptFunctions = {
  spinner,
  text,
  password,
  confirm,
  select,
  multiselect,
  isCancel,
  logError: (value) => log.error(value),
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
  /**
   * Overrides prompt execution. Useful for testing.
   * @since 1.3.0 Added the execution context parameter.
   */
  readonly prompter?: (context: PromptExecutionContext) => Promise<string>;
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
  /**
   * Overrides prompt execution. Useful for testing.
   * @since 1.3.0 Added the execution context parameter.
   */
  readonly prompter?: (context: PromptExecutionContext) => Promise<string>;
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
  /**
   * Overrides prompt execution. Useful for testing.
   * @since 1.3.0 Added the execution context parameter.
   */
  readonly prompter?: (context: PromptExecutionContext) => Promise<boolean>;
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
  /**
   * Overrides prompt execution. Useful for testing.
   * @since 1.3.0 Added the execution context parameter.
   */
  readonly prompter?: (
    context: PromptExecutionContext,
  ) => Promise<number | undefined>;
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
  /**
   * Overrides prompt execution. Useful for testing.
   * @since 1.3.0 Added the execution context parameter.
   */
  readonly prompter?: (context: PromptExecutionContext) => Promise<string>;
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
  /**
   * Overrides prompt execution. Useful for testing.
   * @since 1.3.0 Added the execution context parameter.
   */
  readonly prompter?: (
    context: PromptExecutionContext,
  ) => Promise<readonly string[]>;
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
 * @since 1.3.0 Added conditional prompt skipping.
 */
export type PromptConfig<T> =
  & BasePromptConfig<Exclude<T, null | undefined>>
  & PromptCondition<T>;

type BasePromptConfig<T> = T extends boolean ? ConfirmConfig
  : T extends number ? NumberPromptConfig
  : T extends string ? StringPromptConfig
  : T extends readonly string[] ? MultiselectConfig
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
  | MultiselectConfig;

type ClackText = (config: {
  readonly message: string;
  readonly signal?: AbortSignal;
  readonly placeholder?: string;
  readonly initialValue?: string;
  readonly validate?: (
    value: string,
  ) => string | void | Promise<string | void>;
}) => Promise<unknown>;

type ClackPassword = (config: {
  readonly message: string;
  readonly signal?: AbortSignal;
  readonly mask?: string;
  readonly validate?: (
    value: string,
  ) => string | void | Promise<string | void>;
}) => Promise<unknown>;

type ClackConfirm = (config: {
  readonly message: string;
  readonly signal?: AbortSignal;
  readonly initialValue?: boolean;
}) => Promise<unknown>;

type ClackSelect = (config: {
  readonly message: string;
  readonly signal?: AbortSignal;
  readonly options: readonly Option[];
  readonly initialValue?: string;
}) => Promise<unknown>;

type ClackMultiselect = (config: {
  readonly message: string;
  readonly signal?: AbortSignal;
  readonly options: readonly Option[];
  readonly required?: boolean;
}) => Promise<unknown>;

/**
 * Shared prompt options and Clack's derived configuration pending indicator.
 *
 * @typeParam TValue Value produced by the wrapped parser.
 * @since 1.4.0
 */
export interface ClackPromptOptions<TValue> extends PromptOptions<TValue> {
  /**
   * Shows a spinner with this message while a derived configuration resolves.
   * Omit it for silent resolution. An empty string also enables the spinner.
   * Static configurations ignore this option. Explicit opt-in also shows the
   * indicator when the resolved configuration has a custom `prompter`.
   * The final line keeps this message with a success, error, or cancel symbol.
   */
  readonly pendingMessage?: string;
}

/**
 * Wraps a parser with an interactive Clack prompt fallback.
 *
 * @param parser Inner parser that reads CLI values.
 * @param config Type-safe Clack prompt configuration, or a configuration
 *               derived from dependency sources via `derivePromptConfig()`.
 * @param options Shared validation, retry, cancellation, and optional pending
 *                indicator options.
 * @returns A parser with interactive prompt fallback, always in async mode.
 * @throws {RangeError} If `maxAttempts` is not a positive integer.
 * @throws {DOMException} With name `AbortError` when an OS-delivered SIGINT or
 *                       SIGTERM cancels the pending spinner. Interactive
 *                       Ctrl+C follows Clack's process-exit behavior.
 * @throws {Error} If prompt execution fails with an unexpected error or if the
 *                 inner parser throws while parsing or completing.
 * @since 1.2.0
 * @since 1.3.0 Added shared options and the prompter context.
 * @since 1.4.0 Added the optional pending indicator.
 */
export function prompt<M extends Mode, TValue, TState>(
  parser: Parser<M, TValue, TState>,
  config:
    | PromptConfig<TValue>
    | DerivedPromptConfig<RuntimePromptConfig, NoInfer<TValue>>,
  options?: ClackPromptOptions<NoInfer<TValue>>,
): FluentParser<"async", TValue, TState> {
  const pendingMessage = options?.pendingMessage;
  const promptWithAdapter = createPromptAdapter<RuntimePromptConfig>({
    execute: executePromptRaw,
    getDefaultValue: getConfigDefault,
    ...(pendingMessage == null ? {} : {
      async whilePending<T>(
        work: () => Promise<T>,
        { signal }: PromptPendingContext,
      ): Promise<T> {
        if (signal?.aborted) return work();
        // Own abort cleanup rather than forwarding the signal: the parse can
        // stop waiting before a resolver that ignores cancellation settles.
        let finished = false;
        let rejectCancellation!: (reason: unknown) => void;
        const cancelled = new Promise<never>((_resolve, reject) => {
          rejectCancellation = reject;
        });
        const indicator = getPromptFunctions().spinner({
          cancelMessage: pendingMessage,
          onCancel() {
            if (finished) return;
            // Clack has already stopped its timer and restored the terminal.
            finished = true;
            signal?.removeEventListener("abort", onAbort);
            rejectCancellation(
              new DOMException("Prompt cancelled.", "AbortError"),
            );
          },
        });
        const finish = (outcome: "stop" | "error" | "cancel") => {
          if (finished) return;
          finished = true;
          signal?.removeEventListener("abort", onAbort);
          indicator[outcome](pendingMessage);
        };
        const onAbort = () => finish("cancel");
        try {
          indicator.start(pendingMessage);
          signal?.addEventListener("abort", onAbort, { once: true });
          // Native SIGINT/SIGTERM cancellation must stop waiting even when
          // the resolver ignores cancellation. Race consumes late settlement.
          const result = await Promise.race([work(), cancelled]);
          finish("stop");
          return result;
        } catch (error) {
          finish(signal?.aborted ? "cancel" : "error");
          throw error;
        } finally {
          signal?.removeEventListener("abort", onAbort);
        }
      },
    }),
  });
  return promptWithAdapter(parser, config, options);
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
  config: RuntimePromptConfig,
  context: PromptExecutionContext,
): Promise<ValueParserResult<TValue>> {
  const cfg = config;
  const type = cfg.type;
  if (!isPromptType(type)) {
    throw new TypeError(`Unsupported prompt type: ${String(type)}.`);
  }
  const prompts = getPromptFunctions();

  let result: unknown;
  if ("prompter" in cfg && cfg.prompter != null) {
    result = await cfg.prompter(context);
  } else {
    if (context.previousValidationMessage !== undefined) {
      prompts.logError(formatMessage(context.previousValidationMessage));
    }
    result = await executeClackPromptWithSignal(cfg, prompts, context.signal);
  }

  if (prompts.isCancel(result)) {
    if (context.signal?.aborted === true) throw context.signal.reason;
    return { success: false, error: message`Prompt cancelled.` };
  }
  if (cfg.type === "number") {
    return normalizeNumberResult(result);
  }
  if (cfg.type === "multiselect") {
    return normalizeMultiselectResult(result, cfg);
  }
  return { success: true, value: result as TValue };
}

async function executeClackPromptWithSignal(
  cfg: RuntimePromptConfig,
  prompts: PromptFunctions,
  signal: AbortSignal | undefined,
): Promise<unknown> {
  if (signal === undefined) return await executeClackPrompt(cfg, prompts);

  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  if (signal.aborted) {
    abort();
  } else {
    signal.addEventListener("abort", abort, { once: true });
  }
  try {
    return await executeClackPrompt(cfg, prompts, controller.signal);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function isPromptType(value: unknown): value is RuntimePromptConfig["type"] {
  return value === "text" || value === "password" || value === "confirm" ||
    value === "number" || value === "select" || value === "multiselect";
}

function executeClackPrompt(
  cfg: RuntimePromptConfig,
  prompts: PromptFunctions,
  signal?: AbortSignal,
): Promise<unknown> {
  switch (cfg.type) {
    case "text":
      return (prompts.text as ClackText)({
        message: cfg.message,
        ...(signal === undefined ? {} : { signal }),
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
        ...(signal === undefined ? {} : { signal }),
        ...(cfg.mask !== undefined ? { mask: cfg.mask } : {}),
        ...(cfg.validate !== undefined ? { validate: cfg.validate } : {}),
      });

    case "confirm":
      return (prompts.confirm as ClackConfirm)({
        message: cfg.message,
        ...(signal === undefined ? {} : { signal }),
        ...(cfg.initialValue !== undefined
          ? { initialValue: cfg.initialValue }
          : {}),
      });

    case "number":
      return (prompts.text as ClackText)({
        message: cfg.message,
        ...(signal === undefined ? {} : { signal }),
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
        ...(signal === undefined ? {} : { signal }),
        options: normalizeOptions(cfg.options),
        ...(cfg.initialValue !== undefined
          ? { initialValue: cfg.initialValue }
          : {}),
      });

    case "multiselect":
      return (prompts.multiselect as ClackMultiselect)({
        message: cfg.message,
        ...(signal === undefined ? {} : { signal }),
        options: normalizeOptions(cfg.options),
        ...(cfg.required !== undefined ? { required: cfg.required } : {}),
      });
  }
}

function normalizeNumberResult<TValue>(
  result: unknown,
): ValueParserResult<TValue> {
  const parsed = typeof result === "number" && Number.isFinite(result)
    ? result
    : typeof result === "string"
    ? parseNumberPromptValue(result)
    : null;
  if (parsed == null) {
    return { success: false, error: message`No number provided.` };
  }
  return { success: true, value: parsed as TValue };
}

function normalizeMultiselectResult<TValue>(
  result: unknown,
  config: MultiselectConfig,
): ValueParserResult<TValue> {
  const values = Array.isArray(result) ? result : [];
  if (config.required === true && values.length < 1) {
    return { success: false, error: message`No option selected.` };
  }
  return { success: true, value: values as TValue };
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
