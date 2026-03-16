import type { DocPage, DocSection } from "@optique/core/doc";
import type { Message } from "@optique/core/message";
import {
  isDocHidden,
  isUsageHidden,
  type Usage,
  type UsageTerm,
} from "@optique/core/usage";
import { escapeHyphens, escapeRoff, formatMessageAsRoff } from "./roff.ts";

/**
 * Valid man page section numbers.
 * @since 0.10.0
 */
export type ManPageSection = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/**
 * Options for generating a man page.
 * @since 0.10.0
 */
export interface ManPageOptions {
  /**
   * The name of the program.  This appears in the NAME section and header.
   */
  readonly name: string;

  /**
   * The manual section number.  Common sections:
   * - 1: User commands
   * - 2: System calls
   * - 3: Library functions
   * - 4: Special files
   * - 5: File formats
   * - 6: Games
   * - 7: Miscellaneous
   * - 8: System administration
   */
  readonly section: ManPageSection;

  /**
   * The date to display in the man page footer.
   * If a Date object is provided, it will be formatted as "Month Year".
   * If a string is provided, it will be used as-is.
   */
  readonly date?: string | Date;

  /**
   * The version string to display in the man page footer.
   */
  readonly version?: string;

  /**
   * The manual title (e.g., "User Commands", "System Calls").
   * This appears in the header.
   */
  readonly manual?: string;

  /**
   * Author information to include in the AUTHOR section.
   */
  readonly author?: Message;

  /**
   * Bug reporting information to include in the BUGS section.
   */
  readonly bugs?: Message;

  /**
   * Examples to include in the EXAMPLES section.
   */
  readonly examples?: Message;

  /**
   * Cross-references to include in the SEE ALSO section.
   */
  readonly seeAlso?: ReadonlyArray<
    { readonly name: string; readonly section: number }
  >;

  /**
   * Environment variables to document in the ENVIRONMENT section.
   */
  readonly environment?: DocSection;

  /**
   * File paths to document in the FILES section.
   */
  readonly files?: DocSection;

  /**
   * Exit status codes to document in the EXIT STATUS section.
   */
  readonly exitStatus?: DocSection;
}

/**
 * Formats a date for use in man pages.
 *
 * @param date The date to format, or undefined.
 * @returns The formatted date string, or undefined.
 * @since 0.10.0
 */
export function formatDateForMan(
  date: string | Date | undefined,
): string | undefined {
  if (date === undefined) return undefined;
  if (typeof date === "string") return date;

  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  return `${months[date.getMonth()]} ${date.getFullYear()}`;
}

