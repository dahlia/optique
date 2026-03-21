import {
  formatMessage,
  type Message,
  type MessageFormatOptions,
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
 * Scores a section for the default smart sort.  Untitled sections receive
 * a bonus of `-1` so that the main (untitled) section appears before titled
 * sections of a similar classification.
 */
function scoreSection(section: DocSection): number {
  return classifySection(section) + (section.title == null ? -1 : 0);
}

/**
 * The default section comparator: command-only sections come first, then
 * mixed sections, then option/argument-only sections.  Untitled sections
 * receive a score bonus of -1 via {@link scoreSection} so that untitled
 * command-only sections naturally sort before titled command-only sections.
 * Sections with the same score preserve their original relative order
 * (stable sort).
 */
function defaultSectionOrder(a: DocSection, b: DocSection): number {
  return scoreSection(a) - scoreSection(b);
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
 * @throws {TypeError} If `programName` contains a CR or LF character, if
 * any non-empty section's title is empty, whitespace-only, or contains a CR
 * or LF character, or if `maxWidth` is not a finite integer.
 * @throws {RangeError} If any entry needs a description column and `maxWidth`
 * is too small to fit the minimum layout (less than `termIndent + 4`).
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
  if (/[\r\n]/.test(programName)) {
    throw new TypeError("Program name must not contain newlines.");
  }
  const termIndent = options.termIndent ?? 2;
  const termWidth = options.termWidth ?? 26;
  if (
    options.maxWidth != null &&
    (!Number.isFinite(options.maxWidth) || !Number.isInteger(options.maxWidth))
  ) {
    throw new TypeError(
      `maxWidth must be a finite integer, got ${options.maxWidth}.`,
    );
  }
  // Pre-filter sections: remove entries whose terms are hidden in doc context
  // or structurally degenerate (e.g., option with no names, empty command).
  // This must happen before maxWidth validation so width checks reflect the
  // actual rendered output, and before rendering so empty sections (all
  // entries filtered) do not emit dangling section headers.
  const filteredSections: readonly DocSection[] = page.sections.map((s) => ({
    ...s,
    entries: s.entries.filter((e) => {
      const rendered = formatUsageTerm(e.term, { context: "doc" });
      return rendered.trim() !== "";
    }),
  }));
  page = { ...page, sections: filteredSections };

  // Validate maxWidth against the minimum feasible layout.  The minimum
  // depends on which page features are active:
  //  - Entries with a description column need enough space for term +
  //    gap + description, plus any showDefault/showChoices prefixes.
  //  - Bare-term entries need termIndent + 1 (just 1 term char).
  //  - "Usage: " + programName + " " → maxWidth >= 8 + programName.length.
  //  - Examples:/Author:/Bugs: labels are 9/7/5 chars on their own lines.
  if (options.maxWidth != null) {
    const hasEntries = page.sections.some((s) => s.entries.length > 0);
    const hasContent = (msg: unknown): msg is readonly unknown[] =>
      Array.isArray(msg) && msg.length > 0;
    // The formatter skips empty default/choices arrays, so the
    // validation must match: use hasContent() (which checks length > 0)
    // rather than just `!= null`.
    const needsDescColumn = hasEntries &&
      page.sections.some((s) =>
        s.entries.some((e) =>
          hasContent(e.description) ||
          (options.showDefault && hasContent(e.default)) ||
          (options.showChoices && hasContent(e.choices))
        )
      );
    // Compute minimum description column width for showDefault/showChoices.
    // When the rendered content is non-empty, only the prefix (or
    // prefix + label for choices) must fit on one line; the suffix
    // trails the content's last line.  When the content is empty
    // (e.g., default: []), prefix + suffix land on the same line, so
    // the suffix must be included in the minimum.
    let minDescWidth = 1;
    if (needsDescColumn) {
      if (
        options.showDefault &&
        page.sections.some((s) => s.entries.some((e) => hasContent(e.default)))
      ) {
        const prefix = typeof options.showDefault === "object"
          ? options.showDefault.prefix ?? " ["
          : " [";
        minDescWidth = Math.max(minDescWidth, prefix.length);
      }
      if (
        options.showChoices &&
        page.sections.some((s) => s.entries.some((e) => hasContent(e.choices)))
      ) {
        const prefix = typeof options.showChoices === "object"
          ? options.showChoices.prefix ?? " ("
          : " (";
        const label = typeof options.showChoices === "object"
          ? options.showChoices.label ?? "choices: "
          : "choices: ";
        minDescWidth = Math.max(
          minDescWidth,
          prefix.length + label.length,
        );
      }
    }
    // Entry minimum: the layout needs enough space for the term column,
    // the 2-char gap, and at least minDescWidth for the description.
    // Two layout modes yield different minimums:
    //  - Split layout (small maxWidth): descColumnWidth = ceil(a/2),
    //    requires a >= max(2, 2*minDescWidth - 1).
    //  - Fixed-term layout: descColumnWidth = maxWidth - termIndent -
    //    termWidth - 2, requires maxWidth >= termIndent + termWidth + 2 +
    //    minDescWidth.
    // The cheaper layout determines the true minimum.  A second check
    // below catches values in the gap between the two valid ranges.
    const splitEntryMin = termIndent + 2 + Math.max(2, 2 * minDescWidth - 1);
    const fixedEntryMin = termIndent + 2 + termWidth + minDescWidth;
    const entryMin = needsDescColumn
      ? Math.min(splitEntryMin, fixedEntryMin)
      : hasEntries
      ? termIndent + 1
      : 1;
    // "Usage: " (7 chars) + programName + " " is the minimum first line.
    const usageMin = page.usage != null ? 8 + programName.length : 1;
    // Examples/Author/Bugs have fixed-width label lines that cannot be
    // wrapped.  The content is indented by 2 chars (needing maxWidth >= 3),
    // but the label width is always the binding constraint.
    let sectionMin = 1;
    if (page.examples != null) sectionMin = Math.max(sectionMin, 9);
    if (page.author != null) sectionMin = Math.max(sectionMin, 7);
    if (page.bugs != null) sectionMin = Math.max(sectionMin, 5);
    const minWidth = Math.max(entryMin, usageMin, sectionMin);
    if (options.maxWidth < minWidth) {
      throw new RangeError(
        `maxWidth must be at least ${minWidth}, got ${options.maxWidth}.`,
      );
    }
    // Second check: even if maxWidth passes the formula-based minimum,
    // the actual layout may use the full termWidth, giving a description
    // column of only maxWidth - termIndent - termWidth - 2 chars.  When
    // this is smaller than minDescWidth, the fixed prefixes overflow.
    if (needsDescColumn && minDescWidth > 1) {
      const avail = options.maxWidth - termIndent - 2;
      const effTW = avail >= termWidth + 1
        ? termWidth
        : Math.max(1, Math.floor(avail / 2));
      const descW = avail - effTW;
      if (descW < minDescWidth) {
        const needed = termIndent + termWidth + 2 + minDescWidth;
        throw new RangeError(
          `maxWidth must be at least ${needed}, got ${options.maxWidth}.`,
        );
      }
    }
  }
  // When maxWidth constrains the layout, shrink the term column so that
  // the description column gets a reasonable share of the available width.
  // Layout: <termIndent><term><2-space gap><description>
  // When the normal termWidth fits (leaving >= 1 char for description),
  // keep it unchanged.  Otherwise, split the available space evenly
  // between term and description columns.
  let effectiveTermWidth: number;
  if (options.maxWidth == null) {
    effectiveTermWidth = termWidth;
  } else {
    const availableForColumns = options.maxWidth - termIndent - 2;
    effectiveTermWidth = availableForColumns >= termWidth + 1
      ? termWidth
      : Math.max(1, Math.floor(availableForColumns / 2));
  }
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
  // Stable sort with two-level tie-breaking:
  // 1. comparator result (primary)
  // 2. original index (secondary, preserves relative order)
  //
  // Note: previously a secondary "untitled before titled" rule was applied
  // here, but it caused ungrouped meta items (e.g. --help, --version) to
  // appear before the user's titled command sections in the output.  The
  // correct ordering is now enforced in buildDocPage, which places titled
  // sections first and the untitled catch-all section last in the sections
  // array.
  const sections = page.sections
    .map((s, i) => ({ section: s, index: i }))
    .toSorted((a, b) => {
      const cmp = comparator(a.section, b.section);
      if (cmp !== 0) return cmp;
      return a.index - b.index;
    })
    .map(({ section }) => section);
  for (const section of sections) {
    // Skip sections with no entries
    if (section.entries.length < 1) continue;
    output += "\n";
    if (section.title != null) {
      if (section.title.trim() === "" || /[\r\n]/.test(section.title)) {
        throw new TypeError(
          "Section title must not be empty, whitespace-only, or contain newlines.",
        );
      }
      const sectionLabel = options.colors
        ? `\x1b[1;2m${section.title}:\x1b[0m\n`
        : `${section.title}:\n`;
      output += sectionLabel;
    }
    for (const entry of section.entries) {
      const term = formatUsageTerm(entry.term, {
        colors: options.colors,
        optionsSeparator: ", ",
        context: "doc",
        maxWidth: options.maxWidth == null
          ? undefined
          : options.maxWidth - termIndent,
      });

      const descColumnWidth = options.maxWidth == null
        ? undefined
        : options.maxWidth - termIndent - effectiveTermWidth - 2;

      // When the rendered term is physically wider than termWidth, the
      // description column starts further right on the first output line,
      // shrinking the first-line budget.  extraTermOffset captures that
      // surplus so we can pass it as startWidth to formatMessage, making
      // word-wrapping account for the narrower first-line space.
      const termVisibleWidth = lastLineVisibleLength(term);
      const extraTermOffset = descColumnWidth != null
        ? Math.max(0, termVisibleWidth - effectiveTermWidth)
        : 0;

      // Once any content has caused a line break inside the description
      // string, the extra physical offset no longer applies — subsequent
      // content lands on a fresh continuation line indented by
      // termIndent + effectiveTermWidth + 2, not by
      // termIndent + termVisibleWidth + 2.
      const currentExtraOffset = () =>
        description.includes("\n") ? 0 : extraTermOffset;

      // See the comment above the defaultFormatOptions variable for why
      // startWidth is passed via a typed variable rather than an inline
      // object literal.
      const descFormatOptions: MessageFormatOptions & {
        readonly startWidth?: number;
      } = {
        colors: options.colors,
        quotes: !options.colors,
        maxWidth: descColumnWidth,
        startWidth: extraTermOffset > 0 ? extraTermOffset : undefined,
      };
      let description = entry.description == null
        ? ""
        : formatMessage(entry.description, descFormatOptions);

      // Append default value if showDefault is enabled and default exists
      if (
        options.showDefault && entry.default != null && entry.default.length > 0
      ) {
        const prefix = typeof options.showDefault === "object"
          ? options.showDefault.prefix ?? " ["
          : " [";
        const suffix = typeof options.showDefault === "object"
          ? options.showDefault.suffix ?? "]"
          : "]";

        // Determine startWidth so that word-wrapping in the default value
        // continues correctly from the current line position.
        // effectiveLastW adds the extra physical offset for the first line
        // when the term extends past termWidth.
        let defaultStartWidth: number | undefined;
        if (descColumnWidth != null) {
          const lastW = lastLineVisibleLength(description);
          const effectiveLastW = lastW + currentExtraOffset();
          if (effectiveLastW + prefix.length >= descColumnWidth) {
            description += "\n";
            defaultStartWidth = prefix.length;
          } else {
            defaultStartWidth = effectiveLastW + prefix.length;
          }
        }

        // `startWidth` is accepted by the formatMessage() implementation but
        // is absent from the public MessageFormatOptions type.  The inline
        // intersection type makes TypeScript accept the field here while
        // keeping it out of the public API.  Because the intersection type is
        // a subtype of MessageFormatOptions, the call below remains
        // type-safe.
        //
        // maxWidth is reduced by suffix.length so that the closing suffix
        // (e.g. "]") can always be appended without exceeding descColumnWidth.
        const defaultFormatOptions: MessageFormatOptions & {
          readonly startWidth?: number;
        } = {
          colors: options.colors ? { resetSuffix: "\x1b[2m" } : false,
          quotes: !options.colors,
          maxWidth: descColumnWidth == null
            ? undefined
            : descColumnWidth - suffix.length,
          startWidth: defaultStartWidth,
        };
        const defaultContent = formatMessage(
          entry.default,
          defaultFormatOptions,
        );
        const defaultText = `${prefix}${defaultContent}${suffix}`;
        const formattedDefault = options.colors
          ? `\x1b[2m${defaultText}\x1b[0m`
          : defaultText;
        description += formattedDefault;
      }

      // Append choices if showChoices is enabled and choices exist
      if (
        options.showChoices && entry.choices != null && entry.choices.length > 0
      ) {
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
        // Determine startWidth so that word-wrapping in the choices list
        // continues correctly from the current line position.
        // effectiveLastW adds the extra physical offset for the first line
        // when the term extends past termWidth.
        let choicesStartWidth: number | undefined;
        if (descColumnWidth != null) {
          const lastW = lastLineVisibleLength(description);
          const effectiveLastW = lastW + currentExtraOffset();
          const prefixLabelLen = prefix.length + label.length;
          if (effectiveLastW + prefixLabelLen >= descColumnWidth) {
            description += "\n";
            choicesStartWidth = prefixLabelLen;
          } else {
            choicesStartWidth = effectiveLastW + prefixLabelLen;
          }
        }

        // See the comment above the defaultFormatOptions variable for why
        // startWidth is passed via a typed variable rather than an inline
        // object literal.
        //
        // maxWidth is reduced by suffix.length so that the closing suffix
        // (e.g. ")") can always be appended without exceeding descColumnWidth.
        const choicesFormatOptions: MessageFormatOptions & {
          readonly startWidth?: number;
        } = {
          colors: options.colors ? { resetSuffix: "\x1b[2m" } : false,
          quotes: false,
          maxWidth: descColumnWidth == null
            ? undefined
            : descColumnWidth - suffix.length,
          startWidth: choicesStartWidth,
        };
        const choicesDisplay = formatMessage(
          truncatedTerms,
          choicesFormatOptions,
        );
        const choicesText = `${prefix}${label}${choicesDisplay}${suffix}`;
        const formattedChoices = options.colors
          ? `\x1b[2m${choicesText}\x1b[0m`
          : choicesText;
        description += formattedChoices;
      }

      output += `${" ".repeat(termIndent)}${
        ansiAwareRightPad(term, effectiveTermWidth)
      }${
        description === "" ? "" : `  ${
          indentLines(
            description,
            termIndent + effectiveTermWidth + 2,
          )
        }`
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

// deno-lint-ignore no-control-regex
const ansiEscapeCodeRegex = /\x1B\[[0-9;]*[a-zA-Z]/g;

function ansiAwareRightPad(
  text: string,
  length: number,
  char: string = " ",
): string {
  const strippedText = text.replace(ansiEscapeCodeRegex, "");
  if (strippedText.length >= length) {
    return text;
  }
  return text + char.repeat(length - strippedText.length);
}

function lastLineVisibleLength(text: string): number {
  const lastNewline = text.lastIndexOf("\n");
  const lastLine = lastNewline === -1 ? text : text.slice(lastNewline + 1);
  return lastLine.replace(ansiEscapeCodeRegex, "").length;
}
