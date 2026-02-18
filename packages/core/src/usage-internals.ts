/**
 * Internal utilities for usage-tree traversal.
 *
 * These functions are *not* part of the public API and are subject to change
 * without notice.  Import them only from within the `@optique/core` package
 * sources; do not re-export them from any public subpath.
 */
import type { Usage } from "./usage.ts";

/**
 * Collects option names and command names that are valid as the *immediate*
 * next token at the current parse position ("leading candidates").
 *
 * Unlike the full-tree extractors in `usage.ts`, this function stops
 * descending into a branch as soon as it hits a required (blocking) term —
 * an option, a command, or a required argument.  Optional and zero-or-more
 * terms are traversed but do not block.
 *
 * @param terms  The usage terms to inspect.
 * @param optionNames  Accumulator for leading option names.
 * @param commandNames  Accumulator for leading command names.
 * @returns `true` if every term in `terms` is skippable (i.e., the caller
 *          may continue scanning the next sibling term), `false` otherwise.
 */
export function collectLeadingCandidates(
  terms: Usage,
  optionNames: Set<string>,
  commandNames: Set<string>,
): boolean {
  if (!terms || !Array.isArray(terms)) return true;

  for (const term of terms) {
    if (term.type === "option") {
      for (const name of term.names) {
        optionNames.add(name);
      }
      return false;
    }

    if (term.type === "command") {
      commandNames.add(term.name);
      return false;
    }

    if (term.type === "argument") {
      return false;
    }

    if (term.type === "optional") {
      collectLeadingCandidates(term.terms, optionNames, commandNames);
      continue;
    }

    if (term.type === "multiple") {
      collectLeadingCandidates(term.terms, optionNames, commandNames);
      if (term.min === 0) continue;
      return false;
    }

    if (term.type === "exclusive") {
      let allSkippable = true;
      for (const branch of term.terms) {
        const branchSkippable = collectLeadingCandidates(
          branch,
          optionNames,
          commandNames,
        );
        allSkippable = allSkippable && branchSkippable;
      }
      if (allSkippable) continue;
      return false;
    }
  }

  return true;
}

/**
 * Returns the set of command names that are valid as the *immediate* next
 * token, derived from the leading candidates of `usage`.
 *
 * This is the command-only projection of {@link collectLeadingCandidates}
 * and is used to generate accurate "Did you mean?" suggestions in
 * `command()` error messages — suggestions are scoped to commands actually
 * reachable at the current parse position rather than all commands anywhere
 * in the usage tree.
 *
 * @param usage  The usage tree to inspect.
 * @returns A `Set` of command names valid as the next input token.
 */
export function extractLeadingCommandNames(usage: Usage): Set<string> {
  const options = new Set<string>();
  const commands = new Set<string>();
  collectLeadingCandidates(usage, options, commands);
  return commands;
}