function escapeThField(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function formatCommandNameAsRoff(name: string): string {
  return `\\fB${escapeHyphens(escapeRoff(name))}\\fR`;
}

/**
 * Formats a single {@link UsageTerm} as roff markup for the SYNOPSIS section.
 *
 * @param term The usage term to format.
 * @returns The roff-formatted string.
 * @throws {TypeError} If the term has an unknown type.
 * @since 0.10.0
 */
export function formatUsageTermAsRoff(term: UsageTerm): string {
  // Skip usage-hidden terms
  if ("hidden" in term && isUsageHidden(term.hidden)) return "";

  switch (term.type) {
    case "argument":
      return `\\fI${term.metavar}\\fR`;

    case "option": {
      const names = term.names
        .map((name) => `\\fB${escapeHyphens(name)}\\fR`)
        .join(" | ");
      const metavarPart = term.metavar ? ` \\fI${term.metavar}\\fR` : "";
      return `[${names}${metavarPart}]`;
    }

    case "command":
      return formatCommandNameAsRoff(term.name);

    case "optional": {
      const inner = formatUsageAsRoff(term.terms);
      if (inner === "") return "";
      return `[${inner}]`;
    }

    case "multiple": {
      const inner = formatUsageAsRoff(term.terms);
      if (inner === "") return "";
      if (term.min < 1) {
        return `[${inner} ...]`;
      }
      return `${inner} ...`;
    }

    case "exclusive": {
      const alternatives = term.terms
        .map((t) => formatUsageAsRoff(t))
        .filter((s) => s !== "");
      if (alternatives.length === 0) return "";
      if (alternatives.length === 1) return alternatives[0];
      return `(${alternatives.join(" | ")})`;
    }

    case "literal":
      return term.value;

    case "passthrough":
      return "[...]";

    case "ellipsis":
      return "...";

    default: {
      const _exhaustive: never = term;
      throw new TypeError(
        `Unknown usage term type: ${(_exhaustive as UsageTerm).type}.`,
      );
    }
  }
}

/**
 * Formats a {@link Usage} array as roff markup.
 *
 * @param usage The usage terms to format.
 * @returns The roff-formatted string.
 */
function formatUsageAsRoff(usage: Usage): string {
  return usage
    .map(formatUsageTermAsRoff)
    .filter((s) => s !== "")
    .join(" ");
}

/**
 * Formats a {@link DocEntry}'s term for man page output.
 *
 * @param term The usage term from the entry.
 * @returns The roff-formatted term string.
 */
function formatDocEntryTerm(term: UsageTerm): string {
  // Skip doc-hidden terms
  if ("hidden" in term && isDocHidden(term.hidden)) return "";

  switch (term.type) {
    case "option": {
      const names = term.names
        .map((name) => `\\fB${escapeHyphens(name)}\\fR`)
        .join(", ");
      const metavarPart = term.metavar ? ` \\fI${term.metavar}\\fR` : "";
      return `${names}${metavarPart}`;
    }

    case "command":
      return formatCommandNameAsRoff(term.name);

    case "argument":
      return `\\fI${term.metavar}\\fR`;

    case "literal":
      return term.value;

    default:
      return formatDocUsageTermAsRoff(term);
  }
}

/**
 * Formats a {@link UsageTerm} as roff markup for doc rendering, filtering
 * doc-hidden terms instead of usage-hidden terms.
 *
 * @throws {TypeError} If the term has an unknown type.
 */
function formatDocUsageTermAsRoff(term: UsageTerm): string {
  if ("hidden" in term && isDocHidden(term.hidden)) return "";

  switch (term.type) {
    case "optional": {
      const inner = formatDocUsageAsRoff(term.terms);
      if (inner === "") return "";
      return `[${inner}]`;
    }

    case "multiple": {
      const inner = formatDocUsageAsRoff(term.terms);
      if (inner === "") return "";
      if (term.min < 1) {
        return `[${inner} ...]`;
      }
      return `${inner} ...`;
    }

    case "exclusive": {
      const alternatives = term.terms
        .map((t) => formatDocUsageAsRoff(t))
        .filter((s) => s !== "");
      if (alternatives.length === 0) return "";
      if (alternatives.length === 1) return alternatives[0];
      return `(${alternatives.join(" | ")})`;
    }

    case "argument":
      return `\\fI${term.metavar}\\fR`;

    case "option": {
      const names = term.names
        .map((name) => `\\fB${escapeHyphens(name)}\\fR`)
        .join(", ");
      const metavarPart = term.metavar ? ` \\fI${term.metavar}\\fR` : "";
      return `${names}${metavarPart}`;
    }

    case "command":
      return formatCommandNameAsRoff(term.name);

    case "literal":
      return term.value;

    case "passthrough":
      return "[...]";

    case "ellipsis":
      return "...";

    default: {
      const _exhaustive: never = term;
      throw new TypeError(
        `Unknown usage term type: ${(_exhaustive as UsageTerm).type}.`,
      );
    }
  }
}

/**
 * Formats a {@link Usage} array as roff markup for doc rendering,
 * filtering doc-hidden terms.
 */
function formatDocUsageAsRoff(usage: Usage): string {
  return usage
    .map(formatDocUsageTermAsRoff)
    .filter((s) => s !== "")
    .join(" ");
}

/**
 * Formats a {@link DocSection} as roff markup with .TP macros.
 *
 * @param section The section to format.
 * @returns The roff-formatted section content.
 */
function formatDocSectionEntries(section: DocSection): string {
  const lines: string[] = [];

  for (const entry of section.entries) {
    const termStr = formatDocEntryTerm(entry.term);
    if (termStr === "") continue;

    lines.push(".TP");
    lines.push(termStr);

    if (entry.description) {
      let desc = formatMessageAsRoff(entry.description);
      if (entry.default) {
        desc += ` [${formatMessageAsRoff(entry.default)}]`;
      }
      lines.push(desc);
    } else if (entry.default) {
      lines.push(`[${formatMessageAsRoff(entry.default)}]`);
    }
  }

  return lines.join("\n");
}

/**
 * Formats a {@link DocPage} as a complete man page in roff format.
 *
 * This function generates a man page following the standard man(7) format,
 * including sections for NAME, SYNOPSIS, DESCRIPTION, OPTIONS, and more.
 *
 * @example
 * ```typescript
 * import { formatDocPageAsMan } from "@optique/man/man";
 * import type { DocPage } from "@optique/core/doc";
 *
 * const page: DocPage = {
 *   brief: message`A sample CLI application`,
 *   usage: [{ type: "argument", metavar: "FILE" }],
 *   sections: [],
 * };
 *
 * const manPage = formatDocPageAsMan(page, {
 *   name: "myapp",
 *   section: 1,
 *   version: "1.0.0",
 * });
 * ```
 *
 * @param page The documentation page to format.
 * @param options The man page options.
 * @returns The complete man page in roff format.
 * @throws {TypeError} If the program name is empty.
 * @since 0.10.0
 */
export function formatDocPageAsMan(
  page: DocPage,
  options: ManPageOptions,
): string {
  if (options.name === "") {
    throw new TypeError("Program name must not be empty.");
  }
  const lines: string[] = [];

  // .TH - Title heading
  const thParts = [
    escapeHyphens(escapeThField(options.name).toUpperCase()),
    options.section.toString(),
  ];
  // .TH format: name section [date [source [manual]]]
  // Earlier positional args must be present (as "") if later ones are used.
  const hasDate = options.date != null;
  const hasVersion = options.version != null;
  const hasManual = options.manual != null;

  if (hasDate) {
    thParts.push(`"${escapeThField(formatDateForMan(options.date)!)}"`);
  } else if (hasVersion || hasManual) {
    thParts.push('""');
  }

  if (hasVersion) {
    thParts.push(
      `"${escapeHyphens(escapeThField(options.name))} ${
        escapeThField(options.version)
      }"`,
    );
  } else if (hasManual) {
    thParts.push('""');
  }

  if (hasManual) {
    thParts.push(`"${escapeThField(options.manual)}"`);
  }
  lines.push(`.TH ${thParts.join(" ")}`);

  // .SH NAME
  lines.push(".SH NAME");
  if (page.brief) {
    lines.push(
      `${escapeHyphens(escapeRoff(options.name))} \\- ${
        formatMessageAsRoff(page.brief)
      }`,
    );
  } else {
    lines.push(escapeHyphens(escapeRoff(options.name)));
  }

  // .SH SYNOPSIS
  if (page.usage) {
    lines.push(".SH SYNOPSIS");
    lines.push(`.B ${escapeHyphens(escapeRoff(options.name))}`);
    const usageStr = formatUsageAsRoff(page.usage);
    if (usageStr) {
      lines.push(usageStr);
    }
  }

  // .SH DESCRIPTION
  if (page.description) {
    lines.push(".SH DESCRIPTION");
    lines.push(formatMessageAsRoff(page.description));
  }

  // Process DocPage sections
  for (const section of page.sections) {
    if (section.entries.length === 0) continue;

    const content = formatDocSectionEntries(section);
    if (content === "") continue;

    const title = section.title?.toUpperCase() ?? "OPTIONS";
    lines.push(`.SH ${title}`);
    lines.push(content);
  }

  // .SH ENVIRONMENT
  if (options.environment && options.environment.entries.length > 0) {
    const content = formatDocSectionEntries(options.environment);
    if (content !== "") {
      lines.push(".SH ENVIRONMENT");
      lines.push(content);
    }
  }

  // .SH FILES
  if (options.files && options.files.entries.length > 0) {
    const content = formatDocSectionEntries(options.files);
    if (content !== "") {
      lines.push(".SH FILES");
      lines.push(content);
    }
  }

  // .SH EXIT STATUS
  if (options.exitStatus && options.exitStatus.entries.length > 0) {
    const content = formatDocSectionEntries(options.exitStatus);
    if (content !== "") {
      lines.push(".SH EXIT STATUS");
      lines.push(content);
    }
  }

  // .SH EXAMPLES
  if (options.examples) {
    lines.push(".SH EXAMPLES");
    lines.push(formatMessageAsRoff(options.examples));
  }

  // .SH BUGS
  if (options.bugs) {
    lines.push(".SH BUGS");
    lines.push(formatMessageAsRoff(options.bugs));
  }

  // .SH SEE ALSO
  if (options.seeAlso && options.seeAlso.length > 0) {
    lines.push(".SH SEE ALSO");
    const refs = options.seeAlso.map((ref, i) => {
      const suffix = i < options.seeAlso!.length - 1 ? "," : "";
      return `.BR ${
        escapeHyphens(escapeRoff(ref.name))
      } (${ref.section})${suffix}`;
    });
    lines.push(refs.join("\n"));
  }

  // .SH AUTHOR
  if (options.author) {
    lines.push(".SH AUTHOR");
    lines.push(formatMessageAsRoff(options.author));
  }

  // Footer (if present, add at the end)
  if (page.footer) {
    lines.push(".PP");
    lines.push(formatMessageAsRoff(page.footer));
  }

  return lines.join("\n");
}
