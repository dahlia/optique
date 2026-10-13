import { bash, zsh } from "./completion.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { parse, suggest, suggestAsync, type Suggestion } from "./parser.ts";
import { option } from "./primitives.ts";
import { choice, string, type ValueParser } from "./valueparser.ts";

for (const pattern of ["src/*.toml", "src/file?.toml"]) {
  it(`retains a fixed wildcard equal to its typed value (${pattern})`, () => {
    const files: ValueParser<"sync", string> = {
      ...string(),
      *suggest() {
        yield { kind: "file", type: "file", pattern };
      },
    };
    const result = suggest(option("--config", files), [`--config=${pattern}`]);
    assert.equal(
      Array.from(bash.encodeSuggestions(result)).join(""),
      `__JOINED_FILE__:--config=:file::${pattern}:0`,
    );
    assert.equal(
      Array.from(zsh.encodeSuggestions(result)).join(""),
      `--config=${pattern}\0\0`,
    );
  });
}

for (const control of ["\n", "\r", "\t", "\0"]) {
  it(`sanitizes ${JSON.stringify(control)} in joined fixed file patterns`, () => {
    const files: ValueParser<"sync", string> = {
      ...string(),
      *suggest() {
        yield {
          kind: "file",
          type: "file",
          pattern: `src/${control}name:%*.toml`,
        };
      },
    };
    const result = suggest(option("--config", files), ["--config="]);
    assert.equal(
      Array.from(bash.encodeSuggestions(result)).join(""),
      "__JOINED_FILE__:--config=:file::src/ name%3A%25*.toml:0",
    );
    assert.equal(
      Array.from(zsh.encodeSuggestions(result)).join(""),
      "--config=src/ name:%*.toml\0\0",
    );
  });
}

describe("option value completion prefixes", () => {
  for (const mode of ["sync", "async"] as const) {
    it(`passes equals-containing value prefixes and preserves metadata in ${mode} mode`, async () => {
      const seen: string[] = [];
      function* suggestions(prefix: string): Generator<Suggestion> {
        seen.push(prefix);
        if (!prefix.includes("=")) return;
        yield {
          kind: "file",
          type: "file",
          pattern: prefix,
          extensions: [".toml"],
          includeHidden: true,
        };
      }
      const sync: ValueParser<"sync", string> = {
        ...string(),
        suggest: suggestions,
      };
      const async: ValueParser<"async", string> = {
        ...sync,
        mode: "async",
        parse(input) {
          return Promise.resolve(sync.parse(input));
        },
        async *suggest(prefix) {
          yield* suggestions(prefix);
        },
      };
      const parser = option("--config", mode === "sync" ? sync : async);
      for (const api of ["suggest", "suggestAsync"] as const) {
        seen.length = 0;
        const result = api === "suggest"
          ? await suggest(parser, ["--config", "name=fo"])
          : await suggestAsync(parser, ["--config", "name=fo"]);
        assert.ok(seen.length > 0);
        assert.ok(seen.every((prefix) => prefix === "name=fo"));
        assert.deepEqual(result, [{
          kind: "file",
          type: "file",
          pattern: "name=fo",
          extensions: [".toml"],
          includeHidden: true,
        }]);
      }
    });
  }
  it("treats joined-looking tokens as values when an option awaits one", () => {
    const parser = option("--label", choice(["--other=foo"]));
    assert.deepEqual(suggest(parser, ["--label", "--other=fo"]), [{
      kind: "literal",
      text: "--other=foo",
    }]);
  });
});

for (const mode of ["sync", "async"] as const) {
  it(`uses parser delimiters for ${mode} joined suggestions`, async () => {
    const values = choice(["dev"]);
    const parser = option(
      "--mode",
      "-mode",
      "-m",
      "/mode",
      "+mode",
      mode === "sync" ? values : {
        ...values,
        mode: "async" as const,
        parse: (input: string) => Promise.resolve(values.parse(input)),
        suggest: async function* (prefix: string) {
          yield* values.suggest!(prefix);
        },
      },
    );
    for (const prefix of ["--mode=", "-mode=", "/mode:"]) {
      const parsed = await parse(parser, [prefix + "dev"]);
      assert.ok(parsed.success);
      const actual = await suggest(parser, [prefix]);
      assert.ok(
        actual.some((s) => s.kind === "literal" && s.text === prefix + "dev"),
      );
    }
    for (const prefix of ["/mode=", "+mode=", "-m="]) {
      const actual = await suggest(parser, [prefix]);
      assert.deepEqual(actual, []);
      const parsed = await parse(parser, [prefix + "dev"]);
      assert.ok(!parsed.success);
    }
  });
}

for (const mode of ["sync", "async"] as const) {
  it(`preserves joined file origins in ${mode} mode without changing other shells`, async () => {
    const sync: ValueParser<"sync", string> = {
      ...string(),
      *suggest(prefix) {
        yield {
          kind: "file",
          type: "file",
          pattern: prefix,
          extensions: [".toml"],
          includeHidden: true,
        };
      },
    };
    const async: ValueParser<"async", string> = {
      ...sync,
      mode: "async",
      parse(input) {
        return Promise.resolve(sync.parse(input));
      },
      async *suggest(prefix) {
        yield* sync.suggest!(prefix);
      },
    };
    const parser = option(
      "/scope:file",
      "/scope",
      mode === "sync" ? sync : async,
    );
    const input = "/scope:file:name=f";
    const result = await suggest(parser, [input]);
    assert.deepEqual(result, [{
      kind: "literal",
      text: input,
      description: undefined,
    }]);
    assert.equal(
      Array.from(bash.encodeSuggestions(result)).join(""),
      "__JOINED_FILE__:/scope%3Afile%3A:file:toml::1",
    );
    assert.equal(
      Array.from(zsh.encodeSuggestions(result)).join(""),
      input + "\0\0",
    );
  });
}
