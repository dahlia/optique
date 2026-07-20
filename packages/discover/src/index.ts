import { longestMatch, or } from "@optique/core/constructs";
import type {
  SourceContext,
  SourceContextRequest,
} from "@optique/core/context";
import type { DocState } from "@optique/core/parser";
import type { DocFragment, DocFragments } from "@optique/core/doc";
import type { RuntimeNode } from "@optique/core/dependency-runtime";
import {
  dispatchByMode,
  inheritAnnotations,
  mapModeValue,
  wrapForMode,
} from "@optique/core/extension";
import { fluent, type FluentParser } from "@optique/core/fluent";
import { map } from "@optique/core/modifiers";
import type { Message } from "@optique/core/message";
import type {
  ExecutionContext,
  Mode,
  Parser,
  ParserContext,
  ParserResult,
} from "@optique/core/parser";
import type { ProgramMetadata } from "@optique/core/program";
import { command } from "@optique/core/primitives";
import {
  type HiddenVisibility,
  isDocHidden,
  mergeHidden,
} from "@optique/core/usage";
import { runAsync } from "@optique/run";
import type { RunOptions } from "@optique/run";
import { readdir, realpath, stat } from "node:fs/promises";
import { posix, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type AnyCommand,
  type CommandMetadata,
  type CommandPath,
  isCommand,
  type ProgramHookContext,
  type ProgramHooks,
  type ProgramInvocation,
  type RunProgramCommand,
  type RunProgramStaticCommand,
  validateHooks,
} from "./command.ts";

export { defineCommand, isCommand } from "./command.ts";
export type {
  AnyCommand,
  AnyStaticCommand,
  Command,
  CommandDefinition,
  CommandMetadata,
  CommandPath,
  ProgramHookContext,
  ProgramHooks,
  ProgramInvocation,
  RunProgramCommand,
  RunProgramStaticCommand,
  StaticCommand,
} from "./command.ts";

/**
 * A command paired with its command path.
 *
 * `createProgramParser()` accepts command entries directly, and
 * `runProgram({ commands })` accepts them alongside commands that declare
 * their own `path` field.
 *
 * @since 1.2.0
 */
export interface CommandEntry {
  /**
   * Command path used to place the command in the program tree.
   */
  readonly path: CommandPath;

  /**
   * The command definition.
   */
  readonly command: AnyCommand;
}

/**
 * A command entry accepted by `runProgram()` with a program-level resource
 * type.
 *
 * @template R The resource made available by program-level lifecycle hooks.
 * @since 1.2.0
 */
export type RunProgramCommandEntry<R = unknown> =
  & Omit<CommandEntry, "command">
  & {
    /**
     * A command compatible with the program-level resource, or one that
     * always creates its own command context.
     */
    readonly command: RunProgramCommand<R>;
  };

/**
 * A command found on disk.
 *
 * @since 1.1.0
 */
export interface DiscoveredCommand extends CommandEntry {
  /**
   * Command path derived from the module's relative path.
   */
  readonly path: CommandPath;

  /**
   * Absolute path to the command module.
   */
  readonly filePath: string;

  /**
   * The command exported by the module.
   */
  readonly command: AnyCommand;
}

/**
 * A command loaded from a static module map.
 *
 * @template R The program-level resource used by commands without their own
 *              `beforeEach` hook.
 * @since 1.2.0
 */
export interface ModuleCommand<R = unknown> extends CommandEntry {
  /**
   * The command definition.
   */
  readonly command: RunProgramCommand<R>;

  /**
   * Module map key used to derive the command path.
   */
  readonly modulePath: string;
}

/**
 * Static module map accepted by {@link commandsFromModules}.
 *
 * This matches eager glob import APIs such as Vite's
 * `import.meta.glob(..., { eager: true })`.
 *
 * @since 1.2.0
 */
export type ModuleMap = Readonly<Record<string, unknown>>;

/**
 * Options for {@link discoverCommands}.
 *
 * @since 1.1.0
 */
export interface DiscoverCommandsOptions {
  /**
   * Directory to scan recursively.
   */
  readonly dir: string | URL;

  /**
   * File suffixes to include.  Compound suffixes such as `.cmd.ts` are
   * supported.
   *
   * @default Runtime-aware extension defaults from {@link getDefaultExtensions}
   */
  readonly extensions?: readonly string[];

  /**
   * File name that maps to the containing command path after extension
   * stripping.  For example, `stash/index.ts` maps to `stash`, and root
   * `index.ts` maps to the root command.  Pass `false` to treat matching files
   * as ordinary command names.
   *
   * @default `"index"`
   * @since 1.2.0
   */
  readonly entryFileName?: string | false;
}

/**
 * Options for {@link commandsFromModules}.
 *
 * @since 1.2.0
 */
export interface CommandsFromModulesOptions {
  /**
   * Base module path to strip before deriving command paths.
   *
   * @default `"."`
   */
  readonly base?: string;

  /**
   * Module suffixes to include.  Compound suffixes such as `.cmd.ts` are
   * supported.
   *
   * @default Runtime-aware extension defaults from {@link getDefaultExtensions}
   */
  readonly extensions?: readonly string[];

  /**
   * File name that maps to the containing command path after extension
   * stripping.  For example, `stash/index.ts` maps to `stash`, and root
   * `index.ts` maps to the root command.  Pass `false` to treat matching files
   * as ordinary command names.
   *
   * @default `"index"`
   */
  readonly entryFileName?: string | false;
}

/**
 * Runtime hint for {@link getDefaultExtensions}.
 *
 * @since 1.1.0
 */
export interface RuntimeExtensionOptions {
  /**
   * Runtime to model.
   */
  readonly runtime?: "node" | "deno" | "bun";

  /**
   * Node.js execution arguments used for TypeScript loader detection.
   */
  readonly execArgv?: readonly string[];

  /**
   * The `NODE_OPTIONS` value used for TypeScript loader detection.
   */
  readonly nodeOptions?: string;

  /**
   * Whether the Node.js runtime supports TypeScript files without a custom
   * loader or flag.
   */
  readonly nodeTypeScriptSupport?: boolean;
}

interface RunProgramBaseOptions<R = unknown> extends
  Omit<
    RunOptions,
    "help" | "version" | "completion" | "programName"
  > {
  /**
   * Root program metadata.
   */
  readonly metadata: ProgramMetadata;

  /**
   * Program name override for help, errors, and completion scripts.
   *
   * @default `metadata.name`
   */
  readonly programName?: string;

  /**
   * Help configuration.  Pass `false` to disable built-in help.
   *
   * @default `"both"`
   */
  readonly help?: RunOptions["help"] | false;

  /**
   * Version configuration.  Pass `false` to disable built-in version output.
   *
   * @default `metadata.version` as `--version`, when present
   */
  readonly version?: RunOptions["version"] | false;

  /**
   * Shell completion configuration.  Pass `false` to disable built-in
   * completion.
   *
   * @default `"both"`
   */
  readonly completion?: RunOptions["completion"] | false;

  /**
   * Lifecycle hooks invoked around each command handler.
   *
   * Use these for cross-cutting concerns such as opening a log scope, starting
   * a tracing span, or reporting handler failures, without duplicating the
   * logic in every command.  Hooks are opt-in: omitting this field keeps the
   * exact behavior of a plain `runProgram()` call.  Command-level hooks defined
   * on {@link CommandDefinition.hooks} nest inside these.
   *
   * @since 1.2.0
   */
  readonly hooks?: ProgramHooks<R>;
}

