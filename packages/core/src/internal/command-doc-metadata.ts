import type { DocFragments } from "../doc.ts";
import type { Message } from "../message.ts";

/** Page metadata from a selected command, rather than an option entry. */
export interface CommandDocMetadata {
  readonly brief?: Message;
  readonly description?: Message;
  readonly footer?: Message;
}

// Non-enumerable so public fragments keep their existing equality/serialization
// behavior.  Wrappers that rebuild fragments explicitly preserve the provenance.
const commandDocMetadata: unique symbol = Symbol("commandDocMetadata");
type CommandDocFragments = DocFragments & {
  readonly [commandDocMetadata]?: CommandDocMetadata;
};

/**
 * Reads selected-command metadata attached by this module.
 * @param docs The child's documentation.
 * @returns Its selected-command metadata, if any.
 */
export function getCommandDocMetadata(
  docs: DocFragments,
): CommandDocMetadata | undefined {
  return (docs as CommandDocFragments)[commandDocMetadata];
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
  const result: DocFragments = { ...docs };
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
