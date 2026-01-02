import type { NonEmptyString } from "./nonempty.ts";

/**
 * Represents a single term in a message, which can be a text, an option
 * name, a list of option names, a metavariable, a value, or a list of
 * consecutive values.
 */
export type MessageTerm =
  /**
   * A plain text term in the message.
   */
  | {
    /**
     * The type of the term, which is always `"text"` for plain text.
     */
    readonly type: "text";
    /**
     * The text content of the term.
     */
    readonly text: string;
  }
  /**
   * An option name term in the message, which can be a single
   * option name.  Although it is named option name, it can also
   * represent a subcommand.
   */
  | {
    /**
     * The type of the term, which is `"optionName"` for a single option name.
     */
    readonly type: "optionName";
    /**
     * The name of the option, which can be a short or long option name.
     * For example, `"-f"` or `"--foo"`.
     */
    readonly optionName: string;
  }
  /**
   * A list of option names term in the message, which can be a
   * list of option names.
   */
  | {
    /**
     * The type of the term, which is `"optionNames"` for a list of option
     * names.
     */
    readonly type: "optionNames";
    /**
     * The list of option names, which can include both short and long
     * option names.  For example, `["--foo", "--bar"]`.
     */
    readonly optionNames: readonly string[];
  }
  /**
   * A metavariable term in the message, which can be a single
   * metavariable.
   */
  | {
    /**
     * The type of the term, which is `"metavar"` for a metavariable.
     */
    readonly type: "metavar";
    /**
     * The metavariable name, which is a string that represents
     * a variable in the message.  For example, `"VALUE"` or `"ARG"`.
     */
    readonly metavar: NonEmptyString;
  }
  /**
   * A value term in the message, which can be a single value.
   */
  | {
    /**
     * The type of the term, which is `"value"` for a single value.
     */
    readonly type: "value";
    /**
     * The value, which can be any string representation of a value.
     * For example, `"42"` or `"hello"`.
     */
    readonly value: string;
  }
  /**
   * A list of values term in the message, which can be a
   * list of values.
   */
  | {
    /**
     * The type of the term, which is `"values"` for a list of consecutive
     * values.
     */
    readonly type: "values";
    /**
     * The list of values, which can include multiple string
     * representations of consecutive values.  For example, `["42", "hello"]`.
     */
    readonly values: readonly string[];
  }
  /**
   * An environment variable term in the message, which represents
   * an environment variable name.
   * @since 0.5.0
   */
  | {
    /**
     * The type of the term, which is `"envVar"` for an environment variable.
     */
    readonly type: "envVar";
    /**
     * The environment variable name, which is a string that represents
     * an environment variable. For example, `"PATH"` or `"API_URL"`.
     */
    readonly envVar: string;
  }
  /**
   * A command-line term in the message, which represents
   * a command-line example or snippet.
   * @since 0.6.0
   */
  | {
    /**
     * The type of the term, which is `"commandLine"` for a command-line example.
     */
    readonly type: "commandLine";
    /**
     * The command-line string, which can be a complete command with arguments.
     * For example, `"myapp completion bash > myapp-completion.bash"`.
     */
    readonly commandLine: string;
  };

/**
 * Type representing a message that can include styled/colored values.
 * This type is used to create structured messages that can be
 * displayed to the user with specific formatting.
 */
export type Message = readonly MessageTerm[];

/**
 * Creates a structured message with template strings and values.
 *
 * This function allows creating messages where specific values can be
 * highlighted or styled differently when displayed to the user.
 *
 * @example
 * ```typescript
 * const error = message`Expected number between ${min} and ${max}, got ${value}`;
 * const concat = message`${optionName("--age")}: ${error}`;
 * ```
 *
 * @param message Template strings array (from template literal).
 * @param values Values to be interpolated into the template.
 * @returns A structured Message object.
 */
export function message(
  message: TemplateStringsArray,
  ...values: readonly (MessageTerm | Message | string)[]
): Message {
  const messageTerms: MessageTerm[] = [];
  for (let i = 0; i < message.length; i++) {
    if (message[i] !== "") {
      messageTerms.push({ type: "text", text: message[i] });
    }
    if (i >= values.length) continue;
    const value = values[i];
    if (typeof value === "string") {
      messageTerms.push({ type: "value", value });
    } else if (Array.isArray(value)) {
      messageTerms.push(...value);
    } else if (typeof value === "object" && value != null && "type" in value) {
      messageTerms.push(value);
    } else {
      throw new TypeError(
        `Invalid value type in message: ${typeof value}.`,
      );
    }
  }
  return messageTerms;
}