/**
 * Options for {@link runProgram} when discovering commands from files.
 *
 * @template R The resource made available by program-level lifecycle hooks.
 * @since 1.1.0
 */
export interface RunProgramDiscoveryOptions<R = unknown>
  extends RunProgramBaseOptions<R> {
  /**
   * Directory containing command modules.
   */
  readonly dir: string | URL;

  /**
   * File suffixes to include during discovery.
   */
  readonly extensions?: readonly string[];

  /**
   * File name that maps to the containing command path after extension
   * stripping.
   *
   * @default `"index"`
   * @since 1.2.0
   */
  readonly entryFileName?: string | false;

  /**
   * Static commands cannot be used together with `dir`.
   */
  readonly commands?: never;
}

/**
 * Options for {@link runProgram} when commands are imported manually.
 *
 * @template R The resource made available by program-level lifecycle hooks.
 * @since 1.1.0
 */
export interface RunProgramStaticOptions<R = unknown>
  extends RunProgramBaseOptions<R> {
  /**
   * Commands to compose without file-system discovery.
   *
   * Pass commands that declare their own `path`, or command entries returned
   * by {@link commandsFromModules}.
   */
  readonly commands: readonly (
    | RunProgramStaticCommand<NoInfer<R>>
    | RunProgramCommandEntry<NoInfer<R>>
  )[];

  /**
   * File-system discovery cannot be used together with `commands`.
   */
  readonly dir?: never;

  /**
   * File suffixes are only used with file-system discovery.
   */
  readonly extensions?: never;

  /**
   * Entry file names are only used with file-system discovery.
   */
  readonly entryFileName?: never;
}

/**
 * Options for {@link runProgram}.
 *
 * @template R The resource made available by program-level lifecycle hooks.
 * @since 1.1.0
 */
export type RunProgramOptions<R = unknown> =
  | RunProgramDiscoveryOptions<R>
  | RunProgramStaticOptions<R>;

/**
 * Returns runtime-aware command module suffixes.
 *
 * @param options Runtime detection overrides for testing or custom launchers.
 * @returns File suffixes to scan.
 * @since 1.1.0
 */
export function getDefaultExtensions(
  options: RuntimeExtensionOptions = {},
): readonly string[] {
  const runtime = options.runtime ?? getRuntime();
  if (runtime === "deno" || runtime === "bun") {
    return [".ts", ".mts", ".js", ".mjs"];
  }
  const extensions = [".js", ".mjs", ".cjs"];
  if (
    hasNodeTypeScriptLoader(
      options.execArgv ?? process.execArgv,
      options.nodeOptions ?? process.env.NODE_OPTIONS ?? "",
      options.nodeTypeScriptSupport ?? hasNativeNodeTypeScriptSupport(),
    )
  ) {
    extensions.push(".ts", ".mts", ".cts");
  }
  return extensions;
}

/**
 * Discovers command modules under a directory.
 *
 * @param options Discovery options.
 * @returns Discovered commands sorted by command path.
 * @throws {TypeError} If options are invalid, discovery finds no commands,
 *         command paths are duplicated, or a module does not default-export
 *         a command created with `defineCommand()`.
 * @since 1.1.0
 */
export async function discoverCommands(
  options: DiscoverCommandsOptions,
): Promise<readonly DiscoveredCommand[]> {
  const dir = pathFromDir(options.dir);
  const extensions = normalizeExtensions(
    options.extensions ?? getDefaultExtensions(),
  );
  const entryFileName = normalizeEntryFileName(options.entryFileName);
  const files = await collectCommandFiles(dir, extensions);
  if (files.length < 1) {
    throw new TypeError(`No command modules found in ${dir}.`);
  }

  const seen = new Map<string, string>();
  const discovered: DiscoveredCommand[] = [];
  for (const filePath of files) {
    const path = commandPathFromFile(dir, filePath, extensions, entryFileName);
    const key = commandPathKey(path);
    const previous = seen.get(key);
    if (previous != null) {
      const displayPath = displayCommandPath(path);
      throw new TypeError(
        `Duplicate command path "${displayPath}" from ${previous} and ${filePath}.`,
      );
    }
    seen.set(key, filePath);

    const mod = await import(pathToFileURL(filePath).href) as {
      readonly default?: unknown;
    };
    const commandDefinition = commandFromModuleExport(filePath, mod.default);
    validateDeclaredCommandPath(
      commandDefinition,
      path,
      filePath,
      "file path",
    );
    discovered.push({ path, filePath, command: commandDefinition });
  }

  return sortCommands(discovered);
}

/**
 * Converts a static module map into command entries.
 *
 * This is useful for bundlers and single-file packagers that can statically
 * see module maps, such as `import.meta.glob(..., { eager: true })`, while
 * still deriving command paths from file-like module keys.
 *
 * @template R The program-level resource used by commands without their own
 *             `beforeEach` hook.
 * @param modules Static module map keyed by module path.
 * @param options Module path derivation options.
 * @returns Command entries sorted by command path.
 * @throws {TypeError} If options are invalid, no command modules are found,
 *         command paths are duplicated, a module does not default-export a
 *         command created with `defineCommand()`, or an explicit command
 *         `path` does not match the module-derived path.
 * @since 1.2.0
 */
export function commandsFromModules<R = unknown>(
  modules: ModuleMap,
  options: CommandsFromModulesOptions = {},
): readonly ModuleCommand<R>[] {
  if (Array.isArray(modules)) {
    throw new TypeError("Expected object, got array.");
  }
  if (modules == null || typeof modules !== "object") {
    throw new TypeError("Expected object.");
  }
  const base = normalizeModuleBase(options.base);
  const extensions = normalizeExtensions(
    options.extensions ?? getDefaultExtensions(),
  );
  const entryFileName = normalizeEntryFileName(options.entryFileName);
  const modulePaths = Object.keys(modules).toSorted((a, b) =>
    a.localeCompare(b)
  );

  const seen = new Map<string, string>();
  const discovered: ModuleCommand<R>[] = [];
  for (const modulePath of modulePaths) {
    const moduleBaseName = posix.basename(modulePath);
    if (
      isDeclarationFile(moduleBaseName) ||
      isTestFile(moduleBaseName, extensions) ||
      !extensions.some((ext) => modulePath.endsWith(ext))
    ) {
      continue;
    }

    const path = commandPathFromModulePath(
      base,
      modulePath,
      extensions,
      entryFileName,
    );
    const key = commandPathKey(path);
    const previous = seen.get(key);
    if (previous != null) {
      const displayPath = displayCommandPath(path);
      throw new TypeError(
        `Duplicate command path "${displayPath}" from ${previous} and ${modulePath}.`,
      );
    }
    seen.set(key, modulePath);

    // ModuleMap values are opaque at this boundary.  R is the caller's shared
    // resource contract for commands whose own beforeEach does not replace it.
    const commandDefinition = commandFromModuleExport(
      modulePath,
      modules[modulePath],
    ) as RunProgramCommand<R>;
    validateDeclaredCommandPath(
      commandDefinition,
      path,
      modulePath,
      "module path",
    );
    discovered.push({ path, modulePath, command: commandDefinition });
  }

  if (discovered.length < 1) {
    throw new TypeError("No command modules found in module map.");
  }
  return sortCommands(discovered);
}

