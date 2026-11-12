import {
  choice,
  firstOf,
  integer,
  normalizeInput,
  string,
  transform,
  type ValueParser,
  type ValueParserResult,
  withSuggestions,
  type WithSuggestionsOptions,
} from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { object } from "#src/constructs.ts";
import { dependency, deriveFrom } from "#src/dependency.ts";
import { collectDocPages } from "#src/doc-pages.ts";
import {
  dependencyId,
  getSnapshottedDefaultDependencyValues,
  isDerivedValueParser,
  parseWithDependency,
  suggestWithDependency,
} from "#src/internal/dependency.ts";
import { getDocValue } from "#src/internal/doc-metadata.ts";
import { withDefault } from "#src/modifiers.ts";
import {
  parse,
  parseAsync,
  suggestAsync,
  type Suggestion,
  suggestSync,
} from "#src/parser.ts";
import { argument, option } from "#src/primitives.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

async function collect(
  iterable: Iterable<Suggestion> | AsyncIterable<Suggestion>,
): Promise<Suggestion[]> {
  const result: Suggestion[] = [];
  for await (const suggestion of iterable) result.push(suggestion);
  return result;
}

function texts(suggestions: readonly Suggestion[]): string[] {
  return suggestions.map((s) => s.kind === "literal" ? s.text : `<${s.type}>`);
}

function literal(text: string): Suggestion {
  return { kind: "literal", text };
}

