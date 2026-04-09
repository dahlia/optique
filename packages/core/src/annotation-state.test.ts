import {
  type Annotations,
  getAnnotations,
  injectAnnotations,
} from "@optique/core/annotations";
import { message } from "@optique/core/message";
import {
  defineInheritedAnnotationParser,
  type Parser,
} from "@optique/core/parser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getWrappedChildParseState,
  getWrappedChildState,
  normalizeInjectedAnnotationState,
} from "./annotation-state.ts";

function createInheritedTestParser(): Parser<"sync", unknown, unknown> {
  const parser: Parser<"sync", unknown, unknown> = {
    $mode: "sync",
    $valueType: [] as readonly unknown[],
    $stateType: [] as readonly unknown[],
    priority: 1,
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
  };
  defineInheritedAnnotationParser(parser);
  return parser;
}

describe("annotation-state", () => {
  it(
    "getWrappedChildParseState() preserves nullish sentinels when inheriting annotations",
    () => {
      const marker = Symbol.for(
        "@test/getWrappedChildParseState-nullish-sentinel",
      );
      const annotations = { [marker]: true } satisfies Annotations;
      const parentState = injectAnnotations(undefined, annotations);
      const parser = createInheritedTestParser();

      for (const childState of [undefined, null] as const) {
        const wrapped = getWrappedChildParseState(
          parentState,
          childState,
          parser,
        );

        assert.equal(
          normalizeInjectedAnnotationState(wrapped),
          childState,
          "the wrapped state should normalize back to the original sentinel",
        );
        assert.ok(getAnnotations(wrapped)?.[marker]);
      }
    },
  );

  it(
    "getWrappedChildState() preserves nullish sentinels when inheriting annotations",
    () => {
      const marker = Symbol.for(
        "@test/getWrappedChildState-nullish-sentinel",
      );
      const annotations = { [marker]: true } satisfies Annotations;
      const parentState = injectAnnotations(undefined, annotations);
      const parser = createInheritedTestParser();

      for (const childState of [undefined, null] as const) {
        const wrapped = getWrappedChildState(
          parentState,
          childState,
          parser,
        );

        assert.equal(
          normalizeInjectedAnnotationState(wrapped),
          childState,
          "the wrapped state should normalize back to the original sentinel",
        );
        assert.ok(getAnnotations(wrapped)?.[marker]);
      }
    },
  );
});
