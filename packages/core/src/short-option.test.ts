import assert from "node:assert/strict";
import { it } from "node:test";
import { constant } from "#src/primitives.ts";
import {
  forkOptionScope,
  withOptionScopeChild,
  withParserOptionScope,
} from "./short-option.ts";

function sources(context: object): Set<unknown> {
  const key = Object.getOwnPropertySymbols(context).find((key) =>
    key.description === "optionScope"
  );
  assert.ok(key);
  const scope: unknown = Reflect.get(context, key);
  assert.ok(scope != null && typeof scope === "object" && "sources" in scope);
  assert.ok(scope.sources instanceof Set);
  return scope.sources;
}

it("keeps occurrence bindings within each parse and shares them with forks", () => {
  const p = constant("a");
  const initial = {
    state: p.initialState,
    buffer: [],
    usage: p.usage,
    optionsTerminated: false,
  };
  const first = withParserOptionScope(withOptionScopeChild(initial, 1000), p);
  const second = withParserOptionScope(withOptionScopeChild(initial, 1000), p);
  assert.notEqual([...sources(first)][0], [...sources(second)][0]);
  const fork = withParserOptionScope(forkOptionScope(first), p);
  assert.equal(sources(fork).size, 1);
  assert.equal([...sources(first)][0], [...sources(fork)][0]);
});
