/**
 * A minimal abstraction of a writable stream (like `process.stdout`) to allow
 * for dependency injection during testing without mutating global state.
 *
 * @internal
 */
export interface StdoutLike {
  isTTY?: boolean;
  columns?: number;
  hasColors?: (depth?: number) => boolean;
}

/**
 * A minimal abstraction of a process environment (like `process.env`).
 *
 * @internal
 */
export type EnvLike = Record<string, string | undefined>;

/**
 * Detects whether the terminal supports color output based on environment
 * variables and TTY status.
 *
 * @param stdout - The standard output stream to check for TTY status.
 * @param env - The environment variables to check for color overrides.
 * @returns `true` if colors should be enabled, `false` otherwise.
 *
 * @internal
 */
export function detectColorSupport(stdout: StdoutLike, env: EnvLike): boolean {
  if (env.FORCE_COLOR !== undefined) {
    switch (env.FORCE_COLOR) {
      case "1":
      case "2":
      case "3":
      case "true":
      case "":
        return true;
      default:
        return false;
    }
  }
  if (env.NO_COLOR !== undefined || env.NODE_DISABLE_COLORS !== undefined) {
    return false;
  }
  return stdout.isTTY ?? false;
}

/**
 * Detects the terminal width in columns, falling back to the `COLUMNS`
 * environment variable if the stream does not provide a valid width.
 *
 * @param stdout - The standard output stream to check for column width.
 * @param env - The environment variables to check for fallback column width.
 * @returns The detected terminal width as a positive integer, or `undefined` if undetected.
 *
 * @internal
 */
export function detectTerminalWidth(
  stdout: StdoutLike,
  env: EnvLike,
): number | undefined {
  if (
    typeof stdout.columns === "number" &&
    Number.isInteger(stdout.columns) &&
    stdout.columns > 0
  ) {
    return stdout.columns;
  }
  if (typeof env.COLUMNS === "string") {
    if (/^\s*\d+\s*$/.test(env.COLUMNS)) {
      const parsed = Number(env.COLUMNS);
      if (Number.isSafeInteger(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }
  return undefined;
}
