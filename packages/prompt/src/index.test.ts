import assert from "node:assert/strict";
import * as fc from "fast-check";
import { describe, it } from "node:test";
import { type Annotations, getAnnotations } from "@optique/core/annotations";
import {
  concat,
  conditional,
  group,
  merge,
  object,
  or,
  seq,
  tuple,
} from "@optique/core/constructs";
import type {
  SourceContext,
  SourceContextPhase2Request,
} from "@optique/core/context";
import { dependency } from "@optique/core/dependency";
import { defineTraits, getTraits } from "@optique/core/extension";
import { runParser, runWith } from "@optique/core/facade";
import { message } from "@optique/core/message";
import {
  multiple,
  nonEmpty,
  optional,
  withDefault,
} from "@optique/core/modifiers";
import { parseAsync, type Parser, suggestAsync } from "@optique/core/parser";
import {
  argument,
  command,
  constant,
  fail,
  flag,
  option,
} from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
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

function createModeFixture() {
  const mode = dependency(choice(["dev", "prod"] as const));
  const level = mode.derive({
    metavar: "LEVEL",
    mode: "sync",
    factory: (value: "dev" | "prod") =>
      choice(
        value === "dev"
          ? (["debug", "verbose"] as const)
          : (["silent", "strict"] as const),
      ),
    defaultValue: () => "dev" as const,
  });
  return { mode, level };
}

function isPhase2ContextRequest(
  request: unknown,
): request is SourceContextPhase2Request {
  return request != null &&
    typeof request === "object" &&
    "phase" in request &&
    (request as { readonly phase?: unknown }).phase === "phase2" &&
    "parsed" in request;
}

function getPhase2ContextParsed<T>(request: unknown): T | undefined {
  return isPhase2ContextRequest(request) ? request.parsed as T : undefined;
}

