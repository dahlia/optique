/**
 * Documentation-only collection for supported built-in parser definitions.
 * Import this optional subpath separately from ordinary parsing.
 * @module
 * @since 1.4.0
 */
import {
  cloneDocEntry,
  deduplicateDocFragments,
  type DocEntry,
  type DocFragment,
  type DocPage,
  type DocSection,
} from "./doc.ts";
import { cloneMessage, type Message } from "./message.ts";
import type { Mode, Parser } from "./parser.ts";
import {
  type DocNode,
  getDocNode,
  getDocValue,
} from "./internal/doc-metadata.ts";
import {
  cloneUsageTerm,
  type HiddenVisibility,
  isDocHidden,
  mergeHidden,
  type Usage,
  type UsageTerm,
} from "./usage.ts";
import { validateCommandNames } from "./validate.ts";

/** A command page with an explicit canonical path. @since 1.4.0 */
export interface CommandDocPage {
  /** Canonical tokens, excluding program name and positional values. */
  readonly path: readonly string[];
  /** Constructed documentation, with command tokens already in usage. */
  readonly page: DocPage;
  /** Visible aliases of the final command token. */
  readonly aliases?: readonly string[];
  /** Accepted alternative names reserved for validation, never display. */
  readonly hiddenAliases?: readonly string[];
  /** Documentation visibility; hidden ancestors suppress descendants. */
  readonly hidden?: HiddenVisibility;
  /** Default alias display for this command. */
  readonly showAliases?: boolean;
}

/** An author-supplied replacement or additional page. @since 1.4.0 */
export interface SuppliedCommandDocPage extends CommandDocPage {
  /**
   * A page assertion covers this page only. A subtree assertion declares that
   * the author supplied every visible descendant too; opaque descendants cannot
   * be verified independently. Defaults to page.
   */
  readonly coverage?: "page" | "subtree";
}

/** A collected page and the origin of its documentation. @since 1.4.0 */
export interface CollectedCommandDocPage extends CommandDocPage {
  /** Whether metadata or the author provided this page. */
  readonly source: "automatic" | "supplied";
  /** Coverage asserted by the author, for supplied pages only. */
  readonly coverage?: "page" | "subtree";
}

/** A visible scope whose documentation could not be collected. @since 1.4.0 */
export interface DocPageCollectionGap {
  /** Affected page or visible enclosing opaque scope; never positional values. */
  readonly path: readonly string[];
  /** Whether missing information affects this page or an opaque subtree. */
  readonly scope: "page" | "subtree";
  /** A stable diagnostic for the unsupported operation. */
  readonly reason:
    | "unregistered-parser"
    | "value-metadata-unavailable"
    | "static-default-format-unavailable"
    | "functional-usage"
    | "ambiguous-command-path"
    | "missing-command-page";
}

/** Result data for the supplied parser, without runner augmentation. @since 1.4.0 */
export interface DocPageCollectionResult {
  /** Root and supported commands in definition order, followed by additions. */
  readonly entries: readonly CollectedCommandDocPage[];
  /** Uncovered visible scopes; an empty list does not inspect author imports. */
  readonly unresolved: readonly DocPageCollectionGap[];
  /** Runner-added help/version/completion are outside this parser scope. */
  readonly scope: "parser";
}

/** Options for metadata-only collection. @since 1.4.0 */
export interface DocPageCollectionOptions {
  /** Throw for uncovered scopes. Defaults to true. */
  readonly strict?: boolean;
  /** Replacements win at their canonical paths; duplicate supplied paths fail. */
  readonly entries?: readonly SuppliedCommandDocPage[];
}

/** Strict collection failed with explicit partial result data. @since 1.4.0 */
export class DocPageCollectionError extends TypeError {
  /** Collected pages and every unresolved visible scope. */
  readonly result: DocPageCollectionResult;

  /**
   * Constructs an error from a partial collection.
   * @param result Collected pages and gaps.
   */
  constructor(result: DocPageCollectionResult) {
    super("Documentation collection has unresolved scopes.");
    this.name = "DocPageCollectionError";
    this.result = result;
  }
}

