// CSI sequences: ESC [ params letter
//   params may use ; (standard) or : (sub-parameters, e.g., truecolor)
// OSC 8 hyperlinks: ESC ]8; params ; uri ST
//   params may be empty (;;) or contain key=value (;id=foo;)
//   terminated by ESC \ (ST) or BEL (\x07)
const ansiRegex = // deno-lint-ignore no-control-regex
  /\x1B\[[0-9;:]*[a-zA-Z]|\x1B\]8;[^;]*;[^\x1B\x07]*(?:\x1B\\|\x07)/g;

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

/**
 * Computes the terminal display width of a string, accounting for
 * East Asian wide characters, combining marks, emoji, and ANSI escapes.
 *
 * @param text The string to measure.
 * @returns The number of terminal columns the string occupies.
 * @internal
 */
export function getDisplayWidth(text: string): number {
  const stripped = text.replace(ansiRegex, "");
  let width = 0;
  for (const { segment } of segmenter.segment(stripped)) {
    width += graphemeWidth(segment);
  }
  return width;
}

// A standalone format char (Cf), nonspacing mark (Mn), or enclosing
// mark (Me) occupies zero terminal columns.
const zeroWidthRegex = /^[\p{Cf}\p{Mn}\p{Me}]$/u;

// Matches grapheme clusters that contain emoji presentation characters
// or emoji with variation selector 16 (U+FE0F).
const emojiPresentationRegex = /\p{Emoji_Presentation}/u;
const emojiWithVS16Regex = /\p{Emoji}\uFE0F/u;
// Regional indicator symbols used in flag sequences (U+1F1E6–U+1F1FF)
const regionalIndicatorRegex = /[\u{1F1E6}-\u{1F1FF}]/u;

function graphemeWidth(grapheme: string): number {
  const cp = grapheme.codePointAt(0);
  if (cp == null) return 0;

  // Tab: actual terminal width depends on cursor position and tab-stop
  // settings (1–8 columns), but 1 is the minimum safe lower bound.
  // Treating it as 0 would let lines silently exceed maxWidth.
  if (cp === 0x09) return 1;

  // Other control characters (C0, DEL, C1)
  if (cp < 0x20 || (cp >= 0x7F && cp < 0xA0)) return 0;

  // Zero-width: format characters (Cf), nonspacing marks (Mn), and
  // enclosing marks (Me).  When these appear as standalone graphemes
  // they occupy no terminal columns.  This covers ZWJ, ZWNJ, BOM,
  // variation selectors, bidi marks, word joiner, soft hyphen,
  // standalone combining accents, and all similar invisible marks.
  if (zeroWidthRegex.test(grapheme)) return 0;

  // Emoji: check for emoji presentation, VS16, or regional indicators
  if (
    emojiPresentationRegex.test(grapheme) ||
    emojiWithVS16Regex.test(grapheme) ||
    regionalIndicatorRegex.test(grapheme)
  ) {
    return 2;
  }

  // East Asian Wide and Fullwidth characters
  let width = isEastAsianWide(cp) ? 2 : 1;

  // Halfwidth katakana voiced sound mark (U+FF9E ﾞ) and semi-voiced
  // sound mark (U+FF9F ﾟ) are grouped into the preceding kana's
  // grapheme cluster by Intl.Segmenter, but unlike true combining marks
  // each one occupies its own terminal column.
  for (let i = 1; i < grapheme.length; i++) {
    const c = grapheme.charCodeAt(i);
    if (c === 0xFF9E || c === 0xFF9F) width += 1;
  }

  return width;
}

