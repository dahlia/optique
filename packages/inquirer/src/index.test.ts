import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  annotationKey,
  type Annotations,
  getAnnotations,
  injectAnnotations,
} from "@optique/core/annotations";
import { concat, group, object, or, tuple } from "@optique/core/constructs";
import { dependency } from "@optique/core/dependency";
import type { SourceContext } from "@optique/core/context";
import type { DocFragments } from "@optique/core/doc";
import { runWith } from "@optique/core/facade";
import { message } from "@optique/core/message";
import {
  parseAsync,
  type Parser,
  type ParserContext,
  suggestAsync,
  type Suggestion,
} from "@optique/core/parser";
import { constant, fail, flag, option } from "@optique/core/primitives";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import { choice, integer, string } from "@optique/core/valueparser";
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

  describe("withDefault() wrapping under annotations", () => {
    it("prompts for withDefault() under annotations at top level", async () => {
      // At top level with annotations, prompt(withDefault(...)) still
      // prompts: the cliState is a PromptBindInitialStateClass clone
      // (injectAnnotations preserves the prototype), so
      // shouldAttemptInnerCompletion returns false and the prompt fires.
      // This test locks in the semantics so the sentinel path matches.
      const context = createEnvContext({
        source: () => undefined,
        prefix: "APP_",
      });
      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      let promptCalls = 0;
      const parser = prompt(
        withDefault(option("--name", string()), "default"),
        {
          type: "input",
          message: "Enter name:",
          prompter: () => {
            promptCalls++;
            return Promise.resolve("prompted");
          },
        },
      );

      const result = await parseAsync(parser, [], { annotations });
      assert.ok(result.success);
      assert.equal(result.value, "prompted");
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

    it("rejects unsupported prompt type at runtime", async () => {
      const parser = prompt(fail<string>(), {
        type: "mystery" as never,
        message: "x",
      });

      await assert.rejects(
        () => parseAsync(parser, []),
        (error: unknown) => {
          assert.ok(error instanceof TypeError);
          assert.match(error.message, /mystery/);
          return true;
        },
      );
    });

    it("rejects unsupported prompt type even with prompter override", async () => {
      const parser = prompt(fail<string>(), {
        type: "mystery" as never,
        message: "x",
        prompter: () => Promise.resolve("value"),
      } as never);

      await assert.rejects(
        () => parseAsync(parser, []),
        (error: unknown) => {
          assert.ok(error instanceof TypeError);
          assert.match(error.message, /mystery/);
          return true;
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

    it("prompts for prompt(optional(...)) inside annotated object()", async () => {
      // Regression: when a sibling field uses bindEnv(), the object()
      // carries annotations.  prompt(optional(...)) must still prompt
      // even though annotations are present on the sentinel state.
      const context = createEnvContext({
        source: (key) => ({ APP_PORT: "8080" })[key],
        prefix: "APP_",
      });
      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      let namePromptCalls = 0;
      const parser = object({
        name: prompt(optional(option("--name", string())), {
          type: "input",
          message: "Enter name:",
          prompter: () => {
            namePromptCalls++;
            return Promise.resolve("prompted");
          },
        }),
        port: prompt(
          bindEnv(option("--port", integer()), {
            context,
            key: "PORT",
            parser: integer(),
          }),
          {
            type: "number",
            message: "Enter port:",
            prompter: () =>
              Promise.reject(new Error("Port prompt should not be called")),
          },
        ),
      });

      const result = await parseAsync(parser, [], { annotations });
      assert.ok(result.success);
      assert.equal(result.value.name, "prompted");
      assert.equal(namePromptCalls, 1);
      assert.equal(result.value.port, 8080);
    });

    it("prompts for prompt(withDefault(...)) inside annotated object()", async () => {
      // When annotations are present (from a sibling bindEnv field),
      // prompt(withDefault(...)) still prompts.  This matches the
      // top-level behavior: the cliState is a pass-through of the
      // annotation-injected initial state and shouldAttemptInnerCompletion
      // returns false for it at top level, so the sentinel path must
      // also prompt.
      const context = createEnvContext({
        source: (key) => ({ APP_PORT: "8080" })[key],
        prefix: "APP_",
      });
      const annotations = context.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      let namePromptCalls = 0;
      const parser = object({
        name: prompt(withDefault(option("--name", string()), "default"), {
          type: "input",
          message: "Enter name:",
          prompter: () => {
            namePromptCalls++;
            return Promise.resolve("prompted");
          },
        }),
        port: prompt(
          bindEnv(option("--port", integer()), {
            context,
            key: "PORT",
            parser: integer(),
          }),
          {
            type: "number",
            message: "Enter port:",
            prompter: () =>
              Promise.reject(new Error("Port prompt should not be called")),
          },
        ),
      });

      const result = await parseAsync(parser, [], { annotations });
      assert.ok(result.success);
      assert.equal(result.value.name, "prompted");
      assert.equal(namePromptCalls, 1);
      assert.equal(result.value.port, 8080);
    });

    it("skips prompt for prompt(bindEnv(...)) inside object() via active env source", async () => {
      // Regression: bindEnv can resolve via getActiveEnvSource() even
      // when annotations are not threaded through parseAsync().  The
      // sentinel path must not short-circuit to executePrompt() and
      // should still delegate to the inner parser's complete().
      const context = createEnvContext({
        source: (key) => ({ APP_NAME: "env-name" })[key],
        prefix: "APP_",
      });
      // getAnnotations() registers the active env source globally.
      context.getAnnotations();
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

      // Note: annotations NOT passed to parseAsync — bindEnv resolves
      // via the global active env source registry instead.
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value.name, "env-name");
    });

    it("skips prompt for prompt(optional(bindEnv(...))) inside object()", async () => {
      // Regression: optional wraps the inner bindEnv state in an array
      // [envBindState].  The sentinel path must unwrap it to detect the
      // source-binding marker so bindEnv can resolve the env value.
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
          optional(
            bindEnv(option("--name", string()), {
              context,
              key: "NAME",
              parser: string(),
            }),
          ),
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

    it("skips prompt for prompt(withDefault(bindEnv(...))) inside object()", async () => {
      // Same as above but with withDefault wrapping bindEnv.
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
          withDefault(
            bindEnv(option("--name", string()), {
              context,
              key: "NAME",
              parser: string(),
            }),
            "default",
          ),
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

    it("prompts for inner parser that completes without CLI input (consistency with top level)", async () => {
      // A parser whose complete() always succeeds with a real value.
      // prompt() should still prompt because no CLI tokens were consumed —
      // this matches the top-level behavior where prompt() only suppresses
      // the prompt when consumed.length > 0.
      const alwaysCompletes: Parser<"sync", string, null> = {
        $mode: "sync",
        $valueType: [],
        $stateType: [],
        priority: 0,
        usage: [],
        leadingNames: new Set(),
        acceptingAnyToken: false,
        initialState: null,
        parse: (context) => ({
          success: true,
          next: { ...context, state: null },
          consumed: [],
        }),
        complete: () => ({ success: true, value: "completed" }),
        suggest: function* () {},
        getDocFragments: () => ({ fragments: [] }),
      };

      // Top level: prompts (consumed: [] → hasCliValue=false)
      let topLevelPromptCalls = 0;
      const topLevel = prompt(alwaysCompletes, {
        type: "input",
        message: "Enter value:",
        prompter: () => {
          topLevelPromptCalls++;
          return Promise.resolve("prompted");
        },
      });
      const topResult = await parseAsync(topLevel, []);
      assert.ok(topResult.success);
      assert.equal(topResult.value, "prompted");
      assert.equal(topLevelPromptCalls, 1);

      // Nested in object(): should also prompt (same semantics)
      let nestedPromptCalls = 0;
      const nested = object({
        x: prompt(alwaysCompletes, {
          type: "input",
          message: "Enter value:",
          prompter: () => {
            nestedPromptCalls++;
            return Promise.resolve("prompted");
          },
        }),
      });
      const nestedResult = await parseAsync(nested, []);
      assert.ok(nestedResult.success);
      assert.equal(nestedResult.value.x, "prompted");
      assert.equal(nestedPromptCalls, 1);
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

    it("does not double-wrap already-optional inner parser", () => {
      const parser = prompt(optional(option("--name", string())), {
        type: "input",
        message: "Enter name:",
        prompter: () => Promise.resolve(""),
      });

      const usage = parser.usage;
      assert.equal(usage.length, 1);
      assert.equal((usage[0] as { type: string }).type, "optional");
      // The inner terms should be the option itself, not another optional wrapper
      const terms = (usage[0] as unknown as { terms: unknown[] }).terms;
      assert.equal(terms.length, 1);
      assert.equal((terms[0] as { type: string }).type, "option");
    });

    it("does not double-wrap withDefault inner parser", () => {
      const parser = prompt(withDefault(option("--name", string()), "def"), {
        type: "input",
        message: "Enter name:",
        prompter: () => Promise.resolve(""),
      });

      const usage = parser.usage;
      assert.equal(usage.length, 1);
      assert.equal((usage[0] as { type: string }).type, "optional");
      const terms = (usage[0] as unknown as { terms: unknown[] }).terms;
      assert.equal(terms.length, 1);
      assert.equal((terms[0] as { type: string }).type, "option");
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

    it("preserves zero-consumption cliState in getSuggestRuntimeNodes", async () => {
      const inner: Parser<"async", string, string> = {
        $mode: "async",
        $valueType: [] as readonly string[],
        $stateType: [] as readonly string[],
        priority: 0,
        usage: [],
        leadingNames: new Set<string>(),
        acceptingAnyToken: false,
        initialState: "initial",
        parse(parseContext) {
          return Promise.resolve({
            success: true as const,
            next: { ...parseContext, state: "cli-state" },
            consumed: [],
          });
        },
        complete() {
          return Promise.resolve({
            success: true as const,
            value: "cli-state",
          });
        },
        async *suggest() {},
        getSuggestRuntimeNodes(state, path) {
          return [{ path, parser: inner, state }];
        },
        getDocFragments() {
          return { fragments: [] };
        },
      };
      const wrapped = prompt(inner, {
        type: "input",
        message: "input?",
      });

      const parsed = await wrapped.parse({
        buffer: [],
        state: wrapped.initialState,
        optionsTerminated: false,
        usage: wrapped.usage,
      });
      assert.ok(parsed.success);
      if (!parsed.success) return;

      const nodes = wrapped.getSuggestRuntimeNodes?.(
        parsed.next.state as Parameters<
          NonNullable<typeof wrapped.getSuggestRuntimeNodes>
        >[0],
        ["prompt"],
      );
      assert.ok(nodes != null);
      if (nodes == null) return;
      assert.equal(nodes.length, 1);
      assert.deepEqual(nodes[0]?.path, ["prompt"]);
      assert.equal(nodes[0]?.parser, inner);
      assert.equal(nodes[0]?.state, "cli-state");
    });

    it("preserves delegated suggest nodes for source wrappers", async () => {
      const sourceId = Symbol("prompt-multiple-source");
      const item = {
        $mode: "async" as const,
        $valueType: [] as readonly string[],
        $stateType: [] as readonly string[],
        priority: 0,
        usage: [],
        leadingNames: new Set<string>(),
        acceptingAnyToken: false,
        initialState: "",
        parse(parseContext: ParserContext<string>) {
          return Promise.resolve({
            success: true as const,
            next: { ...parseContext, state: parseContext.state },
            consumed: [],
          });
        },
        complete(state: string) {
          return Promise.resolve({
            success: true as const,
            value: state ?? "mode",
          });
        },
        async *suggest() {},
        getDocFragments() {
          return { fragments: [] };
        },
        dependencyMetadata: {
          source: {
            kind: "source" as const,
            sourceId,
            preservesSourceValue: true,
            extractSourceValue(state: unknown) {
              return typeof state === "string"
                ? { success: true as const, value: state }
                : undefined;
            },
          },
        },
      } as const satisfies Parser<"async", string, string>;
      const inner = multiple(item);
      const wrapped = prompt(inner, {
        type: "checkbox",
        message: "input?",
        choices: [],
      });

      const parsed = await wrapped.parse({
        buffer: [],
        state: wrapped.initialState,
        optionsTerminated: false,
        usage: wrapped.usage,
      });
      assert.ok(parsed.success);
      if (!parsed.success) return;

      const nodes = wrapped.getSuggestRuntimeNodes?.(
        parsed.next.state as Parameters<
          NonNullable<typeof wrapped.getSuggestRuntimeNodes>
        >[0],
        ["prompt"],
      );
      assert.ok(nodes != null);
      if (nodes == null) return;

      assert.equal(nodes.length, 3);
      assert.equal(nodes[0]?.parser, wrapped);
      assert.deepEqual(nodes[0]?.path, ["prompt"]);
      assert.equal(nodes[1]?.parser, inner);
      assert.deepEqual(nodes[1]?.path, ["prompt"]);
      assert.equal(nodes[2]?.parser, item);
      assert.deepEqual(nodes[2]?.path, ["prompt", 0]);
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
          contextOptions: {
            load: () => ({
              config: { apiKey: "config-secret" },
              meta: undefined,
            }),
          },
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
          contextOptions: {
            load: () => ({ config, meta: undefined }),
          },
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
          contextOptions: {
            load: () => ({ config, meta: undefined }),
          },
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
            contextOptions: {
              load: () => ({
                config: { apiKey: "config-secret" },
                meta: undefined,
              }),
            },
          },
        );

        assert.equal(phase2Parsed, undefined);
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
            contextOptions: {
              load: () => ({
                config: { apiKey: "config-secret" },
                meta: undefined,
              }),
            },
          },
        );

        assert.ok(sawUndefined);
        assert.equal(result, "config-secret");
      },
    );

    it(
      "passes through deferred prompt values inside non-plain phase-two context inputs",
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
            contextOptions: {
              load: () => ({
                config: { apiKey: "config-secret" },
                meta: undefined,
              }),
            },
          },
        );

        assert.ok(phase2Parsed instanceof ConfigInput);
        assert.equal(phase2Parsed.apiKey, "");
        assert.ok(result instanceof ConfigInput);
        assert.equal(result.apiKey, "config-secret");
      },
    );

    it(
      "handles class with private fields in deferred phase-two contexts",
      async () => {
        // Regression test for https://github.com/dahlia/optique/issues/307
        // Private fields caused the old proxy-based sanitization to throw
        // TypeError because proxies cannot access private fields through
        // the receiver.  The placeholder approach avoids this entirely.
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });

        class SecretHolder {
          #secret: string;
          constructor(secret: string) {
            this.#secret = secret;
          }
          get masked(): string {
            return this.#secret.replace(/./g, "*");
          }
        }

        let phase2Threw = false;
        let phase2SawSecretHolder = false;
        let phase2Masked: string | undefined;
        const dynamicContext: SourceContext = {
          id: Symbol.for("@test/private-field-phase-two"),
          mode: "dynamic",
          getAnnotations(parsed?: unknown) {
            if (parsed !== undefined) {
              phase2SawSecretHolder = parsed instanceof SecretHolder;
              try {
                // Accessing the getter should not throw even though
                // the class uses private fields.
                phase2Masked = (parsed as SecretHolder).masked;
              } catch {
                phase2Threw = true;
              }
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
          (value) => new SecretHolder(value.apiKey),
        );

        const result = await runWith(
          parser,
          "test",
          [dynamicContext, context],
          {
            args: [],
            contextOptions: {
              load: () => ({
                config: { apiKey: "real-secret" },
                meta: undefined,
              }),
            },
          },
        );

        // Phase-two context sees the mapped placeholder instance and
        // accessing its private-field-backed getter must not throw.
        assert.ok(!phase2Threw);
        assert.ok(phase2SawSecretHolder);
        assert.equal(phase2Masked, "");
        assert.ok(result instanceof SecretHolder);
        assert.equal(result.masked, "***********");
      },
    );

    it("passes through deferred prompt values inside Set phase-two context inputs", async () => {
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
        contextOptions: {
          load: () => ({
            config: { apiKey: "config-secret" },
            meta: undefined,
          }),
        },
      });

      assert.deepEqual(phase2Values, [""]);
      assert.ok(result instanceof Set);
      assert.deepEqual([...result], ["config-secret"]);
    });

    it(
      "passes through deferred prompt values in Set own properties during phase two",
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
            contextOptions: {
              load: () => ({
                config: { apiKey: "config-secret" },
                meta: undefined,
              }),
            },
          },
        );

        assert.ok(phase2WasBoxSet);
        assert.equal(phase2ApiKey, "");
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
          contextOptions: {
            load: () => ({
              config: { apiKey: "config-secret" },
              meta: undefined,
            }),
          },
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
          contextOptions: {
            load: () => ({
              config: { apiKey: "config-secret" },
              meta: undefined,
            }),
          },
        },
      );

      assert.equal(phase2Box, cleanBox);
      assert.equal(phase2Value, "clean");
      assert.equal(result.clean, cleanBox);
      assert.equal(result.apiKey, "config-secret");
    });

    it(
      "passes through deferred prompt values inside nested non-plain phase-two inputs",
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
            contextOptions: {
              load: () => ({
                config: { apiKey: "config-secret" },
                meta: undefined,
              }),
            },
          },
        );

        assert.equal(phase2ApiKey, "");
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
        contextOptions: {
          load: (parsed) => {
            loaderParsed = parsed as string | undefined;
            return {
              config: { apiKey: "config-secret" },
              meta: undefined,
            };
          },
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
        contextOptions: {
          load: (parsed) => {
            loaderParsed = parsed as { readonly apiKey?: string | undefined };
            return {
              config: { apiKey: "config-secret" },
              meta: undefined,
            };
          },
        },
      });

      assert.equal(loaderParsed, undefined);
      assert.deepEqual(result, { apiKey: "config-secret" });
    });

    it(
      "collapses all-deferred object to undefined for phase-two contexts and loaders",
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
            contextOptions: {
              load: (parsed) => {
                loaderMetadata = metadataByParsed.get(parsed as object);
                return {
                  config: { apiKey: "config-secret" },
                  meta: undefined,
                };
              },
            },
          },
        );

        // When all fields are deferred, the entire object is replaced
        // with undefined, so the WeakMap identity check does not apply.
        assert.equal(loaderMetadata, undefined);
        assert.deepEqual(result, { apiKey: "config-secret" });
      },
    );

    it("passes through deferred prompt values inside Set loader inputs", async () => {
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
        contextOptions: {
          load: (parsed) => {
            if (parsed instanceof Set) {
              loaderValues = [...parsed];
            }
            return {
              config: { apiKey: "config-secret" },
              meta: undefined,
            };
          },
        },
      });

      assert.deepEqual(loaderValues, [""]);
      assert.ok(result instanceof Set);
      assert.deepEqual([...result], ["config-secret"]);
    });

    it("passes through deferred prompt values in Set own properties for config loaders", async () => {
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
        contextOptions: {
          load: (parsed) => {
            if (parsed instanceof BoxSet) {
              loaderApiKey = parsed.apiKey;
            }
            return {
              config: { apiKey: "config-secret" },
              meta: undefined,
            };
          },
        },
      });

      assert.equal(loaderApiKey, "");
      assert.ok(result instanceof BoxSet);
      assert.equal(result.apiKey, "config-secret");
    });

    it(
      "passes mapped placeholder values through to phase-two contexts (intentional trade-off)",
      async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });

        let phase2Token: string | undefined;
        const dynamicContext: SourceContext = {
          id: Symbol.for("@test/mapped-placeholder-phase-two"),
          mode: "dynamic",
          getAnnotations(parsed?: unknown) {
            if (parsed != null && typeof parsed === "object") {
              phase2Token = (parsed as { readonly token: string }).token;
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
          (value) => ({ token: value.apiKey }),
        );

        const result = await runWith(
          parser,
          "test",
          [dynamicContext, context],
          {
            args: [],
            contextOptions: {
              load: () => ({
                config: { apiKey: "config-secret" },
                meta: undefined,
              }),
            },
          },
        );

        // map() drops deferredKeys because the transform is opaque.
        // The placeholder "" leaks through to the dynamic context.
        // This is an intentional trade-off: forwarding stale inner
        // keys would risk stripping the wrong output fields.
        assert.equal(phase2Token, "");
        assert.equal(result.token, "config-secret");
      },
    );

    it(
      "falls back to undefined when map() transform throws on deferred placeholder",
      async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });

        let phase2Parsed: unknown = "not-called";
        const dynamicContext: SourceContext = {
          id: Symbol.for("@test/mapped-throw-phase-two"),
          mode: "dynamic",
          getAnnotations(parsed?: unknown) {
            phase2Parsed = parsed;
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
          (value) => {
            // This transform crashes on the placeholder because
            // it assumes apiKey is non-empty.
            if (value.apiKey.length === 0) {
              throw new Error("apiKey must be non-empty");
            }
            return { token: value.apiKey.toUpperCase() };
          },
        );

        const result = await runWith(
          parser,
          "test",
          [dynamicContext, context],
          {
            args: [],
            contextOptions: {
              load: () => ({
                config: { apiKey: "config-secret" },
                meta: undefined,
              }),
            },
          },
        );

        // When the transform throws on a deferred placeholder, map()
        // catches the error and produces undefined with deferred: true.
        // prepareParsedForContexts() sees deferred without deferredKeys,
        // so it passes through (which is undefined).
        assert.equal(phase2Parsed, undefined);
        assert.equal(result.token, "CONFIG-SECRET");
      },
    );
  });

  it(
    "map() placeholder is not corrupted by pure transforms across parses",
    async () => {
      const context = createConfigContext({
        schema: createPromptConfigSchema(),
      });

      // Spy context that records the phase-one parsed value so we can
      // verify that the placeholder shape survives the map() transform.
      const phaseOneValues: unknown[] = [];
      const spyContext: SourceContext = {
        id: Symbol("spy"),
        mode: "dynamic",
        getAnnotations(parsed?: unknown) {
          if (parsed !== undefined) {
            phaseOneValues.push(parsed);
          }
          return {};
        },
      };

      const parser = map(
        prompt(
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
        (v) => ({ token: v }),
      );

      // First runWith
      const result1 = await runWith(parser, "test", [context, spyContext], {
        args: [],
        contextOptions: {
          load: () => ({
            config: { apiKey: "config-1" },
            meta: undefined,
          }),
        },
      });
      assert.equal(result1.token, "config-1");

      // The phase-one value should have { token: <string> } shape
      assert.equal(phaseOneValues.length, 1);
      const p1 = phaseOneValues[0] as { token: unknown };
      assert.equal(typeof p1.token, "string");

      // Second runWith — placeholder should not be corrupted
      const result2 = await runWith(parser, "test", [context, spyContext], {
        args: [],
        contextOptions: {
          load: () => ({
            config: { apiKey: "config-2" },
            meta: undefined,
          }),
        },
      });
      assert.equal(result2.token, "config-2");

      // Verify that the second run also produced a valid phase-one value
      assert.equal(phaseOneValues.length, 2);
      const p2 = phaseOneValues[1] as { token: unknown };
      assert.equal(typeof p2.token, "string");
    },
  );

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
          contextOptions: {
            load: () => ({ config, meta: undefined }),
          },
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
          contextOptions: {
            load: () => ({ config, meta: undefined }),
          },
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
          contextOptions: {
            load: () => ({ config, meta: undefined }),
          },
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
          contextOptions: {
            load: () => ({ config, meta: undefined }),
          },
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
          contextOptions: {
            load: () => ({ config, meta: undefined }),
          },
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
          contextOptions: {
            load: () => ({ config, meta: undefined }),
          },
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
          contextOptions: {
            load: () => ({ config, meta: undefined }),
          },
        });

        assert.equal(result.apiKey, expectedValue);
        assert.equal(promptCalls, expectedPromptCalls);
      });
    }

    for (
      const [label, config, expectedValue, expectedPromptCalls] of [
        [
          "map(prompt(bindConfig(...))): skips prompt and applies transform when config resolves",
          { apiKey: "config-secret" } satisfies PromptConfigData,
          "CONFIG-SECRET",
          0,
        ],
        [
          "map(prompt(bindConfig(...))): runs prompt and applies transform when config is absent",
          {} satisfies PromptConfigData,
          "PROMPT-SECRET",
          1,
        ],
      ] as const
    ) {
      it(label, async () => {
        const context = createConfigContext({
          schema: createPromptConfigSchema(),
        });
        let promptCalls = 0;
        const parser = map(
          prompt(
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
          (v) => v.toUpperCase(),
        );

        const result = await runWith(parser, "test", [context], {
          contextOptions: {
            load: () => ({ config, meta: undefined }),
          },
          args: [],
        });

        assert.equal(result, expectedValue);
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
        leadingNames: new Set(),
        acceptingAnyToken: false,
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
        leadingNames: new Set(),
        acceptingAnyToken: false,
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
        leadingNames: new Set(),
        acceptingAnyToken: false,
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

    it(
      "does not rebox omitted cliState without the inheritance marker",
      async () => {
        const annotations = { [Symbol("annotation")]: true };
        const seenStates: unknown[] = [];
        const inner: Parser<"async", string, undefined> = {
          $mode: "async",
          $valueType: [] as readonly string[],
          $stateType: [] as readonly undefined[],
          priority: 5,
          usage: [],
          leadingNames: new Set(),
          acceptingAnyToken: false,
          initialState: undefined,
          parse(context) {
            seenStates.push(context.state);
            return Promise.resolve({
              success: true as const,
              next: {
                ...context,
                state: undefined,
              },
              consumed: [],
            });
          },
          complete() {
            return Promise.resolve({
              success: true as const,
              value: "ok",
            });
          },
          shouldDeferCompletion: () => true,
          async *suggest() {},
          getDocFragments(): DocFragments {
            return { fragments: [] };
          },
        };

        const parser = prompt(inner, {
          type: "input",
          message: "Enter value",
        });
        const first = await parser.parse({
          buffer: [],
          state: injectAnnotations(parser.initialState, annotations),
          optionsTerminated: false,
          usage: parser.usage,
        });
        assert.ok(first.success);
        if (!first.success) return;

        const second = await parser.parse({
          buffer: [],
          state: first.next.state,
          optionsTerminated: false,
          usage: parser.usage,
        });
        assert.ok(second.success);
        assert.equal(seenStates.length, 2);
        assert.equal(seenStates[1], undefined);
      },
    );

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
        leadingNames: new Set(),
        acceptingAnyToken: false,
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
            leadingNames: new Set(),
            acceptingAnyToken: false,
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
        leadingNames: new Set(),
        acceptingAnyToken: false,
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
        leadingNames: new Set(),
        acceptingAnyToken: false,
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
          leadingNames: new Set(),
          acceptingAnyToken: false,
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
        leadingNames: new Set(),
        acceptingAnyToken: false,
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

    it("does not duplicate prompts under concurrent object() parses", async () => {
      let promptCount = 0;
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const parser = object({
        name: prompt(fail<string>(), {
          type: "input",
          message: "name?",
          prompter: async () => {
            promptCount++;
            if (promptCount === 1) {
              await gate;
              return "first";
            }
            return `value-${promptCount}`;
          },
        }),
      });

      const p1 = parseAsync(parser, []);
      const p2 = parseAsync(parser, []);
      await new Promise((resolve) => setTimeout(resolve, 50));
      release();

      const [r1, r2] = await Promise.all([p1, p2]);

      // Each parse should trigger exactly one prompt execution (total 2).
      assert.equal(promptCount, 2);
      assert.ok(r1.success);
      assert.ok(r2.success);
      if (r1.success && r2.success) {
        // Values should not be mixed up across parses.
        const values = new Set([r1.value.name, r2.value.name]);
        assert.equal(values.size, 2);
      }
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
        leadingNames: new Set(),
        acceptingAnyToken: false,
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
        leadingNames: new Set(),
        acceptingAnyToken: false,
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
        leadingNames: new Set(),
        acceptingAnyToken: false,
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

  describe("prompt revalidation", () => {
    it("accepts prompted value when map() transforms the domain", async () => {
      const parser = prompt(
        map(
          option("--color", choice(["red", "green", "blue"])),
          (c) => c.toUpperCase(),
        ),
        {
          type: "input",
          message: "color?",
          prompter: () => Promise.resolve("RED"),
        },
      );
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "RED");
    });

    it("accepts prompted number outside inner constraint range", async () => {
      const parser = prompt(
        option("--port", integer({ min: 1024, max: 65535 })),
        {
          type: "number",
          message: "Port:",
          prompter: () => Promise.resolve(80),
        },
      );
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, 80);
    });

    it("accepts prompted string not matching inner pattern", async () => {
      const parser = prompt(
        option("--name", string({ pattern: /^[A-Z]+$/ })),
        {
          type: "input",
          message: "Name:",
          prompter: () => Promise.resolve("abc"),
        },
      );
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "abc");
    });

    it("accepts prompted number within valid range", async () => {
      const parser = prompt(
        option("--port", integer({ min: 1024, max: 65535 })),
        {
          type: "number",
          message: "Port:",
          prompter: () => Promise.resolve(8080),
        },
      );
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, 8080);
    });

    it("accepts prompted string matching pattern", async () => {
      const parser = prompt(
        option("--name", string({ pattern: /^[A-Z]+$/ })),
        {
          type: "input",
          message: "Name:",
          prompter: () => Promise.resolve("ABC"),
        },
      );
      const result = await parseAsync(parser, []);
      assert.ok(result.success);
      assert.equal(result.value, "ABC");
    });

    it("still validates CLI input correctly", async () => {
      let promptCalls = 0;
      const parser = prompt(
        option("--port", integer({ min: 1024 })),
        {
          type: "number",
          message: "Port:",
          prompter: () => {
            promptCalls += 1;
            return Promise.reject(
              new TypeError("Prompt should not be called."),
            );
          },
        },
      );
      const valid = await parseAsync(parser, ["--port", "8080"]);
      assert.ok(valid.success);
      assert.equal(valid.value, 8080);
      assert.equal(promptCalls, 0);

      const invalid = await parseAsync(parser, ["--port", "80"]);
      assert.ok(!invalid.success);
      assert.equal(promptCalls, 0);
    });
  });
});

