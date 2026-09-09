import { messageRenderers } from "./message-registry.ts";
import { resolveMessageFormatter } from "./message-renderer.ts";
import {
  cacheTerminalTheme,
  formatTerminalTerm,
  fragmentTokens,
  renderTerminalTerm,
  styleCode,
} from "./terminal-internal.ts";
import type {
  LabelTerm,
  SyntaxPunctuationTerm,
  TerminalStyle,
  TerminalTheme,
} from "./terminal.ts";
import {
  type AnnotationLayout,
  measureAnnotation,
  measureText,
  placeText,
} from "./text-layout.ts";
import {
  cloneMessage,
  type Message,
  type MessageFormatOptions,
  type MessageFormatter,
  type MessageTerm,
  text,
} from "./message.ts";
import {
  cloneUsageTerm,
  formatUsage,
  formatUsageTerm,
  isDocHidden,
  type Usage,
  type UsageTerm,
} from "./usage.ts";
import { validateLabel, validateProgramName } from "./validate.ts";

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
 * Returns whether a doc entry's term is hidden from documentation.
 * Only term types with a `hidden` field (argument, option, command,
 * passthrough) are checked; other types always return `false`.
 *
 * @param entry The doc entry to check.
 * @returns `true` if the entry should be hidden from documentation.
 * @since 1.0.0
 */
export function isDocEntryHidden(entry: DocEntry): boolean {
  const term = entry.term;
  if (
    term.type === "argument" ||
    term.type === "option" ||
    term.type === "command" ||
    term.type === "passthrough"
  ) {
    return isDocHidden(term.hidden);
  }
  return false;
}

function getDocEntryKey(entry: DocEntry): string {
  const term = entry.term;
  switch (term.type) {
    case "command":
      return `command:${term.name}`;
    case "option":
      return `option:${[...term.names].sort().join(",")}:${term.metavar ?? ""}`;
    case "argument":
      return `argument:${term.metavar}`;
    default:
      return JSON.stringify(term);
  }
}

/**
 * Removes duplicate {@link DocEntry} values that share the same surface
 * syntax (same term type and identifying names).  Doc-hidden entries are
 * filtered out first so they cannot influence the ordering of visible
 * entries.  Among the remaining visible entries, the first occurrence is
 * kept and later duplicates are discarded.
 *
 * Positional argument entries are never deduplicated because they are
 * distinguished by position, not by metavar, and {@link DocEntry} does
 * not carry position information.
 *
 * @param entries The entries to deduplicate.
 * @returns A new array with hidden entries removed and duplicates
 *   collapsed, preserving insertion order of visible entries.
 * @since 1.0.0
 */
export function deduplicateDocEntries(
  entries: readonly DocEntry[],
): DocEntry[] {
  const seen = new Set<string>();
  const result: DocEntry[] = [];
  for (const entry of entries) {
    if (isDocEntryHidden(entry)) continue;
    if (entry.term.type === "argument") {
      result.push(entry);
      continue;
    }
    const key = getDocEntryKey(entry);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(entry);
    }
  }
  return result;
}

/**
 * Removes duplicate entries from a list of {@link DocFragment} values.
 * Entry-type fragments are deduplicated by their surface syntax key.
 * Section-type fragments have their entries deduplicated internally.
 *
 * @param fragments The fragments to deduplicate.
 * @returns A new array with duplicate entries removed.
 * @since 1.0.0
 */
