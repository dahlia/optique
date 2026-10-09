import type { DocFragments } from "../doc.ts";
import type { Message } from "../message.ts";

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
    return withOrigin({
      ...(brief == null ? {} : { brief }),
      ...(description == null ? {} : { description }),
      ...(footer == null ? {} : { footer }),
    }, customPage ? "custom" : origin);
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
export function collectCommandDocMetadata(
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
