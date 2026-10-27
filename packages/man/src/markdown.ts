/**
 * Markdown references for explicitly supplied command pages. Import this
 * optional subpath separately from the ordinary parser and runner.
 * @module
 * @since 1.4.0
 */
import type { DocEntry, DocPage } from "@optique/core/doc";
import type { Message, MessageTerm } from "@optique/core/message";
import type { ProgramMetadata } from "@optique/core/program";
import {
  formatUsage,
  formatUsageTerm,
  type HiddenVisibility,
  isDocHidden,
} from "@optique/core/usage";

/** A supplied page and its canonical identity. @since 1.4.0 */
export interface MarkdownCommandEntry {
  /** Canonical command tokens, excluding the program name. Empty for root. */
  readonly path: readonly string[];
  /** Already constructed documentation; usage includes command tokens. */
  readonly page: DocPage;
  /** Visible alternative names of this command under its canonical parent. */
  readonly aliases?: readonly string[];
  /** Accepted names that must never be displayed. */
  readonly hiddenAliases?: readonly string[];
  /** Documentation-hidden parents suppress every supplied descendant. */
  readonly hidden?: HiddenVisibility;
  /** Alias display override for this command's contents entry. */
  readonly showAliases?: boolean;
}

/** Author assertions about the supplied reference's scope. @since 1.4.0 */
export interface MarkdownReferenceCoverage {
  /** Whether the author has supplied every visible command in this scope. */
  readonly commands: "all-visible" | "partial";
  /** Whether all configured help forms in this scope are documented. */
  readonly help: "included" | "excluded";
  /** Whether all configured version forms in this scope are documented. */
  readonly version: "included" | "excluded";
  /** Whether all configured completion forms in this scope are documented. */
  readonly completion: "included" | "excluded";
}

/** Program metadata and presentation options for a reference. @since 1.4.0 */
export interface MarkdownReferenceOptions extends ProgramMetadata {
  /** Required author declaration, printed in the artifact. */
  readonly coverage: MarkdownReferenceCoverage;
  /** Default alias display, overridden by command entries and DocEntries. */
  readonly showAliases?: boolean;
  /** Override each supplied page's showUsage setting. Defaults to that page. */
  readonly showUsage?: boolean;
  /** Collection omissions to print in a partial reference. Hidden scopes skip them. */
  readonly unresolved?: readonly {
    /** Visible enclosing canonical path. */
    readonly path: readonly string[];
    /** Whether the gap affects one page or an opaque subtree. */
    readonly scope: "page" | "subtree";
    /** Documentation-only diagnostic, rendered as text. */
    readonly reason: string;
  }[];
}

function validateToken(token: string): void {
  if (
    typeof token !== "string" || token.length === 0 ||
    // deno-lint-ignore no-control-regex -- Reject control characters in tokens.
    /[\s\x00-\x1f\x7f-\x9f]/u.test(token) || !token.isWellFormed()
  ) {
    throw new TypeError(
      "Command paths and aliases must contain nonempty tokens without whitespace or control characters.",
    );
  }
}

function pathKey(path: readonly string[]): string {
  for (const token of path) validateToken(token);
  return JSON.stringify(path);
}

/**
 * Returns an injective anchor from the UTF-8 bytes of a JSON canonical path.
 * The dot separates these IDs from GitHub/VitePress heading slugs.
 * @param path Canonical command tokens; an empty array identifies root.
 * @returns The explicit anchor ID, without a leading hash.
 * @throws {TypeError} If a token is empty, ill-formed, or contains whitespace
 * or control characters.
 * @since 1.4.0
 */
