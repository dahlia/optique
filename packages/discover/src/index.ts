import { longestMatch, or } from "@optique/core/constructs";
import type {
  SourceContext,
  SourceContextRequest,
} from "@optique/core/context";
import type { DocState } from "@optique/core/parser";
import type { DocFragment, DocFragments } from "@optique/core/doc";
import { map } from "@optique/core/modifiers";
import type { Message } from "@optique/core/message";
import type { Mode, Parser } from "@optique/core/parser";
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
  const parsers: Parser<Mode, ProgramInvocation, unknown>[] = [];
  const childParser = buildChildrenParser(node);
  if (childParser != null) parsers.push(childParser);
  if (node.command != null) {
    parsers.push(createLeafParser(node.command, childParser != null));
  }
  if (parsers.length === 1) return parsers[0];
  if (parsers.length < 1) {
    throw new TypeError("Command tree node must contain a command.");
  }
  return longestMatch(...parsers) as Parser<Mode, ProgramInvocation, unknown>;
}

function buildChildrenParser(
  node: CommandTreeNode,
): Parser<Mode, ProgramInvocation, unknown> | undefined {
  const parsers: Parser<Mode, ProgramInvocation, unknown>[] = [];
  for (const [name, child] of node.children) {
    const childParser = buildNodeParser(child);
    const metadata = child.children.size > 0
      ? namespaceCommandMetadata(child.command?.metadata)
      : child.command?.metadata;
    parsers.push(command(name, childParser, metadata));
  }
  if (parsers.length < 1) return undefined;
  if (parsers.length === 1) return parsers[0];
  return or(...parsers) as Parser<Mode, ProgramInvocation, unknown>;
}

function namespaceCommandMetadata(
  metadata: CommandMetadata | undefined,
): CommandMetadata | undefined {
  if (metadata == null) return undefined;
  if (
    metadata.aliases == null &&
    metadata.errors == null &&
    metadata.usageLine == null
  ) {
    return undefined;
  }
  return {
    ...(metadata.aliases != null && { aliases: metadata.aliases }),
    ...(metadata.errors != null && { errors: metadata.errors }),
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
      return {
        ...fragments,
        brief: fragments.brief ?? commandDefinition.metadata?.brief,
        description: fragments.description ??
          commandDefinition.metadata?.description,
        footer: fragments.footer ?? commandDefinition.metadata?.footer,
      };
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