interface Projection {
  readonly usage: Usage;
  /** Exact selected path tokens stay visible inside usage-hidden groups. */
  readonly pathTerms?: readonly UsageTerm[];
  readonly fragments: readonly DocFragment[];
  readonly brief?: Message;
  readonly description?: Message;
  readonly footer?: Message;
  readonly showUsage?: boolean;
  readonly unresolvedUsage?: boolean;
}
const emptyProjection: Projection = { usage: [], fragments: [] };

function key(path: readonly string[]): string {
  if (path.length > 0) validateCommandNames(path, "Documentation path");
  if (path.some((token) => !token.isWellFormed())) {
    throw new TypeError(
      "Documentation paths must contain well-formed Unicode tokens.",
    );
  }
  return JSON.stringify(path);
}
function prefix(parent: readonly string[], child: readonly string[]): boolean {
  return parent.length <= child.length &&
    parent.every((token, index) => token === child[index]);
}
function hasPath(parser: object, path: readonly string[]): boolean {
  const node = getDocNode(parser);
  if (
    node == null || path.length === 0 || isDocHidden(node.hidden) ||
    ambiguousSequence(node)
  ) {
    return false;
  }
  if (node.kind === "command") {
    return !isDocHidden(node.hidden) && node.name === path[0] &&
      (path.length === 1 || hasPath(node.children![0], path.slice(1)));
  }
  return node.children?.some((child) => hasPath(child, path)) ?? false;
}
function hasCommands(parser: object): boolean {
  const node = getDocNode(parser);
  if (node == null || isDocHidden(node.hidden)) return false;
  return node.kind === "command" || node.children?.some(hasCommands) === true;
}
function ambiguousSequence(node: DocNode): boolean {
  return node.kind === "seq" &&
    (node.children?.filter(hasCommands).length ?? 0) > 1;
}
function hideUsage(usage: Usage, pathTerms: readonly UsageTerm[]): Usage {
  return usage.map((term): UsageTerm => {
    if (pathTerms.includes(term)) return term;
    if (
      term.type === "optional" || term.type === "multiple" ||
      term.type === "sequence"
    ) return { ...term, terms: hideUsage(term.terms, pathTerms) };
    if (term.type === "exclusive") {
      return {
        ...term,
        terms: term.terms.map((terms) => hideUsage(terms, pathTerms)),
      };
    }
    if (
      term.type === "option" || term.type === "argument" ||
      term.type === "command" || term.type === "passthrough"
    ) return { ...term, hidden: mergeHidden(term.hidden, "usage") };
    return term;
  });
}
function leafTerm(usage: Usage): UsageTerm | undefined {
  for (const term of usage) {
    if (
      term.type === "optional" || term.type === "multiple" ||
      term.type === "sequence"
    ) {
      const found = leafTerm(term.terms);
      if (found != null) return found;
    } else return term;
  }
  return undefined;
}
function staticDefault(parser: object, value: unknown): Message | undefined {
  const node = getDocNode(parser);
  if (node == null) return undefined;
  if (node.kind !== "leaf") {
    const preservesValue = node.kind === "command" || node.kind === "or" ||
      node.kind === "optional" || node.kind === "default";
    return preservesValue && node.children?.length === 1
      ? staticDefault(node.children[0], value)
      : undefined;
  }
  if (node.boolean && typeof value === "boolean") {
    return [{ type: "text", text: String(value) }];
  }
  const metadata = node.valueParser == null
    ? undefined
    : getDocValue(node.valueParser);
  if (
    metadata == null || metadata.canFormatDefault === false ||
    typeof value !== metadata.kind
  ) return undefined;
  if (
    typeof value !== "string" && typeof value !== "number" &&
    typeof value !== "bigint"
  ) return undefined;
  return [{
    type: "text",
    text: metadata.preserveNegativeZero && Object.is(value, -0)
      ? "-0"
      : String(value),
  }];
}
function fragmentsEntries(
  fragments: readonly DocFragment[],
): readonly DocEntry[] {
  return fragments.flatMap((fragment) =>
    fragment.type === "entry" ? [fragment] : fragment.entries
  );
}
function defaultFragments(
  fragments: readonly DocFragment[],
  value: Message,
): readonly DocFragment[] {
  return fragments.map((fragment) =>
    fragment.type === "entry" ? { ...fragment, default: value } : {
      ...fragment,
      entries: fragment.entries.map((entry) => ({
        ...entry,
        default: value,
      })),
    }
  );
}
function sections(fragments: readonly DocFragment[]): readonly DocSection[] {
  const result: { title?: string; entries: DocEntry[] }[] = [];
  const named = new Map<string | undefined, DocEntry[]>();
  for (const fragment of deduplicateDocFragments(fragments)) {
    const title = fragment.type === "entry" ? undefined : fragment.title;
    let entries = named.get(title);
    if (entries == null) {
      entries = [];
      named.set(title, entries);
      result.push({ title, entries });
    }
    entries.push(
      ...(fragment.type === "entry" ? [fragment] : fragment.entries).map(
        cloneDocEntry,
      ),
    );
  }
  return result;
}

