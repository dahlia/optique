import type { DocFragments } from "../doc.ts";
import type { Message } from "../message.ts";
import {
  type CommandUsageId,
  type CommandUsageScope,
  scopeCommandUsageId,
} from "./command-usage.ts";

const selectedCommandUsage = new WeakMap<
  CommandDocMetadata,
  readonly CommandUsageId[]
>();

/** Reads command occurrences selected by final parser state. @internal */
export function getSelectedCommandUsage(
  metadata: CommandDocMetadata | undefined,
): readonly CommandUsageId[] {
  return metadata == null ? [] : selectedCommandUsage.get(metadata) ?? [];
}

/** Attaches selection without adding public metadata properties. @internal */
export function withSelectedCommandUsage(
  metadata: CommandDocMetadata | undefined,
  selected: readonly CommandUsageId[],
): CommandDocMetadata {
  const result = withOrigin(metadata ?? {}, metadata?.origin ?? "entry");
  selectedCommandUsage.set(result, selected);
  return result;
}

/** Maps selected commands to the same child scope as its usage. @internal */
export function scopeCommandDocMetadata(
  metadata: CommandDocMetadata | undefined,
  scope: CommandUsageScope,
): CommandDocMetadata | undefined {
  return metadata == null ? undefined : withSelectedCommandUsage(
    metadata,
    getSelectedCommandUsage(metadata).map((id) =>
      scopeCommandUsageId(scope, id)
    ),
  );
}

/**
 * Page metadata from a selected command, rather than an option entry.
 * Origin survives empty payloads. Custom page fields become command metadata
 * only when they occur within a selected command.
 */
export interface CommandDocMetadata {
  /** Built-in empty payloads default to entry documentation. */
  readonly origin?: "entry" | "custom" | "command";
  readonly brief?: Message;
  readonly description?: Message;
  readonly footer?: Message;
}

// Keep provenance out of public spreads as well as equality/serialization.
function withOrigin(
  metadata: CommandDocMetadata,
  origin: NonNullable<CommandDocMetadata["origin"]>,
): CommandDocMetadata {
  const result = { ...metadata };
  selectedCommandUsage.set(result, getSelectedCommandUsage(metadata));
  Object.defineProperty(result, "origin", { value: origin, enumerable: false });
  return result;
}

// Non-enumerable so public fragments keep their existing equality/serialization
// behavior.  Wrappers that rebuild fragments explicitly preserve the provenance.
const commandDocMetadata: unique symbol = Symbol.for(
  "@optique/core/commandDocMetadata",
);
type CommandDocFragments = DocFragments & {
  readonly [commandDocMetadata]?: CommandDocMetadata;
};

// Object spread preserves the fragments array.  Carry a snapshot there as well,
// without making either symbol enumerable or mutating a child's array.
const commandDocCarrier: unique symbol = Symbol.for(
  "@optique/core/commandDocMetadataCarrier",
);
interface CommandDocCarrier extends CommandDocMetadata {
  readonly metadata: CommandDocMetadata;
}
type CommandDocFragmentList = DocFragments["fragments"] & {
  readonly [commandDocCarrier]?: CommandDocCarrier;
};

/**
 * Reads effective page metadata, including custom collection-level fields.
 * @param docs The child's documentation.
 * @returns Its selected-command metadata, if any.
 */
export function getCommandDocMetadata(
  docs: DocFragments,
): CommandDocMetadata | undefined {
  const carrier = (docs.fragments as CommandDocFragmentList)[commandDocCarrier];
  if (carrier != null) {
    // A decorator can replace or remove one public field without discarding
    // provenance for the others.  Unchanged entry descriptions stay excluded.
    const brief = docs.brief === carrier.brief
      ? carrier.metadata.brief
      : docs.brief;
    const origin = carrier.metadata.origin ?? "entry";
    const customPage = origin === "entry" &&
      (docs.brief !== carrier.brief || docs.footer !== carrier.footer);
    const description = (origin === "entry" && !customPage) ||
        docs.description === carrier.description
      ? carrier.metadata.description
      : docs.description;
    const footer = docs.footer === carrier.footer
      ? carrier.metadata.footer
      : docs.footer;
    return withSelectedCommandUsage(
      withOrigin({
        ...(brief == null ? {} : { brief }),
        ...(description == null ? {} : { description }),
        ...(footer == null ? {} : { footer }),
      }, customPage ? "custom" : origin),
      getSelectedCommandUsage(carrier.metadata),
    );
  }
  const metadata = (docs as CommandDocFragments)[commandDocMetadata];
  if (metadata != null) return metadata;
  // Custom parsers use the public collection-level fields as page metadata.
  // Built-in entry documentation supplies an explicit empty payload instead.
  return docs.brief != null || docs.description != null || docs.footer != null
    ? withOrigin({
      brief: docs.brief,
      description: docs.description,
      footer: docs.footer,
    }, "custom")
    : undefined;
}

/**
 * Preserves selected-command metadata when rebuilding documentation fragments.
 * @param docs The rebuilt documentation.
 * @param metadata The selected-command metadata to preserve.
 * @returns Documentation with the internal metadata attached.
 */
export function withCommandDocMetadata(
  docs: DocFragments,
  metadata: CommandDocMetadata | undefined,
): DocFragments {
  if (metadata == null) return docs;
  metadata = withOrigin(metadata, metadata.origin ?? "entry");
  const fragments = [...docs.fragments];
  Object.defineProperty(fragments, commandDocCarrier, {
    value: {
      metadata,
      brief: docs.brief,
      description: docs.description,
      footer: docs.footer,
    },
  });
  const result: DocFragments = { ...docs, fragments };
  Object.defineProperty(result, commandDocMetadata, { value: metadata });
  return result;
}

/**
 * Collects selected-command metadata in documentation traversal order.
 * @param current Metadata from earlier children.
 * @param docs The next child's documentation.
 * @param includeCustom Whether to retain custom page fields inside merge().
 * @returns The first defined value from children with the same origin.
 */
function collectCommandPageMetadata(
  current: CommandDocMetadata | undefined,
  docs: DocFragments,
  includeCustom = false,
): CommandDocMetadata | undefined {
  const next = getCommandDocMetadata(docs);
  if (next == null) return current;
  const origin = next.origin ?? "entry";
  if (origin === "entry" || (origin === "custom" && !includeCustom)) {
    return current ?? withOrigin({}, "entry");
  }
  // A selected command wins over unrelated custom collection fields, regardless
  // of traversal order. Custom fields remain usable within command(merge(...)).
  if (current?.origin === "command" && origin !== "command") return current;
  if (current?.origin !== origin) current = undefined;
  const brief = current?.brief ?? next.brief;
  const description = current?.description ?? next.description;
  const footer = current?.footer ?? next.footer;
  return withOrigin({
    ...(brief == null ? {} : { brief }),
    ...(description == null ? {} : { description }),
    ...(footer == null ? {} : { footer }),
  }, origin);
}

/** Collects page fields and all selected command occurrences. @internal */
export function collectCommandDocMetadata(
  current: CommandDocMetadata | undefined,
  docs: DocFragments,
  includeCustom = false,
  scope?: CommandUsageScope,
): CommandDocMetadata | undefined {
  const next = getCommandDocMetadata(docs);
  const selected = getSelectedCommandUsage(next);
  const result = collectCommandPageMetadata(current, docs, includeCustom);
  const combined = [
    ...getSelectedCommandUsage(current),
    ...(scope == null
      ? selected
      : selected.map((id) => scopeCommandUsageId(scope, id))),
  ];
  return combined.length === 0
    ? result
    : withSelectedCommandUsage(result, combined);
}
