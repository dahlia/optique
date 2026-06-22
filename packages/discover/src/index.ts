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
import { runAsync } from "@optique/run";
import type { RunOptions } from "@optique/run";
import { readdir, realpath, stat } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type AnyCommand,
  type AnyStaticCommand,
  type CommandMetadata,
  type CommandPath,
  isCommand,
} from "./command.ts";

export { defineCommand, isCommand } from "./command.ts";
export type {
  AnyCommand,
  AnyStaticCommand,
  Command,
  CommandDefinition,
  CommandMetadata,
  CommandPath,
  StaticCommand,
} from "./command.ts";

/**
 * The parsed command selected by a discovered command parser.
 *
 * Most applications receive this only indirectly through {@link runProgram},
 * which calls the handler automatically.
 *
 * @since 1.1.0
 */
export interface ProgramInvocation {
  /**
   * The command definition that matched the input.
   */
  readonly command: AnyCommand;

  /**
   * Parsed value produced by the command parser.
   */
  readonly value: unknown;

  /**
   * Handler to call with {@link ProgramInvocation.value}.
   */
  readonly handler: (value: unknown) => void | Promise<void>;
}

/**
 * A command found on disk.
 *
 * @since 1.1.0
 */
export interface DiscoveredCommand {
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

interface RunProgramBaseOptions extends
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
}

/**
 * Options for {@link runProgram} when discovering commands from files.
 *
 * @since 1.1.0
 */
