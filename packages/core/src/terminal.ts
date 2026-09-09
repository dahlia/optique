import type { MessageTerm } from "./message.ts";

/**
 * A program's executable name.
 * @since 1.3.0
 */
export interface ProgramNameTerm {
  readonly type: "programName";
  readonly programName: string;
}
/**
 * A heading or annotation label.
 * @since 1.3.0
 */
export interface LabelTerm {
  readonly type: "label";
  readonly label: string;
  readonly kind:
    | "usage"
    | "usageSummary"
    | "section"
    | "examples"
    | "author"
    | "bugs"
    | "choices";
}
/**
 * Punctuation supplied by a terminal renderer.
 * @since 1.3.0
 */
export interface SyntaxPunctuationTerm {
  readonly type: "syntaxPunctuation";
  readonly punctuation: string;
  readonly kind:
    | "optionalOpen"
    | "optionalClose"
    | "groupOpen"
    | "groupClose"
    | "alternative"
    | "ellipsis"
    | "passthrough"
    | "optionSeparator"
    | "messageOptionSeparator"
    | "defaultPrefix"
    | "defaultSuffix"
    | "choicesPrefix"
    | "choicesSuffix";
}
/**
 * The label preceding an error message.
 * @since 1.3.0
 */
export interface ErrorLabelTerm {
  readonly type: "errorLabel";
  readonly label: string;
}
/**
 * Semantic leaves shared by message, usage, and help renderers.
 * @since 1.3.0
 */
export type TerminalTerm =
  | MessageTerm
  | ProgramNameTerm
  | LabelTerm
  | SyntaxPunctuationTerm
  | ErrorLabelTerm;
/**
 * A terminal color. RGB channels and palette indices are integers from 0 to 255.
 * @since 1.3.0
 */
export type TerminalColor =
  | "black"
  | "red"
  | "green"
  | "yellow"
  | "blue"
  | "magenta"
  | "cyan"
  | "white"
  | "brightBlack"
  | "brightRed"
  | "brightGreen"
  | "brightYellow"
  | "brightBlue"
  | "brightMagenta"
  | "brightCyan"
  | "brightWhite"
  | readonly [number, number, number]
  | { readonly index: number };
/**
 * Inherited terminal styling; false disables an inherited attribute.
 * @since 1.3.0
 */
export interface TerminalStyle {
  readonly foreground?: TerminalColor;
  readonly background?: TerminalColor;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly underline?: boolean;
}
/**
 * Structured output. Each text leaf is an indivisible wrapping unit.
 * @since 1.3.0
 */
export type TerminalFragment =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "concat"; readonly children: readonly TerminalFragment[] }
  | {
    readonly type: "style";
    readonly style: TerminalStyle;
    readonly children: readonly TerminalFragment[];
  }
  | {
    readonly type: "link";
    readonly href: string;
    readonly children: readonly TerminalFragment[];
  };
/**
 * Context supplied to a semantic formatter.
 * @since 1.3.0
 */
export interface TerminalFormatContext {
  /** Whether the default display text includes quotes. */
  readonly quotes: boolean;
  /** Default display text, quoted but not styled. */
  readonly text: string;
  /** The purpose of a leaf originating in a usage description. */
  readonly usage?: "argument" | "optionValue" | "command" | "literal";
  /** Formats a child through the effective theme. Same-role recursion is the author's responsibility. */
  readonly format: (
    term: Exclude<TerminalTerm, { readonly type: "lineBreak" }>,
  ) => TerminalFragment;
}
/**
 * Formats a semantic leaf without emitting ANSI.
 * @since 1.3.0
 */
export type TerminalFormatter<T extends TerminalTerm = TerminalTerm> = (
  term: T,
  context: TerminalFormatContext,
) => TerminalFragment;
type Role = Exclude<TerminalTerm["type"], "text" | "lineBreak">;
type Formatters = {
  readonly [K in Role]: TerminalFormatter<
    Extract<TerminalTerm, { readonly type: K }>
  >;
};
/**
 * A partial theme; omitted roles retain their defaults.
 * @since 1.3.0
 */
export type TerminalTheme = Partial<Formatters> & {
  /** Surrounding annotation styles. Missing styles are dim; {} disables dim. */
  readonly annotationStyles?: {
    readonly default?: TerminalStyle;
    readonly choices?: TerminalStyle;
  };
};
const plain = (text: string): TerminalFragment => ({ type: "text", text });
const styled = (text: string, style: TerminalStyle): TerminalFragment => ({
  type: "style",
  style,
  children: [plain(text)],
});
/**
 * Optique's built-in terminal theme, with every formatter available for delegation.
 * @since 1.3.0
 */
export const defaultTerminalTheme: Formatters & {
  readonly annotationStyles: {
    readonly default: TerminalStyle;
    readonly choices: TerminalStyle;
  };
} = {
  optionName: (_term, ctx) =>
    styled(
      ctx.text,
      ctx.usage === "command" ? { bold: true } : { italic: true },
    ),
  optionNames: (term, ctx) => ({
    type: "concat",
    children: term.optionNames.flatMap((name, i) => [
      ...(i === 0 ? [] : [
        ctx.format({
          type: "syntaxPunctuation",
          punctuation: "/",
          kind: "messageOptionSeparator",
        }),
      ]),
      ctx.format({ type: "optionName", optionName: name }),
    ]),
  }),
  metavar: (_term, ctx) =>
    ctx.usage === "optionValue"
      ? {
        type: "style",
        style: { underline: true },
        children: [styled(ctx.text, { dim: true })],
      }
      : styled(
        ctx.text,
        ctx.usage === "argument" ? { underline: true } : { bold: true },
      ),
  value: (_term, ctx) =>
    ctx.usage === "literal"
      ? plain(ctx.text)
      : styled(ctx.text, { foreground: "green" }),
  values: (term, ctx) => ({
    type: "style",
    style: { foreground: "green" },
    children: term.values.flatMap((value, i) => [
      ...(i === 0 ? [] : [plain(" ")]),
      ctx.format({ type: "value", value }),
    ]),
  }),
  envVar: (_term, ctx) => styled(ctx.text, { bold: true, underline: true }),
  commandLine: (_term, ctx) => styled(ctx.text, { foreground: "cyan" }),
  url: (term, ctx) => ({
    type: "link",
    href: term.url.href,
    children: [plain(ctx.text)],
  }),
  programName: (_term, ctx) => styled(ctx.text, { bold: true }),
  label: (term, ctx) =>
    term.kind === "usageSummary" || term.kind === "choices"
      ? plain(ctx.text)
      : styled(ctx.text, { bold: true, dim: true }),
  syntaxPunctuation: (term, ctx) =>
    [
        "alternative",
        "messageOptionSeparator",
        "defaultPrefix",
        "defaultSuffix",
        "choicesPrefix",
        "choicesSuffix",
      ].includes(term.kind)
      ? plain(ctx.text)
      : styled(ctx.text, { dim: true }),
  errorLabel: (_term, ctx) => plain(ctx.text),
  annotationStyles: { default: { dim: true }, choices: { dim: true } },
};