// https://github.com/dahlia/optique/issues/751
describe("prompt() with dependency sources", () => {
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

  it("CLI-provided dependency source resolves to derived parser", async () => {
    const parser = object({
      mode: prompt(option("--mode", mode), {
        type: "select",
        message: "Select mode:",
        choices: ["dev", "prod"],
        prompter: () =>
          Promise.reject(new Error("Prompt should not be called")),
      }),
      level: option("--level", level),
    });
    // CLI provides both --mode and --level; prompt should not be called
    const result = await parseAsync(parser, [
      "--mode",
      "prod",
      "--level",
      "silent",
    ]);
    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
  });

  it("CLI-provided dependency source rejects invalid derived value", async () => {
    const parser = object({
      mode: prompt(option("--mode", mode), {
        type: "select",
        message: "Select mode:",
        choices: ["dev", "prod"],
        prompter: () =>
          Promise.reject(new Error("Prompt should not be called")),
      }),
      level: option("--level", level),
    });
    // "debug" is not valid for prod
    const result = await parseAsync(parser, [
      "--mode",
      "prod",
      "--level",
      "debug",
    ]);
    assert.ok(!result.success);
  });

  // Note: prompted values are not currently registered as dependency
  // sources.  When the CLI omits the source option and prompt()
  // provides the value interactively, the derived parser falls back
  // to its defaultValue instead of using the prompted value.
  // This gap is tracked in https://github.com/dahlia/optique/issues/750
  it("prompted dependency source uses default for derived parser", async () => {
    const parser = object({
      mode: prompt(option("--mode", mode), {
        type: "select",
        message: "Select mode:",
        choices: ["dev", "prod"],
        prompter: () => Promise.resolve("prod"),
      }),
      level: option("--level", level),
    });
    // --mode not provided; prompt returns "prod" but the derived parser
    // uses its defaultValue ("dev") since prompted values don't register
    // as dependency sources
    const result = await parseAsync(parser, ["--level", "debug"]);
    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "debug");
  });

  it("preserves inner source extraction when prompt() wraps bindEnv()", async () => {
    const envContext = createEnvContext({
      prefix: "APP_",
      source: (key) => ({ APP_MODE: "prod" })[key],
    });
    const annotations = envContext.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const modeParser = prompt(
      bindEnv(option("--mode", mode), {
        context: envContext,
        key: "MODE",
        parser: choice(["dev", "prod"] as const),
      }),
      {
        type: "select",
        message: "Select mode:",
        choices: ["dev", "prod"],
        prompter: () =>
          Promise.reject(new Error("Prompt should not be called")),
      },
    );
    const parseResult = await modeParser.parse({
      buffer: [],
      state: modeParser.initialState,
      optionsTerminated: false,
      usage: modeParser.usage,
    });
    assert.ok(parseResult.success);
    assert.ok(
      modeParser.dependencyMetadata?.source != null,
      "Expected source metadata.",
    );
    const extracted = await modeParser.dependencyMetadata.source
      .extractSourceValue(parseResult.next.state);
    assert.deepEqual(extracted, { success: true, value: "prod" });
  });

  it(
    "preserves inner source extraction when prompt() wraps bindEnv() at initial state",
    async () => {
      const envContext = createEnvContext({
        prefix: "APP_",
        source: (key) => ({ APP_MODE: "prod" })[key],
      });
      const annotations = envContext.getAnnotations();
      if (annotations instanceof Promise) {
        throw new TypeError("Expected synchronous annotations.");
      }
      const modeParser = prompt(
        bindEnv(option("--mode", mode), {
          context: envContext,
          key: "MODE",
          parser: choice(["dev", "prod"] as const),
        }),
        {
          type: "select",
          message: "Select mode:",
          choices: ["dev", "prod"],
          prompter: () =>
            Promise.reject(new Error("Prompt should not be called")),
        },
      );

      assert.ok(
        modeParser.dependencyMetadata?.source != null,
        "Expected source metadata.",
      );
      const extracted = await modeParser.dependencyMetadata.source
        .extractSourceValue(
          injectAnnotations(modeParser.initialState, annotations),
        );
      assert.deepEqual(extracted, { success: true, value: "prod" });
    },
  );

  it(
    "preserves inner source extraction when prompt() wraps bindConfig() at initial state",
    async () => {
      const configContext = createConfigContext<
        { readonly mode?: "dev" | "prod" }
      >({
        schema: {
          "~standard": {
            version: 1,
            vendor: "optique-test",
            validate(input: unknown) {
              return {
                value: input as { readonly mode?: "dev" | "prod" },
              };
            },
          },
        },
      });
      const annotations = await configContext.getAnnotations(
        {},
        {
          load: () => ({
            config: { mode: "prod" as const },
            meta: undefined,
          }),
        },
      );
      const modeParser = prompt(
        bindConfig(option("--mode", mode), {
          context: configContext,
          key: "mode",
        }),
        {
          type: "select",
          message: "Select mode:",
          choices: ["dev", "prod"],
          prompter: () =>
            Promise.reject(new Error("Prompt should not be called")),
        },
      );

      assert.ok(
        modeParser.dependencyMetadata?.source != null,
        "Expected source metadata.",
      );
      const extracted = await modeParser.dependencyMetadata.source
        .extractSourceValue(
          injectAnnotations(modeParser.initialState, annotations),
        );
      assert.deepEqual(extracted, { success: true, value: "prod" });
    },
  );

  describe("shared-buffer wrapper contracts", () => {
    for (const kind of ["tuple", "concat"] as const) {
      it(
        `${kind}() skips prompt when bindEnv() resolves dependency source`,
        async () => {
          const envContext = createEnvContext({
            prefix: "APP_",
            source: (key) => ({ APP_MODE: "prod" })[key],
          });
          const annotations = envContext.getAnnotations();
          if (annotations instanceof Promise) {
            throw new TypeError("Expected synchronous annotations.");
          }
          const wrappedParser = bindEnv(option("--mode", mode), {
            context: envContext,
            key: "MODE",
            parser: choice(["dev", "prod"] as const),
          });
          let promptCalls = 0;
          const guardedParser = kind === "tuple"
            ? tuple([
              prompt(wrappedParser, {
                type: "select",
                message: "Select mode:",
                choices: ["dev", "prod"],
                prompter: () => {
                  promptCalls += 1;
                  return Promise.resolve("dev" as const);
                },
              }),
              option("--level", level),
            ])
            : concat(
              tuple([
                prompt(wrappedParser, {
                  type: "select",
                  message: "Select mode:",
                  choices: ["dev", "prod"],
                  prompter: () => {
                    promptCalls += 1;
                    return Promise.resolve("dev" as const);
                  },
                }),
              ]),
              tuple([
                option("--level", level),
              ]),
            );
          const result = await parseAsync(
            guardedParser,
            ["--level", "silent"],
            { annotations },
          );

          assert.ok(result.success);
          assert.deepEqual(result.value, ["prod", "silent"]);
          assert.equal(promptCalls, 0);

          const suggestionTexts = (
            await suggestAsync(
              guardedParser,
              ["--level", "s"],
              { annotations },
            )
          )
            .filter((suggestion) => suggestion.kind === "literal")
            .map((suggestion) => suggestion.text);
          assert.ok(suggestionTexts.includes("silent"));
          assert.ok(suggestionTexts.includes("strict"));
          assert.ok(!suggestionTexts.includes("debug"));
          assert.ok(!suggestionTexts.includes("verbose"));
          assert.equal(promptCalls, 0);
        },
      );

      for (
        const wrapperKind of ["optional", "withDefault"] as const
      ) {
        it(
          `${kind}() skips prompt when ${wrapperKind}(bindEnv(...)) resolves dependency source`,
          async () => {
            const envContext = createEnvContext({
              prefix: "APP_",
              source: (key) => ({ APP_MODE: "prod" })[key],
            });
            const annotations = envContext.getAnnotations();
            if (annotations instanceof Promise) {
              throw new TypeError("Expected synchronous annotations.");
            }
            const boundParser = bindEnv(option("--mode", mode), {
              context: envContext,
              key: "MODE",
              parser: choice(["dev", "prod"] as const),
            });
            const wrappedParser = wrapperKind === "optional"
              ? optional(boundParser)
              : withDefault(boundParser, "dev" as const);
            let promptCalls = 0;
            const parser = kind === "tuple"
              ? tuple([
                prompt(wrappedParser, {
                  type: "select",
                  message: "Select mode:",
                  choices: ["dev", "prod"],
                  prompter: () => {
                    promptCalls += 1;
                    return Promise.resolve("dev" as const);
                  },
                }),
                option("--level", level),
              ])
              : concat(
                tuple([
                  prompt(wrappedParser, {
                    type: "select",
                    message: "Select mode:",
                    choices: ["dev", "prod"],
                    prompter: () => {
                      promptCalls += 1;
                      return Promise.resolve("dev" as const);
                    },
                  }),
                ]),
                tuple([
                  option("--level", level),
                ]),
              );

            const result = await parseAsync(
              parser,
              ["--level", "silent"],
              { annotations },
            );

            assert.ok(result.success);
            assert.deepEqual(result.value, ["prod", "silent"]);
            assert.equal(promptCalls, 0);

            const suggestionTexts = (
              await suggestAsync(
                parser,
                ["--level", "s"],
                { annotations },
              )
            )
              .filter((suggestion) => suggestion.kind === "literal")
              .map((suggestion) => suggestion.text);
            assert.ok(suggestionTexts.includes("silent"));
            assert.ok(suggestionTexts.includes("strict"));
            assert.ok(!suggestionTexts.includes("debug"));
            assert.ok(!suggestionTexts.includes("verbose"));
            assert.equal(promptCalls, 0);
          },
        );
      }

      it(
        `${kind}() skips prompt when bindConfig() resolves dependency source`,
        async () => {
          const configContext = createConfigContext<
            { readonly mode?: "dev" | "prod" }
          >({
            schema: {
              "~standard": {
                version: 1,
                vendor: "optique-test",
                validate(input: unknown) {
                  return {
                    value: input as { readonly mode?: "dev" | "prod" },
                  };
                },
              },
            },
          });
          const annotations = await configContext.getAnnotations(
            {},
            {
              load: () => ({
                config: { mode: "prod" as const },
                meta: undefined,
              }),
            },
          );
          let promptCalls = 0;
          const wrappedParser = bindConfig(option("--mode", mode), {
            context: configContext,
            key: "mode",
          });
          const parser = kind === "tuple"
            ? tuple([
              prompt(wrappedParser, {
                type: "select",
                message: "Select mode:",
                choices: ["dev", "prod"],
                prompter: () => {
                  promptCalls += 1;
                  return Promise.resolve("dev" as const);
                },
              }),
              option("--level", level),
            ])
            : concat(
              tuple([
                prompt(wrappedParser, {
                  type: "select",
                  message: "Select mode:",
                  choices: ["dev", "prod"],
                  prompter: () => {
                    promptCalls += 1;
                    return Promise.resolve("dev" as const);
                  },
                }),
              ]),
              tuple([
                option("--level", level),
              ]),
            );
          const result = await parseAsync(
            parser,
            ["--level", "silent"],
            { annotations },
          );

          assert.ok(result.success);
          assert.deepEqual(result.value, ["prod", "silent"]);
          assert.equal(promptCalls, 0);

          const suggestionTexts = (
            await suggestAsync(
              parser,
              ["--level", "s"],
              { annotations },
            )
          )
            .filter((suggestion) => suggestion.kind === "literal")
            .map((suggestion) => suggestion.text);
          assert.ok(suggestionTexts.includes("silent"));
          assert.ok(suggestionTexts.includes("strict"));
          assert.ok(!suggestionTexts.includes("debug"));
          assert.ok(!suggestionTexts.includes("verbose"));
          assert.equal(promptCalls, 0);
        },
      );

      for (
        const wrapperKind of ["optional", "withDefault"] as const
      ) {
        it(
          `${kind}() skips prompt when ${wrapperKind}(bindConfig(...)) resolves dependency source`,
          async () => {
            const configContext = createConfigContext<
              { readonly mode?: "dev" | "prod" }
            >({
              schema: {
                "~standard": {
                  version: 1,
                  vendor: "optique-test",
                  validate(input: unknown) {
                    return {
                      value: input as { readonly mode?: "dev" | "prod" },
                    };
                  },
                },
              },
            });
            const annotations = await configContext.getAnnotations(
              {},
              {
                load: () => ({
                  config: { mode: "prod" as const },
                  meta: undefined,
                }),
              },
            );
            let promptCalls = 0;
            const boundParser = bindConfig(option("--mode", mode), {
              context: configContext,
              key: "mode",
            });
            const wrappedParser = wrapperKind === "optional"
              ? optional(boundParser)
              : withDefault(boundParser, "dev" as const);
            const parser = kind === "tuple"
              ? tuple([
                prompt(wrappedParser, {
                  type: "select",
                  message: "Select mode:",
                  choices: ["dev", "prod"],
                  prompter: () => {
                    promptCalls += 1;
                    return Promise.resolve("dev" as const);
                  },
                }),
                option("--level", level),
              ])
              : concat(
                tuple([
                  prompt(wrappedParser, {
                    type: "select",
                    message: "Select mode:",
                    choices: ["dev", "prod"],
                    prompter: () => {
                      promptCalls += 1;
                      return Promise.resolve("dev" as const);
                    },
                  }),
                ]),
                tuple([
                  option("--level", level),
                ]),
              );
            const result = await parseAsync(
              parser,
              ["--level", "silent"],
              { annotations },
            );

            assert.ok(result.success);
            assert.deepEqual(result.value, ["prod", "silent"]);
            assert.equal(promptCalls, 0);

            const suggestionTexts = (
              await suggestAsync(
                parser,
                ["--level", "s"],
                { annotations },
              )
            )
              .filter((suggestion) => suggestion.kind === "literal")
              .map((suggestion) => suggestion.text);
            assert.ok(suggestionTexts.includes("silent"));
            assert.ok(suggestionTexts.includes("strict"));
            assert.ok(!suggestionTexts.includes("debug"));
            assert.ok(!suggestionTexts.includes("verbose"));
            assert.equal(promptCalls, 0);
          },
        );
      }
    }
  });
});

describe("or(prompt(...), constant(...))", () => {
  it("propagates provisional so or() prefers prompt branch on CLI input", async () => {
    const parser = or(
      prompt(option("--name", string()), {
        type: "input",
        message: "Enter name:",
        prompter: () =>
          Promise.reject(new Error("Prompt should not be called")),
      }),
      constant("fallback"),
    );

    const result = await parseAsync(parser, ["--name", "alice"]);
    assert.ok(result.success);
    assert.equal(result.value, "alice");
  });

  it("falls back to constant when prompt would be the only source", async () => {
    const parser = or(
      prompt(option("--name", string()), {
        type: "input",
        message: "Enter name:",
        prompter: () =>
          Promise.reject(new Error("Prompt should not be called")),
      }),
      constant("fallback"),
    );

    // constant() should win because prompt() has leadingNames (--name),
    // making it ineligible as a zero-consumed fallback.  The or() complete()
    // deferred path picks constant() since it is non-interactive.
    const result = await parseAsync(parser, []);
    assert.ok(result.success);
    assert.equal(result.value, "fallback");
  });
});
