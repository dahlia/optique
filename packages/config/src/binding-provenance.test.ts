import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { getAnnotations } from "@optique/core/annotations";
import { concat, tuple } from "@optique/core/constructs";
import { injectAnnotations } from "@optique/core/extension";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import {
  type Mode,
  parseAsync,
  type Parser,
  type ParserContext,
} from "@optique/core/parser";
import { argument, option } from "@optique/core/primitives";
import { string, type ValueParser } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { bindConfig, createConfigContext } from "./index.ts";

type Binding = "env" | "config" | "env-config" | "config-env";

function bind(
  kind: Binding,
  inner: Parser<Mode, string | undefined, unknown>,
  sources: { readonly envValue?: string } = { envValue: "environment" },
) {
  const env = createEnvContext({ source: () => sources.envValue });
  const config = createConfigContext({
    schema: z.object({ name: z.string() }),
  });
  const envOptions = { context: env, key: "NAME", parser: string() };
  const configOptions = { context: config, key: "name" as const };
  const parser = kind === "env"
    ? bindEnv(inner, envOptions)
    : kind === "config"
    ? bindConfig(inner, configOptions)
    : kind === "env-config"
    ? bindEnv(bindConfig(inner, configOptions), envOptions)
    : bindConfig(bindEnv(inner, envOptions), configOptions);
  return {
    parser,
    async annotations() {
      return {
        ...await env.getAnnotations(),
        [config.id]: { data: { name: "configuration" } },
      };
    },
    fallback: kind.startsWith("env") ? "environment" : "configuration",
  };
}

function asyncString(): ValueParser<"async", string> {
  const value = string();
  return {
    ...value,
    mode: "async",
    async parse(input) {
      return await value.parse(input);
    },
    async *suggest(prefix) {
      if (value.suggest != null) yield* value.suggest(prefix);
    },
  };
}

