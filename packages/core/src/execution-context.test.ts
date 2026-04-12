import { DependencyRegistry } from "./internal/dependency.ts";
import type { ExecutionContext, ParserContext } from "@optique/core/parser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createDependencyRuntimeContext } from "./dependency-runtime.ts";
import {
  mergeChildExec,
  withChildContext,
  withChildExecPath,
} from "./execution-context.ts";
import { createInputTrace } from "./input-trace.ts";

describe("execution-context helpers", () => {
  it("withChildExecPath() appends the child segment", () => {
    const exec: ExecutionContext = {
      usage: [],
      phase: "parse",
      path: ["root"],
      trace: undefined,
    };

    assert.deepEqual(withChildExecPath(exec, "child"), {
      ...exec,
      path: ["root", "child"],
    });
  });

  it("mergeChildExec() forwards all child-owned execution fields", () => {
    const parentRuntime = createDependencyRuntimeContext();
    const childRuntime = createDependencyRuntimeContext();
    const parentTrace = createInputTrace();
    const childTrace = createInputTrace();
    const parentPreCompletedByParser = new Map([["parent", 1]]);
    const childPreCompletedByParser = new Map([["child", 2]]);
    const parentExcludedSourceFields = new Set(["parent"]);
    const childExcludedSourceFields = new Set(["child"]);
    const parent: ExecutionContext = {
      usage: [{ type: "literal", value: "parent" }],
      phase: "complete",
      path: ["root"],
      trace: parentTrace,
      dependencyRuntime: parentRuntime,
      dependencyRegistry: parentRuntime.registry,
      commandPath: ["build"],
      preCompletedByParser: parentPreCompletedByParser,
      excludedSourceFields: parentExcludedSourceFields,
    };
    const child: ExecutionContext = {
      usage: [{ type: "literal", value: "child" }],
      phase: "suggest",
      path: ["ignored"],
      trace: childTrace,
      dependencyRuntime: childRuntime,
      dependencyRegistry: childRuntime.registry,
      commandPath: ["deploy"],
      preCompletedByParser: childPreCompletedByParser,
      excludedSourceFields: childExcludedSourceFields,
    };

    const merged = mergeChildExec(parent, child);

    assert.strictEqual(merged?.usage, parent.usage);
    assert.strictEqual(merged?.phase, parent.phase);
    assert.deepEqual(merged?.path, parent.path);
    assert.strictEqual(merged?.trace, childTrace);
    assert.strictEqual(merged?.dependencyRuntime, childRuntime);
    assert.strictEqual(merged?.dependencyRegistry, childRuntime.registry);
    assert.deepEqual(merged?.commandPath, ["deploy"]);
    assert.strictEqual(merged?.preCompletedByParser, childPreCompletedByParser);
    assert.strictEqual(merged?.excludedSourceFields, childExcludedSourceFields);
  });

  it("withChildContext() keeps exec and flat registry aligned", () => {
    const staleRegistry = new DependencyRegistry();
    const freshRegistry = new DependencyRegistry();
    const context: ParserContext<{ readonly current: string }> = {
      buffer: [],
      state: { current: "parent" },
      optionsTerminated: false,
      usage: [{ type: "literal", value: "parent" }],
      dependencyRegistry: freshRegistry,
      exec: {
        usage: [{ type: "literal", value: "root" }],
        phase: "suggest",
        path: ["root"],
        trace: undefined,
        dependencyRegistry: staleRegistry,
      },
    };

    const child = withChildContext(
      context,
      "field",
      { current: "child" },
      [{ type: "literal", value: "child" }],
    );

    assert.deepEqual(child.state, { current: "child" });
    assert.strictEqual(child.usage[0]?.type, "literal");
    assert.strictEqual(child.usage[0]?.value, "child");
    assert.strictEqual(child.dependencyRegistry, freshRegistry);
    assert.strictEqual(child.exec?.dependencyRegistry, freshRegistry);
    assert.deepEqual(child.exec?.path, ["root", "field"]);
  });
});
