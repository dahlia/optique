/**
 * Internal usage helpers shared by Optique's usage formatters.  This module
 * is not a stable extension API.
 * @module
 */
import type { HiddenVisibility, Usage, UsageTerm } from "../usage.ts";

/**
 * Reports whether a term with the given visibility is hidden in the
 * rendering context.
 * @internal
 */
export type HiddenPredicate = (hidden?: HiddenVisibility) => boolean;

/**
 * How a term or term list looks once hidden terms are removed.
 */
interface Projection {
  /** Whether anything remains visible. */
  readonly visible: boolean;
  /** Whether the visible part can be omitted under synopsis notation. */
  readonly omissible: boolean;
  /** Whether a hidden term that cannot be omitted was removed. */
  readonly hidesRequired: boolean;
}

const EMPTY: Projection = {
  visible: false,
  omissible: true,
  hidesRequired: false,
};

function isHiddenLeaf(term: UsageTerm, isHidden: HiddenPredicate): boolean {
  return (term.type === "argument" || term.type === "option" ||
    term.type === "command" || term.type === "passthrough") &&
    isHidden(term.hidden);
}

function isDegenerateLeaf(term: UsageTerm): boolean {
  return (term.type === "option" && term.names.length === 0) ||
    (term.type === "command" && term.name === "") ||
    (term.type === "argument" && term.metavar.length === 0) ||
    (term.type === "literal" && term.value === "");
}

function projectTerms(
  terms: Usage,
  isHidden: HiddenPredicate,
): Projection {
  let visible = false;
  let omissible = true;
  let hidesRequired = false;
  for (const term of terms) {
    const projection = projectTerm(term, isHidden);
    hidesRequired ||= projection.hidesRequired;
    if (!projection.visible) continue;
    visible = true;
    omissible &&= projection.omissible;
  }
  return { visible, omissible, hidesRequired };
}

/**
 * Projects an alternative of an exclusive term.  Display filtering drops an
 * alternative whose leading command is hidden as a whole, trailing terms
 * included.
 */
function projectBranch(
  branch: Usage,
  isHidden: HiddenPredicate,
): Projection {
  const first = branch[0];
  if (first?.type === "command" && isHidden(first.hidden)) {
    return { ...EMPTY, hidesRequired: true };
  }
  return projectTerms(branch, isHidden);
}

function projectTerm(term: UsageTerm, isHidden: HiddenPredicate): Projection {
  if (isHiddenLeaf(term, isHidden)) {
    return {
      ...EMPTY,
      hidesRequired: term.type !== "passthrough",
    };
  }
  if (isDegenerateLeaf(term)) return EMPTY;
  switch (term.type) {
    case "argument":
    case "option":
    case "command":
    case "literal":
      return { visible: true, omissible: false, hidesRequired: false };
    case "passthrough":
    case "ellipsis":
      return { visible: true, omissible: true, hidesRequired: false };
    case "optional": {
      const inner = projectTerms(term.terms, isHidden);
      return { ...inner, omissible: true, hidesRequired: false };
    }
    case "sequence":
      return projectTerms(term.terms, isHidden);
    case "multiple": {
      const inner = projectTerms(term.terms, isHidden);
      return {
        ...inner,
        omissible: term.min < 1 || inner.omissible,
        hidesRequired: term.min > 0 && inner.hidesRequired,
      };
    }
    case "exclusive": {
      let visible = false;
      let omissible = false;
      let hidesRequired = false;
      for (const branch of term.terms) {
        const projection = projectBranch(branch, isHidden);
        hidesRequired ||= projection.hidesRequired;
        if (!projection.visible) continue;
        visible = true;
        omissible ||= projection.omissible;
      }
      return { visible, omissible, hidesRequired };
    }
  }
}

/**
 * Returns the terms `X` when the visible part of `terms` is exactly
 * `optional(X)`, possibly nested, with a required `X`, and no required term
 * was hidden.
 */
function unwrapSingleOptional(
  terms: Usage,
  isHidden: HiddenPredicate,
): Usage | undefined {
  if (projectTerms(terms, isHidden).hidesRequired) return undefined;
  const visible = terms.filter((t) => projectTerm(t, isHidden).visible);
  if (visible.length !== 1) return undefined;
  const [only] = visible;
  if (only.type !== "optional") return undefined;
  const inner = projectTerms(only.terms, isHidden);
  if (!inner.visible || inner.hidesRequired) return undefined;
  // optional(optional(X)) reads the same as optional(X).
  if (inner.omissible) return unwrapSingleOptional(only.terms, isHidden);
  return only.terms;
}