/**
 * Builds a parser that dispatches to discovered command handlers.
 *
 * @param commands Commands to compose.
 * @param metadata Optional root documentation metadata.
 * @returns A parser that resolves to an internal command invocation.
 * @throws {TypeError} If no commands are provided or command paths are
 *         duplicated.
 * @since 1.1.0
 */
export function createProgramParser(
  commands: readonly CommandEntry[],
  options: CreateProgramParserOptions = {},
): FluentParser<Mode, ProgramInvocation, unknown> {
  if (commands.length < 1) {
    throw new TypeError("createProgramParser() requires at least one command.");
  }
  const sortedCommands = sortCommands(commands);
  rejectDuplicatePaths(
    sortedCommands.map((entry) => ({
      path: entry.path,
      filePath: displayCommandPath(entry.path),
    })),
  );
  const rootNode = buildCommandTree(sortedCommands);
  const parser = buildNodeParser(rootNode);
  return fluent(withRootDocs(parser, sortedCommands, options));
}

/**
 * Discovers and runs a command program.
 *
 * @template R The resource made available by program-level lifecycle hooks.
 * @param options Program options.
 * @returns A promise that resolves after the selected command handler
 *          completes.
 * @throws {TypeError} If discovery or command loading fails, or `hooks` is
 *         malformed.
 * @since 1.1.0
 */
export async function runProgram<R = unknown>(
  options: RunProgramOptions<R>,
): Promise<void> {
  if (Array.isArray(options)) {
    throw new TypeError("Expected object, got array.");
  }
  if (options == null || typeof options !== "object") {
    throw new TypeError("Expected object.");
  }
  if (options.hooks != null) validateHooks(options.hooks, "Program");
  let commands: readonly Pick<DiscoveredCommand, "path" | "command">[];
  if (isStaticRunProgramOptions(options)) {
    commands = staticCommandsToEntries(options.commands);
  } else {
    commands = await discoverCommands({
      dir: options.dir,
      extensions: options.extensions,
      entryFileName: options.entryFileName,
    });
  }
  const parser = createProgramParser(commands, {
    ...options.metadata,
    commandList: options.commandList,
  });
  const invocation = await runAsync(parser, buildRunOptions(options));
  await dispatchInvocation(invocation, options.hooks);
}

/**
 * Runs a command handler wrapped in the program-level and command-level
 * lifecycle hooks.
 *
 * The hooks nest: the program-level `beforeEach` runs first, then the command's
 * `beforeEach`, then the handler; `afterEach` and `onError` unwind in reverse,
 * with the command-level hook running before the program-level one.
 *
 * @param invocation The selected command invocation.
 * @param programHooks Program-level hooks, if any.
 * @returns A promise that resolves after the handler and matching hooks
 *          complete.
 * @throws The original error thrown by `beforeEach`, the handler, or
 *         `afterEach`, re-thrown after the `onError` hooks run.
 */
async function dispatchInvocation<R>(
  invocation: ProgramInvocation,
  programHooks: ProgramHooks<R> | undefined,
): Promise<void> {
  // Command collections erase each command's resource type because commands
  // may use different resources.  The dispatcher only forwards the value
  // between callbacks from the same hook scope.
  const commandHooks = invocation.command.hooks as
    | ProgramHooks<unknown>
    | undefined;
  await runHookScope(
    programHooks,
    invocation,
    (programContext) =>
      runHookScope(
        commandHooks,
        invocation,
        (commandContext) => {
          // Pass the hook context only when a beforeEach actually produced one,
          // using the most specific scope.  When no beforeEach ran, call the
          // handler with just the value so handlers see the exact single-argument
          // call shape of a plain runProgram() without hooks.
          if (commandHooks?.beforeEach != null) {
            return invocation.handler(invocation.value, commandContext);
          }
          if (programHooks?.beforeEach != null) {
            return invocation.handler(invocation.value, programContext);
          }
          return invocation.handler(invocation.value);
        },
        programContext,
      ),
  );
}

/**
 * Runs an inner step wrapped in a single set of lifecycle hooks.
 *
 * @param hooks The hooks for this scope, if any.
 * @param invocation The selected command invocation passed to `beforeEach`.
 * @param inner The step to wrap; receives the context from `beforeEach`.
 * @param fallbackContext The context used when `beforeEach` is absent.
 * @returns The value returned by `inner`.
 * @throws The original error thrown by `beforeEach`, `inner`, or `afterEach`,
 *         re-thrown after `onError` runs.  An error thrown by `onError` itself
 *         is suppressed so it cannot mask the original failure.
 */
async function runHookScope<R>(
  hooks: ProgramHooks<R> | undefined,
  invocation: ProgramInvocation,
  inner: (context: ProgramHookContext<R>) => unknown | Promise<unknown>,
  fallbackContext: ProgramHookContext<R> = {},
): Promise<unknown> {
  let context: ProgramHookContext<R> = hooks?.beforeEach == null
    ? fallbackContext
    : {};
  try {
    // Default a nullish beforeEach result to an empty context so afterEach,
    // onError, and the handler never receive null/undefined.
    if (hooks?.beforeEach != null) {
      context = (await hooks.beforeEach(invocation)) ?? {};
    }
    const result = await inner(context);
    if (hooks?.afterEach != null) await hooks.afterEach(context, result);
    return result;
  } catch (error) {
    if (hooks?.onError != null) {
      try {
        await hooks.onError(context, error);
      } catch {
        // An onError hook that itself throws must not replace the original
        // failure: runProgram() always re-throws the original error so the
        // process exit code stays tied to the real cause.
      }
    }
    throw error;
  }
}

/**
 * Root help metadata for {@link createProgramParser}.
 *
 * @since 1.1.0
 */
export interface ProgramHelpMetadata {
  /**
   * Brief text shown before the command list.
   */
  readonly brief?: Message;

  /**
   * Detailed text shown before the command list.
   */
  readonly description?: Message;

  /**
   * Footer text shown after the command list.
   */
  readonly footer?: Message;
}

/**
 * Options for {@link createProgramParser}.
 *
 * @since 1.2.0
 */
export interface CreateProgramParserOptions extends ProgramHelpMetadata {
  /**
   * How to render command lists in top-level help pages.
   *
   * @default `"recursive"`
   */
  readonly commandList?: RunOptions["commandList"];
}

interface CommandTreeNode {
  readonly children: Map<string, CommandTreeNode>;
  command?: AnyCommand;
  path?: CommandPath;
}

type MutableSourceContext = {
  -readonly [K in keyof SourceContext<unknown>]: SourceContext<unknown>[K];
};

function getRuntime(): "node" | "deno" | "bun" {
  if ("Deno" in globalThis) return "deno";
  if ("Bun" in globalThis) return "bun";
  return "node";
}

