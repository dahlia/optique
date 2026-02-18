import {
  formatMessage,
  type Message,
  type MessageTerm,
  text,
} from "./message.ts";
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

  /**
   * An optional list of valid choices for the entry, formatted as a
   * comma-separated {@link Message}.  When present and the `showChoices`
   * formatting option is enabled, this is appended to the entry description.
   *
   * @since 0.10.0
   */
  readonly choices?: Message;
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
  /**
   * Usage examples for the program.
   * @since 0.10.0
   */
  readonly examples?: Message;
  /**
   * Author information.
   * @since 0.10.0
   */
  readonly author?: Message;
  /**
   * Information about where to report bugs.
   * @since 0.10.0
   */
  readonly bugs?: Message;
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
   * An optional brief that provides a short summary for the collection
   * of fragments.
   * @since 0.7.12
   */
  readonly brief?: Message;

  /**
   * An optional description that applies to the entire collection of fragments.
   */
  readonly description?: Message;

  /**
   * An array of documentation fragments that can be entries or sections.
   */
  readonly fragments: readonly DocFragment[];

  /**
   * An optional footer that appears at the bottom of the documentation.
   * @since 0.6.0
   */
  readonly footer?: Message;
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
 * Configuration for customizing choices display formatting.
 *
 * @since 0.10.0
 */
export interface ShowChoicesOptions {
  /**
   * Text to display before the choices list.
   *
   * @default `" ("`
   */
  readonly prefix?: string;

  /**
   * Text to display after the choices list.
   *
   * @default `")"`
   */
  readonly suffix?: string;

  /**
   * Label text to display before the individual choice values.
   *
   * @default `"choices: "`
   */
  readonly label?: string;

  /**
   * Maximum number of choice values to display before truncating with
   * `...`.  Set to `Infinity` to show all choices.
   *
   * @default `8`
   */
  readonly maxItems?: number;
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

  /**
   * Whether and how to display valid choices for options and arguments
   * backed by enumerated value parsers (e.g., `choice()`).
   *
   * - `boolean`: When `true`, displays choices using format
   *   `(choices: a, b, c)`
   * - `ShowChoicesOptions`: Custom formatting with configurable prefix,
   *   suffix, label, and maximum number of items
   *
   * Choice values are automatically dimmed when `colors` is enabled.
   *
   * @default `false`
   * @since 0.10.0
   *
   * @example
   * ```typescript
   * // Basic usage - shows "(choices: json, yaml, xml)"
   * { showChoices: true }
   *
   * // Custom format - shows "{json | yaml | xml}"
   * { showChoices: { prefix: " {", suffix: "}", label: "" } }
   *
   * // Limit displayed choices
   * { showChoices: { maxItems: 3 } }
   * ```
   */
  showChoices?: boolean | ShowChoicesOptions;

  /**
   * A custom comparator function to control the order of sections in the
   * help output.  When provided, it is used instead of the default smart
   * sort (command-only sections first, then mixed, then option/argument-only
   * sections).  Sections that compare equal (return `0`) preserve their
   * original relative order (stable sort).
   *
   * @param a The first section to compare.
   * @param b The second section to compare.
   * @returns A negative number if `a` should appear before `b`, a positive
   *   number if `a` should appear after `b`, or `0` if they are equal.
   * @since 1.0.0
   *
   * @example
   * ```typescript
   * // Sort sections alphabetically by title
   * {
   *   sectionOrder: (a, b) => (a.title ?? "").localeCompare(b.title ?? "")
   * }
   * ```
   */
  sectionOrder?: (a: DocSection, b: DocSection) => number;
}

/**
 * Classifies a {@link DocSection} by its content type for use in the
 * default smart sort.
 *
 * @returns `0` for command-only sections, `1` for mixed sections, `2` for
 *   option/argument/passthrough-only sections.
 */
function classifySection(section: DocSection): 0 | 1 | 2 {
  const hasCommand = section.entries.some((e) => e.term.type === "command");
  const hasNonCommand = section.entries.some((e) => e.term.type !== "command");
  if (hasCommand && !hasNonCommand) return 0;
  if (hasCommand && hasNonCommand) return 1;
  return 2;
}

/**
 * The default section comparator: command-only sections come first, then
 * mixed sections, then option/argument-only sections.  Sections with the
 * same score preserve their original relative order (stable sort).
 */
