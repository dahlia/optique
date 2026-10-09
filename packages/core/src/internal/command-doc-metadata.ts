import type { DocFragments } from "../doc.ts";
import type { Message } from "../message.ts";

/**
 * Page metadata from a selected command, rather than an option entry.
 * An empty payload marks built-in entry documentation with no page metadata;
 * unmarked custom documentation retains its public page metadata contract.
 */
export interface CommandDocMetadata {
  readonly brief?: Message;
  readonly description?: Message;
  readonly footer?: Message;
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
 * Reads selected-command metadata attached by this module.
 * @param docs The child's documentation.
 * @returns Its selected-command metadata, if any.
 */
export function getCommandDocMetadata(
  docs: DocFragments,
): CommandDocMetadata | undefined {
  const metadata = (docs as CommandDocFragments)[commandDocMetadata];
  if (metadata != null) return metadata;
  const carrier = (docs.fragments as CommandDocFragmentList)[commandDocCarrier];
  // Reusing an array while replacing public page fields defines new custom
  // documentation; do not let the previous snapshot override those fields.
  return carrier != null && carrier.brief === docs.brief &&
      carrier.description === docs.description && carrier.footer === docs.footer
    ? carrier.metadata
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
 * @returns The first defined value for each page metadata field.
 */
export function collectCommandDocMetadata(
  current: CommandDocMetadata | undefined,
  docs: DocFragments,
): CommandDocMetadata | undefined {
  const next = getCommandDocMetadata(docs);
  if (next == null) return current;
  const brief = current?.brief ?? next.brief;
  const description = current?.description ?? next.description;
  const footer = current?.footer ?? next.footer;
  return {
    ...(brief == null ? {} : { brief }),
    ...(description == null ? {} : { description }),
    ...(footer == null ? {} : { footer }),
  };
}
