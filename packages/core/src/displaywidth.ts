const ansiRegex = // deno-lint-ignore no-control-regex
  /\x1B\[[0-9;]*[a-zA-Z]|\x1B\]8;;[^\x1B]*\x1B\\/g;

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

// Matches grapheme clusters that contain emoji presentation characters
// or emoji with variation selector 16 (U+FE0F).
const emojiPresentationRegex = /\p{Emoji_Presentation}/u;
const emojiWithVS16Regex = /\p{Emoji}\uFE0F/u;
// Regional indicator symbols used in flag sequences (U+1F1E6–U+1F1FF)
const regionalIndicatorRegex = /[\u{1F1E6}-\u{1F1FF}]/u;

function graphemeWidth(grapheme: string): number {
  const cp = grapheme.codePointAt(0);
  if (cp == null) return 0;

  // Control characters (C0, DEL, C1)
  if (cp < 0x20 || (cp >= 0x7F && cp < 0xA0)) return 0;

  // Zero-width characters
  if (
    cp === 0x200B || // zero-width space
    cp === 0x200C || // zero-width non-joiner
    cp === 0x200D || // zero-width joiner
    cp === 0xFEFF || // BOM / zero-width no-break space
    (cp >= 0xFE00 && cp <= 0xFE0F) || // variation selectors 1-16
    (cp >= 0xE0100 && cp <= 0xE01EF) // variation selectors 17-256
  ) {
    return 0;
  }

  // Emoji: check for emoji presentation, VS16, or regional indicators
  if (
    emojiPresentationRegex.test(grapheme) ||
    emojiWithVS16Regex.test(grapheme) ||
    regionalIndicatorRegex.test(grapheme)
  ) {
    return 2;
  }

  // East Asian Wide and Fullwidth characters
  if (isEastAsianWide(cp)) return 2;

  return 1;
}

function isEastAsianWide(cp: number): boolean {
  return (
    // Hangul Jamo
    (cp >= 0x1100 && cp <= 0x115F) ||
    // Hangul Jamo Extended-B (trailing jamo)
    (cp >= 0xD7B0 && cp <= 0xD7FF) ||
    // CJK Radicals Supplement, Kangxi Radicals
    (cp >= 0x2E80 && cp <= 0x2FDF) ||
    // Ideographic Description Characters, CJK Symbols and Punctuation
    (cp >= 0x2FF0 && cp <= 0x303E) ||
    // Hiragana, Katakana, Bopomofo, Hangul Compatibility Jamo,
    // Kanbun, Bopomofo Extended, CJK Strokes,
    // Katakana Phonetic Extensions, Enclosed CJK Letters and Months,
    // CJK Compatibility
    (cp >= 0x3041 && cp <= 0x33FF) ||
    // CJK Unified Ideographs Extension A
    (cp >= 0x3400 && cp <= 0x4DBF) ||
    // CJK Unified Ideographs
    (cp >= 0x4E00 && cp <= 0x9FFF) ||
    // Yi Syllables, Yi Radicals
    (cp >= 0xA000 && cp <= 0xA4CF) ||
    // Hangul Jamo Extended-A
    (cp >= 0xA960 && cp <= 0xA97F) ||
    // Hangul Syllables
    (cp >= 0xAC00 && cp <= 0xD7AF) ||
    // CJK Compatibility Ideographs
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    // Vertical Forms, CJK Compatibility Forms, Small Form Variants
    (cp >= 0xFE10 && cp <= 0xFE6F) ||
    // Fullwidth Forms (excluding halfwidth range)
    (cp >= 0xFF01 && cp <= 0xFF60) ||
    // Fullwidth Signs
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    // CJK Unified Ideographs Extension B through F
    (cp >= 0x20000 && cp <= 0x2FFFF) ||
    // CJK Unified Ideographs Extension G+
    (cp >= 0x30000 && cp <= 0x3FFFF)
  );
}
