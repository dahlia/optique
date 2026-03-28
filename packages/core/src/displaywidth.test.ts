import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getDisplayWidth } from "./displaywidth.ts";

describe("getDisplayWidth", () => {
  describe("ASCII", () => {
    it("should return 0 for empty string", () => {
      assert.equal(getDisplayWidth(""), 0);
    });

    it("should return correct width for ASCII text", () => {
      assert.equal(getDisplayWidth("hello"), 5);
      assert.equal(getDisplayWidth("Hello, world!"), 13);
    });

    it("should return 1 for a single space", () => {
      assert.equal(getDisplayWidth(" "), 1);
    });
  });

  describe("East Asian Wide characters", () => {
    it("should count Korean characters as 2 columns each", () => {
      assert.equal(getDisplayWidth("한글"), 4);
      assert.equal(getDisplayWidth("한글 테스트"), 11);
    });

    it("should count Chinese characters as 2 columns each", () => {
      assert.equal(getDisplayWidth("你好"), 4);
      assert.equal(getDisplayWidth("世界"), 4);
    });

    it("should count Japanese hiragana as 2 columns each", () => {
      assert.equal(getDisplayWidth("ひらがな"), 8);
    });

    it("should count Japanese katakana as 2 columns each", () => {
      assert.equal(getDisplayWidth("カタカナ"), 8);
    });

    it("should count Hangul syllables as 2 columns each", () => {
      // U+AC00 range
      assert.equal(getDisplayWidth("가나다"), 6);
    });

    it("should count fullwidth Latin as 2 columns each", () => {
      // U+FF21-FF23 fullwidth A, B, C
      assert.equal(getDisplayWidth("ＡＢＣ"), 6);
    });

    it("should count halfwidth katakana as 1 column each", () => {
      // U+FF76 etc. - halfwidth katakana are narrow
      assert.equal(getDisplayWidth("ｶﾀｶﾅ"), 4);
    });

    it("should count Hangul Jamo Extended-B as 1 column each", () => {
      // U+D7B0–U+D7FF are trailing jamo with East_Asian_Width=N
      assert.equal(getDisplayWidth("\uD7CB"), 1);
      assert.equal(getDisplayWidth("\uD7CB \uD7CB"), 3);
    });

    it("should not count Combining Half Marks as wide", () => {
      // U+FE20–U+FE2F are combining marks with East_Asian_Width=N.
      // Combined with a base character, they merge into a single grapheme.
      assert.equal(getDisplayWidth("a\uFE20"), 1);
      // Standalone, they should not be treated as width 2.
      assert.equal(getDisplayWidth("\uFE20"), 1);
    });

    it("should count CJK angle brackets as 2 columns each", () => {
      // U+2329 LEFT-POINTING ANGLE BRACKET, U+232A RIGHT-POINTING
      assert.equal(getDisplayWidth("\u2329\u232A"), 4);
    });

    it("should count Enclosed CJK squares as 2 columns each", () => {
      // U+1F210 SQUARED CJK UNIFIED IDEOGRAPH-624B etc.
      assert.equal(getDisplayWidth("\u{1F210}"), 2);
      assert.equal(getDisplayWidth("\u{1F240}"), 2);
    });

    it("should count text-style EAW=W dingbats as 1 column", () => {
      // Characters like ✂ (U+2702), ✔ (U+2714), ▶ (U+25B6) have
      // East_Asian_Width=W in the Unicode standard, but most terminal
      // emulators display them as 1 column without VS16.  We follow
      // terminal behavior, not the EAW property.
      assert.equal(getDisplayWidth("\u2702"), 1); // ✂ scissors
      assert.equal(getDisplayWidth("\u2714"), 1); // ✔ heavy check
      assert.equal(getDisplayWidth("\u25B6"), 1); // ▶ play button
      assert.equal(getDisplayWidth("\u27A1"), 1); // ➡ right arrow
    });
  });

  describe("combining marks", () => {
    it("should count e + combining acute as 1 column", () => {
      assert.equal(getDisplayWidth("e\u0301"), 1);
    });

    it("should count A + combining diaeresis as 1 column", () => {
      assert.equal(getDisplayWidth("\u0041\u0308"), 1);
    });

    it("should count character with multiple combining marks as 1 column", () => {
      assert.equal(getDisplayWidth("a\u0300\u0301"), 1);
    });

    it("should handle combining marks in longer text", () => {
      // "e\u0301 e\u0301 e\u0301" = 3 graphemes of 1 col + 2 spaces = 5
      assert.equal(getDisplayWidth("e\u0301 e\u0301 e\u0301"), 5);
    });
  });

  describe("emoji", () => {
    it("should count simple emoji as 2 columns", () => {
      assert.equal(getDisplayWidth("😀"), 2);
      assert.equal(getDisplayWidth("🎉"), 2);
    });

    it("should count ZWJ sequence as 2 columns", () => {
      assert.equal(getDisplayWidth("👨‍👩‍👧‍👦"), 2);
    });

    it("should count flag emoji as 2 columns", () => {
      assert.equal(getDisplayWidth("🇺🇸"), 2);
    });

    it("should count emoji with skin tone as 2 columns", () => {
      assert.equal(getDisplayWidth("👍🏽"), 2);
    });

    it("should handle multiple emoji", () => {
      assert.equal(getDisplayWidth("😀 😀 😀"), 8);
    });

    it("should count emoji followed by text correctly", () => {
      assert.equal(getDisplayWidth("👨‍👩‍👧‍👦 x"), 4);
    });
  });

  describe("ANSI escape codes", () => {
    it("should ignore SGR sequences", () => {
      assert.equal(getDisplayWidth("\x1b[1mhello\x1b[0m"), 5);
    });

    it("should ignore multiple SGR sequences", () => {
      assert.equal(getDisplayWidth("\x1b[1m\x1b[32mhello\x1b[0m"), 5);
    });

    it("should ignore OSC 8 hyperlinks", () => {
      assert.equal(
        getDisplayWidth("\x1b]8;;http://example.com\x1b\\link\x1b]8;;\x1b\\"),
        4,
      );
    });
  });

  describe("zero-width characters", () => {
    it("should not count zero-width joiner", () => {
      assert.equal(getDisplayWidth("\u200D"), 0);
    });

    it("should not count zero-width non-joiner", () => {
      assert.equal(getDisplayWidth("\u200C"), 0);
    });

    it("should not count zero-width space", () => {
      assert.equal(getDisplayWidth("\u200B"), 0);
    });
  });

  describe("control characters", () => {
    it("should not count newline", () => {
      assert.equal(getDisplayWidth("\n"), 0);
    });

    it("should count tab as 1 column", () => {
      // Actual terminal tab width varies (1–8 columns depending on
      // cursor position and tab-stop settings), but 1 is the minimum
      // safe lower bound.  Treating it as 0 would break maxWidth.
      assert.equal(getDisplayWidth("\t"), 1);
      assert.equal(getDisplayWidth("a\tb"), 3);
    });

    it("should not count other C0 controls", () => {
      assert.equal(getDisplayWidth("\x07"), 0); // BEL
      assert.equal(getDisplayWidth("\x0D"), 0); // CR
    });
  });

  describe("mixed content", () => {
    it("should handle ASCII + CJK", () => {
      assert.equal(getDisplayWidth("Hello 世界"), 10);
    });

    it("should handle ASCII + Korean", () => {
      assert.equal(getDisplayWidth("abc한def"), 8);
    });

    it("should handle CJK + emoji", () => {
      assert.equal(getDisplayWidth("한글😀"), 6);
    });

    it("should handle ANSI + CJK", () => {
      assert.equal(getDisplayWidth("\x1b[1m한글\x1b[0m"), 4);
    });
  });
});
