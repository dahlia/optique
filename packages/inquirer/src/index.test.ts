import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  annotationKey,
  type Annotations,
  getAnnotations,
  injectAnnotations,
} from "@optique/core/annotations";
import { group, object } from "@optique/core/constructs";
import type { SourceContext } from "@optique/core/context";
import type { DocFragments } from "@optique/core/doc";
import { runWith } from "@optique/core/facade";
import { message } from "@optique/core/message";
import {
  parseAsync,
  type Parser,
  type ParserContext,
  type Suggestion,
} from "@optique/core/parser";
import { fail, flag, option } from "@optique/core/primitives";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import { integer, string } from "@optique/core/valueparser";
import { bindEnv, bool, createEnvContext } from "@optique/env";
import { prompt, Separator } from "@optique/inquirer";
import { bindConfig, createConfigContext } from "../../config/src/index.ts";
import { runAsync } from "../../run/src/run.ts";

const promptFunctionsOverrideSymbol = Symbol.for(
  "@optique/inquirer/prompt-functions",
);

let promptFunctionsOverrideQueue = Promise.resolve();

async function withPromptFunctionsOverride<T>(
  override: Record<string, unknown>,
  callback: () => Promise<T>,
): Promise<T> {
  const previousQueue = promptFunctionsOverrideQueue;
  let release: (() => void) | undefined;
  promptFunctionsOverrideQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previousQueue;

  const globalWithOverride = globalThis as unknown as {
    [promptFunctionsOverrideSymbol]?: Record<string, unknown>;
  };
  const oldOverride = globalWithOverride[promptFunctionsOverrideSymbol];
  globalWithOverride[promptFunctionsOverrideSymbol] = override;
  try {
    return await callback();
  } finally {
    globalWithOverride[promptFunctionsOverrideSymbol] = oldOverride;
    release?.();
  }
}

