import * as path from "node:path";

/**
 * Checks whether a normalized absolute file path is below an input root.
 * @param directory The allowed input directory.
 * @param candidate The normalized absolute file path.
 * @param style The host path rules, or explicit rules for a lexical check.
 * @returns Whether the candidate is a strict descendant of the directory.
 */
export function isPathWithin(
  directory: string,
  candidate: string,
  style: Pick<typeof path, "relative" | "isAbsolute" | "sep"> = path,
): boolean {
  const relative = style.relative(directory, candidate);
  return relative !== "" && relative !== ".." &&
    !relative.startsWith(`..${style.sep}`) && !style.isAbsolute(relative);
}
