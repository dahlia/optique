import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { arch, cpus, platform } from "node:os";
import { deepStrictEqual } from "node:assert/strict";
import { createHash } from "node:crypto";

// Run from any directory; package paths are relative to the checkout root.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
function count(value, name, minimum = 1) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw new RangeError(`${name} must be an integer >= ${minimum}.`);
  }
  return result;
}
const rounds = count(process.env.ROUNDS ?? 7, "ROUNDS");
const warmupParses = count(process.env.WARMUPS ?? 2, "WARMUPS", 0);
const timedParses = count(process.env.SAMPLES ?? 7, "SAMPLES");
const pathCount = count(process.argv[4] ?? process.env.PATHS ?? 1000, "PATHS");

// With no arguments, compare stable, saved main and this checkout in rotating order.
if (process.argv[2] == null) {
  const arms = [
    ["stable", "tmp/parse-scope/packages/1.3.6/package"],
    ["before", "tmp/parse-scope/packages/before"],
    ["fixed", "packages/core"],
  ];
  const records = [];
  for (const mode of ["separator", "plain"]) {
    for (let round = 0; round < rounds; round++) {
      const offset = round % arms.length;
      const order = [...arms.slice(offset), ...arms.slice(0, offset)];
      for (const [arm, root] of order) {
        const child = spawnSync(process.execPath, [
          fileURLToPath(import.meta.url),
          root,
          mode,
          String(pathCount),
        ], { encoding: "utf8", cwd: repoRoot });
        if (child.error) throw child.error;
        if (child.status !== 0) {
          throw new Error(
            `Benchmark child failed (${
              child.status ?? child.signal
            }): ${child.stderr}`,
          );
        }
        const result = JSON.parse(child.stdout);
        records.push({ mode, round, arm, result });
        console.log(JSON.stringify({ mode, round, arm, ...result }));
      }
    }
  }
  const hashes = new Set(records.map((row) => row.result.resultHash));
  if (hashes.size !== 1) {
    throw new Error("Parse results differ across versions.");
  }
  const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };
  const summary = [];
  for (const mode of ["separator", "plain"]) {
    const stable = records.filter((r) => r.mode === mode && r.arm === "stable");
    for (const [arm] of arms) {
      const rows = records.filter((r) => r.mode === mode && r.arm === arm);
      const ratios = rows.map((r, i) =>
        r.result.medianMs / stable[i].result.medianMs
      );
      summary.push({
        mode,
        arm,
        medianMs: median(rows.map((r) => r.result.medianMs)),
        pairedRatio: median(ratios),
        ratioMin: Math.min(...ratios),
        ratioMax: Math.max(...ratios),
      });
    }
  }
  const revision = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  const report = {
    capturedAt: new Date().toISOString(),
    node: process.version,
    platform: platform(),
    arch: arch(),
    cpu: cpus()[0]?.model,
    revision: revision.status === 0 ? revision.stdout.trim() : "unknown",
    rounds,
    warmupParses,
    timedParses,
    pathCount,
    arms: arms.map(([arm, root]) => ({ arm, root })),
    records,
    summary,
  };
  mkdirSync(resolve(repoRoot, "tmp/parse-scope"), { recursive: true });
  writeFileSync(
    resolve(repoRoot, "tmp/parse-scope/runs.json"),
    JSON.stringify(report, null, 2) + "\n",
  );
  console.table(summary);
  process.exit(0);
}

const mode = process.argv[3];
if (mode !== "separator" && mode !== "plain") {
  throw new TypeError("Input mode must be separator or plain.");
}
const rootPath = resolve(repoRoot, process.argv[2]);
const packageRoot = pathToFileURL(rootPath).href;
// Fingerprint the actual built JS, including unpublished working-tree changes.
const digest = createHash("sha256");
function hashDist(directory, prefix = "") {
  for (
    const entry of readdirSync(directory, { withFileTypes: true }).sort((
      a,
      b,
    ) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  ) {
    const relative = `${prefix}${entry.name}`;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) hashDist(path, `${relative}/`);
    else if (entry.isFile() && entry.name.endsWith(".js")) {
      digest.update(relative).update("\0").update(readFileSync(path)).update(
        "\0",
      );
    }
  }
}
hashDist(resolve(rootPath, "dist"));
const distHash = digest.digest("hex");

