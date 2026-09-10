import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fc from "fast-check";
import { measureText, placeText } from "./text-layout.ts";

const pieces = fc.array(fc.constantFrom(
  "a",
  "한",
  "👩‍💻",
  "e",
  "\u0301",
  "1",
  "\uFE0F\u20E3",
  "\n",
  " ",
  "\x1b[31mred\x1b[0m",
  "\x1b]8;;https://example.com\x1b\\link\x1b]8;;\x1b\\",
)).map((parts) => parts.join(""));

describe("measureText", () => {
  it("should distinguish empty, first, last and widest physical lines", () => {
    for (
      const [text, widths] of [
        ["", [0, 0, 0, 1]],
        ["\n", [0, 0, 0, 2]],
        ["한\nabc\n", [2, 0, 3, 3]],
        ["\ne\u0301\n\n👩‍💻", [0, 2, 2, 4]],
      ] as const
    ) {
      assert.deepEqual(measureText(text), {
        firstLineWidth: widths[0],
        lastLineWidth: widths[1],
        maxLineWidth: widths[2],
        lineCount: widths[3],
      });
    }
  });
  it("should remove complete escapes before identifying physical lines", () => {
    assert.deepEqual(
      measureText("\x1b]0;invisible\ntitle\x07a\n한"),
      { firstLineWidth: 1, lastLineWidth: 2, maxLineWidth: 2, lineCount: 2 },
    );
  });
  it("should measure styled and linked text like its visible content", () => {
    fc.assert(
      fc.property(pieces, (text) => {
        assert.deepEqual(
          measureText(`\x1b[1m${text}\x1b[0m`),
          measureText(text),
        );
        assert.deepEqual(
          measureText(`\x1b]8;;https://example.com\x1b\\${text}\x1b]8;;\x1b\\`),
          measureText(text),
        );
      }),
      { seed: 907, numRuns: 200 },
    );
  });
});

describe("placeText", () => {
  it("should drop incoming occupied columns after any hard break", () => {
    assert.deepEqual(placeText("A\n\n한", { line: "abc", column: 9 }), {
      text: "A\n\n한",
      cursor: { line: "한", column: 2 },
    });
    assert.deepEqual(placeText("a", { line: "", column: 3 }, 3), {
      text: "\na",
      cursor: { line: "a", column: 1 },
    });
  });
  it("should reserve content space only on single-line prefixes", () => {
    const cursor = { line: "abc", column: 3 };
    assert.equal(placeText("[", cursor, 4).text, "[");
    assert.equal(placeText("[", cursor, 4, 1).text, "\n[");
    assert.equal(placeText("[\nD:", cursor, 4, 1).text, "[\nD:");
  });
  it("should preserve empty and combining boundaries after overflow", () => {
    const cursor = { line: "abcde", column: 5 };
    for (const text of ["", "\nS", "\u0301"]) {
      assert.equal(placeText(text, cursor, 3).text, text);
    }
  });
  it("should measure graphemes formed at the join", () => {
    assert.equal(
      placeText("\uFE0F\u20E3", { line: "1", column: 1 }).cursor.column,
      2,
    );
    assert.equal(
      placeText("\u0301", { line: "e", column: 1 }, 1).text,
      "\u0301",
    );
  });
  it("should compose complete text fragments associatively without wrapping", () => {
    fc.assert(
      fc.property(pieces, pieces, fc.nat(), (a, b, occupied) => {
        const start = { line: "", column: occupied };
        const first = placeText(a, start);
        const second = placeText(b, first.cursor);
        const together = placeText(a + b, start);
        assert.deepEqual(second.cursor, together.cursor);
        assert.equal(first.text + second.text, together.text);
      }),
      { seed: 908, numRuns: 300 },
    );
  });
});