// Public pages contain data, not command usage callbacks or hidden aliases.
function publicUsage(usage: Usage): Usage {
  return usage.map((term): UsageTerm => {
    if (term.type === "command") {
      return {
        type: "command",
        name: term.name,
        ...(term.hidden != null && { hidden: term.hidden }),
      };
    }
    if (term.type === "exclusive") {
      return { ...term, terms: term.terms.map(publicUsage) };
    }
    if (
      term.type === "optional" || term.type === "multiple" ||
      term.type === "sequence"
    ) return { ...term, terms: publicUsage(term.terms) };
    return cloneUsageTerm(term);
  });
}
function docHidden(
  entry: CommandDocPage,
  entries: ReadonlyMap<string, CommandDocPage>,
): boolean {
  for (let length = 1; length <= entry.path.length; length++) {
    if (isDocHidden(entries.get(key(entry.path.slice(0, length)))?.hidden)) {
      return true;
    }
  }
  return false;
}

/**
 * Collects documentation through core-owned constructor metadata, without
 * parsing, defaults, normalization, validators, sources, suggestions, handlers,
 * or custom parser/value-parser documentation/formatting methods.
 *
 * Supported constructors are command/or/object/seq, option/flag/argument,
 * optional/multiple/withDefault; safe value metadata comes from string/integer/
 * choice. Unregistered wrappers are opaque. Custom value parsers retain only
 * enclosing primitive metadata captured at construction. Function defaults are
 * omitted unless withDefault supplies a documentation message. Unsupported
 * static default formatting is reported instead of evaluated.
 *
 * Imports and definition/page construction remain application-owned and are
 * not sandboxed. Supply inert definitions separately from executable startup.
 *
 * @param parser The parser definition to document.
 * @param options Strictness and author-supplied page/subtree replacements.
 * @returns Canonical pages and explicit unresolved scopes for the user parser.
 * @throws {DocPageCollectionError} If strict mode finds unresolved scopes.
 * @throws {TypeError} If supplied paths/aliases are invalid or ambiguous,
 * or supplied canonical paths are duplicated.
 * @since 1.4.0
 */