export function deduplicateDocFragments(
  fragments: readonly DocFragment[],
): DocFragment[] {
  // Doc-hidden entries are skipped so they cannot influence the ordering
  // of visible entries.  Among remaining visible entries, the first
  // occurrence is kept and later duplicates are discarded.
  //
  // Untitled entries/sections share a global dedup scope.
  // Titled sections are grouped by title and deduplicated within each group,
  // but entries in differently-titled sections remain independent.
  // Titled sections are emitted at the position of their first fragment
  // that contains visible entries, so hidden-only fragments do not
  // influence ordering.
  const untitledSeen = new Set<string>();
  const titledSectionMap = new Map<string, DocEntry[]>();
  const titledSectionPositioned = new Set<string>();
  // Each element is either a concrete DocFragment or a title placeholder
  // for a titled section whose entries are still being collected.
  const slots: (DocFragment | string)[] = [];
  for (const fragment of fragments) {
    if (fragment.type === "entry") {
      if (isDocEntryHidden(fragment)) continue;
      if (fragment.term.type === "argument") {
        slots.push(fragment);
      } else {
        const key = getDocEntryKey(fragment);
        if (!untitledSeen.has(key)) {
          untitledSeen.add(key);
          slots.push(fragment);
        }
      }
    } else if (fragment.title == null) {
      const dedupedEntries: DocEntry[] = [];
      for (const entry of fragment.entries) {
        if (isDocEntryHidden(entry)) continue;
        if (entry.term.type === "argument") {
          dedupedEntries.push(entry);
          continue;
        }
        const key = getDocEntryKey(entry);
        if (!untitledSeen.has(key)) {
          untitledSeen.add(key);
          dedupedEntries.push(entry);
        }
      }
      if (dedupedEntries.length > 0) {
        slots.push({
          ...fragment,
          type: "section",
          entries: dedupedEntries,
        });
      }
    } else {
      if (!titledSectionMap.has(fragment.title)) {
        titledSectionMap.set(fragment.title, []);
      }
      // Defer placeholder until we see a fragment with visible entries,
      // so the section's position reflects its first visible content.
      if (
        !titledSectionPositioned.has(fragment.title) &&
        fragment.entries.some((e) => !isDocEntryHidden(e))
      ) {
        titledSectionPositioned.add(fragment.title);
        slots.push(fragment.title);
      }
      titledSectionMap.get(fragment.title)!.push(...fragment.entries);
    }
  }
  const result: DocFragment[] = [];
  for (const slot of slots) {
    if (typeof slot === "string") {
      const entries = deduplicateDocEntries(titledSectionMap.get(slot)!);
      if (entries.length > 0) {
        result.push({ type: "section", title: slot, entries });
      }
    } else {
      result.push(slot);
    }
  }
  return result;
}

/**
 * Creates a deep clone of a {@link DocEntry}.  The `term` is cloned via
 * {@link cloneUsageTerm}, and `description`, `default`, and `choices`
 * messages are cloned via {@link cloneMessage}.
 *
 * @param entry The documentation entry to clone.
 * @returns A structurally equal but referentially distinct copy.
 * @since 1.0.0
 */
export function cloneDocEntry(entry: DocEntry): DocEntry {
  return {
    term: cloneUsageTerm(entry.term),
    ...(entry.description != null && {
      description: cloneMessage(entry.description),
    }),
    ...(entry.default != null && {
      default: cloneMessage(entry.default),
    }),
    ...(entry.choices != null && {
      choices: cloneMessage(entry.choices),
    }),
  };
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
   * `...`.  Must be at least `1`.  Set to `Infinity` to show all choices.
   *
   * @default `8`
   * @throws {RangeError} If the value is less than `1`.
   */
  readonly maxItems?: number;
}

/**
 * Options for formatting a documentation page.
 */
export interface DocPageFormatOptions {
  /**
   * Custom message renderer, taking precedence over theme for messages.
   * @since 1.3.0
   */
  readonly messageFormatter?: MessageFormatter;
  /**
   * Semantic terminal theme.
   * @since 1.3.0
   */
  readonly theme?: TerminalTheme;
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
   * Width allocated for terms before descriptions start.  Set to `"auto"`
   * to align descriptions after the widest visible term that has content.
   * Terminal display width is used for automatic measurement.
   *
   * @default `26`
   * @since 1.3.0 Added automatic term width.
   */
  termWidth?: number | "auto";

  /**
   * Maximum width of the entire formatted output.
   */
  maxWidth?: number;

