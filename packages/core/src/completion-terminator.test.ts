import { object } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import {
  type Parser,
  suggest,
  suggestAsync,
  type Suggestion,
} from "@optique/core/parser";
import { argument, command, flag, option } from "@optique/core/primitives";
import { string, type ValueParser } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function valueSuggestions(prefix: string): Suggestion[] {
  return ["alpha", "--positional"].filter((text) => text.startsWith(prefix))
    .map(
      (text) => ({ kind: "literal", text }),
    );
}

const syncValues: ValueParser<"sync", string> = {
  ...string(),
  suggest: valueSuggestions,
};

const asyncValues: ValueParser<"async", string> = {
  ...syncValues,
  mode: "async",
  parse(input) {
    return Promise.resolve(syncValues.parse(input));
  },
  async *suggest(prefix) {
    yield* valueSuggestions(prefix);
  },
};

async function terminatedSuggestions<T, TState>(
  parser: Parser<"sync" | "async", T, TState>,
  prefix: string,
  buffer: readonly string[] = [],
): Promise<readonly Suggestion[]> {
  const suggestions: Suggestion[] = [];
  for await (
    const suggestion of parser.suggest({
      buffer,
      state: parser.initialState,
      optionsTerminated: true,
      usage: parser.usage,
    }, prefix)
  ) {
    suggestions.push(suggestion);
  }
  return suggestions;
}

describe("completion after the option terminator", () => {
  it("does not suggest the option from issue 1028", () => {
    const parser = object({ foo: option("--foo", string()) });
    assert.deepEqual(suggest(parser, ["--", "--"]), []);
  });

  for (const valueParser of [syncValues, asyncValues]) {
    describe(valueParser.mode, () => {
      it("does not suggest option aliases after termination", async () => {
        const parser = object({
          foo: option("--foo", "-f", "/foo", valueParser),
        });
        for (const prefix of ["--", "--f", "-", "-f", "/f"]) {
          assert.deepEqual(await suggest(parser, ["--", prefix]), [], prefix);
          assert.deepEqual(
            await suggestAsync(parser, ["--", prefix]),
            [],
            prefix,
          );
        }
      });

      it("does not suggest joined option values after termination", async () => {
        const parser = object({ foo: option("--foo", valueParser) });
        assert.deepEqual(await suggest(parser, ["--", "--foo=a"]), []);
        assert.deepEqual(await suggestAsync(parser, ["--", "--foo=a"]), []);
      });

      it("does not suggest values on the parse-failure fallback", async () => {
        const parser = object({ foo: option("--foo", valueParser) });
        assert.deepEqual(await suggest(parser, ["--", "--foo", "a"]), []);
        assert.deepEqual(await suggestAsync(parser, ["--", "--foo", "a"]), []);
      });

      it("respects termination in direct option suggestions", async () => {
        const parser = option("--foo", valueParser);
        assert.deepEqual(await terminatedSuggestions(parser, "--"), []);
        assert.deepEqual(await terminatedSuggestions(parser, "--foo=a"), []);
        assert.deepEqual(
          await terminatedSuggestions(parser, "a", ["--foo"]),
          [],
        );
      });

      it("keeps options available while -- is only the prefix", async () => {
        const parser = object({ foo: option("--foo", valueParser) });
        assert.deepEqual(await suggest(parser, ["--"]), [
          { kind: "literal", text: "--foo" },
        ]);
      });

      it("keeps option value completion before termination", async () => {
        const parser = object({ foo: option("--foo", valueParser) });
        assert.deepEqual(await suggest(parser, ["--foo", "a"]), [
          { kind: "literal", text: "alpha" },
        ]);
        assert.deepEqual(await suggest(parser, ["--foo=a"]), [
          { kind: "literal", text: "--foo=alpha", description: undefined },
        ]);
      });

      it("does not terminate when -- is consumed as an option value", async () => {
        const parser = object({
          foo: option("--foo", valueParser),
          bar: option("--bar"),
        });
        assert.deepEqual(await suggest(parser, ["--foo", "--", "--b"]), [
          { kind: "literal", text: "--bar" },
        ]);
      });

      it("keeps positional completion after termination", async () => {
        const parser = object({
          foo: optional(option("--foo", valueParser)),
          positional: argument(valueParser),
        });
        assert.deepEqual(await suggest(parser, ["--", "--"]), [
          { kind: "literal", text: "--positional" },
        ]);
        assert.deepEqual(await suggest(parser, ["--", ""]), [
          { kind: "literal", text: "alpha" },
          { kind: "literal", text: "--positional" },
        ]);
      });

      it("respects termination inside a command", async () => {
        const parser = command(
          "run",
          object({ foo: option("--foo", valueParser) }),
        );
        assert.deepEqual(await suggest(parser, ["run", "--", "--"]), []);
      });
    });
  }

  for (
    const [name, parser] of [
      ["boolean options", option("--foo", "-f", "/foo")],
      ["flags", flag("--foo", "-f", "/foo")],
    ] as const
  ) {
    it(`does not suggest terminated ${name}`, async () => {
      for (const prefix of ["--", "--f", "-", "-f", "/f"]) {
        assert.deepEqual(suggest(parser, ["--", prefix]), [], prefix);
        assert.deepEqual(
          await suggestAsync(parser, ["--", prefix]),
          [],
          prefix,
        );
        assert.deepEqual(
          await terminatedSuggestions(parser, prefix),
          [],
          prefix,
        );
      }
      assert.deepEqual(suggest(parser, ["--"]), [
        { kind: "literal", text: "--foo" },
      ]);
    });
  }

  it("does not invoke a sync option's file suggestion callback after termination", async () => {
    let calls = 0;
    const parser = option("--foo", {
      ...syncValues,
      suggest(): Iterable<Suggestion> {
        calls++;
        return [{ kind: "file", type: "any", pattern: "*.txt" }];
      },
    });
    assert.deepEqual(await terminatedSuggestions(parser, "--foo="), []);
    assert.deepEqual(await terminatedSuggestions(parser, "", ["--foo"]), []);
    assert.equal(calls, 0);
  });

  it("does not invoke an async option's file suggestion callback after termination", async () => {
    let calls = 0;
    const parser = option("--foo", {
      ...asyncValues,
      async *suggest(): AsyncIterable<Suggestion> {
        calls++;
        yield { kind: "file", type: "any", pattern: "*.txt" };
      },
    });
    assert.deepEqual(await terminatedSuggestions(parser, "--foo="), []);
    assert.deepEqual(await terminatedSuggestions(parser, "", ["--foo"]), []);
    assert.equal(calls, 0);
  });
});
