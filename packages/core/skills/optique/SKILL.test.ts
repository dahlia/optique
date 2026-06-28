import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const packageJsonPath = join(root, "packages/core/package.json");
const skillPath = fileURLToPath(new URL("SKILL.md", import.meta.url));
const compilerOptions: ts.CompilerOptions = {
  allowImportingTsExtensions: true,
  lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: ts.ScriptTarget.ES2022,
};

type DenoManifest = {
  readonly name?: string;
  readonly exports?: string | Record<string, string>;
};

type PackageManifest = {
  readonly exports?: string | Record<string, unknown>;
};

const nodeStubs = `
declare module "node:fs" {
  export interface Stats {
    isDirectory(): boolean;
    isFile(): boolean;
  }
  export function existsSync(path: string): boolean;
  export function statSync(path: string): Stats;
}

declare module "node:path" {
  declare const path: {
    basename(path: string, suffix?: string): string;
    dirname(path: string): string;
    extname(path: string): string;
  };
  export function basename(path: string, suffix?: string): string;
  export function dirname(path: string): string;
  export function extname(path: string): string;
  export default path;
}

declare module "node:process" {
  interface WritableStreamLike {
    readonly columns?: number;
    readonly isTTY?: boolean;
    write(chunk: string): boolean;
  }

  declare const process: {
    argv: string[];
    stdout: WritableStreamLike;
    stderr: WritableStreamLike;
    exit(code?: number): never;
  };
  export default process;
}
`;

function extractTypeScriptBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  const lines = markdown.replaceAll("\r\n", "\n").replaceAll("\r", "\n")
    .split("\n");

  for (let index = 0; index < lines.length; index++) {
    const opening = getFenceOpening(lines[index]);
    if (opening == null) continue;

    const body: string[] = [];
    for (index++; index < lines.length; index++) {
      if (isFenceClosing(lines[index], opening.marker, opening.length)) {
        break;
      }
      body.push(lines[index]);
    }

    if (opening.language === "typescript" || opening.language === "ts") {
      blocks.push(body.join("\n").trim());
    }
  }

  return blocks;
}

function getFenceOpening(
  line: string,
): {
  readonly marker: "`" | "~";
  readonly length: number;
  readonly language: string;
} | undefined {
  const indent = countLeadingSpaces(line);
  if (indent > 3) return undefined;

  const marker = line[indent];
  if (marker !== "`" && marker !== "~") return undefined;

  const length = countRepeated(line, indent, marker);
  if (length < 3) return undefined;

  const info = line.slice(indent + length).trim();
  if (marker === "`" && info.includes("`")) return undefined;

  return {
    marker,
    length,
    language: getFirstWord(info).toLowerCase(),
  };
}

function isFenceClosing(
  line: string,
  marker: "`" | "~",
  openingLength: number,
): boolean {
  const indent = countLeadingSpaces(line);
  if (indent > 3) return false;

  const length = countRepeated(line, indent, marker);
  return length >= openingLength && line.slice(indent + length).trim() === "";
}

function countLeadingSpaces(line: string): number {
  let count = 0;
  while (line[count] === " ") count++;
  return count;
}

function countRepeated(line: string, start: number, char: string): number {
  let count = 0;
  while (line[start + count] === char) count++;
  return count;
}

function getFirstWord(text: string): string {
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === " " || char === "\t") return text.slice(0, index);
  }
  return text;
}

async function readWorkspaceExports(): Promise<ReadonlyMap<string, string>> {
  const result = new Map<string, string>();
  const packagesDir = join(root, "packages");
  const packages = await readdir(packagesDir, { withFileTypes: true });

  for (const entry of packages) {
    if (!entry.isDirectory()) continue;

    const packageDir = join(packagesDir, entry.name);
    let denoManifest: DenoManifest;
    try {
      denoManifest = JSON.parse(
        await readFile(join(packageDir, "deno.json"), "utf-8"),
      ) as DenoManifest;
    } catch (error) {
      if (isFileNotFoundError(error)) continue;
      throw error;
    }

    if (denoManifest.name == null || denoManifest.exports == null) continue;

    const packageManifest = JSON.parse(
      await readFile(join(packageDir, "package.json"), "utf-8"),
    ) as PackageManifest;
    const denoExports = normalizeDenoExports(denoManifest.exports);

    for (const [subpath, target] of Object.entries(denoExports)) {
      if (!hasPackageExport(packageManifest.exports, subpath)) {
        throw new Error(
          `${denoManifest.name} exports ${subpath} from deno.json but not package.json.`,
        );
      }

      const specifier = subpath === "."
        ? denoManifest.name
        : `${denoManifest.name}${subpath.slice(1)}`;
      result.set(specifier, join(packageDir, target));
    }
  }

  return result;
}

