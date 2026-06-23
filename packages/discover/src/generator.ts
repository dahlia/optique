import { mkdir, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { dirname, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDefaultExtensions } from "./index.ts";

/**
 * A command module file included in generated discovery output.
 *
 * @since 1.2.0
 */
export interface GeneratedCommandModuleFile {
  /**
   * Absolute path to the command module file.
   */
  readonly filePath: string;

  /**
   * Module specifier used by the generated import declaration.
   */
  readonly importSpecifier: string;

  /**
   * Module map key passed to `commandsFromModules()`.
   */
  readonly modulePath: string;

  /**
   * Namespace import identifier used in the generated module.
   */
  readonly identifier: string;
}

/**
 * Options for generating a static command module.
 *
 * @since 1.2.0
 */
export interface GenerateCommandsModuleOptions {
  /**
   * Directory containing command modules.
   */
  readonly dir: string | URL;

  /**
   * Path to the module that will be generated.
   */
  readonly outputFile: string | URL;

  /**
   * Module map base path passed to `commandsFromModules()`.
   *
   * By default, this is the command directory path relative to the generated
   * module's containing directory.
   */
  readonly base?: string;

  /**
   * Module suffixes to include.
   *
   * @default Runtime-aware extension defaults from {@link getDefaultExtensions}
   */
  readonly extensions?: readonly string[];

  /**
   * Entry file name passed to `commandsFromModules()`.  Pass `false` to
   * disable entry-file mapping.
   */
  readonly entryFileName?: string | false;
}

/**
 * Result of generating a static command module.
 *
 * @since 1.2.0
 */
export interface GeneratedCommandsModule {
  /**
   * Generated TypeScript source code.
   */
  readonly code: string;

  /**
   * Command module files included in the generated module.
   */
  readonly files: readonly GeneratedCommandModuleFile[];
}

/**
 * Options for watching and regenerating a static command module.
 *
 * @since 1.2.0
 */
export interface WatchCommandsModuleOptions
  extends GenerateCommandsModuleOptions {
  /**
   * Polling interval in milliseconds.
   *
   * @default `250`
   */
  readonly intervalMs?: number;

  /**
   * Abort signal used to stop watching.
   */
  readonly signal?: AbortSignal;

  /**
   * Callback invoked after each regeneration.
   */
  readonly onGenerate?: (result: GeneratedCommandsModule) => void;

  /**
   * Callback invoked when generation fails during watching.
   *
   * @since 1.2.0
   */
  readonly onError?: (error: unknown) => void;
}

interface NormalizedGenerateOptions {
  readonly dir: string;
  readonly outputFile: string;
  readonly outputDir: string;
  readonly base: string;
  readonly baseWasProvided: boolean;
  readonly extensions: readonly string[];
  readonly entryFileName: string | false | undefined;
}

/**
 * Generates a TypeScript module that exports command entries.
 *
 * @param options Generation options.
 * @returns The generated source code and command module metadata.
 * @throws {TypeError} If options are invalid or no command modules are found.
 * @since 1.2.0
 */
export async function generateCommandsModule(
  options: GenerateCommandsModuleOptions,
): Promise<GeneratedCommandsModule> {
  const normalized = normalizeGenerateOptions(options);
  const files = await collectGeneratedCommandFiles(normalized);
  return generateCommandsModuleFromFiles(normalized, files);
}

/**
 * Writes a generated command module to disk.
 *
 * @param options Generation options.
 * @returns The generated source code and command module metadata.
 * @throws {TypeError} If options are invalid or no command modules are found.
 * @throws {Error} If the generated module cannot be written.
 * @since 1.2.0
 */
export async function writeCommandsModule(
  options: GenerateCommandsModuleOptions,
): Promise<GeneratedCommandsModule> {
  const result = await generateCommandsModule(options);
  await mkdir(dirname(pathFromFile(options.outputFile)), { recursive: true });
  await writeFile(pathFromFile(options.outputFile), result.code, "utf-8");
  return result;
}

/**
 * Watches the command file set and rewrites the generated module when it
 * changes.
 *
 * Content-only edits do not trigger regeneration because they do not change
 * the static module map.
 *
 * @param options Watch options.
 * @returns A promise that resolves when the watch signal is aborted.
 * @throws {TypeError} If options are invalid.
 * @since 1.2.0
 */
export async function watchCommandsModule(
  options: WatchCommandsModuleOptions,
): Promise<void> {
  const normalized = normalizeGenerateOptions(options);
  const intervalMs = options.intervalMs ?? 250;
  if (!Number.isInteger(intervalMs) || intervalMs < 1) {
    throw new TypeError(
      `Watch interval must be a positive integer: ${intervalMs}`,
    );
  }

  let previousSignature: string | undefined;
  while (options.signal?.aborted !== true) {
    try {
      const files = await collectGeneratedCommandFiles(normalized, {
        allowEmpty: true,
      });
      const signature = files.map((file) => file.filePath).join("\0");
      if (signature !== previousSignature) {
        const result = generateCommandsModuleFromFiles(normalized, files);
        await mkdir(dirname(normalized.outputFile), { recursive: true });
        await writeFile(normalized.outputFile, result.code, "utf-8");
        options.onGenerate?.(result);
        previousSignature = signature;
      }
    } catch (error) {
      options.onError?.(error);
    }
    await delay(intervalMs, options.signal);
  }
}

interface CollectGeneratedCommandFilesOptions {
  readonly allowEmpty?: boolean;
}

async function collectGeneratedCommandFiles(
  options: NormalizedGenerateOptions,
  collectOptions: CollectGeneratedCommandFilesOptions = {},
): Promise<readonly GeneratedCommandModuleFile[]> {
  const filePaths = await collectCommandFiles(
    options.dir,
    options.extensions,
    options.outputFile,
  );
  if (filePaths.length < 1) {
    if (collectOptions.allowEmpty === true) return [];
    throw new TypeError(`No command modules found in ${options.dir}.`);
  }
  const files = filePaths.map((filePath, index) => {
    const importSpecifier = relativeImportSpecifier(
      options.outputDir,
      filePath,
    );
    const defaultModulePath = relativeModuleSpecifier(
      options.outputDir,
      filePath,
    );
    const modulePath = options.baseWasProvided
      ? joinModulePath(
        options.base,
        normalizeRelativePath(relative(options.dir, filePath)),
      )
      : defaultModulePath;
    return {
      filePath,
      importSpecifier,
      modulePath,
      identifier: `cmd${index}`,
    };
  });
  rejectDuplicateCommandPaths(files, options);
  return files;
}

function generateCommandsModuleFromFiles(
  options: NormalizedGenerateOptions,
  files: readonly GeneratedCommandModuleFile[],
): GeneratedCommandsModule {
  if (files.length < 1) {
    return {
      code: `import type { ModuleCommand } from "@optique/discover";\n\n` +
        `export default [] satisfies readonly ModuleCommand[];\n`,
      files,
    };
  }

  const imports = files
    .map((file) =>
      `import * as ${file.identifier} from ${
        JSON.stringify(file.importSpecifier)
      };`
    )
    .join("\n");
  const entries = files
    .map((file) =>
      `    ${JSON.stringify(file.modulePath)}: ${file.identifier},`
    )
    .join("\n");
  const optionEntries = [
    `    base: ${JSON.stringify(options.base)},`,
    `    extensions: ${formatStringArray(options.extensions)},`,
    ...(options.entryFileName === undefined ? [] : [
      `    entryFileName: ${JSON.stringify(options.entryFileName)},`,
    ]),
  ].join("\n");
  return {
    code:
      `import { commandsFromModules } from "@optique/discover";\n${imports}\n\n` +
      `export default commandsFromModules(\n` +
      `  {\n${entries}\n  },\n` +
      `  {\n${optionEntries}\n  },\n` +
      `);\n`,
    files,
  };
}

function normalizeGenerateOptions(
  options: GenerateCommandsModuleOptions,
): NormalizedGenerateOptions {
  const dir = resolve(pathFromFile(options.dir));
  const outputFile = resolve(pathFromFile(options.outputFile));
  const outputDir = dirname(outputFile);
  const baseWasProvided = options.base !== undefined;
  const base = normalizeBase(
    options.base ?? relativeModuleSpecifier(outputDir, dir),
  );
  return {
    dir,
    outputFile,
    outputDir,
    base,
    baseWasProvided,
    extensions: normalizeExtensions(
      options.extensions ?? getDefaultExtensions(),
    ),
    entryFileName: normalizeEntryFileName(options.entryFileName),
  };
}

function pathFromFile(path: string | URL): string {
  return typeof path === "string" ? path : fileURLToPath(path);
}

function normalizeBase(base: string): string {
  if (typeof base !== "string" || base.length < 1) {
    throw new TypeError(`Module base path must be a non-empty string: ${base}`);
  }
  return normalizeModulePath(base);
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
): string | false | undefined {
  if (entryFileName === undefined) return undefined;
  if (entryFileName === false) return false;
  if (
    typeof entryFileName !== "string" ||
    entryFileName.length < 1 ||
    entryFileName.includes("/") ||
    entryFileName.includes("\\")
  ) {
    throw new TypeError(
      `Command entry file name must be a non-empty file name: ${entryFileName}`,
    );
  }
  return entryFileName;
}

async function collectCommandFiles(
  dir: string,
  extensions: readonly string[],
  excludedFile: string,
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
        ...await collectCommandFiles(
          path,
          extensions,
          excludedFile,
          nextActiveDirs,
        ),
      );
    } else if (
      entryType === "file" &&
      path !== excludedFile &&
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

function rejectDuplicateCommandPaths(
  files: readonly GeneratedCommandModuleFile[],
  options: NormalizedGenerateOptions,
): void {
  const entryFileName = options.entryFileName ?? "index";
  const seen = new Map<string, string>();
  for (const file of files) {
    const commandPath = commandPathFromModulePath(
      options.base,
      file.modulePath,
      options.extensions,
      entryFileName,
    );
    const key = commandPath.join("\0");
    const previous = seen.get(key);
    if (previous != null) {
      throw new TypeError(
        `Duplicate command path "${
          displayCommandPath(commandPath)
        }" from ${previous} and ${file.modulePath}.`,
      );
    }
    seen.set(key, file.modulePath);
  }
}

function commandPathFromModulePath(
  base: string,
  modulePath: string,
  extensions: readonly string[],
  entryFileName: string | false,
): readonly string[] {
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
  const normalizedBase = normalizeDerivedModulePath(base);
  const normalizedPath = normalizeDerivedModulePath(modulePath);
  const relativePath = posix.relative(normalizedBase, normalizedPath);
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

function commandPathFromSegments(
  path: readonly string[],
  source: string,
  entryFileName: string | false,
): readonly string[] {
  if (path.length < 1) {
    throw new TypeError(`Command module ${source} does not define a path.`);
  }
  if (entryFileName !== false && path[path.length - 1] === entryFileName) {
    return path.slice(0, -1);
  }
  return path;
}

function displayCommandPath(path: readonly string[]): string {
  return path.length < 1 ? "<root>" : path.join(" ");
}

function relativeModuleSpecifier(fromDir: string, target: string): string {
  const relativePath = normalizeRelativePath(relative(fromDir, target));
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

function relativeImportSpecifier(fromDir: string, target: string): string {
  return encodeImportSpecifier(relativeModuleSpecifier(fromDir, target));
}

function encodeImportSpecifier(specifier: string): string {
  return specifier.split("/").map((segment) => encodeURIComponent(segment))
    .join("/");
}

function normalizeRelativePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function normalizeModulePath(path: string): string {
  return path.replaceAll("\\", "/");
}

function normalizeDerivedModulePath(path: string): string {
  return posix.normalize(normalizeModulePath(path));
}

function joinModulePath(base: string, relativePath: string): string {
  if (base === "." || base === "./") return `./${relativePath}`;
  const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
  return `${prefix}/${relativePath}`;
}

function formatStringArray(values: readonly string[]): string {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted === true) return Promise.resolve();
  return new Promise((resolve) => {
    const onTimeout = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(onTimeout, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
