import { formatMessage, type Message } from "./message.ts";
import {
  formatUsage,
  formatUsageTerm,
  type Usage,
  type UsageTerm,
} from "./usage.ts";

/**
 * A documentation entry which describes a specific usage of a command or
 * option.  It includes a subject (the usage), a description, and an optional
 * default value.
 */
export interface DocEntry {
  /**
   * The subject of the entry, which is typically a command or option
   * usage.
   */
  readonly term: UsageTerm;

  /**
   * A description of the entry, which provides additional context or
   * information about the usage.
   */
  readonly description?: Message;

  /**
   * An optional default value for the entry, which can be used to
   * indicate what the default behavior is if the command or option is not
   * specified.
   */
  readonly default?: Message;
}

/**
 * A section in a document that groups related entries together.
 */
export interface DocSection {
  readonly title?: string;
  readonly entries: readonly DocEntry[];
}

/**
 * A document page that contains multiple sections, each with its own brief
 * and a list of entries. This structure is used to organize documentation
 * for commands, options, and other related information.
 */
export interface DocPage {
  readonly brief?: Message;
  readonly usage?: Usage;
  readonly description?: Message;
  readonly sections: readonly DocSection[];
  readonly footer?: Message;
}

/**
 * A documentation fragment that can be either an entry or a section.
 * Fragments are building blocks used to construct documentation pages.
 */
export type DocFragment =
  | { readonly type: "entry" } & DocEntry
  | { readonly type: "section" } & DocSection;

/**
 * A collection of documentation fragments with an optional description.
 * This structure is used to gather fragments before organizing them into
 * a final document page.
 */
export interface DocFragments {
  /**
   * An optional description that applies to the entire collection of fragments.
   */
  readonly description?: Message;

  /**
   * An array of documentation fragments that can be entries or sections.
   */
  readonly fragments: readonly DocFragment[];
}

/**
 * Configuration for customizing default value display formatting.
 *
 * @since 0.4.0
 */
export interface ShowDefaultOptions {
  /**
   * Text to display before the default value.
   *
   * @default `" ["`
   */
  readonly prefix?: string;

  /**
   * Text to display after the default value.
   *
   * @default `"]"`
   */
  readonly suffix?: string;
}

/**
 * Options for formatting a documentation page.
 */
export interface DocPageFormatOptions {
  /**
   * Whether to include ANSI color codes in the output.
   * @default `false`
   */
  colors?: boolean;

  /**
   * Number of spaces to indent terms in documentation entries.
   * @default `2`
   */
  termIndent?: number;

  /**
   * Width allocated for terms before descriptions start.
   * @default `26`
   */
  termWidth?: number;

  /**
   * Maximum width of the entire formatted output.
   */
  maxWidth?: number;

  /**
   * Whether and how to display default values for options and arguments.
   *
   * - `boolean`: When `true`, displays defaults using format `[value]`
   * - `ShowDefaultOptions`: Custom formatting with configurable prefix and suffix
   *
   * Default values are automatically dimmed when `colors` is enabled.
   *
   * @default `false`
   * @since 0.4.0
   *
   * @example
   * ```typescript
   * // Basic usage - shows "[3000]"
   * { showDefault: true }
   *
   * // Custom format - shows "(default: 3000)"
   * { showDefault: { prefix: " (default: ", suffix: ")" } }
   *
   * // Custom format - shows " - defaults to 3000"
   * { showDefault: { prefix: " - defaults to ", suffix: "" } }
   * ```
   */
  showDefault?: boolean | ShowDefaultOptions;
}

