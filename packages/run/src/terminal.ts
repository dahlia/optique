import process from "node:process";

type EnvironmentVariable =
  | "FORCE_COLOR"
  | "NO_COLOR"
  | "NODE_DISABLE_COLORS"
  | "COLUMNS";
type EnvironmentReader = (name: EnvironmentVariable) => string | undefined;

/**
 * Resolves automatic color settings without changing the supplied environment.
 * @param stream The output stream's TTY status.
 * @param readEnv Reads one environment variable at a time.
 * @returns The color preference, preserving an unspecified TTY fallback.
 * @internal
 */
export function detectColorSupport(
  stream: { readonly isTTY?: boolean },
  readEnv: EnvironmentReader,
): boolean | undefined {
  const forceColor = readEnv("FORCE_COLOR");
  if (forceColor != null && forceColor !== "") return true;
  const noColor = readEnv("NO_COLOR");
  if (noColor != null && noColor !== "") return false;
  if (readEnv("NODE_DISABLE_COLORS") != null) return false;
  return stream.isTTY;
}

/**
 * Resolves a usable reported width, leaving unknown widths unwrapped.
 * @param stream The output stream's reported width.
 * @param readEnv Reads COLUMNS if the stream has no valid width.
 * @returns A positive finite integer, or undefined when neither source is valid.
 * @internal
 */
export function detectTerminalWidth(
  stream: { readonly columns?: number },
  readEnv: EnvironmentReader,
): number | undefined {
  const columns = stream.columns;
  if (columns != null && Number.isInteger(columns) && columns > 0) {
    return columns;
  }
  const value = readEnv("COLUMNS");
  // Reject non-digits anywhere, including a final newline (which `$` can match).
  if (value == null || value === "" || /[^0-9]/u.test(value)) return undefined;
  const width = Number(value);
  return Number.isInteger(width) && width > 0 ? width : undefined;
}

/**
 * Reads an optional terminal setting without requesting runtime permissions.
 * @param name The environment variable to read.
 * @returns Its value, or undefined when absent or inaccessible.
 * @internal
 */
export function readEnvironmentVariable(
  name: EnvironmentVariable,
): string | undefined {
  try {
    // Deno permits FORCE_COLOR and NO_COLOR even without --allow-env. Its
    // permission query does not reflect that exemption, so only query the
    // other variables. Reading a prompt-state variable could otherwise prompt.
    if (name === "NODE_DISABLE_COLORS" || name === "COLUMNS") {
      const deno = (globalThis as {
        readonly Deno?: {
          readonly permissions?: {
            querySync?(descriptor: {
              readonly name: "env";
              readonly variable: string;
            }): { readonly state: string };
          };
        };
      }).Deno;
      if (
        deno != null &&
        deno.permissions?.querySync?.({ name: "env", variable: name }).state !==
          "granted"
      ) return undefined;
    }
    return process.env[name];
  } catch {
    // Automatic formatting must still work when optional environment access
    // is denied, including when permissions change after the query.
    return undefined;
  }
}
