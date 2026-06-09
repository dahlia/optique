import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { getAnnotations } from "@optique/core/annotations";
import type { Annotations, SourceContext } from "@optique/core/context";
import {
  defineTraits,
  delegateSuggestNodes,
  dispatchByMode,
  getTraits,
  inheritAnnotations,
  injectAnnotations,
  isInjectedAnnotationState,
  mapModeValue,
  mapSourceMetadata,
  type ParserSourceMetadata,
  wrapForMode,
} from "@optique/core/extension";
import { envVar, type Message, message, valueSet } from "@optique/core/message";
import type {
  ExecutionContext,
  Mode,
  ModeValue,
  Parser,
  ParserResult,
  Result,
} from "@optique/core/parser";
import {
  ensureNonEmptyString,
  isValueParser,
  type NonEmptyString,
  type ValueParser,
  type ValueParserResult,
} from "@optique/core/valueparser";

/**
 * Function type for reading environment variable values.
 *
 * @since 1.0.0
 */
export type EnvSource = (key: string) => string | undefined;

/**
 * Function type for command substitution in `.env` file values.
 *
 * @param command Command text captured from `$(...)` or backtick substitution.
 * @returns Replacement text, or `undefined` to substitute an empty string.
 * @since 1.1.0
 */
export type EnvFileSubstitute = (command: string) => string | undefined;

/**
 * Path option for `.env` files loaded by {@link createEnvContext}.
 *
 * @since 1.1.0
 */
export type EnvFilePaths = boolean | string | readonly string[];

/**
 * Options for loading `.env` files.
 *
 * @since 1.1.0
 */
export interface EnvFileOptions {
  /**
   * Path or paths to `.env` files.  When `true` or omitted, loads `.env`
   * from the current working directory.  Missing files are skipped.
   */
  readonly paths?: EnvFilePaths;

  /**
   * Optional command substitution hook for `$(...)` and backtick forms.
   * Optique never executes commands by itself.
   */
  readonly substitute?: EnvFileSubstitute;
}

interface EnvSourceData {
  readonly prefix: string;
  readonly source: EnvSource;
}

/**
 * Context for environment-variable-based fallback values.
 *
 * @since 1.0.0
 */
export interface EnvContext extends SourceContext {
  /**
   * Prefix added to all bound keys.
   */
  readonly prefix: string;

  /**
   * Environment value source for this context.
   */
  readonly source: EnvSource;
}

/**
 * Options for creating an environment context.
 *
 * @since 1.0.0
 */
export interface EnvContextOptions {
  /**
   * Optional prefix added to all environment keys.
   *
   * @default ""
   */
  readonly prefix?: string;

  /**
   * Custom environment source function.
   *
   * @default Runtime-specific source (`Deno.env.get` or `process.env`)
   */
  readonly source?: EnvSource;

  /**
   * Path(s) to `.env` files to load as an internal fallback layer.
   *
   * When `true`, searches for `.env` in the current working directory.
   * When a string or array of strings, loads those explicit files.
   * Files are loaded in order; later files override earlier files.
   *
   * Values loaded from `.env` files do not mutate `process.env` or
   * `Deno.env`, and the real environment source remains higher priority.
   *
   * @default undefined
   * @since 1.1.0
   */
  readonly envFile?: EnvFilePaths | EnvFileOptions;
}

function getTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function defaultEnvSource(key: string): string | undefined {
  const denoGlobal = (globalThis as {
    readonly Deno?: { readonly env?: { readonly get?: EnvSource } };
  }).Deno;
  if (typeof denoGlobal?.env?.get === "function") {
    return denoGlobal.env.get(key);
  }
  const processGlobal = (globalThis as {
    readonly process?: { readonly env?: Record<string, string | undefined> };
  }).process;
  return processGlobal?.env?.[key];
}

function isErrnoException(error: unknown): error is { readonly code: string } {
  return error != null &&
    typeof error === "object" &&
    "code" in error &&
    typeof (error as { readonly code?: unknown }).code === "string";
}

function normalizeEnvFilePaths(paths: EnvFilePaths): readonly string[] {
  if (paths === false) return [];
  if (paths === true) return [".env"];
  if (typeof paths === "string") return [paths];
  if (Array.isArray(paths)) {
    for (const path of paths) {
      if (typeof path !== "string") {
        throw new TypeError(
          `Expected envFile paths to be strings, but got: ${
            getTypeName(path)
          }.`,
        );
      }
    }
    return paths;
  }
  throw new TypeError(
    `Expected envFile.paths to be a boolean, string, array, or undefined, but got: ${
      getTypeName(paths)
    }.`,
  );
}

interface NormalizedEnvFileOptions {
  readonly paths: readonly string[];
  readonly substitute?: EnvFileSubstitute;
}

