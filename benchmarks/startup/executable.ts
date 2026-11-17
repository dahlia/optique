import {
  accessSync,
  constants,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { delimiter, resolve, sep } from "node:path";

/**
 * Resolves a real runtime from the invoking task's PATH, including task-local
 * mise tools that are not active in the directory's global configuration.
 *
 * @throws {TypeError} If the runtime is missing, a shim, or a script wrapper.
 */
export function resolveRuntimeExecutable(
  name: string,
  path = process.env.PATH ?? "",
): string {
  const executable = realpathSync(resolveExecutable(name, path));
  if (
    executable.includes(`${sep}shims${sep}`) ||
    readFileSync(executable).subarray(0, 2).toString() === "#!"
  ) {
    throw new TypeError(`Runtime must be a real executable: ${executable}`);
  }
  return executable;
}

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
        !(error instanceof Error) ||
        !("code" in error) ||
        !["ENOENT", "ENOTDIR", "EACCES", "ELOOP"].includes(String(error.code))
      )
        throw error;
    }
  }
  throw new TypeError(`Executable was not found on PATH: ${name}`);
}
