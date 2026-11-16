import * as assert from "node:assert/strict";
import { describe, test } from "node:test";
import { object, or } from "./constructs.ts";
import { dependency } from "./internal/dependency.ts";
import { createInputTrace, type InputTrace } from "./input-trace.ts";
import { message } from "./message.ts";
import { multiple } from "./modifiers.ts";
import { parseAsync, parseSync } from "./parser.ts";
import { argument, option } from "./primitives.ts";
import { string } from "./valueparser.ts";

const asyncString = {
  metavar: "STRING" as const,
  placeholder: "",
  format: (value: string) => value,
  mode: "async" as const,
  async parse(input: string) {
    await Promise.resolve();
    return { success: true as const, value: input };
  },
};

function assertDiscarded(
  trace: InputTrace | undefined,
  path: readonly PropertyKey[],
): void {
  assert.ok(trace);
  assert.equal(trace.get(path), undefined);
}

describe("input trace parser integration", () => {
  test("failed synchronous alternatives cannot leak recorded inputs", () => {
    const primitive = argument(string());
    let lostPath: readonly PropertyKey[] = [];
    let discarded: InputTrace | undefined;
    const failing: typeof primitive = {
      ...primitive,
      parse(context) {
        const result = primitive.parse(context);
        assert.ok(result.success);
        if (result.success) {
          lostPath = context.exec?.path ?? [];
          discarded = result.next.exec?.trace;
          assert.equal(discarded?.get(lostPath)?.rawInput, "value");
        }
        return { success: false, consumed: 0, error: message`Rejected.` };
      },
    };
    const parser = or(failing, primitive);
    const original = createInputTrace();
    const context = {
      buffer: ["value"],
      state: parser.initialState,
      usage: parser.usage,
      optionsTerminated: false,
      trace: original,
      exec: {
        usage: parser.usage,
        phase: "parse" as const,
        path: [],
        trace: original,
      },
    };
    const result = parser.parse(context);
    assert.ok(result.success);
    if (!result.success) return;
    assert.equal(discarded?.get(lostPath)?.rawInput, "value");
    assert.deepEqual(lostPath, [0]);
    assertDiscarded(context.trace, lostPath);
    assertDiscarded(context.exec.trace, lostPath);
    assertDiscarded(result.next.trace, lostPath);
    assertDiscarded(result.next.exec?.trace, lostPath);
    assert.equal(result.next.exec?.trace?.get([1])?.rawInput, "value");
    const completed = parser.complete(result.next.state, result.next.exec);
    assert.deepEqual(completed, { success: true, value: "value" });
    assertDiscarded(result.next.exec?.trace, lostPath);
  });

  test("failed asynchronous alternatives cannot leak recorded inputs", async () => {
    const primitive = argument(asyncString);
    let lostPath: readonly PropertyKey[] = [];
    let discarded: InputTrace | undefined;
    const failing: typeof primitive = {
      ...primitive,
      async parse(context) {
        const result = await primitive.parse(context);
        assert.ok(result.success);
        if (result.success) {
          lostPath = context.exec?.path ?? [];
          discarded = result.next.exec?.trace;
          assert.equal(discarded?.get(lostPath)?.rawInput, "value");
        }
        return { success: false, consumed: 0, error: message`Rejected.` };
      },
    };
    const parser = or(failing, primitive);
    const original = createInputTrace();
    const context = {
      buffer: ["value"],
      state: parser.initialState,
      usage: parser.usage,
      optionsTerminated: false,
      trace: original,
      exec: {
        usage: parser.usage,
        phase: "parse" as const,
        path: [],
        trace: original,
      },
    };
    const result = await parser.parse(context);
    assert.ok(result.success);
    if (!result.success) return;
    assert.equal(discarded?.get(lostPath)?.rawInput, "value");
    assert.deepEqual(lostPath, [0]);
    assertDiscarded(context.trace, lostPath);
    assertDiscarded(context.exec.trace, lostPath);
    assertDiscarded(result.next.trace, lostPath);
    assertDiscarded(result.next.exec?.trace, lostPath);
    assert.equal(result.next.exec?.trace?.get([1])?.rawInput, "value");
    const completed = await parser.complete(
      result.next.state,
      result.next.exec,
    );
    assert.deepEqual(completed, { success: true, value: "value" });
    assertDiscarded(result.next.exec?.trace, lostPath);
  });

  test("primitive forks can overwrite the same path independently", () => {
    const parser = argument(string());
    const base = createInputTrace();
    const context = {
      state: parser.initialState,
      usage: parser.usage,
      optionsTerminated: false,
      trace: base,
      exec: {
        usage: parser.usage,
        phase: "parse" as const,
        path: ["_branch", "target"],
        trace: base,
      },
    };
    const left = parser.parse({ ...context, buffer: ["left"] });
    const right = parser.parse({ ...context, buffer: ["right"] });
    assert.ok(left.success && right.success);
    if (!left.success || !right.success) return;
    const path = context.exec.path;
    assert.equal(left.next.trace?.get(path)?.rawInput, "left");
    assert.equal(left.next.exec?.trace?.get(path)?.rawInput, "left");
    assert.equal(right.next.trace?.get(path)?.rawInput, "right");
    assert.equal(right.next.exec?.trace?.get(path)?.rawInput, "right");
    assertDiscarded(base, path);
  });

  test("many synchronous derived arguments replay their distinct raw inputs", () => {
    const source = dependency(string());
    const derived = source.derive({
      mode: "sync",
      metavar: "VALUE",
      defaultValue: () => "before",
      factory: (prefix: string) => ({
        ...string(),
        parse: (input: string) => ({
          success: true as const,
          value: `${prefix}:${input}`,
        }),
      }),
    });
    const parser = object({
      values: multiple(argument(derived)),
      source: option("--source", source),
    });
    const values = Array.from({ length: 300 }, (_, i) => `p${i}`);
    const result = parseSync(parser, [...values, "--source", "after"]);
    assert.deepEqual(result, {
      success: true,
      value: {
        source: "after",
        values: values.map((value) => `after:${value}`),
      },
    });
  });

  test("many asynchronous derived arguments replay their distinct raw inputs", async () => {
    const source = dependency(string());
    const derived = source.derive({
      mode: "async",
      metavar: "VALUE",
      defaultValue: () => "before",
      factory: (prefix: string) => ({
        ...asyncString,
        async parse(input: string) {
          await Promise.resolve();
          return { success: true as const, value: `${prefix}:${input}` };
        },
      }),
    });
    const parser = object({
      values: multiple(argument(derived)),
      source: option("--source", source),
    });
    const values = Array.from({ length: 300 }, (_, i) => `p${i}`);
    const result = await parseAsync(parser, [...values, "--source", "after"]);
    assert.deepEqual(result, {
      success: true,
      value: {
        source: "after",
        values: values.map((value) => `after:${value}`),
      },
    });
  });
});