function normalizeEnvFileOptions(
  envFile: EnvContextOptions["envFile"],
): NormalizedEnvFileOptions {
  if (envFile === undefined || envFile === false) {
    return { paths: [] };
  }
  if (
    envFile === true ||
    typeof envFile === "string" ||
    Array.isArray(envFile)
  ) {
    return { paths: normalizeEnvFilePaths(envFile) };
  }
  if (envFile == null || typeof envFile !== "object") {
    throw new TypeError(
      `Expected envFile to be a boolean, string, array, or object, but got: ${
        getTypeName(envFile)
      }.`,
    );
  }
  const options = envFile as EnvFileOptions;
  const rawSubstitute = options.substitute;
  if (rawSubstitute !== undefined && typeof rawSubstitute !== "function") {
    throw new TypeError(
      `Expected envFile.substitute to be a function or undefined, but got: ${
        getTypeName(rawSubstitute)
      }.`,
    );
  }
  return {
    paths: normalizeEnvFilePaths(options.paths ?? true),
    ...(rawSubstitute === undefined ? {} : { substitute: rawSubstitute }),
  };
}

function isEnvNameStart(character: string): boolean {
  return /[A-Za-z_]/u.test(character);
}

function isEnvNamePart(character: string): boolean {
  return /[A-Za-z0-9_]/u.test(character);
}

function getLineNumber(input: string, offset: number): number {
  let line = 1;
  for (let index = 0; index < offset; index++) {
    if (input[index] === "\n") {
      line++;
    } else if (input[index] === "\r") {
      line++;
      if (input[index + 1] === "\n") index++;
    }
  }
  return line;
}

function syntaxError(
  path: string,
  line: number,
  messageText: string,
): SyntaxError {
  return new SyntaxError(
    `Invalid .env syntax in ${path} at line ${line}: ${messageText}.`,
  );
}

function skipLine(input: string, index: number): number {
  while (
    index < input.length &&
    input[index] !== "\r" &&
    input[index] !== "\n"
  ) {
    index++;
  }
  return index;
}

function readNewline(input: string, index: number): number {
  if (input[index] === "\r" && input[index + 1] === "\n") return index + 2;
  if (input[index] === "\r") return index + 1;
  if (input[index] === "\n") return index + 1;
  return index;
}

function skipHorizontalWhitespace(input: string, index: number): number {
  while (input[index] === " " || input[index] === "\t") index++;
  return index;
}

function expandEnvValue(
  rawValue: string,
  lookup: EnvSource,
  substitute: EnvFileSubstitute | undefined,
  options: {
    readonly path: string;
    readonly startLine: number;
    readonly interpretEscapes: boolean;
    readonly allowSubstitution: boolean;
  },
): string {
  let output = "";
  for (let index = 0; index < rawValue.length; index++) {
    const character = rawValue[index];
    if (options.interpretEscapes && character === "\\") {
      const next = rawValue[++index];
      if (next === undefined) {
        output += "\\";
      } else if (next === "n") {
        output += "\n";
      } else if (next === "r") {
        output += "\r";
      } else if (next === "t") {
        output += "\t";
      } else {
        output += next;
      }
      continue;
    }
    if (!options.allowSubstitution) {
      output += character;
      continue;
    }
    if (character === "`") {
      const end = rawValue.indexOf("`", index + 1);
      if (end < 0) {
        throw syntaxError(
          options.path,
          options.startLine,
          "unterminated command substitution",
        );
      }
      const command = rawValue.slice(index + 1, end);
      output += substitute?.(command) ?? "";
      index = end;
      continue;
    }
    if (character !== "$") {
      output += character;
      continue;
    }
    if (rawValue[index + 1] === "(") {
      const end = rawValue.indexOf(")", index + 2);
      if (end < 0) {
        throw syntaxError(
          options.path,
          options.startLine,
          "unterminated command substitution",
        );
      }
      const command = rawValue.slice(index + 2, end);
      output += substitute?.(command) ?? "";
      index = end;
      continue;
    }
    if (rawValue[index + 1] === "{") {
      const end = rawValue.indexOf("}", index + 2);
      if (end < 0) {
        throw syntaxError(
          options.path,
          options.startLine,
          "unterminated variable expansion",
        );
      }
      const key = rawValue.slice(index + 2, end);
      output += lookup(key) ?? "";
      index = end;
      continue;
    }
    const nameStart = rawValue[index + 1];
    if (nameStart === undefined || !isEnvNameStart(nameStart)) {
      output += character;
      continue;
    }
    let end = index + 2;
    while (end < rawValue.length && isEnvNamePart(rawValue[end])) end++;
    const key = rawValue.slice(index + 1, end);
    output += lookup(key) ?? "";
    index = end - 1;
  }
  return output;
}

function parseQuotedEnvValue(
  input: string,
  index: number,
  quote: "'" | '"',
  path: string,
  line: number,
  lookup: EnvSource,
  substitute: EnvFileSubstitute | undefined,
): { readonly value: string; readonly nextIndex: number } {
  const valueStart = index + 1;
  let cursor = valueStart;
  while (cursor < input.length) {
    const character = input[cursor];
    if (character === "\\" && quote === '"') {
      cursor += 2;
      continue;
    }
    if (character === quote) {
      const rawValue = input.slice(valueStart, cursor);
      const nextIndex = cursor + 1;
      return {
        value: quote === "'"
          ? rawValue
          : expandEnvValue(rawValue, lookup, substitute, {
            path,
            startLine: line,
            interpretEscapes: true,
            allowSubstitution: true,
          }),
        nextIndex,
      };
    }
    cursor++;
  }
  throw syntaxError(path, line, "unterminated quoted value");
}

