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
    type: "text";
    /**
     * The text content of the term.
     */
    text: string;
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
    type: "optionName";
    /**
     * The name of the option, which can be a short or long option name.
     * For example, `"-f"` or `"--foo"`.
     */
    optionName: string;
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
    type: "optionNames";
    /**
     * The list of option names, which can include both short and long
     * option names.  For example, `["--foo", "--bar"]`.
     */
    optionNames: readonly string[];
  }
  /**
   * A metavariable term in the message, which can be a single
   * metavariable.
   */
  | {
    /**
     * The type of the term, which is `"metavar"` for a metavariable.
     */
    type: "metavar";
    /**
     * The metavariable name, which is a string that represents
     * a variable in the message.  For example, `"VALUE"` or `"ARG"`.
     */
    metavar: string;
  }
  /**
   * A value term in the message, which can be a single value.
   */
  | {
    /**
     * The type of the term, which is `"value"` for a single value.
     */
    type: "value";
    /**
     * The value, which can be any string representation of a value.
     * For example, `"42"` or `"hello"`.
     */
    value: string;
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
    type: "values";
    /**
     * The list of values, which can include multiple string
     * representations of consecutive values.  For example, `["42", "hello"]`.
     */
    values: readonly string[];
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
export function metavar(metavar: string): MessageTerm {
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
 * Options for the {@link formatMessage} function.
 */
export interface MessageFormatOptions {
  /**
   * Whether to use colors in the formatted message.  If `true`,
   * the formatted message will include ANSI escape codes for colors.
   * If `false`, the message will be plain text without colors.
   * @default `false`
   */
  readonly colors?: boolean;

  /**
   * Whether to use quotes around values in the formatted message.
   * If `true`, values will be wrapped in quotes (e.g., `"value"`).
   * If `false`, values will be displayed without quotes.
   * @default `true`
   */
  readonly quotes?: boolean;
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
  const useColors = options.colors ?? false;
  const useQuotes = options.quotes ?? true;

  let output = "";
  for (const term of msg) {
    if (term.type === "text") {
      output += term.text;
    } else if (term.type === "optionName") {
      const name = useQuotes ? `\`${term.optionName}\`` : term.optionName;
      output += useColors
        ? `\x1b[3m${name}\x1b[0m` // Italic for option names
        : name;
    } else if (term.type === "optionNames") {
      const names = term.optionNames.map((name) =>
        useQuotes ? `\`${name}\`` : name
      );
      let i = 0;
      for (const name of names) {
        if (i > 0) output += "/";
        output += useColors
          ? `\x1b[3m${name}\x1b[0m` // Italic for option names
          : name;
        i++;
      }
    } else if (term.type === "metavar") {
      const metavar = useQuotes ? `\`${term.metavar}\`` : term.metavar;
      output += useColors
        ? `\x1b[1m${metavar}\x1b[0m` // Bold for metavariables
        : metavar;
    } else if (term.type === "value") {
      const value = useQuotes ? `${JSON.stringify(term.value)}` : term.value;
      output += useColors
        ? `\x1b[32m${value}\x1b[0m` // Green for values
        : value;
    } else if (term.type === "values") {
      const values = term.values.map((v) =>
        useQuotes ? `${JSON.stringify(v)}` : v
      ).join(" ");
      output += useColors
        ? `\x1b[32m${values}\x1b[0m` // Green for values
        : values;
    } else {
      throw new TypeError(
        `Invalid MessageTerm type: ${term["type"]}.`,
      );
    }
  }
  return output;
}