  /**
   * Whether to include the usage synopsis in the output.
   *
   * @default `true`
   * @since 1.2.0
   */
  showUsage?: boolean;

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
 * @throws {TypeError} If `programName` is not a string, is empty,
 * whitespace-only, or contains control characters, if any non-empty
 * section's title is not a string, is empty, whitespace-only, or contains
 * control characters, or if `maxWidth` is not a finite integer.
 * @throws {RangeError} If any entry needs a description column and `maxWidth`
 * is too small to fit the minimum layout (less than `termIndent + 4`), or if
 * `showChoices.maxItems` is less than `1`, or if a theme color is invalid
 * (even when colors are disabled).
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
  options = { ...options, theme: cacheTerminalTheme(options.theme) };
  const formatMessage = resolveMessageFormatter(options);
  const opaqueFormatter = options.messageFormatter != null &&
    !messageRenderers.has(options.messageFormatter);
  const defaultAmbient = options.theme?.annotationStyles?.default ??
    { dim: true };
  const choicesAmbient = options.theme?.annotationStyles?.choices ??
    { dim: true };
  const labelCache = new Map<string, string>();
  const label = (label: string, kind: LabelTerm["kind"]) => {
    const key = `${kind}:${label}`;
    let rendered = labelCache.get(key);
    if (rendered == null) {
      rendered = renderTerminalTerm(
        { type: "label", label, kind },
        options.theme,
        options.colors,
        undefined,
        kind === "choices" ? choicesAmbient : undefined,
      );
      labelCache.set(key, rendered);
    }
    return rendered;
  };
  const punctuationCache = new Map<string, string>();
  const punctuation = (
    punctuation: string,
    kind: SyntaxPunctuationTerm["kind"],
  ) => {
    const key = `${kind}:${punctuation}`;
    let rendered = punctuationCache.get(key);
    if (rendered == null) {
      rendered = renderTerminalTerm(
        { type: "syntaxPunctuation", punctuation, kind },
        options.theme,
        options.colors,
        undefined,
        kind.startsWith("default")
          ? defaultAmbient
          : kind.startsWith("choices")
          ? choicesAmbient
          : undefined,
      );
      punctuationCache.set(key, rendered);
    }
    return rendered;
  };
  const usageLabel = page.usage != null && options.showUsage !== false
    ? label("Usage:", "usage") + " "
    : "";
  const usageLabelWidth = measureText(usageLabel).lastLineWidth;
  const defaultStyle = styleCode(
    options.theme?.annotationStyles?.default ?? { dim: true },
  );
  const choicesStyle = styleCode(
    options.theme?.annotationStyles?.choices ?? { dim: true },
  );
  validateProgramName(programName);
  const termIndent = options.termIndent ?? 2;
  const showUsage = options.showUsage ?? true;
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

  // Validate showChoices.maxItems before any per-entry rendering.
  if (
    typeof options.showChoices === "object" &&
    options.showChoices.maxItems != null
  ) {
    const maxItems = options.showChoices.maxItems;
    if (maxItems < 1) {
      throw new RangeError(
        `showChoices.maxItems must be at least 1, but got ${maxItems}.`,
      );
    }
  }

