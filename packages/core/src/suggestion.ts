import type { Message, MessageTerm } from "./message.ts";
import { message, optionName, text } from "./message.ts";
import type { Usage } from "./usage.ts";
import { extractCommandNames, extractOptionNames } from "./usage.ts";

/**
 * Calculates the Levenshtein distance between two strings.
 *
 * The Levenshtein distance is the minimum number of single-character edits
 * (insertions, deletions, or substitutions) required to transform one string
 * into another.
 *
 * @param source The source string
 * @param target The target string
 * @returns The edit distance (number of insertions, deletions, substitutions)
 *
 * @example
 * ```typescript
 * levenshteinDistance("kitten", "sitting"); // returns 3
 * levenshteinDistance("--verbos", "--verbose"); // returns 1
 * levenshteinDistance("hello", "hello"); // returns 0
 * ```
 */
export function levenshteinDistance(source: string, target: string): number {
  // Handle empty strings
  if (source.length === 0) return target.length;
  if (target.length === 0) return source.length;

  // Optimize: use the shorter string for the inner loop
  if (source.length > target.length) {
    [source, target] = [target, source];
  }

  // Use space-optimized approach: only keep two rows
  let previousRow = new Array(source.length + 1);
  let currentRow = new Array(source.length + 1);

  // Initialize first row: 0, 1, 2, 3, ...
  for (let i = 0; i <= source.length; i++) {
    previousRow[i] = i;
  }

  // Calculate distances
  for (let j = 1; j <= target.length; j++) {
    currentRow[0] = j;

    for (let i = 1; i <= source.length; i++) {
      const cost = source[i - 1] === target[j - 1] ? 0 : 1;

      currentRow[i] = Math.min(
        currentRow[i - 1] + 1, // insertion
        previousRow[i] + 1, // deletion
        previousRow[i - 1] + cost, // substitution
      );
    }

    // Swap rows
    [previousRow, currentRow] = [currentRow, previousRow];
  }

  return previousRow[source.length];
}

/**
 * Options for finding similar strings.
 */
export interface FindSimilarOptions {
  /**
   * Maximum edit distance to consider a match.
   * Strings with a distance greater than this value will not be suggested.
   * @default 3
   */
  readonly maxDistance?: number;

  /**
   * Maximum distance ratio (distance / input length).
   * Prevents suggesting long strings for very short inputs.
   * For example, with maxDistanceRatio=0.5, an input of length 2
   * will only suggest strings within distance 1.
   * @default 0.5
   */
  readonly maxDistanceRatio?: number;

  /**
   * Maximum number of suggestions to return.
   * @default 3
   */
  readonly maxSuggestions?: number;

  /**
   * Case-sensitive comparison.
   * If false, strings are compared case-insensitively.
   * @default false
   */
  readonly caseSensitive?: boolean;
}

/**
 * Default options for finding similar strings.
 * These values are optimized for command-line option/command name suggestions.
 *
 * @since 0.7.0
 */
export const DEFAULT_FIND_SIMILAR_OPTIONS: Required<FindSimilarOptions> = {
  maxDistance: 3,
  maxDistanceRatio: 0.5,
  maxSuggestions: 3,
  caseSensitive: false,
} as const;

/**
 * Finds similar strings from a list of candidates.
 *
 * This function uses Levenshtein distance to find strings that are similar
 * to the input string. Results are sorted by similarity (most similar first).
 *
 * @param input The input string to find matches for
 * @param candidates List of candidate strings to compare against
 * @param options Configuration options
 * @returns Array of similar strings, sorted by similarity (most similar first)
 *
 * @example
 * ```typescript
 * const candidates = ["--verbose", "--version", "--verify", "--help"];
 * findSimilar("--verbos", candidates);
 * // returns ["--verbose"]
 *
 * findSimilar("--ver", candidates, { maxDistance: 5 });
 * // returns ["--verify", "--version", "--verbose"]
 *
 * findSimilar("--xyz", candidates);
 * // returns [] (no similar matches)
 * ```
 */
