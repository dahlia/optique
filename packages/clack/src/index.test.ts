import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { describe, it } from "node:test";
import { object } from "@optique/core/constructs";
import { dependency } from "@optique/core/dependency";
import { formatMessage, message } from "@optique/core/message";
import { multiple } from "@optique/core/modifiers";
import { parseAsync } from "@optique/core/parser";
import { fail, flag, option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import {
  derivePromptConfig,
  prompt,
  type PromptExecutionContext,
  type PromptOptions,
  type PromptValidator,
} from "@optique/clack";

const promptFunctionsOverrideSymbol = Symbol.for(
  "@optique/clack/prompt-functions",
);

let promptFunctionsOverrideQueue = Promise.resolve();

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return {
    promise,
    resolve(value) {
      resolve?.(value);
    },
  };
}

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
  it("returns an async fluent parser", () => {
    const parser = prompt(option("--name", string()), {
      type: "text",
      message: "Name:",
      prompter: () => Promise.resolve("prompted"),
    }).map((value) => value.toUpperCase());

    assert.equal(parser.mode, "async");
    assert.equal(typeof parser.map, "function");
  });

  it("uses CLI values before prompting", async () => {
    let promptCalled = false;
    const parser = prompt(option("--name", string()), {
      type: "text",
      message: "Name:",
      prompter: () => {
        promptCalled = true;
        return Promise.resolve("prompted");
      },
    });

    const result = await parseAsync(parser, ["--name", "Alice"]);

    assert.ok(result.success);
    assert.equal(result.value, "Alice");
    assert.ok(!promptCalled);
  });

  it("should skip the prompt when the runtime condition is false", async () => {
    let promptCalled = false;
    const parser = prompt(flag("--gh").map((): boolean => true), {
      type: "confirm",
      message: "Use GitHub CLI?",
      initialValue: true,
      when: () => false,
      otherwise: false,
      prompter: () => {
        promptCalled = true;
        return Promise.resolve(true);
      },
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.ok(!result.value);
    assert.ok(!promptCalled);
  });

  it("runs text prompts when CLI value is absent", async () => {
    const parser = prompt(option("--name", string()), {
      type: "text",
      message: "Name:",
      prompter: () => Promise.resolve("Bob"),
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.equal(result.value, "Bob");
  });

  it("runs password prompts when CLI value is absent", async () => {
    const parser = prompt(option("--secret", string()), {
      type: "password",
      message: "Secret:",
      prompter: () => Promise.resolve("s3cr3t"),
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.equal(result.value, "s3cr3t");
  });

  it("runs confirm prompts when CLI value is absent", async () => {
    const parser = prompt(flag("--verbose"), {
      type: "confirm",
      message: "Verbose?",
      prompter: () => Promise.resolve(true),
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.ok(result.value);
  });

  it("runs number prompts when CLI value is absent", async () => {
    const parser = prompt(option("--port", integer()), {
      type: "number",
      message: "Port:",
      prompter: () => Promise.resolve(3000),
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.equal(result.value, 3000);
  });

  it("rejects non-finite number prompt values", async () => {
    const parser = prompt(option("--port", integer()), {
      type: "number",
      message: "Port:",
      prompter: () => Promise.resolve(Infinity),
    });

    const result = await parseAsync(parser, []);

    assert.ok(!result.success);
    assert.deepEqual(result.error, message`No number provided.`);
  });

  it("runs select prompts when CLI value is absent", async () => {
    const parser = prompt(option("--env", string()), {
      type: "select",
      message: "Environment:",
      options: ["dev", { value: "prod", label: "Production" }],
      prompter: () => Promise.resolve("prod"),
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.equal(result.value, "prod");
  });

  it("runs multiselect prompts when CLI values are absent", async () => {
    const parser = prompt(multiple(option("--tag", string())), {
      type: "multiselect",
      message: "Tags:",
      options: ["a", "b", "c"],
      prompter: () => Promise.resolve(["a", "c"]),
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.deepEqual(result.value, ["a", "c"]);
  });

  it("rejects empty required multiselect prompt values", async () => {
    const parser = prompt(multiple(option("--tag", string())), {
      type: "multiselect",
      message: "Tags:",
      options: ["a", "b", "c"],
      required: true,
      prompter: () => Promise.resolve([]),
    });

    const result = await parseAsync(parser, []);

    assert.ok(!result.success);
    assert.deepEqual(result.error, message`No option selected.`);
  });

  it("rejects missing required multiselect prompt values", async () => {
    let validationCalls = 0;
    await withPromptFunctionsOverride({
      multiselect: () => Promise.resolve(undefined),
    }, async () => {
      const parser = prompt(multiple(option("--tag", string())), {
        type: "multiselect",
        message: "Tags:",
        options: ["a", "b", "c"],
        required: true,
      }, {
        validate() {
          validationCalls++;
          return undefined;
        },
      });

      const result = await parseAsync(parser, []);

      assert.ok(!result.success);
      assert.deepEqual(result.error, message`No option selected.`);
      assert.equal(validationCalls, 0);
    });
  });

  it("retries shared select validation with execution context", async () => {
    const controller = new AbortController();
    const verdict = message`Production is required.`;
    const answers = ["dev", "prod"] as const;
    const contexts: PromptExecutionContext[] = [];
    const validated: string[] = [];
    let logCalls = 0;
    const validator = (async (value) => {
      await Promise.resolve();
      validated.push(value);
      return value === "prod" ? undefined : verdict;
    }) satisfies PromptValidator<string>;
    const options = {
      signal: controller.signal,
      validate: validator,
    } satisfies PromptOptions<string>;

    await withPromptFunctionsOverride({
      logError: () => {
        logCalls++;
      },
    }, async () => {
      const parser = prompt(option("--env", string()), {
        type: "select",
        message: "Environment:",
        options: ["dev", "prod"],
        prompter(context) {
          contexts.push(context);
          return Promise.resolve(answers[context.attempt - 1]);
        },
      }, options);

      const result = await parseAsync(parser, []);

      assert.ok(result.success);
      assert.equal(result.value, "prod");
      assert.deepEqual(validated, ["dev", "prod"]);
      assert.equal(contexts.length, 2);
      assert.equal(contexts[0].attempt, 1);
      assert.equal(contexts[0].previousValidationMessage, undefined);
      assert.equal(contexts[0].signal, controller.signal);
      assert.equal(contexts[1].attempt, 2);
      assert.equal(contexts[1].previousValidationMessage, verdict);
      assert.equal(contexts[1].signal, controller.signal);
      assert.equal(logCalls, 0);
    });
  });

  it("retries shared multiselect validation", async () => {
    const answers = [["api"], ["api", "web"]] as const;
    const attempts: number[] = [];
    const parser = prompt(multiple(option("--tag", string())), {
      type: "multiselect",
      message: "Tags:",
      options: ["api", "web"],
      prompter(context) {
        attempts.push(context.attempt);
        return Promise.resolve(answers[context.attempt - 1]);
      },
    }, {
      validate: (values) =>
        values.length > 1 ? undefined : message`Select another tag.`,
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.deepEqual(result.value, ["api", "web"]);
    assert.deepEqual(attempts, [1, 2]);
  });

  it("returns the last shared validation message at the attempt limit", async () => {
    const verdicts = [message`Try another name.`, message`Still unavailable.`];
    let promptCalls = 0;
    const parser = prompt(option("--name", string()), {
      type: "text",
      message: "Name:",
      prompter: () => {
        promptCalls++;
        return Promise.resolve("taken");
      },
    }, {
      maxAttempts: 2,
      validate: () => verdicts[promptCalls - 1],
    });

    const result = await parseAsync(parser, []);

    assert.ok(!result.success);
    assert.equal(result.error, verdicts[1]);
    assert.equal(promptCalls, 2);
  });

  it("rejects invalid shared attempt limits at construction", () => {
    assert.throws(
      () =>
        prompt(option("--name", string()), {
          type: "text",
          message: "Name:",
        }, { maxAttempts: 0 }),
      {
        name: "RangeError",
        message: "maxAttempts must be an integer greater than or equal to 1.",
      },
    );
  });

  it("shows the preceding validation message before a real retry", async () => {
    const verdict = message`Choose a longer name.`;
    const answers = ["a", "alice"];
    const order: string[] = [];

    await withPromptFunctionsOverride({
      text: () => {
        order.push("prompt");
        return Promise.resolve(answers.shift());
      },
      logError: (value: string) => {
        order.push(`error:${value}`);
      },
    }, async () => {
      const parser = prompt(option("--name", string()), {
        type: "text",
        message: "Name:",
      }, {
        validate: (value) => value.length > 1 ? undefined : verdict,
      });

      const result = await parseAsync(parser, []);

      assert.ok(result.success);
      assert.equal(result.value, "alice");
      assert.deepEqual(order, [
        "prompt",
        `error:${formatMessage(verdict)}`,
        "prompt",
      ]);
    });
  });

  it("forwards shared signals through every real Clack prompt", async () => {
    const controller = new AbortController();
    const receivedSignals: (AbortSignal | undefined)[] = [];
    const validated: unknown[] = [];
    const textNativeValidate = (value: string) =>
      value.length > 0 ? undefined : "Required.";
    const passwordNativeValidate = (value: string) =>
      value.length > 0 ? undefined : "Required.";
    const numberNativeValues: number[] = [];

    await withPromptFunctionsOverride({
      text: async (config: {
        readonly message: string;
        readonly signal?: AbortSignal;
        readonly validate?: (
          value: string,
        ) => string | void | Promise<string | void>;
      }) => {
        receivedSignals.push(config.signal);
        if (config.message === "Port:") {
          assert.notEqual(config.validate, textNativeValidate);
          assert.equal(await config.validate?.("42"), undefined);
          return "42";
        }
        assert.equal(config.validate, textNativeValidate);
        return "Alice";
      },
      password: (config: {
        readonly signal?: AbortSignal;
        readonly validate?: (
          value: string,
        ) => string | void | Promise<string | void>;
      }) => {
        receivedSignals.push(config.signal);
        assert.equal(config.validate, passwordNativeValidate);
        return Promise.resolve("secret");
      },
      confirm: (config: { readonly signal?: AbortSignal }) => {
        receivedSignals.push(config.signal);
        return Promise.resolve(true);
      },
      select: (config: { readonly signal?: AbortSignal }) => {
        receivedSignals.push(config.signal);
        return Promise.resolve("prod");
      },
      multiselect: (config: {
        readonly signal?: AbortSignal;
        readonly required?: boolean;
      }) => {
        receivedSignals.push(config.signal);
        assert.ok(config.required);
        return Promise.resolve(["api"]);
      },
    }, async () => {
      const parser = object({
        name: prompt(option("--name", string()), {
          type: "text",
          message: "Name:",
          validate: textNativeValidate,
        }, {
          signal: controller.signal,
          validate: (value) => {
            validated.push(value);
            return undefined;
          },
        }),
        password: prompt(option("--password", string()), {
          type: "password",
          message: "Password:",
          validate: passwordNativeValidate,
        }, {
          signal: controller.signal,
          validate: (value) => {
            validated.push(value);
            return undefined;
          },
        }),
        confirmed: prompt(flag("--confirm"), {
          type: "confirm",
          message: "Confirm?",
        }, {
          signal: controller.signal,
          validate: (value) => {
            validated.push(value);
            return undefined;
          },
        }),
        port: prompt(option("--port", integer()), {
          type: "number",
          message: "Port:",
          validate: (value) => {
            numberNativeValues.push(value);
            return undefined;
          },
        }, {
          signal: controller.signal,
          validate: (value) => {
            validated.push(value);
            return undefined;
          },
        }),
        environment: prompt(option("--environment", string()), {
          type: "select",
          message: "Environment:",
          options: ["dev", "prod"],
        }, {
          signal: controller.signal,
          validate: (value) => {
            validated.push(value);
            return undefined;
          },
        }),
        tags: prompt(multiple(option("--tag", string())), {
          type: "multiselect",
          message: "Tags:",
          options: ["api", "web"],
          required: true,
        }, {
          signal: controller.signal,
          validate: (value) => {
            validated.push(value);
            return undefined;
          },
        }),
      });

      const result = await parseAsync(parser, []);

      assert.ok(result.success);
      assert.deepEqual(result.value, {
        name: "Alice",
        password: "secret",
        confirmed: true,
        port: 42,
        environment: "prod",
        tags: ["api"],
      });
      assert.equal(receivedSignals.length, 6);
      for (let index = 0; index < receivedSignals.length; index++) {
        const signal = receivedSignals[index];
        assert.ok(signal instanceof AbortSignal);
        assert.notEqual(signal, controller.signal);
        assert.ok(!signal.aborted);
        assert.ok(!receivedSignals.slice(0, index).includes(signal));
      }
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
      assert.deepEqual(numberNativeValues, [42]);
      assert.deepEqual(validated, [
        "Alice",
        "secret",
        true,
        42,
        "prod",
        ["api"],
      ]);
    });
  });

  it("keeps native number retries inside one shared attempt", async () => {
    const order: string[] = [];

    await withPromptFunctionsOverride({
      text: async (config: {
        readonly validate?: (
          value: string,
        ) => string | void | Promise<string | void>;
      }) => {
        order.push("native");
        assert.equal(await config.validate?.("3"), "Must be at least 4.");
        order.push("native");
        assert.equal(await config.validate?.("5"), undefined);
        return "5";
      },
    }, async () => {
      const parser = prompt(option("--port", integer()), {
        type: "number",
        message: "Port:",
        min: 4,
      }, {
        validate: (value) => {
          order.push("shared");
          assert.equal(value, 5);
          return undefined;
        },
      });

      const result = await parseAsync(parser, []);

      assert.ok(result.success);
      assert.equal(result.value, 5);
      assert.deepEqual(order, ["native", "native", "shared"]);
    });
  });

  it("propagates a pre-aborted shared signal without starting work", async () => {
    const controller = new AbortController();
    const reason = { code: "stopped" };
    controller.abort(reason);
    let promptCalls = 0;
    let validationCalls = 0;
    let logCalls = 0;

    await withPromptFunctionsOverride({
      text: () => {
        promptCalls++;
        return Promise.resolve("Alice");
      },
      logError: () => {
        logCalls++;
      },
    }, async () => {
      const parser = prompt(option("--name", string()), {
        type: "text",
        message: "Name:",
      }, {
        signal: controller.signal,
        validate: () => {
          validationCalls++;
          return undefined;
        },
      });

      await assert.rejects(
        () => parseAsync(parser, []),
        (error: unknown) => error === reason,
      );
      assert.equal(promptCalls, 0);
      assert.equal(validationCalls, 0);
      assert.equal(logCalls, 0);
    });
  });

  it("propagates the abort reason when an active Clack prompt cancels", async () => {
    const controller = new AbortController();
    const reason = { code: "stopped" };
    const started = deferred<void>();
    const cancel = Symbol.for("clack:cancel");

    await withPromptFunctionsOverride({
      text: (config: { readonly signal?: AbortSignal }) => {
        assert.ok(config.signal instanceof AbortSignal);
        assert.notEqual(config.signal, controller.signal);
        started.resolve();
        return new Promise((resolve) => {
          config.signal?.addEventListener("abort", () => resolve(cancel), {
            once: true,
          });
        });
      },
      isCancel: (value: unknown) => value === cancel,
    }, async () => {
      const parser = prompt(option("--name", string()), {
        type: "text",
        message: "Name:",
      }, { signal: controller.signal });

      const parsing = parseAsync(parser, []);
      await started.promise;
      controller.abort(reason);

      await assert.rejects(
        () => parsing,
        (error: unknown) => error === reason,
      );
    });
  });

  it("propagates a prompter error during a shared retry", async () => {
    const error = new Error("Prompt failed.");
    let validationCalls = 0;
    const parser = prompt(option("--name", string()), {
      type: "text",
      message: "Name:",
      prompter(context) {
        if (context.attempt > 1) return Promise.reject(error);
        return Promise.resolve("taken");
      },
    }, {
      validate: () => {
        validationCalls++;
        return message`Try another name.`;
      },
    });

    await assert.rejects(
      () => parseAsync(parser, []),
      (thrown: unknown) => thrown === error,
    );
    assert.equal(validationCalls, 1);
  });

  it("supports prompt-only values with fail()", async () => {
    const parser = prompt(fail<string>(), {
      type: "text",
      message: "Name:",
      prompter: () => Promise.resolve("Charlie"),
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.equal(result.value, "Charlie");
  });

  it("skips prompting when bindEnv() supplies a value", async () => {
    const envContext = createEnvContext({
      source: (key) => ({ APP_NAME: "env-value" })[key],
      prefix: "APP_",
    });
    const annotations = envContext.getAnnotations();
    if (annotations instanceof Promise) {
      throw new TypeError("Expected synchronous annotations.");
    }
    const parser = prompt(
      bindEnv(option("--name", string()), {
        context: envContext,
        key: "NAME",
        parser: string(),
      }),
      {
        type: "text",
        message: "Name:",
        prompter: () =>
          Promise.reject(new Error("Prompt should not be called")),
      },
    );

    const result = await parseAsync(parser, [], { annotations });

    assert.ok(result.success);
    assert.equal(result.value, "env-value");
  });

  it("runs prompt fields sequentially inside object()", async () => {
    const order: string[] = [];
    const parser = object({
      name: prompt(option("--name", string()), {
        type: "text",
        message: "Name:",
        prompter: () => {
          order.push("name");
          return Promise.resolve("Alice");
        },
      }),
      port: prompt(option("--port", integer()), {
        type: "number",
        message: "Port:",
        prompter: () => {
          order.push("port");
          return Promise.resolve(3000);
        },
      }),
    });

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.deepEqual(result.value, { name: "Alice", port: 3000 });
    assert.deepEqual(order, ["name", "port"]);
  });

  it("converts Clack cancellation with an active signal into a parse failure", async () => {
    const controller = new AbortController();
    await withPromptFunctionsOverride({
      text: (config: { readonly signal?: AbortSignal }) => {
        assert.ok(config.signal instanceof AbortSignal);
        assert.ok(!config.signal.aborted);
        return Promise.resolve(Symbol.for("clack:cancel"));
      },
      isCancel: (value: unknown) => value === Symbol.for("clack:cancel"),
    }, async () => {
      const parser = prompt(option("--name", string()), {
        type: "text",
        message: "Name:",
      }, { signal: controller.signal });

      const result = await parseAsync(parser, []);

      assert.ok(!result.success);
      assert.deepEqual(result.error, message`Prompt cancelled.`);
    });
  });

  it("converts custom prompter cancellation into a parse failure", async () => {
    await withPromptFunctionsOverride({
      isCancel: (value: unknown) => value === Symbol.for("clack:cancel"),
    }, async () => {
      const parser = prompt(option("--name", string()), {
        type: "text",
        message: "Name:",
        prompter: () => Promise.resolve(Symbol.for("clack:cancel") as never),
      });

      const result = await parseAsync(parser, []);

      assert.ok(!result.success);
      assert.deepEqual(result.error, message`Prompt cancelled.`);
    });
  });

  it("rejects unsupported prompt types at runtime", async () => {
    const parser = prompt(option("--name", string()), {
      // @ts-expect-error This verifies the runtime guard for JavaScript users.
      type: "input",
      message: "Name:",
    });

    await assert.rejects(
      () => parseAsync(parser, []),
      new TypeError("Unsupported prompt type: input."),
    );
  });
});

// https://github.com/dahlia/optique/issues/870
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

  it("prompted dependency source resolves the derived parser", async () => {
    const parser = object({
      mode: prompt(option("--mode", mode), {
        type: "select",
        message: "Select mode:",
        options: ["dev", "prod"],
        prompter: () => Promise.resolve("prod"),
      }),
      level: option("--level", level),
    });

    const result = await parseAsync(parser, ["--level", "silent"]);

    assert.ok(result.success);
    assert.equal(result.value.mode, "prod");
    assert.equal(result.value.level, "silent");
  });

  it("prompted dependency source rejects invalid derived value", async () => {
    const parser = object({
      mode: prompt(option("--mode", mode), {
        type: "select",
        message: "Select mode:",
        options: ["dev", "prod"],
        prompter: () => Promise.resolve("prod"),
      }),
      level: option("--level", level),
    });

    // "debug" is only valid for "dev", but the prompt answers "prod".
    const result = await parseAsync(parser, ["--level", "debug"]);

    assert.ok(!result.success);
  });
});

// https://github.com/dahlia/optique/issues/872
describe("prompt() with derived configurations", () => {
  const framework = dependency(choice(["fresh", "hono"] as const));
  const packageManager = dependency(choice(["deno", "npm", "pnpm"] as const));
  const storage = packageManager.deriveSync({
    metavar: "STORAGE",
    factory: (value: "deno" | "npm" | "pnpm") =>
      choice(value === "deno" ? (["kv"] as const) : (["redis"] as const)),
    defaultValue: () => "deno" as const,
  });

  it("derives select options from a prompted framework", async () => {
    const resolvedOptions: (readonly string[])[] = [];
    const parser = object({
      framework: prompt(option("--framework", framework), {
        type: "select",
        message: "Web framework:",
        options: [{ value: "fresh" }, { value: "hono" }],
        prompter: () => Promise.resolve("hono"),
      }),
      packageManager: prompt(
        option("--package-manager", packageManager),
        derivePromptConfig(framework, (value) => {
          const choices = value === "fresh"
            ? (["deno"] as const)
            : (["npm", "pnpm"] as const);
          resolvedOptions.push(choices);
          return {
            type: "select",
            message: "Package manager:",
            options: choices.map((choice) => ({ value: choice })),
            prompter: () => Promise.resolve(choices[0]),
          };
        }),
      ),
      storage: option("--storage", storage),
    });

    const result = await parseAsync(parser, ["--storage", "redis"]);

    assert.ok(result.success);
    assert.deepEqual(result.value, {
      framework: "hono",
      packageManager: "npm",
      storage: "redis",
    });
    assert.deepEqual(resolvedOptions, [["npm", "pnpm"]]);
  });

  it("skips the resolver when the CLI provides the value", async () => {
    let resolverCalls = 0;
    const parser = object({
      framework: option("--framework", framework),
      packageManager: prompt(
        option("--package-manager", packageManager),
        derivePromptConfig(framework, (value) => {
          resolverCalls++;
          return {
            type: "select",
            message: "Package manager:",
            options: (value === "fresh" ? ["deno"] : ["npm", "pnpm"])
              .map((choice) => ({ value: choice })),
            prompter: () =>
              Promise.reject(new Error("Prompt should not be called")),
          };
        }),
      ),
      storage: option("--storage", storage),
    });

    const result = await parseAsync(parser, [
      "--framework",
      "fresh",
      "--package-manager",
      "deno",
      "--storage",
      "kv",
    ]);

    assert.ok(result.success);
    assert.equal(result.value.packageManager, "deno");
    assert.equal(resolverCalls, 0);
  });
});