function hasNodeTypeScriptLoader(
  execArgv: readonly string[],
  nodeOptions: string,
  nativeSupport: boolean,
): boolean {
  const haystack = [...execArgv, nodeOptions].join(" ");
  return nativeSupport ||
    /\b(?:tsx|ts-node|tsimp|jiti)\b/.test(haystack) ||
    /--(?:experimental-)?transform-types\b/.test(haystack) ||
    /--experimental-strip-types\b/.test(haystack);
}

function hasNativeNodeTypeScriptSupport(): boolean {
  const features = process.features as
    | (typeof process.features & {
      readonly typescript?: unknown;
    })
    | undefined;
  return features?.typescript === "strip" ||
    features?.typescript === "transform";
}

function pathFromDir(dir: string | URL): string {
  return typeof dir === "string" ? resolve(dir) : fileURLToPath(dir);
}

function normalizeExtensions(extensions: readonly string[]): readonly string[] {
  if (extensions.length < 1) {
    throw new TypeError("At least one command file extension is required.");
  }
  const normalized: string[] = [];
  for (const extension of extensions) {
    if (!extension.startsWith(".") || extension.length < 2) {
      throw new TypeError(
        `Command file extension must start with a dot: ${extension}`,
      );
    }
    if (!normalized.includes(extension)) normalized.push(extension);
  }
  return normalized.toSorted((a, b) =>
    b.length - a.length || a.localeCompare(b)
  );
}

function normalizeEntryFileName(
  entryFileName: string | false | undefined,
): string | false {
  if (entryFileName === undefined) return "index";
  if (entryFileName === false) return false;
  if (typeof entryFileName !== "string") {
    throw new TypeError(
      `Command entry file name must be a non-empty file name: ${entryFileName}`,
    );
  }
  const normalized = entryFileName;
  if (
    normalized.length < 1 ||
    normalized.includes("/") ||
    normalized.includes("\\")
  ) {
    throw new TypeError(
      `Command entry file name must be a non-empty file name: ${normalized}`,
    );
  }
  return normalized;
}

function normalizeModuleBase(base: string | undefined): string {
  if (base === undefined) return ".";
  if (typeof base !== "string" || base.length < 1) {
    throw new TypeError(`Module base path must be a non-empty string: ${base}`);
  }
  return normalizeModulePath(base);
}

async function collectCommandFiles(
  dir: string,
  extensions: readonly string[],
  activeDirs = new Set<string>(),
): Promise<readonly string[]> {
  const canonicalDir = await realpath(dir);
  if (activeDirs.has(canonicalDir)) return [];
  const nextActiveDirs = new Set(activeDirs);
  nextActiveDirs.add(canonicalDir);

  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (
    const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))
  ) {
    const path = resolve(dir, entry.name);
    const entryType = await getCommandFileEntryType(path, entry);
    if (entryType === "directory") {
      files.push(
        ...await collectCommandFiles(path, extensions, nextActiveDirs),
      );
    } else if (
      entryType === "file" &&
      !isDeclarationFile(entry.name) &&
      !isTestFile(entry.name, extensions) &&
      extensions.some((ext) => entry.name.endsWith(ext))
    ) {
      files.push(path);
    }
  }
  return files;
}

async function getCommandFileEntryType(
  path: string,
  entry: {
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  },
): Promise<"directory" | "file" | undefined> {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  if (!entry.isSymbolicLink()) return undefined;
  try {
    const target = await stat(path);
    if (target.isDirectory()) return "directory";
    if (target.isFile()) return "file";
    return undefined;
  } catch {
    return undefined;
  }
}

function isDeclarationFile(fileName: string): boolean {
  return /\.d\.[cm]?ts$/.test(fileName);
}

function isTestFile(
  fileName: string,
  extensions: readonly string[],
): boolean {
  const matchedExtension = extensions.find((ext) => fileName.endsWith(ext));
  if (matchedExtension == null) return false;
  const base = fileName.slice(0, -matchedExtension.length);
  return base.endsWith(".test") || base.endsWith(".spec");
}

function commandPathFromFile(
  rootDir: string,
  filePath: string,
  extensions: readonly string[],
  entryFileName: string | false,
): CommandPath {
  const withoutExtension = stripCommandExtension(filePath, extensions);
  const relativePath = relative(rootDir, withoutExtension);
  const path = relativePath.split(sep).filter((segment) => segment.length > 0);
  return commandPathFromSegments(path, filePath, entryFileName);
}

function commandPathFromModulePath(
  base: string,
  modulePath: string,
  extensions: readonly string[],
  entryFileName: string | false,
): CommandPath {
  const withoutExtension = stripCommandExtension(modulePath, extensions);
  const relativePath = relativeModulePath(base, withoutExtension, modulePath);
  const path = relativePath.split("/").filter((segment) => segment.length > 0);
  return commandPathFromSegments(path, modulePath, entryFileName);
}

function stripCommandExtension(
  path: string,
  extensions: readonly string[],
): string {
  const matchedExtension = extensions.find((ext) => path.endsWith(ext));
  if (matchedExtension == null) {
    throw new TypeError(`No configured extension matches ${path}.`);
  }
  return path.slice(0, -matchedExtension.length);
}

function relativeModulePath(
  base: string,
  modulePath: string,
  originalModulePath: string,
): string {
  const normalizedPath = normalizeModulePath(modulePath);
  const relativePath = posix.relative(base, normalizedPath);
  if (
    relativePath.length < 1 ||
    relativePath === ".." ||
    relativePath.startsWith("../") ||
    posix.isAbsolute(relativePath)
  ) {
    throw new TypeError(
      `Module path ${originalModulePath} is not under base path ${base}.`,
    );
  }
  return relativePath;
}

function normalizeModulePath(path: string): string {
  return posix.normalize(path.replaceAll("\\", "/"));
}

function commandPathFromSegments(
  path: readonly string[],
  source: string,
  entryFileName: string | false,
): CommandPath {
  if (path.length < 1) {
    throw new TypeError(`Command module ${source} does not define a path.`);
  }
  if (entryFileName !== false && path[path.length - 1] === entryFileName) {
    return path.slice(0, -1);
  }
  return path;
}

function commandPathKey(path: readonly string[]): string {
  return path.join("\0");
}

function displayCommandPath(path: readonly string[]): string {
  return path.length < 1 ? "<root>" : path.join(" ");
}

function isCommandPath(path: unknown): path is CommandPath {
  return Array.isArray(path) &&
    path.every((segment) => typeof segment === "string" && segment.length > 0);
}

function rejectDuplicatePaths(
  commands: readonly Pick<DiscoveredCommand, "path" | "filePath">[],
): void {
  const seen = new Map<string, string>();
  for (const entry of commands) {
    const key = commandPathKey(entry.path);
    const previous = seen.get(key);
    if (previous != null) {
      const displayPath = displayCommandPath(entry.path);
      throw new TypeError(
        `Duplicate command path "${displayPath}" from ${previous} and ${entry.filePath}.`,
      );
    }
    seen.set(key, entry.filePath);
  }
}

function sortCommands<T extends Pick<DiscoveredCommand, "path">>(
  commands: readonly T[],
): readonly T[] {
  return commands.toSorted((a, b) =>
    commandPathKey(a.path).localeCompare(commandPathKey(b.path))
  );
}

