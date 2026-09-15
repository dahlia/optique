import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { concat, object, tuple } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import { parseAsync } from "@optique/core/parser";
import { argument, fail, flag, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { prompt } from "@optique/clack";

const promptFunctionsOverrideSymbol = Symbol.for(
  "@optique/clack/prompt-functions",
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
    await withPromptFunctionsOverride({
      multiselect: () => Promise.resolve(undefined),
    }, async () => {
      const parser = prompt(multiple(option("--tag", string())), {
        type: "multiselect",
        message: "Tags:",
        options: ["a", "b", "c"],
        required: true,
      });

      const result = await parseAsync(parser, []);

      assert.ok(!result.success);
      assert.deepEqual(result.error, message`No option selected.`);
    });
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

  it("converts Clack cancellation into a parse failure", async () => {
    await withPromptFunctionsOverride({
      text: () => Promise.resolve(Symbol.for("clack:cancel")),
      isCancel: (value: unknown) => value === Symbol.for("clack:cancel"),
    }, async () => {
      const parser = prompt(option("--name", string()), {
        type: "text",
        message: "Name:",
      });

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