describe("prompt()", () => {
  interface PromptConfigData {
    readonly apiKey?: string;
  }

  function createPromptConfigSchema(): Parameters<
    typeof createConfigContext<PromptConfigData>
  >[0]["schema"] {
    return {
      "~standard": {
        version: 1,
        vendor: "optique-test",
        validate(input: unknown) {
          return {
            value: input as PromptConfigData,
          };
        },
      },
    };
  }

  describe("mode", () => {
    it("always returns an async-mode parser", () => {
      const parser = prompt(option("--name", string()), {
        type: "input",
        message: "Enter name:",
        prompter: () => Promise.resolve("Alice"),
      });

      assert.equal(parser.$mode, "async");
    });

    it("returns async even when inner parser is sync", () => {
      const parser = prompt(flag("--verbose"), {
        type: "confirm",
        message: "Verbose?",
        prompter: () => Promise.resolve(true),
      });

      assert.equal(parser.$mode, "async");
    });
  });

  describe("CLI priority", () => {
    it("uses CLI value when provided (string)", async () => {
      const parser = prompt(option("--name", string()), {
        type: "input",
        message: "Enter name:",
        prompter: () =>
          Promise.reject(new Error("Prompt should not be called")),
      });

      const result = await parseAsync(parser, ["--name", "Alice"]);
      assert.ok(result.success);
      assert.equal(result.value, "Alice");
    });

    it("uses CLI value when provided (boolean flag)", async () => {
      const parser = prompt(flag("--verbose"), {
        type: "confirm",
        message: "Verbose?",
        prompter: () =>
          Promise.reject(new Error("Prompt should not be called")),
      });

      const result = await parseAsync(parser, ["--verbose"]);
      assert.ok(result.success);
      assert.ok(result.value);
    });

    it("uses CLI value when provided (number)", async () => {
      const parser = prompt(option("--port", integer()), {
        type: "number",
        message: "Enter port:",
        prompter: () =>
          Promise.reject(new Error("Prompt should not be called")),
      });

      const result = await parseAsync(parser, ["--port", "8080"]);
      assert.ok(result.success);
      assert.equal(result.value, 8080);
    });

    it("uses CLI values when provided for multiple()", async () => {
      const parser = prompt(multiple(option("--tag", string())), {
        type: "checkbox",
        message: "Select tags:",
        choices: ["a", "b", "c"],
        prompter: () =>
          Promise.reject(new Error("Prompt should not be called")),
      });

      const result = await parseAsync(parser, [
        "--tag",
        "a",
        "--tag",
        "c",
      ]);
      assert.ok(result.success);
      assert.deepEqual(result.value, ["a", "c"]);
    });
  });

  describe("prompt fallback", () => {
    it("runs prompt when CLI value is absent (input)", async () => {
      const parser = prompt(option("--name", string()), {
        type: "input",
        message: "Enter name:",
        prompter: () => Promise.resolve("Bob"),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "Bob");
    });

    it("runs prompt when CLI value is absent (confirm)", async () => {
      const parser = prompt(flag("--verbose"), {
        type: "confirm",
        message: "Verbose?",
        prompter: () => Promise.resolve(false),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.ok(!result.value);
    });

    it("runs prompt when CLI value is absent (number)", async () => {
      const parser = prompt(option("--port", integer()), {
        type: "number",
        message: "Enter port:",
        prompter: () => Promise.resolve(3000),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, 3000);
    });

    it("runs prompt when CLI value is absent (password)", async () => {
      const parser = prompt(option("--key", string()), {
        type: "password",
        message: "Enter key:",
        prompter: () => Promise.resolve("s3cr3t"),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "s3cr3t");
    });

    it("runs prompt when CLI value is absent (editor)", async () => {
      const parser = prompt(option("--body", string()), {
        type: "editor",
        message: "Enter body:",
        prompter: () => Promise.resolve("Hello, world!"),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "Hello, world!");
    });

    it("runs prompt when CLI value is absent (select)", async () => {
      const parser = prompt(option("--color", string()), {
        type: "select",
        message: "Choose color:",
        choices: ["red", "green", "blue"],
        prompter: () => Promise.resolve("green"),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "green");
    });

    it("runs prompt when CLI value is absent (rawlist)", async () => {
      const parser = prompt(option("--env", string()), {
        type: "rawlist",
        message: "Choose environment:",
        choices: ["dev", "staging", "prod"],
        prompter: () => Promise.resolve("staging"),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "staging");
    });

    it("runs prompt when CLI value is absent (expand)", async () => {
      const parser = prompt(option("--level", string()), {
        type: "expand",
        message: "Choose log level:",
        choices: [
          { value: "debug", key: "d" },
          { value: "info", key: "i" },
          { value: "error", key: "e" },
        ],
        prompter: () => Promise.resolve("info"),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "info");
    });

    it("runs prompt when CLI value is absent (checkbox)", async () => {
      const parser = prompt(multiple(option("--tag", string())), {
        type: "checkbox",
        message: "Select tags:",
        choices: ["a", "b", "c"],
        prompter: () => Promise.resolve(["a", "c"]),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.deepEqual(result.value, ["a", "c"]);
    });
  });

  describe("prompt-only values via fail()", () => {
    it("supports prompt-only string values (fail + prompt)", async () => {
      const parser = prompt(fail<string>(), {
        type: "input",
        message: "Enter name:",
        prompter: () => Promise.resolve("Charlie"),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "Charlie");
    });

    it("supports prompt-only boolean values (fail + confirm)", async () => {
      const parser = prompt(fail<boolean>(), {
        type: "confirm",
        message: "Accept terms?",
        prompter: () => Promise.resolve(true),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.ok(result.value);
    });

    it("supports prompt-only number values (fail + number)", async () => {
      const parser = prompt(fail<number>(), {
        type: "number",
        message: "Enter count:",
        prompter: () => Promise.resolve(42),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, 42);
    });
  });

  describe("optional() wrapping", () => {
    it("uses CLI value when optional() is provided", async () => {
      const parser = prompt(optional(option("--name", string())), {
        type: "input",
        message: "Enter name:",
        prompter: () =>
          Promise.reject(new Error("Prompt should not be called")),
      });

      const result = await parseAsync(parser, ["--name", "David"]);
      assert.ok(result.success);
      assert.equal(result.value, "David");
    });

    it("prompts when optional() CLI value is absent", async () => {
      const parser = prompt(optional(option("--name", string())), {
        type: "input",
        message: "Enter name:",
        prompter: () => Promise.resolve("Eve"),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "Eve");
    });

    it("still prompts for optional() under annotations", async () => {
      const marker = Symbol.for("@test/prompt-optional-annotations");
      let promptCalls = 0;

      const parser = prompt(optional(option("--name", string())), {
        type: "input",
        message: "Enter name:",
        prompter: () => {
          promptCalls += 1;
          return Promise.resolve("Eve");
        },
      });

      const result = await parseAsync(parser, [], {
        annotations: { [marker]: "annotated" } satisfies Annotations,
      });

      assert.ok(result.success);
      assert.equal(result.value, "Eve");
      assert.equal(promptCalls, 1);
    });
  });

  describe("error handling", () => {
    it("keeps valid overrides working with unrelated invalid entries", async () => {
      await withPromptFunctionsOverride(
        {
          input: () => Promise.resolve("override value"),
          confirm: "not a function",
        },
        async () => {
          const parser = prompt(fail<string>(), {
            type: "input",
            message: "Enter name:",
          });

          const result = await parseAsync(parser, []);
          assert.ok(result.success);
          assert.equal(result.value, "override value");
        },
      );
    });

    it("propagates parse failure when inner parser consumed tokens", async () => {
      const parser = prompt(option("--port", integer()), {
        type: "number",
        message: "Enter port:",
        prompter: () =>
          Promise.reject(new Error("Prompt should not be called")),
      });

      // --port without a value: inner parser consumes the token and fails.
      // prompt() must propagate the failure, not fall back to the prompt.
      const result = await parseAsync(parser, ["--port"]);
      assert.ok(!result.success);
      const errorText = result.error
        .map((s: Record<string, unknown>) => "text" in s ? s.text : "")
        .join("");
      assert.ok(
        errorText.includes("requires a value"),
        `Expected "requires a value" in error, got: ${
          JSON.stringify(result.error)
        }`,
      );
    });

    it("returns failure when number prompter returns undefined", async () => {
      const parser = prompt(fail<number>(), {
        type: "number",
        message: "Enter number:",
        prompter: () => Promise.resolve(undefined),
      });

      const result = await parseAsync(parser, []);
      assert.ok(!result.success);
    });

    it("converts ExitPromptError into a parse failure", async () => {
      await withPromptFunctionsOverride(
        {
          input: () => {
            const error = new Error("User cancelled the prompt.");
            error.name = "ExitPromptError";
            throw error;
          },
        },
        async () => {
          const parser = prompt(fail<string>(), {
            type: "input",
            message: "Enter name:",
          });

          const result = await parseAsync(parser, []);
          assert.ok(!result.success);
          const errorText = result.error
            .map((s: Record<string, unknown>) => "text" in s ? s.text : "")
            .join("");
          assert.ok(
            errorText.includes("Prompt cancelled."),
            `Expected prompt cancellation error, got: ${
              JSON.stringify(result.error)
            }`,
          );
        },
      );
    });

    it("rethrows prompt validation failures from input prompts", async () => {
      await withPromptFunctionsOverride(
        {
          input: async (config: {
            readonly validate?: (
              value: string,
            ) => boolean | string | Promise<boolean | string>;
          }) => {
            const validation = await config.validate?.("");
            if (validation !== true) {
              throw new Error(String(validation));
            }
            return "ok";
          },
        },
        async () => {
          const parser = prompt(fail<string>(), {
            type: "input",
            message: "Enter name:",
            validate: (value) => value.length > 0 || "Name is required.",
          });

          await assert.rejects(
            () => parseAsync(parser, []),
            /Name is required\./,
          );
        },
      );
    });

    it("rethrows prompt validation failures from password prompts", async () => {
      await withPromptFunctionsOverride(
        {
          password: async (config: {
            readonly validate?: (
              value: string,
            ) => boolean | string | Promise<boolean | string>;
          }) => {
            const validation = await config.validate?.("");
            if (validation !== true) {
              throw new Error(String(validation));
            }
            return "ok";
          },
        },
        async () => {
          const parser = prompt(fail<string>(), {
            type: "password",
            message: "Enter secret:",
            validate: (value) => value.length > 0 || "Secret is required.",
          });

          await assert.rejects(
            () => parseAsync(parser, []),
            /Secret is required\./,
          );
        },
      );
    });

    it("rethrows prompt validation failures from editor prompts", async () => {
      await withPromptFunctionsOverride(
        {
          editor: async (config: {
            readonly validate?: (
              value: string,
            ) => boolean | string | Promise<boolean | string>;
          }) => {
            const validation = await config.validate?.("");
            if (validation !== true) {
              throw new Error(String(validation));
            }
            return "ok";
          },
        },
        async () => {
          const parser = prompt(fail<string>(), {
            type: "editor",
            message: "Enter body:",
            validate: (value) => value.length > 0 || "Body is required.",
          });

          await assert.rejects(
            () => parseAsync(parser, []),
            /Body is required\./,
          );
        },
      );
    });
  });

  describe("object() composition", () => {
    it("handles multiple prompt fields in object()", async () => {
      let promptCallCount = 0;
      const nameParser = prompt(option("--name", string()), {
        type: "input",
        message: "Enter name:",
        prompter: () => {
          promptCallCount++;
          return Promise.resolve("Frank");
        },
      });
      const portParser = prompt(option("--port", integer()), {
        type: "number",
        message: "Enter port:",
        prompter: () => {
          promptCallCount++;
          return Promise.resolve(9000);
        },
      });

      const parser = object({ name: nameParser, port: portParser });
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value.name, "Frank");
      assert.equal(result.value.port, 9000);
      assert.equal(promptCallCount, 2);
    });

    it("skips prompt when CLI value is provided in object()", async () => {
      const nameParser = prompt(option("--name", string()), {
        type: "input",
        message: "Enter name:",
        prompter: () => Promise.resolve("Prompted"),
      });
      const portParser = prompt(option("--port", integer()), {
        type: "number",
        message: "Enter port:",
        prompter: () =>
          Promise.reject(new Error("Port prompt should not be called")),
      });

      const parser = object({ name: nameParser, port: portParser });
      const result = await parseAsync(parser, ["--port", "8080"]);
      assert.ok(result.success);
      assert.equal(result.value.name, "Prompted");
      assert.equal(result.value.port, 8080);
    });

    it("preserves inner parser state across object() iterations", async () => {
      const portParser = prompt(option("--port", integer()), {
        type: "number",
        message: "Enter port:",
        prompter: () => Promise.resolve(3000),
      });

      const parser = object({ port: portParser });

      // --port provided twice: inner parser should detect the duplicate.
      const result = await parseAsync(parser, [
        "--port",
        "8080",
        "--port",
        "9090",
      ]);
      assert.ok(!result.success);
    });

    it("prompts for prompt(optional(...)) inside object() when CLI absent", async () => {
      let promptCalled = false;
      const parser = object({
        name: prompt(optional(option("--name", string())), {
          type: "input",
          message: "Enter name:",
          prompter: () => {
            promptCalled = true;
            return Promise.resolve("prompted");
          },
        }),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value.name, "prompted");
      assert.ok(promptCalled, "Prompt should have been called");
    });

    it("prompts for prompt(withDefault(...)) inside object() when CLI absent", async () => {
      let promptCalled = false;
      const parser = object({
        name: prompt(withDefault(option("--name", string()), "default"), {
          type: "input",
          message: "Enter name:",
          prompter: () => {
            promptCalled = true;
            return Promise.resolve("prompted");
          },
        }),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value.name, "prompted");
      assert.ok(promptCalled, "Prompt should have been called");
    });

    it("uses CLI value for prompt(optional(...)) inside object()", async () => {
      const parser = object({
        name: prompt(optional(option("--name", string())), {
          type: "input",
          message: "Enter name:",
          prompter: () =>
            Promise.reject(new Error("Prompt should not be called")),
        }),
      });

      const result = await parseAsync(parser, ["--name", "cli-value"]);
      assert.ok(result.success);
      assert.equal(result.value.name, "cli-value");
    });

    it("uses CLI value for prompt(withDefault(...)) inside object()", async () => {
      const parser = object({
        name: prompt(withDefault(option("--name", string()), "default"), {
          type: "input",
          message: "Enter name:",
          prompter: () =>
            Promise.reject(new Error("Prompt should not be called")),
        }),
      });

      const result = await parseAsync(parser, ["--name", "cli-value"]);
      assert.ok(result.success);
      assert.equal(result.value.name, "cli-value");
    });
  });

  describe("usage", () => {
    it("wraps inner parser usage as optional", () => {
      const parser = prompt(option("--name", string()), {
        type: "input",
        message: "Enter name:",
        prompter: () => Promise.resolve(""),
      });

      // The usage should be wrapped in an 'optional' term since prompt()
      // handles the missing-value case interactively.
      const usage = parser.usage;
      assert.equal(usage.length, 1);
      assert.equal((usage[0] as { type: string }).type, "optional");
    });

    it("fail() with prompt has empty optional usage", () => {
      const parser = prompt(fail<string>(), {
        type: "input",
        message: "Enter name:",
        prompter: () => Promise.resolve(""),
      });

      const usage = parser.usage;
      // fail() has empty usage; optional wrapper around empty is still empty-ish
      assert.equal(usage.length, 1);
      assert.equal((usage[0] as { type: string }).type, "optional");
      const terms = (usage[0] as unknown as { terms: unknown[] }).terms;
      assert.deepEqual(terms, []);
      // NOSONAR: The cast above uses 'unknown' as an intermediate for intentional narrowing.
    });
  });

  describe("consumed-token detection", () => {
    it("only marks hasCliValue when inner parser consumed tokens", async () => {
      // A mock parser that always succeeds with consumed: [] (like bindConfig
      // or withDefault returning a value without consuming CLI tokens).
      // prompt() should NOT treat this as a CLI value.
      let promptCalled = false;
      const parser = prompt(option("--name", string()), {
        type: "input",
        message: "Enter name:",
        prompter: () => {
          promptCalled = true;
          return Promise.resolve("prompted-value");
        },
      });

      // No --name provided: inner parser returns consumed: [], so hasCliValue=false.
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.ok(promptCalled, "Prompt should have been called");
      assert.equal(result.value, "prompted-value");
    });
  });

  describe("composition with non-CLI sources", () => {
    it("skips prompt when bindEnv() supplies a value", async () => {
      // Regression: prompt(bindEnv(...)) must not prompt the user when the
      // environment variable is set; the env value should be used instead.
      const context = createEnvContext({
        source: (key) => ({ APP_NAME: "env-value" })[key],
        prefix: "APP_",
      });
      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const parser = prompt(
        bindEnv(option("--name", string()), {
          context,
          key: "NAME",
          parser: string(),
        }),
        {
          type: "input",
          message: "Enter name:",
          prompter: () =>
            Promise.reject(new Error("Prompt should not be called")),
        },
      );

      const result = await parseAsync(parser, [], { annotations });
      assert.ok(result.success);
      assert.equal(result.value, "env-value");
    });

    it("skips prompt in object() when bindEnv() supplies a value", async () => {
      // Regression: same as above but in object(), where complete() is
      // called twice (completability check + real complete phase).
      const context = createEnvContext({
        source: (key) => ({ APP_NAME: "env-name" })[key],
        prefix: "APP_",
      });
      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const parser = object({
        name: prompt(
          bindEnv(option("--name", string()), {
            context,
            key: "NAME",
            parser: string(),
          }),
          {
            type: "input",
            message: "Enter name:",
            prompter: () =>
              Promise.reject(new Error("Prompt should not be called")),
          },
        ),
      });

      const result = await parseAsync(parser, [], { annotations });
      assert.ok(result.success);
      assert.equal(result.value.name, "env-name");
    });

    it("skips prompt when bindEnv(bindConfig(...)) resolves from config", async () => {
      const envContext = createEnvContext({
        source: () => undefined,
      });
      const configContext = createConfigContext({
        schema: createPromptConfigSchema(),
      });
      let promptCalls = 0;
      const parser = prompt(
        bindEnv(
          bindConfig(option("--api-key", string()), {
            context: configContext,
            key: "apiKey",
          }),
          {
            context: envContext,
            key: "API_KEY",
            parser: string(),
          },
        ),
        {
          type: "password",
          message: "API key:",
          prompter: () => {
            promptCalls += 1;
            return Promise.resolve("prompt-secret");
          },
        },
      );

      const result = await runWith(
        parser,
        "test",
        [envContext, configContext],
        {
          load: () => ({
            config: { apiKey: "config-secret" },
            meta: undefined,
          }),
          args: [],
        },
      );

      assert.equal(result, "config-secret");
      assert.equal(promptCalls, 0);
    });

    it("prompts when bindEnv() has no value and env var is absent", async () => {
      // prompt(bindEnv(...)) must fall back to the interactive prompt when
      // the CLI option is absent and the environment variable is not set.
      const context = createEnvContext({
        source: () => undefined,
        prefix: "APP_",
      });
      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const parser = prompt(
        bindEnv(option("--name", string()), {
          context,
          key: "NAME",
          parser: string(),
        }),
        {
          type: "input",
          message: "Enter name:",
          prompter: () => Promise.resolve("prompted-value"),
        },
      );

      const result = await parseAsync(parser, [], { annotations });
      assert.ok(result.success);
      assert.equal(result.value, "prompted-value");
    });

    it("skips prompt when standalone bindEnv(flag(...)) supplies a value", async () => {
      const context = createEnvContext({
        source: (key) => ({ APP_VERBOSE: "yes" })[key],
        prefix: "APP_",
      });
      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const parser = prompt(
        bindEnv(flag("--verbose"), {
          context,
          key: "VERBOSE",
          parser: bool(),
          default: false,
        }),
        {
          type: "confirm",
          message: "Verbose?",
          prompter: () =>
            Promise.reject(new Error("Prompt should not be called")),
        },
      );

      const result = await parseAsync(parser, [], { annotations });
      assert.ok(result.success);
      assert.equal(result.value, true);
    });

    it("prompts when standalone bindEnv(flag(...)) has no env value", async () => {
      const context = createEnvContext({
        source: () => undefined,
        prefix: "APP_",
      });
      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const parser = prompt(
        bindEnv(flag("--verbose"), {
          context,
          key: "VERBOSE",
          parser: bool(),
        }),
        {
          type: "confirm",
          message: "Verbose?",
          prompter: () => Promise.resolve(true),
        },
      );

      const result = await parseAsync(parser, [], { annotations });
      assert.ok(result.success);
      assert.equal(result.value, true);
    });

    for (
      const [label, config, expectedValue, expectedPromptCalls] of [
        [
          "skips the prompt when runWith() resolves a config value in phase 2",
          { apiKey: "config-secret" } satisfies PromptConfigData,
          "config-secret",
          0,
        ],
        [
          "runs the prompt once when runWith() finds no config value in phase 2",
          {} satisfies PromptConfigData,
          "prompt-secret",
          1,
        ],
      ] as const
    ) {
      it(label, async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });
        let promptCalls = 0;
        const parser = prompt(
          bindConfig(option("--api-key", string()), {
            context,
            key: "apiKey",
          }),
          {
            type: "password",
            message: "API key:",
            prompter: () => {
              promptCalls += 1;
              return Promise.resolve("prompt-secret");
            },
          },
        );

        const result = await runWith(parser, "test", [context], {
          load: () => ({ config, meta: undefined }),
          args: [],
        });

        assert.equal(result, expectedValue);
        assert.equal(promptCalls, expectedPromptCalls);
      });
    }

    for (
      const [label, config, expectedValue, expectedPromptCalls] of [
        [
          "skips the prompt in object() when runAsync() resolves a config value in phase 2",
          { apiKey: "config-secret" } satisfies PromptConfigData,
          "config-secret",
          0,
        ],
        [
          "runs the prompt once in object() when runAsync() finds no config value in phase 2",
          {} satisfies PromptConfigData,
          "prompt-secret",
          1,
        ],
      ] as const
    ) {
      it(label, async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });
        let promptCalls = 0;
        const parser = object({
          apiKey: prompt(
            bindConfig(option("--api-key", string()), {
              context,
              key: "apiKey",
            }),
            {
              type: "password",
              message: "API key:",
              prompter: () => {
                promptCalls += 1;
                return Promise.resolve("prompt-secret");
              },
            },
          ),
        });

        const result = await runAsync(parser, {
          programName: "test",
          args: [],
          contexts: [context],
          load: () => ({ config, meta: undefined }),
        });

        assert.equal(result.apiKey, expectedValue);
        assert.equal(promptCalls, expectedPromptCalls);
      });
    }

    it("keeps non-config prompts available to other phase-two contexts", async () => {
      let phase2Parsed: { readonly config: string } | undefined;
      const dynamicContext: SourceContext = {
        id: Symbol.for("@test/prompt-phase-two"),
        mode: "dynamic",
        getAnnotations(parsed?: unknown) {
          if (parsed === undefined) {
            return {};
          }
          phase2Parsed = parsed as { readonly config: string };
          return {};
        },
      };
      let promptCalls = 0;
      const parser = object({
        config: prompt(option("--config", string()), {
          type: "input",
          message: "Config path:",
          prompter: () => {
            promptCalls += 1;
            return Promise.resolve("prompt-config.json");
          },
        }),
      });

      const result = await runWith(parser, "test", [dynamicContext], {
        args: [],
      });

      assert.deepEqual(phase2Parsed, { config: "prompt-config.json" });
      assert.deepEqual(result, { config: "prompt-config.json" });
      assert.equal(promptCalls, 2);
    });

    it(
      "hides deferred config-backed prompts from other phase-two contexts",
      async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });
        let phase2Parsed: { readonly apiKey?: string | undefined } | undefined;
        const dynamicContext: SourceContext = {
          id: Symbol.for("@test/config-prompt-phase-two"),
          mode: "dynamic",
          getAnnotations(parsed?: unknown) {
            if (parsed === undefined) {
              return {};
            }
            phase2Parsed = parsed as {
              readonly apiKey?: string | undefined;
            };
            return {};
          },
        };
        const parser = object({
          apiKey: prompt(
            bindConfig(option("--api-key", string()), {
              context,
              key: "apiKey",
            }),
            {
              type: "password",
              message: "API key:",
              prompter: () => Promise.resolve("prompt-secret"),
            },
          ),
        });

        const result = await runWith(
          parser,
          "test",
          [dynamicContext, context],
          {
            args: [],
            load: () => ({
              config: { apiKey: "config-secret" },
              meta: undefined,
            }),
          },
        );

        assert.deepEqual(phase2Parsed, { apiKey: undefined });
        assert.deepEqual(result, { apiKey: "config-secret" });
      },
    );

    it(
      "hides top-level deferred prompts from other phase-two contexts",
      async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });
        let sawUndefined = false;
        const dynamicContext: SourceContext = {
          id: Symbol.for("@test/top-level-config-prompt-phase-two"),
          mode: "dynamic",
          getAnnotations(parsed?: unknown) {
            sawUndefined = parsed === undefined;
            return {};
          },
        };
        const parser = prompt(
          bindConfig(option("--api-key", string()), {
            context,
            key: "apiKey",
          }),
          {
            type: "password",
            message: "API key:",
            prompter: () => Promise.resolve("prompt-secret"),
          },
        );

        const result = await runWith(
          parser,
          "test",
          [dynamicContext, context],
          {
            args: [],
            load: () => ({
              config: { apiKey: "config-secret" },
              meta: undefined,
            }),
          },
        );

        assert.ok(sawUndefined);
        assert.equal(result, "config-secret");
      },
    );

    it(
      "hides deferred prompt values inside non-plain phase-two context inputs",
      async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });

        class ConfigInput {
          constructor(readonly apiKey: string | undefined) {}
        }

        let phase2Parsed: ConfigInput | undefined;
        const dynamicContext: SourceContext = {
          id: Symbol.for("@test/non-plain-phase-two"),
          mode: "dynamic",
          getAnnotations(parsed?: unknown) {
            if (parsed !== undefined) {
              phase2Parsed = parsed as ConfigInput;
            }
            return {};
          },
        };

        const parser = map(
          object({
            apiKey: prompt(
              bindConfig(option("--api-key", string()), {
                context,
                key: "apiKey",
              }),
              {
                type: "password",
                message: "API key:",
                prompter: () => Promise.resolve("prompt-secret"),
              },
            ),
          }),
          (value) => new ConfigInput(value.apiKey),
        );

        const result = await runWith(
          parser,
          "test",
          [dynamicContext, context],
          {
            args: [],
            load: () => ({
              config: { apiKey: "config-secret" },
              meta: undefined,
            }),
          },
        );

        assert.ok(phase2Parsed instanceof ConfigInput);
        assert.equal(phase2Parsed.apiKey, undefined);
        assert.ok(result instanceof ConfigInput);
        assert.equal(result.apiKey, "config-secret");
      },
    );

    it("hides deferred prompt values inside Set phase-two context inputs", async () => {
      const context = createConfigContext({
        schema: createPromptConfigSchema(),
      });

      let phase2Values: readonly unknown[] | undefined;
      const dynamicContext: SourceContext = {
        id: Symbol.for("@test/set-phase-two"),
        mode: "dynamic",
        getAnnotations(parsed?: unknown) {
          if (parsed instanceof Set) {
            phase2Values = [...parsed];
          }
          return {};
        },
      };

      const parser = map(
        object({
          apiKey: prompt(
            bindConfig(option("--api-key", string()), {
              context,
              key: "apiKey",
            }),
            {
              type: "password",
              message: "API key:",
              prompter: () => Promise.resolve("prompt-secret"),
            },
          ),
        }),
        (value) => new Set([value.apiKey]),
      );

      const result = await runWith(parser, "test", [dynamicContext, context], {
        args: [],
        load: () => ({
          config: { apiKey: "config-secret" },
          meta: undefined,
        }),
      });

      assert.deepEqual(phase2Values, [undefined]);
      assert.ok(result instanceof Set);
      assert.deepEqual([...result], ["config-secret"]);
    });

    it(
      "hides deferred prompt values in Set own properties during phase two",
      async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });

        class BoxSet extends Set<string | undefined> {
          apiKey: string | undefined;

          constructor(value: string | undefined) {
            super([value]);
            this.apiKey = value;
          }
        }

        let phase2WasBoxSet = false;
        let phase2ApiKey: string | undefined;
        const dynamicContext: SourceContext = {
          id: Symbol.for("@test/set-own-prop-phase-two"),
          mode: "dynamic",
          getAnnotations(parsed?: unknown) {
            if (parsed instanceof BoxSet) {
              phase2WasBoxSet = true;
              phase2ApiKey = parsed.apiKey;
            }
            return {};
          },
        };

        const parser = map(
          object({
            apiKey: prompt(
              bindConfig(option("--api-key", string()), {
                context,
                key: "apiKey",
              }),
              {
                type: "password",
                message: "API key:",
                prompter: () => Promise.resolve("prompt-secret"),
              },
            ),
          }),
          (value) => new BoxSet(value.apiKey),
        );

        const result = await runWith(
          parser,
          "test",
          [dynamicContext, context],
          {
            args: [],
            load: () => ({
              config: { apiKey: "config-secret" },
              meta: undefined,
            }),
          },
        );

        assert.ok(phase2WasBoxSet);
        assert.equal(phase2ApiKey, undefined);
        assert.ok(result instanceof BoxSet);
        assert.equal(result.apiKey, "config-secret");
      },
    );

    it("keeps nested clean collection subclasses unproxied in phase two", async () => {
      const context = createConfigContext({
        schema: createPromptConfigSchema(),
      });

      class BoxSet extends Set<string> {}

      const cleanSet = new BoxSet(["clean"]);
      let phase2Set: BoxSet | undefined;
      const dynamicContext: SourceContext = {
        id: Symbol.for("@test/nested-clean-collection-phase-two"),
        mode: "dynamic",
        getAnnotations(parsed?: unknown) {
          if (parsed != null && typeof parsed === "object") {
            phase2Set = (parsed as { readonly clean: BoxSet }).clean;
          }
          return {};
        },
      };

      const parser = map(
        object({
          apiKey: prompt(
            bindConfig(option("--api-key", string()), {
              context,
              key: "apiKey",
            }),
            {
              type: "password",
              message: "API key:",
              prompter: () => Promise.resolve("prompt-secret"),
            },
          ),
        }),
        (value) => ({ clean: cleanSet, apiKey: value.apiKey }),
      );

      const result = await runWith(
        parser,
        "test",
        [dynamicContext, context],
        {
          args: [],
          load: () => ({
            config: { apiKey: "config-secret" },
            meta: undefined,
          }),
        },
      );

      assert.ok(phase2Set instanceof BoxSet);
      assert.equal(phase2Set, cleanSet);
      assert.equal(result.clean, cleanSet);
      assert.equal(result.apiKey, "config-secret");
    });

    it("keeps nested clean non-plain values unproxied in phase two", async () => {
      const context = createConfigContext({
        schema: createPromptConfigSchema(),
      });

      class CleanBox {
        #value: string;

        constructor(value: string) {
          this.#value = value;
        }

        getValue(): string {
          return this.#value;
        }
      }

      const cleanBox = new CleanBox("clean");
      let phase2Box: CleanBox | undefined;
      let phase2Value: string | undefined;
      const dynamicContext: SourceContext = {
        id: Symbol.for("@test/nested-clean-non-plain-phase-two"),
        mode: "dynamic",
        getAnnotations(parsed?: unknown) {
          if (parsed != null && typeof parsed === "object") {
            phase2Box = (parsed as { readonly clean: CleanBox }).clean;
            phase2Value = phase2Box.getValue();
          }
          return {};
        },
      };

      const parser = map(
        object({
          apiKey: prompt(
            bindConfig(option("--api-key", string()), {
              context,
              key: "apiKey",
            }),
            {
              type: "password",
              message: "API key:",
              prompter: () => Promise.resolve("prompt-secret"),
            },
          ),
        }),
        (value) => ({ clean: cleanBox, apiKey: value.apiKey }),
      );

      const result = await runWith(
        parser,
        "test",
        [dynamicContext, context],
        {
          args: [],
          load: () => ({
            config: { apiKey: "config-secret" },
            meta: undefined,
          }),
        },
      );

      assert.equal(phase2Box, cleanBox);
      assert.equal(phase2Value, "clean");
      assert.equal(result.clean, cleanBox);
      assert.equal(result.apiKey, "config-secret");
    });

    it(
      "hides deferred prompt values inside nested non-plain phase-two inputs",
      async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });

        class InnerInput {
          constructor(readonly apiKey: string | undefined) {}
        }

        let phase2ApiKey: string | undefined;
        const dynamicContext: SourceContext = {
          id: Symbol.for("@test/nested-non-plain-phase-two"),
          mode: "dynamic",
          getAnnotations(parsed?: unknown) {
            if (parsed != null && typeof parsed === "object") {
              phase2ApiKey = (
                parsed as { readonly inner: InnerInput }
              ).inner.apiKey;
            }
            return {};
          },
        };

        const parser = map(
          object({
            apiKey: prompt(
              bindConfig(option("--api-key", string()), {
                context,
                key: "apiKey",
              }),
              {
                type: "password",
                message: "API key:",
                prompter: () => Promise.resolve("prompt-secret"),
              },
            ),
          }),
          (value) => ({ inner: new InnerInput(value.apiKey) }),
        );

        const result = await runWith(
          parser,
          "test",
          [dynamicContext, context],
          {
            args: [],
            load: () => ({
              config: { apiKey: "config-secret" },
              meta: undefined,
            }),
          },
        );

        assert.equal(phase2ApiKey, undefined);
        assert.equal(result.inner.apiKey, "config-secret");
      },
    );

    it("hides top-level deferred prompt values from config loaders", async () => {
      const context = createConfigContext({
        schema: createPromptConfigSchema(),
      });
      let loaderParsed: string | undefined;
      const parser = prompt(
        bindConfig(option("--api-key", string()), {
          context,
          key: "apiKey",
        }),
        {
          type: "password",
          message: "API key:",
          prompter: () => Promise.resolve("prompt-secret"),
        },
      );

      const result = await runWith(parser, "test", [context], {
        args: [],
        load: (parsed) => {
          loaderParsed = parsed as string | undefined;
          return {
            config: { apiKey: "config-secret" },
            meta: undefined,
          };
        },
      });

      assert.equal(loaderParsed, undefined);
      assert.equal(result, "config-secret");
    });

    it("hides deferred config-backed prompt values from config loaders", async () => {
      const context = createConfigContext({
        schema: createPromptConfigSchema(),
      });
      let loaderParsed: { readonly apiKey?: string | undefined } | undefined;
      const parser = object({
        apiKey: prompt(
          bindConfig(option("--api-key", string()), {
            context,
            key: "apiKey",
          }),
          {
            type: "password",
            message: "API key:",
            prompter: () => Promise.resolve("prompt-secret"),
          },
        ),
      });

      const result = await runWith(parser, "test", [context], {
        args: [],
        load: (parsed) => {
          loaderParsed = parsed as { readonly apiKey?: string | undefined };
          return {
            config: { apiKey: "config-secret" },
            meta: undefined,
          };
        },
      });

      assert.deepEqual(loaderParsed, { apiKey: undefined });
      assert.deepEqual(result, { apiKey: "config-secret" });
    });

    it(
      "reuses scrubbed phase-two parsed identity across contexts and loaders",
      async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });
        const metadataByParsed = new WeakMap<object, string>();
        const identityContext: SourceContext = {
          id: Symbol.for("@test/scrubbed-phase-two-identity"),
          mode: "dynamic",
          getAnnotations(parsed?: unknown) {
            if (parsed != null && typeof parsed === "object") {
              metadataByParsed.set(parsed as object, "seen");
            }
            return {};
          },
        };
        let loaderMetadata: string | undefined;
        const parser = object({
          apiKey: prompt(
            bindConfig(option("--api-key", string()), {
              context,
              key: "apiKey",
            }),
            {
              type: "password",
              message: "API key:",
              prompter: () => Promise.resolve("prompt-secret"),
            },
          ),
        });

        const result = await runWith(
          parser,
          "test",
          [identityContext, context],
          {
            args: [],
            load: (parsed) => {
              loaderMetadata = metadataByParsed.get(parsed as object);
              return {
                config: { apiKey: "config-secret" },
                meta: undefined,
              };
            },
          },
        );

        assert.equal(loaderMetadata, "seen");
        assert.deepEqual(result, { apiKey: "config-secret" });
      },
    );

    it("hides deferred prompt values inside Set loader inputs", async () => {
      const context = createConfigContext({
        schema: createPromptConfigSchema(),
      });
      let loaderValues: readonly unknown[] | undefined;
      const parser = map(
        object({
          apiKey: prompt(
            bindConfig(option("--api-key", string()), {
              context,
              key: "apiKey",
            }),
            {
              type: "password",
              message: "API key:",
              prompter: () => Promise.resolve("prompt-secret"),
            },
          ),
        }),
        (value) => new Set([value.apiKey]),
      );

      const result = await runWith(parser, "test", [context], {
        args: [],
        load: (parsed) => {
          if (parsed instanceof Set) {
            loaderValues = [...parsed];
          }
          return {
            config: { apiKey: "config-secret" },
            meta: undefined,
          };
        },
      });

      assert.deepEqual(loaderValues, [undefined]);
      assert.ok(result instanceof Set);
      assert.deepEqual([...result], ["config-secret"]);
    });

    it("hides deferred prompt values in Set own properties for config loaders", async () => {
      const context = createConfigContext({
        schema: createPromptConfigSchema(),
      });

      class BoxSet extends Set<string | undefined> {
        apiKey: string | undefined;

        constructor(value: string | undefined) {
          super([value]);
          this.apiKey = value;
        }
      }

      let loaderApiKey: string | undefined;
      const parser = map(
        object({
          apiKey: prompt(
            bindConfig(option("--api-key", string()), {
              context,
              key: "apiKey",
            }),
            {
              type: "password",
              message: "API key:",
              prompter: () => Promise.resolve("prompt-secret"),
            },
          ),
        }),
        (value) => new BoxSet(value.apiKey),
      );

      const result = await runWith(parser, "test", [context], {
        args: [],
        load: (parsed) => {
          if (parsed instanceof BoxSet) {
            loaderApiKey = parsed.apiKey;
          }
          return {
            config: { apiKey: "config-secret" },
            meta: undefined,
          };
        },
      });

      assert.equal(loaderApiKey, undefined);
      assert.ok(result instanceof BoxSet);
      assert.equal(result.apiKey, "config-secret");
    });
  });

  describe("prompt deferral through wrapper combinators", () => {
    for (
      const [label, config, expectedValue, expectedPromptCalls] of [
        [
          "optional(bindConfig(...)): skips the prompt when config resolves",
          { apiKey: "config-secret" } satisfies PromptConfigData,
          "config-secret",
          0,
        ],
        [
          "optional(bindConfig(...)): runs the prompt when config is absent",
          {} satisfies PromptConfigData,
          "prompt-secret",
          1,
        ],
      ] as const
    ) {
      it(label, async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });
        let promptCalls = 0;
        const parser = prompt(
          optional(
            bindConfig(option("--api-key", string()), {
              context,
              key: "apiKey",
            }),
          ),
          {
            type: "password",
            message: "API key:",
            prompter: () => {
              promptCalls += 1;
              return Promise.resolve("prompt-secret");
            },
          },
        );

        const result = await runWith(parser, "test", [context], {
          load: () => ({ config, meta: undefined }),
          args: [],
        });

        assert.equal(result, expectedValue);
        assert.equal(promptCalls, expectedPromptCalls);
      });
    }

    for (
      const [label, config, expectedValue, expectedPromptCalls] of [
        [
          "group(bindConfig(...)): skips the prompt when config resolves",
          { apiKey: "config-secret" } satisfies PromptConfigData,
          "config-secret",
          0,
        ],
        [
          "group(bindConfig(...)): runs the prompt when config is absent",
          {} satisfies PromptConfigData,
          "prompt-secret",
          1,
        ],
      ] as const
    ) {
      it(label, async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });
        let promptCalls = 0;
        const parser = prompt(
          group(
            "Auth",
            bindConfig(option("--api-key", string()), {
              context,
              key: "apiKey",
            }),
          ),
          {
            type: "password",
            message: "API key:",
            prompter: () => {
              promptCalls += 1;
              return Promise.resolve("prompt-secret");
            },
          },
        );

        const result = await runWith(parser, "test", [context], {
          load: () => ({ config, meta: undefined }),
          args: [],
        });

        assert.equal(result, expectedValue);
        assert.equal(promptCalls, expectedPromptCalls);
      });
    }

    for (
      const [label, config, expectedValue, expectedPromptCalls] of [
        [
          "map(bindConfig(...)): skips the prompt when config resolves",
          { apiKey: "config-secret" } satisfies PromptConfigData,
          "CONFIG-SECRET",
          0,
        ],
        [
          "map(bindConfig(...)): runs the prompt when config is absent",
          {} satisfies PromptConfigData,
          "prompt-secret",
          1,
        ],
      ] as const
    ) {
      it(label, async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });
        let promptCalls = 0;
        const parser = prompt(
          map(
            bindConfig(option("--api-key", string()), {
              context,
              key: "apiKey",
            }),
            (v) => v.toUpperCase(),
          ),
          {
            type: "password",
            message: "API key:",
            prompter: () => {
              promptCalls += 1;
              return Promise.resolve("prompt-secret");
            },
          },
        );

        const result = await runWith(parser, "test", [context], {
          load: () => ({ config, meta: undefined }),
          args: [],
        });

        assert.equal(result, expectedValue);
        assert.equal(promptCalls, expectedPromptCalls);
      });
    }

    for (
      const [label, config, expectedValue, expectedPromptCalls] of [
        [
          "withDefault(bindConfig(...)): skips the prompt when config resolves",
          { apiKey: "config-secret" } satisfies PromptConfigData,
          "config-secret",
          0,
        ],
        [
          "withDefault(bindConfig(...)): runs the prompt when config is absent",
          {} satisfies PromptConfigData,
          "prompt-secret",
          1,
        ],
      ] as const
    ) {
      it(label, async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });
        let promptCalls = 0;
        const parser = prompt(
          withDefault(
            bindConfig(option("--api-key", string()), {
              context,
              key: "apiKey",
            }),
            "fallback-default",
          ),
          {
            type: "password",
            message: "API key:",
            prompter: () => {
              promptCalls += 1;
              return Promise.resolve("prompt-secret");
            },
          },
        );

        const result = await runWith(parser, "test", [context], {
          load: () => ({ config, meta: undefined }),
          args: [],
        });

        assert.equal(result, expectedValue);
        assert.equal(promptCalls, expectedPromptCalls);
      });
    }

    for (
      const [label, config, expectedValue, expectedPromptCalls] of [
        [
          "object() + optional(bindConfig(...)): skips prompt when config resolves",
          { apiKey: "config-secret" } satisfies PromptConfigData,
          "config-secret",
          0,
        ],
        [
          "object() + optional(bindConfig(...)): runs prompt when config absent",
          {} satisfies PromptConfigData,
          "prompt-secret",
          1,
        ],
      ] as const
    ) {
      it(label, async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });
        let promptCalls = 0;
        const parser = object({
          apiKey: prompt(
            optional(
              bindConfig(option("--api-key", string()), {
                context,
                key: "apiKey",
              }),
            ),
            {
              type: "password",
              message: "API key:",
              prompter: () => {
                promptCalls += 1;
                return Promise.resolve("prompt-secret");
              },
            },
          ),
        });

        const result = await runAsync(parser, {
          programName: "test",
          args: [],
          contexts: [context],
          load: () => ({ config, meta: undefined }),
        });

        assert.equal(result.apiKey, expectedValue);
        assert.equal(promptCalls, expectedPromptCalls);
      });
    }

    for (
      const [label, config, expectedValue, expectedPromptCalls] of [
        [
          "object() + group(bindConfig(...)): skips prompt when config resolves",
          { apiKey: "config-secret" } satisfies PromptConfigData,
          "config-secret",
          0,
        ],
        [
          "object() + group(bindConfig(...)): runs prompt when config absent",
          {} satisfies PromptConfigData,
          "prompt-secret",
          1,
        ],
      ] as const
    ) {
      it(label, async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });
        let promptCalls = 0;
        const parser = object({
          apiKey: prompt(
            group(
              "Auth",
              bindConfig(option("--api-key", string()), {
                context,
                key: "apiKey",
              }),
            ),
            {
              type: "password",
              message: "API key:",
              prompter: () => {
                promptCalls += 1;
                return Promise.resolve("prompt-secret");
              },
            },
          ),
        });

        const result = await runAsync(parser, {
          programName: "test",
          args: [],
          contexts: [context],
          load: () => ({ config, meta: undefined }),
        });

        assert.equal(result.apiKey, expectedValue);
        assert.equal(promptCalls, expectedPromptCalls);
      });
    }

    for (
      const [label, config, expectedValue, expectedPromptCalls] of [
        [
          "object() + withDefault(bindConfig(...)): skips prompt when config resolves",
          { apiKey: "config-secret" } satisfies PromptConfigData,
          "config-secret",
          0,
        ],
        [
          "object() + withDefault(bindConfig(...)): runs prompt when config absent",
          {} satisfies PromptConfigData,
          "prompt-secret",
          1,
        ],
      ] as const
    ) {
      it(label, async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });
        let promptCalls = 0;
        const parser = object({
          apiKey: prompt(
            withDefault(
              bindConfig(option("--api-key", string()), {
                context,
                key: "apiKey",
              }),
              "fallback-default",
            ),
            {
              type: "password",
              message: "API key:",
              prompter: () => {
                promptCalls += 1;
                return Promise.resolve("prompt-secret");
              },
            },
          ),
        });

        const result = await runAsync(parser, {
          programName: "test",
          args: [],
          contexts: [context],
          load: () => ({ config, meta: undefined }),
        });

        assert.equal(result.apiKey, expectedValue);
        assert.equal(promptCalls, expectedPromptCalls);
      });
    }
  });

  describe("prompt config default", () => {
    it("prompt config default is passed through to usage (optional wrapper)", () => {
      const withDefault = prompt(option("--name", string()), {
        type: "input",
        message: "Enter name:",
        default: "Alice",
        prompter: () => Promise.resolve(""),
      });
      const withoutDefault = prompt(option("--count", integer()), {
        type: "number",
        message: "Enter count:",
        prompter: () => Promise.resolve(0),
      });

      // Both are wrapped as optional since prompt() handles missing values.
      assert.equal(withDefault.usage.length, 1);
      assert.equal((withDefault.usage[0] as { type: string }).type, "optional");
      assert.equal(withoutDefault.usage.length, 1);
      assert.equal(
        (withoutDefault.usage[0] as { type: string }).type,
        "optional",
      );
    });
  });

  describe("number prompt edge cases", () => {
    it("preserves min/max boundary values from the number prompter", async () => {
      const parser = prompt(fail<number>(), {
        type: "number",
        message: "Enter level:",
        min: -2,
        max: 4,
        prompter: () => Promise.resolve(-2),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, -2);
    });

    it("accepts negative numbers from the number prompter", async () => {
      const parser = prompt(fail<number>(), {
        type: "number",
        message: "Enter offset:",
        prompter: () => Promise.resolve(-42),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, -42);
    });

    it("passes decimal-friendly config through to number prompts", async () => {
      const calls: Array<Record<string, unknown>> = [];
      await withPromptFunctionsOverride(
        {
          number: (config: Record<string, unknown>) => {
            calls.push(config);
            return -1.25;
          },
        },
        async () => {
          const parser = prompt(fail<number>(), {
            type: "number",
            message: "Enter ratio:",
            min: -2,
            max: 2,
            step: "any",
          });

          const result = await parseAsync(parser, []);
          assert.ok(result.success);
          assert.equal(result.value, -1.25);
        },
      );

      assert.deepEqual(calls, [{
        message: "Enter ratio:",
        min: -2,
        max: 2,
        step: "any",
      }]);
    });
  });

  describe("select with Choice objects", () => {
    it("supports Choice objects in select choices", async () => {
      const parser = prompt(option("--color", string()), {
        type: "select",
        message: "Choose color:",
        choices: [
          { value: "red", name: "Red" },
          { value: "green", name: "Green" },
          { value: "blue", name: "Blue" },
        ],
        prompter: () => Promise.resolve("blue"),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "blue");
    });

    it("supports Choice objects in checkbox choices", async () => {
      const parser = prompt(multiple(option("--tag", string())), {
        type: "checkbox",
        message: "Select tags:",
        choices: [
          { value: "typescript", name: "TypeScript" },
          { value: "deno", name: "Deno" },
          { value: "node", name: "Node.js" },
        ],
        prompter: () => Promise.resolve(["typescript", "deno"]),
      });

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.deepEqual(result.value, ["typescript", "deno"]);
    });

    it("passes an empty choices array through unchanged", async () => {
      const calls: Array<Record<string, unknown>> = [];
      await withPromptFunctionsOverride(
        {
          select: (config: Record<string, unknown>) => {
            calls.push(config);
            return "";
          },
        },
        async () => {
          const parser = prompt(fail<string>(), {
            type: "select",
            message: "Choose color:",
            choices: [],
          });

          const result = await parseAsync(parser, []);
          assert.ok(result.success);
          assert.equal(result.value, "");
        },
      );

      assert.deepEqual(calls, [{
        message: "Choose color:",
        choices: [],
      }]);
    });

    it("preserves separator-only choice arrays", async () => {
      const calls: Array<Record<string, unknown>> = [];
      await withPromptFunctionsOverride(
        {
          checkbox: (config: Record<string, unknown>) => {
            calls.push(config);
            return [];
          },
        },
        async () => {
          const parser = prompt(fail<readonly string[]>(), {
            type: "checkbox",
            message: "Select tags:",
            choices: [new Separator("---"), new Separator("===")],
          });

          const result = await parseAsync(parser, []);
          assert.ok(result.success);
          assert.deepEqual(result.value, []);
        },
      );

      const choices = calls[0]?.choices as readonly unknown[] | undefined;
      assert.equal(choices?.length, 2);
      assert.ok(choices?.[0] instanceof Separator);
      assert.ok(choices?.[1] instanceof Separator);
    });

    it("preserves disabled reasons and empty display names", async () => {
      const calls: Array<Record<string, unknown>> = [];
      await withPromptFunctionsOverride(
        {
          rawlist: (config: Record<string, unknown>) => {
            calls.push(config);
            return "hidden";
          },
        },
        async () => {
          const parser = prompt(fail<string>(), {
            type: "rawlist",
            message: "Choose entry:",
            choices: [
              { value: "hidden", name: "", disabled: "Not available." },
            ],
          });

          const result = await parseAsync(parser, []);
          assert.ok(result.success);
          assert.equal(result.value, "hidden");
        },
      );

      assert.deepEqual(calls, [{
        message: "Choose entry:",
        choices: [{
          value: "hidden",
          name: "",
          disabled: "Not available.",
        }],
      }]);
    });
  });

  describe("internal branch coverage", { concurrency: false }, () => {
    it("covers async parse/suggest/complete branches with wrapped states", async () => {
      let docDefault: unknown;
      const inner: Parser<"async", string, { readonly token?: string }> = {
        $mode: "async",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly { token?: string }[],
        priority: 5,
        usage: [],
        initialState: {},
        parse(
          context: ParserContext<{ readonly token?: string }>,
        ): Promise<{
          success: true;
          next: ParserContext<{ readonly token?: string }>;
          consumed: readonly string[];
        }> {
          const consumed = context.buffer.length >= 2
            ? context.buffer.slice(0, 2)
            : [];
          return Promise.resolve({
            success: true,
            next: { ...context, state: { token: "ok", [annotationKey]: {} } },
            consumed,
          });
        },
        complete(
          _state: { readonly token?: string },
        ): Promise<{ success: true; value: string }> {
          return Promise.resolve({ success: true, value: "from-cli-state" });
        },
        suggest(): AsyncIterable<Suggestion> {
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
              yield { kind: "literal", text: "inner-suggestion" };
            },
          };
        },
        getDocFragments(_state, defaultValue): DocFragments {
          docDefault = defaultValue;
          return { fragments: [] };
        },
      };

      const parser = prompt(inner, {
        type: "input",
        message: "Enter value",
        prompter: () => Promise.resolve("prompted"),
      });

      const first = await parser.parse({
        buffer: [],
        state: { [annotationKey]: {} } as unknown as {
          readonly token?: string;
        },
        optionsTerminated: false,
        usage: parser.usage,
      });
      assert.ok(first.success);

      if (!first.success) return;

      const suggestions: Suggestion[] = [];
      for await (
        const suggestion of parser.suggest(
          {
            buffer: [],
            state: first.next.state,
            optionsTerminated: false,
            usage: parser.usage,
          },
          "i",
        )
      ) {
        suggestions.push(suggestion);
      }
      assert.equal(suggestions.length, 1);
      assert.equal(suggestions[0].kind, "literal");

      const withCli = await parser.parse({
        buffer: ["--name", "cli-value"],
        state: first.next.state,
        optionsTerminated: false,
        usage: parser.usage,
      });
      assert.ok(withCli.success);
      if (!withCli.success) return;

      const completed = await parser.complete(withCli.next.state);
      assert.ok(completed.success);
      if (completed.success) {
        assert.equal(completed.value, "from-cli-state");
      }

      parser.getDocFragments(
        { kind: "available", state: first.next.state },
        "UPPER",
      );
      assert.equal(docDefault, "UPPER");
    });

    it("deduplicates sentinel complete() calls and uses prompt fallback", async () => {
      let promptCalls = 0;
      const inner: Parser<"async", string, undefined> = {
        $mode: "async",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly undefined[],
        priority: 5,
        usage: [],
        initialState: undefined,
        parse(_context: ParserContext<undefined>) {
          return Promise.resolve({
            success: false as const,
            consumed: 0,
            error: message`inner parse failure`,
          });
        },
        complete() {
          return Promise.resolve({
            success: false as const,
            error: message`inner complete failure`,
          });
        },
        suggest() {
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
              yield* [];
            },
          };
        },
        getDocFragments(): DocFragments {
          return { fragments: [] };
        },
      };

      const parser = prompt(inner, {
        type: "input",
        message: "Enter value",
        prompter: () => {
          promptCalls++;
          return Promise.resolve("from-prompt");
        },
      });

      const initialState = parser.initialState;
      const first = await parser.complete(initialState);
      const second = await parser.complete(initialState);

      assert.ok(first.success);
      assert.ok(second.success);
      assert.equal(promptCalls, 1);
    });

    it(
      "does not reuse sentinel prompt cache across parse invocations",
      async () => {
        const promptedValues = ["first", "second"];
        let promptCalls = 0;

        const parser = object({
          prompted: prompt(option("--prompted", string()), {
            type: "input",
            message: "Enter prompted",
            prompter: () => {
              const value = promptedValues[promptCalls];
              promptCalls++;
              return Promise.resolve(value);
            },
          }),
          required: option("--required", string()),
        });

        // First parse fails because --required is missing, but the prompt
        // parser still runs during object()'s completability check.
        const first = await parseAsync(parser, []);
        assert.ok(!first.success);
        assert.equal(promptCalls, 1);

        // Second parse should ask again and use the new prompted value.
        const second = await parseAsync(parser, ["--required", "ok"]);
        assert.ok(second.success);
        if (second.success) {
          assert.equal(second.value.prompted, "second");
          assert.equal(second.value.required, "ok");
        }
        assert.equal(promptCalls, 2);
      },
    );

    it("falls back to prompt when annotation-carrying cliState complete fails", async () => {
      const inner: Parser<
        "async",
        string,
        { readonly [annotationKey]?: unknown }
      > = {
        $mode: "async",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly { [annotationKey]?: unknown }[],
        priority: 5,
        usage: [],
        initialState: {},
        parse(context) {
          return Promise.resolve({
            success: true as const,
            next: {
              ...context,
              state: { [annotationKey]: { source: "test" } },
            },
            consumed: [],
          });
        },
        complete() {
          return Promise.resolve({
            success: false as const,
            error: message`no value from source`,
          });
        },
        suggest() {
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
              yield* [];
            },
          };
        },
        getDocFragments(): DocFragments {
          return { fragments: [] };
        },
      };

      const parser = prompt(inner, {
        type: "input",
        message: "Enter value",
        prompter: () => Promise.resolve("prompt-fallback"),
      });

      const parsed = await parser.parse({
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      });
      assert.ok(parsed.success);
      if (!parsed.success) return;

      const completed = await parser.complete(parsed.next.state);
      assert.ok(completed.success);
      if (completed.success) {
        assert.equal(completed.value, "prompt-fallback");
      }
    });

    it("executes built-in prompt branches via prompt-function override", async () => {
      const calls: Array<{ name: string; config: Record<string, unknown> }> =
        [];
      await withPromptFunctionsOverride(
        {
          confirm: (config: Record<string, unknown>) => {
            calls.push({ name: "confirm", config });
            return true;
          },
          number: (config: Record<string, unknown>) => {
            calls.push({ name: "number", config });
            return 42;
          },
          input: (config: Record<string, unknown>) => {
            calls.push({ name: "input", config });
            return "hello";
          },
          password: (config: Record<string, unknown>) => {
            calls.push({ name: "password", config });
            return "secret";
          },
          editor: (config: Record<string, unknown>) => {
            calls.push({ name: "editor", config });
            return "edited";
          },
          select: (config: Record<string, unknown>) => {
            calls.push({ name: "select", config });
            return "green";
          },
          rawlist: (config: Record<string, unknown>) => {
            calls.push({ name: "rawlist", config });
            return "prod";
          },
          expand: (config: Record<string, unknown>) => {
            calls.push({ name: "expand", config });
            return "info";
          },
          checkbox: (config: Record<string, unknown>) => {
            calls.push({ name: "checkbox", config });
            return ["a", "c"];
          },
        },
        async () => {
          assert.ok(
            (await parseAsync(
              prompt(fail<boolean>(), {
                type: "confirm",
                message: "confirm?",
                default: true,
              }),
              [],
            )).success,
          );

          assert.ok(
            (await parseAsync(
              prompt(fail<number>(), {
                type: "number",
                message: "number?",
                default: 3,
                min: 1,
                max: 10,
                step: 1,
              }),
              [],
            )).success,
          );

          assert.ok(
            (await parseAsync(
              prompt(fail<string>(), {
                type: "input",
                message: "input?",
                default: "x",
                validate: (value) => value.length > 0,
              }),
              [],
            )).success,
          );

          assert.ok(
            (await parseAsync(
              prompt(fail<string>(), {
                type: "password",
                message: "password?",
                mask: true,
                validate: (value) => value.length > 0,
              }),
              [],
            )).success,
          );

          assert.ok(
            (await parseAsync(
              prompt(fail<string>(), {
                type: "editor",
                message: "editor?",
                default: "draft",
                validate: (value) => value.length > 0,
              }),
              [],
            )).success,
          );

          assert.ok(
            (await parseAsync(
              prompt(fail<string>(), {
                type: "select",
                message: "select?",
                default: "green",
                choices: [
                  "red",
                  {
                    value: "green",
                    name: "Green",
                    description: "desc",
                    short: "g",
                  },
                  { value: "blue", name: "Blue", disabled: "skip" },
                ],
              }),
              [],
            )).success,
          );

          assert.ok(
            (await parseAsync(
              prompt(fail<string>(), {
                type: "rawlist",
                message: "rawlist?",
                default: "prod",
                choices: [
                  "dev",
                  { value: "prod", name: "Production" },
                ],
              }),
              [],
            )).success,
          );

          assert.ok(
            (await parseAsync(
              prompt(fail<string>(), {
                type: "expand",
                message: "expand?",
                default: "info",
                choices: [
                  { value: "debug", key: "d" },
                  { value: "info", key: "i", name: "Info" },
                ],
              }),
              [],
            )).success,
          );

          assert.ok(
            (await parseAsync(
              prompt(fail<readonly string[]>(), {
                type: "checkbox",
                message: "checkbox?",
                choices: [
                  "a",
                  { value: "c", name: "C", disabled: false },
                ],
              }),
              [],
            )).success,
          );
        },
      );

      const names = calls.map((c) => c.name);
      assert.ok(names.includes("confirm"));
      assert.ok(names.includes("number"));
      assert.ok(names.includes("input"));
      assert.ok(names.includes("password"));
      assert.ok(names.includes("editor"));
      assert.ok(names.includes("select"));
      assert.ok(names.includes("rawlist"));
      assert.ok(names.includes("expand"));
      assert.ok(names.includes("checkbox"));
    });

    it("covers prompt config spreads when optional fields are absent", async () => {
      const calls: Array<{ name: string; config: Record<string, unknown> }> =
        [];
      await withPromptFunctionsOverride(
        {
          confirm: (config: Record<string, unknown>) => {
            calls.push({ name: "confirm", config });
            return true;
          },
          number: (config: Record<string, unknown>) => {
            calls.push({ name: "number", config });
            return 1;
          },
          input: (config: Record<string, unknown>) => {
            calls.push({ name: "input", config });
            return "v";
          },
          password: (config: Record<string, unknown>) => {
            calls.push({ name: "password", config });
            return "v";
          },
          editor: (config: Record<string, unknown>) => {
            calls.push({ name: "editor", config });
            return "v";
          },
          select: (config: Record<string, unknown>) => {
            calls.push({ name: "select", config });
            return "x";
          },
          rawlist: (config: Record<string, unknown>) => {
            calls.push({ name: "rawlist", config });
            return "x";
          },
          expand: (config: Record<string, unknown>) => {
            calls.push({ name: "expand", config });
            return "x";
          },
          checkbox: (config: Record<string, unknown>) => {
            calls.push({ name: "checkbox", config });
            return ["x"];
          },
        },
        async () => {
          await parseAsync(
            prompt(fail<boolean>(), {
              type: "confirm",
              message: "confirm?",
            }),
            [],
          );
          await parseAsync(
            prompt(fail<string>(), {
              type: "input",
              message: "input?",
            }),
            [],
          );
          await parseAsync(
            prompt(fail<string>(), {
              type: "password",
              message: "password?",
            }),
            [],
          );
          await parseAsync(
            prompt(fail<string>(), {
              type: "editor",
              message: "editor?",
            }),
            [],
          );
          await parseAsync(
            prompt(fail<string>(), {
              type: "rawlist",
              message: "rawlist?",
              choices: ["x"],
            }),
            [],
          );
          await parseAsync(
            prompt(fail<string>(), {
              type: "expand",
              message: "expand?",
              choices: [{ value: "x", key: "x" }],
            }),
            [],
          );
          await parseAsync(
            prompt(fail<string>(), {
              type: "select",
              message: "select?",
              choices: [{ value: "x" }],
            }),
            [],
          );
        },
      );

      const byName = new Map(calls.map((c) => [c.name, c.config]));
      assert.ok(!("default" in (byName.get("confirm") ?? {})));
      assert.ok(!("default" in (byName.get("input") ?? {})));
      assert.ok(!("validate" in (byName.get("input") ?? {})));
      assert.ok(!("mask" in (byName.get("password") ?? {})));
      assert.ok(!("validate" in (byName.get("password") ?? {})));
      assert.ok(!("default" in (byName.get("editor") ?? {})));
      assert.ok(!("validate" in (byName.get("editor") ?? {})));
      assert.ok(!("default" in (byName.get("rawlist") ?? {})));
      assert.ok(!("default" in (byName.get("expand") ?? {})));
      assert.ok(
        !("name" in (((byName.get("select")?.choices as unknown[])?.[0] ??
          {}) as object)),
      );
    });

    it("covers suggest() state unwrapping branches", async () => {
      const seen: unknown[] = [];
      const inner: Parser<"async", string, { readonly tag: string }> = {
        $mode: "async",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly { tag: string }[],
        priority: 1,
        usage: [],
        initialState: { tag: "INIT" },
        parse(context) {
          const [head, ...tail] = context.buffer;
          if (head == null) {
            return Promise.resolve({
              success: false as const,
              consumed: 0,
              error: message`missing`,
            });
          }
          return Promise.resolve({
            success: true as const,
            next: { ...context, state: { tag: head }, buffer: tail },
            consumed: [head],
          });
        },
        complete(state) {
          return Promise.resolve({ success: true as const, value: state.tag });
        },
        suggest(context) {
          seen.push(context.state);
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
              yield { kind: "literal", text: "ok" };
            },
          };
        },
        getDocFragments() {
          return { fragments: [] };
        },
      };

      const wrapped = prompt(inner, {
        type: "input",
        message: "input?",
        prompter: () => Promise.resolve("prompted"),
      });

      const parsedNoCli = await wrapped.parse({
        buffer: [],
        state: wrapped.initialState,
        optionsTerminated: false,
        usage: wrapped.usage,
      });
      assert.ok(parsedNoCli.success);
      if (!parsedNoCli.success) return;
      for await (
        const _ of wrapped.suggest({
          buffer: [],
          state: parsedNoCli.next.state,
          optionsTerminated: false,
          usage: wrapped.usage,
        }, "")
      ) {
        // consume suggestions
      }

      const parsedCli = await wrapped.parse({
        buffer: ["CLI"],
        state: wrapped.initialState,
        optionsTerminated: false,
        usage: wrapped.usage,
      });
      assert.ok(parsedCli.success);
      if (!parsedCli.success) return;
      for await (
        const _ of wrapped.suggest({
          buffer: [],
          state: parsedCli.next.state,
          optionsTerminated: false,
          usage: wrapped.usage,
        }, "")
      ) {
        // consume suggestions
      }

      for await (
        const _ of wrapped.suggest({
          buffer: [],
          state: { tag: "RAW" } as unknown as never,
          optionsTerminated: false,
          usage: wrapped.usage,
        }, "")
      ) {
        // consume suggestions
      }

      assert.ok(seen.some((s) => (s as { tag?: string }).tag === "INIT"));
      assert.ok(seen.some((s) => (s as { tag?: string }).tag === "CLI"));
      assert.ok(seen.some((s) => (s as { tag?: string }).tag === "RAW"));
    });

    it("covers remaining annotation/suggest/default/number-undefined branches", async () => {
      await withPromptFunctionsOverride(
        {
          confirm: () => true,
          number: () => undefined,
          input: () => "value",
          password: () => "value",
          editor: () => "value",
          select: () => "value",
          rawlist: () => "value",
          expand: () => "value",
          checkbox: () => ["value"],
        },
        async () => {
          const numberFallback = prompt(fail<number>(), {
            type: "number",
            message: "number?",
          });
          const numberFallbackResult = await parseAsync(numberFallback, []);
          assert.ok(!numberFallbackResult.success);

          const inner: Parser<"async", string, unknown> = {
            $mode: "async",
            $valueType: [] as readonly string[],
            $stateType: [] as readonly unknown[],
            priority: 1,
            usage: [],
            initialState: undefined,
            parse() {
              return Promise.resolve({
                success: false as const,
                consumed: 0,
                error: message`missing`,
              });
            },
            complete() {
              return Promise.resolve({
                success: false as const,
                error: message`missing`,
              });
            },
            suggest(context) {
              return {
                async *[Symbol.asyncIterator](): AsyncIterableIterator<
                  Suggestion
                > {
                  yield {
                    kind: "literal",
                    text: String(
                      (context.state as { cliState?: unknown } | undefined)
                        ?.cliState ?? "none",
                    ),
                  };
                },
              };
            },
            getDocFragments(_state, defaultValue) {
              return {
                fragments: [],
                footer: defaultValue === "cfg-default"
                  ? message`default-propagated`
                  : undefined,
              };
            },
          };

          const wrapped = prompt(inner, {
            type: "input",
            message: "input?",
            default: "cfg-default",
          });

          const annotations = { [Symbol.for("@test/anno")]: "present" };
          const parsed = await wrapped.parse({
            buffer: [],
            state: { [annotationKey]: annotations },
            optionsTerminated: false,
            usage: wrapped.usage,
          });
          assert.ok(parsed.success);
          if (!parsed.success) return;

          const parsedState = parsed.next.state as {
            readonly [annotationKey]?: unknown;
            readonly hasCliValue?: boolean;
          };
          assert.equal(parsedState.hasCliValue, false);
          assert.ok(parsedState[annotationKey] != null);

          const suggestions: Suggestion[] = [];
          for await (
            const s of wrapped.suggest(
              {
                buffer: [],
                state: parsed.next.state,
                optionsTerminated: false,
                usage: wrapped.usage,
              } as ParserContext<unknown>,
              "",
            )
          ) {
            suggestions.push(s);
          }
          assert.ok(suggestions.length >= 1);

          const doc = wrapped.getDocFragments({
            kind: "available",
            state: wrapped.initialState,
          });
          assert.ok(doc.footer != null);

          // Re-parse with the real wrapped state to exercise the PromptBindState
          // unwrapping + annotation merge path.
          const reparsed = await wrapped.parse({
            buffer: [],
            state: parsed.next.state,
            optionsTerminated: false,
            usage: wrapped.usage,
          });
          assert.ok(reparsed.success);

          // Complete with a non-prompt state to exercise the normal fallback path.
          const completed = await wrapped.complete({} as unknown as never);
          assert.ok(completed.success);

          const selectWithSeparator = prompt(fail<string>(), {
            type: "select",
            message: "select?",
            choices: [
              "a",
              new Separator("---"),
              { value: "b", name: "B", description: "desc", short: "bb" },
            ],
          });
          const selectResult = await parseAsync(selectWithSeparator, []);
          assert.ok(selectResult.success);
        },
      );
    });

    it("leaves primitive inner states unchanged when annotations are present", async () => {
      const seenStates: unknown[] = [];
      const annotations = { source: "test" };
      const inner: Parser<"async", string, number> = {
        $mode: "async",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly number[],
        priority: 1,
        usage: [],
        initialState: -7,
        parse(context) {
          seenStates.push(context.state);
          return Promise.resolve({
            success: false as const,
            consumed: 0,
            error: message`missing`,
          });
        },
        complete() {
          return Promise.resolve({
            success: false as const,
            error: message`missing`,
          });
        },
        suggest() {
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
              yield* [];
            },
          };
        },
        getDocFragments(): DocFragments {
          return { fragments: [] };
        },
      };

      const parser = prompt(inner, {
        type: "input",
        message: "Enter value:",
        prompter: () => Promise.resolve("prompted"),
      });

      const first = await parser.parse({
        buffer: [],
        state: parser.initialState,
        optionsTerminated: false,
        usage: parser.usage,
      });
      assert.ok(first.success);
      if (!first.success) return;

      const second = await parser.parse({
        buffer: [],
        state: {
          ...(first.next.state as unknown as object),
          [annotationKey]: annotations,
        } as unknown as number,
        optionsTerminated: false,
        usage: parser.usage,
      });
      assert.ok(second.success);

      assert.equal(seenStates[0], -7);
      assert.equal(seenStates[1], -7);
    });

    it("preserves primitive state shape under annotations", async () => {
      let seenStateType: string | undefined;
      let promptCalls = 0;

      const inner: Parser<"async", string, string | undefined> = {
        $mode: "async",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly (string | undefined)[],
        priority: 1,
        usage: [],
        initialState: undefined,
        parse(context) {
          const [head, ...rest] = context.buffer;
          seenStateType = typeof context.state;
          if (head == null) {
            return Promise.resolve({
              success: false as const,
              consumed: 0,
              error: message`missing`,
            });
          }
          return Promise.resolve({
            success: true as const,
            next: { ...context, buffer: rest, state: head },
            consumed: [head],
          });
        },
        complete(state) {
          return Promise.resolve(
            typeof state === "string" && state.length > 0
              ? { success: true as const, value: state }
              : { success: false as const, error: message`missing` },
          );
        },
        suggest() {
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
              yield* [];
            },
          };
        },
        getDocFragments(): DocFragments {
          return { fragments: [] };
        },
      };

      const parser = prompt(inner, {
        type: "input",
        message: "Enter value:",
        prompter: () => {
          promptCalls += 1;
          return Promise.resolve("prompted");
        },
      });

      const result = await parseAsync(parser, ["cli-value"], {
        annotations: {
          [Symbol.for("@test/prompt-primitive-shape")]: "annotated",
        } satisfies Annotations,
      });

      assert.ok(result.success);
      assert.equal(result.value, "cli-value");
      assert.equal(seenStateType, "undefined");
      assert.equal(promptCalls, 0);
    });

    it(
      "delegates to annotation-backed primitive wrapper states before prompting",
      async () => {
        const marker = Symbol.for("@test/prompt-primitive-wrapper-complete");
        let promptCalls = 0;

        const inner: Parser<"async", string, string | undefined> = {
          $mode: "async",
          $valueType: [] as readonly string[],
          $stateType: [] as readonly (string | undefined)[],
          priority: 1,
          usage: [],
          initialState: undefined,
          parse(context) {
            return Promise.resolve({
              success: true as const,
              next: {
                ...context,
                state: injectAnnotations(undefined, { [marker]: "annotated" }),
              },
              consumed: [],
            });
          },
          complete(state) {
            return Promise.resolve(
              getAnnotations(state)?.[marker] === "annotated"
                ? { success: true as const, value: "from-annotations" }
                : { success: false as const, error: message`missing` },
            );
          },
          suggest() {
            return {
              async *[Symbol.asyncIterator](): AsyncIterableIterator<
                Suggestion
              > {
                yield* [];
              },
            };
          },
          getDocFragments(): DocFragments {
            return { fragments: [] };
          },
        };

        const parser = prompt(inner, {
          type: "input",
          message: "Enter value:",
          prompter: () => {
            promptCalls += 1;
            return Promise.resolve("prompted");
          },
        });

        const result = await parseAsync(parser, [], {
          annotations: { [marker]: "annotated" } satisfies Annotations,
        });

        assert.ok(result.success);
        assert.equal(result.value, "from-annotations");
        assert.equal(promptCalls, 0);
      },
    );

    it("preserves annotations for non-plain inner states", async () => {
      const marker = Symbol.for("@test/prompt-class-state");
      let promptCalls = 0;

      class AnnotatedState {
        #value = "state";

        read(): string {
          return this.#value;
        }
      }

      const inner: Parser<"async", string, AnnotatedState> = {
        $mode: "async",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly AnnotatedState[],
        priority: 1,
        usage: [],
        initialState: new AnnotatedState(),
        parse(context) {
          return Promise.resolve({
            success: true as const,
            next: context,
            consumed: [],
          });
        },
        complete(state) {
          return Promise.resolve(
            getAnnotations(state)?.[marker] === "annotated"
              ? { success: true as const, value: state.read() }
              : { success: false as const, error: message`missing` },
          );
        },
        suggest() {
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
              yield* [];
            },
          };
        },
        getDocFragments(): DocFragments {
          return { fragments: [] };
        },
      };

      const parser = prompt(inner, {
        type: "input",
        message: "Enter value:",
        prompter: () => {
          promptCalls += 1;
          return Promise.resolve("prompted");
        },
      });

      const result = await parseAsync(parser, [], {
        annotations: { [marker]: "annotated" } satisfies Annotations,
      });

      assert.ok(result.success);
      assert.equal(result.value, "state");
      assert.equal(promptCalls, 0);
    });

    it("keeps concurrent non-plain prompt annotations isolated", async () => {
      const marker = Symbol.for("@test/prompt-concurrent-class-state");

      class SharedState {}

      let pendingCompletions = 0;
      let releaseCompletions: (() => void) | undefined;
      const completionGate = new Promise<void>((resolve) => {
        releaseCompletions = resolve;
      });

      const inner: Parser<"async", string, SharedState> = {
        $mode: "async",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly SharedState[],
        priority: 1,
        usage: [],
        initialState: new SharedState(),
        parse(context) {
          return Promise.resolve({
            success: true as const,
            next: context,
            consumed: [],
          });
        },
        async complete(state) {
          pendingCompletions += 1;
          if (pendingCompletions === 2) {
            releaseCompletions?.();
          }
          await completionGate;
          return {
            success: true as const,
            value: getAnnotations(state)?.[marker] as string,
          };
        },
        suggest() {
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
              yield* [];
            },
          };
        },
        getDocFragments(): DocFragments {
          return { fragments: [] };
        },
      };

      const parser = prompt(inner, {
        type: "input",
        message: "Enter value:",
        prompter: () => Promise.resolve("prompted"),
      });

      const [first, second] = await Promise.all([
        parseAsync(parser, [], {
          annotations: { [marker]: "first" } satisfies Annotations,
        }),
        parseAsync(parser, [], {
          annotations: { [marker]: "second" } satisfies Annotations,
        }),
      ]);

      assert.ok(first.success);
      assert.ok(second.success);
      if (first.success) {
        assert.equal(first.value, "first");
      }
      if (second.success) {
        assert.equal(second.value, "second");
      }
    });

    it("preserves annotations for CLI-backed non-plain inner states", async () => {
      const marker = Symbol.for("@test/prompt-cli-class-state");
      let promptCalls = 0;

      class MutableAnnotatedState {
        #value: string | undefined;

        setValue(value: string): void {
          this.#value = value;
        }

        read(): string | undefined {
          return this.#value;
        }
      }

      const inner: Parser<"async", string, MutableAnnotatedState> = {
        $mode: "async",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly MutableAnnotatedState[],
        priority: 1,
        usage: [],
        initialState: new MutableAnnotatedState(),
        parse(context) {
          const [head, ...rest] = context.buffer;
          if (head == null) {
            return Promise.resolve({
              success: false as const,
              consumed: 0,
              error: message`missing`,
            });
          }
          context.state.setValue(head);
          return Promise.resolve({
            success: true as const,
            next: { ...context, buffer: rest, state: context.state },
            consumed: [head],
          });
        },
        complete(state) {
          const annotated = getAnnotations(state)?.[marker] === "annotated";
          const value = state.read();
          return Promise.resolve(
            annotated && value != null
              ? { success: true as const, value }
              : { success: false as const, error: message`missing` },
          );
        },
        suggest() {
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
              yield* [];
            },
          };
        },
        getDocFragments(): DocFragments {
          return { fragments: [] };
        },
      };

      const parser = prompt(inner, {
        type: "input",
        message: "Enter value:",
        prompter: () => {
          promptCalls += 1;
          return Promise.resolve("prompted");
        },
      });

      const result = await parseAsync(parser, ["cli-value"], {
        annotations: { [marker]: "annotated" } satisfies Annotations,
      });

      assert.ok(result.success);
      assert.equal(result.value, "cli-value");
      assert.equal(promptCalls, 0);
    });

    it("restores temporary annotations when inner parse throws", async () => {
      const marker = Symbol.for("@test/prompt-throw-state");
      let promptCalls = 0;

      class ThrowingState {}

      const inner: Parser<"async", string, ThrowingState> = {
        $mode: "async",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly ThrowingState[],
        priority: 1,
        usage: [],
        initialState: new ThrowingState(),
        parse(context) {
          if (getAnnotations(context.state)?.[marker] === "annotated") {
            throw new Error("boom");
          }
          return Promise.resolve({
            success: false as const,
            consumed: 0,
            error: message`missing`,
          });
        },
        complete(state) {
          return Promise.resolve(
            getAnnotations(state)?.[marker] === "annotated"
              ? { success: true as const, value: "annotated-state" }
              : { success: false as const, error: message`missing` },
          );
        },
        suggest() {
          return {
            async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
              yield* [];
            },
          };
        },
        getDocFragments(): DocFragments {
          return { fragments: [] };
        },
      };

      const parser = prompt(inner, {
        type: "input",
        message: "Enter value:",
        prompter: () => {
          promptCalls += 1;
          return Promise.resolve("prompted");
        },
      });

      await assert.rejects(
        async () => {
          await parseAsync(parser, ["cli"], {
            annotations: { [marker]: "annotated" } satisfies Annotations,
          });
        },
        /boom/,
      );

      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "prompted");
      assert.equal(promptCalls, 1);
    });
  });
});
