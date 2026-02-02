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
import type { Parser, Result } from "@optique/core/parser";
import { parse } from "@optique/core/parser";
import type { Annotations } from "@optique/core/annotations";
import type { ConfigContext } from "./index.ts";
import { clearActiveConfig, configKey, setActiveConfig } from "./index.ts";

/**
 * Base options shared by all config loading strategies.
 *
 * @since 0.10.0
 */
interface BaseRunWithConfigOptions {
  /**
   * Command-line arguments to parse.
   * If not provided, defaults to an empty array.
   */
  readonly args?: readonly string[];
}

/**
 * Options for single-file config loading (existing behavior).
 *
 * @template TValue The parser value type, inferred from the parser.
 * @since 0.10.0
 */
export interface SingleFileOptions<TValue> extends BaseRunWithConfigOptions {
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
   * @since 0.11.0
   */
  readonly fileParser?: (contents: Uint8Array) => unknown;

  /**
   * Custom config loading function (mutually exclusive with getConfigPath).
   */
  readonly load?: never;
}

/**
 * Options for custom config loading with full control.
 *
 * Use this when you need to load multiple config files and merge them,
 * or when you need custom error handling for different config sources.
 *
 * @template TValue The parser value type, inferred from the parser.
 * @template T The config data type.
 * @since 0.11.0
 */
export interface CustomLoadOptions<TValue, T> extends BaseRunWithConfigOptions {
  /**
   * Custom config loading function.
   *
   * This callback receives the first-pass parse result and returns the raw
   * config data. The data will be validated against the schema afterward.
   *
   * Use this for:
   *
   * - Loading and merging multiple config files (system, user, project)
   * - Custom file discovery logic
   * - Domain-specific error handling for different config sources
   *
   * @param parsed The first-pass parse result from CLI arguments.
   * @returns The raw config data or a Promise that resolves to it.
   *          Return undefined if no config should be applied.
   */
  readonly load: (parsed: TValue) => T | undefined | Promise<T | undefined>;

  /**
   * Function to extract config file path (mutually exclusive with load).
   */
  readonly getConfigPath?: never;

  /**
   * File parser function (only used with getConfigPath).
   */
  readonly fileParser?: never;
}

/**
 * Options for runWithConfig.
 *
 * This is a discriminated union that supports two modes:
 *
 * - Single-file mode: Use `getConfigPath` and optional `fileParser` for simple
 *   single config file loading.
 * - Custom load mode: Use `load` callback for full control over config
 *   loading, merging, and error handling.
 *
 * @template TValue The parser value type, inferred from the parser.
 * @template T The config data type.
 * @since 0.10.0
 */
export type RunWithConfigOptions<TValue, T = unknown> =
  | SingleFileOptions<TValue>
  | CustomLoadOptions<TValue, T>;

/**
 * Runs a parser with configuration file support using two-pass parsing.
 *
 * This function performs the following steps:
 * 1. First pass: Parse arguments to extract the config file path
 * 2. Load and validate: Read the config file and validate using Standard Schema
 * 3. Second pass: Parse arguments again with config data as annotations
 *
 * The priority order for values is: CLI > config file > default.
 *
 * @template M The parser mode (sync or async).
 * @template TValue The parser value type.
 * @template TState The parser state type.
 * @template T The config data type.
 * @param parser The parser to execute.
 * @param context The config context with schema.
 * @param options Run options. Use `getConfigPath` for single-file loading, or
 *                `load` for custom multi-file loading.
 * @returns Promise that resolves to the parsed result.
 * @throws Error if config file validation fails.
 * @since 0.10.0
 *
 * @example Single-file loading (default behavior)
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
 * });
 * ```
 *
 * @example Custom multi-file loading
 * ```typescript
 * const result = await runWithConfig(parser, context, {
 *   load: async (parsed) => {
 *     // Load and merge multiple config sources
 *     const system = await tryLoad("/etc/myapp/config.json");
 *     const user = await tryLoad(`${home}/.myapp.json`);
 *     const project = await tryLoad("./.myapp.json");
 *     return deepMerge(system, user, project);
 *   },
 *   args: process.argv.slice(2),
 * });
 * ```
 */
export async function runWithConfig<
  M extends "sync" | "async",
  TValue,
  TState,
  T,
>(
  parser: Parser<M, TValue, TState>,
  context: ConfigContext<T>,
  options: RunWithConfigOptions<TValue, T>,
): Promise<TValue> {
  const args = options.args ?? [];

  // First pass: Parse to extract config file path
  const firstPass = parse(parser, args);

  let firstPassResult: Result<TValue>;
  if (firstPass instanceof Promise) {
    firstPassResult = await firstPass;
  } else {
    firstPassResult = firstPass;
  }

  if (!firstPassResult.success) {
    // First pass failed - format error message
    const errorParts = firstPassResult.error.map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "optionName") return part.optionName;
      if (part.type === "optionNames") return part.optionNames.join(", ");
      if (part.type === "metavar") return part.metavar;
      if (part.type === "value") return part.value;
      if (part.type === "values") return part.values.join(", ");
      if (part.type === "envVar") return part.envVar;
      if (part.type === "commandLine") return part.commandLine;
      if (part.type === "url") return part.url;
      return "";
    });
    throw new Error(`Parsing failed: ${errorParts.join("")}`);
  }

  let configData: T | undefined;

  // Determine loading strategy based on options
  if ("load" in options) {
    // Custom load mode: User handles all loading and merging
    const rawData = options.load(firstPassResult.value);
    const loadResult = rawData instanceof Promise ? await rawData : rawData;

    if (loadResult !== undefined) {
      // Validate with Standard Schema
      const validation = context.schema["~standard"].validate(loadResult);

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
          `Config validation failed: ${firstIssue?.message ?? "Unknown error"}`,
        );
      }

      configData = validationResult.value as T;
    }
  } else if ("getConfigPath" in options) {
    // Single-file mode: Existing behavior
    const configPath = options.getConfigPath(firstPassResult.value);

    if (configPath) {
      // Load config file
      try {
        const contents = await readFile(configPath);

        // Parse file contents
        let rawData: unknown;
        if (options.fileParser) {
          rawData = options.fileParser(contents);
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
      } catch (error) {
        // Re-throw validation errors
        if (error instanceof Error && error.message.includes("validation")) {
          throw error;
        }

        // File not found or parse error - continue without config
        configData = undefined;
      }
    }
  }

  // Second pass: Parse with config annotations
  const annotations: Annotations = configData
    ? { [configKey]: configData }
    : {};

  // Set active config in registry for nested parsers inside object()
  if (configData) {
    setActiveConfig(context.id, configData);
  }

  try {
    const secondPass = parse(parser, args, { annotations });

    let secondPassResult: Result<TValue>;
    if (secondPass instanceof Promise) {
      secondPassResult = await secondPass;
    } else {
      secondPassResult = secondPass;
    }

    if (!secondPassResult.success) {
      throw new Error(`Parsing failed: ${String(secondPassResult.error)}`);
    }

    return secondPassResult.value;
  } finally {
    // Always clear the active config after parsing
    clearActiveConfig(context.id);
  }
}