export function findSimilar(
  input: string,
  candidates: Iterable<string>,
  options: FindSimilarOptions = {},
): string[] {
  // Apply defaults
  const maxDistance = options.maxDistance ??
    DEFAULT_FIND_SIMILAR_OPTIONS.maxDistance;
  const maxDistanceRatio = options.maxDistanceRatio ??
    DEFAULT_FIND_SIMILAR_OPTIONS.maxDistanceRatio;
  const maxSuggestions = options.maxSuggestions ??
    DEFAULT_FIND_SIMILAR_OPTIONS.maxSuggestions;
  const caseSensitive = options.caseSensitive ??
    DEFAULT_FIND_SIMILAR_OPTIONS.caseSensitive;

  // Return empty if input is empty
  if (input.length === 0) return [];

  // Normalize input for comparison
  const normalizedInput = caseSensitive ? input : input.toLowerCase();

  // Collect matches with their distances
  const matches: Array<{ candidate: string; distance: number }> = [];

  for (const candidate of candidates) {
    // Normalize candidate for comparison
    const normalizedCandidate = caseSensitive
      ? candidate
      : candidate.toLowerCase();

    // Calculate distance
    const distance = levenshteinDistance(normalizedInput, normalizedCandidate);

    // Early termination for exact match
    if (distance === 0) {
      return [candidate];
    }

    // Check if within thresholds
    const distanceRatio = distance / input.length;
    if (distance <= maxDistance && distanceRatio <= maxDistanceRatio) {
      matches.push({ candidate, distance });
    }
  }

  // Sort by:
  // 1. Distance (ascending)
  // 2. Length difference from input (ascending)
  // 3. Alphabetical (ascending)
  matches.sort((a, b) => {
    if (a.distance !== b.distance) {
      return a.distance - b.distance;
    }

    const lengthDiffA = Math.abs(a.candidate.length - input.length);
    const lengthDiffB = Math.abs(b.candidate.length - input.length);
    if (lengthDiffA !== lengthDiffB) {
      return lengthDiffA - lengthDiffB;
    }

    return a.candidate.localeCompare(b.candidate);
  });

  // Return top N suggestions
  return matches.slice(0, maxSuggestions).map((m) => m.candidate);
}

/**
 * Creates a suggestion message for a mismatched option/command.
 *
 * This function formats suggestions in a user-friendly way:
 * - No suggestions: returns empty message
 * - One suggestion: "Did you mean `option`?"
 * - Multiple suggestions: "Did you mean one of these?\n  option1\n  option2"
 *
 * @param suggestions List of similar valid options/commands
 * @returns A Message array with suggestion text
 *
 * @example
 * ```typescript
 * createSuggestionMessage(["--verbose", "--version"]);
 * // returns message parts for:
 * // "Did you mean one of these?
 * //   --verbose
 * //   --version"
 *
 * createSuggestionMessage(["--verbose"]);
 * // returns message parts for:
 * // "Did you mean `--verbose`?"
 *
 * createSuggestionMessage([]);
 * // returns []
 * ```
 */
export function createSuggestionMessage(
  suggestions: readonly string[],
): Message {
  if (suggestions.length === 0) {
    return [];
  }

  if (suggestions.length === 1) {
    return message`Did you mean ${optionName(suggestions[0])}?`;
  }

  // Multiple suggestions
  const messageParts: MessageTerm[] = [text("Did you mean one of these?")];

  for (const suggestion of suggestions) {
    messageParts.push(text("\n  "));
    messageParts.push(optionName(suggestion));
  }

  return messageParts;
}

/**
 * Creates an error message with suggestions for similar options or commands.
 *
 * This is a convenience function that combines the functionality of
 * `findSimilar()` and `createSuggestionMessage()` to generate user-friendly
 * error messages with "Did you mean?" suggestions.
 *
 * @param baseError The base error message to display
 * @param invalidInput The invalid option or command name that the user typed
 * @param usage The usage information to extract available options/commands from
 * @param type What type of names to suggest ("option", "command", or "both")
 * @param customFormatter Optional custom function to format suggestions instead
 *                        of using the default "Did you mean?" formatting
 * @returns A message combining the base error with suggestions, or just the
 *          base error if no similar names are found
 *
 * @example
 * ```typescript
 * const baseError = message`No matched option for ${optionName("--verbos")}.`;
 * const error = createErrorWithSuggestions(
 *   baseError,
 *   "--verbos",
 *   context.usage,
 *   "option"
 * );
 * // Returns: "No matched option for `--verbos`.\nDid you mean `--verbose`?"
 * ```
 *
 * @since 0.7.0
 */
export function createErrorWithSuggestions(
  baseError: Message,
  invalidInput: string,
  usage: Usage,
  type: "option" | "command" | "both" = "both",
  customFormatter?: (suggestions: readonly string[]) => Message,
): Message {
  const candidates = new Set<string>();

  if (type === "option" || type === "both") {
    for (const name of extractOptionNames(usage)) {
      candidates.add(name);
    }
  }

  if (type === "command" || type === "both") {
    for (const name of extractCommandNames(usage)) {
      candidates.add(name);
    }
  }

  const suggestions = findSimilar(
    invalidInput,
    candidates,
    DEFAULT_FIND_SIMILAR_OPTIONS,
  );

  const suggestionMsg = customFormatter
    ? customFormatter(suggestions)
    : createSuggestionMessage(suggestions);

  return suggestionMsg.length > 0
    ? [...baseError, text("\n\n"), ...suggestionMsg]
    : baseError;
}
