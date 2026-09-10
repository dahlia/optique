import { getDisplayWidth } from "./displaywidth.ts";
import {
  defaultTerminalTheme,
  type TerminalColor,
  type TerminalFormatContext,
  type TerminalFragment,
  type TerminalStyle,
  type TerminalTerm,
  type TerminalTheme,
} from "./terminal.ts";

export interface Scope {
  readonly kind: "style" | "link";
  readonly style?: TerminalStyle;
  readonly href?: string;
}
export interface TerminalToken {
  readonly text: string;
  readonly width: number;
  readonly scopes: readonly Scope[];
  /** Layout-owned space, removable beside an explicit hard break. */
  readonly separator?: boolean;
}
export function terminalText(text: string): TerminalFragment {
  return { type: "text", text };
}
// Keep the legacy continuous green scope only when both value roles use
// their defaults. Custom scalar formatters own their children's styling.
function valuesFormatter(theme: TerminalTheme) {
  if (theme.values != null && theme.values !== defaultTerminalTheme.values) {
    return theme.values;
  }
  if (theme.value != null && theme.value !== defaultTerminalTheme.value) {
    return defaultTerminalTheme.values;
  }
  return (
    term: Extract<TerminalTerm, { readonly type: "values" }>,
    context: TerminalFormatContext,
  ): TerminalFragment => ({
    type: "style",
    style: { foreground: "green" },
    children: [defaultTerminalTheme.values(term, context)],
  });
}
export function formatTerminalTerm(
  term: TerminalTerm,
  theme: TerminalTheme = {},
  quotes = false,
  usage?: TerminalFormatContext["usage"],
): TerminalFragment {
  const quote = (s: string) => quotes ? `\`${s}\`` : s;
  let text: string;
  switch (term.type) {
    case "text":
      return terminalText(term.text);
    case "lineBreak":
      throw new TypeError("Hard breaks must be rendered at the message level.");
    case "optionName":
      text = quote(term.optionName);
      break;
    case "optionNames":
      text = term.optionNames.map(quote).join("/");
      break;
    case "metavar":
      text = quote(term.metavar);
      break;
    case "value":
      text = quotes ? JSON.stringify(term.value) : term.value;
      break;
    case "values":
      text = term.values.map((v) => quotes ? JSON.stringify(v) : v).join(" ");
      break;
    case "envVar":
      text = quote(term.envVar);
      break;
    case "commandLine":
      text = quote(term.commandLine);
      break;
    case "url":
      text = quotes ? `<${term.url.href}>` : term.url.href;
      break;
    case "programName":
      text = term.programName;
      break;
    case "label":
    case "errorLabel":
      text = term.label;
      break;
    case "syntaxPunctuation":
      text = term.punctuation;
      break;
    default:
      throw new TypeError(`Invalid MessageTerm type: ${term["type"]}.`);
  }
  const ctx: TerminalFormatContext = {
    quotes,
    text,
    usage,
    format: (child) => formatTerminalTerm(child, theme, quotes, usage),
  };
  // Explicit dispatch preserves the correlation between a role and its callback.
  switch (term.type) {
    case "optionName":
      return (theme.optionName ?? defaultTerminalTheme.optionName)(term, ctx);
    case "optionNames":
      return (theme.optionNames ?? defaultTerminalTheme.optionNames)(term, ctx);
    case "metavar":
      return (theme.metavar ?? defaultTerminalTheme.metavar)(term, ctx);
    case "value":
      return (theme.value ?? defaultTerminalTheme.value)(term, ctx);
    case "values":
      return valuesFormatter(theme)(term, ctx);
    case "envVar":
      return (theme.envVar ?? defaultTerminalTheme.envVar)(term, ctx);
    case "commandLine":
      return (theme.commandLine ?? defaultTerminalTheme.commandLine)(term, ctx);
    case "url":
      return (theme.url ?? defaultTerminalTheme.url)(term, ctx);
    case "programName":
      return (theme.programName ?? defaultTerminalTheme.programName)(term, ctx);
    case "label":
      return (theme.label ?? defaultTerminalTheme.label)(term, ctx);
    case "syntaxPunctuation":
      return (theme.syntaxPunctuation ??
        defaultTerminalTheme.syntaxPunctuation)(term, ctx);
    case "errorLabel":
      return (theme.errorLabel ?? defaultTerminalTheme.errorLabel)(term, ctx);
  }
}
const colorNames = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
];
function colorCode(color: TerminalColor, background: boolean): string {
  const channel = (n: number) => {
    if (!Number.isInteger(n) || n < 0 || n > 255) {
      throw new RangeError(
        "Terminal color channels must be integers from 0 to 255.",
      );
    }
    return n;
  };
  if (typeof color === "string") {
    const i = colorNames.indexOf(color);
    if (i < 0) throw new RangeError("Unknown terminal color.");
    return String((background ? 40 : 30) + (i >= 8 ? 60 + i - 8 : i));
  }
  const prefix = background ? 48 : 38;
  if ("index" in color) return `${prefix};5;${channel(color.index)}`;
  return `${prefix};2;${color.map(channel).join(";")}`;
}
export function styleCode(style: TerminalStyle): string {
  const codes: (number | string)[] = [];
  if (style.bold) codes.push(1);
  if (style.dim) codes.push(2);
  if (style.italic) codes.push(3);
  if (style.underline) codes.push(4);
  if (style.foreground != null) codes.push(colorCode(style.foreground, false));
  if (style.background != null) codes.push(colorCode(style.background, true));
  return codes.length ? `\x1b[${codes.join(";")}m` : "";
}
function sameStyle(a: TerminalStyle, b: TerminalStyle): boolean {
  return a.bold === b.bold && a.dim === b.dim && a.italic === b.italic &&
    a.underline === b.underline &&
    JSON.stringify(a.foreground) === JSON.stringify(b.foreground) &&
    JSON.stringify(a.background) === JSON.stringify(b.background);
}
export function* fragmentTokens(
  fragment: TerminalFragment,
  scopes: readonly Scope[] = [],
  inherited: TerminalStyle = {},
): Generator<TerminalToken> {
  if (fragment.type === "text") {
    const lines = fragment.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (i > 0) yield { text: "\n", width: -1, scopes };
      if (lines[i].length > 0 || lines.length === 1) {
        yield { text: lines[i], width: getDisplayWidth(lines[i]), scopes };
      }
    }
    return;
  }
  let next = scopes;
  let style = inherited;
  if (fragment.type === "style") {
    styleCode(fragment.style); // Validate even when colors are disabled.
    style = { ...inherited, ...fragment.style };
    if (!sameStyle(style, inherited)) {
      next = [...scopes, { kind: "style", style: fragment.style }];
    }
  } else if (fragment.type === "link") {
    next = [...scopes, { kind: "link", href: fragment.href }];
  }
  for (const child of fragment.children) {
    yield* fragmentTokens(child, next, style);
  }
}
export function serializeTokens(
  tokens: Iterable<TerminalToken>,
  colors = false,
  resetSuffix = "",
  ambient: TerminalStyle = {},
): string {
  let output = "";
  let active: readonly Scope[] = [];
  function transition(next: readonly Scope[]) {
    let common = 0;
    while (
      common < active.length && common < next.length &&
      active[common] === next[common]
    ) common++;
    const surviving = active.slice(0, common);
    const restored = surviving.reduce<TerminalStyle>(
      (style, scope) => ({ ...style, ...scope.style }),
      ambient,
    );
    let reset = false;
    let closedLink = false;
    for (let i = active.length - 1; i >= common; i--) {
      if (active[i].kind === "link") {
        output += `\x1b]8;;\x1b\\${resetSuffix}${styleCode(restored)}`;
        closedLink = true;
      } else reset = true;
    }
    active = surviving;
    if (closedLink) {
      const parentLink = active.findLast((scope) => scope.kind === "link");
      if (parentLink != null) output += `\x1b]8;;${parentLink.href}\x1b\\`;
    }
    if (reset) {
      output += "\x1b[0m" + resetSuffix + styleCode(restored);
    }
    for (const scope of next.slice(common)) {
      if (scope.kind === "link") output += `\x1b]8;;${scope.href}\x1b\\`;
      else if (scope.style) {
        if (Object.values(scope.style).includes(false)) {
          const inherited = active.reduce<TerminalStyle>(
            (s, x) => ({ ...s, ...x.style }),
            ambient,
          );
          output += "\x1b[0m" + resetSuffix +
            styleCode({ ...inherited, ...scope.style });
        } else output += styleCode(scope.style);
      }
      active = [...active, scope];
    }
  }
  const items = [...tokens];
  for (let i = 0; i < items.length; i++) {
    const token = items[i];
    if (colors && token.width === -1 && token.scopes.length === 0) {
      const next = items.slice(i + 1).find((t) => t.width !== -1)?.scopes ?? [];
      let common = 0;
      while (
        common < active.length && common < next.length &&
        active[common] === next[common]
      ) common++;
      transition(active.slice(0, common));
    } else if (colors) transition(token.scopes);
    output += token.text;
  }
  if (colors) transition([]);
  return output;
}
/**
 * Serializes one semantic leaf for a terminal surface outside a message.
 * @param term The semantic leaf to render.
 * @param theme Optional overrides for the default terminal theme.
 * @param colors Whether to emit styles and hyperlinks.
 * @param usage The leaf's usage context, when applicable.
 * @param ambient The style surrounding the rendered leaf.
 * @returns The leaf's styled or plain representation.
 * @throws {TypeError} If the term is a hard break or has an unknown type.
 * @throws {RangeError} If a color channel or palette index is invalid.
 * @since 1.3.0
 * @internal
 */