export interface RunProgramDiscoveryOptions extends RunProgramBaseOptions {
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
 * @since 1.1.0
 */
export interface RunProgramStaticOptions extends RunProgramBaseOptions {
  /**
   * Commands to compose without file-system discovery.
   */
  readonly commands: readonly AnyStaticCommand[];

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
 * @since 1.1.0
 */
export type RunProgramOptions =
  | RunProgramDiscoveryOptions
  | RunProgramStaticOptions;

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
    const commandDefinition = unwrapCommandExport(mod.default);
    if (commandDefinition == null) {
      throw new TypeError(
        `Module ${filePath} default export must be created with defineCommand().`,
      );
    }
    if (
      commandDefinition.path != null &&
      commandPathKey(commandDefinition.path) !== commandPathKey(path)
    ) {
      throw new TypeError(
        `Module ${filePath} declares command path "${
          displayCommandPath(commandDefinition.path)
        }" but file path defines "${displayCommandPath(path)}".`,
      );
    }
    discovered.push({ path, filePath, command: commandDefinition });
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
  commands: readonly Pick<DiscoveredCommand, "path" | "command">[],
  metadata: ProgramHelpMetadata = {},
): Parser<Mode, ProgramInvocation, unknown> {
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
  return withRootDocs(parser, sortedCommands, metadata);
}

/**
 * Discovers and runs a command program.
 *
 * @param options Program options.
 * @returns A promise that resolves after the selected command handler
 *          completes.
 * @throws {TypeError} If discovery or command loading fails.
 * @since 1.1.0
 */
export async function runProgram(options: RunProgramOptions): Promise<void> {
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
  const parser = createProgramParser(commands, options.metadata);
  const invocation = await runAsync(parser, buildRunOptions(options));
  await invocation.handler(invocation.value);
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

interface CommandTreeNode {
  readonly children: Map<string, CommandTreeNode>;
  command?: AnyCommand;
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

function commandPathFromFile(
  rootDir: string,
  filePath: string,
  extensions: readonly string[],
  entryFileName: string | false,
): CommandPath {
  const matchedExtension = extensions.find((ext) => filePath.endsWith(ext));
  if (matchedExtension == null) {
    throw new TypeError(`No configured extension matches ${filePath}.`);
  }
  const withoutExtension = filePath.slice(0, -matchedExtension.length);
  const relativePath = relative(rootDir, withoutExtension);
  const path = relativePath.split(sep).filter((segment) => segment.length > 0);
  if (path.length < 1) {
    throw new TypeError(`Command file ${filePath} does not define a path.`);
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

function isStaticRunProgramOptions(
  options: RunProgramOptions,
): options is RunProgramStaticOptions {
  const hasCommands = "commands" in options && options.commands != null;
  const hasDir = "dir" in options && options.dir != null;
  if (hasCommands === hasDir) {
    throw new TypeError(
      "runProgram() requires exactly one of dir or commands.",
    );
  }
  return hasCommands;
}

function staticCommandsToEntries(
  commands: readonly AnyStaticCommand[],
): readonly Pick<DiscoveredCommand, "path" | "command">[] {
  return commands.map((command) => {
    if (!isCommand(command)) {
      throw new TypeError(
        "Static command entries must be created with defineCommand().",
      );
    }
    if (!isCommandPath(command.path)) {
      throw new TypeError(
        "Static command entries must declare a path.",
      );
    }
    return {
      path: command.path,
      command,
    };
  });
}

function unwrapCommandExport(value: unknown): AnyCommand | undefined {
  if (isCommand(value)) return value;
  if (value != null && typeof value === "object") {
    const nestedDefault = (value as { readonly default?: unknown }).default;
    if (isCommand(nestedDefault)) return nestedDefault;
  }
  return undefined;
}

function buildCommandTree(
  commands: readonly Pick<DiscoveredCommand, "path" | "command">[],
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
  }
  return root;
}

function buildNodeParser(
  node: CommandTreeNode,
): Parser<Mode, ProgramInvocation, unknown> {
  const childParser = buildChildrenParser(node);
  if (childParser != null && node.command != null) {
    return createExecutableNodeParser(childParser, node.command);
  }
  if (childParser != null) return childParser;
  if (node.command != null) return createLeafParser(node.command);
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
): Parser<Mode, ProgramInvocation, ExecutableNodeParserState> {
  const leafParser = createLeafParser(commandDefinition, true);
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
      return branchParser.getSuggestRuntimeNodes?.(branchState, branchPath) ??
        (branchParser.dependencyMetadata?.source != null
          ? [{ path: branchPath, parser: branchParser, state: branchState }]
          : []);
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
): Parser<Mode, ProgramInvocation, unknown> | undefined {
  const parsers: Parser<Mode, ProgramInvocation, unknown>[] = [];
  for (const [name, child] of node.children) {
    const childParser = buildNodeParser(child);
    if (child.children.size > 0) {
      parsers.push(
        createNamespaceCommandParser(name, childParser, child.command),
      );
    } else {
      parsers.push(command(name, childParser, child.command?.metadata));
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
): Parser<Mode, ProgramInvocation, unknown> {
  const metadata = commandDefinition?.metadata;
  const parser: Parser<Mode, ProgramInvocation, unknown> = command(
    name,
    childParser,
    namespaceCommandMetadata(metadata),
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
): CommandMetadata | undefined {
  if (metadata == null) return undefined;
  if (
    metadata.aliases == null &&
    metadata.errors == null &&
    metadata.hidden == null &&
    metadata.usageLine == null
  ) {
    return undefined;
  }
  return {
    ...(metadata.aliases != null && { aliases: metadata.aliases }),
    ...(metadata.errors != null && { errors: metadata.errors }),
    ...(metadata.hidden != null && { hidden: metadata.hidden }),
    ...(metadata.usageLine != null && { usageLine: metadata.usageLine }),
  };
}

function createLeafParser(
  commandDefinition: AnyCommand,
  includeMetadata = false,
): Parser<Mode, ProgramInvocation, unknown> {
  const parser = map(commandDefinition.parser, (value): ProgramInvocation => ({
    command: commandDefinition,
    value,
    handler: commandDefinition.handler as (
      value: unknown,
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
  commands: readonly Pick<DiscoveredCommand, "path" | "command">[],
  metadata: ProgramHelpMetadata,
): Parser<Mode, ProgramInvocation, unknown> {
  const rootState = parser.initialState;
  const rootCommand = commands.find((entry) => entry.path.length < 1);
  const listedCommands = commands.filter((entry) => entry.path.length > 0);
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
            hidden: entry.command.metadata?.hidden,
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

function buildRunOptions(options: RunProgramOptions): RunOptions {
  const metadata = options.metadata;
  const {
    dir: _dir,
    commands: _commands,
    extensions: _extensions,
    entryFileName: _entryFileName,
    metadata: _metadata,
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
