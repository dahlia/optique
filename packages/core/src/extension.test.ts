import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  defineTraits,
  delegateSuggestNodes,
  getTraits,
  mapSourceMetadata,
  type ParserSourceMetadata,
} from "./extension.ts";
import { message } from "./message.ts";
import type { Parser } from "./parser.ts";

function createTestParser(
  dependencyMetadata?: Parser<"sync", unknown, unknown>["dependencyMetadata"],
): Parser<"sync", unknown, unknown> {
  return {
    mode: "sync",
    $valueType: [] as const,
    $stateType: [] as const,
    priority: 0,
    usage: [],
    leadingNames: new Set(),
    acceptingAnyToken: false,
    initialState: undefined,
    parse(context) {
      return {
        success: false as const,
        consumed: 0,
        error: message`unused parse: ${String(context.state)}`,
      };
    },
    complete() {
      return { success: true as const, value: undefined };
    },
    suggest() {
      return [];
    },
    getDocFragments() {
      return { fragments: [] };
    },
    ...(dependencyMetadata === undefined ? {} : { dependencyMetadata }),
  };
}

function createSourceMetadata(
  sourceId: symbol,
): NonNullable<
  Parser<"sync", unknown, unknown>["dependencyMetadata"]
>["source"] {
  return {
    kind: "source",
    sourceId,
    preservesSourceValue: true,
    extractSourceValue(state) {
      if (typeof state !== "string") return undefined;
      return { success: true as const, value: state };
    },
  };
}

describe("extension", () => {
  describe("defineTraits() / getTraits()", () => {
    it("returns an empty object when no traits are defined", () => {
      const parser = createTestParser();

      assert.deepEqual(getTraits(parser), {});
      assert.ok(Object.isFrozen(getTraits(parser)));
    });

    it("defines and reads parser traits", () => {
      const parser = createTestParser();

      defineTraits(parser, {
        inheritsAnnotations: true,
        completesFromSource: true,
        requiresSourceBinding: true,
      });

      assert.deepEqual(getTraits(parser), {
        inheritsAnnotations: true,
        completesFromSource: true,
        requiresSourceBinding: true,
      });
    });

    it("preserves completesFromSource across parser spreads", () => {
      const parser = createTestParser();

      defineTraits(parser, { completesFromSource: true });

      const clone = { ...parser };

      assert.deepEqual(getTraits(clone), { completesFromSource: true });
    });
  });

  describe("delegateSuggestNodes()", () => {
    it("appends the outer source node after inner nodes by default", () => {
      const innerParser = createTestParser({
        source: createSourceMetadata(Symbol("inner-source")),
      });
      const outerParser = createTestParser({
        source: createSourceMetadata(Symbol("outer-source")),
      });

      const nodes = delegateSuggestNodes(
        innerParser,
        outerParser,
        "outer-state",
        ["field"],
        "inner-state",
      );

      assert.equal(nodes.length, 2);
      assert.equal(nodes[0].parser, innerParser);
      assert.equal(nodes[0].state, "inner-state");
      assert.deepEqual(nodes[0].path, ["field"]);
      assert.equal(nodes[1].parser, outerParser);
      assert.equal(nodes[1].state, "outer-state");
      assert.deepEqual(nodes[1].path, ["field"]);
    });

    it("prepends the outer source node when requested", () => {
      const innerParser = createTestParser({
        source: createSourceMetadata(Symbol("inner-source")),
      });
      const outerParser = createTestParser({
        source: createSourceMetadata(Symbol("outer-source")),
      });

      const nodes = delegateSuggestNodes(
        innerParser,
        outerParser,
        "outer-state",
        ["field"],
        "inner-state",
        "prepend",
      );

      assert.equal(nodes.length, 2);
      assert.equal(nodes[0].parser, outerParser);
      assert.equal(nodes[1].parser, innerParser);
    });

    it("returns only inner nodes when outer parser has no source metadata", () => {
      const innerParser = createTestParser({
        source: createSourceMetadata(Symbol("inner-source")),
      });
      const outerParser = createTestParser();

      const nodes = delegateSuggestNodes(
        innerParser,
        outerParser,
        "outer-state",
        ["field"],
        "inner-state",
      );

      assert.equal(nodes.length, 1);
      assert.equal(nodes[0].parser, innerParser);
      assert.equal(nodes[0].state, "inner-state");
      assert.deepEqual(nodes[0].path, ["field"]);
    });
  });

  describe("mapSourceMetadata()", () => {
    it("maps source metadata while preserving other dependency capabilities", () => {
      const derived = {
        kind: "derived" as const,
        dependencyIds: [Symbol("dep")],
        replayParse: () => ({ success: true as const, value: "ok" }),
      };
      const transform = { transformsSourceValue: true as const };
      const parser = createTestParser({
        source: createSourceMetadata(Symbol("source")),
        derived,
        transform,
      });

      const mapped = mapSourceMetadata(
        parser,
        (source: ParserSourceMetadata<"sync", unknown, unknown>) => ({
          ...source,
          preservesSourceValue: false,
        }),
      );

      assert.ok(mapped != null);
      assert.ok(mapped.source != null);
      assert.ok(!mapped.source.preservesSourceValue);
      assert.equal(mapped.derived, derived);
      assert.equal(mapped.transform, transform);
    });

    it("returns undefined when the parser has no source metadata", () => {
      const parser = createTestParser();

      const mapped = mapSourceMetadata(
        parser,
        (source: ParserSourceMetadata<"sync", unknown, unknown>) => source,
      );

      assert.equal(mapped, undefined);
    });

    it("preserves non-source dependency metadata unchanged", () => {
      const derived = {
        kind: "derived" as const,
        dependencyIds: [Symbol("dep")],
        replayParse: () => ({ success: true as const, value: "ok" }),
      };
      const transform = { transformsSourceValue: true as const };
      const parser = createTestParser({ derived, transform });

      const mapped = mapSourceMetadata(
        parser,
        (source: ParserSourceMetadata<"sync", unknown, unknown>) => source,
      );

      assert.deepEqual(mapped, { derived, transform });
    });
  });
});
