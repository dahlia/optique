/**
 * Matches Unicode control characters: C0 (U+0000–U+001F), DEL (U+007F),
 * C1 (U+0080–U+009F), and line separators (U+2028, U+2029).
 */
// deno-lint-ignore no-control-regex
const CONTROL_CHAR_RE = /[\x00-\x1f\x7f-\x9f\u2028\u2029]/;

const CONTROL_CHAR_RE_GLOBAL = new RegExp(CONTROL_CHAR_RE.source, "g");

/**
 * Escapes control characters in a string for readable error messages.
 *
 * @param value The string to escape.
 * @returns The escaped string with control characters replaced by escape
 *          sequences.
 */
export function escapeControlChars(value: string): string {
  return value.replace(CONTROL_CHAR_RE_GLOBAL, (ch) => {
    const code = ch.charCodeAt(0);
    switch (code) {
      case 0x09:
        return "\\t";
      case 0x0a:
        return "\\n";
      case 0x0d:
        return "\\r";
      default:
        return code > 0xff
          ? `\\u${code.toString(16).padStart(4, "0")}`
          : `\\x${code.toString(16).padStart(2, "0")}`;
    }
  });
}

/**
 * Validates option names at runtime.
 *
 * @param names The option names to validate.
 * @param label A human-readable label for error messages (e.g.,
 *              `"Option"`, `"Flag"`, `"Help option"`).
 * @throws {TypeError} If the names array is empty, or any name is empty,
 *         lacks a valid prefix, or contains whitespace or control characters.
 */
export function validateOptionNames(
  names: readonly string[],
  label: string,
): void {
  if (names.length === 0) {
    throw new TypeError(
      `Expected at least one ${label.toLowerCase()} name.`,
    );
  }
  for (const name of names) {
    if (name === "") {
      throw new TypeError(`${label} name must not be empty.`);
    }
    if (/^\s+$/.test(name)) {
      throw new TypeError(
        `${label} name must not be whitespace-only: ` +
          `"${escapeControlChars(name)}".`,
      );
    }
    if (CONTROL_CHAR_RE.test(name)) {
      throw new TypeError(
        `${label} name must not contain control characters: ` +
          `"${escapeControlChars(name)}".`,
      );
    }
    if (/\s/.test(name)) {
      throw new TypeError(
        `${label} name must not contain whitespace: ` +
          `"${escapeControlChars(name)}".`,
      );
    }
    if (!/^(--|[-/+])/.test(name)) {
      throw new TypeError(
        `${label} name must start with "--", "-", "/", or "+": "${name}".`,
      );
    }
    if (name === "--") {
      throw new TypeError(
        `${label} name must not be the options terminator "--".`,
      );
    }
  }
}

/**
 * Validates command names at runtime.
 *
 * @param names The command names to validate.
 * @param label A human-readable label for error messages (e.g.,
 *              `"Help command"`).
 * @throws {TypeError} If the names array is empty, or any name is empty,
 *         whitespace-only, or contains whitespace or control characters.
 */
export function validateCommandNames(
  names: readonly string[],
  label: string,
): void {
  if (names.length === 0) {
    throw new TypeError(
      `Expected at least one ${label.toLowerCase()} name.`,
    );
  }
  for (const name of names) {
    if (name === "") {
      throw new TypeError(`${label} name must not be empty.`);
    }
    if (/^\s+$/.test(name)) {
      throw new TypeError(
        `${label} name must not be whitespace-only: ` +
          `"${escapeControlChars(name)}".`,
      );
    }
    if (CONTROL_CHAR_RE.test(name)) {
      throw new TypeError(
        `${label} name must not contain control characters: ` +
          `"${escapeControlChars(name)}".`,
      );
    }
    if (/\s/.test(name)) {
      throw new TypeError(
        `${label} name must not contain whitespace: ` +
          `"${escapeControlChars(name)}".`,
      );
    }
  }
}

/**
 * Validates a program name at runtime.
 *
 * Program names may contain spaces (e.g., file paths), but must not be empty,
 * whitespace-only, or contain control characters.
 *
 * @param programName The program name to validate.
 * @throws {TypeError} If the value is not a string, is empty,
 *         whitespace-only, or contains control characters.
 */
/**
 * Validates that there are no name collisions among meta features
 * (help, version, completion) and between meta features and user parsers.
 *
 * Checks are performed in this order:
 *
 * 1. No duplicate names within a single meta feature.
 * 2. No shared names between different meta features of the same kind
 *    (option–option or command–command).
 * 3. No meta name shadows a user-defined parser name.
 *
 * @param userOptionNames Option names extracted from the user parser.
 * @param userCommandNames Command names extracted from the user parser.
 * @param metaOptions Array of `[label, names]` tuples for active meta option
 *   features (e.g., `["help option", ["--help"]]`).
 * @param metaCommands Array of `[label, names]` tuples for active meta command
 *   features (e.g., `["help command", ["help"]]`).
 * @throws {TypeError} If any collision or duplicate is detected.
 * @since 1.0.0
 */
export function validateMetaNameCollisions(
  userOptionNames: ReadonlySet<string>,
  userCommandNames: ReadonlySet<string>,
  metaOptions: readonly (readonly [string, readonly string[]])[],
  metaCommands: readonly (readonly [string, readonly string[]])[],
): void {
  checkMetaNames(userOptionNames, metaOptions, "option");
  checkMetaNames(userCommandNames, metaCommands, "command");
}

function checkMetaNames(
  userNames: ReadonlySet<string>,
  metaEntries: readonly (readonly [string, readonly string[]])[],
  kind: "option" | "command",
): void {
  // 1. Check for duplicates within each meta feature
  for (const [label, names] of metaEntries) {
    const seen = new Set<string>();
    for (const name of names) {
      if (seen.has(name)) {
        throw new TypeError(
          `${capitalize(label)} has a duplicate name: "${name}"`,
        );
      }
      seen.add(name);
    }
  }

  // 2. Check for collisions between meta features
  const nameToLabel = new Map<string, string>();
  for (const [label, names] of metaEntries) {
    for (const name of names) {
      const existingLabel = nameToLabel.get(name);
      if (existingLabel != null) {
        throw new TypeError(
          `${capitalize(kind)} name "${name}" is used by both ` +
            `${existingLabel} and ${label}.`,
        );
      }
      nameToLabel.set(name, label);
    }
  }

  // 3. Check for collisions between meta features and user parser
  for (const [label, names] of metaEntries) {
    for (const name of names) {
      if (userNames.has(name)) {
        throw new TypeError(
          `User-defined ${kind} "${name}" conflicts with the ` +
            `built-in ${label}.`,
        );
      }
    }
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function validateProgramName(programName: string): void {
  if (typeof programName !== "string") {
    throw new TypeError("Program name must be a string.");
  }
  if (programName === "") {
    throw new TypeError("Program name must not be empty.");
  }
  if (/^\s+$/.test(programName)) {
    throw new TypeError(
      `Program name must not be whitespace-only: ` +
        `"${escapeControlChars(programName)}".`,
    );
  }
  if (CONTROL_CHAR_RE.test(programName)) {
    throw new TypeError(
      `Program name must not contain control characters: ` +
        `"${escapeControlChars(programName)}".`,
    );
  }
}