describe("withSuggestions", () => {
  describe("preserved parsing behavior", () => {
    it("keeps validation and typed output of the wrapped parser", () => {
      const issue = withSuggestions(integer({ min: 1 }), {
        suggest: () => ["1", "2"],
      });
      const ok = issue.parse("42");
      assert.ok(ok.success);
      const value: number = ok.value;
      assert.equal(value, 42);
      assert.ok(!issue.parse("0").success);
      assert.ok(!issue.parse("abc").success);
      assert.equal(issue.mode, "sync");
      assert.equal(issue.metavar, "INTEGER");
      assert.equal(issue.format(7), "7");
    });

    it("does not call the provider on construction, parse, or format", () => {
      let calls = 0;
      const parser = withSuggestions(string(), {
        suggest() {
          calls++;
          return ["a"];
        },
      });
      parser.parse("x");
      parser.format("x");
      assert.equal(calls, 0);
      const iterable = parser.suggest!("");
      assert.equal(calls, 0);
      assert.deepEqual(texts(Array.from(iterable)), ["a"]);
      assert.equal(calls, 1);
      Array.from(parser.suggest!(""));
      assert.equal(calls, 2);
    });

    it("retains choices, normalize, validate, and lazy placeholder", () => {
      const level = withSuggestions(
        choice(["debug", "info"], { caseInsensitive: true }),
        { suggest: () => ["debug"] },
      );
      assert.deepEqual(level.choices, ["debug", "info"]);
      assert.equal(level.placeholder, "debug");

      let placeholderReads = 0;
      const inner: ValueParser<"sync", string> = {
        mode: "sync",
        metavar: "WORD",
        get placeholder(): string {
          placeholderReads++;
          return "p";
        },
        parse(input) {
          return { success: true, value: input };
        },
        format(value) {
          return value;
        },
        validate(value) {
          return value === "bad"
            ? { success: false, error: message`Bad.` }
            : { success: true, value };
        },
        normalize(value) {
          return value.toLowerCase();
        },
      };
      const wrapped = withSuggestions(inner, { suggest: () => [] });
      assert.equal(placeholderReads, 0);
      assert.equal(wrapped.placeholder, "p");
      assert.equal(placeholderReads, 1);
      assert.ok(!wrapped.validate?.("bad").success);
      assert.equal(wrapped.normalize?.("ABC"), "abc");
      assert.ok(!("choices" in wrapped));
    });

    it("omits hooks the wrapped parser does not define", () => {
      const wrapped = withSuggestions(string(), { suggest: () => [] });
      assert.ok(!("validate" in wrapped));
      assert.ok(!("normalize" in wrapped));
      assert.ok(!("choices" in wrapped));
    });

    it("preserves this for wrapped methods", async () => {
      const inner = {
        mode: "sync" as const,
        metavar: "WORD" as const,
        placeholder: "",
        suffix: "!",
        parse(this: { suffix: string }, input: string) {
          return { success: true as const, value: input + this.suffix };
        },
        format(this: { suffix: string }, value: string) {
          return value + this.suffix;
        },
        validate(this: { suffix: string }, value: string) {
          return { success: true as const, value: value + this.suffix };
        },
        normalize(this: { suffix: string }, value: string) {
          return value + this.suffix;
        },
        *suggest(this: { suffix: string }, prefix: string) {
          yield { kind: "literal" as const, text: prefix + this.suffix };
        },
      } satisfies ValueParser<"sync", string> & { suffix: string };
      const wrapped = withSuggestions(inner, {
        suggest: () => [],
        includeExisting: true,
      });
      assert.deepEqual(wrapped.parse("a"), { success: true, value: "a!" });
      assert.equal(wrapped.format("a"), "a!");
      assert.deepEqual(wrapped.validate?.("a"), { success: true, value: "a!" });
      assert.equal(wrapped.normalize?.("a"), "a!");
      assert.deepEqual(texts(await collect(wrapped.suggest!("a"))), ["a!"]);
    });

    it("passes the wrapped parse result object through unchanged", async () => {
      const result: ValueParserResult<string> = { success: true, value: "v" };
      const inner: ValueParser<"sync", string> = {
        mode: "sync",
        metavar: "WORD",
        placeholder: "",
        parse: () => result,
        format: (value) => value,
      };
      assert.equal(
        withSuggestions(inner, { suggest: () => [] }).parse(""),
        result,
      );
      const lifted = withSuggestions(inner, {
        mode: "async",
        suggest: () => [],
      });
      assert.equal(await lifted.parse(""), result);
    });

    it("forwards static documentation metadata", () => {
      const wrapped = withSuggestions(integer(), { suggest: () => [] });
      assert.deepEqual(getDocValue(wrapped), getDocValue(integer()));

      const withDefaultResult = collectDocPages(
        withDefault(option("--count", wrapped), 3),
      );
      const entry = withDefaultResult.entries[0].page.sections[0].entries[0];
      assert.ok(entry.default != null);

      const format = withSuggestions(choice(["json", "text"]), {
        suggest: () => ["json"],
      });
      const choices = collectDocPages(option("--format", format)).entries[0]
        .page.sections[0].entries[0].choices;
      assert.ok(choices != null);
    });
  });

  describe("modes", () => {
    it("keeps a sync parser sync with a sync provider", () => {
      const parser = withSuggestions(string(), {
        mode: "sync",
        suggest: () => [],
      });
      const mode: "sync" = parser.mode;
      assert.equal(mode, "sync");
      assert.ok(!(parser.parse("x") instanceof Promise));
    });

    it("lifts a sync parser to async with an async provider", async () => {
      const parser = withSuggestions(integer(), {
        mode: "async",
        async *suggest() {
          yield "1";
        },
      });
      const mode: "async" = parser.mode;
      assert.equal(mode, "async");
      const pending = parser.parse("5");
      assert.ok(pending instanceof Promise);
      assert.deepEqual(await pending, { success: true, value: 5 });
      const suggestions = parser.suggest!("");
      assert.ok(Symbol.asyncIterator in suggestions);
      assert.deepEqual(texts(await collect(suggestions)), ["1"]);
    });

    it("keeps an async parser async with a sync provider", async () => {
      const inner: ValueParser<"async", string> = {
        mode: "async",
        metavar: "WORD",
        placeholder: "",
        parse: (input) => Promise.resolve({ success: true, value: input }),
        format: (value) => value,
      };
      const parser = withSuggestions(inner, { suggest: () => ["a", "b"] });
      const mode: "async" = parser.mode;
      assert.equal(mode, "async");
      assert.deepEqual(await parser.parse("x"), { success: true, value: "x" });
      const suggestions = parser.suggest!("");
      assert.ok(Symbol.asyncIterator in suggestions);
      assert.deepEqual(texts(await collect(suggestions)), ["a", "b"]);
    });

    it("accepts async providers returning arrays or promised iterables", async () => {
      const fromArray = withSuggestions(string(), {
        mode: "async",
        suggest: () => ["a"],
      });
      const fromPromise = withSuggestions(string(), {
        mode: "async",
        suggest: () => Promise.resolve(["b"]),
      });
      const fromAsyncFunction = withSuggestions(string(), {
        mode: "async",
        async suggest() {
          return await Promise.resolve(["c"]);
        },
      });
      assert.deepEqual(texts(await collect(fromArray.suggest!(""))), ["a"]);
      assert.deepEqual(texts(await collect(fromPromise.suggest!(""))), ["b"]);
      assert.deepEqual(texts(await collect(fromAsyncFunction.suggest!(""))), [
        "c",
      ]);
    });

    it("turns sync parse throws into rejections only when lifting", async () => {
      const inner: ValueParser<"sync", string> = {
        mode: "sync",
        metavar: "WORD",
        placeholder: "",
        parse() {
          throw new RangeError("Boom.");
        },
        format: (value) => value,
      };
      const sync = withSuggestions(inner, { suggest: () => [] });
      assert.throws(() => sync.parse("x"), RangeError);
      const asyncInner: ValueParser<"async", string> = {
        mode: "async",
        metavar: "WORD",
        placeholder: "",
        parse() {
          throw new RangeError("Boom.");
        },
        format: (value) => value,
      };
      const alreadyAsync = withSuggestions(asyncInner, {
        mode: "async",
        suggest: () => [],
      });
      assert.throws(() => alreadyAsync.parse("x"), RangeError);
      const lifted = withSuggestions(inner, {
        mode: "async",
        suggest: () => [],
      });
      let result: Promise<unknown> | undefined;
      assert.doesNotThrow(() => {
        result = lifted.parse("x");
      });
      await assert.rejects(result!, RangeError);
    });
  });

  describe("suggestion semantics", () => {
    it("passes the raw prefix to the provider and filters literals", () => {
      const prefixes: string[] = [];
      const parser = withSuggestions(string(), {
        suggest(prefix) {
          prefixes.push(prefix);
          return ["alpha", "beta", "alps"];
        },
      });
      assert.deepEqual(texts(Array.from(parser.suggest!("al"))), [
        "alpha",
        "alps",
      ]);
      assert.deepEqual(prefixes, ["al"]);
    });

    it("accepts strings and Suggestion objects and keeps descriptions", () => {
      const description = message`Issue title`;
      const parser = withSuggestions(string(), {
        suggest: () => [
          "1",
          { kind: "literal", text: "12", description },
          { kind: "file", type: "file", pattern: "x" },
        ],
      });
      assert.deepEqual(Array.from(parser.suggest!("1")), [
        { kind: "literal", text: "1" },
        { kind: "literal", text: "12", description },
        { kind: "file", type: "file", pattern: "x" },
      ]);
    });

    it("skips malformed items", () => {
      const parser = withSuggestions(string(), {
        suggest: () =>
          [
            "ok",
            42,
            null,
            { kind: "literal", text: 1 },
            { kind: "file" },
            { kind: "file", type: "socket" },
            { kind: "other", text: "x" },
            { kind: "file", type: "directory" },
          ] as never,
      });
      assert.deepEqual(texts(Array.from(parser.suggest!(""))), [
        "ok",
        "<directory>",
      ]);
    });

    it("skips items whose optional fields have the wrong type", () => {
      const parser = withSuggestions(string(), {
        suggest: () =>
          [
            { kind: "literal", text: "bad-description", description: "x" },
            { kind: "file", type: "file", pattern: 42 },
            { kind: "file", type: "file", prefix: 1 },
            { kind: "file", type: "file", extensions: ".ts" },
            { kind: "file", type: "file", extensions: [1] },
            { kind: "file", type: "file", includeHidden: "yes" },
            { kind: "file", type: "file", description: 1 },
            { kind: "literal", text: "ok", description: message`Fine` },
            {
              kind: "file",
              type: "file",
              pattern: "src/",
              prefix: "src/",
              extensions: [".ts"],
              includeHidden: true,
            },
          ] as never,
      });
      const suggestions = Array.from(parser.suggest!(""));
      assert.deepEqual(texts(suggestions), ["ok", "<file>"]);
    });

    it("replaces existing suggestions by default", () => {
      const parser = withSuggestions(choice(["red", "green"]), {
        suggest: () => ["rose"],
      });
      assert.deepEqual(texts(Array.from(parser.suggest!("r"))), ["rose"]);
    });

    it("can include existing suggestions first and deduplicates literals", () => {
      const parser = withSuggestions(choice(["red", "green"]), {
        includeExisting: true,
        suggest: () => [
          { kind: "literal", text: "red", description: message`dup` },
          "rose",
          "rose",
        ],
      });
      assert.deepEqual(Array.from(parser.suggest!("r")), [
        { kind: "literal", text: "red" },
        { kind: "literal", text: "rose" },
      ]);
    });

    it("deduplicates provider literals without includeExisting", () => {
      const parser = withSuggestions(string(), {
        suggest: () => ["a", "a", { kind: "literal", text: "a" }],
      });
      assert.deepEqual(texts(Array.from(parser.suggest!(""))), ["a"]);
    });

    it("does not deduplicate file suggestions", () => {
      const file = { kind: "file", type: "file" } as const;
      const parser = withSuggestions(string(), { suggest: () => [file, file] });
      assert.equal(Array.from(parser.suggest!("")).length, 2);
    });

    it("can keep provider literals that do not match the prefix", () => {
      const provider = (prefix: string) =>
        ["Foo", "fop", "bar"].filter((name) =>
          name.toLowerCase().startsWith(prefix.toLowerCase())
        );
      const filtered = withSuggestions(string(), { suggest: provider });
      assert.deepEqual(texts(Array.from(filtered.suggest!("fo"))), ["fop"]);
      const unfiltered = withSuggestions(string(), {
        filterByPrefix: false,
        suggest: provider,
      });
      assert.deepEqual(texts(Array.from(unfiltered.suggest!("fo"))), [
        "Foo",
        "fop",
      ]);
    });

    it("chains nested wrappers", () => {
      const inner = withSuggestions(string(), { suggest: () => ["a"] });
      assert.deepEqual(
        texts(Array.from(
          withSuggestions(inner, { suggest: () => ["b"] }).suggest!(""),
        )),
        ["b"],
      );
      assert.deepEqual(
        texts(Array.from(
          withSuggestions(inner, {
            includeExisting: true,
            suggest: () => ["b"],
          }).suggest!(""),
        )),
        ["a", "b"],
      );
    });

    it("filters only provider items when composed with normalizeInput", () => {
      const trim = (input: string) => input.trim();
      const inner = normalizeInput(choice(["debug", "info"]), trim);
      const outer = withSuggestions(inner, {
        includeExisting: true,
        suggest: () => [" debugger", "dump"],
      });
      assert.deepEqual(texts(Array.from(outer.suggest!(" de"))), [
        "debug",
        " debugger",
      ]);

      const reversed = normalizeInput(
        withSuggestions(choice(["debug", "info"]), {
          includeExisting: true,
          suggest: () => ["deploy", "info"],
        }),
        trim,
      );
      assert.deepEqual(texts(Array.from(reversed.suggest!(" de"))), [
        "debug",
        "deploy",
      ]);
    });
  });

  describe("failure policy", () => {
    it("ignores a provider that throws when called", async () => {
      const sync = withSuggestions(string(), {
        suggest() {
          throw new Error("Down.");
        },
      });
      assert.deepEqual(Array.from(sync.suggest!("")), []);
      const asyncParser = withSuggestions(string(), {
        mode: "async",
        suggest() {
          throw new Error("Down.");
        },
      });
      assert.deepEqual(await collect(asyncParser.suggest!("")), []);
    });

    it("ignores a rejected async provider", async () => {
      const parser = withSuggestions(string(), {
        mode: "async",
        suggest: () => Promise.reject(new Error("Down.")),
      });
      assert.deepEqual(await collect(parser.suggest!("")), []);
    });

    it("keeps items yielded before a mid-iteration failure", async () => {
      const sync = withSuggestions(string(), {
        *suggest() {
          yield "a";
          throw new Error("Down.");
        },
      });
      assert.deepEqual(texts(Array.from(sync.suggest!(""))), ["a"]);
      const asyncParser = withSuggestions(string(), {
        mode: "async",
        async *suggest() {
          yield "a";
          yield "b";
          throw new Error("Down.");
        },
      });
      assert.deepEqual(texts(await collect(asyncParser.suggest!(""))), [
        "a",
        "b",
      ]);
    });

    it("ends a source when processing an item throws", () => {
      const hostile = {
        kind: "literal",
        get text(): string {
          throw new Error("Hostile.");
        },
      };
      const parser = withSuggestions(string(), {
        suggest: () => ["a", hostile as Suggestion, "b"],
      });
      assert.deepEqual(texts(Array.from(parser.suggest!(""))), ["a"]);
    });

    it("continues with the provider when existing suggestions fail", async () => {
      const inner: ValueParser<"sync", string> = {
        mode: "sync",
        metavar: "WORD",
        placeholder: "",
        parse: (input) => ({ success: true, value: input }),
        format: (value) => value,
        *suggest() {
          yield { kind: "literal", text: "x1" };
          throw new Error("Down.");
        },
      };
      const parser = withSuggestions(inner, {
        includeExisting: true,
        suggest: () => ["x2"],
      });
      assert.deepEqual(texts(Array.from(parser.suggest!("x"))), ["x1", "x2"]);
      const lifted = withSuggestions(inner, {
        mode: "async",
        includeExisting: true,
        suggest: () => ["x2"],
      });
      assert.deepEqual(texts(await collect(lifted.suggest!("x"))), [
        "x1",
        "x2",
      ]);
    });

    it("yields nothing for invalid sync-mode provider results", () => {
      let rejected = 0;
      const results: unknown[] = [
        "abc",
        42,
        null,
        Promise.resolve(["a"]),
        (async function* () {
          yield "a";
        })(),
        {
          then(_resolve: unknown, reject: (e: unknown) => void) {
            rejected++;
            reject(new Error("Down."));
          },
        },
      ];
      for (const result of results) {
        const parser = withSuggestions(string(), {
          suggest: () => result as Iterable<string>,
        });
        assert.deepEqual(Array.from(parser.suggest!("")), []);
      }
      return new Promise<void>((resolve) =>
        setTimeout(() => {
          assert.equal(rejected, 1);
          resolve();
        }, 0)
      );
    });

    it("rejects async iterables from sync-mode providers on async parsers", async () => {
      const inner: ValueParser<"async", string> = {
        mode: "async",
        metavar: "WORD",
        placeholder: "",
        parse: (input) => Promise.resolve({ success: true, value: input }),
        format: (value) => value,
      };
      const parser = withSuggestions(inner, {
        suggest: () =>
          (async function* () {
            yield "unexpected";
          })() as never,
      });
      assert.deepEqual(await collect(parser.suggest!("")), []);
    });

    it("iterates dual-protocol results from sync-mode providers synchronously", async () => {
      const inner: ValueParser<"async", string> = {
        mode: "async",
        metavar: "WORD",
        placeholder: "",
        parse: (input) => Promise.resolve({ success: true, value: input }),
        format: (value) => value,
      };
      const dual = {
        *[Symbol.iterator]() {
          yield "sync-candidate";
        },
        async *[Symbol.asyncIterator]() {
          yield "async-candidate";
        },
      };
      const options = { suggest: () => dual };
      const syncParser = withSuggestions(string(), options);
      const asyncParser = withSuggestions(inner, options);
      assert.deepEqual(texts(Array.from(syncParser.suggest!(""))), [
        "sync-candidate",
      ]);
      assert.deepEqual(texts(await collect(asyncParser.suggest!(""))), [
        "sync-candidate",
      ]);
    });

    it("accepts callable iterables", async () => {
      const callable = Object.assign(() => {}, {
        *[Symbol.iterator]() {
          yield "valid";
        },
      });
      const sync = withSuggestions(string(), { suggest: () => callable });
      assert.deepEqual(texts(Array.from(sync.suggest!(""))), ["valid"]);
      const asyncCallable = Object.assign(() => {}, {
        async *[Symbol.asyncIterator]() {
          yield "valid";
        },
      });
      const asyncParser = withSuggestions(string(), {
        mode: "async",
        suggest: () => asyncCallable,
      });
      assert.deepEqual(texts(await collect(asyncParser.suggest!(""))), [
        "valid",
      ]);
    });

    it("handles rejecting promises from sync-mode providers on async parsers", async () => {
      const inner: ValueParser<"async", string> = {
        mode: "async",
        metavar: "WORD",
        placeholder: "",
        parse: (input) => Promise.resolve({ success: true, value: input }),
        format: (value) => value,
      };
      const parser = withSuggestions(inner, {
        suggest: () => Promise.reject(new Error("Down.")) as never,
      });
      assert.deepEqual(await collect(parser.suggest!("")), []);
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    it("yields nothing for a bare string returned in async mode", async () => {
      const parser = withSuggestions(string(), {
        mode: "async",
        suggest: () => Promise.resolve("abc" as never),
      });
      assert.deepEqual(await collect(parser.suggest!("")), []);
    });
  });

  describe("early termination", () => {
    function closingSource(
      closed: string[],
      name: string,
      throwOnClose: boolean,
    ): Iterable<string> {
      return {
        [Symbol.iterator]() {
          let i = 0;
          return {
            next() {
              i++;
              return { done: false, value: `${name}${i}` };
            },
            return() {
              closed.push(name);
              if (throwOnClose) throw new Error("Close failed.");
              return { done: true, value: undefined };
            },
          };
        },
      };
    }

    function closingAsyncSource(
      closed: string[],
      name: string,
      throwOnClose: boolean,
    ): AsyncIterable<string> {
      return {
        [Symbol.asyncIterator]() {
          let i = 0;
          return {
            next() {
              i++;
              return Promise.resolve({ done: false, value: `${name}${i}` });
            },
            return() {
              closed.push(name);
              if (throwOnClose) {
                return Promise.reject(new Error("Close failed."));
              }
              return Promise.resolve({ done: true, value: undefined });
            },
          };
        },
      };
    }

    for (const throwOnClose of [false, true]) {
      it(`closes the existing source in sync mode (throwOnClose=${throwOnClose})`, () => {
        const closed: string[] = [];
        let providerCalls = 0;
        const inner: ValueParser<"sync", string> = {
          mode: "sync",
          metavar: "WORD",
          placeholder: "",
          parse: (input) => ({ success: true, value: input }),
          format: (value) => value,
          *suggest() {
            for (const text of closingSource(closed, "e", throwOnClose)) {
              yield { kind: "literal", text };
            }
          },
        };
        const parser = withSuggestions(inner, {
          includeExisting: true,
          suggest() {
            providerCalls++;
            return ["p"];
          },
        });
        const iterator = parser.suggest!("")[Symbol.iterator]();
        assert.deepEqual(iterator.next(), {
          done: false,
          value: literal("e1"),
        });
        assert.deepEqual(iterator.return?.(), {
          done: true,
          value: undefined,
        });
        assert.deepEqual(iterator.next(), { done: true, value: undefined });
        assert.deepEqual(closed, ["e"]);
        assert.equal(providerCalls, 0);
      });

      it(`closes the provider source in sync mode (throwOnClose=${throwOnClose})`, () => {
        const closed: string[] = [];
        const parser = withSuggestions(string(), {
          suggest: () => closingSource(closed, "p", throwOnClose),
        });
        const iterator = parser.suggest!("")[Symbol.iterator]();
        assert.deepEqual(iterator.next(), {
          done: false,
          value: literal("p1"),
        });
        assert.deepEqual(iterator.return?.(), {
          done: true,
          value: undefined,
        });
        assert.deepEqual(closed, ["p"]);
      });

      it(`closes the existing source in async mode (throwOnClose=${throwOnClose})`, async () => {
        const closed: string[] = [];
        let providerCalls = 0;
        const inner: ValueParser<"async", string> = {
          mode: "async",
          metavar: "WORD",
          placeholder: "",
          parse: (input) => Promise.resolve({ success: true, value: input }),
          format: (value) => value,
          async *suggest() {
            for await (
              const text of closingAsyncSource(closed, "e", throwOnClose)
            ) {
              yield { kind: "literal", text };
            }
          },
        };
        const parser = withSuggestions(inner, {
          mode: "async",
          includeExisting: true,
          suggest() {
            providerCalls++;
            return ["p"];
          },
        });
        const iterator = parser.suggest!("")[Symbol.asyncIterator]();
        assert.deepEqual(await iterator.next(), {
          done: false,
          value: literal("e1"),
        });
        assert.deepEqual(await iterator.return?.(), {
          done: true,
          value: undefined,
        });
        assert.deepEqual(await iterator.next(), {
          done: true,
          value: undefined,
        });
        assert.deepEqual(closed, ["e"]);
        assert.equal(providerCalls, 0);
      });

      it(`closes the provider source in async mode (throwOnClose=${throwOnClose})`, async () => {
        const closed: string[] = [];
        const parser = withSuggestions(string(), {
          mode: "async",
          suggest: () => closingAsyncSource(closed, "p", throwOnClose),
        });
        const iterator = parser.suggest!("")[Symbol.asyncIterator]();
        assert.deepEqual(await iterator.next(), {
          done: false,
          value: literal("p1"),
        });
        assert.deepEqual(await iterator.return?.(), {
          done: true,
          value: undefined,
        });
        assert.deepEqual(closed, ["p"]);
      });
    }
  });

  describe("integration with primitives", () => {
    const branch = withSuggestions(string({ metavar: "BRANCH" }), {
      suggest: () => ["main", "maint", "dev"],
    });

    it("completes option values in separate and joined forms", () => {
      const parser = object({ branch: option("--branch", branch) });
      assert.deepEqual(texts(suggestSync(parser, ["--branch", "ma"])), [
        "main",
        "maint",
      ]);
      assert.deepEqual(texts(suggestSync(parser, ["--branch=ma"])), [
        "--branch=main",
        "--branch=maint",
      ]);
    });

    it("completes argument values", () => {
      const parser = object({ branch: argument(branch) });
      assert.deepEqual(texts(suggestSync(parser, ["d"])), ["dev"]);
    });

    it("completes async option and argument values", async () => {
      const remote = withSuggestions(integer({ min: 1 }), {
        mode: "async",
        async *suggest(prefix) {
          await Promise.resolve();
          yield* ["10", "11", "20"].filter((n) => n.startsWith(prefix));
        },
      });
      const opt = object({ issue: option("--issue", remote) });
      assert.deepEqual(texts(await suggestAsync(opt, ["--issue", "1"])), [
        "10",
        "11",
      ]);
      const arg = object({ issue: argument(remote) });
      assert.deepEqual(texts(await suggestAsync(arg, ["2"])), ["20"]);
      const parsed = await parseAsync(opt, ["--issue", "11"]);
      assert.ok(parsed.success);
      assert.equal(parsed.value.issue, 11);
      const invalid = await parseAsync(opt, ["--issue", "0"]);
      assert.ok(!invalid.success);
    });
  });

  describe("dependencies", () => {
    it("rejects dependency sources and supports wrapping before dependency()", () => {
      assert.throws(
        () => withSuggestions(dependency(string()), { suggest: () => [] }),
        /dependency source/u,
      );
      const source = dependency(
        withSuggestions(choice(["dev", "prod"]), { suggest: () => ["dev"] }),
      );
      const parser = object({ env: option("--env", source) });
      assert.deepEqual(texts(suggestSync(parser, ["--env", ""])), ["dev"]);
      const parsed = parse(parser, ["--env", "prod"]);
      assert.ok(parsed.success);
      assert.equal(parsed.value.env, "prod");
    });

    function levels() {
      const env = dependency(choice(["dev", "prod"] as const));
      const level = env.derive({
        metavar: "LEVEL",
        mode: "sync",
        factory: (value) =>
          choice(value === "dev" ? ["debug"] as const : ["warn"] as const),
        defaultValue: () => "dev" as const,
      });
      return { env, level };
    }

    it("preserves derived metadata and replay", () => {
      const { env, level } = levels();
      const wrapped = withSuggestions(level, { suggest: () => ["custom"] });
      assert.ok(isDerivedValueParser(wrapped));
      assert.equal(wrapped[dependencyId], level[dependencyId]);
      const initial = wrapped.parse("debug");
      assert.deepEqual(getSnapshottedDefaultDependencyValues(initial), ["dev"]);
      const parser = object({
        env: option("--env", env),
        level: option("--level", wrapped),
      });
      const parsed = parse(parser, ["--env", "prod", "--level", "warn"]);
      assert.ok(parsed.success);
      assert.equal(parsed.value.level, "warn");
      assert.ok(!parse(parser, ["--env", "prod", "--level", "debug"]).success);
    });

    it("uses the provider for defaults-only and actual-value completion", () => {
      const { env, level } = levels();
      const replace = withSuggestions(level, { suggest: () => ["custom"] });
      const parser = object({
        env: option("--env", env),
        level: option("--level", replace),
      });
      assert.deepEqual(texts(suggestSync(parser, ["--level", ""])), [
        "custom",
      ]);
      assert.deepEqual(
        texts(suggestSync(parser, ["--env", "prod", "--level", ""])),
        ["custom"],
      );

      const augment = withSuggestions(level, {
        includeExisting: true,
        suggest: () => ["custom"],
      });
      const augmented = object({
        env: option("--env", env),
        level: option("--level", augment),
      });
      assert.deepEqual(texts(suggestSync(augmented, ["--level", ""])), [
        "debug",
        "custom",
      ]);
      assert.deepEqual(
        texts(suggestSync(augmented, ["--env", "prod", "--level", ""])),
        ["warn", "custom"],
      );
    });

    it("handles a failed dependency source", () => {
      const { env, level } = levels();
      // A replacing provider does not depend on the source, so it still runs:
      const replace = withSuggestions(level, { suggest: () => ["custom"] });
      assert.ok(!(suggestWithDependency in replace));
      const replaced = object({
        env: option("--env", env),
        level: option("--level", replace),
      });
      assert.deepEqual(
        texts(suggestSync(replaced, ["--env", "staging", "--level", ""])),
        ["custom"],
      );
      // With includeExisting, the dependency-aware hook keeps suppressing:
      let calls = 0;
      const augment = withSuggestions(level, {
        includeExisting: true,
        suggest() {
          calls++;
          return ["custom"];
        },
      });
      const augmented = object({
        env: option("--env", env),
        level: option("--level", augment),
      });
      assert.deepEqual(
        suggestSync(augmented, ["--env", "staging", "--level", ""]),
        [],
      );
      assert.equal(calls, 0);
    });

    it("supports deriveFrom() with partial actual values", () => {
      const region = dependency(choice(["us", "eu"] as const));
      const tier = dependency(choice(["free", "paid"] as const));
      const plan = deriveFrom({
        metavar: "PLAN",
        mode: "sync",
        dependencies: [region, tier] as const,
        factory: (r, t) => choice([`${r}-${t}`]),
        defaultValues: () => ["us", "free"] as const,
      });
      const wrapped = withSuggestions(plan, {
        includeExisting: true,
        suggest: () => ["custom"],
      });
      const parser = object({
        region: option("--region", region),
        tier: option("--tier", tier),
        plan: option("--plan", wrapped),
      });
      assert.deepEqual(
        texts(suggestSync(parser, ["--region", "eu", "--plan", ""])),
        ["eu-free", "custom"],
      );
      const parsed = parse(parser, [
        "--region",
        "eu",
        "--tier",
        "paid",
        "--plan",
        "eu-paid",
      ]);
      assert.ok(parsed.success);
      assert.equal(parsed.value.plan, "eu-paid");
    });

    it("lifts a sync derived parser to async, including replay", async () => {
      const { env, level } = levels();
      const wrapped = withSuggestions(level, {
        mode: "async",
        includeExisting: true,
        async *suggest() {
          yield "custom";
        },
      });
      assert.equal(wrapped.mode, "async");
      assert.ok(isDerivedValueParser(wrapped));
      const replay = wrapped[parseWithDependency]("warn", "prod");
      assert.ok(replay instanceof Promise);
      assert.deepEqual(await replay, { success: true, value: "warn" });
      const parser = object({
        env: option("--env", env),
        level: option("--level", wrapped),
      });
      const parsed = await parseAsync(parser, [
        "--env",
        "prod",
        "--level",
        "warn",
      ]);
      assert.ok(parsed.success);
      assert.equal(parsed.value.level, "warn");
      assert.deepEqual(
        texts(await suggestAsync(parser, ["--env", "prod", "--level", ""])),
        ["warn", "custom"],
      );
      const hook = wrapped[suggestWithDependency];
      assert.ok(hook != null);
      assert.deepEqual(texts(await collect(hook("", "dev"))), [
        "debug",
        "custom",
      ]);
    });

    it("turns sync replay throws into rejections when lifting", async () => {
      const env = dependency(string());
      const level = env.derive({
        metavar: "LEVEL",
        mode: "sync",
        factory: (value): ValueParser<"sync", string> => ({
          mode: "sync",
          metavar: "LEVEL",
          placeholder: "",
          parse(input) {
            if (value === "boom") throw new RangeError("Boom.");
            return { success: true, value: input };
          },
          format: (v) => v,
        }),
        defaultValue: () => "ok",
      });
      const wrapped = withSuggestions(level, {
        mode: "async",
        suggest: () => [],
      });
      assert.ok(isDerivedValueParser(wrapped));
      let replay: Promise<unknown> | undefined;
      assert.doesNotThrow(() => {
        replay = wrapped[parseWithDependency]("x", "boom") as Promise<unknown>;
      });
      await assert.rejects(replay!, RangeError);
    });

    it("handles async sources with sync factories", async () => {
      const asyncEnv: ValueParser<"async", "dev" | "prod"> = {
        mode: "async",
        metavar: "ENV",
        placeholder: "dev",
        parse: (input) =>
          Promise.resolve(
            input === "dev" || input === "prod"
              ? { success: true, value: input }
              : { success: false, error: message`Bad env.` },
          ),
        format: (value) => value,
      };
      const env = dependency(asyncEnv);
      const level = env.deriveSync({
        metavar: "LEVEL",
        factory: (value) => choice(value === "dev" ? ["debug"] : ["warn"]),
        defaultValue: () => "dev" as const,
      });
      const wrapped = withSuggestions(level, {
        includeExisting: true,
        suggest: () => ["custom"],
      });
      assert.equal(wrapped.mode, "async");
      const parser = object({
        env: option("--env", env),
        level: option("--level", wrapped),
      });
      assert.deepEqual(
        texts(await suggestAsync(parser, ["--env", "prod", "--level", ""])),
        ["warn", "custom"],
      );
    });
  });

  describe("types and composition", () => {
    it("infers result modes from the options", () => {
      const sync: ValueParser<"sync", number> = withSuggestions(integer(), {
        suggest: () => ["1"],
      });
      const lifted: ValueParser<"async", number> = withSuggestions(integer(), {
        mode: "async",
        suggest: () => Promise.resolve(["1"]),
      });
      // @ts-expect-error: an async provider makes the parser async.
      const notSync: ValueParser<"sync", number> = lifted;
      // @ts-expect-error: async generators need mode: "async".
      const misdeclared = withSuggestions(integer(), {
        async *suggest() {
          yield "1";
        },
      });
      assert.deepEqual(Array.from(misdeclared.suggest!("")), []);
      const options: WithSuggestionsOptions = Math.random() < 2
        ? { mode: "async", suggest: () => [] }
        : { suggest: () => [] };
      const either: ValueParser<"sync" | "async", number> = withSuggestions(
        integer(),
        options,
      );
      assert.equal(sync.mode, "sync");
      assert.equal(notSync.mode, "async");
      assert.equal(either.mode, "async");
    });

    it("does not call the provider for failed parses or help", () => {
      let calls = 0;
      const level = withSuggestions(choice(["debug", "info"]), {
        suggest() {
          calls++;
          return ["debug"];
        },
      });
      const parser = object({ level: option("--level", level) });
      assert.ok(!parse(parser, ["--level", "trace"]).success);
      collectDocPages(parser);
      assert.equal(calls, 0);
    });

    it("composes with transform() and keyValue()-style consumers", () => {
      const upper = transform(
        withSuggestions(string(), { suggest: () => ["ab", "ac"] }),
        {
          map: (value) => value.toUpperCase(),
          unmap: (value) => value.toLowerCase(),
        },
      );
      assert.deepEqual(texts(Array.from(upper.suggest!("a"))), ["ab", "ac"]);
      const failing = withSuggestions(string(), {
        suggest() {
          throw new Error("Down.");
        },
      });
      const either = firstOf(failing, integer());
      assert.doesNotThrow(() => Array.from(either.suggest!("")));
    });
  });

  describe("argument validation", () => {
    it("rejects invalid arguments", () => {
      assert.throws(
        () => withSuggestions(null as never, { suggest: () => [] }),
        TypeError,
      );
      assert.throws(() => withSuggestions(string(), null as never), TypeError);
      assert.throws(
        () => withSuggestions(string(), { suggest: null as never }),
        TypeError,
      );
      assert.throws(
        () =>
          withSuggestions(string(), {
            mode: "fast" as never,
            suggest: () => [],
          }),
        TypeError,
      );
      assert.throws(
        () =>
          withSuggestions(string(), {
            includeExisting: "yes" as never,
            suggest: () => [],
          }),
        TypeError,
      );
      assert.throws(
        () =>
          withSuggestions(string(), {
            filterByPrefix: 1 as never,
            suggest: () => [],
          }),
        TypeError,
      );
    });
  });
});
