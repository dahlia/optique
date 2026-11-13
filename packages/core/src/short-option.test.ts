import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { withChildContext } from "./execution-context.ts";
import type { ParserContext } from "#src/parser.ts";
import { constant } from "#src/primitives.ts";
import {
  adoptOptionScope,
  forkOptionScope,
  getOptionScope,
  restoreOptionScope,
  scopeParser,
  selectableOptionScope,
  withParserOptionScope,
} from "./short-option.ts";

describe("option scope registration", () => {
  it("should keep occurrence bindings within each parse and across map clones", () => {
    const { parser, context, route, alternate, third, snapshot } =
      observedScope();
    const child = withParserOptionScope(
      withChildContext(context, 1000, null),
      parser,
    );
    const independent = withParserOptionScope(
      withChildContext(initialContext(), 1000, null),
      parser,
    );
    route.select(child, alternate);
    route.select(independent, alternate);
    const key = [...snapshot(child).keys()][0];
    assert.notEqual(key, [...snapshot(independent).keys()][0]);
    const fork = forkOptionScope(child);
    const before = snapshot(fork);
    route.select(fork, third);
    assert.notEqual(snapshot(fork), before);
    assert.strictEqual([...snapshot(fork).keys()][0], key);
    // Check after a real clone: the new map must retain the binding trie.
    assert.strictEqual(withParserOptionScope(fork, parser), fork);
    assert.deepEqual([...getOptionScope(fork)], ["initial", "third"]);
  });

  it("should reuse immutable unions for the same parent and bound source", () => {
    const parent = withParserOptionScope(initialContext(), constant("root"));
    const childParser = scopeParser(constant(null), () => new Set(["child"]));
    const parentNames = [...getOptionScope(parent)];
    const first = withParserOptionScope(parent, childParser, "child");
    const second = withParserOptionScope(
      forkOptionScope(parent),
      childParser,
      "child",
    );
    assert.strictEqual(sourceSet(first), sourceSet(second));
    assert.notEqual(sourceSet(parent), sourceSet(first));
    assert.deepEqual([...getOptionScope(parent)], parentNames);
    assert.strictEqual(
      withParserOptionScope(first, childParser, "child"),
      first,
    );
    const sibling = withParserOptionScope(parent, childParser, "sibling");
    assert.notEqual(sourceSet(first), sourceSet(sibling));
    assert.strictEqual(sourceSet(parent), sourceSet(forkOptionScope(parent)));
  });

  it("should deduplicate alternating sources in their original order", () => {
    const calls: string[] = [];
    const a = scopeParser(constant(null), () => {
      calls.push("a");
      return new Set(["a"]);
    });
    const b = scopeParser(constant(null), () => {
      calls.push("b");
      return new Set(["b"]);
    });
    let context = withParserOptionScope(
      withParserOptionScope(initialContext(), a),
      b,
    );
    const original = context;
    for (let i = 0; i < 100; i++) {
      context = withParserOptionScope(withParserOptionScope(context, a), b);
    }
    assert.strictEqual(context, original);
    assert.deepEqual([...getOptionScope(context)], ["a", "b"]);
    assert.deepEqual(calls, ["a", "b"]);
  });
});