export function collectDocPages<M extends Mode, T, S>(
  parser: Parser<M, T, S>,
  options: DocPageCollectionOptions = {},
): DocPageCollectionResult {
  const discovered = new Map<
    string,
    { readonly path: readonly string[]; readonly node?: DocNode }
  >([["[]", { path: [] }]]);
  const reports = new Map<string, DocPageCollectionGap>();
  const report = (
    path: readonly string[],
    scope: DocPageCollectionGap["scope"],
    reason: DocPageCollectionGap["reason"],
  ) => {
    const gap = { path: [...path], scope, reason };
    reports.set(JSON.stringify(gap), gap);
  };
  function enumerate(input: object, path: readonly string[]): void {
    const node = getDocNode(input);
    if (node == null) {
      report(path, "subtree", "unregistered-parser");
      return;
    }
    if (isDocHidden(node.hidden)) return;
    if (ambiguousSequence(node)) {
      report(path, "subtree", "ambiguous-command-path");
      return;
    }
    if (node.kind === "command") {
      if (isDocHidden(node.hidden)) return;
      const childPath = [...path, node.name!];
      const pathKey = key(childPath);
      if (discovered.has(pathKey)) {
        report(childPath, "subtree", "ambiguous-command-path");
      } else discovered.set(pathKey, { path: childPath, node });
      enumerate(node.children![0], childPath);
    } else for (const child of node.children ?? []) enumerate(child, path);
  }
  enumerate(parser, []);
  function project(
    input: object,
    target: readonly string[],
    path: readonly string[],
    pagePath: readonly string[],
  ): Projection {
    const node = getDocNode(input);
    if (node == null) {
      report(path, "subtree", "unregistered-parser");
      if (key(path) !== key(pagePath)) {
        report(pagePath, "page", "unregistered-parser");
      }
      return { ...emptyProjection, unresolvedUsage: true };
    }
    if (isDocHidden(node.hidden)) {
      return { ...emptyProjection, usage: node.usage };
    }
    if (ambiguousSequence(node)) {
      report(path, "subtree", "ambiguous-command-path");
      if (key(path) !== key(pagePath)) {
        report(pagePath, "page", "ambiguous-command-path");
      }
      return { ...emptyProjection, unresolvedUsage: true };
    }
    if (node.kind === "leaf") {
      const term = leafTerm(node.usage);
      if (term == null || ("hidden" in term && isDocHidden(term.hidden))) {
        return { ...emptyProjection, usage: node.usage };
      }
      const metadata = node.valueParser == null
        ? undefined
        : getDocValue(node.valueParser);
      if (node.valueParser != null && metadata == null) {
        report(pagePath, "page", "value-metadata-unavailable");
      }
      const choices: Message | undefined = metadata?.choices == null
        ? undefined
        : [{
          type: "text",
          text: metadata.choices.map((value) =>
            metadata.preserveNegativeZero && Object.is(value, -0)
              ? "-0"
              : String(value)
          ).join(", "),
        }];
      return {
        usage: node.usage,
        fragments: [{
          type: "entry",
          term,
          description: node.description,
          choices,
        }],
      };
    }
    if (node.kind === "command") {
      if (isDocHidden(node.hidden)) {
        return { ...emptyProjection, usage: node.usage };
      }
      if (target.length === 0) {
        return {
          usage: node.usage,
          fragments: [{
            type: "entry",
            term: {
              type: "command",
              name: node.name!,
              aliases: node.aliases,
              hidden: node.hidden,
            },
            description: node.brief ?? node.description,
            showAliases: node.showAliases,
          }],
        };
      }
      if (target[0] !== node.name) return emptyProjection;
      const selected = project(node.children![0], target.slice(1), [
        ...path,
        node.name!,
      ], pagePath);
      let usage = selected.usage;
      let unresolvedUsage = selected.unresolvedUsage;
      if (target.length === 1 && node.usageLine != null) {
        if (typeof node.usageLine === "function") {
          report([...path, node.name!], "page", "functional-usage");
          unresolvedUsage = true;
        } else {
          usage = node.usageLine;
          unresolvedUsage = false;
        }
      }
      const pathTerm: UsageTerm = { type: "command", name: node.name! };
      return {
        ...selected,
        usage: [pathTerm, ...usage],
        pathTerms: [pathTerm, ...selected.pathTerms ?? []],
        unresolvedUsage,
        brief: selected.brief ?? node.brief,
        description: selected.description ?? node.description,
        footer: selected.footer ?? node.footer,
        showUsage: selected.showUsage ?? node.showUsage,
      };
    }
    if (
      node.kind === "optional" || node.kind === "multiple" ||
      node.kind === "default"
    ) {
      const inner = project(node.children![0], target, path, pagePath);
      if (node.kind === "default") {
        const usage: Usage = [{ type: "optional", terms: inner.usage }];
        if (node.defaultMessage != null) {
          return {
            ...inner,
            usage,
            fragments: defaultFragments(inner.fragments, node.defaultMessage),
          };
        }
        if (
          typeof node.defaultValue !== "function" &&
          fragmentsEntries(inner.fragments).length > 0
        ) {
          const formatted = staticDefault(node.children![0], node.defaultValue);
          if (formatted != null) {
            return {
              ...inner,
              usage,
              fragments: defaultFragments(inner.fragments, formatted),
            };
          }
          report(pagePath, "page", "static-default-format-unavailable");
        }
        return { ...inner, usage };
      }
      return {
        ...inner,
        usage: [
          node.kind === "optional"
            ? { type: "optional", terms: inner.usage }
            : {
              ...node.usage.find((term) => term.type === "multiple"),
              type: "multiple",
              terms: inner.usage,
              min: node.min ?? 0,
            },
        ],
      };
    }
    const children = node.children ?? [];
    if (node.kind === "or") {
      if (target.length > 0) {
        const selected = children.filter((child) => hasPath(child, target));
        if (selected.length !== 1) {
          report(path, "subtree", "ambiguous-command-path");
          if (key(path) !== key(pagePath)) {
            report(pagePath, "page", "ambiguous-command-path");
          }
          return { ...emptyProjection, unresolvedUsage: true };
        }
        return project(selected[0], target, path, pagePath);
      }
      const projected = children.map((child) =>
        project(child, [], path, pagePath)
      );
      return {
        usage: node.usage,
        fragments: projected.flatMap((child) => child.fragments),
        unresolvedUsage: projected.some((child) => child.unresolvedUsage),
      };
    }
    const projected = children.map((child) =>
      project(child, hasPath(child, target) ? target : [], path, pagePath)
    );
    const fragments = projected.flatMap((child) => child.fragments);
    const pathTerms = projected.flatMap((child) => child.pathTerms ?? []);
    const usage: Usage = node.kind === "seq"
      ? [{ type: "sequence", terms: projected.flatMap((child) => child.usage) }]
      : projected.flatMap((child) => child.usage);
    return {
      usage: node.hidden === "usage" ? hideUsage(usage, pathTerms) : usage,
      pathTerms,
      fragments: node.label == null ? fragments : [
        ...fragments.filter((fragment) =>
          fragment.type === "section" && fragment.title != null
        ),
        {
          type: "section",
          title: node.label,
          entries: fragmentsEntries(
            fragments.filter((fragment) =>
              fragment.type === "entry" || fragment.title == null
            ),
          ),
        },
      ],
      unresolvedUsage: projected.some((child) => child.unresolvedUsage),
      brief: projected.find((child) => child.brief != null)?.brief,
      description: projected.find((child) => child.description != null)
        ?.description,
      footer: projected.find((child) => child.footer != null)?.footer,
      showUsage: projected.find((child) => child.showUsage != null)?.showUsage,
    };
  }
  const entries = new Map<string, CollectedCommandDocPage>();
  for (const { path, node } of discovered.values()) {
    const page = project(parser, path, [], path);
    entries.set(key(path), {
      path,
      aliases: node?.aliases?.filter((alias) =>
        !node.hiddenAliases?.includes(alias)
      ),
      hiddenAliases: node?.hiddenAliases?.slice(),
      hidden: node?.hidden,
      showAliases: node?.showAliases,
      source: "automatic",
      page: {
        usage: page.unresolvedUsage ? undefined : publicUsage(page.usage),
        sections: sections(page.fragments),
        brief: page.brief == null ? undefined : cloneMessage(page.brief),
        description: page.description == null
          ? undefined
          : cloneMessage(page.description),
        footer: page.footer == null ? undefined : cloneMessage(page.footer),
        showUsage: page.showUsage,
      },
    });
  }
  const supplied = new Map<string, SuppliedCommandDocPage>();
  for (const entry of options.entries ?? []) {
    const entryKey = key(entry.path);
    if (supplied.has(entryKey)) {
      throw new TypeError(`Duplicate supplied command path: ${entryKey}`);
    }
    if (entry.aliases?.length || entry.hiddenAliases?.length) {
      validateCommandNames([
        ...entry.aliases ?? [],
        ...entry.hiddenAliases ?? [],
      ], "Documentation alias");
    }
    if (
      entry.path.length === 0 && (
        entry.aliases?.length || entry.hiddenAliases?.length || entry.hidden
      )
    ) {
      throw new TypeError(
        "The root page cannot have aliases or hidden visibility.",
      );
    }
    if (
      entry.coverage != null && entry.coverage !== "page" &&
      entry.coverage !== "subtree"
    ) throw new TypeError("Supplied coverage must be page or subtree.");
    supplied.set(entryKey, entry);
    entries.set(entryKey, {
      ...entries.get(entryKey),
      ...entry,
      path: [...entry.path],
      source: "supplied",
      coverage: entry.coverage ?? "page",
    });
  }
  const visible = [...entries.values()].filter((entry) =>
    !docHidden(entry, entries)
  );
  const unresolved = [...reports.values()].filter((gap) => {
    const enclosing = entries.get(key(gap.path));
    if (enclosing != null && docHidden(enclosing, entries)) return false;
    if (gap.reason === "functional-usage") {
      return supplied.get(key(gap.path))?.page.usage == null;
    }
    // A subtree assertion cannot turn a known incomplete automatic page into
    // authored documentation. Every known affected page needs a replacement.
    if (!supplied.has(key(gap.path))) return true;
    if (gap.scope === "page") return false;
    return ![...supplied.values()].some((entry) =>
      entry.coverage === "subtree" && prefix(entry.path, gap.path)
    );
  });
  const missing = new Map<string, readonly string[]>();
  const spellings = new Map<string, string>();
  for (const entry of entries.values()) {
    if (entry.path.length === 0) continue;
    for (
      const spelling of [
        entry.path.at(-1)!,
        ...entry.aliases ?? [],
        ...entry.hiddenAliases ?? [],
      ]
    ) {
      const spellingKey = key([...entry.path.slice(0, -1), spelling]);
      const previous = spellings.get(spellingKey);
      if (previous != null && previous !== key(entry.path)) {
        throw new TypeError(`Ambiguous command spelling: ${spellingKey}`);
      }
      spellings.set(spellingKey, key(entry.path));
    }
  }
  for (const entry of visible) {
    for (let length = 0; length < entry.path.length; length++) {
      const parent = entry.path.slice(0, length);
      if (!entries.has(key(parent))) missing.set(key(parent), parent);
    }
    for (
      const item of entry.page.sections.flatMap((section) => section.entries)
    ) {
      if (item.term.type !== "command" || isDocHidden(item.term.hidden)) {
        continue;
      }
      const child = [...entry.path, item.term.name];
      if (!entries.has(key(child))) missing.set(key(child), child);
    }
  }
  for (const path of missing.values()) {
    unresolved.push({ path, scope: "page", reason: "missing-command-page" });
  }
  const filtered = visible.map((entry): CollectedCommandDocPage => {
    const pageSections = entry.page.sections.map((section) => ({
      ...section,
      entries: section.entries.filter((item) => {
        if (item.term.type !== "command") return true;
        const target = entries.get(key([...entry.path, item.term.name]));
        return target == null || !docHidden(target, entries);
      }),
    }));
    return pageSections.some((section, index) =>
        section.entries.length !== entry.page.sections[index].entries.length
      )
      ? { ...entry, page: { ...entry.page, sections: pageSections } }
      : entry;
  });
  const result: DocPageCollectionResult = {
    entries: filtered,
    unresolved,
    scope: "parser",
  };
  if ((options.strict ?? true) && unresolved.length > 0) {
    throw new DocPageCollectionError(result);
  }
  return result;
}
