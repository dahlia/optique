import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import { parseAsync } from "@optique/core/parser";
import { fail, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { createPromptAdapter } from "@optique/prompt";

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

  it("runs the adapter when the CLI value is absent", async () => {
    const { prompt, calls } = createTestPrompt();
    const config = { value: "Bob" };
    const parser = prompt(option("--name", string()), config);

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.equal(result.value, "Bob");
    assert.deepEqual(calls, [config]);
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
    const parser = prompt(
      bindEnv(option("--name", string()), {
        context: envContext,
        key: "NAME",
        parser: string(),
      }),
      { value: "PromptName" },
    );

    const result = await parseAsync(parser, [], { annotations });

    assert.ok(result.success);
    assert.equal(result.value, "EnvName");
    assert.deepEqual(calls, []);
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