function isStaticRunProgramOptions<R>(
  options: RunProgramOptions<R>,
): options is RunProgramStaticOptions<R> {
  const hasCommands = "commands" in options && options.commands != null;
  const hasDir = "dir" in options && options.dir != null;
  if (hasCommands === hasDir) {
    throw new TypeError(
      "runProgram() requires exactly one of dir or commands.",
    );
  }
  return hasCommands;
}

function staticCommandsToEntries<R>(
  commands: readonly (
    | RunProgramStaticCommand<R>
    | RunProgramCommandEntry<R>
  )[],
): readonly CommandEntry[] {
  return commands.map((entry) => {
    if (isCommandEntry(entry)) return entry;
    if (!isCommand(entry)) {
      throw new TypeError(
        "Static command entries must be created with defineCommand().",
      );
    }
    if (!isCommandPath(entry.path)) {
      throw new TypeError(
        "Static command entries must declare a path.",
      );
    }
    return {
      path: entry.path,
      command: entry,
    };
  });
}

function isCommandEntry(value: unknown): value is CommandEntry {
  return value != null &&
    typeof value === "object" &&
    isCommandPath((value as { readonly path?: unknown }).path) &&
    isCommand((value as { readonly command?: unknown }).command);
}

function unwrapCommandExport(value: unknown): AnyCommand | undefined {
  let current = value;
  for (let depth = 0; depth < 3; depth++) {
    if (isCommand(current)) return current;
    if (current == null || typeof current !== "object") return undefined;
    const nestedDefault = (current as { readonly default?: unknown }).default;
    if (Object.is(nestedDefault, current)) return undefined;
    current = nestedDefault;
  }
  return undefined;
}

function commandFromModuleExport(source: string, value: unknown): AnyCommand {
  const commandDefinition = unwrapCommandExport(value);
  if (commandDefinition == null) {
    throw new TypeError(
      `Module ${source} default export must be created with defineCommand().`,
    );
  }
  return commandDefinition;
}

function validateDeclaredCommandPath(
  commandDefinition: AnyCommand,
  path: CommandPath,
  source: string,
  sourcePathLabel: "file path" | "module path",
): void {
  if (
    commandDefinition.path != null &&
    commandPathKey(commandDefinition.path) !== commandPathKey(path)
  ) {
    throw new TypeError(
      `Module ${source} declares command path "${
        displayCommandPath(commandDefinition.path)
      }" but ${sourcePathLabel} defines "${displayCommandPath(path)}".`,
    );
  }
}

function buildCommandTree(
  commands: readonly CommandEntry[],
): CommandTreeNode {
  const root: CommandTreeNode = { children: new Map() };
  for (const entry of commands) {
    let current = root;
    for (const segment of entry.path) {
      let child = current.children.get(segment);
      if (child == null) {
        child = { children: new Map() };
        current.children.set(segment, child);
      }
      current = child;
    }
    current.command = entry.command;
    current.path = entry.path;
  }
  return root;
}

function buildNodeParser(
  node: CommandTreeNode,
  inheritedHidden?: HiddenVisibility,
): Parser<Mode, ProgramInvocation, unknown> {
  const childParser = buildChildrenParser(node, inheritedHidden);
  if (childParser != null && node.command != null) {
    return createExecutableNodeParser(
      childParser,
      node.command,
      node.path ?? [],
    );
  }
  if (childParser != null) return childParser;
  if (node.command != null) {
    return createLeafParser(node.command, node.path ?? []);
  }
  throw new TypeError("Command tree node must contain a command.");
}

interface ExecutableNodeState {
  readonly branch: number;
  readonly result: ParserResult<unknown>;
  readonly committed: boolean;
}

type ExecutableNodeParserState = ExecutableNodeState | undefined;

function createExecutableNodeParser(
  childParser: Parser<Mode, ProgramInvocation, unknown>,
  commandDefinition: AnyCommand,
  path: CommandPath,
): Parser<Mode, ProgramInvocation, ExecutableNodeParserState> {
  const leafParser = createLeafParser(commandDefinition, path, true);
  const branchParsers = [childParser, leafParser] as const;
  const parser = longestMatch(
    childParser,
    leafParser,
  ) as Parser<Mode, ProgramInvocation, unknown>;
  const phase2SeedHook = findPhase2SeedHook(parser);
  const executableParser: Parser<
    Mode,
    ProgramInvocation,
    ExecutableNodeParserState
  > = {
    ...parser,
    $valueType: [],
    $stateType: [],
    initialState: undefined,
    parse(context) {
      const activeState = normalizeExecutableNodeState(context.state);
      if (activeState?.committed === true && activeState.result.success) {
        const branchParser = branchParsers[activeState.branch];
        const result = branchParser.parse(
          withExecutableNodeChildContext(
            context,
            activeState.branch,
            inheritAnnotations(context.state, activeState.result.next.state),
            branchParser,
          ),
        );
        return mapModeValue(
          parser.mode,
          wrapForMode(parser.mode, result),
          (resolved) => wrapBranchParseResult(context, activeState, resolved),
        );
      }

      const result = parser.parse({
        ...context,
        state: toExclusiveState(activeState, context.state),
      });
      return mapModeValue(
        parser.mode,
        wrapForMode(parser.mode, result),
        (resolved) => wrapInitialParseResult(context, resolved),
      );
    },
    complete(state, exec) {
      const activeState = normalizeExecutableNodeState(state);
      if (activeState?.result.success === true) {
        return wrapForMode(
          parser.mode,
          branchParsers[activeState.branch].complete(
            inheritAnnotations(state, activeState.result.next.state),
            withExecutableNodeChildExecPath(exec, activeState.branch),
          ),
        );
      }
      if (activeState == null) {
        return wrapForMode(
          parser.mode,
          completeExecutableNodeLeaf(state, exec, leafParser),
        );
      }
      return wrapForMode(
        parser.mode,
        parser.complete(toExclusiveState(activeState, state), exec),
      );
    },
    suggest(context, prefix) {
      const activeState = normalizeExecutableNodeState(context.state);
      if (activeState?.committed === true && activeState.result.success) {
        const branchParser = branchParsers[activeState.branch];
        return branchParser.suggest(
          withExecutableNodeChildContext(
            context,
            activeState.branch,
            inheritAnnotations(context.state, activeState.result.next.state),
            branchParser,
          ),
          prefix,
        );
      }
      return parser.suggest({
        ...context,
        state: toExclusiveState(activeState, context.state),
      }, prefix);
    },
    getSuggestRuntimeNodes(state, path): readonly RuntimeNode[] {
      const activeState = normalizeExecutableNodeState(state);
      if (activeState == null) {
        const branchPath = [...path, 1];
        const branchState = inheritAnnotations(state, leafParser.initialState);
        return getExecutableNodeBranchSuggestRuntimeNodes(
          leafParser,
          branchState,
          branchPath,
        );
      }
      if (activeState?.result.success !== true) {
        return parser.getSuggestRuntimeNodes?.(
          toExclusiveState(activeState, state),
          path,
        ) ?? [];
      }
      const branchParser = branchParsers[activeState.branch];
      const branchPath = [...path, activeState.branch];
      const branchState = inheritAnnotations(
        state,
        activeState.result.next.state,
      );
      return getExecutableNodeBranchSuggestRuntimeNodes(
        branchParser,
        branchState,
        branchPath,
      );
    },
    getDocFragments(state, defaultValue) {
      const activeState = state.kind === "available"
        ? normalizeExecutableNodeState(state.state)
        : undefined;
      const fragments = parser.getDocFragments(
        state.kind === "available"
          ? {
            kind: "available",
            state: toExclusiveState(activeState, state.state),
          }
          : state,
        defaultValue,
      );
      if (activeState == null) {
        return withCommandDocMetadata(fragments, commandDefinition.metadata);
      }
      return fragments;
    },
  };
  if (phase2SeedHook != null) {
    Object.defineProperty(executableParser, phase2SeedHook.key, {
      value(state: unknown, exec?: ExecutionContext) {
        return extractExecutableNodePhase2Seed(
          state,
          exec,
          leafParser,
          phase2SeedHook,
        );
      },
      configurable: true,
      enumerable: true,
    });
  }
  return executableParser;
}

