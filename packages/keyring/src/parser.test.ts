import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SourceContext } from "@optique/core/context";
import { object, or, seq, tuple } from "@optique/core/constructs";
import { dependency } from "@optique/core/dependency";
import { injectAnnotations } from "@optique/core/extension";
import { RunParserError, runWith } from "@optique/core/facade";
import { formatMessage, message } from "@optique/core/message";
import { optional, withDefault } from "@optique/core/modifiers";
import {
  type ExecutionContext,
  getDocPageAsync,
  parseAsync,
  type Parser,
  suggestAsync,
} from "@optique/core/parser";
import {
  argument,
  command,
  constant,
  fail,
  option,
} from "@optique/core/primitives";
import {
  choice,
  string,
  type ValueParser,
  type ValueParserResult,
} from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import {
  bindKeyring,
  type BindKeyringOptions,
  createKeyringContext,
  type KeyringContext,
} from "#src/index.ts";

describe("bindKeyring()", () => {
  describe("contract", () => {
    it("should expose an async fluent parser and binding contract", () => {
      const context = createKeyringContext({
        source: () => Promise.resolve(undefined),
      });
      const options = {
        context,
        service: "example.test",
        username: "alice",
      } satisfies BindKeyringOptions;
      const parser = bindKeyring(option("--password", string()), options)
        .map((value) => value.length);

      assert.equal(parser.mode, "async");
      assert.equal(typeof parser.map, "function");
    });

    it("should validate service and username at runtime", () => {
      const context = createKeyringContext({
        source: () => Promise.resolve(undefined),
      });
      const inner = option("--password", string());

      assert.throws(
        () =>
          Reflect.apply(bindKeyring, undefined, [inner, {
            context,
            service: 1,
            username: "alice",
          }]),
        {
          name: "TypeError",
          message: "Expected service to be a string, but got: number.",
        },
      );
      assert.throws(
        () =>
          Reflect.apply(bindKeyring, undefined, [inner, {
            context,
            service: "example.test",
            username: null,
          }]),
        {
          name: "TypeError",
          message: "Expected username to be a string, but got: null.",
        },
      );
    });

    it("should forward service and username to the registered source", async () => {
      const calls: { readonly service: string; readonly username: string }[] =
        [];
      const context = createKeyringContext({
        source: (service, username) => {
          calls.push({ service, username });
          return Promise.resolve("stored-value");
        },
      });
      const parser = bindKeyring(option("--password", string()), {
        context,
        service: "example.test",
        username: "alice",
      });

      const result = await parseWithContext(parser, [], context);

      assert.ok(result.success);
      assert.equal(result.value, "stored-value");
      assert.deepEqual(calls, [{ service: "example.test", username: "alice" }]);
    });
  });

  describe("fallback precedence", () => {
    for (const valueParser of [string(), asyncString()]) {
      it(`should keep the keyring fallback after a terminator with a ${valueParser.mode} parser`, async () => {
        const context = createKeyringContext({
          source: () => Promise.resolve("stored-value"),
        });
        const parser = bindKeyring(
          option("--password", valueParser),
          binding(context),
        );

        const result = await parseWithContext(parser, ["--"], context);

        assert.deepEqual(result, { success: true, value: "stored-value" });
      });
    }

    it("should keep a literal terminator supplied as a CLI value", async () => {
      const context = createKeyringContext({
        source: () => Promise.reject(new Error("Unexpected keyring access.")),
      });
      const parser = bindKeyring(argument(string()), binding(context));

      const result = await parseWithContext(parser, ["--", "--"], context);

      assert.deepEqual(result, { success: true, value: "--" });
    });

    it("should prefer a CLI value for a synchronous inner parser", async () => {
      let calls = 0;
      const context = createKeyringContext({
        source: () => {
          calls++;
          return Promise.resolve("stored-value");
        },
      });
      const parser = bindKeyring(
        option("--password", string()),
        binding(context),
      );

      const result = await parseWithContext(
        parser,
        ["--password", "cli-value"],
        context,
      );

      assert.ok(result.success);
      assert.equal(result.value, "cli-value");
      assert.equal(calls, 0);
    });

    it("should prefer a CLI value for an asynchronous inner parser", async () => {
      let calls = 0;
      const context = createKeyringContext({
        source: () => {
          calls++;
          return Promise.resolve("stored-value");
        },
      });
      const parser = bindKeyring(
        option("--password", asyncString()),
        binding(context),
      );

      const result = await parseWithContext(
        parser,
        ["--password", "cli-value"],
        context,
      );

      assert.ok(result.success);
      assert.equal(result.value, "cli-value");
      assert.equal(calls, 0);
    });

    it("should resolve a required option from the keyring within an object", async () => {
      let calls = 0;
      const context = createKeyringContext({
        source: () => {
          calls++;
          return Promise.resolve("stored-value");
        },
      });
      const parser = object({
        password: bindKeyring(option("--password", string()), binding(context)),
      });

      const result = await parseWithContext(parser, [], context);

      assert.ok(result.success);
      assert.equal(result.value.password, "stored-value");
      assert.equal(calls, 1);
    });

    it("should fall through to the inner default when the source is absent", async () => {
      const context = createKeyringContext({
        source: () => Promise.resolve(undefined),
      });
      const parser = bindKeyring(
        withDefault(option("--password", string()), "inner-default"),
        binding(context),
      );

      const result = await parseWithContext(parser, [], context);

      assert.ok(result.success);
      assert.equal(result.value, "inner-default");
    });

    it("should preserve the inner failure when the source is absent", async () => {
      const context = createKeyringContext({
        source: () => Promise.resolve(undefined),
      });
      const parser = bindKeyring(
        option("--password", string()),
        binding(context),
      );

      const result = await parseWithContext(parser, [], context);

      assert.ok(!result.success);
    });

    it("should complete an asynchronous inner fallback after absence", async () => {
      const context = createKeyringContext({
        source: () => Promise.resolve(undefined),
      });
      const parser = bindKeyring(
        withDefault(
          option("--password", asyncString()),
          "inner-default",
        ),
        binding(context),
      );

      const result = await parseWithContext(parser, [], context);

      assert.ok(result.success);
      assert.equal(result.value, "inner-default");
    });

    it("should preserve CLI values before another option in seq", async () => {
      const context = createKeyringContext({
        source: () => Promise.reject(new Error("Unexpected keyring lookup.")),
      });
      const parser = seq(
        bindKeyring(option("--password", string()), binding(context)),
        option("--other", string()),
      );

      const result = await parseWithContext(
        parser,
        ["--password", "cli-value", "--other", "other-value"],
        context,
      );

      assert.deepEqual(result, {
        success: true,
        value: ["cli-value", "other-value"],
      });
    });

    it("should preserve an inner positional default before a command", async () => {
      const context = createKeyringContext({
        source: () => Promise.resolve(undefined),
      });
      const parser = seq(
        bindKeyring(
          withDefault(argument(string()), "inner-default"),
          binding(context),
        ),
        command("run", object({})),
      );

      const result = await parseWithContext(parser, ["run"], context);

      assert.deepEqual(result, {
        success: true,
        value: ["inner-default", {}],
      });
    });

    for (
      const wrap of [
        { name: "optional", parser: optional, fallback: undefined },
        {
          name: "withDefault",
          parser: (parser: Parser<"async", string, unknown>) =>
            withDefault(parser, "outer-default"),
          fallback: "outer-default",
        },
      ]
    ) {
      it(`should resolve keyring under ${wrap.name} in an object`, async () => {
        const context = createKeyringContext({
          source: () => Promise.resolve("stored-value"),
        });
        const parser = object({
          password: wrap.parser(
            bindKeyring(option("--password", string()), binding(context)),
          ),
        });

        const result = await parseWithContext(parser, [], context);

        assert.deepEqual(result, {
          success: true,
          value: { password: "stored-value" },
        });
      });

      it(`should use ${wrap.name} after keyring absence`, async () => {
        const context = createKeyringContext({
          source: () => Promise.resolve(undefined),
        });
        const parser = object({
          password: wrap.parser(
            bindKeyring(option("--password", string()), binding(context)),
          ),
        });

        const result = await parseWithContext(parser, [], context);

        assert.deepEqual(result, {
          success: true,
          value: { password: wrap.fallback },
        });
      });

      it(`should propagate keyring errors through ${wrap.name}`, async () => {
        const failure = new Error("Credential store is locked.");
        const context = createKeyringContext({
          source: () => Promise.reject(failure),
        });
        const parser = object({
          password: wrap.parser(
            bindKeyring(option("--password", string()), binding(context)),
          ),
        });

        await assert.rejects(
          parseWithContext(parser, [], context),
          (error) => error === failure,
        );
      });
    }

    it("should let an environment-only secret bypass the keyring", async () => {
      const keyringContext = createKeyringContext({
        source: () => Promise.reject(new Error("Unexpected keyring lookup.")),
      });
      const envContext = createEnvContext({ source: () => "env-value" });
      const parser = object({
        password: bindEnv(
          bindKeyring(fail<string>(), binding(keyringContext)),
          { context: envContext, key: "PASSWORD", parser: string() },
        ),
      });

      const result = await runWith(
        parser,
        "test",
        [envContext, keyringContext],
        { args: [] },
      );

      assert.deepEqual(result, { password: "env-value" });
    });

    it("should let an outer environment binding win without a keyring call", async () => {
      let calls = 0;
      const keyringContext = createKeyringContext({
        source: () => {
          calls++;
          return Promise.resolve("stored-value");
        },
      });
      const envContext = createEnvContext({
        source: (key) => key === "PASSWORD" ? "env-value" : undefined,
      });
      const parser = bindEnv(
        bindKeyring(option("--password", string()), binding(keyringContext)),
        {
          context: envContext,
          key: "PASSWORD",
          parser: string(),
        },
      );
      const annotations = {
        ...await keyringContext.getAnnotations(),
        ...await envContext.getAnnotations(),
      };

      const result = await parseAsync(parser, [], { annotations });

      assert.ok(result.success);
      assert.equal(result.value, "env-value");
      assert.equal(calls, 0);
    });

    it("should prefer keyring over an inner environment binding", async () => {
      let envCalls = 0;
      const keyringContext = createKeyringContext({
        source: () => Promise.resolve("stored-value"),
      });
      const envContext = createEnvContext({
        source: () => {
          envCalls++;
          return "env-value";
        },
      });
      const parser = bindKeyring(
        bindEnv(option("--password", string()), {
          context: envContext,
          key: "PASSWORD",
          parser: string(),
        }),
        binding(keyringContext),
      );
      const annotations = {
        ...await keyringContext.getAnnotations(),
        ...await envContext.getAnnotations(),
      };

      const result = await parseAsync(parser, [], { annotations });

      assert.ok(result.success);
      assert.equal(result.value, "stored-value");
      assert.equal(envCalls, 0);
    });

    it("should fall through from keyring absence to an inner environment", async () => {
      const keyringContext = createKeyringContext({
        source: () => Promise.resolve(undefined),
      });
      const envContext = createEnvContext({ source: () => "env-value" });
      const parser = bindKeyring(
        bindEnv(option("--password", string()), {
          context: envContext,
          key: "PASSWORD",
          parser: string(),
        }),
        binding(keyringContext),
      );
      const annotations = {
        ...await keyringContext.getAnnotations(),
        ...await envContext.getAnnotations(),
      };

      const result = await parseAsync(parser, [], { annotations });

      assert.ok(result.success);
      assert.equal(result.value, "env-value");
    });

    it("should preserve custom source rejection identity", async () => {
      const sentinel = new Error("sentinel");
      const context = createKeyringContext({
        source: () => Promise.reject(sentinel),
      });
      const parser = bindKeyring(
        option("--password", string()),
        binding(context),
      );

      await assert.rejects(
        parseWithContext(parser, [], context),
        (error) => error === sentinel,
      );
    });
  });

  describe("stored password validation", () => {
    it("should reject a stored password that fails the inner pattern", async () => {
      const context = createKeyringContext({
        source: () => Promise.resolve("invalid"),
      });
      const parser = bindKeyring(
        option("--password", string({ pattern: /^valid$/ })),
        binding(context),
      );

      const result = await parseWithContext(parser, [], context);

      assert.ok(!result.success);
    });

    it("should return a canonical value from inner validation", async () => {
      const context = createKeyringContext({
        source: () => Promise.resolve("candidate"),
      });
      const inner = option("--password", string());
      Object.defineProperty(inner, "validateValue", {
        value: (value: string): ValueParserResult<string> => ({
          success: true,
          value: value.toUpperCase(),
        }),
      });
      const parser = bindKeyring(inner, binding(context));

      const result = await parseWithContext(parser, [], context);

      assert.ok(result.success);
      assert.equal(result.value, "CANDIDATE");
    });

    it("should redact an inner validation failure", async () => {
      const context = createKeyringContext({
        source: () => Promise.resolve("candidate"),
      });
      const inner = option("--password", string());
      Object.defineProperty(inner, "validateValue", {
        value: (): ValueParserResult<string> => ({
          success: false,
          error: message`Rejected password: ${"candidate"}.`,
        }),
      });
      const parser = bindKeyring(inner, binding(context));

      const result = await parseWithContext(parser, [], context);

      assert.ok(!result.success);
      assert.match(formatMessage(result.error), /keyring.*validat/i);
      assert.ok(!formatMessage(result.error).includes("candidate"));
    });

    for (const asynchronous of [false, true]) {
      it(`should redact a ${asynchronous ? "rejected" : "thrown"} validation error`, async () => {
        const secret = "private-stored-password";
        const context = createKeyringContext({
          source: () => Promise.resolve(secret),
        });
        const inner = option("--password", string());
        Object.defineProperty(inner, "validateValue", {
          value: () => {
            const error = new SyntaxError(`Invalid password: ${secret}.`);
            if (asynchronous) return Promise.reject(error);
            throw error;
          },
        });
        const parser = bindKeyring(inner, binding(context));

        await assert.rejects(
          parseWithContext(parser, [], context),
          (error: unknown) => {
            assert.ok(error instanceof Error);
            assert.match(error.message, /keyring.*validat/i);
            assert.ok(!error.message.includes(secret));
            assert.equal(error.cause, undefined);
            return true;
          },
        );
      });
    }

    it("should keep a rejected stored password out of stderr", async () => {
      const fakeSecret = "FAKE-SECRET-should-stay-private";
      const context = createKeyringContext({
        source: () => Promise.resolve(fakeSecret),
      });
      const parser = bindKeyring(
        option("--password", string({ pattern: /^valid$/ })),
        { context, service: "review.example", username: "alice" },
      );
      const output: string[] = [];

      const result = await runWith(parser, "review", [context], {
        args: [],
        stderr: (chunk) => output.push(chunk),
        onError: () => "failed",
      });

      assert.equal(result, "failed");
      assert.ok(output.length > 0);
      assert.ok(
        !output.join("\n").includes(fakeSecret),
        "Stored password appeared in error output.",
      );
    });
  });

  describe("context registration", () => {
    it("should use the inner fallback when its context is omitted", async () => {
      let calls = 0;
      const context = createKeyringContext({
        source: () => {
          calls++;
          return Promise.resolve("stored-value");
        },
      });
      const parser = bindKeyring(
        withDefault(option("--password", string()), "inner-default"),
        binding(context),
      );

      const result = await parseAsync(parser, []);

      assert.ok(result.success);
      assert.equal(result.value, "inner-default");
      assert.equal(calls, 0);
    });

    it("should diagnose a wrong registered context after inner failure", async () => {
      const expected = createKeyringContext({
        source: () => Promise.resolve("stored-value"),
      });
      const other = createKeyringContext({
        source: () => Promise.resolve("other-value"),
      });
      const parser = bindKeyring(
        option("--password", string()),
        binding(expected),
      );

      const result = await parseWithContext(parser, [], other);

      assert.ok(!result.success);
      assert.match(formatMessage(result.error), /contexts option/);
    });

    it("should select its own annotation among multiple contexts", async () => {
      let firstCalls = 0;
      let secondCalls = 0;
      const first = createKeyringContext({
        source: () => {
          firstCalls++;
          return Promise.resolve("first-value");
        },
      });
      const second = createKeyringContext({
        source: () => {
          secondCalls++;
          return Promise.resolve("second-value");
        },
      });
      const parser = bindKeyring(
        option("--password", string()),
        binding(second),
      );
      const annotations = {
        ...await first.getAnnotations(),
        ...await second.getAnnotations(),
      };

      const result = await parseAsync(parser, [], { annotations });

      assert.ok(result.success);
      assert.equal(result.value, "second-value");
      assert.equal(firstCalls, 0);
      assert.equal(secondCalls, 1);
    });
  });

  describe("dependencies", () => {
    it("should keep dependency extraction effect-free", async () => {
      let calls = 0;
      const context = createKeyringContext({
        source: () => {
          calls++;
          return Promise.resolve("stored-value");
        },
      });
      const source = dependency(string());
      const parser = bindKeyring(
        option("--password", source),
        binding(context),
      );
      const metadata = parser.dependencyMetadata?.source;

      assert.ok(metadata != null);
      assert.equal(typeof metadata.completeSource, "function");
      await metadata.extractSourceValue?.(parser.initialState);
      assert.equal(calls, 0);
    });

    for (const twoPass of [false, true]) {
      it(
        `should bypass an inner environment source for a keyring dependency in a ${
          twoPass ? "two-pass" : "single-pass"
        } run`,
        async () => {
          const keyringContext = createKeyringContext({
            source: () => Promise.resolve("prod"),
          });
          const envContext = createEnvContext({
            source: () => {
              throw new Error("Unexpected environment lookup.");
            },
          });
          const { mode, level } = modeDependency();
          const parser = object({
            mode: bindKeyring(
              bindEnv(option("--mode", mode), {
                context: envContext,
                key: "MODE",
                parser: choice(["dev", "prod"] as const),
              }),
              binding(keyringContext),
            ),
            level: option("--level", level),
          });
          const twoPassContext: SourceContext = {
            id: Symbol("two-pass"),
            phase: "two-pass",
            getAnnotations: () => ({}),
          };

          const result = await runWith(
            parser,
            "test",
            twoPass
              ? [keyringContext, envContext, twoPassContext]
              : [keyringContext, envContext],
            { args: ["--level", "silent"] },
          );

          assert.deepEqual(result, { mode: "prod", level: "silent" });
        },
      );
    }

    it("should resolve a dependency from the environment after a keyring miss", async () => {
      const lookups: string[] = [];
      const keyringContext = createKeyringContext({
        source: () => {
          lookups.push("keyring");
          return Promise.resolve(undefined);
        },
      });
      const envContext = createEnvContext({
        source: () => {
          lookups.push("environment");
          return "prod";
        },
      });
      const { mode, level } = modeDependency();
      const parser = object({
        mode: bindKeyring(
          bindEnv(option("--mode", mode), {
            context: envContext,
            key: "MODE",
            parser: choice(["dev", "prod"] as const),
          }),
          binding(keyringContext),
        ),
        level: option("--level", level),
      });

      const result = await runWith(
        parser,
        "test",
        [keyringContext, envContext],
        { args: ["--level", "silent"] },
      );

      assert.deepEqual(result, { mode: "prod", level: "silent" });
      assert.deepEqual(lookups, ["keyring", "environment"]);
    });

    it("should preserve inner environment errors after a keyring dependency miss", async () => {
      const lookups: string[] = [];
      const keyringContext = createKeyringContext({
        source: () => {
          lookups.push("keyring");
          return Promise.resolve(undefined);
        },
      });
      const failure = new Error("Environment source is unavailable.");
      const envContext = createEnvContext({
        source: () => {
          lookups.push("environment");
          throw failure;
        },
      });
      const parser = object({
        password: bindKeyring(
          bindEnv(option("--password", dependency(string())), {
            context: envContext,
            key: "PASSWORD",
            parser: string(),
          }),
          binding(keyringContext),
        ),
      });

      await assert.rejects(
        runWith(parser, "test", [keyringContext, envContext], { args: [] }),
        (error) => error === failure,
      );
      assert.deepEqual(lookups, ["keyring", "environment"]);
    });

    it("should preserve CLI dependency values through a mapped inner binding", async () => {
      const keyringContext = createKeyringContext({
        source: () => Promise.reject(new Error("Unexpected keyring lookup.")),
      });
      const envContext = createEnvContext({
        source: () => {
          throw new Error("Unexpected environment lookup.");
        },
      });
      const { mode, level } = modeDependency();
      const parser = object({
        mode: bindKeyring(
          bindEnv(option("--mode", mode), {
            context: envContext,
            key: "MODE",
            parser: choice(["dev", "prod"] as const),
          }).map((value) => value.toUpperCase()),
          binding(keyringContext),
        ),
        level: option("--level", level),
      });

      const result = await runWith(
        parser,
        "test",
        [keyringContext, envContext],
        { args: ["--mode", "prod", "--level", "silent"] },
      );

      assert.deepEqual(result, { mode: "PROD", level: "silent" });
    });

    it("should skip an inner dependency default when the keyring has a value", async () => {
      const context = createKeyringContext({
        source: () => Promise.resolve("prod"),
      });
      const { mode, level } = modeDependency();
      const parser = object({
        mode: bindKeyring(
          withDefault(option("--mode", mode), () => {
            throw new Error("Unexpected default evaluation.");
          }),
          binding(context),
        ),
        level: option("--level", level),
      });

      const result = await parseWithContext(
        parser,
        ["--level", "silent"],
        context,
      );

      assert.deepEqual(result, {
        success: true,
        value: { mode: "prod", level: "silent" },
      });
    });

    it("should preserve an inner dependency fallback without keyring registration", async () => {
      const keyringContext = createKeyringContext({
        source: () => Promise.reject(new Error("Unexpected keyring lookup.")),
      });
      const envContext = createEnvContext({ source: () => "prod" });
      const { mode, level } = modeDependency();
      const parser = object({
        mode: bindKeyring(
          bindEnv(option("--mode", mode), {
            context: envContext,
            key: "MODE",
            parser: choice(["dev", "prod"] as const),
          }),
          binding(keyringContext),
        ),
        level: option("--level", level),
      });

      const result = await runWith(parser, "test", [envContext], {
        args: ["--level", "silent"],
      });

      assert.deepEqual(result, { mode: "prod", level: "silent" });
    });

    for (const alternative of [false, true]) {
      it(`should collect CLI dependencies through a bound ${alternative ? "alternative" : "command"}`, async () => {
        const context = createKeyringContext({
          source: () => Promise.reject(new Error("Unexpected keyring access.")),
        });
        const { mode, level } = modeDependency();
        const selected = command("run", option("--mode", mode));
        const inner: Parser<"sync", string, unknown> = alternative
          ? or(selected, command("noop", constant("noop")))
          : selected;
        const plain = object({ mode: inner, level: option("--level", level) });
        const bound = object({
          mode: bindKeyring(inner, binding(context)),
          level: option("--level", level),
        });
        const args = ["run", "--mode", "prod", "--level", "silent"];
        const expected = {
          success: true,
          value: { mode: "prod", level: "silent" },
        };

        assert.deepEqual(
          await parseWithContext(plain, args, context),
          expected,
        );
        assert.deepEqual(
          await parseWithContext(bound, args, context),
          expected,
        );
      });
    }

    it("should schedule a selected command's inner source before sibling dependencies", async () => {
      const outer = createKeyringContext({
        source: () =>
          Promise.reject(new Error("Unexpected outer keyring access.")),
      });
      const inner = createKeyringContext({
        source: () => Promise.resolve("prod"),
      });
      const { mode, level } = modeDependency();
      const parser = object({
        mode: bindKeyring(
          command("run", bindKeyring(option("--mode", mode), binding(inner))),
          binding(outer),
        ),
        level: option("--level", level),
      });

      const result = await runWith(parser, "test", [outer, inner], {
        args: ["run", "--level", "silent"],
      });

      assert.deepEqual(result, { mode: "prod", level: "silent" });
    });

    it("should prefer its fallback to an unselected inner alternative", async () => {
      const outer = createKeyringContext({
        source: () => Promise.resolve("prod"),
      });
      const inner = createKeyringContext({
        source: () =>
          Promise.reject(new Error("Unexpected inner keyring access.")),
      });
      const { mode } = modeDependency();
      const parser = object({
        mode: bindKeyring(
          or(
            bindKeyring(option("--mode", mode), binding(inner)),
            option("--other", string()),
          ),
          binding(outer),
        ),
      });

      const result = await runWith(parser, "test", [outer, inner], {
        args: [],
      });

      assert.deepEqual(result, { mode: "prod" });
    });

    it("should prefer its fallback to sources inside a mapped object", async () => {
      const outer = createKeyringContext({
        source: () => Promise.resolve("stored-value"),
      });
      const inner = createKeyringContext({
        source: () =>
          Promise.reject(new Error("Unexpected inner keyring access.")),
      });
      const parser = object({
        password: bindKeyring(
          object({
            password: bindKeyring(
              option("--password", dependency(string())),
              binding(inner),
            ),
          }).map((value) => value.password),
          binding(outer),
        ),
      });

      const result = await runWith(parser, "test", [outer, inner], {
        args: [],
      });

      assert.deepEqual(result, { password: "stored-value" });
    });

    it("should not expose source completion for a non-preserving mapped source", async () => {
      let calls = 0;
      const context = createKeyringContext({
        source: () => {
          calls++;
          return Promise.resolve("stored-value");
        },
      });
      const source = dependency(string());
      const inner = option("--password", source).map((value) =>
        value.toUpperCase()
      );
      const parser = bindKeyring(inner, binding(context));

      assert.equal(
        parser.dependencyMetadata?.source?.preservesSourceValue,
        false,
      );
      assert.equal(
        parser.dependencyMetadata?.source?.completeSource,
        undefined,
      );
      await suggestAsync(parser, ["--"]);
      assert.equal(calls, 0);

      const result = await parseWithContext(parser, [], context);
      assert.ok(result.success);
      assert.equal(result.value, "stored-value");
      assert.equal(calls, 1);
    });
  });

  describe("completion demand", () => {
    it("should avoid lookups for help, version, suggestions, and probes", async () => {
      let calls = 0;
      const context = createKeyringContext({
        source: () => {
          calls++;
          return Promise.resolve("stored-value");
        },
      });
      const parser = bindKeyring(
        option("--password", string()),
        binding(context),
      );

      const help = await runWith(parser, "test", [context], {
        args: ["--help"],
        help: { option: true, onShow: () => "help" },
        stdout: () => {},
        stderr: () => {},
      });
      const version = await runWith(parser, "test", [context], {
        args: ["--version"],
        version: { value: "1.0.0", option: true, onShow: () => "version" },
        stdout: () => {},
        stderr: () => {},
      });
      await suggestAsync(parser, ["--"]);
      const annotations = await context.getAnnotations();
      const state = injectAnnotations(parser.initialState, annotations);
      await parser.complete(
        state,
        executionContext(parser, { phase: "precomplete" }),
      );

      assert.equal(help, "help");
      assert.equal(version, "version");
      assert.equal(calls, 0);
    });

    it("should defer a non-dependency lookup until the final pass", async () => {
      const events: string[] = [];
      const keyringContext = createKeyringContext({
        source: () => {
          events.push("keyring");
          return Promise.resolve("stored-value");
        },
      });
      const twoPassContext: SourceContext = {
        id: Symbol("two-pass"),
        phase: "two-pass",
        getAnnotations(request) {
          if (request?.phase === "phase2") events.push("phase2");
          return {};
        },
      };
      const parser = object({
        password: bindKeyring(fail<string>(), binding(keyringContext)),
      });

      const result = await runWith(
        parser,
        "test",
        [twoPassContext, keyringContext],
        { args: [] },
      );

      assert.deepEqual(result, { password: "stored-value" });
      assert.deepEqual(events, ["phase2", "keyring"]);
    });

    it("should reject invalid CLI input without a two-pass keyring lookup", async () => {
      const keyringContext = createKeyringContext({
        source: () => Promise.reject(new Error("Unexpected keyring lookup.")),
      });
      const twoPassContext: SourceContext = {
        id: Symbol("two-pass"),
        phase: "two-pass",
        getAnnotations: () => ({}),
      };
      const parser = object({
        password: bindKeyring(
          option("--password", string()),
          binding(keyringContext),
        ),
      });

      await assert.rejects(
        runWith(parser, "test", [twoPassContext, keyringContext], {
          args: ["--unknown"],
          stderr: () => {},
        }),
        RunParserError,
      );
    });
  });

  describe("lookup caching", () => {
    it("should cache a successful lookup across sessions from one run", async () => {
      let calls = 0;
      const context = createKeyringContext({
        source: () => {
          calls++;
          return Promise.resolve("stored-value");
        },
      });
      const parser = bindKeyring(
        option("--password", string()),
        binding(context),
      );
      const state = injectAnnotations(
        parser.initialState,
        await context.getAnnotations(),
      );
      const results = new Map<symbol, ValueParserResult<unknown>>();

      const first = await parser.complete(
        state,
        executionContext(parser, { results }),
      );
      const second = await parser.complete(
        state,
        executionContext(parser, { results }),
      );

      assert.ok(first.success);
      assert.ok(second.success);
      assert.equal(calls, 1);
    });

    it("should cache an absent lookup across sessions from one run", async () => {
      let calls = 0;
      const context = createKeyringContext({
        source: () => {
          calls++;
          return Promise.resolve(undefined);
        },
      });
      const parser = bindKeyring(
        withDefault(option("--password", string()), "inner-default"),
        binding(context),
      );
      const state = injectAnnotations(
        parser.initialState,
        await context.getAnnotations(),
      );
      const results = new Map<symbol, ValueParserResult<unknown>>();

      const first = await parser.complete(
        state,
        executionContext(parser, { results }),
      );
      const second = await parser.complete(
        state,
        executionContext(parser, { results }),
      );

      assert.ok(first.success);
      assert.ok(second.success);
      assert.equal(calls, 1);
    });

    it("should cache a rejected lookup across sessions from one run", async () => {
      let calls = 0;
      const sentinel = new Error("sentinel");
      const context = createKeyringContext({
        source: () => {
          calls++;
          return Promise.reject(sentinel);
        },
      });
      const parser = bindKeyring(
        option("--password", string()),
        binding(context),
      );
      const state = injectAnnotations(
        parser.initialState,
        await context.getAnnotations(),
      );
      const results = new Map<symbol, ValueParserResult<unknown>>();
      const firstExec = executionContext(parser, { results });
      const secondExec = executionContext(parser, { results });

      await assert.rejects(
        parser.complete(state, firstExec),
        (error) => error === sentinel,
      );
      await assert.rejects(
        parser.complete(state, secondExec),
        (error) => error === sentinel,
      );
      assert.equal(calls, 1);
    });

    it("should run once per path when one wrapper instance is reused", async () => {
      let calls = 0;
      const context = createKeyringContext({
        source: () => {
          calls++;
          return Promise.resolve(`stored-${calls}`);
        },
      });
      const source = dependency(string());
      const shared = bindKeyring(argument(source), binding(context));
      const parser = tuple([shared, shared]);

      const result = await parseWithContext(parser, [], context);

      assert.ok(result.success);
      assert.deepEqual(result.value, ["stored-1", "stored-2"]);
      assert.equal(calls, 2);
    });

    it("should distinguish symbol paths within and across runs", async () => {
      let calls = 0;
      const context = createKeyringContext({
        source: () => Promise.resolve(`stored-${++calls}`),
      });
      const parser = bindKeyring(
        option("--password", string()),
        binding(context),
      );
      const state = injectAnnotations(
        parser.initialState,
        await context.getAnnotations(),
      );
      const firstPath = [Symbol("password")];
      const secondPath = [Symbol("password")];

      for (let run = 0; run < 2; run++) {
        const results = new Map<symbol, ValueParserResult<unknown>>();
        const completeAt = (path: readonly PropertyKey[]) =>
          parser.complete(
            state,
            executionContext(parser, { results, path }),
          );
        const [first, second, repeated] = await Promise.all([
          completeAt(firstPath),
          completeAt(secondPath),
          completeAt([...firstPath]),
        ]);

        assert.deepEqual(first, {
          success: true,
          value: `stored-${run * 2 + 1}`,
        });
        assert.deepEqual(second, {
          success: true,
          value: `stored-${run * 2 + 2}`,
        });
        assert.deepEqual(repeated, first);
        assert.equal(calls, (run + 1) * 2);
      }
    });

    it("should never cache credentials across runs", async () => {
      let calls = 0;
      const context = createKeyringContext({
        source: () => {
          calls++;
          return Promise.resolve("stored-value");
        },
      });
      const parser = bindKeyring(
        option("--password", string()),
        binding(context),
      );

      const first = await parseWithContext(parser, [], context);
      const second = await parseWithContext(parser, [], context);

      assert.ok(first.success);
      assert.ok(second.success);
      assert.equal(calls, 2);
    });

    it("should reuse one demanded lookup across seed and final passes", async () => {
      let calls = 0;
      const keyringContext = createKeyringContext({
        source: () => {
          calls++;
          return Promise.resolve("prod");
        },
      });
      const mode = dependency(choice(["dev", "prod"] as const));
      const level = mode.derive({
        metavar: "LEVEL",
        mode: "sync",
        factory: (value: "dev" | "prod") =>
          choice(value === "dev" ? ["debug"] as const : ["silent"] as const),
        defaultValue: () => "dev" as const,
      });
      const parser = object({
        mode: bindKeyring(option("--mode", mode), binding(keyringContext)),
        level: option("--level", level),
      });
      const twoPassContext: SourceContext = {
        id: Symbol("two-pass"),
        phase: "two-pass",
        getAnnotations: () => ({}),
      };

      const result = await runWith(
        parser,
        "test",
        [twoPassContext, keyringContext],
        { args: ["--level", "silent"] },
      );

      assert.deepEqual(result, { mode: "prod", level: "silent" });
      assert.equal(calls, 1);
    });
  });

  describe("documentation", () => {
    it("should render help for an inner or parser", async () => {
      const inner = or(
        option("--password", string()),
        option("--token", string()),
      );
      const context = createKeyringContext({
        source: () => Promise.reject(new Error("Unexpected lookup.")),
      });
      const bound = bindKeyring(inner, {
        context,
        service: "quality.test",
        username: "dummy",
      });
      const expected = await getDocPageAsync(inner);

      assert.deepEqual(await getDocPageAsync(bound), expected);
    });

    it("should preserve a custom parser's documentation state", async () => {
      const inner: Parser<"sync", string, Date> = {
        mode: "sync",
        $valueType: [],
        $stateType: [],
        initialState: new Date(0),
        priority: 0,
        usage: [],
        leadingNames: new Set(),
        acceptingAnyToken: false,
        parse(context) {
          return { success: true, consumed: [], next: context };
        },
        complete(state) {
          return { success: true, value: state.toISOString() };
        },
        suggest() {
          return [];
        },
        getDocFragments(state) {
          return {
            fragments: [],
            description: state.kind === "available"
              ? message`Initial time: ${state.state.toISOString()}`
              : undefined,
          };
        },
      };
      const context = createKeyringContext({
        source: () => Promise.reject(new Error("Unexpected lookup.")),
      });
      const bound = bindKeyring(inner, {
        context,
        service: "quality.test",
        username: "dummy",
      });

      const expected = await getDocPageAsync(inner);
      assert.deepEqual(await getDocPageAsync(bound), expected);
    });

    it("should preserve an unmatched command's help", () => {
      const inner = command("login", option("--password", string()));
      const context = createKeyringContext({
        source: () => Promise.reject(new Error("Unexpected lookup.")),
      });
      const bound = bindKeyring(inner, {
        context,
        service: "quality.test",
        username: "dummy",
      });

      assert.deepEqual(
        bound.getDocFragments({ kind: "available", state: bound.initialState }),
        inner.getDocFragments({ kind: "available", state: inner.initialState }),
      );
    });
  });
});

