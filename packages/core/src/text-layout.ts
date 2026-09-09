import { getDisplayWidth, stripAnsi } from "./displaywidth.ts";

/** Physical-line geometry at a rendered-text assembly boundary. @internal */
export interface TextMetrics {
  readonly firstLineWidth: number;
  readonly lastLineWidth: number;
  readonly maxLineWidth: number;
  readonly lineCount: number;
}

/**
 * Measures physical lines after removing terminal escape sequences.
 * Empty text occupies one empty line; a trailing LF adds an empty final line.
 * @param text Rendered text, possibly containing ANSI styles or OSC links.
 * @returns First, last and widest line widths, and the number of lines.
 * @internal
 */
export function measureText(text: string): TextMetrics {
  const lines = stripAnsi(text).split("\n");
  const widths = lines.map(getDisplayWidth);
  return {
    firstLineWidth: widths[0],
    lastLineWidth: widths[widths.length - 1],
    maxLineWidth: widths.reduce((widest, width) => Math.max(widest, width), 0),
    lineCount: lines.length,
  };
}

/**
 * The current visible line and its occupied column. The column may include
 * an external offset for text unavailable to this renderer (initialWidth).
 * @internal
 */
export interface TextCursor {
  readonly line: string;
  readonly column: number;
}

/**
 * Appends rendered text to a cursor, optionally moving it to a fresh line.
 * Measures the actual join so combining sequences crossing the boundary are
 * handled correctly. Hard breaks reset both the line and any external offset.
 * This never reflows the text itself or changes its escape sequences.
 * @param text Text to append.
 * @param cursor The current line and column.
 * @param maxWidth Optional column budget.
 * @param trailingRoom Space to leave after a single-line block. An annotation
 * prefix reserves one column for content; a multiline prefix already has a
 * hard break, so its first line needs no reservation.
 * @returns The placed text (possibly with a leading LF) and resulting cursor.
 * @internal
 */
export function placeText(
  text: string,
  cursor: TextCursor,
  maxWidth?: number,
  trailingRoom = 0,
): { readonly text: string; readonly cursor: TextCursor } {
  const plain = stripAnsi(text);
  const lines = plain.split("\n");
  const offset = cursor.column - getDisplayWidth(cursor.line);
  const joinedWidth = offset + getDisplayWidth(cursor.line + lines[0]);
  const room = lines.length === 1 ? trailingRoom : 0;
  // An empty/zero-width boundary cannot make an already overflowing atom
  // worse. In particular, do not add a break before an existing leading LF.
  const breaks = maxWidth != null && (cursor.column > 0 || room > 0) &&
    (joinedWidth > cursor.column || room > 0) &&
    joinedWidth + room > maxWidth;
  const lastLine = lines[lines.length - 1];
  return {
    text: breaks ? "\n" + text : text,
    cursor: lines.length > 1 || breaks
      ? { line: lastLine, column: getDisplayWidth(lastLine) }
      : { line: cursor.line + plain, column: joinedWidth },
  };
}

/** Fixed annotation geometry shared by preflight and placement. @internal */
export interface AnnotationLayout {
  readonly prefix: string;
  readonly suffix: string;
  readonly prefixMetrics: TextMetrics;
  readonly suffixMetrics: TextMetrics;
  readonly minWidth: number;
}

/**
 * Measures an annotation's fixed text without invoking theme callbacks.
 * @param prefix The already joined prefix and optional label.
 * @param suffix The closing text.
 * @returns Geometry reserving at least one content column after the suffix's
 * first-line width has been deducted from the formatter budget.
 * @internal
 */
export function measureAnnotation(
  prefix: string,
  suffix: string,
): AnnotationLayout {
  const prefixMetrics = measureText(prefix);
  const suffixMetrics = measureText(suffix);
  return {
    prefix,
    suffix,
    prefixMetrics,
    suffixMetrics,
    minWidth: Math.max(
      prefixMetrics.maxLineWidth,
      suffixMetrics.maxLineWidth,
      suffixMetrics.firstLineWidth + 1,
    ),
  };
}