function defaultSectionOrder(a: DocSection, b: DocSection): number {
  return classifySection(a) - classifySection(b);
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
    const usageLabel = options.colors ? "\x1b[1;2mUsage:\x1b[0m " : "Usage: ";
    output += usageLabel;
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
  const comparator = options.sectionOrder ?? defaultSectionOrder;
  // Stable sort with three-level tie-breaking:
  // 1. comparator result (primary)
  // 2. untitled sections before titled sections (secondary)
  // 3. original index (tertiary, preserves relative order)
  const sections = page.sections
    .map((s, i) => ({ section: s, index: i }))
    .toSorted((a, b) => {
      const cmp = comparator(a.section, b.section);
      if (cmp !== 0) return cmp;
      const titleCmp = (a.section.title == null ? 0 : 1) -
        (b.section.title == null ? 0 : 1);
      return titleCmp !== 0 ? titleCmp : a.index - b.index;
    })
    .map(({ section }) => section);
  for (const section of sections) {
    // Skip sections with no entries
    if (section.entries.length < 1) continue;
    output += "\n";
    if (section.title != null) {
      const sectionLabel = options.colors
        ? `\x1b[1;2m${section.title}:\x1b[0m\n`
        : `${section.title}:\n`;
      output += sectionLabel;
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

      // Append choices if showChoices is enabled and choices exist
      if (options.showChoices && entry.choices != null) {
        const prefix = typeof options.showChoices === "object"
          ? options.showChoices.prefix ?? " ("
          : " (";
        const suffix = typeof options.showChoices === "object"
          ? options.showChoices.suffix ?? ")"
          : ")";
        const label = typeof options.showChoices === "object"
          ? options.showChoices.label ?? "choices: "
          : "choices: ";
        const maxItems = typeof options.showChoices === "object"
          ? options.showChoices.maxItems ?? 8
          : 8;
        // Truncate at the Message level by counting value terms
        const terms = Array.isArray(entry.choices) ? entry.choices : [];
        let truncatedTerms: readonly MessageTerm[] = terms;
        let truncated = false;
        if (maxItems < Infinity) {
          let valueCount = 0;
          let cutIndex = terms.length;
          for (let i = 0; i < terms.length; i++) {
            if (terms[i].type === "value") {
              valueCount++;
              if (valueCount > maxItems) {
                // Cut before the separator that precedes this value
                cutIndex = i > 0 && terms[i - 1].type === "text" ? i - 1 : i;
                truncated = true;
                break;
              }
            }
          }
          if (truncated) {
            truncatedTerms = [
              ...terms.slice(0, cutIndex),
              text(", ..."),
            ];
          }
        }
        const choicesDisplay = formatMessage(truncatedTerms, {
          colors: options.colors ? { resetSuffix: "\x1b[2m" } : false,
          quotes: false,
        });
        const choicesText = `${prefix}${label}${choicesDisplay}${suffix}`;
        const formattedChoices = options.colors
          ? `\x1b[2m${choicesText}\x1b[0m`
          : choicesText;
        description += formattedChoices;
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
  if (page.examples != null) {
    output += "\n";
    const examplesLabel = options.colors
      ? "\x1b[1;2mExamples:\x1b[0m\n"
      : "Examples:\n";
    output += examplesLabel;
    const examplesContent = formatMessage(page.examples, {
      colors: options.colors,
      maxWidth: options.maxWidth == null ? undefined : options.maxWidth - 2,
      quotes: !options.colors,
    });
    output += "  " + indentLines(examplesContent, 2);
    output += "\n";
  }
  if (page.author != null) {
    output += "\n";
    const authorLabel = options.colors
      ? "\x1b[1;2mAuthor:\x1b[0m\n"
      : "Author:\n";
    output += authorLabel;
    const authorContent = formatMessage(page.author, {
      colors: options.colors,
      maxWidth: options.maxWidth == null ? undefined : options.maxWidth - 2,
      quotes: !options.colors,
    });
    output += "  " + indentLines(authorContent, 2);
    output += "\n";
  }
  if (page.bugs != null) {
    output += "\n";
    const bugsLabel = options.colors ? "\x1b[1;2mBugs:\x1b[0m\n" : "Bugs:\n";
    output += bugsLabel;
    const bugsContent = formatMessage(page.bugs, {
      colors: options.colors,
      maxWidth: options.maxWidth == null ? undefined : options.maxWidth - 2,
      quotes: !options.colors,
    });
    output += "  " + indentLines(bugsContent, 2);
    output += "\n";
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
