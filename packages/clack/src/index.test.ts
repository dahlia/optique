import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getEventListeners } from "node:events";
import { describe, it } from "node:test";
import { concat, object, tuple } from "@optique/core/constructs";
import { dependency } from "@optique/core/dependency";
import { formatMessage, message } from "@optique/core/message";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import { parseAsync } from "@optique/core/parser";
import { argument, fail, flag, option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import {
  derivePromptConfig,
  prompt,
  type PromptExecutionContext,
  type PromptOptions,
  type PromptValidator,
  type SelectConfig,
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
  describe("CLI provenance across reparses", () => {
    for (const construct of ["tuple", "concat"] as const) {
      for (const wrapper of ["bare", "optional", "default"] as const) {
        it(`should preserve CLI input in ${construct} with ${wrapper} option`, async () => {
          const calls: string[] = [];
          const config = {
            type: "text" as const,
            message: "Name",
            prompter: () => {
              calls.push("name");
              return Promise.resolve("prompted");
            },
          };
          const name = wrapper === "bare"
            ? prompt(option("--name", string()), config)
            : wrapper === "optional"
            ? prompt(optional(option("--name", string())), config)
            : prompt(
              withDefault(option("--name", string()), "default"),
              config,
            );
          const tags = multiple(option("--tag", string()));
          const parser = construct === "tuple"
            ? tuple([tags, name])
            : concat(tuple([tags]), tuple([name]));
          const annotations = { [Symbol.for("@test/issue-960")]: "present" };
          const result = await parseAsync(parser, [
            "--name",
            "original",
            "--tag",
            "a",
            "--tag",
            "b",
          ], { annotations });
          assert.deepEqual(calls, []);
          assert.deepEqual(result, {
            success: true,
            value: [["a", "b"], "original"],
          });

          // Reusing the parser must not carry CLI provenance into a new run.
          const omitted = await parseAsync(parser, ["--tag", "c"]);
          assert.deepEqual(omitted, {
            success: true,
            value: [["c"], "prompted"],
          });
          assert.deepEqual(calls, ["name"]);
        });
      }
    }

    it("should not treat an options terminator as a CLI value", async () => {
      let calls = 0;
      const parser = tuple([
        prompt(option("--name", string()), {
          type: "text",
          message: "Name",
          prompter: () => {
            calls++;
            return Promise.resolve("prompted");
          },
        }),
        multiple(argument(string())),
      ]);
      assert.deepEqual(await parseAsync(parser, ["--", "foo", "bar"]), {
        success: true,
        value: ["prompted", ["foo", "bar"]],
      });
      assert.equal(calls, 1);
      assert.deepEqual(
        await parseAsync(parser, ["--name", "original", "--", "foo", "bar"]),
        { success: true, value: ["original", ["foo", "bar"]] },
      );
      assert.equal(calls, 1);
    });

    it("should preserve a literal terminator used as an argument value", async () => {
      const parser = prompt(argument(string()), {
        type: "text",
        message: "Value",
        prompter: () => Promise.reject(new Error("Unexpected prompt.")),
      });
      const parsed = await parser.parse({
        buffer: ["--"],
        state: parser.initialState,
        optionsTerminated: true,
        usage: parser.usage,
      });
      assert.ok(parsed.success);
      assert.ok(!parser.shouldDeferCompletion?.(parsed.next.state));
      assert.deepEqual(await parser.complete(parsed.next.state), {
        success: true,
        value: "--",
      });
    });
  });

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

// https://github.com/dahlia/optique/issues/964
describe("prompt() with zero-dependency derived configurations", () => {
  it("passes asynchronously loaded options to the select prompt", async () => {
    const selectOptions: unknown[] = [];
    const parser = prompt(
      option("--key", string()),
      derivePromptConfig(async () => {
        const keys = await Promise.resolve(["a.txt", "b.txt"]);
        return {
          type: "select",
          message: "Pick an object:",
          options: keys,
          initialValue: keys[1],
        };
      }),
    );

    const result = await withPromptFunctionsOverride({
      select(config: { readonly options: readonly unknown[] }) {
        selectOptions.push(config.options);
        return Promise.resolve("b.txt");
      },
    }, () => parseAsync(parser, []));

    assert.ok(result.success);
    assert.equal(result.value, "b.txt");
    assert.deepEqual(selectOptions, [[
      { value: "a.txt", label: "a.txt" },
      { value: "b.txt", label: "b.txt" },
    ]]);
  });

  it("type-checks a separately declared configuration", async () => {
    const config = derivePromptConfig(async ({ signal }) => {
      const keys = await Promise.resolve(signal == null ? ["a.txt"] : []);
      return {
        type: "select",
        message: "Pick an object:",
        options: keys,
        prompter: () => Promise.resolve("a.txt"),
      } satisfies SelectConfig;
    });
    const parser = prompt(option("--key", string()), config);

    const result = await parseAsync(parser, []);

    assert.ok(result.success);
    assert.equal(result.value, "a.txt");
  });
});

// https://github.com/dahlia/optique/issues/980
describe("derived prompt pending indicators", () => {
  function recordingSpinner(events: string[]) {
    return (options?: { readonly signal?: AbortSignal }) => {
      assert.equal(options?.signal, undefined);
      return {
        start: (label?: string) => events.push(`start:${label}`),
        stop: (label?: string) => events.push(`stop:${label}`),
        error: (label?: string) => events.push(`error:${label}`),
        cancel: (label?: string) => events.push(`cancel:${label}`),
      };
    };
  }

  for (const pendingMessage of ["Loading objects", ""]) {
    it(`should finish the requested indicator before prompting (${JSON.stringify(pendingMessage)})`, async () => {
      const events: string[] = [];
      await withPromptFunctionsOverride({
        spinner: recordingSpinner(events),
        select: () => {
          events.push("select");
          return Promise.resolve("object");
        },
      }, async () => {
        const parser = prompt(
          option("--key", string()),
          derivePromptConfig(() => ({
            type: "select",
            message: "Pick an object",
            options: ["object"],
          })),
          { pendingMessage },
        );
        assert.deepEqual(await parseAsync(parser, []), {
          success: true,
          value: "object",
        });
        assert.deepEqual(await parseAsync(parser, []), {
          success: true,
          value: "object",
        });
      });
      assert.deepEqual(events, [
        `start:${pendingMessage}`,
        `stop:${pendingMessage}`,
        "select",
        `start:${pendingMessage}`,
        `stop:${pendingMessage}`,
        "select",
      ]);
    });
  }

  it("should show an error when the resolver rejects", async () => {
    const events: string[] = [];
    await withPromptFunctionsOverride(
      { spinner: recordingSpinner(events) },
      async () => {
        const result = await parseAsync(
          prompt(
            option("--key", string()),
            derivePromptConfig(() =>
              Promise.reject(new Error("Fetch failed."))
            ),
            { pendingMessage: "Loading objects" },
          ),
          [],
        );
        assert.ok(!result.success);
        assert.deepEqual(
          result.error,
          message`Prompt configuration resolution failed: ${"Fetch failed."}`,
        );
      },
    );
    assert.deepEqual(events, [
      "start:Loading objects",
      "error:Loading objects",
    ]);
  });

  for (const lateRejection of [true, false]) {
    it(`should cancel immediately without output after late ${lateRejection ? "rejection" : "fulfillment"}`, async () => {
      const events: string[] = [];
      const controller = new AbortController();
      const reason = new Error("Stop loading.");
      const started = deferred<void>();
      const settled = deferred<void>();
      await withPromptFunctionsOverride(
        { spinner: recordingSpinner(events) },
        async () => {
          const parser = prompt(
            option("--key", string()),
            derivePromptConfig(async () => {
              started.resolve();
              await settled.promise;
              if (lateRejection) throw new Error("Late failure.");
              return {
                type: "text",
                message: "Key",
                prompter: () => {
                  events.push("prompt");
                  return Promise.resolve("object");
                },
              };
            }),
            { pendingMessage: "Loading objects", signal: controller.signal },
          );
          const parsing = parseAsync(parser, []);
          const rejected = assert.rejects(parsing, (error) => error === reason);
          await started.promise;
          controller.abort(reason);
          // Cleanup must happen within abort(), even if the resolver never settles.
          assert.deepEqual(events, [
            "start:Loading objects",
            "cancel:Loading objects",
          ]);
          await rejected;
          settled.resolve();
          await settled.promise;
          // Let the resolver and the consumed rejection handlers finish.
          await new Promise<void>((resolve) => queueMicrotask(resolve));
          assert.deepEqual(events, [
            "start:Loading objects",
            "cancel:Loading objects",
          ]);
          assert.deepEqual(getEventListeners(controller.signal, "abort"), []);
        },
      );
    });
  }

  it("should stay silent without opting in, including custom prompters", async () => {
    await withPromptFunctionsOverride({
      spinner: () => assert.fail("No indicator requested."),
    }, async () => {
      const config = {
        type: "text" as const,
        message: "Key",
        prompter: () => Promise.resolve("object"),
      };
      assert.deepEqual(
        await parseAsync(
          prompt(option("--key", string()), derivePromptConfig(() => config)),
          [],
        ),
        { success: true, value: "object" },
      );
      assert.deepEqual(
        await parseAsync(
          prompt(option("--key", string()), config, {
            pendingMessage: "Ignored for static config",
          }),
          [],
        ),
        { success: true, value: "object" },
      );
    });
  });

  it("should honor explicit opt-in with a custom prompter", async () => {
    const events: string[] = [];
    const controller = new AbortController();
    await withPromptFunctionsOverride(
      { spinner: recordingSpinner(events) },
      async () => {
        const result = await parseAsync(
          prompt(
            option("--key", string()),
            derivePromptConfig(() => ({
              type: "text",
              message: "Key",
              prompter: () => {
                events.push("prompter");
                return Promise.resolve("object");
              },
            })),
            { pendingMessage: "Loading objects", signal: controller.signal },
          ),
          [],
        );
        assert.deepEqual(result, { success: true, value: "object" });
      },
    );
    assert.deepEqual(events, [
      "start:Loading objects",
      "stop:Loading objects",
      "prompter",
    ]);
    assert.deepEqual(getEventListeners(controller.signal, "abort"), []);
  });

  it("should not start an indicator for CLI values, skipped or pre-aborted prompts", async () => {
    await withPromptFunctionsOverride({
      spinner: () => assert.fail("Resolution not needed."),
    }, async () => {
      const inner = option("--key", string());
      const config = derivePromptConfig(() => ({
        type: "text" as const,
        message: "Key",
      }));
      assert.deepEqual(
        await parseAsync(prompt(inner, config, { pendingMessage: "Loading" }), [
          "--key",
          "cli",
        ]),
        { success: true, value: "cli" },
      );
      assert.deepEqual(
        await parseAsync(
          prompt(
            inner,
            derivePromptConfig(() => ({ type: "text", message: "Key" }), {
              when: () => false,
              otherwise: "skipped",
            }),
            { pendingMessage: "Loading" },
          ),
          [],
        ),
        { success: true, value: "skipped" },
      );
      const controller = new AbortController();
      controller.abort("cancelled");
      await assert.rejects(
        parseAsync(
          prompt(inner, config, {
            pendingMessage: "Loading",
            signal: controller.signal,
          }),
          [],
        ),
        (error) => error === "cancelled",
      );
    });
  });

  it("should preserve a successful indicator if abort happens before the prompt opens", async () => {
    const events: string[] = [];
    const controller = new AbortController();
    const reason = new Error("Stop before prompting.");
    await withPromptFunctionsOverride({
      spinner: () => ({
        start: () => events.push("start"),
        stop: () => {
          events.push("stop");
          controller.abort(reason);
        },
        cancel: () => events.push("cancel"),
        error: () => events.push("error"),
      }),
    }, async () => {
      await assert.rejects(
        parseAsync(
          prompt(
            option("--key", string()),
            derivePromptConfig(() => ({
              type: "text",
              message: "Key",
              prompter: () => {
                events.push("prompter");
                return Promise.resolve("object");
              },
            })),
            { pendingMessage: "Loading", signal: controller.signal },
          ),
          [],
        ),
        (error) => error === reason,
      );
    });
    assert.deepEqual(events, ["start", "stop"]);
    assert.deepEqual(getEventListeners(controller.signal, "abort"), []);
  });
});

describe("native pending spinner cancellation", () => {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    for (const settlement of ["stalled", "resolve", "reject"] as const) {
      it(`should stop waiting after ${signal} with ${settlement} work`, {
        skip: process.platform === "win32",
      }, async () => {
        if (process.platform === "win32") return;
        const script = `
          import { prompt, derivePromptConfig } from "@optique/clack";
          import { parseAsync } from "@optique/core/parser";
          import { option } from "@optique/core/primitives";
          import { string } from "@optique/core/valueparser";
          import { getEventListeners } from "node:events";
          const controller = new AbortController();
          const settlement = ${JSON.stringify(settlement)};
          const gate = settlement === "stalled" ? new Promise(() => {})
            : new Promise(resolve => process.stdin.once("data", resolve));
          const parser = prompt(option("--key", string()), derivePromptConfig(async () => {
            process.stdout.write("READY\\n");
            await gate;
            if (settlement === "reject") throw new Error("Late failure.");
            return { type: "text", message: "Key", prompter: () => {
              console.log("PROMPTED"); return Promise.resolve("object");
            } };
          }), { pendingMessage: "Loading objects", signal: controller.signal });
          try {
            await parseAsync(parser, []);
            console.log("UNEXPECTED_SUCCESS");
            process.exitCode = 1;
          } catch (error) {
            if (error?.name !== "AbortError") throw error;
            console.log("CANCELLED");
          }
          if (getEventListeners(controller.signal, "abort").length !== 0) {
            throw new Error("Abort listener leaked.");
          }
          if (controller.signal.aborted) throw new Error("Caller signal aborted.");
          if (settlement !== "stalled") {
            // Clack closes its readline interface on cancellation, pausing
            // stdin. Resume the test's independent resolver-release channel.
            process.stdin.resume();
            await gate;
            await new Promise(resolve => setImmediate(resolve));
            console.log("LATE_SETTLED");
          }
        `;
        const args = process.versions.deno != null
          ? ["eval", script]
          : process.versions.bun != null
          ? ["--eval", script]
          : ["--input-type=module", "--eval", script];
        const child = spawn(process.execPath, args, {
          cwd: fileURLToPath(new URL("../", import.meta.url)),
          stdio: ["pipe", "pipe", "pipe"],
        });
        let output = "";
        let errors = "";
        let sent = false;
        let released = false;
        child.stdout.on("data", (chunk) => {
          output += String(chunk);
          if (!sent && output.includes("READY")) {
            sent = true;
            child.kill(signal);
          }
          if (
            settlement !== "stalled" && !released &&
            output.includes("CANCELLED")
          ) {
            released = true;
            child.stdin.end("settle");
          }
        });
        child.stderr.on("data", (chunk) => {
          errors += String(chunk);
        });
        // A broken cancellation path must fail rather than leave the test hung.
        const timeout = setTimeout(() => child.kill("SIGKILL"), 10000);
        try {
          const code = await new Promise<number | null>((resolve, reject) => {
            child.once("error", reject);
            child.once("close", resolve);
          });
          assert.equal(code, 0, errors + output);
          assert.ok(sent, errors + output);
          assert.match(output, /CANCELLED/);
          assert.ok(!output.includes("UNEXPECTED_SUCCESS"));
          assert.ok(!output.includes("PROMPTED"));
          if (settlement !== "stalled") assert.match(output, /LATE_SETTLED/);
        } finally {
          clearTimeout(timeout);
          if (child.exitCode == null && child.signalCode == null) {
            child.kill("SIGKILL");
          }
        }
      });
    }
  }
});
