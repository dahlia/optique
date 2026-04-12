import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fc from "fast-check";
import {
  annotationKey,
  type Annotations,
  annotationStateValueKey,
  annotationWrapperKey,
  getAnnotations,
  inheritAnnotations,
  injectAnnotations,
  isInjectedAnnotationState,
  isInjectedAnnotationWrapper,
  unwrapInjectedAnnotationState,
  unwrapInjectedAnnotationWrapper,
} from "./annotations.ts";

describe("getAnnotations", () => {
  it("should not expose internal wrapper key set", async () => {
    const annotationsModule = await import("./annotations.ts");

    assert.ok(!Object.hasOwn(annotationsModule, "annotationWrapperKeys"));
  });

  it("should return undefined for non-object states", () => {
    assert.equal(getAnnotations(undefined), undefined);
    assert.equal(getAnnotations(null), undefined);
    assert.equal(getAnnotations("state"), undefined);
    assert.equal(getAnnotations(123), undefined);
    assert.equal(getAnnotations(true), undefined);
  });

  describe("property-based tests", () => {
    const propertyParameters = { numRuns: 200 } as const;

    it("should never throw for arbitrary unknown input", () => {
      fc.assert(
        fc.property(fc.anything(), (state: unknown) => {
          assert.doesNotThrow(() => getAnnotations(state));
        }),
        propertyParameters,
      );
    });

    it("should return undefined when annotationKey is absent", () => {
      fc.assert(
        fc.property(
          fc.dictionary(fc.string(), fc.anything()),
          (state: Record<string, unknown>) => {
            assert.equal(getAnnotations(state), undefined);
          },
        ),
        propertyParameters,
      );
    });

    it("should return annotation object iff annotationKey holds an object", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(undefined),
            fc.constant(null),
            fc.boolean(),
            fc.integer(),
            fc.string(),
            fc.array(fc.anything()),
            fc.object(),
          ),
          (annotationValue: unknown) => {
            const state: Record<PropertyKey, unknown> = {
              [annotationKey]: annotationValue,
            };

            const result = getAnnotations(state);
            if (
              annotationValue != null && typeof annotationValue === "object"
            ) {
              assert.equal(result, annotationValue as Annotations);
            } else {
              assert.equal(result, undefined);
            }
          },
        ),
        propertyParameters,
      );
    });
  });
});