  // Validate maxWidth against the minimum feasible layout.  The minimum
  // depends on which page features are active:
  //  - Entries with a description column need enough space for term +
  //    gap + description, plus any showDefault/showChoices prefixes.
  //  - Bare-term entries need termIndent + 1 (just 1 term char).
  //  - "Usage: " (7 chars) + max(programName, capped widest visible term).
  //  - Examples:/Author:/Bugs: labels are 9/7/5 chars on their own lines.
  const hasContent = (msg: unknown): msg is readonly unknown[] =>
    Array.isArray(msg) && msg.length > 0;
  const needsDescriptionColumn = (entry: DocEntry): boolean =>
    hasContent(entry.description) ||
    (options.showDefault === true || typeof options.showDefault === "object") &&
      hasContent(entry.default) ||
    (options.showChoices === true || typeof options.showChoices === "object") &&
      hasContent(entry.choices);
  const annotations = new Map<"default" | "choices", AnnotationLayout>();
  const annotation = (kind: "default" | "choices"): AnnotationLayout => {
    const cached = annotations.get(kind);
    if (cached != null) return cached;
    const config = kind === "default"
      ? options.showDefault
      : options.showChoices;
    const prefix = punctuation(
      typeof config === "object"
        ? config.prefix ?? (kind === "default" ? " [" : " (")
        : kind === "default"
        ? " ["
        : " (",
      kind === "default" ? "defaultPrefix" : "choicesPrefix",
    );
    const suffix = punctuation(
      typeof config === "object"
        ? config.suffix ?? (kind === "default" ? "]" : ")")
        : kind === "default"
        ? "]"
        : ")",
      kind === "default" ? "defaultSuffix" : "choicesSuffix",
    );
    const choicesLabel = kind === "choices"
      ? label(
        typeof options.showChoices === "object"
          ? options.showChoices.label ?? "choices: "
          : "choices: ",
        "choices",
      )
      : "";
    const layout = measureAnnotation(prefix + choicesLabel, suffix);
    annotations.set(kind, layout);
    return layout;
  };
  const automaticTermWidth = (): number | undefined => {
    let widest: number | undefined;
    for (const section of page.sections) {
      for (const entry of section.entries) {
        if (!needsDescriptionColumn(entry)) continue;
        const rendered = formatUsageTerm(entry.term, {
          colors: options.colors,
          theme: options.theme,
          optionsSeparator: ", ",
          context: "doc",
        });
        const width = measureText(rendered).maxLineWidth;
        widest = widest == null ? width : Math.max(widest, width);
      }
    }
    return widest;
  };
  const termWidth = options.termWidth === "auto"
    ? automaticTermWidth() ?? 26
    : options.termWidth ?? 26;
  const hasEntries = page.sections.some((s) => s.entries.length > 0);
  const needsDescColumn = hasEntries &&
    page.sections.some((s) => s.entries.some(needsDescriptionColumn));
  // When maxWidth constrains the layout, shrink the term column so that
  // the description column gets a reasonable share of the available width.
  // Layout: <termIndent><term><2-space gap><description>
  // Automatic sizing reserves at least half of the available space for the
  // description.  Explicit numeric widths retain their existing behavior:
  // keep the requested width when it leaves >= 1 char for the description,
  // otherwise split the available space evenly between the two columns.
  let effectiveTermWidth: number;
  if (options.maxWidth == null) {
    effectiveTermWidth = termWidth;
  } else {
    const availableForColumns = options.maxWidth - termIndent - 2;
    const evenlySplitTermWidth = Math.max(
      1,
      Math.floor(availableForColumns / 2),
    );
    effectiveTermWidth = options.termWidth === "auto" && needsDescColumn
      ? Math.min(termWidth, evenlySplitTermWidth)
      : availableForColumns >= termWidth + 1
      ? termWidth
      : evenlySplitTermWidth;
  }
  if (options.maxWidth != null) {
    // Validate the exact fixed text that rendering will use. Content arrays
    // with no terms do not render an annotation. The first suffix line is
    // reserved from the content budget; later suffix lines stand alone.
    let minDescWidth = 1;
    if (needsDescColumn) {
      for (const kind of ["default", "choices"] as const) {
        const enabled = kind === "default"
          ? options.showDefault
          : options.showChoices;
        if (
          enabled &&
          page.sections.some((section) =>
            section.entries.some((entry) => hasContent(entry[kind]))
          )
        ) {
          minDescWidth = Math.max(minDescWidth, annotation(kind).minWidth);
        }
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
    // The first line needs "Usage: " (7) + programName.  Continuation
    // lines are indented by 7 chars and need enough room for the widest
    // atomic term segment.  To avoid over-restricting for intentionally
    // long terms, the term width is capped at programNameWidth + 7;
    // the 7 matches the continuation indent, so terms fitting within
    // the first line's total width are guaranteed not to overflow.
    const programNameWidth = page.usage != null && showUsage
      ? Math.max(
        0,
        ...[
          ...fragmentTokens(
            formatTerminalTerm(
              { type: "programName", programName },
              options.theme,
            ),
          ),
        ].map((token) => token.width),
      )
      : 0;
    const usageMin = page.usage != null && showUsage
      ? Math.max(
        measureText(usageLabel).maxLineWidth,
        usageLabelWidth + Math.max(
          programNameWidth,
          Math.min(
            maxVisibleAtomicWidth(page.usage, options.theme),
            programNameWidth + usageLabelWidth,
          ),
        ),
      )
      : 1;
    // Fixed labels cannot wrap. Examples/Author/Bugs also need two
    // indentation columns and at least one column for their content.
    let sectionMin = 1;
    for (const kind of ["examples", "author", "bugs"] as const) {
      if (!hasContent(page[kind])) continue;
      const title = kind === "examples"
        ? "Examples:"
        : kind === "author"
        ? "Author:"
        : "Bugs:";
      sectionMin = Math.max(
        sectionMin,
        3,
        measureText(label(title, kind)).maxLineWidth,
      );
    }
    // User-supplied section titles, like indivisible usage leaves, may
    // overflow. Including them here would make existing narrow --help fail.
    const minWidth = Math.max(entryMin, usageMin, sectionMin);
    if (options.maxWidth < minWidth) {
      throw new RangeError(
        `maxWidth must be at least ${minWidth}, got ${options.maxWidth}.`,
      );
    }
    // Second check: even if maxWidth passes the formula-based minimum,
    // the effective layout may leave too little room for fixed prefixes.
    if (needsDescColumn && minDescWidth > 1) {
      const avail = options.maxWidth - termIndent - 2;
      const descW = avail - effectiveTermWidth;
      if (descW < minDescWidth) {
        const needed = termIndent + effectiveTermWidth + 2 + minDescWidth;
        throw new RangeError(
          `maxWidth must be at least ${needed}, got ${options.maxWidth}.`,
        );
      }
    }
  }
  let output = "";
  if (hasContent(page.brief)) {
    output += formatMessage(page.brief, {
      colors: options.colors,
      maxWidth: options.maxWidth,
      quotes: !options.colors,
    });
    output += "\n";
  }
  if (page.usage != null && showUsage) {
    output += usageLabel;
    output += indentLines(
      formatUsage(programName, page.usage, {
        colors: options.colors,
        theme: options.theme,
        maxWidth: options.maxWidth == null
          ? undefined
          : options.maxWidth - usageLabelWidth,
        expandCommands: true,
      }),
      usageLabelWidth,
    );
    output += "\n";
  }
  if (hasContent(page.description)) {
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
      validateLabel(section.title);
      const sectionLabel = label(`${section.title}:`, "section") + "\n";
      output += sectionLabel;
    }
    for (const entry of section.entries) {
      const term = formatUsageTerm(entry.term, {
        colors: options.colors,
        theme: options.theme,
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
      // surplus so we can pass it as initialWidth to formatMessage, making
      // word-wrapping account for the narrower first-line space.
      const termVisibleWidth = measureText(term).lastLineWidth;
      const extraTermOffset = descColumnWidth != null
        ? Math.max(0, termVisibleWidth - effectiveTermWidth)
        : 0;

      const descFormatOptions: MessageFormatOptions = {
        colors: options.colors,
        quotes: !options.colors,
        maxWidth: descColumnWidth,
        initialWidth: extraTermOffset > 0 ? extraTermOffset : undefined,
      };
      let description = entry.description == null
        ? ""
        : formatMessage(entry.description, descFormatOptions);

      let cursor = placeText(description, {
        line: "",
        column: extraTermOffset,
      }).cursor;
      const appendAnnotation = (
        content: Message,
        layout: AnnotationLayout,
        style: string,
        ambient: TerminalStyle,
        quotes: boolean,
      ) => {
        const prefix = placeText(layout.prefix, cursor, descColumnWidth, 1);
        // Keep a layout-inserted break outside the ambient style, as before.
        if (prefix.text !== layout.prefix) description += "\n";
        const rendered = formatMessage(content, {
          colors: options.colors ? { resetSuffix: style } : false,
          quotes,
          maxWidth: descColumnWidth == null
            ? undefined
            : descColumnWidth - layout.suffixMetrics.firstLineWidth,
          initialWidth: descColumnWidth != null ||
              layout.prefixMetrics.lineCount > 1
            ? prefix.cursor.column
            : undefined,
        }, ambient);
        // Content can be empty or an opaque formatter's unbreakable output.
        // Place the suffix at its boundary without reflowing that output.
        const suffix = placeText(
          layout.suffix,
          placeText(rendered, prefix.cursor).cursor,
          descColumnWidth,
        );
        const annotationText = `${layout.prefix}${rendered}${
          opaqueFormatter && options.colors ? style : ""
        }${suffix.text}`;
        description += options.colors
          ? `${style}${annotationText}${style ? "\x1b[0m" : ""}`
          : annotationText;
        cursor = suffix.cursor;
      };

      if (options.showDefault && hasContent(entry.default)) {
        appendAnnotation(
          entry.default,
          annotation("default"),
          defaultStyle,
          defaultAmbient,
          !options.colors,
        );
      }

      // Append choices if showChoices is enabled and choices exist
      if (options.showChoices && hasContent(entry.choices)) {
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
        appendAnnotation(
          truncatedTerms,
          annotation("choices"),
          choicesStyle,
          choicesAmbient,
          false,
        );
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
  if (hasContent(page.examples)) {
    output += "\n";
    const examplesLabel = label("Examples:", "examples") + "\n";
    output += examplesLabel;
    const examplesContent = formatMessage(page.examples, {
      colors: options.colors,
      maxWidth: options.maxWidth == null ? undefined : options.maxWidth - 2,
      quotes: !options.colors,
    });
    output += "  " + indentLines(examplesContent, 2);
    output += "\n";
  }
  if (hasContent(page.author)) {
    output += "\n";
    const authorLabel = label("Author:", "author") + "\n";
    output += authorLabel;
    const authorContent = formatMessage(page.author, {
      colors: options.colors,
      maxWidth: options.maxWidth == null ? undefined : options.maxWidth - 2,
      quotes: !options.colors,
    });
    output += "  " + indentLines(authorContent, 2);
    output += "\n";
  }
  if (hasContent(page.bugs)) {
    output += "\n";
    const bugsLabel = label("Bugs:", "bugs") + "\n";
    output += bugsLabel;
    const bugsContent = formatMessage(page.bugs, {
      colors: options.colors,
      maxWidth: options.maxWidth == null ? undefined : options.maxWidth - 2,
      quotes: !options.colors,
    });
    output += "  " + indentLines(bugsContent, 2);
    output += "\n";
  }
  if (hasContent(page.footer)) {
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

/**
 * Returns the width of the widest non-breakable segment among visible
 * (non-usage-hidden) terms in a usage tree.  Hidden terms are excluded
 * because they are filtered out before rendering, so they do not
 * contribute to the rendered width.
 */
function maxVisibleAtomicWidth(usage: Usage, theme?: TerminalTheme): number {
  return usage.reduce((widest, term) =>
    Math.max(
      widest,
      measureText(formatUsageTerm(term, { theme, maxWidth: 1 })).maxLineWidth,
    ), 0);
}

function ansiAwareRightPad(
  text: string,
  length: number,
  char: string = " ",
): string {
  // Padding is appended at the end, so only the last line's width
  // matters for deciding how many spaces to add.
  const visibleWidth = measureText(text).lastLineWidth;
  if (visibleWidth >= length) {
    return text;
  }
  return text + char.repeat(length - visibleWidth);
}
