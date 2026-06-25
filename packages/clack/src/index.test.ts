import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { multiple } from "@optique/core/modifiers";
import { parseAsync } from "@optique/core/parser";
import { fail, flag, option } from "@optique/core/primitives";
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