export function getCommandReferenceAnchor(path: readonly string[]): string {
  const bytes = new TextEncoder().encode(pathKey(path));
  return "optique-command." +
    Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function singleLine(input: string): string {
  return input.replace(/[\r\n\t]/g, " ").replace(
    // deno-lint-ignore no-control-regex -- Show embedded controls as text.
    /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function code(input: string): string {
  const content = singleLine(input);
  if (content === "") return "<code></code>";
  const fence = "`".repeat(
    Math.max(
      0,
      ...Array.from(content.matchAll(/`+/g), (match) => match[0].length),
    ) + 1,
  );
  const padding =
    content.startsWith("`") || content.endsWith("`") || /^ .* $/u.test(content)
      ? " "
      : "";
  return fence + padding + content + padding + fence;
}

function prose(input: string): string {
  return input.replace(/\r\n?/g, "\n").split("\n").map((line) => {
    const escaped = singleLine(line).replace(
      /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/g,
      (char) => {
        if (char === "&") return "&amp;";
        if (char === "<") return "&lt;";
        if (char === ">") return "&gt;";
        return "\\" + char;
      },
    );
    return escaped.replace(/^ +/, (spaces) => "&#32;".repeat(spaces.length));
  }).join("\\\n");
}

function formatMessageTerm(term: MessageTerm): string {
  switch (term.type) {
    case "text":
      return prose(term.text);
    case "optionName":
      return code(term.optionName);
    case "optionNames":
      return term.optionNames.map(code).join(", ");
    case "metavar":
      return code(term.metavar);
    case "value":
      return code(term.value);
    case "values":
      return term.values.map(code).join(" ");
    case "envVar":
      return code(term.envVar);
    case "commandLine":
      return code(term.commandLine);
    case "url":
      return code(term.url.href);
    case "lineBreak":
      return "\\\n";
  }
}

function formatMessage(message: Message): string {
  let previousCode = false;
  return message.map((term) => {
    const content = formatMessageTerm(term);
    const semanticCode = term.type !== "text" && term.type !== "lineBreak";
    // Adjacent closing/opening backticks otherwise merge into one delimiter.
    const separator = previousCode && semanticCode && content !== ""
      ? "<!-- -->"
      : "";
    if (content !== "") previousCode = semanticCode;
    return separator + content;
  }).join("").replace(/(?:\\\n)+$/, "");
}

function link(label: string, path: readonly string[]): string {
  return `<a href="#${getCommandReferenceAnchor(path)}"><code>${
    prose(singleLine(label))
  }</code></a>`;
}

function visibleAliases(entry: MarkdownCommandEntry): readonly string[] {
  const hidden = new Set(entry.hiddenAliases);
  return [...new Set(entry.aliases)].filter((alias) =>
    !hidden.has(alias) && alias !== entry.path.at(-1)
  );
}

function hiddenInTree(
  entry: MarkdownCommandEntry,
  index: ReadonlyMap<string, MarkdownCommandEntry>,
): boolean {
  for (let length = 1; length <= entry.path.length; length++) {
    if (isDocHidden(index.get(pathKey(entry.path.slice(0, length)))?.hidden)) {
      return true;
    }
  }
  return false;
}

function validateEntries(
  entries: readonly MarkdownCommandEntry[],
): ReadonlyMap<string, MarkdownCommandEntry> {
  const index = new Map<string, MarkdownCommandEntry>();
  const spellings = new Map<string, string>();
  for (const entry of entries) {
    const key = pathKey(entry.path);
    if (index.has(key)) throw new TypeError(`Duplicate command path: ${key}`);
    index.set(key, entry);
    for (
      const alias of [...entry.aliases ?? [], ...entry.hiddenAliases ?? []]
    ) validateToken(alias);
    if (entry.path.length === 0) {
      if (
        entry.aliases?.length || entry.hiddenAliases?.length || entry.hidden
      ) {
        throw new TypeError(
          "The root page cannot have aliases or hidden visibility.",
        );
      }
      continue;
    }
    for (
      const name of [
        entry.path.at(-1)!,
        ...entry.aliases ?? [],
        ...entry.hiddenAliases ?? [],
      ]
    ) {
      const spelling = pathKey([...entry.path.slice(0, -1), name]);
      const destination = spellings.get(spelling);
      if (destination != null && destination !== key) {
        throw new TypeError(`Ambiguous command spelling: ${spelling}`);
      }
      spellings.set(spelling, key);
    }
  }
  return index;
}

function commandTarget(
  entry: DocEntry,
  parent: MarkdownCommandEntry,
  index: ReadonlyMap<string, MarkdownCommandEntry>,
): MarkdownCommandEntry | undefined {
  return entry.term.type === "command"
    ? index.get(pathKey([...parent.path, entry.term.name]))
    : undefined;
}

function entryHidden(entry: DocEntry): boolean {
  return "hidden" in entry.term && isDocHidden(entry.term.hidden);
}

function validateCoverage(coverage: MarkdownReferenceCoverage): void {
  if (
    coverage == null ||
    !["all-visible", "partial"].includes(coverage.commands) ||
    [coverage.help, coverage.version, coverage.completion].some((value) =>
      value !== "included" && value !== "excluded"
    )
  ) {
    throw new TypeError(
      "Reference coverage must declare commands and runner-added help, version, and completion inputs.",
    );
  }
}

/**
 * Renders supplied command pages in caller order as one Markdown reference.
 *
 * Coverage is always author-declared. Visible child references and canonical
 * prefixes are checked, but commands absent from every supplied page cannot be
 * discovered. The renderer never collects pages or evaluates parser callbacks.
 * Messages are documentation text rather than Markdown. Generated anchors and
 * internal links require raw HTML support; bare web/email text may be linkified
 * by a consumer. Every page's usage already includes its command tokens.
 *
 * @param entries Canonical command pages, with explicit aliases and visibility.
 * @param options Program metadata, coverage declaration and presentation policy.
 * @returns A deterministic Markdown document ending in one newline.
 * @throws {TypeError} If paths/aliases are invalid or ambiguous, a canonical
 * path is duplicated, metadata is invalid, or declared complete coverage has
 * missing visible command pages.
 * @since 1.4.0
 */
export function formatCommandReference(
  entries: readonly MarkdownCommandEntry[],
  options: MarkdownReferenceOptions,
): string {
  formatUsage(options.name, [], { colors: false }); // Apply the existing program-name contract even without a synopsis.
  validateCoverage(options.coverage);
  const index = validateEntries(entries);
  const visible = entries.filter((entry) => !hiddenInTree(entry, index));
  const unresolved =
    options.unresolved?.filter((gap) =>
      !hiddenInTree({ path: gap.path, page: { sections: [] } }, index)
    ) ?? [];
  for (const gap of unresolved) {
    pathKey(gap.path);
    if (gap.scope !== "page" && gap.scope !== "subtree") {
      throw new TypeError("An unresolved scope must be page or subtree.");
    }
  }
  if (unresolved.length > 0 && options.coverage.commands === "all-visible") {
    throw new TypeError(
      "Unresolved command documentation requires partial coverage.",
    );
  }
  const missing = new Map<string, readonly string[]>();
  if (!index.has("[]")) missing.set("[]", []);
  for (const entry of visible) {
    for (let length = 0; length < entry.path.length; length++) {
      const prefix = entry.path.slice(0, length);
      if (!index.has(pathKey(prefix))) missing.set(pathKey(prefix), prefix);
    }
    for (const section of entry.page.sections) {
      for (const item of section.entries) {
        if (entryHidden(item) || item.term.type !== "command") continue;
        const target = commandTarget(item, entry, index);
        if (target == null) {
          const path = [...entry.path, item.term.name];
          missing.set(pathKey(path), path);
        }
      }
    }
  }
  if (missing.size > 0 && options.coverage.commands === "all-visible") {
    throw new TypeError(
      `Missing command pages: ${
        [...missing.values()].map((path) => JSON.stringify(path)).join(", ")
      }`,
    );
  }

  const output: string[] = [`# ${code(options.name)} command reference`];
  const addMessage = (content: Message | undefined) => {
    if (content != null && content.length > 0) {
      output.push(formatMessage(content));
    }
  };
  if (options.version != null) output.push(`Version: ${code(options.version)}`);
  addMessage(options.brief);
  addMessage(options.description);
  output.push(
    `Coverage: author-declared ${
      options.coverage.commands === "all-visible"
        ? "all visible commands"
        : "partial command reference"
    }.`,
  );
  output.push(
    "Runner inputs: " +
      (["help", "version", "completion"] as const).map((feature) =>
        `${feature}: ${
          options.coverage[feature] === "included"
            ? "included"
            : "not documented here (if configured)"
        }`
      ).join("; ") + ".",
  );
  if (missing.size > 0) {
    output.push(
      "Missing command pages: " + [...missing.values()].map((path) =>
        code([options.name, ...path].join(" "))
      ).join(", ") + ".",
    );
  }
  if (unresolved.length > 0) {
    output.push(
      "## Unresolved documentation",
      unresolved.map((gap) =>
        ` -  ${code([options.name, ...gap.path].join(" "))} (${gap.scope}): ${
          code(gap.reason)
        }`
      ).join("\n"),
    );
  }
  output.push("## Contents");
  output.push(
    visible.map((entry) => {
      const fullName = [options.name, ...entry.path].join(" ");
      const aliases = (entry.showAliases ?? options.showAliases ?? false)
        ? visibleAliases(entry).map((alias) =>
          link(
            [options.name, ...entry.path.slice(0, -1), alias].join(" "),
            entry.path,
          )
        )
        : [];
      return ` -  ${link(fullName, entry.path)}${
        aliases.length > 0 ? ` (aliases: ${aliases.join(", ")})` : ""
      }`;
    }).join("\n"),
  );

  for (const entry of visible) {
    const page = entry.page;
    output.push(`<a id="${getCommandReferenceAnchor(entry.path)}"></a>`);
    output.push(`## ${code([options.name, ...entry.path].join(" "))}`);
    addMessage(page.brief);
    if ((options.showUsage ?? page.showUsage ?? true) && page.usage != null) {
      const usage = formatUsage(options.name, page.usage, { colors: false })
        .replace(/\r\n?/g, "\n").split("\n").map(singleLine).join("\n");
      const fence = "~".repeat(
        Math.max(
          3,
          ...Array.from(usage.matchAll(/~+/g), (match) => match[0].length + 1),
        ),
      );
      output.push("### Usage", `${fence} text\n${usage}\n${fence}`);
    }
    addMessage(page.description);
    for (const section of page.sections) {
      const items: string[] = [];
      for (const item of section.entries) {
        if (entryHidden(item)) continue;
        const target = commandTarget(item, entry, index);
        if (target != null && hiddenInTree(target, index)) continue;
        const label = formatUsageTerm(item.term, {
          context: "doc",
          colors: false,
        });
        if (label === "") continue;
        const aliases = target != null &&
            (item.showAliases ?? target.showAliases ?? options.showAliases ??
              false)
          ? visibleAliases(target).map((alias) => link(alias, target.path))
          : [];
        let content = " -  " +
          (target == null ? code(label) : link(label, target.path));
        if (aliases.length > 0) content += ` (aliases: ${aliases.join(", ")})`;
        const details: string[] = [];
        if (item.description != null) {
          details.push(formatMessage(item.description));
        }
        if (item.default != null) {
          details.push("Default: " + formatMessage(item.default));
        }
        if (item.choices != null) {
          details.push("Choices: " + formatMessage(item.choices));
        }
        if (item.envVars?.length) {
          details.push("Environment: " + item.envVars.map(code).join(", "));
        }
        if (details.length > 0) {
          content += "\n\n" +
            details.join("\n\n").split("\n").map((line) => "    " + line).join(
              "\n",
            );
        }
        items.push(content);
      }
      if (items.length > 0) {
        output.push(
          "### " + prose(singleLine(section.title ?? "Inputs")),
          items.join("\n\n"),
        );
      }
    }
    const bindings = page.environmentBindings?.filter((binding) =>
      !isDocHidden(binding.hidden)
    );
    if (bindings?.length) {
      output.push(
        "### Environment",
        bindings.map((binding) =>
          ` -  ${code(binding.name)}${
            binding.description == null ? "" : ": " +
              formatMessage(binding.description).replaceAll("\n", "\n    ")
          }`
        ).join("\n"),
      );
    }
    for (
      const [title, content] of [
        ["Examples", page.examples],
        ["Author", page.author],
        ["Bugs", page.bugs],
        ["Notes", page.footer],
      ] as const
    ) {
      if (content != null && content.length > 0) {
        output.push(`### ${title}`, formatMessage(content));
      }
    }
  }
  for (
    const [title, content] of [
      ["Examples", options.examples],
      ["Author", options.author],
      ["Bugs", options.bugs],
      ["Notes", options.footer],
    ] as const
  ) {
    if (content != null && content.length > 0) {
      output.push(`## ${title}`, formatMessage(content));
    }
  }
  return output.filter((part) => part !== "").join("\n\n") + "\n";
}
