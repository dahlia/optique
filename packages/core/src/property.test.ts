import { parseAsync, parseSync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import * as fc from "fast-check";
import { describe, it } from "node:test";

const propertyParameters = { numRuns: 200 } as const;

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("property-based tests", () => {
  it("integer parser should round-trip safe integers", () => {
    const parser = integer({});

    fc.assert(
      fc.property(
        fc.integer({
          min: Number.MIN_SAFE_INTEGER,
          max: Number.MAX_SAFE_INTEGER,
        }),
        (value) => {
          const parsed = parser.parse(parser.format(value));

          assert.ok(parsed.success);
          if (parsed.success) {
            assert.equal(parsed.value, value);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("choice parser should round-trip string choices", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 24 }), {
          minLength: 1,
          maxLength: 16,
        }),
        fc.nat(),
        (choices, index) => {
          const parser = choice(choices);
          const expected = choices[index % choices.length];
          const parsed = parser.parse(parser.format(expected));

          assert.ok(parsed.success);
          if (parsed.success) {
            assert.equal(parsed.value, expected);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("choice parser should round-trip number choices", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: -1_000_000, max: 1_000_000 }), {
          minLength: 1,
          maxLength: 16,
        }),
        fc.nat(),
        (choices, index) => {
          const parser = choice(choices);
          const expected = choices[index % choices.length];
          const parsed = parser.parse(parser.format(expected));

          assert.ok(parsed.success);
          if (parsed.success) {
            assert.equal(parsed.value, expected);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("string parser should be deterministic with stateful RegExp", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.constantFrom("g", "y", "gy", "gi", "iy", "giy"),
        (literal, flags) => {
          const pattern = new RegExp(escapeRegExp(literal), flags);
          const parser = string({ pattern });

          const first = parser.parse(literal);
          const second = parser.parse(literal);

          assert.deepEqual(second, first);
          assert.equal(pattern.lastIndex, 0);
        },
      ),
      propertyParameters,
    );
  });

  it("parseAsync should agree with parseSync for sync parsers", async () => {
    const parser = option("--port", integer({ min: 1, max: 65535 }));

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant<undefined>(undefined),
          fc.integer({ min: 1, max: 65535 }),
        ),
        async (port) => {
          const args = port == null ? [] : ["--port", `${port}`];
          const syncResult = parseSync(parser, args);
          const asyncResult = await parseAsync(parser, args);

          assert.deepEqual(asyncResult, syncResult);
        },
      ),
      propertyParameters,
    );
  });
});