function parseUnquotedEnvValue(
  input: string,
  index: number,
  path: string,
  line: number,
  lookup: EnvSource,
  substitute: EnvFileSubstitute | undefined,
): { readonly value: string; readonly nextIndex: number } {
  let cursor = index;
  while (
    cursor < input.length &&
    input[cursor] !== "\r" &&
    input[cursor] !== "\n"
  ) {
    if (
      input[cursor] === "#" &&
      (cursor === index || /\s/u.test(input[cursor - 1]))
    ) {
      break;
    }
    cursor++;
  }
  const rawValue = input.slice(index, cursor).trimEnd();
  return {
    value: expandEnvValue(rawValue, lookup, substitute, {
      path,
      startLine: line,
      interpretEscapes: false,
      allowSubstitution: true,
    }),
    nextIndex: cursor,
  };
}

function parseEnvFile(
  input: string,
  path: string,
  lookup: EnvSource,
  substitute: EnvFileSubstitute | undefined,
  outerValues: ReadonlyMap<string, string> = new Map(),
): Map<string, string> {
  const values = new Map<string, string>();
  let index = input.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (index < input.length) {
    const line = getLineNumber(input, index);
    index = skipHorizontalWhitespace(input, index);
    if (index >= input.length) break;
    if (input[index] === "\r" || input[index] === "\n") {
      index = readNewline(input, index);
      continue;
    }
    if (input[index] === "#") {
      index = readNewline(input, skipLine(input, index));
      continue;
    }
    if (
      input.startsWith("export", index) &&
      /\s/u.test(input[index + "export".length] ?? "")
    ) {
      index = skipHorizontalWhitespace(input, index + "export".length);
    }
    const keyStart = index;
    if (!isEnvNameStart(input[index] ?? "")) {
      throw syntaxError(path, line, "expected KEY=VALUE");
    }
    index++;
    while (index < input.length && isEnvNamePart(input[index])) index++;
    const key = input.slice(keyStart, index);
    index = skipHorizontalWhitespace(input, index);
    if (input[index] !== "=") {
      throw syntaxError(path, line, "expected KEY=VALUE");
    }
    index = skipHorizontalWhitespace(input, index + 1);
    const lineLookup: EnvSource = (lookupKey) =>
      lookup(lookupKey) ??
        values.get(lookupKey) ??
        outerValues.get(lookupKey);
    const parsed = input[index] === "'" || input[index] === '"'
      ? parseQuotedEnvValue(
        input,
        index,
        input[index] as "'" | '"',
        path,
        line,
        lineLookup,
        substitute,
      )
      : parseUnquotedEnvValue(input, index, path, line, lineLookup, substitute);
    values.set(key, parsed.value);
    index = skipHorizontalWhitespace(input, parsed.nextIndex);
    if (input[index] === "#") {
      index = skipLine(input, index);
    } else if (
      index < input.length &&
      input[index] !== "\r" &&
      input[index] !== "\n"
    ) {
      throw syntaxError(path, line, "unexpected content after value");
    }
    index = readNewline(input, index);
  }
  return values;
}

function loadEnvFileValues(
  options: NormalizedEnvFileOptions,
  source: EnvSource,
): ReadonlyMap<string, string> {
  const values = new Map<string, string>();
  for (const path of options.paths) {
    const absolutePath = resolvePath(path);
    try {
      const contents = readFileSync(absolutePath, "utf8");
      const parsedValues = parseEnvFile(
        contents,
        absolutePath,
        source,
        options.substitute,
        values,
      );
      for (const [key, value] of parsedValues) values.set(key, value);
    } catch (error) {
      if (isErrnoException(error) && error.code === "ENOENT") continue;
      throw error;
    }
  }
  return values;
}

/**
 * Creates an environment context for use with Optique runners.
 *
 * Pass the returned context to `run()`'s `contexts` option so that
 * `bindEnv()` can read environment variables during parsing:
 *
 * ```typescript
 * const envContext = createEnvContext({ prefix: "MYAPP_" });
 * run(parser, { contexts: [envContext] });
 * ```
 *
 * When calling `context.getAnnotations()` manually, pass the returned
 * annotations to low-level APIs such as `parse()`, `parseAsync()`,
 * `parser.complete()`, `suggest()`, or `getDocPage()`. Since environment
 * contexts are single-pass, `getAnnotations()` can still be called without
 * a phase request. Calling it by itself does not affect later parses.
 *
 * @param options Environment context options.
 * @returns A context that provides environment source annotations.
 * @throws {TypeError} If `prefix` is not a string.
 * @throws {TypeError} If `source` is not a function.
 * @throws {TypeError} If `envFile` has an invalid shape.
 * @throws {SyntaxError} If an `.env` file contains invalid syntax.
 * @throws {Error} If an `.env` file cannot be read for a reason other than
 * a missing file.
 * @since 1.0.0
 */
