import { transformerTwoslash } from "@shikijs/vitepress-twoslash";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createHighlighter } from "shiki";
import {
  createOptiqueTwoslashCaches,
  extractTwoslashBlocks,
  type TwoslashBlock,
  twoslashCompilerOptions,
} from "./twoslash-cache.mts";

const batchSize = 48;
const docsDirectory = fileURLToPath(new URL("../", import.meta.url));
const languages = [
  "js",
  "jsx",
  "ts",
  "tsx",
  "zsh",
  "bash",
  "fish",
  "powershell",
  "json",
  "vue",
];

const twoslashOptions = {
  compilerOptions: twoslashCompilerOptions,
  shouldGetHoverInfo: () => true,
};

function collectMarkdownFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === ".vitepress" || entry.name === "node_modules") {
      continue;
    }

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectMarkdownFiles(path));
    } else if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(path);
    }
  }
  return files;
}

function getDocumentationBlocks(): TwoslashBlock[] {
  const blocks: TwoslashBlock[] = [];
  const files = collectMarkdownFiles(docsDirectory).sort();

  for (const file of files) {
    blocks.push(
      ...extractTwoslashBlocks(readFileSync(file, "utf8")),
    );
  }
  return blocks;
}

function getMissingBlockIndices(blocks: readonly TwoslashBlock[]): number[] {
  const { typesCache } = createOptiqueTwoslashCaches(
    twoslashCompilerOptions,
  );
  typesCache.init?.();

  const missing: number[] = [];
  for (const [index, block] of blocks.entries()) {
    if (typesCache.read(block.code, block.lang, twoslashOptions, {}) == null) {
      missing.push(index);
    }
  }
  return missing;
}

async function warmBlocks(
  blocks: readonly TwoslashBlock[],
  indices: readonly number[],
): Promise<void> {
  const caches = createOptiqueTwoslashCaches(twoslashCompilerOptions);
  const transformer = transformerTwoslash({
    typesCache: caches.typesCache,
    twoslashOptions: {
      ...twoslashOptions,
      cache: caches.environmentCache,
    },
  });
  const highlighter = await createHighlighter({
    langs: languages,
    themes: ["github-dark"],
  });

  try {
    for (const index of indices) {
      const block = blocks[index];
      await highlighter.codeToHtml(block.code, {
        lang: block.lang,
        meta: { __raw: block.meta },
        theme: "github-dark",
        transformers: [transformer],
      });
    }
  } finally {
    highlighter.dispose();
  }
}

function parseWorkerIndices(value: string | undefined): number[] {
  if (value == null || value.length < 1) {
    throw new TypeError("The Twoslash cache worker requires block indices.");
  }

  return value.split(",").map((part) => {
    const index = Number(part);
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new TypeError(`Invalid Twoslash block index: ${part}`);
    }
    return index;
  });
}

function runWorkers(indices: readonly number[]): void {
  const script = fileURLToPath(import.meta.url);
  const batchCount = Math.ceil(indices.length / batchSize);
  for (let offset = 0; offset < indices.length; offset += batchSize) {
    const batch = indices.slice(offset, offset + batchSize);
    console.log(
      `Warming Twoslash cache batch ${offset / batchSize + 1}/${batchCount}.`,
    );
    const result = spawnSync(
      process.execPath,
      [script, "--worker", batch.join(",")],
      {
        cwd: docsDirectory,
        env: process.env,
        stdio: "inherit",
      },
    );
    if (result.error != null) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `Twoslash cache worker exited with status ${result.status}.`,
      );
    }
  }
}

async function main(): Promise<void> {
  const blocks = getDocumentationBlocks();
  if (process.argv[2] === "--worker") {
    await warmBlocks(blocks, parseWorkerIndices(process.argv[3]));
    return;
  }

  const missing = getMissingBlockIndices(blocks);
  if (missing.length < 1) {
    console.log(`Twoslash cache contains all ${blocks.length} results.`);
    return;
  }

  console.log(
    `Warming ${missing.length} of ${blocks.length} Twoslash cache results.`,
  );
  runWorkers(missing);
  console.log("Twoslash cache is warm.");
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
