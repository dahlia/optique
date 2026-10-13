import type { Suggestion } from "./parser.ts";

type FileSuggestion = Extract<Suggestion, { readonly kind: "file" }>;
interface JoinedFile {
  readonly prefix: string;
  readonly file: FileSuggestion;
}
interface JoinedFiles {
  readonly files: readonly JoinedFile[];
  readonly literal: boolean;
}
const joinedFiles = new WeakMap<Suggestion, JoinedFiles>();

/**
 * Keeps a joined file fallback's origin available to the Bash encoder.
 * Other shells retain the existing literal representation.
 * @param prefix The option name and delimiter.
 * @param file The original file suggestion.
 * @param value The value prefix being completed.
 * @returns The literal fallback with private file metadata.
 * @internal
 */
export function joinedFileSuggestion(
  prefix: string,
  file: FileSuggestion,
  value: string,
): Suggestion {
  const literal: Suggestion = {
    kind: "literal",
    text: prefix + (file.pattern ?? ""),
    description: file.description,
  };
  // Fixed custom patterns have their own completion semantics and stay literal.
  if (file.pattern === undefined || file.pattern === value) {
    joinedFiles.set(literal, { files: [{ prefix, file }], literal: false });
  }
  return literal;
}

/**
 * Retrieves the originating file suggestion for a joined literal fallback.
 * @param suggestion The suggestion to inspect.
 * @returns Its private file metadata, if present.
 * @internal
 */
export function getJoinedFileSuggestion(
  suggestion: Suggestion,
): JoinedFiles | undefined {
  return joinedFiles.get(suggestion);
}

/**
 * Preserves file origins when equal literal fallbacks are deduplicated.
 * @param target The retained suggestion.
 * @param source The duplicate suggestion.
 * @internal
 */
export function mergeJoinedFileSuggestions(
  target: Suggestion,
  source: Suggestion,
): void {
  const a = joinedFiles.get(target);
  const b = joinedFiles.get(source);
  if (a === undefined && b === undefined) return;
  const files = [...(a?.files ?? []), ...(b?.files ?? [])];
  const seen = new Set<string>();
  joinedFiles.set(target, {
    literal: (a?.literal ?? true) || (b?.literal ?? true),
    files: files.filter(({ prefix, file }) => {
      const key = JSON.stringify([
        prefix,
        file.type,
        file.pattern,
        file.includeHidden === true,
        file.extensions?.toSorted(),
      ]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  });
}