export function createEnvContext(options: EnvContextOptions = {}): EnvContext {
  const contextId = Symbol(`@optique/env context:${Math.random()}`);
  const rawSource = options.source;
  if (rawSource !== undefined && typeof rawSource !== "function") {
    throw new TypeError(
      `Expected source to be a function, but got: ${getTypeName(rawSource)}.`,
    );
  }
  const baseSource = rawSource ?? defaultEnvSource;
  const rawPrefix = options.prefix;
  if (rawPrefix !== undefined && typeof rawPrefix !== "string") {
    throw new TypeError(
      `Expected prefix to be a string, but got: ${getTypeName(rawPrefix)}.`,
    );
  }
  const prefix = rawPrefix ?? "";
  const envFileOptions = normalizeEnvFileOptions(options.envFile);
  const envFileValues = loadEnvFileValues(envFileOptions, baseSource);
  const source: EnvSource = (key) => {
    const value = baseSource(key) as unknown;
    return value === undefined ? envFileValues.get(key) : value as
      | string
      | undefined;
  };

  return {
    id: contextId,
    prefix,
    source,
    phase: "single-pass",

    getAnnotations(): Annotations {
      const sourceData: EnvSourceData = { prefix, source };
      // Use the per-instance contextId as the annotation key so that
      // multiple EnvContext instances can coexist without overwriting each
      // other during mergeAnnotations().  See:
      // https://github.com/dahlia/optique/issues/136
      return { [contextId]: sourceData };
    },

    [Symbol.dispose]() {
      // No-op. Env annotations are detached parse-time snapshots.
    },
  };
}

/**
 * Options for binding a parser to environment values.
 *
 * @template TValue The parser value type.
 * @since 1.0.0
 */
export interface BindEnvOptions<M extends Mode, TValue> {
  /**
   * The environment context to read from.
   */
  readonly context: EnvContext;

  /**
   * Environment variable key without prefix.
   */
  readonly key: string;

  /**
   * Value parser used to parse the environment variable string value.
   *
   * In sync mode, the value parser must also be synchronous.
   * In async mode, either sync or async value parsers are accepted,
   * since the async pipeline can await sync results as well.
   */
  readonly parser: ValueParser<M extends "sync" ? "sync" : Mode, TValue>;

  /**
   * Default value used when neither CLI nor environment provides a value.
   */
  readonly default?: TValue;
}

/**
 * Binds a parser to environment variables with fallback behavior.
 *
 * Priority order:
 *
 *  1. CLI argument value
 *  2. Environment variable value
 *  3. Default value
 *  4. Error
 *
 * > **Important:** `bindEnv()` only reads environment variables when its
 * > `EnvContext` is registered with the runner via the `contexts` option:
 * >
 * > ```typescript
 * > run(parser, { contexts: [envContext] });
 * > ```
 * >
 * > Omitting `contexts` causes `bindEnv()` to skip the env lookup and fall
 * > through to the default or an error.  When other contexts are registered
 * > but this env context is not, the error explicitly names the `contexts`
 * > option to aid diagnosis.
 *
 * @param parser Parser that reads CLI values.
 * @param options Environment binding options.
 * @returns A parser with environment fallback behavior.
 * @throws {TypeError} If `key` is not a string or `parser` is not a valid
 *                    {@link ValueParser}.
 * @throws {Error} If the inner parser throws while parsing or completing a
 *                 value, if the environment source throws while reading a
 *                 variable, if the environment value parser throws while
 *                 parsing the environment variable value, or if the inner
 *                 parser's {@link Parser.validateValue} hook throws while
 *                 re-validating a fallback value (environment variable value
 *                 or configured `default`)—the hook can run even when no
 *                 CLI tokens are parsed (see issue #414).
 * @since 1.0.0
 */
export function bindEnv<
  M extends Mode,
  TValue,
  TState,
