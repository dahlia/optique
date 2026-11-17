import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

interface Member {
  readonly directory: string;
  readonly name: string;
  readonly exports: ReadonlyMap<string, string>;
  readonly imports: ReadonlyMap<string, string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function metadata(path: string): Record<string, unknown> {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!isRecord(value)) {
    throw new TypeError(`Expected metadata object: ${path}`);
  }
  return value;
}

function stringEntries(value: unknown): Map<string, string> {
  const entries = new Map<string, string>();
  if (isRecord(value)) {
    for (const [key, target] of Object.entries(value)) {
      if (typeof target !== "string") {
        throw new TypeError(`Expected a string source mapping: ${key}`);
      }
      entries.set(key, target);
    }
  }
  return entries;
}

/**
 * Reads source exports and private aliases from Deno workspace metadata.
 * @param root Workspace root directory.
 * @returns Workspace member source mappings.
 * @throws {TypeError} If workspace metadata has an unsupported shape.
 */
export function loadWorkspace(root: string): readonly Member[] {
  const workspace = metadata(join(root, "deno.json")).workspace;
  if (!Array.isArray(workspace)) {
    throw new TypeError("Expected a workspace list.");
  }
  const members: Member[] = [];
  for (const pattern of workspace) {
    if (typeof pattern !== "string") {
      throw new TypeError("Expected workspace paths.");
    }
    const directories = pattern.endsWith("/*")
      ? readdirSync(resolve(root, pattern.slice(0, -2)), {
        withFileTypes: true,
      })
        .filter((entry) => entry.isDirectory())
        .map((entry) => resolve(root, pattern.slice(0, -2), entry.name))
      : [resolve(root, pattern)];
    for (const directory of directories) {
      if (!existsSync(join(directory, "deno.json"))) continue;
      const data = metadata(join(directory, "deno.json"));
      members.push({
        directory,
        name: typeof data.name === "string" ? data.name : "",
        exports: typeof data.exports === "string"
          ? new Map([[".", data.exports]])
          : stringEntries(data.exports),
        imports: stringEntries(data.imports),
      });
    }
  }
  return members;
}

function within(directory: string, file: string): boolean {
  const path = relative(directory, file);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function withoutSuffix(specifier: string): string {
  // A leading "#" is a package-import sigil, not a URL fragment.
  const suffix = specifier.slice(1).search(/[?#]/);
  return suffix < 0 ? specifier : specifier.slice(0, suffix + 1);
}

function usesDeno(source: ts.SourceFile): boolean {
  function visit(node: ts.Node): boolean {
    return (ts.isIdentifier(node) && node.text === "Deno") ||
      (ts.forEachChild(node, visit) ?? false);
  }
  return visit(source);
}

function sourceTarget(
  specifier: string,
  importer: string,
  members: readonly Member[],
): string | undefined {
  if (specifier.startsWith("#")) {
    const owner = members
      .filter((member) => within(member.directory, importer))
      .sort((a, b) => b.directory.length - a.directory.length)[0];
    if (!owner) {
      return resolve(dirname(importer), "__unowned_private_import__.ts");
    }
    const mappings = [...owner.imports].sort(([a], [b]) => b.length - a.length);
    for (const [prefix, target] of mappings) {
      if (
        specifier === prefix ||
        (prefix.endsWith("/") && specifier.startsWith(prefix))
      ) {
        const file = resolve(
          owner.directory,
          target + specifier.slice(prefix.length),
        );
        if (!within(owner.directory, file)) {
          throw new TypeError(
            `Private source mapping escapes its owner: ${specifier}`,
          );
        }
        return file;
      }
    }
    return resolve(owner.directory, "__unexported_private_import__.ts");
  }
  for (const member of members) {
    if (!member.name) continue;
    const subpath = specifier === member.name
      ? "."
      : specifier.startsWith(`${member.name}/`)
      ? `.${specifier.slice(member.name.length)}`
      : undefined;
    if (subpath === undefined) continue;
    const target = member.exports.get(subpath);
    // Do not fall back to a built npm export for an unexported workspace path.
    return target === undefined
      ? resolve(member.directory, "__unexported_workspace_subpath__.ts")
      : resolve(member.directory, target);
  }
  return undefined;
}

/**
 * Creates a no-emit program with importer-aware source workspace resolution.
 * @param rootNames Explicit compiler root files.
 * @param options Strict checker options.
 * @param members Workspace source mappings.
 * @returns A compiler program; no files are emitted.
 */
export function createCheckProgram(
  rootNames: readonly string[],
  options: ts.CompilerOptions,
  members: readonly Member[],
): ts.Program {
  const host = ts.createCompilerHost(options);
  const cache = ts.createModuleResolutionCache(
    process.cwd(),
    (file) => ts.sys.useCaseSensitiveFileNames ? file : file.toLowerCase(),
    options,
  );
  host.resolveModuleNameLiterals = (
    literals,
    containingFile,
    _redirect,
    settings,
    source,
  ) =>
    literals.map((literal) => {
      const specifier = withoutSuffix(literal.text);
      const target = sourceTarget(specifier, containingFile, members) ??
        specifier;
      return ts.resolveModuleName(
        target,
        containingFile,
        settings,
        host,
        cache,
        _redirect,
        ts.getModeForUsageLocation(source, literal, settings),
      );
    });
  return ts.createProgram({
    rootNames,
    options: { ...options, noEmit: true },
    host,
  });
}

const excluded = new Set(["node_modules", "dist", ".git", "tmp"]);

/**
 * Inventories owned TypeScript files; docs retain their separate checker.
 * @param root Workspace root directory.
 * @returns All owned TS-family files, including build configs and fixtures.
 */
export function inventoryOwnedFiles(root: string): readonly string[] {
  const files: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!excluded.has(entry.name) && path !== join(root, "docs")) {
          visit(path);
        }
      } else if (entry.isFile() && /\.(?:[cm]?ts|tsx)$/.test(entry.name)) {
        files.push(path);
      }
    }
  }
  visit(root);
  return files.sort();
}

