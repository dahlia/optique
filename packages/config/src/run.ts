/**
 * Config-aware runner for Optique parsers.
 *
 * This module provides the runWithConfig function that performs two-pass
 * parsing to load configuration files and merge them with CLI arguments.
 *
 * @module
 * @since 0.10.0
 */

import { readFile } from "node:fs/promises";
import { basename, dirname, resolve as resolvePath } from "node:path";
import process from "node:process";
import type { Parser } from "@optique/core/parser";
import type { Annotations, SourceContext } from "@optique/core/context";
import type { RunOptions } from "@optique/core/facade";
import { runWith } from "@optique/core/facade";
import type { ConfigContext, ConfigMeta } from "./index.ts";
import {
  clearActiveConfig,
  clearActiveConfigMeta,
  configKey,
  configMetaKey,
  setActiveConfig,
  setActiveConfigMeta,
} from "./index.ts";

function isErrnoException(
  error: unknown,
): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

/**
 * Options for single-file config loading.
 *
 * @template TValue The parser value type, inferred from the parser.
 * @template THelp The return type when help is shown.
 * @template TError The return type when an error occurs.
 * @since 0.10.0
 */
export interface SingleFileOptions<TValue, THelp = void, TError = never> {
  /**
   * Function to extract the config file path from parsed CLI arguments.
   * This function receives the result of the first parse pass and should
   * return the config file path or undefined if no config file is specified.
   *
   * The `parsed` parameter is typed based on the parser's result type,
   * providing full type safety without manual type assertions.
   */
  readonly getConfigPath: (parsed: TValue) => string | undefined;

  /**
   * Custom parser function for reading config file contents.
   * If not provided, defaults to JSON.parse.
   *
   * @param contents The raw file contents as Uint8Array.
   * @returns The parsed config data (will be validated by schema).
   */
  readonly fileParser?: (contents: Uint8Array) => unknown;

  /**
   * Command-line arguments to parse.
   * If not provided, defaults to an empty array.
   */
  readonly args?: readonly string[];

  /**
   * Name of the program for help/error output.
   * If not provided, inferred from process.argv[1].
   */
  readonly programName?: string;

  /**
   * Help configuration. See RunOptions for details.
   */
  readonly help?: RunOptions<THelp, TError>["help"];

  /**
   * Version configuration. See RunOptions for details.
   */
  readonly version?: RunOptions<THelp, TError>["version"];

  /**
   * Completion configuration. See RunOptions for details.
   */
  readonly completion?: RunOptions<THelp, TError>["completion"];

  /**
   * Output function for standard output. See RunOptions for details.
   */
  readonly stdout?: RunOptions<THelp, TError>["stdout"];

  /**
   * Output function for standard error. See RunOptions for details.
   */
  readonly stderr?: RunOptions<THelp, TError>["stderr"];

  /**
   * Whether to enable colored output. See RunOptions for details.
   */
  readonly colors?: RunOptions<THelp, TError>["colors"];

  /**
   * Maximum width for output formatting. See RunOptions for details.
   */
  readonly maxWidth?: RunOptions<THelp, TError>["maxWidth"];

  /**
   * Whether and how to display default values. See RunOptions for details.
   */
  readonly showDefault?: RunOptions<THelp, TError>["showDefault"];

  /**
   * Whether and how to display valid choices. See RunOptions for details.
   */
  readonly showChoices?: RunOptions<THelp, TError>["showChoices"];

  /**
   * What to display above error messages. See RunOptions for details.
   */
  readonly aboveError?: RunOptions<THelp, TError>["aboveError"];

  /**
   * Brief description for help text. See RunOptions for details.
   */
  readonly brief?: RunOptions<THelp, TError>["brief"];

  /**
   * Detailed description for help text. See RunOptions for details.
   */
  readonly description?: RunOptions<THelp, TError>["description"];

  /**
   * Usage examples for help text. See RunOptions for details.
   */
  readonly examples?: RunOptions<THelp, TError>["examples"];

  /**
   * Author information for help text. See RunOptions for details.
   */
  readonly author?: RunOptions<THelp, TError>["author"];

  /**
   * Bug reporting information for help text. See RunOptions for details.
   */
  readonly bugs?: RunOptions<THelp, TError>["bugs"];

  /**
   * Footer text for help. See RunOptions for details.
   */
  readonly footer?: RunOptions<THelp, TError>["footer"];

  /**
   * Error handler. See RunOptions for details.
   */
  readonly onError?: RunOptions<THelp, TError>["onError"];
}