>(
  parser: Parser<M, TValue, TState>,
  options: BindEnvOptions<M, TValue>,
): Parser<M, TValue, TState> {
  if (typeof options.key !== "string") {
    throw new TypeError(
      `Expected key to be a string, but got: ${
        options.key === null
          ? "null"
          : Array.isArray(options.key)
          ? "array"
          : typeof options.key
      }.`,
    );
  }

  if (!isValueParser(options.parser)) {
    throw new TypeError(
      `Expected parser to be a ValueParser, but got: ${
        options.parser === null
          ? "null"
          : Array.isArray(options.parser)
          ? "array"
          : typeof options.parser
      }.`,
    );
  }

  const envBindStateKey: unique symbol = Symbol("@optique/env/bindState");

  type EnvBindState =
    & {
      readonly [K in typeof envBindStateKey]: true;
    }
    & {
      readonly hasCliValue: boolean;
      readonly cliState?: TState;
    };

  function isEnvBindState(value: unknown): value is EnvBindState {
    return value != null &&
      typeof value === "object" &&
      envBindStateKey in value;
  }

  const deferPromptUntilConfigResolves = parser.shouldDeferCompletion;

  // bindEnv() resolves fallbacks through env annotations at completion time,
  // not through synthetic dependency-wrapper states.  Keeping the bound
  // parser isolated from those legacy markers prevents optional()/withDefault()
  // wrappers from invoking it without the annotation context it requires.

  function hasEnvFallback(state: TState): boolean {
    if (options.default !== undefined) return true;
    const annotations = getAnnotations(state);
    const sourceData = annotations?.[options.context.id] as
      | EnvSourceData
      | undefined;
    if (sourceData == null) return false;
    return sourceData.source(`${sourceData.prefix}${options.key}`) !==
      undefined;
  }

  function getInnerState(state: TState): TState {
    if (!isEnvBindState(state)) return state;
    return state.cliState === undefined
      ? inheritAnnotations(state, parser.initialState)
      : state.cliState as TState;
  }

  const boundParser: Parser<M, TValue, TState> = {
    mode: parser.mode,
    $valueType: parser.$valueType,
    $stateType: parser.$stateType,
    priority: parser.priority,
    usage: options.default !== undefined
      ? [{ type: "optional", terms: parser.usage }]
      : parser.usage,
    leadingNames: parser.leadingNames,
    acceptingAnyToken: parser.acceptingAnyToken,
    initialState: parser.initialState,
    canSkip(state: TState, exec?: ExecutionContext) {
      if (isEnvBindState(state)) {
        if (state.hasCliValue) {
          return parser.canSkip?.(state.cliState!, exec) === true;
        }
        if (hasEnvFallback(state)) return true;
        return parser.canSkip?.(getInnerState(state), exec) === true;
      }
      if (hasEnvFallback(state)) return true;
      return parser.canSkip?.(state, exec) === true;
    },
    getSuggestRuntimeNodes(state: TState, path: readonly PropertyKey[]) {
      const innerState = getInnerState(state);
      return delegateSuggestNodes(
        parser,
        boundParser,
        state,
        path,
        innerState,
      );
    },

    parse: (context) => {
      const annotations = getAnnotations(context.state);

      // Unwrap state from a previous parse() call.  After a successful
      // parse, object() stores the wrapped { hasCliValue, cliState }
      // state and passes it back on the next iteration.  The inner
      // parser expects its own native state, so we unwrap cliState
      // before delegating.
      const innerState = isEnvBindState(context.state)
        ? (context.state.hasCliValue
          ? (context.state.cliState as TState)
          : parser.initialState)
        : context.state;
      const innerContext = innerState !== context.state
        ? { ...context, state: innerState }
        : context;

      const processResult = (
        result: ParserResult<TState>,
      ): ParserResult<TState> => {
        if (result.success) {
          // Only mark hasCliValue when the inner parser actually consumed
          // input tokens.  Wrappers like bindConfig or withDefault may
          // return success with consumed: [] when the CLI option is
          // absent; treating those as "CLI provided" would skip the env
          // fallback and break composition.
          const cliConsumed = result.consumed.length > 0;
          const nextState = injectAnnotations({
            [envBindStateKey]: true as const,
            hasCliValue: cliConsumed,
            cliState: result.next.state,
          }, annotations);
          return {
            success: true,
            ...(result.provisional ? { provisional: true as const } : {}),
            next: { ...result.next, state: nextState as TState },
            consumed: result.consumed,
          };
        }

        // If the inner parser consumed tokens before failing, propagate
        // the failure so that specific error messages (e.g., "requires a
        // value") are preserved instead of being replaced by a generic
        // "Unexpected option or argument" message.
        if (result.consumed > 0) {
          return result;
        }

        const nextState = injectAnnotations({
          [envBindStateKey]: true as const,
          hasCliValue: false,
        }, annotations);
        return {
          success: true,
          next: { ...innerContext, state: nextState as TState },
          consumed: [],
        };
      };

      return mapModeValue(
        parser.mode,
        parser.parse(innerContext),
        processResult,
      );
    },

    complete: (state, exec?) => {
      if (isEnvBindState(state) && state.hasCliValue) {
        return parser.complete(state.cliState!, exec);
      }

      return getEnvOrDefault(
        state,
        options,
        parser.mode,
        parser,
        isEnvBindState(state)
          ? state.cliState
          : isInjectedAnnotationState(state)
          ? undefined
          : state,
        exec,
      );
    },

    suggest: parser.suggest,
    ...(typeof deferPromptUntilConfigResolves === "function"
      ? {
        shouldDeferCompletion: (
          state: TState,
          exec?: ExecutionContext,
        ) => deferPromptUntilConfigResolves.call(parser, state, exec),
      }
      : {}),
    getDocFragments(state, upperDefaultValue?) {
      const defaultValue = upperDefaultValue ?? options.default;
      return parser.getDocFragments(state, defaultValue);
    },
  };
  defineTraits(boundParser, {
    inheritsAnnotations: true,
    completesFromSource: true,
  });
  // Lazily forward placeholder from inner parser to avoid eagerly
  // evaluating derived value parser factories at construction time.
  if ("placeholder" in parser) {
    Object.defineProperty(boundParser, "placeholder", {
      get() {
        return parser.placeholder;
      },
      configurable: true,
      enumerable: false,
    });
  }
  // Forward value normalization from inner parser so that withDefault()
  // can normalize defaults through bindEnv() wrappers.
  if (typeof parser.normalizeValue === "function") {
    Object.defineProperty(boundParser, "normalizeValue", {
      value: parser.normalizeValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  // Forward value validation from inner parser (see issue #414) so
  // that outer bind wrappers (e.g., bindEnv(bindConfig(...))) can
  // revalidate fallback values through the primitive parser's
  // constraints.
  if (typeof parser.validateValue === "function") {
    Object.defineProperty(boundParser, "validateValue", {
      value: parser.validateValue.bind(parser),
      configurable: true,
      enumerable: false,
    });
  }
  const dependencyMetadata = mapSourceMetadata(
    parser,
    (sourceMetadata: ParserSourceMetadata<M, TValue, TState>) => ({
      ...sourceMetadata,
      getMissingSourceValue: sourceMetadata.preservesSourceValue !== false &&
          options.default !== undefined
        ? () => {
          // Route the default through the inner parser's validateValue so that
          // CLI constraints cannot be bypassed via bindEnv defaults (#414).
          if (typeof parser.validateValue === "function") {
            return parser.validateValue(options.default!) as
              | ValueParserResult<unknown>
              | Promise<ValueParserResult<unknown>>;
          }
          return { success: true as const, value: options.default };
        }
        : undefined,
      extractSourceValue: (state: unknown) => {
        if (!isEnvBindState(state)) {
          if (sourceMetadata.preservesSourceValue) {
            return getEnvSourceValue(
              state,
              options,
              state,
              sourceMetadata.extractSourceValue,
              parser,
            );
          }
          return sourceMetadata.extractSourceValue(state);
        }
        if (state.hasCliValue) {
          return sourceMetadata.extractSourceValue(
            state.cliState,
          );
        }
        const innerState = state.cliState ?? state;
        if (!sourceMetadata.preservesSourceValue) {
          return sourceMetadata.extractSourceValue(innerState);
        }
        return getEnvSourceValue(
          state,
          options,
          innerState,
          sourceMetadata.extractSourceValue,
          parser,
        );
      },
    }),
  );
  if (dependencyMetadata != null) {
    Object.defineProperty(boundParser, "dependencyMetadata", {
      value: dependencyMetadata,
      configurable: true,
      enumerable: false,
    });
  }
  return boundParser;
}

/**
 * Resolves a `bindEnv()` fallback value with env > default > inner
 * `complete()` priority, running each candidate through the inner
 * parser's `validateValue()` hook when available so the inner CLI
 * parser's constraints are enforced on fallback values (see issue
 * #414).
 *
 * @param state The wrapper state, which may carry env annotations.
 * @param options The binding options with lookup and default settings.
 * @param mode The parser mode (`"sync"` or `"async"`), used to
 *             dispatch env parsing and fallback validation.
 * @param innerParser Optional wrapped parser.  When present, its
 *                    `validateValue()` hook is used to re-validate
 *                    fallback values and its `complete()` is
 *                    delegated to as the last fallback.
 * @param innerState Optional unwrapped inner state to pass through to
 *                   `innerParser.complete()`.
 * @param exec Optional execution context forwarded to
 *             `innerParser.complete()`.
 * @returns The resolved value as a mode-dependent result.
 * @throws {Error} Propagates errors thrown by the env source callback
 *                 (`sourceData.source(fullKey)`) while reading the
 *                 environment variable.
 * @throws {Error} Propagates errors thrown by
 *                 `options.parser.parse(rawValue)` (sync or async)
 *                 while parsing the raw env string into `TValue`.
 * @throws {Error} Propagates errors thrown by
 *                 `innerParser.validateValue()` while re-validating
 *                 a successful env-sourced value or the configured
 *                 `default` against the inner CLI parser's
 *                 constraints.
 * @throws {Error} Propagates errors thrown by `innerParser.complete()`
 *                 when falling through to the inner parser (e.g.,
 *                 `bindEnv(bindConfig(...))` with neither env nor
 *                 default set).
 */
function getEnvOrDefault<M extends Mode, TValue>(
  state: unknown,
  options: BindEnvOptions<M, TValue>,
  mode: M,
  innerParser?: Parser<M, TValue, unknown>,
  innerState?: unknown,
  exec?: ExecutionContext,
): ModeValue<M, Result<TValue>> {
  const annotations = getAnnotations(state);
  // Read from the per-instance context id so that the correct source is
  // selected even when annotations from multiple env contexts are merged.
  // See: https://github.com/dahlia/optique/issues/136
  const sourceData = annotations?.[options.context.id] as
    | EnvSourceData
    | undefined;

  const fullKey = `${
    sourceData?.prefix ?? options.context.prefix
  }${options.key}`;
  const rawValue = sourceData?.source(fullKey);

  // Helper that runs a (successful) fallback value through the inner
  // parser's validateValue() hook (#414).  The env parser
  // (`options.parser`) can be looser than the inner CLI parser, and
  // configured defaults bypass any validation entirely, so we pipe
  // every fallback value through the inner parser's constraints when
  // it exposes a validator.  If the inner parser does not implement
  // validateValue (e.g., it sits behind map()), we return the value
  // unchanged to preserve existing behavior.
  const validateSync = (
    parsed: ValueParserResult<TValue>,
  ): ValueParserResult<TValue> => {
    if (!parsed.success) return parsed;
    if (
      innerParser == null || typeof innerParser.validateValue !== "function"
    ) {
      return parsed;
    }
    return innerParser.validateValue(
      parsed.value,
    ) as ValueParserResult<TValue>;
  };
  const validateAsync = async (
    parsed: ValueParserResult<TValue>,
  ): Promise<ValueParserResult<TValue>> => {
    if (!parsed.success) return parsed;
    if (
      innerParser == null || typeof innerParser.validateValue !== "function"
    ) {
      return parsed;
    }
    return await innerParser.validateValue(parsed.value);
  };

  if (rawValue !== undefined) {
    if (typeof rawValue !== "string") {
      const type = rawValue === null
        ? "null"
        : Array.isArray(rawValue)
        ? "array"
        : typeof rawValue;
      return wrapForMode(mode, {
        success: false as const,
        error: message`Environment variable ${
          envVar(fullKey)
        } must be a string, but got: ${type}.`,
      });
    }
    // Parse through the env value parser first (its own constraints),
    // then pipe the result through the inner CLI parser's validator so
    // that the inner parser's constraints are enforced even when
    // `options.parser` is a looser value parser than the one the
    // inner parser was constructed with (#414).
    return dispatchByMode(
      mode,
      () => {
        const parsed = (options.parser as ValueParser<"sync", TValue>)
          .parse(rawValue);
        return validateSync(parsed);
      },
      async () => {
        const parsed = await options.parser.parse(rawValue);
        return await validateAsync(parsed);
      },
    );
  }

  if (options.default !== undefined) {
    return dispatchByMode(
      mode,
      () => validateSync({ success: true as const, value: options.default! }),
      () => validateAsync({ success: true as const, value: options.default! }),
    );
  }

  // When the env variable is absent and no default is provided, fall back
  // to the inner parser's complete() so that downstream wrappers (e.g.,
  // bindConfig) can still supply their own value.  Without this, composing
  // bindEnv(bindConfig(...)) would always fail with a bare "Missing required
  // environment variable" error when the env var is unset but the config
  // layer has a value.
  //
  // When the env context is detectably absent from annotations (the caller
  // passed SOME annotations via run()'s contexts option but did not include
  // this env context), replace a failing inner parser's error with a targeted
  // "contexts option" message.  When annotations are null (low-level parse()
  // call without any annotations, or run() without any contexts), we cannot
  // distinguish "context forgotten" from "no contexts at all", so we preserve
  // the inner parser's own error to avoid misleading low-level callers.
  const envContextAbsent = annotations != null &&
    !(options.context.id in annotations);
  if (innerParser != null) {
    const completeState = innerState ??
      (annotations != null &&
          innerParser.initialState == null &&
          getTraits(innerParser).inheritsAnnotations === true
        ? injectAnnotations(innerParser.initialState, annotations)
        : innerParser.initialState);
    const innerResult = innerParser.complete(completeState, exec);
    if (envContextAbsent) {
      const unregisteredError: Result<TValue> = {
        success: false,
        error: message`Environment variable ${
          envVar(fullKey)
        } could not be read: the env context was not passed to run()'s contexts option.`,
      };
      return mapModeValue(
        mode,
        innerResult,
        (r) => (r.success ? r : unregisteredError),
      );
    }
    return wrapForMode(mode, innerResult);
  }

  if (envContextAbsent) {
    return wrapForMode(mode, {
      success: false as const,
      error: message`Environment variable ${
        envVar(fullKey)
      } could not be read: the env context was not passed to run()'s contexts option.`,
    });
  }

  return wrapForMode(mode, {
    success: false as const,
    error: message`Missing required environment variable: ${envVar(fullKey)}`,
  });
}

/**
 * Resolves an env-backed dependency source with env and default fallbacks.
 *
 * This first checks annotations for the bound variable. If no env-backed value
 * is available, it falls back to `options.default` and finally delegates to
 * the wrapped parser's source extractor.
 *
 * When `innerParser` exposes a `validateValue` hook, env-sourced values
 * and the configured default are re-validated against the inner parser's
 * CLI constraints (see issue #414).  This is only called from the
 * `preservesSourceValue: true` branch in {@link bindEnv}, so the source
 * value type is guaranteed to equal `TValue`.
 *
 * @param state The wrapper state, which may carry env annotations.
 * @param options The binding options with lookup and default settings.
 * @param innerState The unwrapped inner state for delegated extraction.
 * @param extractInnerSourceValue The wrapped parser's source extractor.
 * @param innerParser The wrapped parser, used to revalidate fallback values.
 * @returns The resolved source value, an async source value, or `undefined`.
 * @throws {Error} Propagates errors thrown by the env source callback
 *                 (`sourceData.source(fullKey)`).
 * @throws {Error} Propagates errors thrown by `options.parser.parse(rawValue)`.
 * @throws {Error} Propagates errors thrown by
 *                 `innerParser.validateValue()` while revalidating a
 *                 successful env-sourced value or the configured
 *                 `default` against the inner CLI parser's constraints
 *                 (see issue #414).
 */
function getEnvSourceValue<M extends Mode, TValue>(
  state: unknown,
  options: BindEnvOptions<M, TValue>,
  innerState: unknown,
  extractInnerSourceValue: (
    state: unknown,
  ) =>
    | ValueParserResult<unknown>
    | Promise<ValueParserResult<unknown> | undefined>
    | undefined,
  innerParser?: Parser<M, TValue, unknown>,
):
  | ValueParserResult<unknown>
  | Promise<ValueParserResult<unknown> | undefined>
  | undefined {
  const annotations = getAnnotations(state);
  const sourceData = annotations?.[options.context.id] as
    | EnvSourceData
    | undefined;

  const fullKey = `${
    sourceData?.prefix ?? options.context.prefix
  }${options.key}`;
  const rawValue = sourceData?.source(fullKey);

  // Runs a successful fallback result through the inner parser's
  // validateValue() when available.  Since getEnvSourceValue is only
  // invoked from the preservesSourceValue: true branch, the source
  // value type matches TValue so validation is type-safe (#414).
  const validateFallback = (
    parsed: ValueParserResult<TValue>,
  ):
    | ValueParserResult<unknown>
    | Promise<ValueParserResult<unknown>> => {
    if (!parsed.success) return parsed;
    if (
      innerParser == null || typeof innerParser.validateValue !== "function"
    ) {
      return parsed;
    }
    return innerParser.validateValue(parsed.value) as
      | ValueParserResult<unknown>
      | Promise<ValueParserResult<unknown>>;
  };

  if (rawValue !== undefined) {
    if (typeof rawValue !== "string") {
      const type = rawValue === null
        ? "null"
        : Array.isArray(rawValue)
        ? "array"
        : typeof rawValue;
      return {
        success: false as const,
        error: message`Environment variable ${
          envVar(fullKey)
        } must be a string, but got: ${type}.`,
      };
    }
    // Route both sync and async env-parse results through the inner
    // parser's validateValue() without manually checking for Promises
    // (see CLAUDE.md: "All mode-based type assertions are isolated in
    // mode-dispatch.ts").
    return mapModeValue(
      options.parser.mode,
      options.parser.parse(rawValue),
      (p) => validateFallback(p as ValueParserResult<TValue>),
    ) as
      | ValueParserResult<unknown>
      | Promise<ValueParserResult<unknown> | undefined>
      | undefined;
  }

  if (options.default !== undefined) {
    return validateFallback({
      success: true as const,
      value: options.default,
    });
  }

  return extractInnerSourceValue(innerState);
}

/**
 * Options for the {@link bool} parser.
 *
 * @since 1.0.0
 */
export interface BoolOptions {
  /**
   * The metavariable name shown in help text.
   *
   * @default "BOOLEAN"
   */
  readonly metavar?: NonEmptyString;

  /**
   * Custom error messages for invalid Boolean input.
   */
  readonly errors?: {
    /**
     * Custom error when input is not a recognized Boolean literal.
     */
    readonly invalidFormat?: Message | ((input: string) => Message);
  };
}

const TRUE_LITERALS = ["true", "1", "yes", "on"] as const;
const FALSE_LITERALS = ["false", "0", "no", "off"] as const;

/**
 * Creates a Boolean value parser that accepts common true/false literals.
 *
 * Accepted values (case-insensitive):
 *
 *  -  True: `true`, `1`, `yes`, `on`
 *  -  False: `false`, `0`, `no`, `off`
 *
 * @param options Parser configuration options.
 * @returns A value parser for Boolean values.
 * @throws {TypeError} If `options.metavar` is an empty string.
 * @since 1.0.0
 */
export function bool(options: BoolOptions = {}): ValueParser<"sync", boolean> {
  const metavar = options.metavar ?? "BOOLEAN";
  ensureNonEmptyString(metavar);

  return {
    mode: "sync",
    metavar,
    placeholder: false,
    choices: [true, false],
    parse(input: string): ValueParserResult<boolean> {
      const normalized = input.trim().toLowerCase();

      if (
        TRUE_LITERALS.includes(normalized as (typeof TRUE_LITERALS)[number])
      ) {
        return { success: true, value: true };
      }

      if (
        FALSE_LITERALS.includes(
          normalized as (typeof FALSE_LITERALS)[number],
        )
      ) {
        return { success: true, value: false };
      }

      return {
        success: false,
        error: options.errors?.invalidFormat
          ? (typeof options.errors.invalidFormat === "function"
            ? options.errors.invalidFormat(input)
            : options.errors.invalidFormat)
          : message`Invalid Boolean value: ${input}. Expected one of ${
            valueSet([...TRUE_LITERALS, ...FALSE_LITERALS], {
              fallback: "",
              locale: "en-US",
            })
          }`,
      };
    },
    format(value: boolean): string {
      return value ? "true" : "false";
    },
    suggest(prefix: string) {
      const allLiterals = [...TRUE_LITERALS, ...FALSE_LITERALS];
      const normalizedPrefix = prefix.toLowerCase();
      return allLiterals
        .filter((lit) => lit.startsWith(normalizedPrefix))
        .map((lit) => ({ kind: "literal" as const, text: lit }));
    },
  };
}
