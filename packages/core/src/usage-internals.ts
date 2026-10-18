/**
 * Internal utilities for usage-tree traversal.
 *
 * These functions are *not* part of the public API and are subject to change
 * without notice.  Import them only from within the `@optique/core` package
 * sources; do not re-export them from any public subpath.
 */
import { isSuggestionHidden, isUsageHidden, type Usage } from "./usage.ts";

/**
 * Projects augmented runner usage onto a recorded canonical command path.
 * Unsupported or ambiguous metadata returns undefined, preserving root usage.
 * No parser, documentation, or usage-override callbacks are evaluated.
 * @param usage The runner's original augmented usage.
 * @param path The canonical path recorded by the failed parse.
 * @param meta The known augmentation boundary, absent without alternatives.
 * @returns The selected grammar, or undefined when projection is uncertain.
 * @internal
 */
export function projectCommandUsage(
  usage: Usage,
  path: readonly string[],
  meta?: {
    readonly optionCount: number;
    readonly alternativeCount: number;
  },
): Usage | undefined {
  if (path.length === 0) return undefined;
  if (meta == null) return projectCommandTerms(usage, path, 0);
  const top = usage[0];
  if (
    usage.length !== 1 || top.type !== "exclusive" ||
    top.terms.length !== meta.alternativeCount + 1
  ) return undefined;
  const selected = projectCommandTerms(top.terms[meta.optionCount], path, 0);
  if (selected == null) return undefined;
  const options = top.terms.slice(0, meta.optionCount).filter((branch) =>
    branch.some((term) => term.type === "option" && !isUsageHidden(term.hidden))
  );
  return options.length === 0 ? selected : [{
    type: "exclusive",
    terms: [...options, selected],
  }];
}

function containsCommand(usage: Usage): boolean {
  return usage.some((term) => {
    switch (term.type) {
      case "command":
        return true;
      case "exclusive":
        return term.terms.some(containsCommand);
      case "optional":
      case "multiple":
      case "sequence":
        return containsCommand(term.terms);
      default:
        return false;
    }
  });
}

/** Undefined distinguishes unsupported metadata from a command-free branch. */
function firstCommandNames(usage: Usage): readonly string[] | undefined {
  const hosts = usage.filter((term) => containsCommand([term]));
  const first = hosts[0];
  if (first == null) return [];
  if (first.type === "command") return [first.name];
  if (hosts.length !== 1) return undefined;
  if (first.type === "sequence") return firstCommandNames(first.terms);
  if (first.type !== "exclusive") return undefined;
  const names: string[] = [];
  for (const branch of first.terms) {
    const found = firstCommandNames(branch);
    if (found == null) return undefined;
    names.push(...found);
  }
  return names;
}

function projectCommandTerms(
  usage: Usage,
  path: readonly string[],
  offset: number,
): Usage | undefined {
  if (offset === path.length) return usage;
  const index = usage.findIndex((term) => containsCommand([term]));
  if (index < 0) return undefined;
  const host = usage[index];
  const prefix = usage.slice(0, index);
  const suffix = usage.slice(index + 1);
  if (host.type === "command") {
    if (host.name !== path[offset] || isUsageHidden(host.hidden)) {
      return undefined;
    }
    const rest = projectCommandTerms(suffix, path, offset + 1);
    return rest == null ? undefined : [...prefix, host, ...rest];
  }
  // A group followed by another command host might be an independent
  // free-order field. Usage has no boundary proving a parent-child relation.
  if (containsCommand(suffix)) return undefined;
  if (host.type === "sequence") {
    const terms = projectCommandTerms(host.terms, path, offset);
    return terms == null
      ? undefined
      : [...prefix, { ...host, terms }, ...suffix];
  }
  if (host.type !== "exclusive") return undefined;
  let selected: Usage | undefined;
  for (const branch of host.terms) {
    const names = firstCommandNames(branch);
    if (names == null) return undefined;
    if (!names.includes(path[offset])) continue;
    if (selected != null) return undefined;
    selected = branch;
  }
  if (selected == null) return undefined;
  const terms = projectCommandTerms(selected, path, offset);
  // Splice the branch; the removed alternatives' acceptsEmpty is no longer
  // a statement about this already-matched command's grammar.
  return terms == null ? undefined : [...prefix, ...terms, ...suffix];
}

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