/**
 * Creates a {@link MessageTerm} for plain text.  Usually used for
 * dynamically generated messages.
 * @param text The plain text to be included in the message.
 * @returns A {@link MessageTerm} representing the plain text.
 */
export function text(text: string): MessageTerm {
  return { type: "text", text };
}

/**
 * Creates a {@link MessageTerm} for an option name.
 * @param name The name of the option, which can be a short or long option name.
 *             For example, `"-f"` or `"--foo"`.
 * @returns A {@link MessageTerm} representing the option name.
 */
export function optionName(name: string): MessageTerm {
  return { type: "optionName", optionName: name };
}

/**
 * Creates a {@link MessageTerm} for a list of option names.
 * @param names The list of option names, which can include both short and long
 *              option names. For example, `["--foo", "--bar"]`.
 * @returns A {@link MessageTerm} representing the list of option names.
 */
export function optionNames(names: readonly string[]): MessageTerm {
  return { type: "optionNames", optionNames: names };
}

/**
 * Creates a {@link MessageTerm} for a metavariable.
 * @param metavar The metavariable name, which is a string that represents
 *                a variable in the message. For example, `"VALUE"` or
 *                `"ARG"`.
 * @returns A {@link MessageTerm} representing the metavariable.
 */
export function metavar(metavar: NonEmptyString): MessageTerm {
  return { type: "metavar", metavar };
}

/**
 * Creates a {@link MessageTerm} for a single value.  However, you usually
 * don't need to use this function directly, as {@link message} string template
 * will automatically create a {@link MessageTerm} for a value when
 * you use a string in a template literal.
 * @param value The value, which can be any string representation of a value.
 *              For example, `"42"` or `"hello"`.
 * @returns A {@link MessageTerm} representing the value.
 */
export function value(value: string): MessageTerm {
  return { type: "value", value };
}

/**
 * Creates a {@link MessageTerm} for a list of consecutive values.
 * @param values The list of consecutive values, which can include multiple
 *               string representations of consecutive values.
 *               For example, `["42", "hello"]`.
 * @returns A {@link MessageTerm} representing the list of values.
 */
export function values(values: readonly string[]): MessageTerm {
  return { type: "values", values };
}

/**
 * Creates a {@link MessageTerm} for an environment variable.
 * @param envVar The environment variable name, which is a string that represents
 *               an environment variable. For example, `"PATH"` or `"API_URL"`.
 * @returns A {@link MessageTerm} representing the environment variable.
 * @since 0.5.0
 */
export function envVar(envVar: string): MessageTerm {
  return { type: "envVar", envVar };
}

/**
 * Creates a {@link MessageTerm} for a command-line example.
 * @param commandLine The command-line string, which can be a complete command
 *                    with arguments. For example,
 *                    `"myapp completion bash > myapp-completion.bash"`.
 * @returns A {@link MessageTerm} representing the command-line example.
 * @since 0.6.0
 */
export function commandLine(commandLine: string): MessageTerm {
  return { type: "commandLine", commandLine };
}

/**
 * Options for the {@link valueSet} function.
 * @since 0.9.0
 */
export interface ValueSetOptions {
  /**
   * The locale(s) to use for list formatting.  Can be a BCP 47 language tag
   * string, an array of language tags, an `Intl.Locale` object, or an array
   * of `Intl.Locale` objects.  If not specified, the system default locale
   * is used.
   */
  readonly locale?:
    | string
    | readonly string[]
    | Intl.Locale
    | readonly Intl.Locale[];

  /**
   * The type of list to format:
   *
   * - `"conjunction"`: "A, B, and C" (default)
   * - `"disjunction"`: "A, B, or C"
   * - `"unit"`: "A, B, C"
   *
   * @default `"conjunction"`
   */
  readonly type?: "conjunction" | "disjunction" | "unit";

