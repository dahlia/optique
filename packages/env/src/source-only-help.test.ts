import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { formatDocPage } from "@optique/core/doc";
import {
  type DocState,
  getDocPage,
  getDocPageAsync,
  type Parser,
  type ParserResult,
} from "@optique/core/parser";
import {
  concat,
  conditional,
  group,
  longestMatch,
  merge,
  object,
  or,
  seq,
  tuple,
} from "@optique/core/constructs";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import { command, constant, fail, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "./index.ts";

describe("source-only environment help", () => {
  const context = createEnvContext({
    prefix: "APP_",
    source() {
      throw new Error("Help must not read environment values.");
    },
  });
  it("shows an entryless binding in the default inline layout", () => {
    const parser = bindEnv(fail<string>(), {
      context,
      key: "TIMEOUT",
      parser: string(),
    });
    const page = getDocPage(parser);
    assert.ok(page);
    assert.deepEqual(page.sections, []);
    assert.ok(!formatDocPage("app", page).includes("APP_TIMEOUT"));
    const help = formatDocPage("app", page, { showEnvironment: true });
    assert.ok(help.includes("Environment:"));
    assert.ok(help.includes("APP_TIMEOUT"));
  });
  it("does not recover a hidden CLI binding from empty fragments", () => {
    const parser = bindEnv(option("--secret", string(), { hidden: true }), {
      context,
      key: "SECRET",
      parser: string(),
    });
    const page = getDocPage(parser);
    assert.ok(page);
    assert.ok(
      !formatDocPage("app", page, { showEnvironment: true }).includes(
        "APP_SECRET",
      ),
    );
  });
});

describe("environment metadata scope", () => {
  const context = createEnvContext({
    prefix: "APP_",
    source() {
      throw new Error("Unexpected source read.");
    },
  });
  const bound = (key: string) =>
    bindEnv(fail<string>(), {
      context,
      key,
      parser: string(),
      documentation: {
        description: [{ type: "text", text: `Purpose of ${key}.` }],
      },
    });
  it("preserves bindings through every composite family", () => {
    const parsers = [
      object({ value: bound("VALUE") }),
      tuple([bound("VALUE")]),
      seq(bound("VALUE")),
      concat(tuple([bound("VALUE")])),
      merge(object({ value: bound("VALUE") })),
      group("Sources", bound("VALUE")),
      or(bound("VALUE"), bound("OTHER")),
      longestMatch(bound("VALUE"), bound("OTHER")),
    ];
    for (const parser of parsers) {
      const docs = parser.getDocFragments({ kind: "unavailable" });
      assert.ok(docs.sourceOnly, parser.toString());
      assert.equal(docs.environmentBindings?.[0].name, "APP_VALUE");
    }
  });
  it("suppresses hidden parents in either wrapper order", () => {
    for (const hidden of [true, "doc", "help"] as const) {
      for (
        const parser of [
          group("Secret", bound("VALUE"), { hidden }),
          object({ value: bound("VALUE") }, { hidden }),
          merge(object({ value: bound("VALUE") }), { hidden }),
          bindEnv(group("Secret", fail<string>(), { hidden }), {
            context,
            key: "VALUE",
            parser: string(),
          }),
        ]
      ) {
        const docs = parser.getDocFragments({ kind: "unavailable" });
        assert.ok(!docs.sourceOnly);
        assert.deepEqual(docs.environmentBindings ?? [], []);
      }
    }
    assert.ok(
      group("Visible", bound("VALUE"), { hidden: "usage" }).getDocFragments({
        kind: "unavailable",
      }).sourceOnly,
    );
  });
});

describe("binding purposes and visibility", () => {
  const context = createEnvContext({
    prefix: "APP_",
    source() {
      throw new Error("Unexpected read.");
    },
  });
  it("keeps hidden same-name purposes out of page callbacks and clones visible messages", () => {
    const purpose = [{
      type: "url" as const,
      url: new URL("https://example.com/"),
    }];
    const inner = bindEnv(fail<string>(), {
      context,
      key: "A",
      parser: string(),
      documentation: {
        hidden: true,
        description: [{ type: "text", text: "Secret." }],
      },
    });
    const outer = bindEnv(inner, {
      context,
      key: "A",
      parser: string(),
      documentation: { description: purpose },
    });
    const page = getDocPage(outer);
    assert.ok(page);
    assert.deepEqual(page.environmentBindings, [{
      name: "APP_A",
      description: purpose,
    }]);
    assert.notStrictEqual(page.environmentBindings?.[0].description, purpose);
    const term = page.environmentBindings?.[0].description?.[0];
    assert.ok(term?.type === "url");
    assert.notStrictEqual(term.url, purpose[0].url);
  });
  it("applies every binding visibility to both documentation channels", () => {
    for (const hidden of [true, "doc", "help", false, "usage"] as const) {
      const parser = bindEnv(option("--a", string()), {
        context,
        key: "A",
        parser: string(),
        documentation: {
          hidden,
          description: [{ type: "text", text: "Purpose." }],
        },
      });
      const page = getDocPage(parser);
      assert.ok(page);
      const visible = hidden === false || hidden === "usage";
      assert.equal(page.environmentBindings?.length ?? 0, visible ? 1 : 0);
      assert.deepEqual(
        page.sections[0].entries[0].envVars,
        visible ? ["APP_A"] : [],
      );
    }
  });
  it("requires an explicit source-only capability on a custom entryless parser", () => {
    const unknown = {
      ...fail<string>(),
      getDocFragments: () => ({ fragments: [] }),
    };
    const options = {
      context,
      key: "A",
      parser: string(),
      documentation: {
        description: [{ type: "text" as const, text: "Purpose." }],
      },
    };
    assert.ok(!getDocPage(bindEnv(unknown, options))?.environmentBindings);
    assert.ok(
      !getDocPage(bindEnv(option("--a", string(), { hidden: true }), options))
        ?.environmentBindings,
    );
    assert.ok(
      !object({ unknown }).getDocFragments({ kind: "unavailable" }).sourceOnly,
    );
    assert.ok(!object({}).getDocFragments({ kind: "unavailable" }).sourceOnly);
  });
  it("allows an explicitly requested purpose to survive exclusive CLI deduplication", () => {
    const first = bindEnv(option("--name", string()), {
      context,
      key: "FIRST",
      parser: string(),
    });
    const second = bindEnv(option("--name", string()), {
      context,
      key: "SECOND",
      parser: string(),
      documentation: {
        description: [{ type: "text", text: "Secondary source." }],
      },
    });
    const page = getDocPage(or(first, second));
    assert.ok(page);
    assert.deepEqual(page.sections[0].entries[0].envVars, ["APP_FIRST"]);
    const help = formatDocPage("app", page, { showEnvironment: true });
    assert.ok(help.includes("APP_SECOND"));
    assert.ok(help.includes("Secondary source."));
  });
  it("keeps root command listings scoped but supports bare and selected command pages", () => {
    const source = bindEnv(fail<string>(), {
      context,
      key: "A",
      parser: string(),
    });
    const cmd = command("one", source);
    assert.ok(
      !or(cmd, command("two", source)).getDocFragments({ kind: "unavailable" })
        .environmentBindings,
    );
    assert.equal(getDocPage(cmd)?.environmentBindings?.[0].name, "APP_A");
    assert.equal(
      getDocPage(or(cmd, command("two", source)), ["one"])?.environmentBindings
        ?.[0].name,
      "APP_A",
    );
    assert.equal(
      getDocPage(group("Commands", or(cmd, command("two", source))), ["one"])
        ?.environmentBindings?.length,
      1,
    );
  });
});

describe("state-sensitive source documentation", () => {
  const context = createEnvContext({
    source() {
      throw new Error("Unexpected read.");
    },
  });
  const source = (key: string) =>
    bindEnv(constant(key), { context, key, parser: string() });
  it("follows or/longestMatch success and failure policies", () => {
    const a = source("A");
    const b = source("B");
    const exclusive = or(a, b);
    const longest = longestMatch(a, b);
    const success: DocState<[1, ParserResult<string>]> = {
      kind: "available" as const,
      state: [1, {
        success: true as const,
        next: {
          buffer: [],
          state: b.initialState,
          optionsTerminated: false,
          usage: [],
        },
        consumed: [],
      }],
    };
    const failure: DocState<[1, ParserResult<string>]> = {
      kind: "available" as const,
      state: [1, {
        success: false as const,
        error: [{ type: "text" as const, text: "Missing." }],
        consumed: 0,
      }],
    };
    assert.deepEqual(
      exclusive.getDocFragments(success).environmentBindings?.map((d) =>
        d.name
      ),
      ["B"],
    );
    assert.deepEqual(
      longest.getDocFragments(success).environmentBindings?.map((d) => d.name),
      ["B"],
    );
    assert.deepEqual(
      exclusive.getDocFragments(failure).environmentBindings?.map((d) =>
        d.name
      ),
      ["B"],
    );
    assert.deepEqual(
      longest.getDocFragments(failure).environmentBindings?.map((d) => d.name),
      ["A", "B"],
    );
  });
  it("keeps conditional documentation scoped to all configured branches", () => {
    const parser = conditional(constant("a" as const), {
      a: source("A"),
      b: source("B"),
    }, source("DEFAULT"));
    assert.deepEqual(
      parser.getDocFragments({ kind: "unavailable" }).environmentBindings?.map((
        d,
      ) => d.name),
      ["A", "B", "DEFAULT"],
    );
    assert.deepEqual(
      getDocPage(parser)?.environmentBindings?.map((d) => d.name),
      ["A", "B", "DEFAULT"],
    );
  });
  it("preserves source records through transparent sync/async wrappers", async () => {
    const parser = multiple(
      optional(withDefault(source("A").map((value) => value), "fallback")),
    );
    assert.equal(getDocPage(parser)?.environmentBindings?.[0].name, "A");
    assert.deepEqual(await getDocPageAsync(parser), getDocPage(parser));
  });
  it("does not call source-only default formatters", () => {
    const value = {
      ...string(),
      format() {
        throw new Error("Unexpected formatter call.");
      },
    };
    const parser = bindEnv(fail<string>(), {
      context,
      key: "A",
      parser: value,
      default: "secret",
    });
    assert.equal(getDocPage(parser)?.environmentBindings?.[0].name, "A");
  });
});

it("documents async source-only bindings without running their value parser", async () => {
  const inner = fail<string>();
  const asyncParser: Parser<"async", string, undefined> = {
    $valueType: inner.$valueType,
    $stateType: inner.$stateType,
    priority: inner.priority,
    usage: inner.usage,
    leadingNames: inner.leadingNames,
    acceptingAnyToken: inner.acceptingAnyToken,
    initialState: inner.initialState,
    getDocFragments: inner.getDocFragments,
    mode: "async",
    parse: (context) => Promise.resolve(inner.parse(context)),
    complete: (state, exec) => Promise.resolve(inner.complete(state, exec)),
    async *suggest(context, prefix) {
      yield* inner.suggest(context, prefix);
    },
  };
  const bound = bindEnv(asyncParser, {
    context: createEnvContext({
      source() {
        throw new Error("Unexpected read.");
      },
    }),
    key: "ASYNC",
    parser: {
      ...string(),
      mode: "async",
      parse: () => Promise.reject(new Error("Unexpected value parse.")),
      format() {
        throw new Error("Unexpected value format.");
      },
    },
  });
  assert.deepEqual((await getDocPageAsync(bound))?.environmentBindings, [{
    name: "ASYNC",
  }]);
});