function normalizeDenoExports(
  exports: string | Record<string, string>,
): Record<string, string> {
  return typeof exports === "string" ? { ".": exports } : exports;
}

function hasPackageExport(
  exports: string | Record<string, unknown> | undefined,
  subpath: string,
): boolean {
  if (exports == null) return false;
  if (typeof exports === "string") return subpath === ".";
  return Object.hasOwn(exports, subpath);
}

function isFileNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { code } = error as { readonly code?: unknown };
  return code === "ENOENT";
}

function typeCheckSnippets(
  blocks: readonly string[],
  workspaceExports: ReadonlyMap<string, string>,
): readonly ts.Diagnostic[] {
  const snippets = new Map<string, string>();
  snippets.set(
    normalizePath(join(root, "tmp/skill-snippets/node-stubs.d.ts")),
    nodeStubs,
  );
  for (const [index, block] of blocks.entries()) {
    snippets.set(
      normalizePath(
        join(root, "tmp/skill-snippets", `snippet-${index + 1}.ts`),
      ),
      `${block}\n`,
    );
  }

  const host = ts.createCompilerHost(compilerOptions, true);
  const defaultFileExists = host.fileExists.bind(host);
  const defaultReadFile = host.readFile.bind(host);

  host.fileExists = (fileName) =>
    snippets.has(normalizePath(fileName)) || defaultFileExists(fileName);
  host.readFile = (fileName) =>
    snippets.get(normalizePath(fileName)) ?? defaultReadFile(fileName);
  host.resolveModuleNames = (moduleNames, containingFile) =>
    moduleNames.map((moduleName) => {
      const workspaceFile = workspaceExports.get(moduleName);
      if (workspaceFile != null) {
        return { resolvedFileName: workspaceFile, extension: ts.Extension.Ts };
      }

      return ts.resolveModuleName(
        moduleName,
        containingFile,
        compilerOptions,
        host,
      )
        .resolvedModule;
    });

  const program = ts.createProgram([...snippets.keys()], compilerOptions, host);
  return ts.getPreEmitDiagnostics(program);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function formatDiagnostic(diagnostic: ts.Diagnostic): string {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
  if (diagnostic.file == null || diagnostic.start == null) return message;

  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(
    diagnostic.start,
  );
  const normalizedFileName = normalizePath(diagnostic.file.fileName);
  const normalizedRoot = normalizePath(root);
  const relativePath = normalizedFileName.startsWith(normalizedRoot)
    ? normalizedFileName.slice(normalizedRoot.length)
    : diagnostic.file.fileName;
  return `${relativePath}:${line + 1}:${character + 1}: ${message}`;
}

describe("Optique agent skill", () => {
  it("should extract TypeScript examples from Markdown fences", () => {
    const markdown = [
      "~~~~ ts twoslash",
      "const short = true;",
      "~~~~",
      "```` typescript",
      "const nested = `not a fence`;",
      "```",
      "````",
      "``` javascript",
      "const ignored = true;",
      "```",
    ].join("\n");

    assert.deepEqual(extractTypeScriptBlocks(markdown), [
      "const short = true;",
      "const nested = `not a fence`;\n```",
    ]);
  });

  it("should be declared in the core package metadata", async () => {
    const packageJson = JSON.parse(
      await readFile(packageJsonPath, "utf-8"),
    ) as {
      readonly agents?: {
        readonly skills?: readonly {
          readonly name: string;
          readonly path: string;
        }[];
      };
      readonly files?: readonly string[];
    };

    assert.deepEqual(packageJson.agents?.skills, [
      { name: "optique", path: "./skills/optique" },
    ]);
    assert.ok(packageJson.files?.includes("skills/optique/SKILL.md"));
  });

  it("should keep the skill concise and point agents to maintained references", async () => {
    const skill = await readFile(skillPath, "utf-8");
    const lineCount = skill.split("\n").length;

    assert.ok(
      lineCount <= 300,
      `Expected SKILL.md to be concise, got ${lineCount} lines.`,
    );
    assert.match(skill, /^---\nname: optique\n/);
    assert.match(skill, /https:\/\/optique\.dev\/llms\.txt/);
    assert.match(skill, /https:\/\/optique\.dev\/pitfalls\.md/);
    assert.match(skill, /https:\/\/optique\.dev\/concepts\/valueparsers\.md/);
  });

  it("should type-check TypeScript examples in the skill", async () => {
    const skill = await readFile(skillPath, "utf-8");
    const blocks = extractTypeScriptBlocks(skill);

    assert.ok(blocks.length > 0, "Expected at least one TypeScript example.");

    const diagnostics = typeCheckSnippets(blocks, await readWorkspaceExports());

    assert.equal(
      diagnostics.length,
      0,
      `Skill TypeScript examples failed to type-check:\n${
        diagnostics.map(formatDiagnostic).join("\n")
      }`,
    );
  });
});