// Helpers

function binding(context: KeyringContext): BindKeyringOptions {
  return { context, service: "example.test", username: "alice" };
}

function modeDependency() {
  const mode = dependency(choice(["dev", "prod"] as const));
  const level = mode.derive({
    metavar: "LEVEL",
    mode: "sync",
    factory: (value: "dev" | "prod") =>
      choice(value === "dev" ? ["debug"] as const : ["silent"] as const),
    defaultValue: () => "dev" as const,
  });
  return { mode, level };
}

async function parseWithContext<M extends "sync" | "async", TValue, TState>(
  parser: Parser<M, TValue, TState>,
  args: readonly string[],
  context: KeyringContext,
) {
  return await parseAsync(parser, args, {
    annotations: await context.getAnnotations(),
  });
}

function asyncString(): ValueParser<"async", string> {
  return {
    mode: "async",
    metavar: "STRING",
    placeholder: "",
    parse: (input) => Promise.resolve({ success: true, value: input }),
    format: (value) => value,
  };
}

type Session = NonNullable<ExecutionContext["effectfulCompletionSession"]>;

function executionContext(
  parser: Parser<"async", string, unknown>,
  options: {
    readonly phase?: ExecutionContext["phase"];
    readonly path?: readonly PropertyKey[];
    readonly results?: Map<symbol, ValueParserResult<unknown>>;
  },
): ExecutionContext {
  const session: Session = {
    policy: "eager",
    results: options.results ?? new Map(),
    demanded: new Set(),
    effectfulSources: new Set(),
    completedByPath: new Map(),
    preparedByPath: new Map(),
    missingDefaultsByOccurrence: new WeakMap(),
  };
  return {
    usage: parser.usage,
    phase: options.phase ?? "complete",
    path: options.path ?? [],
    effectfulCompletionSession: session,
  };
}
