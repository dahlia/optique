import { existsSync, globSync, readFileSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const within = (base, file) => {
  const rel = relative(base, file);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const read = (path) => JSON.parse(readFileSync(path, "utf8"));

export function loadMembers(root) {
  const config = read(resolve(root, "deno.json"));
  const dirs = config.workspace.flatMap((pattern) => [
    ...globSync(pattern, { cwd: root }),
  ]);
  return dirs.flatMap((dir) => {
    const directory = resolve(root, dir);
    const metadata = resolve(directory, "deno.json");
    if (!existsSync(metadata)) return [];
    return [{ directory, ...read(metadata) }];
  });
}

export function createSourceResolver(root, members) {
  const spelling = root;
  root = realpathSync(root);
  members = members.map((member) => {
    const directory = realpathSync(member.directory);
    if (!within(root, directory)) {
      throw new TypeError("Workspace member escapes root.");
    }
    return { ...member, directory };
  });
  const byName = new Map(members.filter((m) => m.name).map((m) => [m.name, m]));
  return function sourceURL(specifier, parentURL) {
    if (!parentURL?.startsWith("file:")) return;
    let parent = fileURLToPath(parentURL);
    // Existing symlinks must not turn an isolated/dependency importer into an owner.
    if (existsSync(parent)) parent = realpathSync(parent);
    else if (within(spelling, parent)) {
      parent = resolve(root, relative(spelling, parent));
    }
    if (!within(root, parent)) return;
    const parts = relative(root, parent).split(sep);
    if (
      parts.some((p) =>
        [
          "node_modules",
          "dist",
          "tmp",
          ".git",
          "fixtures",
          "test-fixtures",
        ].includes(p),
      )
    )
      return;
    const owner = members
      .filter((m) => within(m.directory, parent))
      .sort((a, b) => b.directory.length - a.directory.length)[0];
    // Root-level tests and repository script/docs tests have no private owner.
    if (!owner && parts.length !== 1 && !["scripts", "docs"].includes(parts[0]))
      return;
    const match = specifier.match(/^([^?#]*)(.*)$/);
    // A leading # is a private specifier, not a fragment.
    const privateMatch = specifier.startsWith("#")
      ? specifier.slice(1).match(/^([^?#]*)(.*)$/)
      : undefined;
    const bare = privateMatch ? `#${privateMatch[1]}` : match[1];
    const suffix = privateMatch ? privateMatch[2] : match[2];
    let target;
    let targetOwner;
    if (bare.startsWith("#")) {
      if (!owner) return;
      const mappings = Object.entries(owner.imports ?? {})
        .filter(([key]) => key.startsWith("#"))
        .sort(([a], [b]) => b.length - a.length);
      for (const [key, value] of mappings) {
        if (bare === key || (key.endsWith("/") && bare.startsWith(key))) {
          target = key.endsWith("/")
            ? `${value}${bare.slice(key.length)}`
            : value;
          targetOwner = owner;
          break;
        }
      }
      if (!target) {
        throw Object.assign(
          new Error(`Private source mapping is not defined: ${bare}`),
          { code: "ERR_PACKAGE_IMPORT_NOT_DEFINED" },
        );
      }
    } else {
      const name = bare.startsWith("@")
        ? bare.split("/").slice(0, 2).join("/")
        : bare.split("/")[0];
      targetOwner = byName.get(name);
      if (!targetOwner) return;
      const subpath = bare === name ? "." : `.${bare.slice(name.length)}`;
      const exports = targetOwner.exports;
      target =
        typeof exports === "string" && subpath === "."
          ? exports
          : exports?.[subpath];
      if (typeof target !== "string") {
        throw Object.assign(
          new Error(`Workspace subpath is not exported: ${bare}`),
          { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" },
        );
      }
    }
    const filename = resolve(targetOwner.directory, target);
    if (
      !within(targetOwner.directory, filename) ||
      relative(targetOwner.directory, filename)
        .split(sep)
        .some((p) => ["dist", "node_modules"].includes(p))
    ) {
      throw new TypeError(`Unsafe workspace source mapping: ${specifier}`);
    }
    if (
      existsSync(filename) &&
      !within(realpathSync(targetOwner.directory), realpathSync(filename))
    ) {
      throw new TypeError(
        `Symlink source mapping escapes its owner: ${specifier}`,
      );
    }
    return pathToFileURL(filename).href + suffix;
  };
}