/**
 * Result type for custom config loading.
 *
 * @template TConfigMeta Metadata type associated with loaded config data.
 * @since 1.0.0
 */
export interface ConfigLoadResult<TConfigMeta = ConfigMeta> {
  /**
   * Raw config data to validate against the schema.
   */
  readonly config: unknown;

  /**
   * Metadata about where the config came from.
   */
  readonly meta: TConfigMeta;
}

/**
 * Options for custom config loading with multi-file merging support.
 *
 * @template TValue The parser value type, inferred from the parser.
 * @template THelp The return type when help is shown.
 * @template TError The return type when an error occurs.
 * @since 0.10.0
 */
export interface CustomLoadOptions<
  TValue,
  TConfigMeta = ConfigMeta,
  THelp = void,
  TError = never,
> {
  /**
   * Custom loader function that receives the first-pass parse result and
   * returns the config data (or a Promise of it). This allows full control
   * over file discovery, loading, merging, and error handling.
   *
   * The returned data will be validated against the schema.
   *
   * @param parsed The result from the first parse pass.
   * @returns Config data and metadata (config is validated by schema).
   */
  readonly load: (parsed: TValue) =>
    | Promise<ConfigLoadResult<TConfigMeta>>
    | ConfigLoadResult<TConfigMeta>;

  /**
   * Command-line arguments to parse.
   * If not provided, defaults to an empty array.
   */
  readonly args?: readonly string[];

  /**
   * Name of the program for help/error output.
   * If not provided, inferred from process.argv[1].
   */
  readonly programName?: string;

  /**
   * Help configuration. See RunOptions for details.
   */
  readonly help?: RunOptions<THelp, TError>["help"];

  /**
   * Version configuration. See RunOptions for details.
   */
  readonly version?: RunOptions<THelp, TError>["version"];

  /**
   * Completion configuration. See RunOptions for details.
   */
  readonly completion?: RunOptions<THelp, TError>["completion"];

  /**
   * Output function for standard output. See RunOptions for details.
   */
  readonly stdout?: RunOptions<THelp, TError>["stdout"];

  /**
   * Output function for standard error. See RunOptions for details.
   */
  readonly stderr?: RunOptions<THelp, TError>["stderr"];

  /**
   * Whether to enable colored output. See RunOptions for details.
   */
  readonly colors?: RunOptions<THelp, TError>["colors"];

  /**
   * Maximum width for output formatting. See RunOptions for details.
   */
  readonly maxWidth?: RunOptions<THelp, TError>["maxWidth"];

  /**
   * Whether and how to display default values. See RunOptions for details.
   */
  readonly showDefault?: RunOptions<THelp, TError>["showDefault"];

  /**
   * Whether and how to display valid choices. See RunOptions for details.
   */
  readonly showChoices?: RunOptions<THelp, TError>["showChoices"];

  /**
   * What to display above error messages. See RunOptions for details.
   */
  readonly aboveError?: RunOptions<THelp, TError>["aboveError"];

  /**
   * Brief description for help text. See RunOptions for details.
   */
  readonly brief?: RunOptions<THelp, TError>["brief"];

  /**
   * Detailed description for help text. See RunOptions for details.
   */
  readonly description?: RunOptions<THelp, TError>["description"];

  /**
   * Usage examples for help text. See RunOptions for details.
   */
  readonly examples?: RunOptions<THelp, TError>["examples"];

  /**
   * Author information for help text. See RunOptions for details.
   */
  readonly author?: RunOptions<THelp, TError>["author"];

  /**
   * Bug reporting information for help text. See RunOptions for details.
   */
  readonly bugs?: RunOptions<THelp, TError>["bugs"];

  /**
   * Footer text for help. See RunOptions for details.
   */
  readonly footer?: RunOptions<THelp, TError>["footer"];

  /**
   * Error handler. See RunOptions for details.
   */
  readonly onError?: RunOptions<THelp, TError>["onError"];
}

/**
 * Options for runWithConfig.
 *
 * @template TValue The parser value type, inferred from the parser.
 * @template THelp The return type when help is shown.
 * @template TError The return type when an error occurs.
 * @since 0.10.0
 */
export type RunWithConfigOptions<
  TValue,
  TConfigMeta = ConfigMeta,
  THelp = void,
  TError = never,
> =
  | SingleFileOptions<TValue, THelp, TError>
  | CustomLoadOptions<TValue, TConfigMeta, THelp, TError>;

