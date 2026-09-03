import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { type Annotations, getAnnotations } from "@optique/core/annotations";
import { object } from "@optique/core/constructs";
import { dependency } from "@optique/core/dependency";
import { defineTraits, getTraits } from "@optique/core/extension";
import { runWith } from "@optique/core/facade";
import { formatMessage, message } from "@optique/core/message";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import { parseAsync, type Parser } from "@optique/core/parser";
import { constant, fail, option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import { bindConfig, createConfigContext } from "@optique/config";
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

function createRegionConfigContext() {
  return createConfigContext<{ readonly region?: "us" | "eu" }>({
    schema: {
      "~standard": {
        version: 1,
        vendor: "test",
        validate: (input: unknown) => ({
          value: input as { readonly region?: "us" | "eu" },
        }),
      },
    },
  });
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

  // https://github.com/dahlia/optique/issues/930
  it(
    "supplies a config-bound prompt to a sibling dependency consumer",
    async () => {
      const region = dependency(choice(["us", "eu"] as const));
      const regionDerived = region.deriveSync({
        metavar: "REGION_DERIVED",
        factory: (value: "us" | "eu") =>
          choice(value === "us" ? (["z1"] as const) : (["z2"] as const)),
        defaultValue: () => "us" as const,
      });
      const context = createRegionConfigContext();
      const { prompt, calls } = createTestPrompt();
      const parser = object({
        region: bindConfig(
          prompt(option("--region", region), { value: "us" }),
          { context, key: "region" },
        ),
        out: option("--out", regionDerived),
      });

      const result = await runWith(parser, "test", [context], {
        args: ["--out", "z2"],
        contextOptions: {
          load: () => ({
            config: { region: "eu" as const },
            meta: undefined,
          }),
        },
      });

      assert.deepEqual(result, { region: "eu", out: "z2" });
      assert.deepEqual(calls, []);
    },
  );

  it(
    "prompts a config-bound dependency source when its key is absent",
    async () => {
      const region = dependency(choice(["us", "eu"] as const));
      const regionDerived = region.deriveSync({
        metavar: "REGION_DERIVED",
        factory: (value: "us" | "eu") =>
          choice(value === "us" ? (["z1"] as const) : (["z2"] as const)),
        defaultValue: () => "us" as const,
      });
      const context = createRegionConfigContext();
      const { prompt, calls } = createTestPrompt();
      const promptConfig = { value: "us" as const };
      const parser = object({
        region: bindConfig(
          prompt(option("--region", region), promptConfig),
          { context, key: "region" },
        ),
        out: option("--out", regionDerived),
      });

      const result = await runWith(parser, "test", [context], {
        args: ["--out", "z1"],
        contextOptions: {
          load: () => ({ config: {}, meta: undefined }),
        },
      });

      assert.deepEqual(result, { region: "us", out: "z1" });
      assert.deepEqual(calls, [promptConfig]);
    },
  );

  it(
    "prompts a config-bound dependency source when no config is loaded",
    async () => {
      const region = dependency(choice(["us", "eu"] as const));
      const regionDerived = region.deriveSync({
        metavar: "REGION_DERIVED",
        factory: (value: "us" | "eu") =>
          choice(value === "us" ? (["z1"] as const) : (["z2"] as const)),
        defaultValue: () => "us" as const,
      });
      const context = createRegionConfigContext();
      const { prompt, calls } = createTestPrompt();
      const promptConfig = { value: "us" as const };
      const parser = object({
        region: bindConfig(
          prompt(option("--region", region), promptConfig),
          { context, key: "region" },
        ),
        out: option("--out", regionDerived),
      });

      const result = await runWith(parser, "test", [context], {
        args: ["--out", "z1"],
        contextOptions: { load: () => undefined },
      });

      assert.deepEqual(result, { region: "us", out: "z1" });
      assert.deepEqual(calls, [promptConfig]);
    },
  );

  it(
    "does not prompt when its config context is omitted from a two-pass run",
    async () => {
      const boundContext = createRegionConfigContext();
      const otherContext = createRegionConfigContext();
      const { prompt, calls } = createTestPrompt();
      let errorOutput = "";
      const parser = object({
        region: bindConfig(
          prompt(option("--region", choice(["us", "eu"] as const)), {
            value: "us",
          }),
          { context: boundContext, key: "region" },
        ),
      });

      await assert.rejects(
        runWith(parser, "test", [otherContext], {
          args: [],
          contextOptions: {
            load: () => ({ config: {}, meta: undefined }),
          },
          stderr: (text) => {
            errorOutput += text;
          },
        }),
      );
      assert.match(errorOutput, /contexts option/);
      assert.deepEqual(calls, []);
    },
  );

  it("does not prompt without config annotations", async () => {
    const context = createRegionConfigContext();
    const { prompt, calls } = createTestPrompt();
    const parser = bindConfig(
      prompt(option("--region", choice(["us", "eu"] as const)), {
        value: "us",
      }),
      { context, key: "region" },
    );

    const result = await parseAsync(parser, []);

    assert.ok(!result.success);
    if (result.success) return;
    assert.equal(
      formatMessage(result.error),
      "Missing required configuration value.",
    );
    assert.deepEqual(calls, []);
  });

  it(
    "supplies an env-bound prompt to a sibling dependency consumer",
    async () => {
      const region = dependency(choice(["us", "eu"] as const));
      const regionDerived = region.deriveSync({
        metavar: "REGION_DERIVED",
        factory: (value: "us" | "eu") =>
          choice(value === "us" ? (["z1"] as const) : (["z2"] as const)),
        defaultValue: () => "us" as const,
      });
      const context = createEnvContext({
        source: (key) => key === "REGION" ? "eu" : undefined,
      });
      const { prompt, calls } = createTestPrompt();
      const parser = object({
        region: bindEnv(
          prompt(option("--region", region), { value: "us" }),
          {
            context,
            key: "REGION",
            parser: choice(["us", "eu"] as const),
          },
        ),
        out: option("--out", regionDerived),
      });

      const result = await runWith(parser, "test", [context], {
        args: ["--out", "z2"],
      });

      assert.deepEqual(result, { region: "eu", out: "z2" });
      assert.deepEqual(calls, []);
    },
  );

  it(
    "prompts an env-bound dependency source when its variable is absent",
    async () => {
      const region = dependency(choice(["us", "eu"] as const));
      const regionDerived = region.deriveSync({
        metavar: "REGION_DERIVED",
        factory: (value: "us" | "eu") =>
          choice(value === "us" ? (["z1"] as const) : (["z2"] as const)),
        defaultValue: () => "us" as const,
      });
      const context = createEnvContext({ source: () => undefined });
      const { prompt, calls } = createTestPrompt();
      const promptConfig = { value: "us" as const };
      const parser = object({
        region: bindEnv(
          prompt(option("--region", region), promptConfig),
          {
            context,
            key: "REGION",
            parser: choice(["us", "eu"] as const),
          },
        ),
        out: option("--out", regionDerived),
      });

      const result = await runWith(parser, "test", [context], {
        args: ["--out", "z1"],
      });

      assert.deepEqual(result, { region: "us", out: "z1" });
      assert.deepEqual(calls, [promptConfig]);
    },
  );

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
