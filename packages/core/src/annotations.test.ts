import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fc from "fast-check";
import {
  annotationKey,
  type Annotations,
  getAnnotations,
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
