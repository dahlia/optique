import type { ExecutionContext, ParserContext } from "./parser.ts";
import type { Usage } from "./usage.ts";

/**
 * Appends a child parser segment to the current execution path.
 * @internal
 */
export function withChildExecPath(
  exec: ExecutionContext | undefined,
  segment: PropertyKey,
): ExecutionContext | undefined {
  if (exec == null) return undefined;
  return {
    ...exec,
    path: [...(exec.path ?? []), segment],
  };
}

/**
 * Merges child-owned execution fields back into the parent execution context.
 * @internal
 */
export function mergeChildExec(
  parent: ExecutionContext | undefined,
  child: ExecutionContext | undefined,
): ExecutionContext | undefined {
  if (parent == null) return child;
  if (child == null) return parent;
  return {
    ...parent,
    trace: child.trace ?? parent.trace,
    dependencyRuntime: child.dependencyRuntime ?? parent.dependencyRuntime,
    dependencyRegistry: child.dependencyRegistry ?? parent.dependencyRegistry,
    commandPath: child.commandPath ?? parent.commandPath,
    preCompletedByParser: child.preCompletedByParser ??
      parent.preCompletedByParser,
    excludedSourceFields: child.excludedSourceFields ??
      parent.excludedSourceFields,
  };
}

/**
 * Creates a child parser context while keeping flat and nested execution data
 * aligned.
 * @internal
 */
export function withChildContext<TParentState, TChildState>(
  context: ParserContext<TParentState>,
  segment: PropertyKey,
  state: TChildState,
  usage?: Usage,
): ParserContext<TChildState> {
  const exec = withChildExecPath(context.exec, segment);
  const dependencyRegistry = context.dependencyRegistry ??
    exec?.dependencyRegistry;
  return {
    ...context,
    state,
    ...(usage != null ? { usage } : {}),
    ...(exec != null
      ? {
        exec: dependencyRegistry === exec.dependencyRegistry
          ? exec
          : { ...exec, dependencyRegistry },
        dependencyRegistry,
      }
      : {}),
  };
}