function getExecutableNodeBranchSuggestRuntimeNodes(
  parser: Parser<Mode, ProgramInvocation, unknown>,
  state: unknown,
  path: readonly PropertyKey[],
): readonly RuntimeNode[] {
  return parser.getSuggestRuntimeNodes?.(state, path) ??
    (parser.dependencyMetadata?.source != null
      ? [{ path, parser, state }]
      : []);
}

interface Phase2SeedHook {
  readonly key: symbol;
  readonly extract: (state: unknown, exec?: ExecutionContext) => unknown;
}

const phase2SeedSymbolDescription = "@optique/core/extractPhase2Seed";

function findPhase2SeedHook(parser: object): Phase2SeedHook | undefined {
  for (const key of Object.getOwnPropertySymbols(parser)) {
    if (key.description !== phase2SeedSymbolDescription) continue;
    const value = Reflect.get(parser, key);
    if (typeof value !== "function") continue;
    return {
      key,
      extract(state, exec) {
        const seed: unknown = Reflect.apply(value, parser, [state, exec]);
        return seed;
      },
    };
  }
  return undefined;
}

function completeExecutableNodeLeaf(
  state: unknown,
  exec: ExecutionContext | undefined,
  leafParser: Parser<Mode, ProgramInvocation, unknown>,
) {
  const result = parseExecutableNodeLeaf(state, exec, leafParser);
  return dispatchByMode(
    leafParser.mode,
    () =>
      wrapForMode(
        "sync",
        completeParsedExecutableNodeLeaf(
          state,
          exec,
          leafParser,
          wrapForMode("sync", result),
        ),
      ),
    () =>
      Promise.resolve(wrapForMode("async", result)).then((resolved) =>
        wrapForMode(
          "async",
          completeParsedExecutableNodeLeaf(state, exec, leafParser, resolved),
        )
      ),
  );
}

function completeParsedExecutableNodeLeaf(
  state: unknown,
  exec: ExecutionContext | undefined,
  leafParser: Parser<Mode, ProgramInvocation, unknown>,
  result: ParserResult<unknown>,
) {
  const childExec = withExecutableNodeChildExecPath(exec, 1);
  const nextExec = result.success
    ? mergeExecutableNodeChildExec(childExec, result.next.exec)
    : childExec;
  const nextState = result.success
    ? inheritAnnotations(state, result.next.state)
    : inheritAnnotations(state, leafParser.initialState);
  return leafParser.complete(nextState, nextExec);
}

function extractExecutableNodePhase2Seed(
  state: unknown,
  exec: ExecutionContext | undefined,
  leafParser: Parser<Mode, ProgramInvocation, unknown>,
  phase2SeedHook: Phase2SeedHook,
) {
  const activeState = normalizeExecutableNodeState(state);
  if (activeState != null) {
    return phase2SeedHook.extract(toExclusiveState(activeState, state), exec);
  }
  const result = parseExecutableNodeLeaf(state, exec, leafParser);
  return dispatchByMode(
    leafParser.mode,
    () =>
      extractParsedExecutableNodePhase2Seed(
        state,
        exec,
        wrapForMode("sync", result),
        phase2SeedHook,
      ),
    () =>
      Promise.resolve(wrapForMode("async", result)).then((resolved) =>
        extractParsedExecutableNodePhase2Seed(
          state,
          exec,
          resolved,
          phase2SeedHook,
        )
      ),
  );
}

function extractParsedExecutableNodePhase2Seed(
  state: unknown,
  exec: ExecutionContext | undefined,
  result: ParserResult<unknown>,
  phase2SeedHook: Phase2SeedHook,
) {
  if (!result.success) {
    return phase2SeedHook.extract(toExclusiveState(undefined, state), exec);
  }
  const executableState = inheritAnnotations(state, {
    branch: 1,
    result,
    committed: false,
  });
  return phase2SeedHook.extract(toExclusiveState(executableState, state), exec);
}

function parseExecutableNodeLeaf(
  state: unknown,
  exec: ExecutionContext | undefined,
  leafParser: Parser<Mode, ProgramInvocation, unknown>,
) {
  const childExec = withExecutableNodeChildExecPath(exec, 1);
  const childContext: ParserContext<unknown> = {
    buffer: [],
    optionsTerminated: false,
    usage: leafParser.usage,
    state: inheritAnnotations(state, leafParser.initialState),
    ...(childExec != null
      ? {
        exec: childExec,
        dependencyRegistry: childExec.dependencyRegistry,
      }
      : {}),
  };
  return leafParser.parse(childContext);
}

function normalizeExecutableNodeState(
  state: unknown,
): ExecutableNodeParserState {
  if (
    state == null ||
    typeof state !== "object" ||
    !("branch" in state) ||
    !("result" in state)
  ) {
    return undefined;
  }
  const branch = (state as { readonly branch?: unknown }).branch;
  if (branch !== 0 && branch !== 1) return undefined;
  const result = (state as { readonly result?: unknown }).result;
  if (
    result == null ||
    typeof result !== "object" ||
    typeof (result as { readonly success?: unknown }).success !== "boolean"
  ) {
    return undefined;
  }
  return inheritAnnotations(state, {
    branch,
    result: result as ParserResult<unknown>,
    committed: (state as { readonly committed?: unknown }).committed === true,
  });
}

function toExclusiveState(
  state: ExecutableNodeParserState,
  sourceState: unknown = state,
): unknown {
  const exclusiveState = state == null
    ? undefined
    : [state.branch, state.result] as [number, ParserResult<unknown>];
  return inheritAnnotations(sourceState, exclusiveState);
}

function fromExclusiveState(
  state: unknown,
): ExecutableNodeParserState {
  if (
    !Array.isArray(state) ||
    state.length !== 2 ||
    (state[0] !== 0 && state[0] !== 1)
  ) {
    return undefined;
  }
  return inheritAnnotations(state, {
    branch: state[0],
    result: state[1] as ParserResult<unknown>,
    committed: isCommittedResult(state[1]),
  });
}

