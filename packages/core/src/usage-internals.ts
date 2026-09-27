/**
 * Internal utilities for usage-tree traversal.
 *
 * These functions are *not* part of the public API and are subject to change
 * without notice.  Import them only from within the `@optique/core` package
 * sources; do not re-export them from any public subpath.
 */
import { isSuggestionHidden, type Usage } from "./usage.ts";

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
  includeHidden = false,
): boolean {
  if (!terms || !Array.isArray(terms)) return true;

  for (const term of terms) {
    if (term.type === "option") {
      if (includeHidden || !isSuggestionHidden(term.hidden)) {
        for (const name of term.names) {
          optionNames.add(name);
        }
      }
      return false;
    }

    if (term.type === "command") {
      if (includeHidden || !isSuggestionHidden(term.hidden)) {
        commandNames.add(term.name);
        for (const alias of term.aliases ?? []) {
          commandNames.add(alias);
        }
        for (const alias of term.hiddenAliases ?? []) {
          commandNames.add(alias);
        }
      }
      return false;
    }

    if (term.type === "argument") {
      return false;
    }

    if (term.type === "optional") {
      collectLeadingCandidates(
        term.terms,
        optionNames,
        commandNames,
        includeHidden,
      );
      continue;
    }

    if (term.type === "multiple") {
      collectLeadingCandidates(
        term.terms,
        optionNames,
        commandNames,
        includeHidden,
      );
      if (term.min === 0) continue;
      return false;
    }

    if (term.type === "sequence") {
      if (
        collectLeadingCandidates(
          term.terms,
          optionNames,
          commandNames,
          includeHidden,
        )
      ) {
        continue;
      }
      return false;
    }

    if (term.type === "exclusive") {
      let allSkippable = true;
      for (const branch of term.terms) {
        const branchSkippable = collectLeadingCandidates(
          branch,
          optionNames,
          commandNames,
          includeHidden,
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
 * `command()` error messages—suggestions are scoped to commands actually
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

/** Option arities in the current command. @internal */
export interface CurrentOptionNames {
  readonly value: Set<string>;
  readonly flag: Set<string>;
}

/** Collects arities along an entered command path. @internal */
export function collectActiveOptionNames(
  usage: Usage,
  commandPath: readonly string[],
  names: CurrentOptionNames,
  fromExclusive: boolean,
  includeDirectAfterCommandOptions: boolean,
): void {
  if (commandPath.length === 0) {
    collectOptionNamesAtCurrentCommandDepth(usage, names, false);
    return;
  }

  const [commandName, ...rest] = commandPath;
  for (let i = 0; i < usage.length; i++) {
    const term = usage[i];
    if (term.type === "command" && term.name === commandName) {
      const remainingUsage = usage.slice(i + 1);
      if (rest.length === 0) {
        collectOptionNamesAtCurrentCommandDepth(
          remainingUsage,
          names,
          !fromExclusive && includeDirectAfterCommandOptions,
        );
      } else {
        collectActiveOptionNames(
          remainingUsage,
          rest,
          names,
          fromExclusive,
          includeDirectAfterCommandOptions,
        );
      }
    } else if (term.type === "exclusive") {
      for (const branch of term.terms) {
        collectActiveOptionNames(
          branch,
          commandPath,
          names,
          true,
          includeDirectAfterCommandOptions,
        );
      }
    } else if (
      term.type === "optional" || term.type === "multiple" ||
      term.type === "sequence"
    ) {
      collectActiveOptionNames(
        term.terms,
        commandPath,
        names,
        fromExclusive,
        includeDirectAfterCommandOptions,
      );
    }
  }
}

/** Collects arities without entering further commands. @internal */
export function collectOptionNamesAtCurrentCommandDepth(
  usage: Usage,
  names: CurrentOptionNames,
  afterMatchedCommand: boolean,
): void {
  for (const term of usage) {
    if (
      collectOptionNamesAtCurrentCommandDepthFromTerm(
        term,
        names,
        afterMatchedCommand,
      )
    ) {
      return;
    }
  }
}

function collectOptionNamesAtCurrentCommandDepthFromTerm(
  term: Usage[number],
  names: CurrentOptionNames,
  afterMatchedCommand: boolean,
): boolean {
  switch (term.type) {
    case "command":
      return !afterMatchedCommand;
    case "option":
      if (term.metavar != null) {
        for (const name of term.names) names.value.add(name);
      } else {
        for (const name of term.names) names.flag.add(name);
      }
      return false;
    case "optional":
    case "multiple":
    case "sequence":
      collectOptionNamesAtCurrentCommandDepth(
        term.terms,
        names,
        afterMatchedCommand,
      );
      return false;
    case "exclusive":
      for (const branch of term.terms) {
        collectOptionNamesAtCurrentCommandDepth(branch, names, false);
      }
      return false;
    case "argument":
    case "literal":
    case "passthrough":
    case "ellipsis":
      return false;
  }
}

/** Collects scoped root arities across sibling commands. @internal */
export function collectRootOptionNames(
  usage: Usage,
  names: CurrentOptionNames,
  rootLeadingNames: ReadonlySet<string>,
): void {
  for (const term of usage) {
    collectRootOptionNamesFromTerm(term, names, rootLeadingNames);
  }
}

function collectRootOptionNamesFromTerm(
  term: Usage[number],
  names: CurrentOptionNames,
  rootLeadingNames: ReadonlySet<string>,
): void {
  switch (term.type) {
    case "option":
      for (const name of term.names) {
        if (!rootLeadingNames.has(name)) continue;
        if (term.metavar != null) {
          names.value.add(name);
        } else {
          names.flag.add(name);
        }
      }
      return;
    case "optional":
    case "multiple":
    case "sequence":
      collectRootOptionNames(term.terms, names, rootLeadingNames);
      return;
    case "exclusive":
      for (const branch of term.terms) {
        collectRootOptionNames(branch, names, rootLeadingNames);
      }
      return;
    case "argument":
    case "command":
    case "literal":
    case "passthrough":
    case "ellipsis":
      return;
  }
}
