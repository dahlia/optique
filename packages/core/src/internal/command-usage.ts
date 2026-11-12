import type { Usage, UsageTerm } from "../usage.ts";

// Identity is deliberately kept outside the public usage objects: neither
// equality checks, serialization, nor usageLine callbacks expose provenance.
/** Private identity of one command occurrence in usage. @internal */
export type CommandUsageId = object;
/** Maps child identities into one parent's occurrence scope. @internal */
export type CommandUsageScope = WeakMap<CommandUsageId, CommandUsageId>;
const commandUsageIds = new WeakMap<UsageTerm, CommandUsageId>();

/** Associates a command usage leaf with its parser occurrence. @internal */
export function identifyCommandUsage<T extends UsageTerm>(
  term: T,
  id: CommandUsageId,
): T {
  commandUsageIds.set(term, id);
  return term;
}

/** Reads a command usage leaf's private identity. @internal */
export function getCommandUsageId(term: UsageTerm): CommandUsageId | undefined {
  return commandUsageIds.get(term);
}

/** Preserves private identity when cloning a usage leaf. @internal */
export function copyCommandUsageId<T extends UsageTerm>(
  source: UsageTerm,
  target: T,
): T {
  const id = commandUsageIds.get(source);
  if (id != null) commandUsageIds.set(target, id);
  return target;
}

/** Distinguishes repeated uses of one parser in different children. @internal */
export function scopeCommandUsageId(
  scope: CommandUsageScope,
  id: CommandUsageId,
): CommandUsageId {
  let scoped = scope.get(id);
  if (scoped == null) {
    scoped = {};
    scope.set(id, scoped);
  }
  return scoped;
}

/** Copies usage with identities scoped to this child occurrence. @internal */
export function scopeCommandUsage(
  usage: Usage,
  scope: CommandUsageScope,
): Usage {
  return usage.map((term): UsageTerm => {
    if (term.type === "command") {
      const id = getCommandUsageId(term);
      return id == null ? term : identifyCommandUsage(
        { ...term },
        scopeCommandUsageId(scope, id),
      );
    }
    if (term.type === "optional" || term.type === "multiple") {
      return { ...term, terms: scopeCommandUsage(term.terms, scope) };
    }
    if (term.type === "exclusive") {
      return {
        ...term,
        terms: term.terms.map((branch) => scopeCommandUsage(branch, scope)),
      };
    }
    return term;
  });
}
