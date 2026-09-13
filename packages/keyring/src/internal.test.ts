import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAnnotations } from "@optique/core/annotations";
import {
  injectAnnotations,
  unwrapInjectedAnnotationState,
} from "@optique/core/extension";
import { withAnnotatedInnerState } from "./internal.ts";

describe("withAnnotatedInnerState()", () => {
  const key = Symbol("context");
  const annotations = { [key]: "parent" };
  const parent = injectAnnotations({}, annotations);

  it("should inherit annotations without mutating the child", () => {
    const child = ["value"];
    const result = withAnnotatedInnerState(parent, child, (state) => {
      assert.deepEqual([...state], ["value"]);
      assert.equal(getAnnotations(state)?.[key], "parent");
      return "result";
    });

    assert.equal(result, "result");
    assert.equal(getAnnotations(child), undefined);
  });

  it("should preserve an existing child's annotations and identity", () => {
    const child = injectAnnotations({}, { [key]: "child" });
    withAnnotatedInnerState(parent, child, (state) => {
      assert.equal(state, child);
      assert.equal(getAnnotations(state)?.[key], "child");
    });
  });

  it("should preserve private fields when a custom state needs an annotation view", () => {
    class State {
      #value = "value";
      read() {
        return this.#value;
      }
    }
    const child = new State();
    withAnnotatedInnerState(parent, child, (state) => {
      assert.equal(state.read(), "value");
      assert.equal(getAnnotations(state)?.[key], "parent");
    });
    assert.equal(getAnnotations(child), undefined);
  });

  it("should keep primitive sentinels unless inheritance is requested", () => {
    withAnnotatedInnerState(parent, undefined, (state) => {
      assert.equal(state, undefined);
    });
    withAnnotatedInnerState(parent, undefined, (state) => {
      assert.equal(getAnnotations(state)?.[key], "parent");
      assert.equal(unwrapInjectedAnnotationState(state), undefined);
    }, true);
  });

  it("should preserve state identity without parent annotations", () => {
    const child = new Date(0);
    withAnnotatedInnerState({}, child, (state) => {
      assert.equal(state, child);
    });
  });
});