/**
 * Formats a documentation page into a human-readable string.
 *
 * This function takes a structured {@link DocPage} and converts it into
 * a formatted string suitable for display in terminals or documentation.
 * The formatting includes proper indentation, alignment, and optional
 * color support.
 *
 * @param programName The name of the program, used in usage lines
 * @param page The documentation page to format
 * @param options Formatting options to customize the output
 * @returns A formatted string representation of the documentation page
 *
 * @example
 * ```typescript
 * const page: DocPage = {
 *   brief: "A CLI tool",
 *   usage: [{ type: "literal", value: "myapp" }],
 *   sections: [{
 *     title: "Options",
 *     entries: [{
 *       term: { type: "option", short: "-v", long: "--verbose" },
 *       description: "Enable verbose output"
 *     }]
 *   }]
 * };
 *
 * const formatted = formatDocPage("myapp", page, { colors: true });
 * console.log(formatted);
 * ```
 */
export function formatDocPage(
  programName: string,
  page: DocPage,
  options: DocPageFormatOptions = {},
): string {
  const termIndent = options.termIndent ?? 2;
  const termWidth = options.termWidth ?? 26;
  let output = "";
  if (page.brief != null) {
    output += formatMessage(page.brief, {
      colors: options.colors,
      maxWidth: options.maxWidth,
      quotes: !options.colors,
    });
    output += "\n";
  }
  if (page.usage != null) {
    output += "Usage: ";
    output += indentLines(
      formatUsage(programName, page.usage, {
        colors: options.colors,
        maxWidth: options.maxWidth == null ? undefined : options.maxWidth - 7,
        expandCommands: true,
      }),
      7,
    );
    output += "\n";
  }
  if (page.description != null) {
    output += "\n";
    output += formatMessage(page.description, {
      colors: options.colors,
      maxWidth: options.maxWidth,
      quotes: !options.colors,
    });
    output += "\n";
  }
  const sections = page.sections.toSorted((a, b) =>
    a.title == null && b.title == null ? 0 : a.title == null ? -1 : 1
  );
  for (const section of sections) {
    output += "\n";
    if (section.title != null) {
      output += `${section.title}:\n`;
    }
    for (const entry of section.entries) {
      const term = formatUsageTerm(entry.term, {
        colors: options.colors,
        optionsSeparator: ", ",
        maxWidth: options.maxWidth == null
          ? undefined
          : options.maxWidth - termIndent,
      });

      let description = entry.description == null
        ? ""
        : formatMessage(entry.description, {
          colors: options.colors,
          quotes: !options.colors,
          maxWidth: options.maxWidth == null
            ? undefined
            : options.maxWidth - termIndent - termWidth - 2,
        });

      // Append default value if showDefault is enabled and default exists
      if (options.showDefault && entry.default != null) {
        const prefix = typeof options.showDefault === "object"
          ? options.showDefault.prefix ?? " ["
          : " [";
        const suffix = typeof options.showDefault === "object"
          ? options.showDefault.suffix ?? "]"
          : "]";
        const defaultText = `${prefix}${
          formatMessage(entry.default, {
            colors: options.colors ? { resetSuffix: "\x1b[2m" } : false,
            quotes: !options.colors,
          })
        }${suffix}`;
        const formattedDefault = options.colors
          ? `\x1b[2m${defaultText}\x1b[0m`
          : defaultText;
        description += formattedDefault;
      }

      output += `${" ".repeat(termIndent)}${
        ansiAwareRightPad(term, termWidth)
      }  ${
        description === "" ? "" : indentLines(
          description,
          termIndent + termWidth + 2,
        )
      }\n`;
    }
  }
  if (page.footer != null) {
    output += "\n";
    output += formatMessage(page.footer, {
      colors: options.colors,
      maxWidth: options.maxWidth,
      quotes: !options.colors,
    });
  }
  return output;
}

function indentLines(text: string, indent: number): string {
  return text.split("\n").join("\n" + " ".repeat(indent));
}

function ansiAwareRightPad(
  text: string,
  length: number,
  char: string = " ",
): string {
  // deno-lint-ignore no-control-regex
  const ansiEscapeCodeRegex = /\x1B\[[0-9;]*[a-zA-Z]/g;
  const strippedText = text.replace(ansiEscapeCodeRegex, "");
  if (strippedText.length >= length) {
    return text;
  }
  return text + char.repeat(length - strippedText.length);
}