const { object } = await import(`${packageRoot}/dist/constructs.js`);
const { multiple, optional } = await import(`${packageRoot}/dist/modifiers.js`);
const { parseSync } = await import(`${packageRoot}/dist/parser.js`);
const { argument, flag, option, passThrough } = await import(
  `${packageRoot}/dist/primitives.js`
);
const { string } = await import(`${packageRoot}/dist/valueparser.js`);

// Git accepts any unambiguous prefix of a long option, so each flag declares them all.
function prefixes(name, shortestStem) {
  const stem = name.slice(2);
  const names = [];
  for (let length = shortestStem; length <= stem.length; length += 1) {
    names.push(`--${stem.slice(0, length)}`);
  }
  return names;
}

const parser = object({
  all: multiple(flag("-a", "--all")),
  only: multiple(flag("-o", "--only")),
  noOnly: multiple(flag("--no-only")),
  include: multiple(flag("-i", ...prefixes("--include", 3))),
  interactive: multiple(flag("--interactive")),
  patch: multiple(flag("-p", "--patch")),
  amend: multiple(flag("--amend")),
  allowEmpty: multiple(flag("--allow-empty")),
  dryRun: multiple(flag(...prefixes("--dry-run", 2))),
  short: multiple(flag(...prefixes("--short", 2))),
  porcelain: multiple(flag(...prefixes("--porcelain", 3))),
  long: multiple(flag(...prefixes("--long", 1))),
  nul: multiple(flag("-z", ...prefixes("--null", 2))),
  message: optional(option("-m", "--message", string())),
  file: optional(option("-F", "--file", string())),
  reuseMessage: optional(option("-C", "--reuse-message", string())),
  reeditMessage: optional(option("-c", "--reedit-message", string())),
  squash: optional(option("--squash", string())),
  fixup: optional(option("--fixup", string())),
  author: optional(option("--author", string())),
  date: optional(option("--date", string())),
  cleanup: optional(option("--cleanup", string())),
  trailer: multiple(option("--trailer", string())),
  template: optional(option("-t", "--template", string())),
  unified: optional(option("-U", "--unified", string())),
  interHunkContext: optional(option("--inter-hunk-context", string())),
  pathspecFromFile: optional(option("--pathspec-from-file", string())),
  pathspecFileNul: multiple(flag("--pathspec-file-nul")),
  paths: multiple(argument(string())),
  unknown: passThrough({ format: "nextToken" }),
});

const paths = Array.from(
  { length: pathCount },
  (_, index) =>
    `package/group-${
      index % 37
    }/package-${index}/src/feature-${index}.unit.test.ts`,
);
const args = [
  "--message",
  "x",
  ...(mode === "separator" ? ["--"] : []),
  ...paths,
];

for (let index = 0; index < warmupParses; index += 1) parseSync(parser, args);

const samples = [];
let parsedPaths = -1;
let resultHash = "";
for (let index = 0; index < timedParses; index += 1) {
  const startedAt = performance.now();
  const result = parseSync(parser, args);
  samples.push(performance.now() - startedAt);
  if (!result.success) throw new Error("Parse failed.");
  deepStrictEqual(result.value.paths, paths);
  parsedPaths = result.value.paths.length;
  const currentHash = createHash("sha256").update(JSON.stringify(result.value))
    .digest(
      "hex",
    );
  if (resultHash !== "" && resultHash !== currentHash) {
    throw new Error("Parse results differ between samples.");
  }
  resultHash = currentHash;
}
samples.sort((left, right) => left - right);

console.log(JSON.stringify({
  paths: pathCount,
  distHash,
  node: process.version,
  resultHash,
  samples,
  parsedPaths,
  medianMs: samples[Math.floor(samples.length / 2)],
  minMs: samples[0],
}));
