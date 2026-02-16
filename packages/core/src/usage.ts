/**
 * Represents the name of a command-line option.  There are four types of
 * option syntax:
 *
 * - GNU-style long options (`--option`)
 * - POSIX-style short options (`-o`) or Java-style options (`-option`)
 * - MS-DOS-style options (`/o`, `/option`)
 * - Plus-prefixed options (`+o`)
 */
export type OptionName =
  | `--${string}`
  | `-${string}`
  | `/${string}`
  | `+${string}`;

/**
 * Represents a single term in a command-line usage description.
 */
export type UsageTerm =
  /**
   * An argument term, which represents a positional argument in
   * the command-line usage.
   */
  | {
    /**
     * The type of the term, which is always `"argument"` for this term.
     */
    readonly type: "argument";
    /**
     * The name of the argument, which is used to identify it in
     * the command-line usage.
     */
    readonly metavar: string;
  }
  /**
   * An option term, which represents a command-line option that can
   * be specified by the user.
   */
  | {
    /**
     * The type of the term, which is always `"option"` for this term.
     */
    readonly type: "option";
    /**
     * The names of the option, which can include multiple
     * short and long forms.
     */
    readonly names: readonly OptionName[];
    /**
     * An optional metavariable name for the option, which is used
     * to indicate what value the option expects.
     */
    readonly metavar?: string;
  }
  /**
   * A command term, which represents a subcommand in the command-line
   * usage.
   */
  | {
    /**
     * The type of the term, which is always `"command"` for this term.
     */
    readonly type: "command";
    /**
     * The name of the command, which is used to identify it
     * in the command-line usage.
     */
    readonly name: string;
  }
  /**
   * An optional term, which represents an optional component
   * in the command-line usage.
   */
  | {
    /**
     * The type of the term, which is always `"optional"` for this term.
     */
    readonly type: "optional";
    /**
     * The terms that are optional, which can be an argument, an option,
     * a command, or another usage term.
     */
    readonly terms: Usage;
  }
  /**
   * A term of multiple occurrences, which allows a term to be specified
   * multiple times in the command-line usage.
   */
  | {
    /**
     * The type of the term, which is always `"multiple"` for this term.
     */
    readonly type: "multiple";
    /**
     * The terms that can occur multiple times, which can be an argument,
     * an option, a command, or another usage term.
     */
    readonly terms: Usage;
    /**
     * The minimum number of times the term must occur.
     */
    readonly min: number;
  }
  | /**
   * An exclusive term, which represents a group of terms that are mutually
   * exclusive, meaning that only one of the terms in the group can be
   * specified at a time.
   */ {
    /**
     * The type of the term, which is always `"exclusive"` for this term.
     */
    readonly type: "exclusive";
    /**
     * The terms that are mutually exclusive, which can include
     * arguments, options, commands, or other usage terms.
     */
    readonly terms: readonly Usage[];
  }
  /**
   * A literal term, which represents a fixed string value in the command-line
   * usage. Unlike metavars which are placeholders for user-provided values,
   * literals represent exact strings that must be typed as-is.
   * @since 0.8.0
   */
  | {
    /**
     * The type of the term, which is always `"literal"` for this term.
     */
    readonly type: "literal";
    /**
     * The literal value that must be provided exactly as written.
     */
    readonly value: string;
  }
  /**
   * A pass-through term, which represents unrecognized options that are
   * collected and passed through to an underlying tool or command.
   * @since 0.8.0
   */
  | {
    /**
     * The type of the term, which is always `"passthrough"` for this term.
     */
    readonly type: "passthrough";
  };

/**
 * Represents a command-line usage description, which is a sequence of
 * {@link UsageTerm} objects.  This type is used to describe how a command-line
 * parser expects its input to be structured, including the required and
 * optional components, as well as any exclusive groups of terms.
 */
export type Usage = readonly UsageTerm[];

/**
 * Extracts all option names from a usage description.
 *
 * This function recursively traverses a {@link Usage} tree and collects all
 * option names defined within it, including those nested inside optional,
 * multiple, and exclusive terms.
 *
 * @param usage The usage description to extract option names from.
 * @returns A set containing all option names found in the usage description.
 *
 * @example
 * ```typescript
 * const usage: Usage = [
 *   { type: "option", names: ["--verbose", "-v"] },
 *   { type: "option", names: ["--quiet", "-q"] },
 * ];
 * const names = extractOptionNames(usage);
 * // names = Set(["--verbose", "-v", "--quiet", "-q"])
 * ```
 */