/**
 * Checks that every owned file appears in a compiler file inventory.
 * @param owned Expected owned files.
 * @param checked Actual compiler root files or source files.
 * @throws {Error} If an owned file is missing.
 */
export function verifyInventory(
  owned: readonly string[],
  checked: readonly string[],
): void {
  const roots = new Set(checked.map((file) => resolve(file)));
  const missing = owned.filter((file) => !roots.has(resolve(file)));
  if (missing.length) {
    throw new Error(`Owned files not checked:\n${missing.join("\n")}`);
  }
}

/**
 * Checks package, tooling, example and neutral-core programs without building.
 * @param root Workspace root directory.
 * @returns A process exit status.
 * @throws {Error} If configuration or ownership invariants fail.
 */
export function main(
  root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
): number {
  const configFile = ts.readConfigFile(
    join(root, "tsconfig.check.json"),
    ts.sys.readFile,
  );
  if (configFile.error) {
    throw new Error(
      ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"),
    );
  }
  const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
  const owned = inventoryOwnedFiles(root);
  const members = loadWorkspace(root);
  const groups = new Map<string, string[]>();
  // TypeScript glob expansion drops a .tsx file when a sibling .ts has the
  // same basename. Supply the owned inventory explicitly, including fixtures.
  for (const file of owned) {
    const member = members.find((item) => within(item.directory, file));
    const key = member?.directory ?? root;
    const group = groups.get(key) ?? [];
    group.push(file);
    groups.set(key, group);
  }
  const diagnostics: ts.Diagnostic[] = [...config.errors];
  const checked: string[] = [];
  const temporalTypes = join(root, "scripts/types/temporal.d.ts");
  for (const [directory, roots] of groups) {
    let program = createCheckProgram(roots, config.options, members);
    const needsDeno = program.getSourceFiles().some((file) =>
      within(root, file.fileName) &&
      !file.fileName.includes(`${sep}node_modules${sep}`) &&
      usesDeno(file)
    );
    const needsTemporal = program.getSourceFiles().some((file) =>
      within(join(root, "packages/temporal/src"), file.fileName)
    );
    if (needsDeno || needsTemporal) {
      program = createCheckProgram(
        needsTemporal ? [...roots, temporalTypes] : roots,
        {
          ...config.options,
          types: needsDeno ? ["node", "deno"] : config.options.types,
        },
        members,
      );
    }
    verifyInventory(
      roots,
      program.getSourceFiles().map((file) => file.fileName),
    );
    checked.push(...program.getRootFileNames());
    diagnostics.push(...ts.getPreEmitDiagnostics(program));
    const label = directory === root ? "root" : relative(root, directory);
    console.log(`Checked ${label} (${roots.length} roots).`);
  }
  // Core's public implementation must also compile without Node ambient types.
  const neutralRoots = owned.filter((file) =>
    file.startsWith(join(root, "packages/core/src") + sep) &&
    !file.endsWith(".test.ts")
  );
  if (neutralRoots.length) {
    const neutral = createCheckProgram(neutralRoots, {
      ...config.options,
      types: [],
      lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    }, members);
    if (
      neutral.getSourceFiles().some((file) =>
        /[/\\]@types[/\\]node[/\\]/.test(file.fileName)
      )
    ) {
      throw new Error("Neutral core loaded Node ambient types.");
    }
    diagnostics.push(...ts.getPreEmitDiagnostics(neutral));
    console.log(
      `Checked neutral core (${neutralRoots.length} roots, no Node ambient types).`,
    );
  }
  verifyInventory(owned, checked);
  const unique = [...new Map(diagnostics.map((diagnostic) => [
    `${diagnostic.file?.fileName}:${diagnostic.start}:${diagnostic.code}:${
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
    }`,
    diagnostic,
  ])).values()];
  console.log(
    `Inventory: ${owned.length} owned TypeScript files checked; docs checked separately.`,
  );
  if (unique.length) {
    console.error(ts.formatDiagnosticsWithColorAndContext(unique, {
      getCanonicalFileName: (file) => file,
      getCurrentDirectory: () => root,
      getNewLine: () => "\n",
    }));
  }
  console.log(`${unique.length} diagnostics.`);
  return unique.some((d) => d.category === ts.DiagnosticCategory.Error) ? 1 : 0;
}

function isMainModule(url: string, argument: string | undefined): boolean {
  if (argument === undefined) return false;
  try {
    return realpathSync(argument) === realpathSync(fileURLToPath(url));
  } catch {
    // Imported tooling may have no filesystem entry point (e.g. an eval or
    // foreign harness). A missing argv path must not accidentally run a check.
    return false;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  process.exitCode = main();
}
