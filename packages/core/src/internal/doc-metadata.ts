/** Constructor-owned documentation snapshots. Not a public extension protocol. */
import { cloneMessage, type Message } from "../message.ts";
import type { HiddenVisibility, Usage, UsageTerm } from "../usage.ts";

/** Static inputs captured by supported constructors. @internal */
export interface DocNodeInput {
  readonly kind:
    | "leaf"
    | "command"
    | "or"
    | "object"
    | "seq"
    | "optional"
    | "multiple"
    | "default";
  readonly children?: readonly object[];
  readonly name?: string;
  readonly aliases?: readonly string[];
  readonly hiddenAliases?: readonly string[];
  readonly showAliases?: boolean;
  readonly showUsage?: boolean;
  readonly hidden?: HiddenVisibility;
  readonly brief?: Message;
  readonly description?: Message;
  readonly footer?: Message;
  readonly usageLine?: Usage | ((usage: Usage) => Usage);
  readonly valueParser?: object;
  readonly choicesRequested?: boolean;
  readonly boolean?: boolean;
  readonly label?: string;
  readonly min?: number;
  readonly defaultValue?: unknown;
  readonly defaultMessage?: Message;
}
/** A constructor snapshot. @internal */
export interface DocNode extends DocNodeInput {
  readonly usage: Usage;
}
const nodes = new WeakMap<object, DocNode>();
/** Safe built-in value formatting facts. @internal */
export interface DocValueMetadata {
  readonly kind: "string" | "number" | "bigint";
  /** Already deduplicated by the constructor, preserving both zero signs. */
  readonly choices?: readonly (string | number)[];
  readonly canFormatDefault?: boolean;
  readonly preserveNegativeZero?: boolean;
}
const values = new WeakMap<object, DocValueMetadata>();

// Usage is readonly constructor data. Reuse captured branches so a wrapper
// retains only its own new nodes instead of another copy of every descendant.
const usageSnapshots = new WeakMap<Usage, Usage>();
const termSnapshots = new WeakMap<UsageTerm, UsageTerm>();

function snapshotUsage(usage: Usage): Usage {
  const existing = usageSnapshots.get(usage);
  if (existing != null) return existing;
  const snapshot = Object.freeze(usage.map(snapshotUsageTerm));
  usageSnapshots.set(usage, snapshot);
  return snapshot;
}

function snapshotUsageTerm(term: UsageTerm): UsageTerm {
  const existing = termSnapshots.get(term);
  if (existing != null) return existing;
  let snapshot: UsageTerm;
  switch (term.type) {
    case "option":
      snapshot = { ...term, names: Object.freeze([...term.names]) };
      break;
    case "command":
      snapshot = {
        ...term,
        ...(term.aliases != null && {
          aliases: Object.freeze([...term.aliases]),
        }),
        ...(term.hiddenAliases != null && {
          hiddenAliases: Object.freeze([...term.hiddenAliases]),
        }),
        ...(term.usageLine != null && typeof term.usageLine !== "function" && {
          usageLine: snapshotUsage(term.usageLine),
        }),
      };
      break;
    case "optional":
    case "sequence":
      snapshot = { type: term.type, terms: snapshotUsage(term.terms) };
      break;
    case "multiple":
      snapshot = {
        type: "multiple",
        terms: snapshotUsage(term.terms),
        min: term.min,
        ...(term.acceptsEmpty != null && { acceptsEmpty: term.acceptsEmpty }),
      };
      break;
    case "exclusive":
      snapshot = {
        type: "exclusive",
        terms: Object.freeze(term.terms.map(snapshotUsage)),
        ...(term.acceptsEmpty != null && { acceptsEmpty: term.acceptsEmpty }),
      };
      break;
    default:
      snapshot = { ...term };
  }
  Object.freeze(snapshot);
  termSnapshots.set(term, snapshot);
  return snapshot;
}
/**
 * Captures only constructor-owned built-in value documentation.
 * @param parser The built-in value parser's final identity.
 * @param metadata Static formatting facts owned by its constructor.
 * @returns The same parser, with private documentation metadata registered.
 * @internal
 */
export function captureDocValue<const T extends object>(
  parser: T,
  metadata: DocValueMetadata,
): T {
  values.set(
    parser,
    Object.freeze({
      ...metadata,
      choices: metadata.choices == null
        ? undefined
        : Object.freeze(metadata.choices.slice()),
    }),
  );
  return parser;
}
/**
 * Captures metadata at the return boundary of a listed built-in constructor.
 * @param parser The supported parser's final identity and static usage.
 * @param metadata Constructor-owned documentation inputs to snapshot.
 * @returns The same parser, with private documentation metadata registered.
 * @internal
 */
export function captureDocParser<T extends { readonly usage: Usage }>(
  parser: T,
  metadata: DocNodeInput,
): T {
  nodes.set(parser, {
    ...metadata,
    brief: metadata.brief == null ? undefined : cloneMessage(metadata.brief),
    description: metadata.description == null
      ? undefined
      : cloneMessage(metadata.description),
    footer: metadata.footer == null ? undefined : cloneMessage(metadata.footer),
    defaultMessage: metadata.defaultMessage == null
      ? undefined
      : cloneMessage(metadata.defaultMessage),
    usageLine:
      typeof metadata.usageLine === "function" || metadata.usageLine == null
        ? metadata.usageLine
        : snapshotUsage(metadata.usageLine),
    children: metadata.children?.slice(),
    aliases: metadata.aliases?.slice(),
    hiddenAliases: metadata.hiddenAliases?.slice(),
    usage: snapshotUsage(parser.usage),
  });
  return parser;
}

/**
 * Reads a core-owned node without consulting the parser object.
 * @param parser A parser identity, including an opaque custom parser.
 * @returns Its captured node, or undefined for an unregistered identity.
 * @internal
 */
export function getDocNode(parser: object): DocNode | undefined {
  return nodes.get(parser);
}
/**
 * Reads core-owned static value documentation.
 * @param parser A value parser identity.
 * @returns Its captured facts, or undefined for an unregistered identity.
 * @internal
 */
export function getDocValue(parser: object): DocValueMetadata | undefined {
  return values.get(parser);
}
