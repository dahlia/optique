import { accessSync, constants, statSync } from "node:fs";
import { delimiter, resolve } from "node:path";

/**
 * Finds a POSIX executable on the invoking PATH, preserving its entry path.
 * Stat and access checks follow symlinks; spawning the entry preserves argv[0].
 *
 * @throws {TypeError} If no executable regular file is found.
 */
export function resolveExecutable(
  name: string,
  path = process.env.PATH ?? "",
): string {
  for (const directory of path.split(delimiter)) {
    const candidate = resolve(directory === "" ? "." : directory, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch (error) {
      if (
        !(error instanceof Error) || !("code" in error) ||
        !["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes(String(error.code))
      ) throw error;
    }
  }
  throw new TypeError(`Executable was not found on PATH: ${name}`);
}
