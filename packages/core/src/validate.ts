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
 * A meta entry describes one active meta feature for collision checking.
 *
 * The tuple elements are:
 *
 * 1. `kind` — `"command"` if this meta feature matches at `args[0]` only,
 *    or `"option"` if a lenient scanner matches the name anywhere in `argv`.
 * 2. `label` — human-readable label for error messages (e.g., `"help option"`).
 * 3. `names` — the configured name(s) for this meta feature.
 * 4. `prefixMatch` — when `true`, the runtime also intercepts tokens
 *    starting with `name=` (e.g., `--completion=bash`).  Only the
 *    completion option uses this form; help/version use exact matching.
 *
 * @since 1.0.0
 */
export type MetaEntry = readonly [
  kind: "command" | "option",
  label: string,
  names: readonly string[],
  prefixMatch?: boolean,
];

/**
 * User parser names extracted at different scopes for collision checking.
 *
 * User-level names are no longer rejected merely for overlapping with
 * built-in meta names.  The runner now resolves those cases at parse time
 * so ordinary parser data can shadow meta handlers when appropriate.
 *
 * @since 1.0.0
 */
export interface UserParserNames {
  /** Names (option names, command names) reachable at the first buffer
   *  position.  A flat set from {@link Parser.leadingNames}. */
  readonly leadingNames: ReadonlySet<string>;
  /** All option names at any depth. */
  readonly allOptions: ReadonlySet<string>;
  /** All command names at any depth. */
  readonly allCommands: ReadonlySet<string>;
  /** All literal values at any depth (e.g., conditional discriminator
   *  values). */
  readonly allLiterals: ReadonlySet<string>;
}

/**
 * Validates that there are no name collisions among active meta features
 * (help, version, completion).
 *
 * User parser names are accepted even when they overlap with meta names.
 * Runtime parsing resolves those cases parser-first so ordinary parser data
 * can shadow built-in meta behavior.
 *
 * Meta-vs-meta collisions are always checked in a unified namespace,
 * because a meta command named `"--help"` and a meta option named
 * `"--help"` both compete for the same token.
 *
 * @param userNames User parser names extracted at different scopes.
 *                  Currently unused, but retained to keep the runtime call
 *                  site stable.
 * @param metaEntries Active meta feature entries annotated with their kind.
 * @throws {TypeError} If any meta/meta collision or duplicate is detected.
 * @since 1.0.0
 */
export function validateMetaNameCollisions(
  _userNames: UserParserNames,
  metaEntries: readonly MetaEntry[],
): void {
  // 1. Check for duplicates within each meta feature
  for (const [, label, names] of metaEntries) {
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

  // 2. Check for collisions between any two meta features (unified namespace)
  const nameToLabel = new Map<string, string>();
  for (const [, label, names] of metaEntries) {
    for (const name of names) {
      const existingLabel = nameToLabel.get(name);
      if (existingLabel != null) {
        throw new TypeError(
          `Name "${name}" is used by both ` +
            `${existingLabel} and ${label}.`,
        );
      }
      nameToLabel.set(name, label);
    }
  }
  // Also check prefix-based meta/meta collisions: if a prefixMatch
  // entry (completion option) claims "name=...", other meta names
  // starting with that prefix would be intercepted at runtime.
  for (let i = 0; i < metaEntries.length; i++) {
    const [, label, names, prefixMatch] = metaEntries[i];
    if (!prefixMatch) continue;
    for (const name of names) {
      const prefix = name + "=";
      for (let j = 0; j < metaEntries.length; j++) {
        const [, otherLabel, otherNames] = metaEntries[j];
        for (const otherName of otherNames) {
          if (i === j && otherName === name) continue;
          if (!otherName.startsWith(prefix)) continue;
          throw new TypeError(
            'The prefix form of name "' + name + '" in ' + label +
              ' shadows "' + otherName + '" in ' + otherLabel + ".",
          );
        }
      }
    }
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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
  if (CONTROL_CHAR_RE.test(programName)) {
    throw new TypeError(
      `Program name must not contain control characters: ` +
        `"${escapeControlChars(programName)}".`,
    );
  }
}

/**
 * Validates a label at runtime.
 *
 * Labels are used as section titles in documentation output.  They may contain
 * spaces (e.g., "Connection options"), but must not be empty, whitespace-only,
 * or contain control characters.
 *
 * @param label The label to validate.
 * @throws {TypeError} If the label is not a string, is empty,
 *         whitespace-only, or contains control characters.
 * @since 1.0.0
 */
export function validateLabel(label: string): void {
  if (typeof label !== "string") {
    throw new TypeError("Label must be a string.");
  }
  if (label === "") {
    throw new TypeError("Label must not be empty.");
  }
  if (/^\s+$/.test(label)) {
    throw new TypeError(
      `Label must not be whitespace-only: "${escapeControlChars(label)}".`,
    );
  }
  if (CONTROL_CHAR_RE.test(label)) {
    throw new TypeError(
      `Label must not contain control characters: ` +
        `"${escapeControlChars(label)}".`,
    );
  }
}

/**
 * Validates that all source contexts have unique
 * {@link import("./context.ts").SourceContext.id | id} values.
 *
 * @param contexts The source contexts to validate.
 * @throws {TypeError} If two or more contexts share the same id.
 * @since 1.0.0
 */
export function validateContextIds(
  contexts: readonly { readonly id: symbol }[],
): void {
  const seen = new Set<symbol>();
  for (const context of contexts) {
    if (seen.has(context.id)) {
      throw new TypeError(
        `Duplicate SourceContext id: ${String(context.id)}`,
      );
    }
    seen.add(context.id);
  }
}
