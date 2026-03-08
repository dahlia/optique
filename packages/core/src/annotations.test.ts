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
  isInjectedAnnotationWrapper,
} from "./annotations.ts";

describe("getAnnotations", () => {
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

  it("should preserve array identity for frozen array targets", () => {
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
});