  /**
   * The style of the list formatting:
   *
   * - `"long"`: "A, B, and C" (default)
   * - `"short"`: "A, B, & C"
   * - `"narrow"`: "A, B, C"
   *
   * @default `"long"`
   */
  readonly style?: "long" | "short" | "narrow";
}

/**
 * Creates a {@link Message} for a formatted list of values using the
 * `Intl.ListFormat` API.  This is useful for displaying choice lists
 * in error messages with proper locale-aware formatting.
 *
 * Each value in the list becomes a separate value term, and the separators
 * (commas, "and", "or", etc.) become text terms.  This allows each value
 * to be styled independently while respecting the locale's list formatting
 * conventions.
 *
 * @example
 * ```typescript
 * // English conjunction (default): "error", "warn", and "info"
 * const msg1 = message`Expected one of ${valueSet(["error", "warn", "info"])}.`;
 *
 * // English disjunction: "error", "warn", or "info"
 * const msg2 = message`Expected ${
 *   valueSet(["error", "warn", "info"], { type: "disjunction" })
 * }.`;
 *
 * // Korean disjunction: "error", "warn" 또는 "info"
 * const msg3 = message`${
 *   valueSet(["error", "warn", "info"], { locale: "ko", type: "disjunction" })
 * } 중 하나여야 합니다.`;
 * ```
 *
 * @param values The list of values to format.
 * @param options Optional formatting options including locale and list type.
 * @returns A {@link Message} with alternating value and text terms.
 * @since 0.9.0
 */
export function valueSet(
  values: readonly string[],
  options?: ValueSetOptions,
): Message {
  if (values.length === 0) {
    return [];
  }

  const formatter = new Intl.ListFormat(
    options?.locale as string | string[] | undefined,
    {
      type: options?.type,
      style: options?.style,
    },
  );

  const parts = formatter.formatToParts(values as string[]);
  const result: MessageTerm[] = [];

  for (const part of parts) {
    if (part.type === "element") {
      result.push({ type: "value", value: part.value });
    } else {
      // part.type === "literal"
      result.push({ type: "text", text: part.value });
    }
  }

  return result;
}

/**
 * Options for the {@link formatMessage} function.
 */
export interface MessageFormatOptions {
  /**
   * Whether to use colors in the formatted message.  If `true`,
   * the formatted message will include ANSI escape codes for colors.
   * If `false`, the message will be plain text without colors.
   *
   * Can also be an object with additional color options:
   *
   * - `resetSuffix`: String to append after each ANSI reset sequence (`\x1b[0m`)
   *   to maintain parent styling context.
   *
   * @default `false`
   */
  readonly colors?: boolean | {
    /**
     * String to append after each ANSI reset sequence to maintain
     * parent styling context (e.g., `"\x1b[2m"` for dim text).
     */
    readonly resetSuffix?: string;
  };

  /**
   * Whether to use quotes around values in the formatted message.
   * If `true`, values will be wrapped in quotes (e.g., `"value"`).
   * If `false`, values will be displayed without quotes.
   * @default `true`
   */
  readonly quotes?: boolean;

  /**
   * The maximum width of the formatted message.  If specified,
   * the message will be wrapped to fit within this width.
   * If not specified, the message will not be wrapped.
   * @default `undefined`
   */
  readonly maxWidth?: number;
}

/**
 * Formats a {@link Message} into a human-readable string for
 * the terminal.
 * @param msg The message to format, which is an array of
 *              {@link MessageTerm} objects.
 * @param options Optional formatting options to customize the output.
 * @returns A formatted string representation of the message.
 */
