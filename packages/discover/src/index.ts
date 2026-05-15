import { or } from "@optique/core/constructs";
import type {
  SourceContext,
  SourceContextRequest,
} from "@optique/core/context";
import type { DocState } from "@optique/core/parser";
import type { DocFragments } from "@optique/core/doc";
import { map } from "@optique/core/modifiers";
import type { Message } from "@optique/core/message";
import type { Mode, Parser } from "@optique/core/parser";
import type { ProgramMetadata } from "@optique/core/program";
import { command } from "@optique/core/primitives";
import { runAsync } from "@optique/run";
import type { RunOptions } from "@optique/run";
import { readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  type Command,
  type CommandPath,
  isCommand,
  type StaticCommand,
} from "./command.ts";

export { defineCommand, isCommand } from "./command.ts";
export type {
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
  readonly command: Command<Mode, unknown>;

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
  readonly command: Command<Mode, unknown>;
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
  readonly commands: readonly StaticCommand<Mode, unknown>[];

  /**
   * File-system discovery cannot be used together with `commands`.
   */
  readonly dir?: never;

  /**
   * File suffixes are only used with file-system discovery.
   */
  readonly extensions?: never;
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
 *         command paths conflict, or a module does not default-export a
 *         command created with `defineCommand()`.
 * @since 1.1.0
 */
export async function discoverCommands(
  options: DiscoverCommandsOptions,
): Promise<readonly DiscoveredCommand[]> {
  const dir = pathFromDir(options.dir);
  const extensions = normalizeExtensions(
    options.extensions ?? getDefaultExtensions(),
  );
  const files = await collectCommandFiles(dir, extensions);
  if (files.length < 1) {
    throw new TypeError(`No command modules found in ${dir}.`);
  }

  const seen = new Map<string, string>();
  const discovered: DiscoveredCommand[] = [];
  for (const filePath of files) {
    const path = commandPathFromFile(dir, filePath, extensions);
    const key = path.join(" ");
    const previous = seen.get(key);
    if (previous != null) {
      throw new TypeError(
        `Duplicate command path "${key}" from ${previous} and ${filePath}.`,
      );
    }
    seen.set(key, filePath);

    const mod = await import(pathToFileURL(filePath).href) as {
      readonly default?: unknown;
    };
    if (!isCommand(mod.default)) {
      throw new TypeError(
        `Module ${filePath} default export must be created with defineCommand().`,
      );
    }
    if (
      mod.default.path != null &&
      commandPathKey(mod.default.path) !== commandPathKey(path)
    ) {
      throw new TypeError(
        `Module ${filePath} declares command path "${
          mod.default.path.join(" ")
        }" but file path defines "${path.join(" ")}".`,
      );
    }
    discovered.push({ path, filePath, command: mod.default });
  }

  rejectPathConflicts(discovered);
  return sortCommands(discovered);
}

/**
 * Builds a parser that dispatches to discovered command handlers.
 *
 * @param commands Commands to compose.
 * @param metadata Optional root documentation metadata.
 * @returns A parser that resolves to an internal command invocation.
 * @throws {TypeError} If no commands are provided or command paths conflict.
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
      filePath: entry.path.join("/"),
    })),
  );
  rejectPathConflicts(
    sortedCommands.map((entry) => ({
      path: entry.path,
      filePath: entry.path.join("/"),
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
  command?: Command<Mode, unknown>;
}

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
  const features: typeof process.features & {
    readonly typescript?: unknown;
  } = process.features;
  return features.typescript === "strip" ||
    features.typescript === "transform";
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

async function collectCommandFiles(
  dir: string,
  extensions: readonly string[],
): Promise<readonly string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (
    const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))
  ) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectCommandFiles(path, extensions));
    } else if (
      entry.isFile() &&
      !isDeclarationFile(entry.name) &&
      extensions.some((ext) => entry.name.endsWith(ext))
    ) {
      files.push(path);
    }
  }
  return files;
}

function isDeclarationFile(fileName: string): boolean {
  return /\.d\.[cm]?ts$/.test(fileName);
}

function commandPathFromFile(
  rootDir: string,
  filePath: string,
  extensions: readonly string[],
): CommandPath {
  const matchedExtension = extensions.find((ext) => filePath.endsWith(ext));
  if (matchedExtension == null) {
    throw new TypeError(`No configured extension matches ${filePath}.`);
  }
  const withoutExtension = filePath.slice(0, -matchedExtension.length);
  const relativePath = relative(rootDir, withoutExtension);
  const path = relativePath.split(sep).filter((segment) => segment.length > 0);
  const [first, ...rest] = path;
  if (first == null) {
    throw new TypeError(`Command file ${filePath} does not define a path.`);
  }
  return [first, ...rest];
}

function commandPathKey(path: readonly string[]): string {
  return path.join("\0");
}

function rejectPathConflicts(
  commands: readonly Pick<DiscoveredCommand, "path" | "filePath">[],
): void {
  const paths = new Map(
    commands.map((entry) => [entry.path.join("\0"), entry]),
  );
  for (const entry of commands) {
    for (let i = 1; i < entry.path.length; i++) {
      const parent = entry.path.slice(0, i);
      const parentEntry = paths.get(parent.join("\0"));
      if (parentEntry != null) {
        throw new TypeError(
          `Command path "${parent.join(" ")}" conflicts with nested command "${
            entry.path.join(" ")
          }".`,
        );
      }
    }
  }
}

function rejectDuplicatePaths(
  commands: readonly Pick<DiscoveredCommand, "path" | "filePath">[],
): void {
  const seen = new Map<string, string>();
  for (const entry of commands) {
    const key = entry.path.join(" ");
    const previous = seen.get(key);
    if (previous != null) {
      throw new TypeError(
        `Duplicate command path "${key}" from ${previous} and ${entry.filePath}.`,
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
  commands: readonly StaticCommand<Mode, unknown>[],
): readonly Pick<DiscoveredCommand, "path" | "command">[] {
  return commands.map((command) => ({
    path: command.path,
    command,
  }));
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
  for (const [name, child] of node.children) {
    const childParser = child.command != null
      ? createLeafParser(child.command)
      : buildNodeParser(child);
    const metadata = child.command?.metadata;
    parsers.push(command(name, childParser, metadata));
  }
  if (parsers.length === 1) return parsers[0];
  return or(...parsers) as Parser<Mode, ProgramInvocation, unknown>;
}

function createLeafParser(
  commandDefinition: Command<Mode, unknown>,
): Parser<Mode, ProgramInvocation, unknown> {
  return map(commandDefinition.parser, (value): ProgramInvocation => ({
    command: commandDefinition,
    value,
    handler: commandDefinition.handler as (
      value: unknown,
    ) => void | Promise<void>,
  })) as Parser<Mode, ProgramInvocation, unknown>;
}

function withRootDocs(
  parser: Parser<Mode, ProgramInvocation, unknown>,
  commands: readonly Pick<DiscoveredCommand, "path" | "command">[],
  metadata: ProgramHelpMetadata,
): Parser<Mode, ProgramInvocation, unknown> {
  const rootState = parser.initialState;
  const rootDocs = (): DocFragments => ({
    brief: metadata.brief,
    description: metadata.description,
    footer: metadata.footer,
    fragments: [{
      type: "section",
      entries: commands.map((entry) => ({
        term: {
          type: "command",
          name: entry.path.join(" "),
          hidden: entry.command.metadata?.hidden,
        },
        description: entry.command.metadata?.brief ??
          entry.command.metadata?.description,
      })),
    }],
  });
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
  const wrapped: SourceContext<unknown> = {
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
    Object.defineProperty(wrapped, "getInternalAnnotations", {
      value(
        request: SourceContextRequest,
        annotations: Parameters<
          NonNullable<SourceContext<unknown>["getInternalAnnotations"]>
        >[1],
      ) {
        return context.getInternalAnnotations!(
          unwrapProgramContextRequest(request) ?? request,
          annotations,
        );
      },
    });
  }
  if (context[Symbol.dispose] != null) {
    Object.defineProperty(wrapped, Symbol.dispose, {
      value() {
        return context[Symbol.dispose]!();
      },
    });
  }
  if (context[Symbol.asyncDispose] != null) {
    Object.defineProperty(wrapped, Symbol.asyncDispose, {
      value() {
        return context[Symbol.asyncDispose]!();
      },
    });
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