export function extractOptionNames(usage: Usage): Set<string> {
  const names = new Set<string>();

  function traverseUsage(terms: Usage): void {
    if (!terms || !Array.isArray(terms)) return;
    for (const term of terms) {
      if (term.type === "option") {
        for (const name of term.names) {
          names.add(name);
        }
      } else if (term.type === "optional" || term.type === "multiple") {
        traverseUsage(term.terms);
      } else if (term.type === "exclusive") {
        for (const exclusiveUsage of term.terms) {
          traverseUsage(exclusiveUsage);
        }
      }
    }
  }

  traverseUsage(usage);
  return names;
}

/**
 * Extracts all command names from a Usage array.
 *
 * This function recursively traverses the usage structure and collects
 * all command names, similar to {@link extractOptionNames}.
 *
 * @param usage The usage structure to extract command names from
 * @returns A Set of all command names found in the usage structure
 *
 * @example
 * ```typescript
 * const usage: Usage = [
 *   { type: "command", name: "build" },
 *   { type: "command", name: "test" },
 * ];
 * const names = extractCommandNames(usage);
 * // names = Set(["build", "test"])
 * ```
 * @since 0.7.0
 */
export function extractCommandNames(usage: Usage): Set<string> {
  const names = new Set<string>();

  function traverseUsage(terms: Usage): void {
    if (!terms || !Array.isArray(terms)) return;
    for (const term of terms) {
      if (term.type === "command") {
        names.add(term.name);
      } else if (term.type === "optional" || term.type === "multiple") {
        traverseUsage(term.terms);
      } else if (term.type === "exclusive") {
        for (const exclusiveUsage of term.terms) {
          traverseUsage(exclusiveUsage);
        }
      }
    }
  }

  traverseUsage(usage);
  return names;
}

/**
 * Extracts all argument metavars from a Usage array.
 *
 * This function recursively traverses the usage structure and collects
 * all argument metavariable names, similar to {@link extractOptionNames}
 * and {@link extractCommandNames}.
 *
 * @param usage The usage structure to extract argument metavars from.
 * @returns A Set of all argument metavars found in the usage structure.
 *
 * @example
 * ```typescript
 * const usage: Usage = [
 *   { type: "argument", metavar: "FILE" },
 *   { type: "argument", metavar: "OUTPUT" },
 * ];
 * const metavars = extractArgumentMetavars(usage);
 * // metavars = Set(["FILE", "OUTPUT"])
 * ```
 * @since 0.9.0
 */
export function extractArgumentMetavars(usage: Usage): Set<string> {
  const metavars = new Set<string>();

  function traverseUsage(terms: Usage): void {
    if (!terms || !Array.isArray(terms)) return;
    for (const term of terms) {
      if (term.type === "argument") {
        metavars.add(term.metavar);
      } else if (term.type === "optional" || term.type === "multiple") {
        traverseUsage(term.terms);
      } else if (term.type === "exclusive") {
        for (const exclusiveUsage of term.terms) {
          traverseUsage(exclusiveUsage);
        }
      }
    }
  }

  traverseUsage(usage);
  return metavars;
}

/**
 * Options for formatting usage descriptions.
 */
export interface UsageFormatOptions {
  /**
   * When `true`, expands commands in the usage description
   * to multiple lines, showing each command on a new line.
   * This is useful for commands with many subcommands, making it easier
   * to read and understand the available commands.
   * @default `false`
   */
  readonly expandCommands?: boolean;

  /**
   * When `true`, only shows the shortest option name for each option
   * instead of showing all aliases separated by `/`.
   * For example, `--verbose/-v` becomes just `-v`.
   * @default `false`
   */
  readonly onlyShortestOptions?: boolean;

  /**
   * When `true`, applies ANSI color codes to the output for better readability.
   * Different elements (options, arguments, commands, etc.) will be styled
   * with different colors and formatting.
   * @default `false`
   */
  readonly colors?: boolean;

  /**
   * The maximum width of the formatted output.  If specified, the output
   * will be wrapped to fit within this width, breaking lines as necessary.
   * If not specified, the output will not be wrapped.
   * @default `undefined`
   */
  readonly maxWidth?: number;
}

/**
 * Formats a usage description into a human-readable string representation
 * suitable for command-line help text.
 *
 * This function converts a structured {@link Usage} description into a
 * formatted string that follows common CLI conventions. It supports various
 * formatting options including colors and compact option display.
 * @param programName The name of the program or command for which the usage
 *                    description is being formatted. This is typically the
 *                    name of the executable or script that the user will run.
 * @param usage The usage description to format, consisting of an array
 *              of usage terms representing the command-line structure.
 * @param options Optional formatting options to customize the output.
 *                See {@link UsageFormatOptions} for available options.
 * @returns A formatted string representation of the usage description.
 */