export function formatMessage(
  msg: Message,
  options: MessageFormatOptions = {},
): string {
  // Apply defaults
  const colorConfig = options.colors ?? false;
  const useColors = typeof colorConfig === "boolean" ? colorConfig : true;
  const resetSuffix = typeof colorConfig === "object"
    ? (colorConfig.resetSuffix ?? "")
    : "";
  const useQuotes = options.quotes ?? true;
  const resetSequence = `\x1b[0m${resetSuffix}`;

  function* stream(): Generator<{ text: string; width: number }> {
    const wordPattern = /\s*\S+\s*/g;
    for (const term of msg) {
      if (term.type === "text") {
        // Handle explicit line breaks:
        // - Single \n: treated as space (soft break, word wrap friendly)
        // - Double \n\n or more: treated as hard line break (paragraph break)
        if (term.text.includes("\n\n")) {
          // Split on double newlines to find paragraph breaks
          const paragraphs = term.text.split(/\n\n+/);
          for (
            let paragraphIndex = 0;
            paragraphIndex < paragraphs.length;
            paragraphIndex++
          ) {
            if (paragraphIndex > 0) {
              // Yield hard line break with -1 as special marker
              yield { text: "\n", width: -1 };
            }

            // Within each paragraph, replace single \n with space
            const paragraph = paragraphs[paragraphIndex].replace(/\n/g, " ");
            wordPattern.lastIndex = 0; // Reset regex state
            while (true) {
              const match = wordPattern.exec(paragraph);
              if (match == null) break;
              yield { text: match[0], width: match[0].length };
            }
          }
        } else {
          // Text without double newlines: replace single \n with space
          const normalizedText = term.text.replace(/\n/g, " ");

          // Handle whitespace-only text specially to preserve spaces
          if (normalizedText.trim() === "" && normalizedText.length > 0) {
            yield { text: " ", width: 1 };
          } else {
            wordPattern.lastIndex = 0;
            while (true) {
              const match = wordPattern.exec(normalizedText);
              if (match == null) break;
              yield { text: match[0], width: match[0].length };
            }
          }
        }
      } else if (term.type === "optionName") {
        const name = useQuotes ? `\`${term.optionName}\`` : term.optionName;
        yield {
          text: useColors
            ? `\x1b[3m${name}${resetSequence}` // Italic for option names
            : name,
          width: name.length,
        };
      } else if (term.type === "optionNames") {
        const names = term.optionNames.map((name) =>
          useQuotes ? `\`${name}\`` : name
        );
        let i = 0;
        for (const name of names) {
          if (i > 0) yield { text: "/", width: 1 };
          yield {
            text: useColors
              ? `\x1b[3m${name}${resetSequence}` // Italic for option names
              : name,
            width: name.length,
          };
          i++;
        }
      } else if (term.type === "metavar") {
        const metavar = useQuotes ? `\`${term.metavar}\`` : term.metavar;
        yield {
          text: useColors
            ? `\x1b[1m${metavar}${resetSequence}` // Bold for metavariables
            : metavar,
          width: metavar.length,
        };
      } else if (term.type === "value") {
        const value = useQuotes ? `${JSON.stringify(term.value)}` : term.value;
        yield {
          text: useColors
            ? `\x1b[32m${value}${resetSequence}` // Green for values
            : value,
          width: value.length,
        };
      } else if (term.type === "values") {
        for (let i = 0; i < term.values.length; i++) {
          if (i > 0) yield { text: " ", width: 1 };
          const value = useQuotes
            ? JSON.stringify(term.values[i])
            : term.values[i];
          yield {
            text: useColors
              ? i <= 0
                ? `\x1b[32m${value}`
                : i + 1 >= term.values.length
                ? `${value}${resetSequence}`
                : value
              : value,
            width: value.length,
          };
        }
      } else if (term.type === "envVar") {
        const envVar = useQuotes ? `\`${term.envVar}\`` : term.envVar;
        yield {
          text: useColors
            ? `\x1b[1;4m${envVar}${resetSequence}` // Bold and underlined for environment variables
            : envVar,
          width: envVar.length,
        };
      } else if (term.type === "commandLine") {
        const cmd = useQuotes ? `\`${term.commandLine}\`` : term.commandLine;
        yield {
          text: useColors
            ? `\x1b[36m${cmd}${resetSequence}` // Cyan for command-line examples
            : cmd,
          width: cmd.length,
        };
      } else {
        throw new TypeError(
          `Invalid MessageTerm type: ${term["type"]}.`,
        );
      }
    }
  }

  let output = "";
  let totalWidth = 0;
  for (const { text, width } of stream()) {
    // Handle hard line breaks (marked with width -1)
    if (width === -1) {
      output += text; // Add the newline
      totalWidth = 0; // Reset width tracking
      continue;
    }

    // Handle automatic word wrapping
    if (options.maxWidth != null && totalWidth + width > options.maxWidth) {
      output += "\n";
      totalWidth = 0;
    }
    output += text;
    totalWidth += width;
  }
  return output;
}
