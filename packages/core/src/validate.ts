/**
 * Escapes control characters in a string for readable error messages.
 *
 * @param value The string to escape.
 * @returns The escaped string with control characters replaced by escape
 *          sequences.
 */
export function escapeControlChars(value: string): string {
  // deno-lint-ignore no-control-regex
  return value.replace(/[\x00-\x1f\x7f\x85\u2028\u2029]/g, (ch) => {
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
    // deno-lint-ignore no-control-regex
    if (/[\x00-\x1f\x7f\x85\u2028\u2029]/.test(name)) {
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
    // deno-lint-ignore no-control-regex
    if (/[\x00-\x1f\x7f\x85\u2028\u2029]/.test(name)) {
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
  // deno-lint-ignore no-control-regex
  if (/[\x00-\x1f\x7f\x85\u2028\u2029]/.test(programName)) {
    throw new TypeError(
      `Program name must not contain control characters: ` +
        `"${escapeControlChars(programName)}".`,
    );
  }
}