describe("source binding CLI provenance", () => {
  for (const kind of ["env", "config"] as const) {
    for (const mode of ["sync", "async"] as const) {
      for (const wrapper of ["bare", "optional", "default"] as const) {
        for (const construct of ["tuple", "concat"] as const) {
          it(`${kind} preserves ${mode} ${wrapper} CLI input in ${construct}`, async () => {
            const value = mode === "sync" ? string() : asyncString();
            const named = option("--name", value);
            const inner = wrapper === "bare"
              ? named
              : wrapper === "optional"
              ? optional(named)
              : withDefault(named, "default");
            const source = bind(kind, inner);
            const tags = multiple(option("--tag", string()));
            const parser = construct === "tuple"
              ? tuple([tags, source.parser])
              : concat(tuple([tags]), tuple([source.parser]));
            const annotations = await source.annotations();
            assert.equal(parser.mode, mode);
            assert.deepEqual(
              await parseAsync(parser, [
                "--name",
                "original",
                "--tag",
                "a",
                "--tag",
                "b",
              ], { annotations }),
              { success: true, value: [["a", "b"], "original"] },
            );
            // A new run on the same instance must still use its fallback.
            assert.deepEqual(
              await parseAsync(parser, ["--tag", "c"], { annotations }),
              { success: true, value: [["c"], source.fallback] },
            );
            for (
              const args of [
                ["--name"],
                ["--name", "original", "--tag", "a", "--name", "duplicate"],
              ]
            ) {
              const result = await parseAsync(parser, args, { annotations });
              assert.ok(!result.success);
            }
          });
        }
      }

      it(`${kind} preserves annotated ${mode} state after non-matches`, async () => {
        const source = bind(
          kind,
          option("--name", mode === "sync" ? string() : asyncString()),
        );
        const annotations = await source.annotations();
        const parser = source.parser;
        const firstResult = parser.parse({
          buffer: ["--name", "original"],
          state: injectAnnotations(parser.initialState, annotations),
          optionsTerminated: false,
          usage: parser.usage,
        });
        assert.equal(firstResult instanceof Promise, mode === "async");
        const first = await firstResult;
        assert.ok(first.success);
        for (const buffer of [[], ["--other"]]) {
          const context: ParserContext<unknown> = { ...first.next, buffer };
          const reparsed = await parser.parse(context);
          assert.ok(reparsed.success);
          assert.equal(reparsed.next, context);
          assert.equal(getAnnotations(reparsed.next.state), annotations);
          const result = await parser.complete(reparsed.next.state);
          assert.ok(result.success);
          assert.equal(result.value, "original");
        }
      });

      it(`${kind} distinguishes terminators from ${mode} CLI values`, async () => {
        const source = bind(
          kind,
          option("--name", mode === "sync" ? string() : asyncString()),
        );
        const annotations = await source.annotations();
        const parser = tuple([source.parser, multiple(argument(string()))]);
        for (const words of [["foo"], ["foo", "bar"]]) {
          assert.deepEqual(
            await parseAsync(parser, ["--", ...words], { annotations }),
            { success: true, value: [source.fallback, words] },
          );
          assert.deepEqual(
            await parseAsync(parser, ["--name", "original", "--", ...words], {
              annotations,
            }),
            { success: true, value: ["original", words] },
          );
        }
        const literal = bind(
          kind,
          argument(mode === "sync" ? string() : asyncString()),
        );
        const parsed = await literal.parser.parse({
          buffer: ["--"],
          state: injectAnnotations(
            literal.parser.initialState,
            await literal.annotations(),
          ),
          optionsTerminated: true,
          usage: literal.parser.usage,
        });
        assert.ok(parsed.success);
        const result = await literal.parser.complete(parsed.next.state);
        assert.ok(result.success);
        assert.equal(result.value, "--");
      });
    }

    it(`${kind} preserves annotations when restarting an unmatched inner parser`, async () => {
      const base = option("--name", string());
      const seen: ReturnType<typeof getAnnotations>[] = [];
      const source = bind(kind, {
        ...base,
        parse(context: ParserContext<typeof base.initialState>) {
          seen.push(getAnnotations(context.state));
          return base.parse(context);
        },
      });
      const annotations = await source.annotations();
      const first = await source.parser.parse({
        buffer: [],
        state: injectAnnotations(source.parser.initialState, annotations),
        optionsTerminated: false,
        usage: source.parser.usage,
      });
      assert.ok(first.success);
      const second = await source.parser.parse(first.next);
      assert.ok(second.success);
      assert.equal(seen.length, 2);
      for (const value of seen) assert.equal(value, annotations);
    });

    it(`${kind} adopts successful zero-consumption inner state updates`, async () => {
      const inner: Parser<"sync", string, string> = {
        mode: "sync",
        $valueType: [],
        $stateType: [],
        priority: 0,
        usage: [],
        leadingNames: new Set(),
        acceptingAnyToken: true,
        initialState: "",
        parse(context) {
          return {
            success: true,
            next: {
              ...context,
              buffer: [],
              state: context.buffer[0] ?? `${context.state}!`,
            },
            consumed: context.buffer,
          };
        },
        complete: (state) => ({ success: true, value: state }),
        suggest: function* () {},
        getDocFragments: () => ({ fragments: [] }),
        getSuggestRuntimeNodes: (
          state,
          path,
        ) => [{ parser: inner, state, path }],
      };
      const source = bind(kind, inner);
      const parser = source.parser;
      const first = await parser.parse({
        buffer: ["original"],
        state: injectAnnotations(
          parser.initialState,
          await source.annotations(),
        ),
        optionsTerminated: false,
        usage: [],
      });
      assert.ok(first.success);
      const reparsed = await parser.parse(first.next);
      assert.ok(reparsed.success);
      const result = await parser.complete(reparsed.next.state);
      assert.ok(result.success);
      assert.equal(result.value, "original!");
      assert.ok(
        parser.getSuggestRuntimeNodes?.(reparsed.next.state, ["name"])
          .some((node) => node.state === "original!"),
      );
    });
  }

  for (const value of [string(), asyncString()]) {
    it(`retains the inner ${value.mode} config fallback when env is absent`, async () => {
      const source = bind("env-config", option("--name", value), {});
      const parser = tuple([
        multiple(option("--tag", string())),
        source.parser,
      ]);
      const annotations = await source.annotations();
      assert.deepEqual(
        await parseAsync(parser, ["--tag", "a", "--tag", "b"], { annotations }),
        { success: true, value: [["a", "b"], "configuration"] },
      );
    });
  }

  for (const kind of ["env-config", "config-env"] as const) {
    for (const value of [string(), asyncString()]) {
      it(`${kind} preserves nested ${value.mode} source precedence`, async () => {
        const source = bind(kind, option("--name", value));
        const parser = tuple([
          multiple(option("--tag", string())),
          source.parser,
        ]);
        const annotations = await source.annotations();
        assert.deepEqual(
          await parseAsync(parser, [
            "--name",
            "original",
            "--tag",
            "a",
            "--tag",
            "b",
          ], { annotations }),
          { success: true, value: [["a", "b"], "original"] },
        );
        assert.deepEqual(
          await parseAsync(parser, ["--tag", "c"], { annotations }),
          { success: true, value: [["c"], source.fallback] },
        );
      });
    }
  }
});