/**
 * Helper function to create a wrapper SourceContext for config loading.
 * @internal
 */
function createConfigSourceContext<
  T,
  TConfigMeta,
  TValue,
  THelp = void,
  TError = never,
>(
  context: ConfigContext<T, TConfigMeta>,
  options: RunWithConfigOptions<TValue, TConfigMeta, THelp, TError>,
): SourceContext<void> {
  return {
    id: context.id,

    async getAnnotations(parsed?: unknown): Promise<Annotations> {
      if (!parsed) return {};

      let configData: T | undefined;
      let configMeta: TConfigMeta | undefined;

      // Check if using custom loader or single-file mode
      if ("load" in options) {
        // Custom load mode
        const customOptions = options as CustomLoadOptions<TValue, TConfigMeta>;
        const loaded = await Promise.resolve(
          customOptions.load(parsed as TValue),
        );

        // Validate with Standard Schema
        const validation = context.schema["~standard"].validate(loaded.config);

        let validationResult: typeof validation extends Promise<infer R> ? R
          : typeof validation;

        if (validation instanceof Promise) {
          validationResult = await validation;
        } else {
          validationResult = validation;
        }

        if (validationResult.issues) {
          // Validation failed
          const firstIssue = validationResult.issues[0];
          throw new Error(
            `Config validation failed: ${
              firstIssue?.message ?? "Unknown error"
            }`,
          );
        }

        configData = validationResult.value as T;
        configMeta = loaded.meta;
      } else {
        // Single-file mode
        const singleFileOptions = options as SingleFileOptions<TValue>;
        const configPath = singleFileOptions.getConfigPath(parsed as TValue);

        if (configPath) {
          const absoluteConfigPath = resolvePath(configPath);
          const singleFileMeta: ConfigMeta = {
            configDir: dirname(absoluteConfigPath),
            configPath: absoluteConfigPath,
          };

          // Load config file
          try {
            const contents = await readFile(absoluteConfigPath);

            // Parse file contents
            let rawData: unknown;
            if (singleFileOptions.fileParser) {
              rawData = singleFileOptions.fileParser(contents);
            } else {
              // Default to JSON
              const text = new TextDecoder().decode(contents);
              rawData = JSON.parse(text);
            }

            // Validate with Standard Schema
            const validation = context.schema["~standard"].validate(rawData);

            let validationResult: typeof validation extends Promise<infer R> ? R
              : typeof validation;

            if (validation instanceof Promise) {
              validationResult = await validation;
            } else {
              validationResult = validation;
            }

            if (validationResult.issues) {
              // Validation failed
              const firstIssue = validationResult.issues[0];
              throw new Error(
                `Config validation failed: ${
                  firstIssue?.message ?? "Unknown error"
                }`,
              );
            }

            configData = validationResult.value as T;
            configMeta = singleFileMeta as TConfigMeta;
          } catch (error) {
            // Missing config file is optional in single-file mode.
            if (isErrnoException(error) && error.code === "ENOENT") {
              configData = undefined;
            } else if (error instanceof SyntaxError) {
              throw new Error(
                `Failed to parse config file ${absoluteConfigPath}: ${error.message}`,
              );
            } else {
              throw error;
            }
          }
        }
      }

      // Set active config in registry for nested parsers inside object()
      if (configData !== undefined && configData !== null) {
        setActiveConfig(context.id, configData);
        if (configMeta !== undefined) {
          setActiveConfigMeta(context.id, configMeta);
          return {
            [configKey]: configData,
            [configMetaKey]: configMeta,
          };
        }

        return { [configKey]: configData };
      }

      return {};
    },
  };
}