// Characters that occupy two terminal columns.
//
// This table targets *terminal display width*, not the Unicode
// East_Asian_Width (EAW) property verbatim.  The two diverge for about
// 30 "text-style emoji" code points (e.g., U+2702 ✂, U+2714 ✔,
// U+25B6 ▶) that have EAW=W but are rendered as a single column by
// virtually every modern terminal emulator unless followed by VS16
// (U+FE0F).  Treating them as 2 columns would *worsen* alignment in
// real terminal output, so we intentionally follow observed terminal
// behavior instead.  The VS16 case is already handled: the emoji
// detection above matches `\p{Emoji}\uFE0F` and returns width 2.
//
// All contiguous CJK/Hangul/Fullwidth blocks, the two deprecated CJK
// angle brackets (U+2329–232A), and the Enclosed CJK / Tortoise Shell
// Bracket ranges in the SMP (U+1F200–1F265) are included because
// terminals universally render them as two columns.
//
// References:
//   UAX #11  https://www.unicode.org/reports/tr11/
//   EastAsianWidth.txt (Unicode 16.0)
function isEastAsianWide(cp: number): boolean {
  return (
    // Hangul Jamo (leading consonants, U+1100–U+115F)
    (cp >= 0x1100 && cp <= 0x115F) ||
    // Left/Right-Pointing Angle Bracket (deprecated CJK, U+2329–232A)
    (cp >= 0x2329 && cp <= 0x232A) ||
    // Trigrams (U+2630–2637), Monogram/Digram Symbols (U+268A–268F)
    // CJK-origin Yijing symbols that terminals render as 2 columns
    (cp >= 0x2630 && cp <= 0x2637) ||
    (cp >= 0x268A && cp <= 0x268F) ||
    // CJK Radicals Supplement, Kangxi Radicals
    (cp >= 0x2E80 && cp <= 0x2FDF) ||
    // Ideographic Description Characters, CJK Symbols and Punctuation,
    // Hiragana, Katakana, Bopomofo, Hangul Compatibility Jamo, Kanbun,
    // Bopomofo Extended, CJK Strokes, Katakana Phonetic Extensions,
    // Enclosed CJK, CJK Compatibility, CJK Extension A,
    // Yijing Hexagram Symbols (U+4DC0–4DFF), CJK Unified Ideographs
    (cp >= 0x2FF0 && cp <= 0x9FFF) ||
    // Yi Syllables, Yi Radicals
    (cp >= 0xA000 && cp <= 0xA4CF) ||
    // Hangul Jamo Extended-A
    (cp >= 0xA960 && cp <= 0xA97F) ||
    // Hangul Syllables
    (cp >= 0xAC00 && cp <= 0xD7AF) ||
    // CJK Compatibility Ideographs
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    // Vertical Forms (U+FE10–FE19)
    (cp >= 0xFE10 && cp <= 0xFE19) ||
    // CJK Compatibility Forms, Small Form Variants (U+FE30–FE6F)
    // (excludes Combining Half Marks U+FE20–FE2F which are EAW=N)
    (cp >= 0xFE30 && cp <= 0xFE6F) ||
    // Fullwidth Forms (excluding halfwidth range)
    (cp >= 0xFF01 && cp <= 0xFF60) ||
    // Fullwidth Signs
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    // Ideographic Symbols, Tangut, Tangut Components,
    // Khitan Small Script, Tangut Supplement (contiguous)
    (cp >= 0x16FE0 && cp <= 0x18D7F) ||
    // Kana Extended-B, Kana Supplement, Kana Extended-A,
    // Small Kana Extension, Nushu (contiguous)
    (cp >= 0x1AFF0 && cp <= 0x1B2FF) ||
    // Enclosed CJK, Tortoise Shell Brackets, Circled & Rounded Symbols
    (cp >= 0x1F200 && cp <= 0x1F202) ||
    (cp >= 0x1F210 && cp <= 0x1F23B) ||
    (cp >= 0x1F240 && cp <= 0x1F248) ||
    (cp >= 0x1F250 && cp <= 0x1F251) ||
    (cp >= 0x1F260 && cp <= 0x1F265) ||
    // CJK Unified Ideographs Extension B through F
    (cp >= 0x20000 && cp <= 0x2FFFD) ||
    // CJK Unified Ideographs Extension G+
    (cp >= 0x30000 && cp <= 0x3FFFD)
  );
}