export function formatUsage(
  programName: string,
  usage: Usage,
  options: UsageFormatOptions = {},
): string {
  usage = normalizeUsage(usage);
  if (options.expandCommands) {
    const lastTerm = usage.at(-1)!;
    if (
      usage.length > 0 &&
      usage.slice(0, -1).every((t) => t.type === "command") &&
      lastTerm.type === "exclusive" && lastTerm.terms.every((t) =>
        t.length > 0 &&
        (t[0].type === "command" || t[0].type === "option" ||
          t[0].type === "argument" ||
          t[0].type === "optional" && t[0].terms.length === 1 &&
            (t[0].terms[0].type === "command" ||
              t[0].terms[0].type === "option" ||
              t[0].terms[0].type === "argument"))
      )
    ) {
      const lines = [];
      for (let command of lastTerm.terms) {
        if (usage.length > 1) {
          command = [...usage.slice(0, -1), ...command];
        }
        lines.push(formatUsage(programName, command, options));
      }
      return lines.join("\n");
    }
  }

  let output = options.colors
    ? `\x1b[1m${programName}\x1b[0m ` // Bold
    : `${programName} `;
  let lineWidth = programName.length + 1;
  for (const { text, width } of formatUsageTerms(usage, options)) {
    if (options.maxWidth != null && lineWidth + width > options.maxWidth) {
      output += "\n";
      lineWidth = 0;
      if (text === " ") continue;
    }
    output += text;
    lineWidth += width;
  }
  return output;
}

/**
 * Normalizes a usage description by flattening nested exclusive terms,
 * sorting terms for better readability, and ensuring consistent structure
 * throughout the usage tree.
 *
 * This function performs two main operations:
 *
 * 1. *Flattening*: Recursively processes all usage terms and merges any
 *    nested exclusive terms into their parent exclusive term to avoid
 *    redundant nesting. For example, an exclusive term containing another
 *    exclusive term will have its nested terms flattened into the parent.
 *
 * 2. *Sorting*: Reorders terms to improve readability by placing:
 *    - Commands (subcommands) first
 *    - Options and other terms in the middle
 *    - Positional arguments last (including optional/multiple wrappers around
 *      arguments)
 *
 * The sorting logic also recognizes when optional or multiple terms contain
 * positional arguments and treats them as arguments for sorting purposes.
 *
 * @param usage The usage description to normalize.
 * @returns A normalized usage description with flattened exclusive terms
 *          and terms sorted for optimal readability.
 */
export function normalizeUsage(usage: Usage): Usage {
  const terms = usage.map(normalizeUsageTerm);
  terms.sort((a, b) => {
    const aCmd = a.type === "command";
    const bCmd = b.type === "command";
    const aArg = a.type === "argument" ||
      (a.type === "optional" || a.type === "multiple") &&
        a.terms.at(-1)?.type === "argument";
    const bArg = b.type === "argument" ||
      (b.type === "optional" || b.type === "multiple") &&
        b.terms.at(-1)?.type === "argument";
    // Sort commands first and arguments last:
    return aCmd === bCmd ? aArg === bArg ? 0 : aArg ? 1 : -1 : aCmd ? -1 : 1;
  });
  return terms;
}

function normalizeUsageTerm(term: UsageTerm): UsageTerm {
  if (term.type === "optional") {
    return { type: "optional", terms: normalizeUsage(term.terms) };
  } else if (term.type === "multiple") {
    return {
      type: "multiple",
      terms: normalizeUsage(term.terms),
      min: term.min,
    };
  } else if (term.type === "exclusive") {
    const terms: Usage[] = [];
    for (const usage of term.terms) {
      const normalized = normalizeUsage(usage);
      if (normalized.length >= 1 && normalized[0].type === "exclusive") {
        const rest = normalized.slice(1);
        for (const subUsage of normalized[0].terms) {
          terms.push([...subUsage, ...rest]);
        }
      } else {
        terms.push(normalized);
      }
    }
    return { type: "exclusive", terms };
  } else {
    return term;
  }
}

function* formatUsageTerms(
  terms: readonly UsageTerm[],
  options: UsageFormatOptions,
): Generator<{ text: string; width: number }> {
  let i = 0;
  for (const t of terms) {
    if (i > 0) {
      yield { text: " ", width: 1 };
    }
    yield* formatUsageTermInternal(t, options);
    i++;
  }
}

/**
 * Options for formatting a single {@link UsageTerm}.
 */
export interface UsageTermFormatOptions extends UsageFormatOptions {
  /**
   * A string that separates multiple option names in the formatted output.
   * @default `"/"`
   */
  readonly optionsSeparator?: string;
}