// https://github.com/dahlia/optique/issues/870
describe("prompted values as dependency sources", () => {
  it("registers a prompted value for a derived parser", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = object({
      mode: prompt(option("--mode", mode), { value: "prod" }),
      level: option("--level", level),
    });

    const result = await parseAsync(parser, ["--level", "silent"]);

    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
    assert.equal(calls.length, 1);
  });

  it("rejects a derived value invalid for the prompted source", async () => {
    const { mode, level } = createModeFixture();
    const { prompt } = createTestPrompt();
    const parser = object({
      mode: prompt(option("--mode", mode), { value: "prod" }),
      level: option("--level", level),
    });

    // "debug" is only valid when the mode is "dev", but the prompt
    // answers "prod".
    const result = await parseAsync(parser, ["--level", "debug"]);

    assert.ok(!result.success);
  });

  it("should behave identically for CLI and prompted source values", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("dev", "prod"),
        fc.constantFrom("debug", "verbose", "silent", "strict"),
        async (modeValue, levelValue) => {
          const { mode, level } = createModeFixture();
          const { prompt } = createTestPrompt();
          const parser = object({
            mode: prompt(option("--mode", mode), { value: modeValue }),
            level: option("--level", level),
          });

          const cliResult = await parseAsync(parser, [
            "--mode",
            modeValue,
            "--level",
            levelValue,
          ]);
          const promptedResult = await parseAsync(parser, [
            "--level",
            levelValue,
          ]);

          assert.equal(promptedResult.success, cliResult.success);
          if (cliResult.success && promptedResult.success) {
            assert.deepEqual(promptedResult.value, cliResult.value);
          }
        },
      ),
    );
  });

  it("keeps CLI precedence over the prompt for the source", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = object({
      mode: prompt(option("--mode", mode), { value: "prod" }),
      level: option("--level", level),
    });

    const result = await parseAsync(parser, [
      "--mode",
      "dev",
      "--level",
      "debug",
    ]);

    assert.ok(result.success);
    assert.equal(result.value.mode, "dev");
    assert.equal(result.value.level, "debug");
    assert.deepEqual(calls, []);
  });

  it("keeps env precedence over the prompt for the source", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const annotations = envContext.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const parser = object({
      mode: prompt(
        bindEnv(option("--mode", mode), {
          context: envContext,
          key: "MODE",
          parser: choice(["dev", "prod"] as const),
        }),
        { value: "dev" },
      ),
      level: option("--level", level),
    });

    const result = await parseAsync(parser, ["--level", "silent"], {
      annotations,
    });

    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
    assert.deepEqual(calls, []);
  });

  it("registers a prompted value inside tuple()", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = tuple([
      prompt(option("--mode", mode), { value: "prod" }),
      option("--level", level),
    ]);

    const valid = await parseAsync(parser, ["--level", "silent"]);
    assert.ok(valid.success);
    assert.deepEqual(valid.value, ["prod", "silent"]);
    assert.equal(calls.length, 1);

    const invalid = await parseAsync(parser, ["--level", "debug"]);
    assert.ok(!invalid.success);
  });

  it("registers a prompted value inside seq()", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = seq(
      prompt(option("--mode", mode), { value: "prod" }),
      option("--level", level),
    );

    const valid = await parseAsync(parser, ["--level", "silent"]);
    assert.ok(valid.success);
    assert.deepEqual(valid.value, ["prod", "silent"]);
    assert.equal(calls.length, 1);

    const invalid = await parseAsync(parser, ["--level", "debug"]);
    assert.ok(!invalid.success);
  });

  it("registers a prompted value across merge() children", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = merge(
      object({ mode: prompt(option("--mode", mode), { value: "prod" }) }),
      object({ level: option("--level", level) }),
    );

    const result = await parseAsync(parser, ["--level", "silent"]);

    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
    assert.equal(calls.length, 1);
  });

  it("keeps a duplicated merge() field's prompted source local", async () => {
    const { mode, level } = createModeFixture();
    const { prompt } = createTestPrompt();
    const parser = merge(
      object({ mode: prompt(option("--mode", mode), { value: "prod" }) }),
      object({
        mode: withDefault(option("--override-mode", string()), "dev"),
        level: option("--level", level),
      }),
    );

    // The first child's prompted source is behind a duplicated field, so
    // it must stay local to that child.  The sibling consumer falls back
    // to its own default ("dev"), for which "debug" is valid.
    const result = await parseAsync(parser, ["--level", "debug"]);

    assert.ok(result.success);
    assert.equal(result.value.level, "debug");
  });

  it("registers a prompted value behind group()", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = object({
      mode: group("Mode", prompt(option("--mode", mode), { value: "prod" })),
      level: option("--level", level),
    });

    const result = await parseAsync(parser, ["--level", "silent"]);

    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
    assert.equal(calls.length, 1);
  });

  it("stops later prompts when a source prompt is cancelled", async () => {
    const first = createModeFixture();
    const second = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = object({
      a: prompt(option("--a", first.mode), { value: "dev", reject: true }),
      b: prompt(option("--b", second.mode), { value: "dev" }),
      aLevel: option("--a-level", first.level),
      bLevel: option("--b-level", second.level),
    });

    const result = await parseAsync(parser, [
      "--a-level",
      "debug",
      "--b-level",
      "debug",
    ]);

    assert.ok(!result.success);
    assert.equal(calls.length, 1);
  });

  it("does not register a successful undefined prompt value", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = object({
      mode: prompt(optional(option("--mode", mode)), { value: undefined }),
      level: option("--level", level),
    });

    // The prompt succeeds with `undefined`, which must not register as a
    // dependency value; the derived parser falls back to its default
    // ("dev"), for which "debug" is valid.
    const result = await parseAsync(parser, ["--level", "debug"]);

    assert.ok(result.success);
    assert.equal(result.value.mode, undefined);
    assert.equal(result.value.level, "debug");
    assert.equal(calls.length, 1);
  });

  it("does not prompt a source during shell suggestions", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = object({
      mode: prompt(option("--mode", mode), { value: "prod" }),
      level: option("--level", level),
    });

    const suggestions = await suggestAsync(parser, ["--level", ""]);

    assert.ok(suggestions.length > 0);
    assert.deepEqual(calls, []);
  });

  it("prompts a source once per parse operation", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = object({
      mode: prompt(option("--mode", mode), { value: "prod" }),
      level: option("--level", level),
    });

    const first = await parseAsync(parser, ["--level", "silent"]);
    const second = await parseAsync(parser, ["--level", "strict"]);

    assert.ok(first.success);
    assert.equal(first.value.level, "silent");
    assert.ok(second.success);
    assert.equal(second.value.level, "strict");
    assert.equal(calls.length, 2);
  });

  it(
    "prompts a demanded source during the phase-two seed pass exactly once",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      let phase2Parsed:
        | { readonly mode?: string; readonly level?: string }
        | undefined;
      const dynamicContext: SourceContext = {
        id: Symbol.for("@optique/prompt/test-demanded-phase-two"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          const parsed = getPhase2ContextParsed<
            { readonly mode?: string; readonly level?: string }
          >(request);
          if (parsed !== undefined) phase2Parsed = parsed;
          return {};
        },
      };
      const parser = object({
        mode: prompt(option("--mode", mode), { value: "prod" }),
        level: option("--level", level),
      });

      const result = await runWith(parser, "test", [dynamicContext], {
        args: ["--level", "silent"],
      });

      assert.deepEqual(result, { mode: "prod", level: "silent" });
      assert.equal(phase2Parsed?.mode, "prod");
      assert.equal(phase2Parsed?.level, "silent");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "defers an undemanded source prompt to the final pass",
    async () => {
      const { mode } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      let phase2Mode: string | undefined = "unset";
      const dynamicContext: SourceContext = {
        id: Symbol.for("@optique/prompt/test-undemanded-phase-two"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          const parsed = getPhase2ContextParsed<
            { readonly mode?: string } | undefined
          >(request);
          if (isPhase2ContextRequest(request)) phase2Mode = parsed?.mode;
          return {};
        },
      };
      const parser = object({
        mode: prompt(option("--mode", mode), { value: "prod" }),
      });

      const result = await runWith(parser, "test", [dynamicContext], {
        args: [],
      });

      assert.deepEqual(result, { mode: "prod" });
      assert.equal(phase2Mode, undefined);
      assert.equal(calls.length, 1);
    },
  );

  it(
    "registers a prompted value nested in a concat() child tuple",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      // The consumer's tuple precedes the source's tuple, so the source
      // prompt must complete before any child tuple completes.
      const parser = concat(
        tuple([option("--level", level)]),
        tuple([prompt(option("--mode", mode), { value: "prod" })]),
      );

      const valid = await parseAsync(parser, ["--level", "silent"]);
      assert.ok(valid.success);
      assert.deepEqual(valid.value, ["silent", "prod"]);
      assert.equal(calls.length, 1);

      const invalid = await parseAsync(parser, ["--level", "debug"]);
      assert.ok(!invalid.success);
    },
  );

  it("registers a prompted value inside a nested concat()", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = object({
      combo: concat(
        tuple([prompt(option("--mode", mode), { value: "prod" })]),
        tuple([optional(option("--other", string()))]),
      ),
      level: option("--level", level),
    });

    const result = await parseAsync(parser, ["--level", "silent"]);

    assert.ok(result.success);
    assert.deepEqual(result.value.combo, ["prod", undefined]);
    assert.equal(result.value.level, "silent");
    assert.equal(calls.length, 1);
  });

  it(
    "keeps a duplicate-field prompt local inside a nested merge()",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt } = createTestPrompt();
      const parser = object({
        combo: merge(
          object({
            mode: prompt(option("--mode-a", mode), { value: "prod" }),
          }),
          object({ mode: withDefault(option("--mode-b", string()), "dev") }),
        ),
        level: option("--level", level),
      });

      // The first child's prompted source is behind a duplicated merge()
      // field, so it must stay local to that child even when the merge is
      // nested; the outer consumer falls back to its own default ("dev"),
      // for which "debug" is valid.
      const result = await parseAsync(parser, ["--level", "debug"]);

      assert.ok(result.success);
      assert.equal(result.value.combo.mode, "dev");
      assert.equal(result.value.level, "debug");
    },
  );

  it(
    "keeps env precedence for a nested bindEnv(prompt(...)) source",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const envContext = createEnvContext({
        prefix: "APP_",
        source: (key) => ({ APP_MODE: "prod" })[key],
      });
      const annotations = envContext.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const parser = object({
        settings: object({
          mode: bindEnv(prompt(option("--mode", mode), { value: "dev" }), {
            context: envContext,
            key: "MODE",
            parser: choice(["dev", "prod"] as const),
          }),
        }),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, ["--level", "silent"], {
        annotations,
      });

      assert.ok(result.success);
      assert.equal(result.value.settings.mode, "prod");
      assert.equal(result.value.level, "silent");
      assert.deepEqual(calls, []);
    },
  );

  it(
    "keeps withDefault(prompt(...)) behavior identical when nested",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      // At the top level, withDefault(prompt(...)) resolves to the default
      // without prompting; nesting the field under another object() must
      // not change that.
      const parser = object({
        settings: object({
          mode: withDefault(
            prompt(option("--mode", mode), { value: "prod" }),
            "dev" as const,
          ),
        }),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, ["--level", "debug"]);

      assert.ok(result.success);
      assert.equal(result.value.settings.mode, "dev");
      assert.equal(result.value.level, "debug");
      assert.deepEqual(calls, []);
    },
  );

  it(
    "lets the later prompted occurrence of a shared source win",
    async () => {
      const shared = dependency(choice(["dev", "prod"] as const));
      const level = shared.derive({
        metavar: "LEVEL",
        mode: "sync",
        factory: (value: "dev" | "prod") =>
          choice(
            value === "dev"
              ? (["debug", "verbose"] as const)
              : (["silent", "strict"] as const),
          ),
        defaultValue: () => "dev" as const,
      });
      const { prompt, calls } = createTestPrompt();
      const parser = object({
        a: prompt(option("--a", shared), { value: "dev" }),
        b: prompt(option("--b", shared), { value: "prod" }),
        level: option("--level", level),
      });

      // CLI parity: with --a dev --b prod, the later source occurrence
      // wins, so the prompted run must behave the same way.
      const result = await parseAsync(parser, ["--level", "silent"]);

      assert.ok(result.success);
      assert.equal(result.value.a, "dev");
      assert.equal(result.value.b, "prod");
      assert.equal(result.value.level, "silent");
      assert.equal(calls.length, 2);
    },
  );

  it(
    "prompts a later shared-source occurrence despite an earlier CLI value",
    async () => {
      const shared = dependency(choice(["dev", "prod"] as const));
      const level = shared.derive({
        metavar: "LEVEL",
        mode: "sync",
        factory: (value: "dev" | "prod") =>
          choice(
            value === "dev"
              ? (["debug", "verbose"] as const)
              : (["silent", "strict"] as const),
          ),
        defaultValue: () => "dev" as const,
      });
      const { prompt, calls } = createTestPrompt();
      const parser = object({
        a: prompt(option("--a", shared), { value: "prod" }),
        b: prompt(option("--b", shared), { value: "prod" }),
        level: option("--level", level),
      });

      // CLI parity with "--a dev --b prod": a command-line value for one
      // occurrence must not suppress the other occurrence's prompt, whose
      // answer still registers last and wins before sibling replay.
      const result = await parseAsync(
        parser,
        ["--a", "dev", "--level", "silent"],
      );

      assert.ok(result.success);
      assert.equal(result.value.a, "dev");
      assert.equal(result.value.b, "prod");
      assert.equal(result.value.level, "silent");
      assert.equal(calls.length, 1);

      const invalid = await parseAsync(
        parser,
        ["--a", "dev", "--level", "debug"],
      );
      assert.ok(!invalid.success);
    },
  );

  it(
    "lets a later conditional() CLI occurrence win over an earlier prompt",
    async () => {
      const shared = dependency(choice(["dev", "prod"] as const));
      const level = shared.derive({
        metavar: "LEVEL",
        mode: "sync",
        factory: (value: "dev" | "prod") =>
          choice(
            value === "dev"
              ? (["debug", "verbose"] as const)
              : (["silent", "strict"] as const),
          ),
        defaultValue: () => "dev" as const,
      });
      const { prompt, calls } = createTestPrompt();
      // The conditional's branch occurrence of the shared source is
      // declared after the prompted sibling, so its command-line value
      // must win over the prompt's answer, exactly as a repeated
      // command-line occurrence would.
      const parser = object({
        a: prompt(option("--a", shared), { value: "dev" }),
        cond: conditional(
          option("--kind", choice(["k"] as const)),
          { k: object({ b: option("--b", shared) }) },
        ),
        level: option("--level", level),
      });

      const result = await parseAsync(
        parser,
        ["--kind", "k", "--b", "prod", "--level", "silent"],
      );

      assert.ok(result.success);
      assert.equal(result.value.a, "dev");
      assert.equal(result.value.level, "silent");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "runs merge() source prompts in declaration order despite priorities",
    async () => {
      const srcA = dependency(string());
      const srcB = dependency(string());
      const { prompt, calls } = createTestPrompt();
      // The argument-based child has lower priority than the option-based
      // child, so merge() sorts the option child first internally; the
      // prompts must still run in declaration order (A before B).
      const parser = merge(
        object({ a: prompt(argument(srcA), { value: "A" }) }),
        object({ b: prompt(option("--b", srcB), { value: "B" }) }),
      );

      const result = await parseAsync(parser, []);

      assert.ok(result.success);
      assert.deepEqual(calls, [{ value: "A" }, { value: "B" }]);
    },
  );

  it(
    "prompts once for a source nested below a merge() child",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const parser = merge(
        object({
          settings: object({
            mode: prompt(option("--mode", mode), { value: "prod" }),
          }),
        }),
        object({ level: option("--level", level) }),
      );

      const result = await parseAsync(parser, ["--level", "silent"]);

      assert.ok(result.success);
      assert.equal(result.value.settings.mode, "prod");
      assert.equal(result.value.level, "silent");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "does not register a bound wrapper around a transformed source",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const envContext = createEnvContext({
        prefix: "APP_",
        source: () => undefined,
      });
      const annotations = envContext.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      // bindEnv() around a transformed prompted source completes in the
      // transformed domain, so nothing may register under the raw source
      // ID even when the field is nested and scheduled by expansion; the
      // consumer falls back to its own default ("dev").
      const parser = object({
        settings: object({
          mode: bindEnv(
            prompt(option("--mode", mode), { value: "prod" })
              .map((value) => value.toUpperCase()),
            {
              context: envContext,
              key: "MODE",
              parser: choice(["DEV", "PROD"] as const),
            },
          ),
        }),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, ["--level", "debug"], {
        annotations,
      });

      assert.ok(result.success);
      assert.equal(result.value.settings.mode, "PROD");
      assert.equal(result.value.level, "debug");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "propagates demand into a selected command branch in two-pass runs",
    async () => {
      const { mode, level } = createModeFixture();
      const other = dependency(string());
      const { prompt, calls } = createTestPrompt();
      let phase2Parsed: unknown;
      const dynamicContext: SourceContext = {
        id: Symbol.for("@optique/prompt/test-command-demand-phase-two"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          if (isPhase2ContextRequest(request)) phase2Parsed = request.parsed;
          return {};
        },
      };
      // The enclosing concat() has nothing schedulable itself (the or()
      // branches wrap different sources), but its consumer's demand must
      // still reach the prompt scheduled inside the selected command
      // branch during the phase-two seed pass.
      const parser = concat(
        or(
          command(
            "run",
            tuple([prompt(option("--mode", mode), { value: "prod" })]),
          ),
          command(
            "stop",
            tuple([prompt(option("--other", other), { value: "x" })]),
          ),
        ),
        tuple([option("--level", level)]),
      );

      const result = await runWith(parser, "test", [dynamicContext], {
        args: ["run", "--level", "silent"],
      });

      assert.deepEqual(result, ["prod", "silent"]);
      assert.deepEqual(phase2Parsed, ["prod", "silent"]);
      assert.equal(calls.length, 1);
    },
  );

  it(
    "keeps env precedence for a bound source nested below a merge() child",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const envContext = createEnvContext({
        prefix: "APP_",
        source: (key) => ({ APP_MODE: "prod" })[key],
      });
      const annotations = envContext.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const parser = merge(
        object({
          settings: object({
            mode: bindEnv(prompt(option("--mode", mode), { value: "dev" }), {
              context: envContext,
              key: "MODE",
              parser: choice(["dev", "prod"] as const),
            }),
          }),
        }),
        object({ level: option("--level", level) }),
      );

      const result = await parseAsync(parser, ["--level", "silent"], {
        annotations,
      });

      assert.ok(result.success);
      assert.equal(result.value.settings.mode, "prod");
      assert.equal(result.value.level, "silent");
      assert.deepEqual(calls, []);
    },
  );

  it("registers a prompted value behind nonEmpty()", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = object({
      mode: prompt(nonEmpty(option("--mode", mode)), { value: "prod" }),
      level: option("--level", level),
    });

    const valid = await parseAsync(parser, ["--level", "silent"]);
    assert.ok(valid.success);
    assert.equal(valid.value.mode, "prod");
    assert.equal(valid.value.level, "silent");
    assert.equal(calls.length, 1);

    const invalid = await parseAsync(parser, ["--level", "debug"]);
    assert.ok(!invalid.success);
  });

  it(
    "stops later prompts when a pre-completed prompt is cancelled",
    async () => {
      const a = dependency(choice(["dev", "prod"] as const));
      const b = dependency(choice(["x", "y"] as const));
      const { prompt, calls } = createTestPrompt();
      const envContext = createEnvContext({
        prefix: "APP_",
        source: () => undefined,
      });
      const annotations = envContext.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      // Field `a` is pre-completed during Phase 1 (bindEnv() opts into
      // pre-completion) and its prompt is cancelled there; the later
      // source prompt `b` must not run.
      const parser = object({
        a: prompt(
          bindEnv(option("--a", a), {
            context: envContext,
            key: "A",
            parser: choice(["dev", "prod"] as const),
          }),
          { value: "dev", reject: true },
        ),
        b: prompt(option("--b", b), { value: "x" }),
      });

      const result = await parseAsync(parser, [], { annotations });

      assert.ok(!result.success);
      assert.equal(calls.length, 1);
    },
  );

  it(
    "stops later prompts when a merge() child's pre-completed prompt is cancelled",
    async () => {
      const a = dependency(choice(["dev", "prod"] as const));
      const b = dependency(choice(["x", "y"] as const));
      const { prompt, calls } = createTestPrompt();
      const envContext = createEnvContext({
        prefix: "APP_",
        source: () => undefined,
      });
      const annotations = envContext.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const parser = merge(
        object({
          a: prompt(
            bindEnv(option("--a", a), {
              context: envContext,
              key: "A",
              parser: choice(["dev", "prod"] as const),
            }),
            { value: "dev", reject: true },
          ),
        }),
        object({ b: prompt(option("--b", b), { value: "x" }) }),
      );

      const result = await parseAsync(parser, [], { annotations });

      assert.ok(!result.success);
      assert.equal(calls.length, 1);
    },
  );

  it("prompts once for a source inside a nested merge()", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = object({
      combo: merge(
        object({ mode: prompt(option("--mode", mode), { value: "prod" }) }),
        object({ other: optional(option("--other", string())) }),
      ),
      level: option("--level", level),
    });

    const result = await parseAsync(parser, ["--level", "silent"]);

    assert.ok(result.success);
    assert.equal(result.value.combo.mode, "prod");
    assert.equal(result.value.level, "silent");
    assert.equal(calls.length, 1);
  });

  it(
    "runs nested merge() source prompts in declaration order",
    async () => {
      const srcA = dependency(string());
      const srcB = dependency(string());
      const { prompt, calls } = createTestPrompt();
      // The argument-based child has lower priority than the option-based
      // child, so the nested merge() sorts the option child first
      // internally; the prompts must still run in declaration order and
      // exactly once each.
      const parser = object({
        combo: merge(
          object({ a: prompt(argument(srcA), { value: "A" }) }),
          object({ b: prompt(option("--b", srcB), { value: "B" }) }),
        ),
      });

      const result = await parseAsync(parser, []);

      assert.ok(result.success);
      assert.deepEqual(calls, [{ value: "A" }, { value: "B" }]);
    },
  );

  it(
    "does not register prompt answers for mixed or() alternatives",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const parser = object({
        mode: prompt(
          or(option("--mode", mode), constant("fallback")),
          { value: "fallback" },
        ),
        level: option("--level", level),
      });

      // The union completes in a mixed domain, so nothing may register
      // under the source ID; the consumer falls back to its own default
      // ("dev"), for which "debug" is valid.
      const result = await parseAsync(parser, ["--level", "debug"]);

      assert.ok(result.success);
      assert.equal(result.value.mode, "fallback");
      assert.equal(result.value.level, "debug");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "completes a selected command branch source before sibling replay",
    async () => {
      const { mode, level } = createModeFixture();
      const other = dependency(string());
      const { prompt, calls } = createTestPrompt();
      const parser = object({
        cmd: or(
          command(
            "run",
            object({
              mode: prompt(option("--mode", mode), { value: "prod" }),
            }),
          ),
          command(
            "stop",
            object({
              other: prompt(option("--other", other), { value: "x" }),
            }),
          ),
        ),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, ["run", "--level", "silent"]);

      assert.ok(result.success);
      assert.ok("mode" in result.value.cmd);
      assert.equal(result.value.cmd.mode, "prod");
      assert.equal(result.value.level, "silent");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "stops seed extraction after a demanded prompt cancellation",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const dynamicContext: SourceContext = {
        id: Symbol.for("@optique/prompt/test-seed-cancellation"),
        phase: "two-pass",
        getAnnotations() {
          return {};
        },
      };
      const parser = object({
        mode: prompt(option("--mode", mode), { value: "prod", reject: true }),
        level: option("--level", level),
        name: prompt(option("--name", string()), { value: "n" }),
      });

      // The demanded source prompt is cancelled during the seed pass; no
      // later prompt (including the ordinary `name` prompt) may run in
      // any pass afterwards.
      await assert.rejects(() =>
        runWith(parser, "test", [dynamicContext], {
          args: ["--level", "silent"],
        })
      );

      assert.equal(calls.length, 1);
    },
  );

  it("runs bound merge() prompts in declaration order", async () => {
    const srcA = dependency(string());
    const srcB = dependency(string());
    const { prompt, calls } = createTestPrompt();
    const envContext = createEnvContext({
      prefix: "APP_",
      source: () => undefined,
    });
    const annotations = envContext.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    // The argument-based child has lower priority than the option-based
    // child, so merge() pre-completes the option child first internally
    // unless Phase 1 follows declaration order; the bound prompts must
    // run in declaration order (A before B).
    const parser = merge(
      object({
        a: bindEnv(prompt(argument(srcA), { value: "A" }), {
          context: envContext,
          key: "A",
          parser: string(),
        }),
      }),
      object({
        b: bindEnv(prompt(option("--b", srcB), { value: "B" }), {
          context: envContext,
          key: "B",
          parser: string(),
        }),
      }),
    );

    const result = await parseAsync(parser, [], { annotations });

    assert.ok(result.success);
    assert.deepEqual(calls, [{ value: "A" }, { value: "B" }]);
  });

  it(
    "schedules through map() around a selected command branch",
    async () => {
      const { mode, level } = createModeFixture();
      const other = dependency(string());
      const { prompt, calls } = createTestPrompt();
      const parser = object({
        cmd: or(
          command(
            "run",
            object({
              mode: prompt(option("--mode", mode), { value: "prod" }),
            }),
          ),
          command(
            "stop",
            object({
              other: prompt(option("--other", other), { value: "x" }),
            }),
          ),
        ).map((value) => value),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, ["run", "--level", "silent"]);

      assert.ok(result.success);
      assert.equal(result.value.level, "silent");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "lets a later occurrence override a pre-completed prompt answer",
    async () => {
      const shared = dependency(choice(["dev", "prod"] as const));
      const level = shared.derive({
        metavar: "LEVEL",
        mode: "sync",
        factory: (value: "dev" | "prod") =>
          choice(
            value === "dev"
              ? (["debug", "verbose"] as const)
              : (["silent", "strict"] as const),
          ),
        defaultValue: () => "dev" as const,
      });
      const { prompt, calls } = createTestPrompt();
      const envContext = createEnvContext({
        prefix: "APP_",
        source: () => undefined,
      });
      const annotations = envContext.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      // The first occurrence is pre-completed through its source binding
      // (prompting "dev"); the later prompted occurrence must still run
      // and win, matching repeated command-line source occurrences.
      const parser = object({
        a: prompt(
          bindEnv(option("--a", shared), {
            context: envContext,
            key: "A",
            parser: choice(["dev", "prod"] as const),
          }),
          { value: "dev" },
        ),
        b: prompt(option("--b", shared), { value: "prod" }),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, ["--level", "silent"], {
        annotations,
      });

      assert.ok(result.success);
      assert.equal(result.value.a, "dev");
      assert.equal(result.value.b, "prod");
      assert.equal(result.value.level, "silent");
      assert.equal(calls.length, 2);
    },
  );

  it(
    "keeps declaration order across nested and bound shared prompts",
    async () => {
      const shared = dependency(choice(["dev", "prod"] as const));
      const level = shared.derive({
        metavar: "LEVEL",
        mode: "sync",
        factory: (value: "dev" | "prod") =>
          choice(
            value === "dev"
              ? (["debug", "verbose"] as const)
              : (["silent", "strict"] as const),
          ),
        defaultValue: () => "dev" as const,
      });
      const { prompt, calls } = createTestPrompt();
      const envContext = createEnvContext({
        prefix: "APP_",
        source: () => undefined,
      });
      const annotations = envContext.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      // The nested prompt is declared first and the bound prompt second;
      // both must run in declaration order and the later answer wins for
      // the derived consumer.
      const parser = object({
        g: object({ a: prompt(option("--a", shared), { value: "dev" }) }),
        b: prompt(
          bindEnv(option("--b", shared), {
            context: envContext,
            key: "B",
            parser: choice(["dev", "prod"] as const),
          }),
          { value: "prod" },
        ),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, ["--level", "silent"], {
        annotations,
      });

      assert.ok(result.success);
      assert.equal(result.value.level, "silent");
      assert.deepEqual(calls.map((c) => c.value), ["dev", "prod"]);
    },
  );

  it(
    "exposes nested prompts through a matched optional(object(...))",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const parser = object({
        g: optional(object({
          flag: option("--g", string()),
          mode: prompt(option("--mode", mode), { value: "prod" }),
        })),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, [
        "--g",
        "x",
        "--level",
        "silent",
      ]);

      assert.ok(result.success);
      assert.equal(result.value.g?.mode, "prod");
      assert.equal(result.value.level, "silent");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "exposes nested prompts through withDefault(object(...))",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const parser = object({
        g: withDefault(
          object({
            flag: option("--g", string()),
            mode: prompt(option("--mode", mode), { value: "prod" }),
          }),
          { flag: "d", mode: "dev" as const },
        ),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, [
        "--g",
        "x",
        "--level",
        "silent",
      ]);

      assert.ok(result.success);
      assert.equal(result.value.g.mode, "prod");
      assert.equal(result.value.level, "silent");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "keeps optional() suppression for a mapped prompted source",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const parser = object({
        mode: optional(
          prompt(option("--mode", mode), { value: "prod" })
            .map((value) => value.toUpperCase()),
        ),
        level: option("--level", level),
      });

      // An unmatched optional() resolves to undefined without prompting,
      // even around a mapped source; the consumer falls back to its own
      // default ("dev").
      const result = await parseAsync(parser, ["--level", "debug"]);

      assert.ok(result.success);
      assert.equal(result.value.mode, undefined);
      assert.equal(result.value.level, "debug");
      assert.deepEqual(calls, []);
    },
  );

  it(
    "schedules prompts inside a nonEmpty(object(...)) merge child",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const parser = merge(
        object({ level: option("--level", level) }),
        nonEmpty(object({
          enabled: flag("--enabled"),
          mode: prompt(option("--mode", mode), { value: "prod" }),
        })),
      );

      const result = await parseAsync(parser, [
        "--enabled",
        "--level",
        "silent",
      ]);

      assert.ok(result.success);
      assert.equal(result.value.mode, "prod");
      assert.equal(result.value.level, "silent");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "does not prompt for an unmatched withDefault(object) merge child",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const parser = merge(
        object({ level: option("--level", level) }),
        withDefault(
          object({ mode: prompt(option("--mode", mode), { value: "prod" }) }),
          { mode: "dev" as const },
        ),
      );

      // Nothing matches the second child, so its default applies without
      // prompting; the consumer falls back to its own default ("dev").
      const result = await parseAsync(parser, ["--level", "debug"]);

      assert.ok(result.success);
      assert.equal(result.value.mode, "dev");
      assert.equal(result.value.level, "debug");
      assert.deepEqual(calls, []);
    },
  );

  it("recovers a failed bound source through the prompt", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "invalid" })[key],
    });
    const annotations = envContext.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const parser = object({
      mode: prompt(
        bindEnv(option("--mode", mode), {
          context: envContext,
          key: "MODE",
          parser: choice(["dev", "prod"] as const),
        }),
        { value: "prod" },
      ),
      level: option("--level", level),
    });

    // The environment value is invalid, so the prompt falls back; its
    // answer must feed the derived consumer consistently.
    const result = await parseAsync(parser, ["--level", "silent"], {
      annotations,
    });

    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
    assert.equal(calls.length, 1);
  });

  it(
    "completes a prompted conditional() discriminator before sibling replay",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const parser = object({
        selected: conditional(
          prompt(option("--mode", mode), { value: "prod" }),
          {
            dev: object({
              d: withDefault(option("--d", choice(["x"] as const)), "x"),
            }),
            prod: object({
              p: withDefault(option("--p", choice(["y"] as const)), "y"),
            }),
          },
        ),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, ["--level", "silent"]);

      assert.ok(result.success);
      assert.equal(result.value.level, "silent");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "schedules a prompted discriminator in a root-level conditional()",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      // No parent construct invokes the scheduling hook here, so the
      // conditional's own completion must schedule the discriminator
      // prompt before branch replay.
      const parser = conditional(
        prompt(option("--mode", mode), { value: "prod" }),
        { prod: object({ level: option("--level", level) }) },
      );

      const result = await parseAsync(parser, ["--level", "silent"]);

      assert.ok(result.success);
      assert.deepEqual(result.value, ["prod", { level: "silent" }]);
      assert.equal(calls.length, 1);
    },
  );

  it(
    "does not prompt inside a mismatched speculative conditional() branch",
    async () => {
      const mode = dependency(choice(["dev", "prod"] as const));
      const other = dependency(string());
      const { prompt, calls } = createTestPrompt();
      // "--d 1" speculatively selects the dev branch, but the prompted
      // discriminator answers "prod": the guessed branch must produce no
      // interactive side effects before the mismatch is verified.
      const parser = conditional(
        prompt(option("--mode", mode), { value: "prod" }),
        {
          dev: object({
            d: option("--d", string()),
            dp: prompt(option("--dp", other), { value: "DP" }),
          }),
          prod: object({ p: option("--p", string()) }),
        },
      );

      const result = await parseAsync(parser, ["--d", "1"]);

      assert.ok(!result.success);
      assert.deepEqual(calls, [{ value: "prod" }]);
    },
  );

  it(
    "schedules the branch chosen by a prompted discriminator",
    async () => {
      const kind = dependency(choice(["a", "b"] as const));
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      // Nothing on the command line selects the branch; the prompted
      // discriminator answers "a", whose branch prompts a mode source
      // consumed by an outer sibling.  Both prompts must run before
      // the sibling's replay, once each.
      const parser = object({
        cond: conditional(
          prompt(option("--kind", kind), { value: "a" }),
          {
            a: object({
              mode: prompt(option("--mode", mode), { value: "prod" }),
            }),
            b: object({ y: option("--y", choice(["2"] as const)) }),
          },
        ),
        level: option("--level", level),
      });

      const valid = await parseAsync(parser, ["--level", "silent"]);
      assert.ok(valid.success);
      assert.equal(valid.value.level, "silent");
      assert.equal(calls.length, 2);

      const invalid = await parseAsync(parser, ["--level", "debug"]);
      assert.ok(!invalid.success);
    },
  );

  it(
    "schedules a nothing-parsed default branch's prompted source",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      // No input at all commits a branch and the discriminator option
      // cannot complete, so the default branch is selected; its
      // prompted source must be scheduled before the sibling's replay.
      const parser = object({
        cond: conditional(
          option("--kind", choice(["a", "b"] as const)),
          {
            a: object({ x: option("--x", choice(["1"] as const)) }),
            b: object({ y: option("--y", choice(["2"] as const)) }),
          },
          object({
            mode: prompt(option("--mode", mode), { value: "prod" }),
          }),
        ),
        level: option("--level", level),
      });

      const valid = await parseAsync(parser, ["--level", "silent"]);
      assert.ok(valid.success);
      assert.equal(valid.value.level, "silent");
      assert.equal(calls.length, 1);

      const invalid = await parseAsync(parser, ["--level", "debug"]);
      assert.ok(!invalid.success);
    },
  );

  it(
    "reuses the prepared selection for a non-idempotent discriminator",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      let defaultCalls = 0;
      // The discriminator's lazy default yields "a" on its first two
      // evaluations (parse-time branch probing consumes one, the
      // scheduling pass's preparation the other) and "b" afterwards.
      // Final completion must consume the prepared selection instead of
      // evaluating the default a third time: a third evaluation would
      // select branch "b", whose required --y is missing.
      const parser = object({
        cond: conditional(
          withDefault(
            option("--kind", choice(["a", "b"] as const)),
            () => (++defaultCalls <= 2 ? "a" : "b") as "a" | "b",
          ),
          {
            a: object({
              mode: prompt(option("--mode", mode), { value: "prod" }),
            }),
            b: object({ y: option("--y", choice(["2"] as const)) }),
          },
        ),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, ["--level", "silent"]);
      assert.ok(result.success);
      assert.equal(result.value.level, "silent");
      assert.equal(defaultCalls, 2);
      assert.equal(calls.length, 1);
    },
  );

  it(
    "stops after a cancelled prompted discriminator",
    async () => {
      const kind = dependency(choice(["a", "b"] as const));
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const parser = object({
        cond: conditional(
          prompt(option("--kind", kind), { value: "a", reject: true }),
          {
            a: object({
              mode: prompt(option("--mode", mode), { value: "prod" }),
            }),
            b: object({ y: option("--y", choice(["2"] as const)) }),
          },
        ),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, ["--level", "silent"]);
      assert.ok(!result.success);
      // Only the discriminator prompt ran; the branch prompt never did.
      assert.equal(calls.length, 1);
    },
  );

  it(
    "schedules a confirmed speculative branch's prompted source",
    async () => {
      const kind = dependency(choice(["a", "b"] as const));
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      // "--a x" speculatively selects branch a while the prompted
      // discriminator defers; the answer "a" confirms the guess, so the
      // branch's prompted source must still complete before the outer
      // sibling's replay.
      const parser = object({
        cond: conditional(
          prompt(option("--kind", kind), { value: "a" }),
          {
            a: object({
              ax: option("--a", choice(["x"] as const)),
              mode: prompt(option("--mode", mode), { value: "prod" }),
            }),
            b: object({ y: option("--y", choice(["2"] as const)) }),
          },
        ),
        level: option("--level", level),
      });

      const valid = await parseAsync(
        parser,
        ["--a", "x", "--level", "silent"],
      );
      assert.ok(valid.success);
      assert.equal(valid.value.level, "silent");
      assert.equal(calls.length, 2);

      const invalid = await parseAsync(
        parser,
        ["--a", "x", "--level", "debug"],
      );
      assert.ok(!invalid.success);
    },
  );

  it(
    "delivers a confirmed speculative branch's CLI source",
    async () => {
      const kind = dependency(choice(["a", "b"] as const));
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      // The speculative branch's mode value is typed, not prompted; it
      // must reach the sibling once the discriminator's answer confirms
      // the branch.
      const parser = object({
        cond: conditional(
          prompt(option("--kind", kind), { value: "a" }),
          {
            a: object({
              ax: option("--a", choice(["x"] as const)),
              mode: option("--mode", mode),
            }),
            b: object({ y: option("--y", choice(["2"] as const)) }),
          },
        ),
        level: option("--level", level),
      });

      const result = await parseAsync(
        parser,
        ["--a", "x", "--mode", "prod", "--level", "silent"],
      );

      assert.ok(result.success);
      assert.equal(result.value.level, "silent");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "prepares a demanded conditional() branch across two-pass runs",
    async () => {
      const kind = dependency(choice(["a", "b"] as const));
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      let phase2Level: string | undefined;
      const dynamicContext: SourceContext = {
        id: Symbol.for("@optique/prompt/test-conditional-branch-demand"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          if (isPhase2ContextRequest(request)) {
            phase2Level = (request.parsed as { readonly level?: string })
              ?.level;
          }
          return {};
        },
      };
      // --level demands the branch's mode source; the discriminator is
      // its control dependency, so both prompts already run in the seed
      // pass and their answers are reused in the final pass: one
      // execution each across the whole run.
      const parser = object({
        cond: conditional(
          prompt(option("--kind", kind), { value: "a" }),
          {
            a: object({
              mode: prompt(option("--mode", mode), { value: "prod" }),
            }),
            b: object({ y: option("--y", choice(["2"] as const)) }),
          },
        ),
        level: option("--level", level),
      });

      const result = await runWith(parser, "test", [dynamicContext], {
        args: ["--level", "silent"],
      });

      assert.equal(result.level, "silent");
      assert.equal(calls.length, 2);
      assert.equal(phase2Level, "silent");
    },
  );

  it(
    "prepares a nested conditional() inside a prepared branch",
    async () => {
      const kind = dependency(choice(["x", "z"] as const));
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const parser = object({
        outer: conditional(
          prompt(option("--kind", kind), { value: "x" }),
          {
            x: object({
              inner: conditional(
                prompt(option("--mode", mode), { value: "prod" }),
                {
                  dev: object({
                    d: withDefault(
                      option("--d", choice(["1"] as const)),
                      "1" as const,
                    ),
                  }),
                  prod: object({
                    p: withDefault(
                      option("--p", choice(["2"] as const)),
                      "2" as const,
                    ),
                  }),
                },
              ),
            }),
            z: object({ y: option("--y", choice(["3"] as const)) }),
          },
        ),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, ["--level", "silent"]);

      assert.ok(result.success);
      assert.equal(result.value.level, "silent");
      assert.equal(calls.length, 2);
    },
  );

  it(
    "evaluates a nested lazy withDefault(prompt) default exactly once",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      let defaultCalls = 0;
      const parser = object({
        settings: object({
          mode: withDefault(
            prompt(option("--mode", mode), { value: "prod" }),
            () => (++defaultCalls === 1 ? "prod" : "dev") as "dev" | "prod",
          ),
        }),
        level: option("--level", level),
      });

      // The registered dependency value and the returned field must come
      // from the same single evaluation of the lazy default.
      const result = await parseAsync(parser, ["--level", "silent"]);

      assert.ok(result.success);
      assert.equal(result.value.settings.mode, "prod");
      assert.equal(result.value.level, "silent");
      assert.deepEqual(calls, []);
      assert.equal(defaultCalls, 1);
    },
  );

  it("registers a prompted value nested in an inner object()", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = object({
      settings: object({
        mode: prompt(option("--mode", mode), { value: "prod" }),
      }),
      level: option("--level", level),
    });

    const result = await parseAsync(parser, ["--level", "silent"]);

    assert.ok(result.success);
    assert.equal(result.value.settings.mode, "prod");
    assert.equal(result.value.level, "silent");
    assert.equal(calls.length, 1);
  });

  it(
    "keeps optional(prompt(...)) suppression for a wrapped source",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      // An unmatched optional() field resolves to `undefined` without
      // prompting for non-source prompts; wrapping a dependency source
      // must behave the same way, so the consumer falls back to its own
      // default ("dev").
      const parser = object({
        mode: optional(prompt(option("--mode", mode), { value: "prod" })),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, ["--level", "debug"]);

      assert.ok(result.success);
      assert.equal(result.value.mode, undefined);
      assert.equal(result.value.level, "debug");
      assert.deepEqual(calls, []);
    },
  );

  it(
    "does not register a prompt answer for a transformed inner source",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      // The prompt's answer lives in the mapped domain, so the
      // pre-transform source value is unrecoverable and nothing
      // registers; the consumer falls back to its own default ("dev").
      const parser = object({
        mode: prompt(
          option("--mode", mode).map((value) => value.toUpperCase()),
          { value: "PROD" },
        ),
        level: option("--level", level),
      });

      const result = await parseAsync(parser, ["--level", "debug"]);

      assert.ok(result.success);
      assert.equal(result.value.mode, "PROD");
      assert.equal(result.value.level, "debug");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "prompts once per occurrence when one instance is reused",
    async () => {
      const src = dependency(string());
      const { prompt, calls } = createTestPrompt();
      const shared = prompt(argument(src), { value: "answer" });
      const parser = tuple([shared, shared]);

      // Each position is a separate occurrence, matching how the same
      // non-source prompt instance behaves at two positions.
      const result = await parseAsync(parser, []);

      assert.ok(result.success);
      assert.deepEqual(result.value, ["answer", "answer"]);
      assert.equal(calls.length, 2);
    },
  );

  it("registers the pre-transform value of a mapped source prompt", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const parser = object({
      mode: prompt(option("--mode", mode), { value: "prod" })
        .map((value) => value.toUpperCase()),
      level: option("--level", level),
    });

    // The derived parser sees the pre-transform value ("prod"), while
    // the field itself produces the mapped value ("PROD").
    const valid = await parseAsync(parser, ["--level", "silent"]);
    assert.ok(valid.success);
    assert.equal(valid.value.mode, "PROD");
    assert.equal(valid.value.level, "silent");
    assert.equal(calls.length, 1);

    const invalid = await parseAsync(parser, ["--level", "debug"]);
    assert.ok(!invalid.success);
  });

  it(
    "keeps distinct prompts on one source local to duplicate merge() fields",
    async () => {
      const mode = dependency(choice(["dev", "prod"] as const));
      const { prompt, calls } = createTestPrompt();
      const parser = merge(
        object({ mode: prompt(option("--mode-a", mode), { value: "prod" }) }),
        object({ mode: prompt(option("--mode-b", mode), { value: "dev" }) }),
      );

      // Both prompts run in their own children, and the later duplicate
      // field wins; the first child's result must not leak into the
      // second child's prompt.
      const result = await parseAsync(parser, []);

      assert.ok(result.success);
      assert.equal(result.value.mode, "dev");
      assert.equal(calls.length, 2);
    },
  );

  it(
    "detects phase-one demand across merge() children in the seed pass",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      let phase2Parsed:
        | { readonly mode?: string; readonly level?: string }
        | undefined;
      const dynamicContext: SourceContext = {
        id: Symbol.for("@optique/prompt/test-merge-demand-phase-two"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          const parsed = getPhase2ContextParsed<
            { readonly mode?: string; readonly level?: string }
          >(request);
          if (parsed !== undefined) phase2Parsed = parsed;
          return {};
        },
      };
      const parser = merge(
        object({ mode: prompt(option("--mode", mode), { value: "prod" }) }),
        object({ level: option("--level", level) }),
      );

      const result = await runWith(parser, "test", [dynamicContext], {
        args: ["--level", "silent"],
      });

      assert.deepEqual(result, { mode: "prod", level: "silent" });
      assert.equal(phase2Parsed?.mode, "prod");
      assert.equal(phase2Parsed?.level, "silent");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "prompts a demanded bound source during the phase-two seed pass",
    async () => {
      const { mode, level } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const envContext = createEnvContext({
        prefix: "APP_",
        source: () => undefined,
      });
      let phase2Parsed:
        | { readonly mode?: string; readonly level?: string }
        | undefined;
      const dynamicContext: SourceContext = {
        id: Symbol.for("@optique/prompt/test-bound-demanded-phase-two"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          const parsed = getPhase2ContextParsed<
            { readonly mode?: string; readonly level?: string }
          >(request);
          if (parsed !== undefined) phase2Parsed = parsed;
          return {};
        },
      };
      // The source binding pre-completes the prompt during Phase 1,
      // before consumer demand is known; the deferred result must stay
      // schedulable so the prompt still runs during the seed pass.
      const parser = object({
        mode: prompt(
          bindEnv(option("--mode", mode), {
            context: envContext,
            key: "MODE",
            parser: choice(["dev", "prod"] as const),
          }),
          { value: "prod" },
        ),
        level: option("--level", level),
      });

      const result = await runWith(
        parser,
        "test",
        [dynamicContext, envContext],
        { args: ["--level", "silent"] },
      );

      assert.deepEqual(result, { mode: "prod", level: "silent" });
      assert.equal(phase2Parsed?.mode, "prod");
      assert.equal(phase2Parsed?.level, "silent");
      assert.equal(calls.length, 1);
    },
  );

  it(
    "defers an undemanded bound source prompt to the final pass",
    async () => {
      const { mode } = createModeFixture();
      const { prompt, calls } = createTestPrompt();
      const envContext = createEnvContext({
        prefix: "APP_",
        source: () => undefined,
      });
      let phase2Mode: string | undefined = "unset";
      const dynamicContext: SourceContext = {
        id: Symbol.for("@optique/prompt/test-bound-undemanded-phase-two"),
        phase: "two-pass",
        getAnnotations(request?: unknown) {
          if (isPhase2ContextRequest(request)) {
            phase2Mode = (request.parsed as { readonly mode?: string })?.mode;
          }
          return {};
        },
      };
      const parser = object({
        mode: prompt(
          bindEnv(option("--mode", mode), {
            context: envContext,
            key: "MODE",
            parser: choice(["dev", "prod"] as const),
          }),
          { value: "prod" },
        ),
      });

      const result = await runWith(
        parser,
        "test",
        [dynamicContext, envContext],
        { args: [] },
      );

      assert.deepEqual(result, { mode: "prod" });
      assert.equal(phase2Mode, undefined);
      assert.equal(calls.length, 1);
    },
  );

  it("keeps env precedence over a bound source prompt in two-pass runs", async () => {
    const { mode, level } = createModeFixture();
    const { prompt, calls } = createTestPrompt();
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const dynamicContext: SourceContext = {
      id: Symbol.for("@optique/prompt/test-bound-env-precedence"),
      phase: "two-pass",
      getAnnotations() {
        return {};
      },
    };
    const parser = object({
      mode: prompt(
        bindEnv(option("--mode", mode), {
          context: envContext,
          key: "MODE",
          parser: choice(["dev", "prod"] as const),
        }),
        { value: "dev" },
      ),
      level: option("--level", level),
    });

    const result = await runWith(
      parser,
      "test",
      [dynamicContext, envContext],
      { args: ["--level", "silent"] },
    );

    assert.deepEqual(result, { mode: "prod", level: "silent" });
    assert.deepEqual(calls, []);
  });
});
