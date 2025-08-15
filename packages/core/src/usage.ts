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
  };

/**
 * Represents a command-line usage description, which is a sequence of
 * {@link UsageTerm} objects.  This type is used to describe how a command-line
 * parser expects its input to be structured, including the required and
 * optional components, as well as any exclusive groups of terms.
 */
export type Usage = readonly UsageTerm[];

/**
 * Options for formatting usage descriptions.
 */
export interface UsageFormatOptions {
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
 * @param usage The usage description to format, consisting of an array
 *              of usage terms representing the command-line structure.
 * @param options Optional formatting options to customize the output.
 *                See {@link UsageFormatOptions} for available options.
 * @returns A formatted string representation of the usage description.
 */
export function formatUsage(
  usage: Usage,
  options: UsageFormatOptions = {},
): string {
  let output = "";
  let lineWidth = 0;
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

function* formatUsageTerms(
  terms: readonly UsageTerm[],
  options: UsageFormatOptions,
): Generator<{ text: string; width: number }> {
  let i = 0;
  for (const t of terms) {
    if (i > 0) {
      yield { text: " ", width: 1 };
    }
    yield* formatUsageTerm(t, options);
    i++;
  }
}

function* formatUsageTerm(
  term: UsageTerm,
  options: UsageFormatOptions,
): Generator<{ text: string; width: number }> {
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
            text: options?.colors ? `\x1b[2m/\x1b[0m` : "/", // Dim
            width: 1,
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
  } else {
    throw new TypeError(
      `Unknown usage term type: ${term["type"]}.`,
    );
  }
}
