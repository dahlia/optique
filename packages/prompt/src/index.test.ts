import assert from "node:assert/strict";
import * as fc from "fast-check";
import { describe, it } from "node:test";
import { type Annotations, getAnnotations } from "@optique/core/annotations";
import { object } from "@optique/core/constructs";
import { defineTraits, getTraits } from "@optique/core/extension";
import { runParser } from "@optique/core/facade";
import { message } from "@optique/core/message";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import { parseAsync, type Parser, suggestAsync } from "@optique/core/parser";
import { constant, fail, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { createPromptAdapter, type PromptCondition } from "@optique/prompt";

type TestPromptConfig<TValue> = {
  readonly value: TValue;
  readonly reject?: boolean;
};

function createTestPrompt() {
  const calls: TestPromptConfig<unknown>[] = [];
  const prompt = createPromptAdapter<TestPromptConfig<unknown>>({
    execute<TValue>(config: TestPromptConfig<unknown>) {
      calls.push(config);
      if (config.reject === true) {
        return Promise.resolve({
          success: false,
          error: message`Prompt rejected.`,
        });
      }
      return Promise.resolve({ success: true, value: config.value as TValue });
    },
  });
  return { prompt, calls };
}

describe("createPromptAdapter()", () => {
  it("should require otherwise when when is configured", () => {
    const unconditional = {} satisfies PromptCondition<string>;
    const conditional = {
      when: () => true,
      otherwise: "fallback",
    } satisfies PromptCondition<string>;

    // @ts-expect-error A condition needs a value for the skipped branch.
    const missingOtherwise = { when: () => true } satisfies PromptCondition<
      string
    >;
    const invalidOtherwise = {
      when: () => true,
      // @ts-expect-error The skipped value must match the parser result type.
      otherwise: 42,
    } satisfies PromptCondition<string>;

    assert.deepEqual(unconditional, {});
    assert.equal(conditional.otherwise, "fallback");
    assert.equal(typeof missingOtherwise.when, "function");
    assert.equal(invalidOtherwise.otherwise, 42);
  });

  it("returns an async fluent parser", () => {
    const { prompt } = createTestPrompt();
    const parser = prompt(option("--name", string()), { value: "prompted" })
      .map((value) => value.toUpperCase());

    assert.equal(parser.mode, "async");
    assert.equal(typeof parser.map, "function");
  });

  it("uses a CLI value before prompting", async () => {
    const { prompt, calls } = createTestPrompt();
    const parser = prompt(option("--name", string()), { value: "prompted" });

    const result = await parseAsync(parser, ["--name", "Alice"]);

    assert.ok(result.success);
    assert.equal(result.value, "Alice");
    assert.deepEqual(calls, []);
  });

  it("should always bypass the condition for CLI values", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string(), async (suffix) => {
        const { prompt, calls } = createTestPrompt();
        let conditionCalls = 0;
        const parser = prompt(option("--name", string()), {
          value: "prompted",
          when: () => {
            conditionCalls++;
            return true;
          },
          otherwise: "skipped",
        });
        const cliValue = `value${suffix}`;

        const result = await parseAsync(parser, ["--name", cliValue]);

        assert.ok(result.success);
        assert.equal(result.value, cliValue);
        assert.equal(conditionCalls, 0);
        assert.deepEqual(calls, []);
      }),
    );
  });

  it("runs the adapter when the CLI value is absent", async () => {
    const { prompt, calls } = createTestPrompt();
    const config = { value: "Bob" };
    const parser = prompt(option("--name", string()), config);

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.equal(result.value, "Bob");
    assert.deepEqual(calls, [config]);
  });

  it("should run the adapter when a synchronous condition is true", async () => {
    const { prompt, calls } = createTestPrompt();
    let conditionCalls = 0;
    const config = {
      value: "prompted",
      when: () => {
        conditionCalls++;
        return true;
      },
      otherwise: "skipped",
    };
    const parser = prompt(option("--name", string()), config);

    assert.equal(conditionCalls, 0);
    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.equal(result.value, "prompted");
    assert.equal(conditionCalls, 1);
    assert.deepEqual(calls, [config]);
  });

  it("should return otherwise when an asynchronous condition is false", async () => {
    const { prompt, calls } = createTestPrompt();
    let conditionCalls = 0;
    const parser = prompt(option("--name", string()), {
      value: "prompted",
      when: async () => {
        await Promise.resolve();
        conditionCalls++;
        return false;
      },
      otherwise: "skipped",
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.equal(result.value, "skipped");
    assert.equal(conditionCalls, 1);
    assert.deepEqual(calls, []);
  });

  it("should propagate condition errors without running the adapter", async () => {
    const { prompt, calls } = createTestPrompt();
    const expected = new RangeError("GitHub CLI lookup failed.");
    const conditions = [
      () => {
        throw expected;
      },
      async () => {
        await Promise.resolve();
        throw expected;
      },
    ] satisfies readonly (() => boolean | Promise<boolean>)[];

    for (const when of conditions) {
      const parser = prompt(option("--name", string()), {
        value: "prompted",
        when,
        otherwise: "skipped",
      });

      await assert.rejects(
        () => parseAsync(parser, []),
        (error: unknown) => error === expected,
      );
    }
    assert.deepEqual(calls, []);
  });

  it("should return otherwise without inner validation", async () => {
    const { prompt, calls } = createTestPrompt();
    const parser = prompt(option("--port", integer({ min: 1 })), {
      value: 3000,
      when: () => false,
      otherwise: 0,
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.equal(result.value, 0);
    assert.deepEqual(calls, []);
  });

  it("should evaluate the condition once for each parse operation", async () => {
    const { prompt } = createTestPrompt();
    let conditionCalls = 0;
    const parser = prompt(option("--name", string()), {
      value: "prompted",
      when: () => {
        conditionCalls++;
        return false;
      },
      otherwise: "skipped",
    });

    const first = await parseAsync(parser, []);
    const second = await parseAsync(parser, []);

    assert.ok(first.success);
    assert.ok(second.success);
    assert.equal(conditionCalls, 2);
  });

  it("should not evaluate the condition during completion probes", async () => {
    const { prompt, calls } = createTestPrompt();
    let conditionCalls = 0;
    const parser = prompt(option("--name", string()), {
      value: "prompted",
      when: () => {
        conditionCalls++;
        return true;
      },
      otherwise: "skipped",
    });

    const result = await parser.complete(parser.initialState, {
      usage: parser.usage,
      phase: "parse",
      path: [],
    });

    assert.ok(result.success);
    assert.equal(conditionCalls, 0);
    assert.deepEqual(calls, []);
  });

  it("should not evaluate the condition for help or version handling", async () => {
    const { prompt, calls } = createTestPrompt();
    let conditionCalls = 0;
    const parser = prompt(option("--name", string()), {
      value: "prompted",
      when: () => {
        conditionCalls++;
        return true;
      },
      otherwise: "skipped",
    });

    const helpResult = await runParser(parser, "example", ["--help"], {
      help: { option: true, onShow: () => "help" },
    });
    const versionResult = await runParser(parser, "example", ["--version"], {
      version: {
        value: "1.0.0",
        option: true,
        onShow: () => "version",
      },
    });

    assert.equal(helpResult, "help");
    assert.equal(versionResult, "version");
    assert.equal(conditionCalls, 0);
    assert.deepEqual(calls, []);
  });

  it("should not evaluate the condition for shell suggestions", async () => {
    const { prompt, calls } = createTestPrompt();
    let conditionCalls = 0;
    const parser = prompt(option("--name", string()), {
      value: "prompted",
      when: () => {
        conditionCalls++;
        return true;
      },
      otherwise: "skipped",
    });

    await suggestAsync(parser, [""]);

    assert.equal(conditionCalls, 0);
    assert.deepEqual(calls, []);
  });

  it("supports prompt-only values with fail()", async () => {
    const { prompt } = createTestPrompt();
    const parser = prompt(fail<string>(), { value: "secret" });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.equal(result.value, "secret");
  });

  it("prompts when optional() has no CLI value", async () => {
    const { prompt } = createTestPrompt();
    const parser = prompt(optional(option("--name", string())), {
      value: "prompted",
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.equal(result.value, "prompted");
  });

  it("prompts when withDefault() has no CLI value", async () => {
    const { prompt } = createTestPrompt();
    const parser = prompt(withDefault(option("--name", string()), "default"), {
      value: "prompted",
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.equal(result.value, "prompted");
  });

  it("runs prompt fields sequentially inside object()", async () => {
    const { prompt } = createTestPrompt();
    const order: string[] = [];
    const parser = object({
      name: prompt(option("--name", string()), {
        get value() {
          order.push("name");
          return "Alice";
        },
      }),
      port: prompt(option("--port", integer()), {
        get value() {
          order.push("port");
          return 3000;
        },
      }),
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.deepEqual(result.value, { name: "Alice", port: 3000 });
    assert.deepEqual(order, ["name", "port"]);
  });

  it("skips prompting when bindEnv() supplies a value", async () => {
    const envContext = createEnvContext({
      source: (key) => ({ MYAPP_NAME: "EnvName" })[key],
      prefix: "MYAPP_",
    });
    const annotations = envContext.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const { prompt, calls } = createTestPrompt();
    let conditionCalls = 0;
    const parser = prompt(
      bindEnv(option("--name", string()), {
        context: envContext,
        key: "NAME",
        parser: string(),
      }),
      {
        value: "PromptName",
        when: () => {
          conditionCalls++;
          return true;
        },
        otherwise: "SkippedName",
      },
    );

    const result = await parseAsync(parser, [], { annotations });

    assert.ok(result.success);
    assert.equal(result.value, "EnvName");
    assert.equal(conditionCalls, 0);
    assert.deepEqual(calls, []);
  });

  it("preserves source-completion traits through map()", () => {
    const envContext = createEnvContext({
      source: (key) => ({ MYAPP_NAME: "EnvName" })[key],
      prefix: "MYAPP_",
    });
    const { prompt } = createTestPrompt();
    const parser = prompt(
      bindEnv(option("--name", string()), {
        context: envContext,
        key: "NAME",
        parser: string(),
      }),
      { value: "PromptName" },
    ).map((value) => value.toUpperCase());

    assert.ok(getTraits(parser).completesFromSource);
  });

  it("propagates consumed inner parse failures", async () => {
    const innerParser: Parser<"sync", string, undefined> = {
      mode: "sync",
      $valueType: [],
      $stateType: [],
      priority: 0,
      usage: [],
      leadingNames: new Set(["--name"]),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        if (context.buffer[0] === "--name") {
          return {
            success: false,
            consumed: 1,
            error: message`Missing value for ${"--name"}.`,
          };
        }
        return {
          success: false,
          consumed: 0,
          error: message`Missing name.`,
        };
      },
      complete() {
        return { success: false, error: message`Missing name.` };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };
    const { prompt, calls } = createTestPrompt();
    const parser = prompt(innerParser, { value: "prompted" });

    const result = await parseAsync(parser, ["--name"]);

    assert.ok(!result.success);
    assert.deepEqual(result.error, message`Missing value for ${"--name"}.`);
    assert.deepEqual(calls, []);
  });

  it("preserves primitive fallback values from source wrappers", async () => {
    const envContext = createEnvContext({
      source: () => undefined,
      prefix: "MYAPP_",
    });
    const annotations = envContext.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const { prompt, calls } = createTestPrompt();
    const parser = prompt(
      bindEnv(constant("fallback"), {
        context: envContext,
        key: "NAME",
        parser: string(),
      }),
      { value: "prompted" },
    );

    const result = await parseAsync(parser, [], { annotations });

    assert.ok(result.success);
    assert.equal(result.value, "fallback");
    assert.deepEqual(calls, []);
  });

  it("prompts when source completion unwraps to undefined", async () => {
    const annotationKey = Symbol("prompt-test");
    const annotations: Annotations = { [annotationKey]: "present" };
    const innerParser: Parser<"sync", unknown, undefined> = {
      mode: "sync",
      $valueType: [],
      $stateType: [],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return { success: true, next: context, consumed: [] };
      },
      complete(state) {
        return { success: true, value: state };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };
    defineTraits(innerParser, { inheritsAnnotations: true });
    const { prompt, calls } = createTestPrompt();
    const parser = prompt(innerParser, { value: "prompted" });

    const result = await parseAsync(parser, [], { annotations });

    assert.ok(result.success);
    assert.equal(result.value, "prompted");
    assert.deepEqual(calls, [{ value: "prompted" }]);
  });

  it("prompts when deferred source completion unwraps to undefined", async () => {
    const annotationKey = Symbol("prompt-test");
    const annotations: Annotations = { [annotationKey]: "present" };
    const innerParser: Parser<"sync", unknown, undefined> = {
      mode: "sync",
      $valueType: [],
      $stateType: [],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse(context) {
        return { success: true, next: context, consumed: [] };
      },
      complete(state) {
        return { success: true, value: state };
      },
      shouldDeferCompletion() {
        return false;
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };
    defineTraits(innerParser, { inheritsAnnotations: true });
    const { prompt, calls } = createTestPrompt();
    const parser = prompt(innerParser, { value: "prompted" });

    const result = await parseAsync(parser, [], { annotations });

    assert.ok(result.success);
    assert.equal(result.value, "prompted");
    assert.deepEqual(calls, [{ value: "prompted" }]);
  });

  it("passes annotations to primitive inner states", async () => {
    const annotationKey = Symbol("prompt-test");
    const annotations: Annotations = { [annotationKey]: "present" };
    const seenAnnotations: boolean[] = [];
    const innerParser: Parser<"sync", string, string> = {
      mode: "sync",
      $valueType: [],
      $stateType: [],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "initial",
      parse(context) {
        seenAnnotations.push(
          getAnnotations(context.state)?.[annotationKey] === "present",
        );
        return { success: false, consumed: 0, error: message`Missing.` };
      },
      complete() {
        return { success: true, value: "inner" };
      },
      suggest() {
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };
    defineTraits(innerParser, { inheritsAnnotations: true });
    const { prompt } = createTestPrompt();
    const parser = prompt(innerParser, { value: "prompted" });

    const result = await parseAsync(parser, [], { annotations });

    assert.ok(result.success);
    assert.equal(result.value, "prompted");
    assert.ok(seenAnnotations.length > 0);
    assert.ok(seenAnnotations.every(Boolean));
  });

  it("propagates adapter parse failures", async () => {
    const { prompt } = createTestPrompt();
    const parser = prompt(option("--name", string()), {
      value: "ignored",
      reject: true,
    });

    const result = await parseAsync(parser, []);

    assert.ok(!result.success);
    assert.deepEqual(result.error, message`Prompt rejected.`);
  });

  it("uses CLI values for multiple()", async () => {
    const { prompt, calls } = createTestPrompt();
    const parser = prompt(multiple(option("--tag", string())), {
      value: ["prompted"],
    });

    const result = await parseAsync(parser, ["--tag", "a", "--tag", "b"]);

    assert.ok(result.success);
    assert.deepEqual(result.value, ["a", "b"]);
    assert.deepEqual(calls, []);
  });
});
