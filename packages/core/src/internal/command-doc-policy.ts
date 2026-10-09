import type { ExecutionContext } from "../parser.ts";

const policyKey = Symbol("commandDocPolicy");
const barePolicyKey = Symbol("bareCommandDocPolicy");

interface Scope {
  readonly id: symbol;
  readonly path: readonly PropertyKey[];
  readonly parent?: Scope;
  readonly showUsage?: boolean;
}

interface Policy {
  readonly active?: Scope;
  readonly records: readonly Scope[];
}

type PolicyExec = ExecutionContext & { readonly [policyKey]?: Policy };

function policy(exec: ExecutionContext | undefined): Policy | undefined {
  return (exec as PolicyExec | undefined)?.[policyKey];
}

function samePath(
  a: readonly PropertyKey[],
  b: readonly PropertyKey[],
): boolean {
  return a.length === b.length && a.every((part, i) => part === b[i]);
}

/**
 * Enables command policy tracking for document generation only.
 * @param exec The initial execution context.
 * @returns A context with an empty immutable policy trace.
 * @internal
 * @since 1.4.0
 */
export function trackCommandDocPolicy(
  exec: ExecutionContext,
): ExecutionContext {
  return { ...exec, [policyKey]: { records: [] } } as PolicyExec;
}

/**
 * Records a successfully matched command occurrence.
 * @param exec The command's execution context.
 * @param id The constructor identity.
 * @param showUsage The declared command policy.
 * @returns A new context when tracking is enabled, otherwise the original.
 * @internal
 * @since 1.4.0
 */
export function matchCommandDocPolicy(
  exec: ExecutionContext | undefined,
  id: symbol,
  showUsage: boolean | undefined,
): ExecutionContext | undefined {
  const current = policy(exec);
  if (exec == null || current == null) return exec;
  const scope: Scope = {
    id,
    path: [...exec.path],
    parent: current.active,
    showUsage,
  };
  return {
    ...exec,
    [policyKey]: { ...current, records: [...current.records, scope] },
  } as PolicyExec;
}

/**
 * Enters the actual parent command while delegating to its inner parser.
 * @param exec The context before appending the inner command path.
 * @param id The command constructor identity.
 * @returns A child context with the matching occurrence as active scope.
 * @internal
 * @since 1.4.0
 */
export function enterCommandDocPolicy(
  exec: ExecutionContext | undefined,
  id: symbol,
): ExecutionContext | undefined {
  const current = policy(exec);
  if (exec == null || current == null) return exec;
  const active = current.records.findLast((scope) =>
    scope.id === id && samePath(scope.path, exec.path)
  );
  return {
    ...exec,
    [policyKey]: { ...current, active },
  } as PolicyExec;
}

/**
 * Transfers the selected child's policy and restores the caller's scope.
 * Empty child records deliberately replace previous records.
 * @param parent The caller's context.
 * @param child The selected child's context.
 * @param merged The otherwise merged context.
 * @returns The merged context with document policy forwarding.
 * @internal
 * @since 1.4.0
 */
export function mergeCommandDocPolicy(
  parent: ExecutionContext | undefined,
  child: ExecutionContext | undefined,
  merged: ExecutionContext,
): ExecutionContext {
  const parentPolicy = policy(parent);
  const childPolicy = policy(child);
  if (parentPolicy == null && childPolicy == null) return merged;
  return {
    ...merged,
    [policyKey]: {
      active: parentPolicy?.active,
      // A custom parser that drops execution provenance cannot supply policy.
      records: childPolicy?.records ?? [],
    },
  } as PolicyExec;
}

/**
 * Removes an abandoned parser branch from a speculative context copy.
 * @param exec The context before trying a replacement branch.
 * @param path The structural path of the abandoned branch.
 * @returns A context containing only retained scope occurrences.
 * @internal
 * @since 1.4.0
 */
export function withoutCommandDocPolicySubtree(
  exec: ExecutionContext | undefined,
  path: readonly PropertyKey[],
): ExecutionContext | undefined {
  const current = policy(exec);
  if (exec == null || current == null) return exec;
  const retained = new Set<Scope>();
  const records = current.records.filter((scope) => {
    const inside = scope.path.length >= path.length &&
      path.every((part, i) => part === scope.path[i]);
    if (inside || (scope.parent != null && !retained.has(scope.parent))) {
      return false;
    }
    retained.add(scope);
    return true;
  });
  let active = current.active;
  while (active != null && !retained.has(active)) active = active.parent;
  return { ...exec, [policyKey]: { active, records } } as PolicyExec;
}

/**
 * Resolves the selected command's nearest explicit ancestor policy.
 * @param exec The final successful document parsing context.
 * @returns A command default, or undefined when no selected command sets one.
 * @internal
 * @since 1.4.0
 */
export function getCommandDocPolicy(
  exec: ExecutionContext | undefined,
): boolean | undefined {
  let scope = policy(exec)?.records.at(-1);
  while (scope != null) {
    if (scope.showUsage != null) return scope.showUsage;
    scope = scope.parent;
  }
  return undefined;
}

/**
 * Stores a bare command's static default, preserved by transparent spreads.
 * @param parser The newly constructed command parser.
 * @param showUsage Its declared policy.
 * @internal
 * @since 1.4.0
 */
export function defineBareCommandDocPolicy(
  parser: object,
  showUsage: boolean | undefined,
): void {
  Object.defineProperty(parser, barePolicyKey, {
    value: showUsage,
    enumerable: true,
  });
}

/**
 * Reads static policy after the existing bare-command brand check.
 * @param parser The branded command parser.
 * @returns Its declared policy, or undefined.
 * @internal
 * @since 1.4.0
 */
export function getBareCommandDocPolicy(parser: object): boolean | undefined {
  const value: unknown = Reflect.get(parser, barePolicyKey);
  return typeof value === "boolean" ? value : undefined;
}
