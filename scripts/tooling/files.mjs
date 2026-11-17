import { existsSync, globSync, readdirSync, readFileSync } from "node:fs";
import { join, matchesGlob, relative, resolve } from "node:path";

const read = (file) => JSON.parse(readFileSync(file, "utf8"));
const excludedDirectories = new Set(["node_modules", "dist", ".git", "tmp"]);
// These Deno-only isolation exclusions do not transfer tooling ownership.
const nodeOnly = new Set([
  "scripts/types/",
  "scripts/check-types.ts",
  "scripts/check-types.test.ts",
  "scripts/tooling/",
]);
const extensions = {
  lint: /\.(?:[cm]?[jt]s|[jt]sx)$/,
  format: /\.(?:[cm]?[jt]s|[jt]sx|jsonc?)$/,
};

/** Retains Deno's general/member exclusions and the format-only exclusions. */
export function ownedFiles(root, kind) {
  if (!Object.hasOwn(extensions, kind)) {
    throw new TypeError(`Unknown ownership: ${kind}`);
  }
  const config = read(join(root, "deno.json"));
  const rules = [{ directory: root, config }];
  for (const pattern of config.workspace ?? []) {
    for (const name of globSync(pattern, { cwd: root })) {
      const directory = resolve(root, name);
      if (existsSync(join(directory, "deno.json"))) {
        rules.push({ directory, config: read(join(directory, "deno.json")) });
      }
    }
  }
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      const local = relative(root, file).replaceAll("\\", "/");
      // Match the bounded generated report trees in the root .gitignore,
      // without excluding production directories such as src/coverage/.
      if (
        entry.isDirectory() &&
        (local === "coverage" || /^packages\/[^/]+\/coverage$/.test(local))
      ) continue;
      const excluded = rules.some(({ directory: base, config: data }) => {
        const local = relative(base, file).replaceAll("\\", "/");
        if (local.startsWith("../")) return false;
        const patterns = [
          ...(data.exclude ?? []).filter((pattern) =>
            base !== root || !nodeOnly.has(pattern)
          ),
          ...(kind === "format" ? data.fmt?.exclude ?? [] : []),
        ];
        return patterns.some((pattern) => {
          const clean = pattern.replace(/\/$/, "");
          return local === clean || local.startsWith(`${clean}/`) ||
            matchesGlob(local, clean);
        });
      });
      if (excluded) continue;
      if (entry.isDirectory() && !excludedDirectories.has(entry.name)) {
        visit(file);
      } else if (entry.isFile() && extensions[kind].test(entry.name)) {
        files.push(relative(root, file).replaceAll("\\", "/"));
      }
    }
  }
  visit(root);
  return files.sort();
}
