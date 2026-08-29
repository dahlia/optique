import type { VitePressPluginTwoslashOptions } from "@shikijs/vitepress-twoslash";
import { createFileSystemTypesCache } from "@shikijs/vitepress-twoslash/cache-fs";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { ModuleKind, ModuleResolutionKind, ScriptTarget } from "typescript";

const cacheFormatVersion = 2;
const docsDirectory = fileURLToPath(new URL("../", import.meta.url));
const repositoryDirectory = fileURLToPath(new URL("../../", import.meta.url));

type TwoslashOptions = NonNullable<
  VitePressPluginTwoslashOptions["twoslashOptions"]
>;
type TwoslashEnvironmentCache = Exclude<
  TwoslashOptions["cache"],
  boolean | undefined
>;
type TwoslashTypesCache = NonNullable<
  VitePressPluginTwoslashOptions["typesCache"]
>;

export const twoslashCompilerOptions = {
  moduleResolution: ModuleResolutionKind.Bundler,
  module: ModuleKind.ESNext,
  target: ScriptTarget.ESNext,
  lib: ["dom", "dom.iterable", "esnext"],
  types: ["dom", "dom.iterable", "esnext", "node"],
};

export interface TwoslashBlock {
  readonly code: string;
  readonly lang: string;
  readonly meta: string;
}

const languageAliases: Readonly<Record<string, string>> = {
  javascript: "js",
  typescript: "ts",
};

export function extractTwoslashBlocks(markdown: string): TwoslashBlock[] {
  const blocks: TwoslashBlock[] = [];
  const lines = markdown.split(/\r?\n/);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const opening = lines[lineIndex].match(
      /^((?:[ \t]|> ?)*)(`{3,}|~{3,})[ \t]*(\S+)[ \t]+(.+)$/,
    );
    if (opening == null || !opening[4].split(/\s+/).includes("twoslash")) {
      continue;
    }

    const prefix = opening[1];
    const fence = opening[2];
    const isClosingFence = (line: string): boolean => {
      if (!line.startsWith(prefix)) return false;
      const closing = line.slice(prefix.length).match(/^(`+|~+)[ \t]*$/);
      return closing != null &&
        closing[1][0] === fence[0] &&
        closing[1].length >= fence.length;
    };
    const code: string[] = [];
    for (
      lineIndex++;
      lineIndex < lines.length && !isClosingFence(lines[lineIndex]);
      lineIndex++
    ) {
      const line = lines[lineIndex];
      if (line.startsWith(prefix)) {
        code.push(line.slice(prefix.length));
      } else if (prefix.endsWith(" ") && line === prefix.trimEnd()) {
        code.push("");
      } else {
        code.push(line);
      }
    }

    blocks.push({
      code: code.join("\n").replace(/\n+$/, ""),
      lang: languageAliases[opening[3]] ?? opening[3],
      meta: opening[4],
    });
  }

  return blocks;
}

function normalizeForCacheKey(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeForCacheKey);
  if (value != null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeForCacheKey(item)]),
    );
  }
  return value;
}

export function computeTwoslashCacheNamespace(
  formatVersion: number,
  compilerOptions: Readonly<Record<string, unknown>>,
  typeEnvironmentFiles: ReadonlyMap<string, string>,
): string {
  const hash = createHash("sha256");
  hash.update(`optique-twoslash-cache:${formatVersion}\0`);
  hash.update(JSON.stringify(normalizeForCacheKey(compilerOptions)));
  hash.update("\0");

  const files = Array.from(typeEnvironmentFiles).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  for (const [path, contents] of files) {
    hash.update(path);
    hash.update("\0");
    hash.update(contents);
    hash.update("\0");
  }

  return hash.digest("hex");
}

export function createLanguageAwareTypesCache(
  cache: TwoslashTypesCache,
): TwoslashTypesCache {
  const getKey = (code: string, lang: string | undefined): string =>
    `${JSON.stringify(lang ?? null)}\0${code}`;

  return {
    init: cache.init,
    preprocess: cache.preprocess,
    read(code, lang, options, meta) {
      try {
        return cache.read(getKey(code, lang), lang, options, meta);
      } catch (error) {
        if (error instanceof SyntaxError) return null;
        throw error;
      }
    },
    write(code, data, lang, options, meta) {
      cache.write(getKey(code, lang), data, lang, options, meta);
    },
  };
}

function isDeclarationFile(path: string): boolean {
  return path.endsWith(".d.ts") ||
    path.endsWith(".d.mts") ||
    path.endsWith(".d.cts");
}

function collectDeclarationFiles(directory: string): string[] {
  if (!existsSync(directory)) return [];

  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectDeclarationFiles(path));
    } else if (entry.isFile() && isDeclarationFile(path)) {
      files.push(path);
    }
  }
  return files;
}

function getTypeEnvironmentFiles(): ReadonlyMap<string, string> {
  const files = [join(repositoryDirectory, "pnpm-lock.yaml")];
  const packagesDirectory = join(repositoryDirectory, "packages");

  for (
    const entry of readdirSync(packagesDirectory, { withFileTypes: true })
  ) {
    if (!entry.isDirectory()) continue;
    files.push(
      ...collectDeclarationFiles(join(packagesDirectory, entry.name, "dist")),
    );
  }

  return new Map(
    files.sort().map((path) => [
      relative(repositoryDirectory, path),
      readFileSync(path, "utf8"),
    ]),
  );
}

export function createOptiqueTwoslashCaches(
  compilerOptions: Readonly<Record<string, unknown>>,
): {
  readonly environmentCache: TwoslashEnvironmentCache;
  readonly typesCache: TwoslashTypesCache;
} {
  const namespace = computeTwoslashCacheNamespace(
    cacheFormatVersion,
    compilerOptions,
    getTypeEnvironmentFiles(),
  );
  const typesCache = createLanguageAwareTypesCache(
    createFileSystemTypesCache({
      dir: join(
        docsDirectory,
        ".vitepress",
        "cache",
        "twoslash",
        namespace,
      ),
    }),
  );

  return { environmentCache: new Map(), typesCache };
}