describe("option scope selection snapshots", () => {
  it("should share until a differing write on either side and skip equal writes", () => {
    const { context, route, alternate, third, snapshot } = observedScope();
    const original = snapshot(context);
    const child = forkOptionScope(context);
    assert.strictEqual(snapshot(child), original);
    route.select(context, alternate);
    const parentMap = snapshot(context);
    assert.notEqual(parentMap, original);
    assert.strictEqual(snapshot(child), original);
    const retained = forkOptionScope(context);
    route.select(context, alternate);
    assert.strictEqual(snapshot(context), parentMap);
    assert.strictEqual(snapshot(retained), parentMap);
    route.select(child, third);
    assert.notEqual(snapshot(child), original);
    assert.deepEqual([...getOptionScope(context)], ["alternate"]);
    assert.deepEqual([...getOptionScope(child)], ["third"]);
    assert.strictEqual(sourceSet(context), sourceSet(child));
  });

  it("should isolate siblings and grandchildren through nested adoption", () => {
    const { context, route, alternate, third, snapshot } = observedScope();
    const left = forkOptionScope(context);
    const right = forkOptionScope(context);
    const grandchild = forkOptionScope(left);
    route.select(grandchild, alternate);
    adoptOptionScope(left, grandchild);
    assert.deepEqual([...getOptionScope(left)], ["alternate"]);
    assert.deepEqual([...getOptionScope(right)], ["initial"]);
    assert.deepEqual([...getOptionScope(context)], ["initial"]);
    adoptOptionScope(context, left);
    const parentMap = snapshot(context);
    adoptOptionScope(context, left);
    assert.strictEqual(snapshot(context), parentMap);
    route.select(left, third);
    assert.deepEqual([...getOptionScope(context)], ["alternate"]);
    assert.deepEqual([...getOptionScope(grandchild)], ["alternate"]);
    assert.deepEqual([...getOptionScope(right)], ["initial"]);
  });

  it("should preserve an unowned parent after adopting the same map", () => {
    const { context, route, alternate, snapshot } = observedScope();
    const sibling = forkOptionScope(context);
    adoptOptionScope(context, sibling);
    assert.strictEqual(snapshot(context), snapshot(sibling));
    route.select(context, alternate);
    assert.deepEqual([...getOptionScope(sibling)], ["initial"]);
    assert.deepEqual([...getOptionScope(context)], ["alternate"]);
  });

  it("should restore the exact live parent holder without affecting a retained sibling", () => {
    const { context, route, alternate, third } = observedScope();
    route.select(context, alternate);
    const child = forkOptionScope(context);
    const sibling = forkOptionScope(context);
    // Equal adoption must keep the parent unowned while the sibling survives.
    const restored = restoreOptionScope(child, context);
    route.select(restored, third);
    assert.deepEqual([...getOptionScope(context)], ["third"]);
    assert.deepEqual([...getOptionScope(sibling)], ["alternate"]);
  });

  it("should retain route isolation after termination and reopening", () => {
    const { context, route, alternate } = observedScope();
    const terminated = { ...context, optionsTerminated: true };
    const child = forkOptionScope(terminated);
    route.select(child, alternate);
    assert.deepEqual([...getOptionScope(terminated)], ["initial"]);
    assert.deepEqual([
      ...getOptionScope({ ...child, optionsTerminated: false }),
    ], ["alternate"]);
  });

  it("should reconnect isolated success to the live parent holder", () => {
    const { context, route, alternate, third } = observedScope();
    const sibling = forkOptionScope(context);
    const isolated = scopeParser(constant(null), route.source, undefined, true);
    const result = isolated.parse(context);
    assert.ok(result.success);
    if (!result.success) return;
    route.select(result.next, alternate);
    assert.deepEqual([...getOptionScope(context)], ["alternate"]);
    assert.deepEqual([...getOptionScope(sibling)], ["initial"]);
    route.select(context, third);
    assert.deepEqual([...getOptionScope(result.next)], ["third"]);
  });
});

// Helpers
function initialContext(): ParserContext<null> {
  return { state: null, buffer: [], usage: [], optionsTerminated: false };
}

function sourceSet(context: object): unknown {
  const key = Object.getOwnPropertySymbols(context).find((key) =>
    key.description === "optionScope"
  );
  assert.ok(key);
  const scope: unknown = Reflect.get(context, key);
  assert.ok(scope != null && typeof scope === "object" && "sources" in scope);
  return scope.sources;
}

function observedScope() {
  type Source = Parameters<typeof scopeParser>[1];
  type Selections = Parameters<NonNullable<Source>>[0];
  let observed: Selections | undefined;
  const initial: NonNullable<Source> = () => new Set(["initial"]);
  const alternate: NonNullable<Source> = () => new Set(["alternate"]);
  const third: NonNullable<Source> = () => new Set(["third"]);
  const route = selectableOptionScope(initial);
  const parser = scopeParser(
    constant(null),
    (selections, arities, context, path) => {
      observed = selections;
      return route.source(selections, arities, context, path);
    },
  );
  const context = withParserOptionScope(initialContext(), parser);
  return {
    parser,
    context,
    route,
    alternate,
    third,
    snapshot(context: ParserContext<unknown>): Selections {
      observed = undefined;
      getOptionScope(context);
      assert.ok(observed);
      return observed;
    },
  };
}