/**
 * Formats a single {@link UsageTerm} into a string representation
 * suitable for command-line help text.
 * @param term The usage term to format, which can be an argument,
 *             option, command, optional term, exclusive term, or multiple term.
 * @param options Optional formatting options to customize the output.
 *                See {@link UsageTermFormatOptions} for available options.
 * @returns A formatted string representation of the usage term.
 */
export function formatUsageTerm(
  term: UsageTerm,
  options: UsageTermFormatOptions = {},
): string {
  let lineWidth = 0;
  let output = "";
  for (const { text, width } of formatUsageTermInternal(term, options)) {
    if (options.maxWidth != null && lineWidth + width > options.maxWidth) {
      output += "\n";
      lineWidth = 0;
      if (text === " ") continue;
    }
    output += text;
    lineWidth += width;
  }
  return output;
}

function* formatUsageTermInternal(
  term: UsageTerm,
  options: UsageTermFormatOptions,
): Generator<{ text: string; width: number }> {
  const optionsSeparator = options.optionsSeparator ?? "/";
  if (term.type === "argument") {
    yield {
      text: options?.colors
        ? `\x1b[4m${term.metavar}\x1b[0m` // Underlined
        : term.metavar,
      width: term.metavar.length,
    };
  } else if (term.type === "option") {
    if (options?.onlyShortestOptions) {
      const shortestName = term.names.reduce((a, b) =>
        a.length <= b.length ? a : b
      );
      yield {
        text: options?.colors
          ? `\x1b[3m${shortestName}\x1b[0m` // Italic
          : shortestName,
        width: shortestName.length,
      };
    } else {
      let i = 0;
      for (const optionName of term.names) {
        if (i > 0) {
          yield {
            text: options?.colors
              ? `\x1b[2m${optionsSeparator}\x1b[0m`
              : optionsSeparator, // Dim
            width: optionsSeparator.length,
          };
        }
        yield {
          text: options?.colors
            ? `\x1b[3m${optionName}\x1b[0m` // Italic
            : optionName,
          width: optionName.length,
        };
        i++;
      }
      if (term.metavar != null) {
        yield {
          text: " ",
          width: 1,
        };
        yield {
          text: options?.colors
            ? `\x1b[4m\x1b[2m${term.metavar}\x1b[0m` // Dim & underlined
            : term.metavar,
          width: term.metavar.length,
        };
      }
    }
  } else if (term.type === "command") {
    yield {
      text: options?.colors
        ? `\x1b[1m${term.name}\x1b[0m` // Bold
        : term.name,
      width: term.name.length,
    };
  } else if (term.type === "optional") {
    yield {
      text: options?.colors ? `\x1b[2m[\x1b[0m` : "[", // Dim
      width: 1,
    };
    yield* formatUsageTerms(term.terms, options);
    yield {
      text: options?.colors ? `\x1b[2m]\x1b[0m` : "]", // Dim
      width: 1,
    };
  } else if (term.type === "exclusive") {
    yield {
      text: options?.colors ? `\x1b[2m(\x1b[0m` : "(", // Dim
      width: 1,
    };
    let i = 0;
    for (const termGroup of term.terms) {
      if (i > 0) {
        yield { text: " ", width: 1 };
        yield { text: "|", width: 1 };
        yield { text: " ", width: 1 };
      }
      yield* formatUsageTerms(termGroup, options);
      i++;
    }
    yield {
      text: options?.colors ? `\x1b[2m)\x1b[0m` : ")", // Dim
      width: 1,
    };
  } else if (term.type === "multiple") {
    if (term.min < 1) {
      yield {
        text: options?.colors ? `\x1b[2m[\x1b[0m` : "[", // Dim
        width: 1,
      };
    }
    for (let i = 0; i < Math.max(1, term.min); i++) {
      if (i > 0) {
        yield { text: " ", width: 1 };
      }
      yield* formatUsageTerms(term.terms, options);
    }
    yield {
      text: options?.colors ? `\x1b[2m...\x1b[0m` : "...", // Dim
      width: 3,
    };
    if (term.min < 1) {
      yield {
        text: options?.colors ? `\x1b[2m]\x1b[0m` : "]", // Dim
        width: 1,
      };
    }
  } else if (term.type === "literal") {
    // Literal values are displayed as-is without special formatting
    yield {
      text: term.value,
      width: term.value.length,
    };
  } else if (term.type === "passthrough") {
    // Pass-through options are displayed with a special format
    const text = "[...]";
    yield {
      text: options?.colors ? `\x1b[2m${text}\x1b[0m` : text, // Dim
      width: text.length,
    };
  } else {
    throw new TypeError(
      `Unknown usage term type: ${term["type"]}.`,
    );
  }
}