describe("injectAnnotations", () => {
  it("should preserve wrapper markers when reinjecting injected wrappers", () => {
    const first = injectAnnotations(undefined, { [Symbol.for("@test/a")]: 1 });
    assert.ok(isInjectedAnnotationWrapper(first));

    const second = injectAnnotations(first, { [Symbol.for("@test/b")]: 2 });
    assert.equal(second, first);
    assert.ok(isInjectedAnnotationWrapper(second));

    const wrapper = second as unknown as Record<PropertyKey, unknown>;
    assert.ok(Object.hasOwn(wrapper, annotationStateValueKey));
    assert.ok(Object.hasOwn(wrapper, annotationWrapperKey));
    assert.equal(wrapper[annotationWrapperKey], true);
    assert.equal(wrapper[annotationStateValueKey], undefined);
  });

  it("should preserve Date state shape", () => {
    const marker = Symbol.for("@test/inject-date");
    const source = new Date("2026-03-08T00:00:00.000Z");
    const result = injectAnnotations(source, { [marker]: "ok" });

    assert.ok(result instanceof Date);
    assert.notEqual(result, source);
    assert.equal(result.toISOString(), "2026-03-08T00:00:00.000Z");
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should preserve Map state shape", () => {
    const marker = Symbol.for("@test/inject-map");
    const source = new Map<string, number>([["a", 1]]);
    const result = injectAnnotations(source, { [marker]: "ok" });

    assert.ok(result instanceof Map);
    assert.notEqual(result, source);
    assert.equal(result.get("a"), 1);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should preserve Set state shape", () => {
    const marker = Symbol.for("@test/inject-set");
    const source = new Set(["a", "b"]);
    const result = injectAnnotations(source, { [marker]: "ok" });

    assert.ok(result instanceof Set);
    assert.notEqual(result, source);
    assert.deepEqual([...result], ["a", "b"]);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should preserve RegExp state shape", () => {
    const marker = Symbol.for("@test/inject-regexp");
    const source = /ab+/gi;
    const result = injectAnnotations(source, { [marker]: "ok" });

    assert.ok(result instanceof RegExp);
    assert.notEqual(result, source);
    assert.equal(result.source, "ab+");
    assert.equal(result.flags, "gi");
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should clone non-plain object states without mutation", () => {
    const marker = Symbol.for("@test/inject-nonplain");
    class CustomState {
      value = 1;
    }
    const source = new CustomState();
    const result = injectAnnotations(source, {
      [marker]: "ok",
    });

    assert.notEqual(result, source);
    assert.ok(result instanceof CustomState);
    assert.equal(result.value, 1);
    assert.equal(getAnnotations(source), undefined);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  describe("with empty annotations object", () => {
    it("should return primitive state unchanged", () => {
      assert.equal(injectAnnotations(undefined, {}), undefined);
      assert.equal(injectAnnotations(null, {}), null);
      assert.equal(injectAnnotations(42, {}), 42);
      assert.equal(injectAnnotations("state", {}), "state");
      assert.equal(injectAnnotations(true, {}), true);
    });

    it("should not wrap primitive state", () => {
      const result = injectAnnotations(undefined, {});
      assert.ok(!isInjectedAnnotationWrapper(result));
    });

    it("should return identical array state", () => {
      const source = [1, 2, 3];
      const result = injectAnnotations(source, {});
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });

    it("should return identical Date state", () => {
      const source = new Date("2026-03-08T00:00:00.000Z");
      const result = injectAnnotations(source, {});
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });

    it("should return identical Map state", () => {
      const source = new Map<string, number>([["a", 1]]);
      const result = injectAnnotations(source, {});
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });

    it("should return identical Set state", () => {
      const source = new Set(["a", "b"]);
      const result = injectAnnotations(source, {});
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });

    it("should return identical RegExp state", () => {
      const source = /ab+/gi;
      const result = injectAnnotations(source, {});
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });

    it("should return identical plain object state", () => {
      const source = { value: 1 };
      const result = injectAnnotations(source, {});
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });

    it("should return identical class instance state", () => {
      class CustomState {
        value = 1;
      }
      const source = new CustomState();
      const result = injectAnnotations(source, {});
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });

    it("should ignore string-keyed entries and still no-op", () => {
      const source = { value: 1 };
      const annotationsWithStringKey = { foo: "bar" } as unknown as Record<
        symbol,
        unknown
      >;
      const result = injectAnnotations(source, annotationsWithStringKey);
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });
  });
});

describe("inheritAnnotations", () => {
  it("should not mutate extensible targets", () => {
    const marker = Symbol.for("@test/inherit-extensible");
    const source = { [annotationKey]: { [marker]: "ok" } };
    const target = { value: 1 };
    const result = inheritAnnotations(source, target);

    assert.notEqual(result, target);
    assert.equal(target.value, 1);
    assert.equal(getAnnotations(target), undefined);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should not mutate frozen targets", () => {
    const marker = Symbol.for("@test/inherit-frozen");
    const source = { [annotationKey]: { [marker]: "ok" } };
    const frozenTarget = Object.freeze({ value: 1 });
    const result = inheritAnnotations(source, frozenTarget);

    assert.notEqual(result, frozenTarget);
    assert.equal((result as { value: number }).value, 1);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should not mutate frozen array targets", () => {
    const marker = Symbol.for("@test/inherit-frozen-array");
    const source = { [annotationKey]: { [marker]: "ok" } };
    const frozenTarget = Object.freeze(["a", "b"] as const);
    const result = inheritAnnotations(source, frozenTarget);

    assert.notEqual(result, frozenTarget);
    assert.ok(Array.isArray(result));
    assert.deepEqual([...result], ["a", "b"]);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should preserve Date state shape", () => {
    const marker = Symbol.for("@test/inherit-date");
    const source = { [annotationKey]: { [marker]: "ok" } };
    const target = new Date("2026-03-08T00:00:00.000Z");
    const result = inheritAnnotations(source, target);

    assert.ok(result instanceof Date);
    assert.notEqual(result, target);
    assert.equal(result.toISOString(), "2026-03-08T00:00:00.000Z");
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should preserve Map state shape", () => {
    const marker = Symbol.for("@test/inherit-map");
    const source = { [annotationKey]: { [marker]: "ok" } };
    const target = new Map<string, number>([["a", 1]]);
    const result = inheritAnnotations(source, target);

    assert.ok(result instanceof Map);
    assert.notEqual(result, target);
    assert.equal(result.get("a"), 1);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should preserve Set state shape", () => {
    const marker = Symbol.for("@test/inherit-set");
    const source = { [annotationKey]: { [marker]: "ok" } };
    const target = new Set(["a", "b"]);
    const result = inheritAnnotations(source, target);

    assert.ok(result instanceof Set);
    assert.notEqual(result, target);
    assert.deepEqual([...result], ["a", "b"]);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should preserve RegExp state shape", () => {
    const marker = Symbol.for("@test/inherit-regexp");
    const source = { [annotationKey]: { [marker]: "ok" } };
    const target = /ab+/gi;
    const result = inheritAnnotations(source, target);

    assert.ok(result instanceof RegExp);
    assert.notEqual(result, target);
    assert.equal(result.source, "ab+");
    assert.equal(result.flags, "gi");
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should not mutate extensible non-plain objects", () => {
    const marker = Symbol.for("@test/inherit-nonplain");
    const source = { [annotationKey]: { [marker]: "ok" } };
    class CustomState {
      value = 1;
    }
    const target = new CustomState();

    const result = inheritAnnotations(source, target);

    assert.equal(result, target);
    assert.equal(result.value, 1);
    assert.equal(getAnnotations(target), undefined);
  });
});

describe("unwrapInjectedAnnotationWrapper", () => {
  it("should unwrap pure injected wrappers back to the original value", () => {
    const wrapped = injectAnnotations(42, {
      [Symbol.for("@test/unwrap")]: "ok",
    });

    assert.equal(unwrapInjectedAnnotationWrapper(wrapped), 42);
  });

  it("should not unwrap wrappers with additional own keys", () => {
    const wrapped = injectAnnotations("value", {
      [Symbol.for("@test/unwrap-extra")]: "ok",
    });
    const wrapperObject = wrapped as unknown as Record<PropertyKey, unknown>;
    wrapperObject.extra = true;

    assert.equal(
      unwrapInjectedAnnotationWrapper(wrapperObject),
      wrapperObject,
    );
  });

  it("should return non-wrapper objects unchanged", () => {
    const value = { plain: true };

    assert.equal(unwrapInjectedAnnotationWrapper(value), value);
  });
});

describe("public annotation-state aliases", () => {
  it("isInjectedAnnotationState() matches the wrapper predicate", () => {
    const wrapped = injectAnnotations(undefined, {
      [Symbol.for("@test/a")]: 1,
    });

    assert.equal(
      isInjectedAnnotationState(wrapped),
      isInjectedAnnotationWrapper(wrapped),
    );
  });

  it("unwrapInjectedAnnotationState() matches the wrapper unwrapping helper", () => {
    const wrapped = injectAnnotations("value", { [Symbol.for("@test/a")]: 1 });

    assert.equal(
      unwrapInjectedAnnotationState(wrapped),
      unwrapInjectedAnnotationWrapper(wrapped),
    );
  });
});