/**
 * Runs a parser with configuration file support using two-pass parsing.
 *
 * This function performs the following steps:
 * 1. First pass: Parse arguments to extract config path or data
 * 2. Load and validate: Load config file(s) and validate using Standard Schema
 * 3. Second pass: Parse arguments again with config data as annotations
 *
 * The priority order for values is: CLI > config file > default.
 *
 * The function also supports help, version, and completion features. When these
 * special commands are detected, config loading is skipped entirely, ensuring
 * these features work even when config files don't exist.
 *
 * @template M The parser mode (sync or async).
 * @template TValue The parser value type.
 * @template TState The parser state type.
 * @template T The config data type.
 * @template TConfigMeta The config metadata type.
 * @template THelp The return type when help is shown.
 * @template TError The return type when an error occurs.
 * @param parser The parser to execute.
 * @param context The config context with schema.
 * @param options Run options - either SingleFileOptions or CustomLoadOptions.
 * @returns Promise that resolves to the parsed result.
 * @throws Error if config file validation fails.
 * @since 0.10.0
 *
 * @example Single file mode
 * ```typescript
 * import { z } from "zod";
 * import { runWithConfig } from "@optique/config/run";
 * import { createConfigContext, bindConfig } from "@optique/config";
 *
 * const schema = z.object({
 *   host: z.string(),
 *   port: z.number(),
 * });
 *
 * const context = createConfigContext({ schema });
 *
 * const parser = object({
 *   config: option("--config", string()),
 *   host: bindConfig(option("--host", string()), {
 *     context,
 *     key: "host",
 *     default: "localhost",
 *   }),
 * });
 *
 * const result = await runWithConfig(parser, context, {
 *   getConfigPath: (parsed) => parsed.config,
 *   args: process.argv.slice(2),
 *   help: { mode: "option", onShow: () => process.exit(0) },
 *   version: { value: "1.0.0", onShow: () => process.exit(0) },
 * });
 * ```
 *
 * @example Custom load mode (multi-file merging)
 * ```typescript
 * import { deepMerge } from "es-toolkit";
 *
 * const result = await runWithConfig(parser, context, {
 *   load: async (parsed) => {
 *     const configs = await Promise.all([
 *       loadToml("/etc/app/config.toml").catch(() => ({})),
 *       loadToml("~/.config/app/config.toml").catch(() => ({})),
 *       loadToml("./.app.toml").catch(() => ({})),
 *     ]);
 *
 *     const configPath = parsed.config ?? "./.app.toml";
 *     return {
 *       config: deepMerge(...configs),
 *       meta: {
 *         configPath,
 *         configDir: configPath.slice(0, configPath.lastIndexOf("/")),
 *       },
 *     };
 *   },
 *   args: process.argv.slice(2),
 *   help: { mode: "option", onShow: () => process.exit(0) },
 * });
 * ```
 */
export async function runWithConfig<
  M extends "sync" | "async",
  TValue,
  TState,
  T,
  THelp = void,
  TError = never,
>(
  parser: Parser<M, TValue, TState>,
  context: ConfigContext<T, ConfigMeta>,
  options: SingleFileOptions<TValue, THelp, TError>,
): Promise<TValue>;

export async function runWithConfig<
  M extends "sync" | "async",
  TValue,
  TState,
  T,
  TConfigMeta = ConfigMeta,
  THelp = void,
  TError = never,
>(
  parser: Parser<M, TValue, TState>,
  context: ConfigContext<T, TConfigMeta>,
  options: CustomLoadOptions<TValue, TConfigMeta, THelp, TError>,
): Promise<TValue>;

export async function runWithConfig<
  M extends "sync" | "async",
  TValue,
  TState,
  T,
  TConfigMeta = ConfigMeta,
  THelp = void,
  TError = never,
>(
  parser: Parser<M, TValue, TState>,
  context: ConfigContext<T, TConfigMeta>,
  options: RunWithConfigOptions<TValue, TConfigMeta, THelp, TError>,
): Promise<TValue> {
  // Determine program name
  const effectiveProgramName = options.programName ??
    (typeof process !== "undefined" && process.argv?.[1]
      ? basename(process.argv[1])
      : "cli");

  // Create wrapper context for config loading
  const wrapperContext = createConfigSourceContext(context, options);

  try {
    return await runWith(parser, effectiveProgramName, [wrapperContext], {
      args: options.args ?? [],
      help: options.help,
      version: options.version,
      completion: options.completion,
      stdout: options.stdout,
      stderr: options.stderr,
      colors: options.colors,
      maxWidth: options.maxWidth,
      showDefault: options.showDefault,
      showChoices: options.showChoices,
      aboveError: options.aboveError,
      brief: options.brief,
      description: options.description,
      examples: options.examples,
      author: options.author,
      bugs: options.bugs,
      footer: options.footer,
      onError: options.onError,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("Failed to parse config file ")
    ) {
      const stderr = options.stderr ?? console.error;
      stderr(`Error: ${error.message}`);
      if (options.onError) {
        try {
          options.onError(1);
        } catch {
          (options.onError as (() => TError))();
        }
      }
      throw error;
    }
    throw error;
  } finally {
    // Always clear the active config after parsing
    clearActiveConfig(context.id);
    clearActiveConfigMeta(context.id);
  }
}
