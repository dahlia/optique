import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { annotationKey } from "@optique/core/annotations";
import { object } from "@optique/core/constructs";
import type { DocFragments } from "@optique/core/doc";
import { message } from "@optique/core/message";
import {
  parseAsync,
  type Parser,
  type ParserContext,
  type Suggestion,
} from "@optique/core/parser";
import { fail, flag, option } from "@optique/core/primitives";
import { multiple, optional } from "@optique/core/modifiers";
import { integer, string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { prompt, Separator } from "@optique/inquirer";

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
  });

  describe("error handling", () => {
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

      const first = await parser.complete(parser.initialState);
      const second = await parser.complete(parser.initialState);

      assert.ok(first.success);
      assert.ok(second.success);
      assert.equal(promptCalls, 1);
    });

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
                      (context.state as { cliState?: unknown }).cliState ??
                        "none",
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
                state: {
                  [Symbol.for("@optique/inquirer/prompt-bind-state")]: true,
                  hasCliValue: false,
                  cliState: "cli-state-value",
                },
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
  });
});