function isCommittedResult(result: unknown): boolean {
  return result != null &&
    typeof result === "object" &&
    (result as { readonly success?: unknown }).success === true &&
    Array.isArray((result as { readonly consumed?: unknown }).consumed) &&
    (result as { readonly consumed: readonly unknown[] }).consumed.length > 0;
}

function wrapInitialParseResult(
  _context: ParserContext<ExecutableNodeParserState>,
  result: ParserResult<unknown>,
): ParserResult<ExecutableNodeParserState> {
  if (!result.success) return result;
  return {
    success: true,
    consumed: result.consumed,
    provisional: result.provisional,
    next: {
      ...result.next,
      state: fromExclusiveState(result.next.state),
    },
  };
}

function wrapBranchParseResult(
  context: ParserContext<ExecutableNodeParserState>,
  activeState: ExecutableNodeState,
  result: ParserResult<unknown>,
): ParserResult<ExecutableNodeParserState> {
  if (!result.success) return result;
  const mergedExec = mergeExecutableNodeChildExec(
    context.exec,
    result.next.exec,
  );
  const dependencyRegistry = mergedExec?.dependencyRegistry ??
    result.next.dependencyRegistry ?? context.dependencyRegistry;
  const nextState = inheritAnnotations(result.next.state, {
    branch: activeState.branch,
    result,
    committed: activeState.committed || result.consumed.length > 0,
  });
  return {
    success: true,
    consumed: result.consumed,
    provisional: result.provisional,
    next: {
      ...context,
      buffer: result.next.buffer,
      optionsTerminated: result.next.optionsTerminated,
      state: inheritAnnotations(context.state, nextState),
      ...(mergedExec != null
        ? { exec: mergedExec, trace: mergedExec.trace }
        : {}),
      ...(dependencyRegistry != null ? { dependencyRegistry } : {}),
    },
  };
}

function withExecutableNodeChildContext(
  context: ParserContext<ExecutableNodeParserState>,
  branch: number,
  state: unknown,
  parser: Parser<Mode, ProgramInvocation, unknown>,
): ParserContext<unknown> {
  const exec = withExecutableNodeChildExecPath(context.exec, branch);
  const dependencyRegistry = context.dependencyRegistry ??
    exec?.dependencyRegistry;
  return {
    ...context,
    state,
    usage: parser.usage,
    ...(exec != null
      ? {
        exec: dependencyRegistry === exec.dependencyRegistry
          ? exec
          : { ...exec, dependencyRegistry },
        dependencyRegistry,
      }
      : {}),
  };
}

function withExecutableNodeChildExecPath(
  exec: ExecutionContext | undefined,
  branch: number,
): ExecutionContext | undefined {
  if (exec == null) return undefined;
  return {
    ...exec,
    path: [...(exec.path ?? []), branch],
  };
}

function mergeExecutableNodeChildExec(
  parent: ExecutionContext | undefined,
  child: ExecutionContext | undefined,
): ExecutionContext | undefined {
  if (parent == null) return child;
  if (child == null) return parent;
  return {
    ...parent,
    trace: child.trace ?? parent.trace,
    dependencyRuntime: child.dependencyRuntime ?? parent.dependencyRuntime,
    dependencyRegistry: child.dependencyRegistry ?? parent.dependencyRegistry,
    commandPath: child.commandPath ?? parent.commandPath,
    preCompletedByParser: child.preCompletedByParser ??
      parent.preCompletedByParser,
    excludedSourceFields: child.excludedSourceFields ??
      parent.excludedSourceFields,
  };
}

function withCommandDocMetadata(
  fragments: DocFragments,
  metadata: CommandMetadata | undefined,
): DocFragments {
  if (metadata == null) return fragments;
  return {
    ...fragments,
    brief: fragments.brief ?? metadata.brief,
    description: fragments.description ?? metadata.description,
    footer: fragments.footer ?? metadata.footer,
  };
}

function buildChildrenParser(
  node: CommandTreeNode,
  inheritedHidden?: HiddenVisibility,
): Parser<Mode, ProgramInvocation, unknown> | undefined {
  const parsers: Parser<Mode, ProgramInvocation, unknown>[] = [];
  for (const [name, child] of node.children) {
    const childHidden = mergeHidden(
      inheritedHidden,
      child.command?.metadata?.hidden,
    );
    const childParser = buildNodeParser(child, childHidden);
    if (child.children.size > 0) {
      parsers.push(
        createNamespaceCommandParser(
          name,
          childParser,
          child.command,
          inheritedHidden,
        ),
      );
    } else {
      parsers.push(
        command(
          name,
          childParser,
          commandMetadataWithInheritedHidden(
            child.command?.metadata,
            inheritedHidden,
          ),
        ),
      );
    }
  }
  if (parsers.length < 1) return undefined;
  if (parsers.length === 1) return parsers[0];
  return or(...parsers) as Parser<Mode, ProgramInvocation, unknown>;
}

function createNamespaceCommandParser(
  name: string,
  childParser: Parser<Mode, ProgramInvocation, unknown>,
  commandDefinition: AnyCommand | undefined,
  inheritedHidden?: HiddenVisibility,
): Parser<Mode, ProgramInvocation, unknown> {
  const metadata = commandDefinition?.metadata;
  const parser: Parser<Mode, ProgramInvocation, unknown> = command(
    name,
    childParser,
    namespaceCommandMetadata(metadata, inheritedHidden),
  );
  const description = metadata?.brief ?? metadata?.description;
  if (description == null) return parser;
  return {
    ...parser,
    getDocFragments(state, defaultValue) {
      const fragments = parser.getDocFragments(state, defaultValue);
      if (
        state.kind !== "unavailable" &&
        (state.kind !== "available" ||
          !Object.is(state.state, parser.initialState))
      ) {
        return fragments;
      }
      return withNamespaceListDocDescription(fragments, name, description);
    },
  };
}

function withNamespaceListDocDescription(
  fragments: DocFragments,
  name: string,
  description: Message,
): DocFragments {
  return {
    ...fragments,
    fragments: fragments.fragments.map((fragment): DocFragment => {
      if (
        fragment.type !== "entry" ||
        fragment.term.type !== "command" ||
        fragment.term.name !== name
      ) {
        return fragment;
      }
      return {
        ...fragment,
        description: fragment.description ?? description,
      };
    }),
  };
}

function namespaceCommandMetadata(
  metadata: CommandMetadata | undefined,
  inheritedHidden?: HiddenVisibility,
): CommandMetadata | undefined {
  const hidden = mergeHidden(inheritedHidden, metadata?.hidden);
  if (
    metadata?.aliases == null &&
    metadata?.errors == null &&
    hidden == null &&
    metadata?.usageLine == null
  ) {
    return undefined;
  }
  return {
    ...(metadata?.aliases != null && { aliases: metadata.aliases }),
    ...(metadata?.errors != null && { errors: metadata.errors }),
    ...(hidden != null && { hidden }),
    ...(metadata?.usageLine != null && { usageLine: metadata.usageLine }),
  };
}

function commandMetadataWithInheritedHidden(
  metadata: CommandMetadata | undefined,
  inheritedHidden: HiddenVisibility | undefined,
): CommandMetadata | undefined {
  const hidden = mergeHidden(inheritedHidden, metadata?.hidden);
  if (metadata == null) {
    return hidden == null ? undefined : { hidden };
  }
  if (hidden === metadata.hidden) return metadata;
  return {
    ...metadata,
    ...(hidden != null && { hidden }),
  };
}