function resolveTerms(terms: Usage, isHidden: HiddenPredicate): Usage {
  return terms.map((term) => resolveTerm(term, isHidden));
}

function resolveTerm(term: UsageTerm, isHidden: HiddenPredicate): UsageTerm {
  switch (term.type) {
    case "optional":
      return { type: "optional", terms: resolveTerms(term.terms, isHidden) };
    case "sequence":
      return { type: "sequence", terms: resolveTerms(term.terms, isHidden) };
    case "multiple": {
      const terms = resolveTerms(term.terms, isHidden);
      const resolved: UsageTerm = { type: "multiple", terms, min: term.min };
      if (term.acceptsEmpty == null) return resolved;
      const projection = projectTerm(resolved, isHidden);
      if (!projection.visible || projection.omissible === term.acceptsEmpty) {
        return resolved;
      }
      if (term.acceptsEmpty) return { type: "optional", terms: [resolved] };
      if (term.min < 1) return resolved;
      const required = unwrapSingleOptional(terms, isHidden);
      return required == null ? resolved : { ...resolved, terms: required };
    }
    case "exclusive": {
      const branches = term.terms.map((branch) =>
        resolveTerms(branch, isHidden)
      );
      const resolved: UsageTerm = { type: "exclusive", terms: branches };
      if (term.acceptsEmpty == null) return resolved;
      const projection = projectTerm(resolved, isHidden);
      if (!projection.visible || projection.omissible === term.acceptsEmpty) {
        return resolved;
      }
      if (term.acceptsEmpty) {
        // Every visible alternative is required, but the group as a whole
        // may be omitted, for example through a branch that has no visible
        // terms.  Branches without visible terms are dropped by display
        // filtering anyway.
        const visible = branches.filter((branch) =>
          projectBranch(branch, isHidden).visible
        );
        return {
          type: "optional",
          terms: visible.length === 1
            ? visible[0]
            : [{ type: "exclusive", terms: visible }],
        };
      }
      const required: Usage[] = [];
      for (const branch of branches) {
        const branchProjection = projectBranch(branch, isHidden);
        if (!branchProjection.visible || !branchProjection.omissible) {
          required.push(branch);
          continue;
        }
        const unwrapped = unwrapSingleOptional(branch, isHidden);
        // An omissible branch that is not a single optional term cannot be
        // drawn as required; keep the declared notation.
        if (unwrapped == null) return resolved;
        required.push(unwrapped);
      }
      return { type: "exclusive", terms: required };
    }
    default:
      return term;
  }
}

/**
 * Rewrites a usage so that plain synopsis notation reflects the recorded
 * empty-input behavior of its groups.
 *
 * Each `exclusive` or `multiple` term that records `acceptsEmpty` is drawn
 * as omissible exactly when its parser accepts an empty argument list,
 * using only exact local rewrites: a group that should be omissible is
 * wrapped in an optional term, and a group that should be required has
 * `optional(X)` alternatives or repeated items replaced by `X`.  A group
 * whose visible terms cannot be drawn that way keeps its declared notation.
 * Enclosing groups are resolved after their children, so their constraints
 * take precedence.
 *
 * The result records no `acceptsEmpty` fields, so resolving it again
 * returns an equal usage.  Hidden terms are kept; callers filter them for
 * display afterwards.
 * @param usage The usage to resolve.
 * @param isHidden Reports whether a term is hidden in the rendering context.
 * @returns The resolved usage.
 * @internal
 */
export function resolveUsageForDisplay(
  usage: Usage,
  isHidden: HiddenPredicate,
): Usage {
  return resolveTerms(usage, isHidden);
}

/**
 * Removes every `acceptsEmpty` record from a usage without changing how it
 * is drawn otherwise.
 * @param usage The usage to copy.
 * @returns The usage without records.
 * @internal
 */
export function forgetEmptyInput(usage: Usage): Usage {
  return usage.map(forgetEmptyInputTerm);
}

function forgetEmptyInputTerm(term: UsageTerm): UsageTerm {
  switch (term.type) {
    case "optional":
      return { type: "optional", terms: forgetEmptyInput(term.terms) };
    case "sequence":
      return { type: "sequence", terms: forgetEmptyInput(term.terms) };
    case "multiple":
      return {
        type: "multiple",
        terms: forgetEmptyInput(term.terms),
        min: term.min,
      };
    case "exclusive":
      return { type: "exclusive", terms: term.terms.map(forgetEmptyInput) };
    default:
      return term;
  }
}
