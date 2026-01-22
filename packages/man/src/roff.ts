import type { Message, MessageTerm } from "@optique/core/message";

/**
 * Escapes backslashes in text for roff.
 * This is an internal helper that only handles backslash escaping.
 *
 * @param text The text to escape.
 * @returns The text with backslashes escaped.
 */
function escapeBackslashes(text: string): string {
  return text.replace(/\\/g, "\\\\");
}

/**
 * Escapes period and single quote at line starts.
 * In roff, these characters have special meaning when at the start of a line.
 *
 * @param text The text to process.
 * @returns The text with line-start special characters escaped.
 */
function escapeLineStarts(text: string): string {
  if (text === "") return "";

  let result = text;

  // Escape period or single quote at the start of the string
  if (result.startsWith(".") || result.startsWith("'")) {
    result = "\\&" + result;
  }

  // Escape period or single quote after newlines
  result = result.replace(/\n([.'])/g, "\n\\&$1");

  return result;
}

/**
 * Escapes special roff characters in plain text.
 *
 * This function handles the following escapes:
 * - Backslash (`\`) → `\\`
 * - Period (`.`) at line start → `\&.`
 * - Single quote (`'`) at line start → `\&'`
 *
 * @param text The plain text to escape.
 * @returns The escaped text safe for use in roff documents.
 * @since 0.10.0
 */
export function escapeRoff(text: string): string {
  if (text === "") return "";
  return escapeLineStarts(escapeBackslashes(text));
}

/**
 * Escapes hyphens in option names to prevent line breaks.
 *
 * In roff, a regular hyphen (`-`) can be used as a line break point.
 * For option names like `--verbose`, we want to use `\-` which prevents
 * line breaks and renders as a proper minus sign.
 *
 * @param text The text containing hyphens to escape.
 * @returns The text with hyphens escaped as `\-`.
 * @since 0.10.0
 */
export function escapeHyphens(text: string): string {
  return text.replace(/-/g, "\\-");
}

/**
 * Formats a single {@link MessageTerm} as roff markup.
 * Note: This does NOT escape line-start characters (. and ') because
 * these terms may be concatenated with other terms. Line-start escaping
 * is done in formatMessageAsRoff after all terms are joined.
 *
 * @param term The message term to format.
 * @returns The roff-formatted string.
 */
function formatTermAsRoff(term: MessageTerm): string {
  switch (term.type) {
    case "text": {
      // Only escape backslashes, not line starts (handled later)
      // Paragraph breaks are also handled in formatMessageAsRoff
      return escapeBackslashes(term.text);
    }

    case "optionName":
      // Bold with escaped hyphens
      return `\\fB${escapeHyphens(term.optionName)}\\fR`;

    case "optionNames":
      // Comma-separated bold option names
      return term.optionNames
        .map((name) => `\\fB${escapeHyphens(name)}\\fR`)
        .join(", ");

    case "metavar":
      // Italic for metavariables
      return `\\fI${escapeBackslashes(term.metavar)}\\fR`;

    case "value":
      // Quoted value with escaped content
      return `"${escapeBackslashes(term.value)}"`;

    case "values":
      // Space-separated quoted values
      if (term.values.length === 0) return "";
      return term.values.map((v) => `"${escapeBackslashes(v)}"`).join(" ");

    case "envVar":
      // Bold for environment variables
      return `\\fB${escapeBackslashes(term.envVar)}\\fR`;

    case "commandLine":
      // Bold with escaped hyphens for command lines
      return `\\fB${escapeHyphens(escapeBackslashes(term.commandLine))}\\fR`;

    case "url":
      // URLs in man pages - underline with escaped hyphens
      return `\\fI${escapeHyphens(escapeBackslashes(term.url.href))}\\fR`;

    default: {
      // TypeScript exhaustiveness check
      const _exhaustive: never = term;
      throw new TypeError(
        `Unknown message term type: ${(_exhaustive as MessageTerm).type}.`,
      );
    }
  }
}

/**
 * Formats a {@link Message} as roff markup for use in man pages.
 *
 * This function converts Optique's structured message format into roff
 * markup suitable for man pages. Each message term type is converted
 * to appropriate roff formatting:
 *
 * | Term Type | Roff Output |
 * |-----------|-------------|
 * | `text` | Plain text (escaped) |
 * | `optionName` | `\fB--option\fR` (bold) |
 * | `optionNames` | `\fB--opt1\fR, \fB-o\fR` (comma-separated bold) |
 * | `metavar` | `\fIFILE\fR` (italic) |
 * | `value` | `"value"` (quoted) |
 * | `values` | `"a" "b" "c"` (space-separated quoted) |
 * | `envVar` | `\fBVAR\fR` (bold) |
 * | `commandLine` | `\fBcmd\fR` (bold) |
 *
 * @example
 * ```typescript
 * import { formatMessageAsRoff } from "@optique/man/roff";
 * import { message, optionName, metavar } from "@optique/core/message";
 *
 * const msg = message`Use ${optionName("--config")} ${metavar("FILE")}`;
 * const roff = formatMessageAsRoff(msg);
 * // => "Use \\fB\\-\\-config\\fR \\fIFILE\\fR"
 * ```
 *
 * @param msg The message to format.
 * @returns The roff-formatted string.
 * @since 0.10.0
 */
export function formatMessageAsRoff(msg: Message): string {
  // First join all terms
  const joined = msg.map(formatTermAsRoff).join("");
  // Escape line-start characters (. and ' at start of lines)
  const escaped = escapeLineStarts(joined);
  // Convert paragraph breaks (double newlines) to .PP macro
  // This must be done after escapeLineStarts so .PP is not escaped
  return escaped.replace(/\n\n+/g, "\n.PP\n");
}