function createLeafParser(
  commandDefinition: AnyCommand,
  path: CommandPath,
  includeMetadata = false,
): Parser<Mode, ProgramInvocation, unknown> {
  const parser = map(commandDefinition.parser, (value): ProgramInvocation => ({
    command: commandDefinition,
    path,
    value,
    handler: commandDefinition.handler as (
      value: unknown,
      context?: ProgramHookContext,
    ) => void | Promise<void>,
  })) as Parser<Mode, ProgramInvocation, unknown>;
  if (!includeMetadata) return parser;
  return {
    ...parser,
    getDocFragments(state, defaultValue) {
      const fragments = parser.getDocFragments(state, defaultValue);
      return withCommandDocMetadata(fragments, commandDefinition.metadata);
    },
  };
}

function withRootDocs(
  parser: Parser<Mode, ProgramInvocation, unknown>,
  commands: readonly CommandEntry[],
  metadata: CreateProgramParserOptions,
): Parser<Mode, ProgramInvocation, unknown> {
  const rootState = parser.initialState;
  const rootCommand = commands.find((entry) => entry.path.length < 1);
  const commandsByPath = new Map(
    commands.map((entry) => [commandPathKey(entry.path), entry.command]),
  );
  const listedCommands = rootListedCommands(
    commands,
    commandsByPath,
    metadata.commandList ?? "recursive",
  );
  const rootDocs = (): DocFragments => {
    const fragments: DocFragment[] = [
      ...(rootCommand?.command.parser.getDocFragments({ kind: "unavailable" })
        .fragments ?? []),
    ];
    if (listedCommands.length > 0) {
      fragments.push({
        type: "section",
        entries: listedCommands.map((entry) => ({
          term: {
            type: "command",
            name: entry.path.join(" "),
            hidden: commandPathHidden(entry.path, commandsByPath),
          },
          description: entry.command.metadata?.brief ??
            entry.command.metadata?.description,
        })),
      });
    }
    return {
      brief: metadata.brief,
      description: metadata.description,
      footer: metadata.footer,
      fragments,
    };
  };
  return {
    ...parser,
    getDocFragments(
      state: DocState<unknown>,
      defaultValue?: ProgramInvocation,
    ): DocFragments {
      if (
        state.kind === "unavailable" ||
        (state.kind === "available" && Object.is(state.state, rootState))
      ) {
        return rootDocs();
      }
      return parser.getDocFragments(state, defaultValue);
    },
  };
}

function rootListedCommands(
  commands: readonly CommandEntry[],
  commandsByPath: ReadonlyMap<string, AnyCommand>,
  commandList: RunOptions["commandList"],
): readonly CommandEntry[] {
  const listedCommands = commands.filter((entry) => entry.path.length > 0);
  if (commandList !== "top-level" || listedCommands.length < 1) {
    return listedCommands;
  }

  const topLevelEntries = new Map<string, CommandEntry>();
  for (const entry of listedCommands) {
    const segment = entry.path[0];
    if (segment == null) continue;
    const path = [segment];
    const key = commandPathKey(path);
    if (topLevelEntries.has(key)) continue;

    const command = commandsByPath.get(key);
    if (command != null) {
      topLevelEntries.set(key, { path, command });
    } else if (!isDocHidden(commandPathHidden(entry.path, commandsByPath))) {
      topLevelEntries.set(key, {
        path,
        command: withoutCommandDocs(entry.command),
      });
    }
  }

  return [...topLevelEntries.values()];
}

function withoutCommandDocs(commandDefinition: AnyCommand): AnyCommand {
  if (commandDefinition.metadata == null) return commandDefinition;
  const { brief: _brief, description: _description, ...metadata } =
    commandDefinition.metadata;
  return {
    ...commandDefinition,
    metadata,
  };
}

function commandPathHidden(
  path: readonly string[],
  commandsByPath: ReadonlyMap<string, AnyCommand>,
): HiddenVisibility | undefined {
  let hidden: HiddenVisibility | undefined;
  for (let length = 1; length <= path.length; length++) {
    hidden = mergeHidden(
      hidden,
      commandsByPath.get(commandPathKey(path.slice(0, length)))?.metadata
        ?.hidden,
    );
  }
  return hidden;
}

function buildRunOptions<R>(options: RunProgramOptions<R>): RunOptions {
  const metadata = options.metadata;
  const {
    dir: _dir,
    commands: _commands,
    extensions: _extensions,
    entryFileName: _entryFileName,
    metadata: _metadata,
    hooks: _hooks,
    help,
    version,
    completion,
    ...rest
  } = options;
  const runOptions: RunOptions = {
    ...rest,
    contexts: unwrapProgramContexts(rest.contexts),
    programName: options.programName ?? metadata.name,
    brief: options.brief ?? metadata.brief,
    description: options.description ?? metadata.description,
    examples: options.examples ?? metadata.examples,
    author: options.author ?? metadata.author,
    bugs: options.bugs ?? metadata.bugs,
    footer: options.footer ?? metadata.footer,
    help: help === false ? undefined : help ?? "both",
    version: version === false
      ? undefined
      : version ?? (metadata.version == null ? undefined : metadata.version),
    completion: completion === false ? undefined : completion ?? "both",
  };
  return runOptions;
}

function unwrapProgramContexts(
  contexts: readonly SourceContext<unknown>[] | undefined,
): readonly SourceContext<unknown>[] | undefined {
  if (contexts == null) return undefined;
  return contexts.map(wrapProgramContext);
}

function wrapProgramContext(
  context: SourceContext<unknown>,
): SourceContext<unknown> {
  const wrapped: MutableSourceContext = {
    id: context.id,
    phase: context.phase,
    getAnnotations(request, options) {
      return context.getAnnotations(
        unwrapProgramContextRequest(request),
        options,
      );
    },
  };
  if (context.getInternalAnnotations != null) {
    wrapped.getInternalAnnotations = (request, annotations) => {
      return context.getInternalAnnotations!(
        unwrapProgramContextRequest(request) ?? request,
        annotations,
      );
    };
  }
  if (context[Symbol.dispose] != null) {
    wrapped[Symbol.dispose] = () => context[Symbol.dispose]!();
  }
  if (context[Symbol.asyncDispose] != null) {
    wrapped[Symbol.asyncDispose] = () => context[Symbol.asyncDispose]!();
  }
  return wrapped;
}

function unwrapProgramContextRequest(
  request: SourceContextRequest | undefined,
): SourceContextRequest | undefined {
  if (
    request?.phase === "phase2" &&
    isProgramInvocation(request.parsed)
  ) {
    return { phase: "phase2", parsed: request.parsed.value };
  }
  return request;
}

function isProgramInvocation(value: unknown): value is ProgramInvocation {
  if (value == null || typeof value !== "object") return false;
  const candidate = value as {
    readonly command?: unknown;
    readonly handler?: unknown;
  };
  return "value" in value &&
    isCommand(candidate.command) &&
    typeof candidate.handler === "function";
}