export function renderTerminalTerm(
  term: TerminalTerm,
  theme?: TerminalTheme,
  colors?: boolean,
  usage?: TerminalFormatContext["usage"],
  ambient?: TerminalStyle,
): string {
  return serializeTokens(
    fragmentTokens(formatTerminalTerm(term, theme, false, usage)),
    colors,
    "",
    ambient,
  );
}

/** Memoizes semantic leaves for one layout pass, including measurement. */
export function cacheTerminalTheme(theme: TerminalTheme = {}): TerminalTheme {
  function cache<T extends TerminalTerm>(
    formatter: (term: T, context: TerminalFormatContext) => TerminalFragment,
  ) {
    const fragments = new Map<string, TerminalFragment>();
    return (term: T, context: TerminalFormatContext): TerminalFragment => {
      const key = JSON.stringify([term, context.quotes, context.usage]);
      let fragment = fragments.get(key);
      if (fragment == null) {
        fragment = formatter(term, context);
        fragments.set(key, fragment);
      }
      return fragment;
    };
  }
  return {
    optionName: cache(theme.optionName ?? defaultTerminalTheme.optionName),
    optionNames: cache(theme.optionNames ?? defaultTerminalTheme.optionNames),
    metavar: cache(theme.metavar ?? defaultTerminalTheme.metavar),
    value: cache(theme.value ?? defaultTerminalTheme.value),
    values: cache(valuesFormatter(theme)),
    envVar: cache(theme.envVar ?? defaultTerminalTheme.envVar),
    commandLine: cache(theme.commandLine ?? defaultTerminalTheme.commandLine),
    url: cache(theme.url ?? defaultTerminalTheme.url),
    programName: cache(theme.programName ?? defaultTerminalTheme.programName),
    label: cache(theme.label ?? defaultTerminalTheme.label),
    syntaxPunctuation: cache(
      theme.syntaxPunctuation ?? defaultTerminalTheme.syntaxPunctuation,
    ),
    errorLabel: cache(theme.errorLabel ?? defaultTerminalTheme.errorLabel),
    annotationStyles: theme.annotationStyles == null ? undefined : {
      default: theme.annotationStyles.default == null
        ? undefined
        : { ...theme.annotationStyles.default },
      choices: theme.annotationStyles.choices == null
        ? undefined
        : { ...theme.annotationStyles.choices },
    },
  };
}
