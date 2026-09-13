import type { Annotations, SourceContext } from "@optique/core/context";

/**
 * Asynchronous source for reading an OS credential-store password.
 *
 * @param service Service name associated with the password.
 * @param username Username associated with the password.
 * @returns The stored password, or `undefined` when no password is available.
 * @throws Propagates credential-store loading and lookup failures unchanged.
 * @since 1.3.0
 */
export type KeyringSource = (
  service: string,
  username: string,
) => Promise<string | undefined>;

/**
 * Options for creating a keyring context.
 *
 * @since 1.3.0
 */
export interface KeyringContextOptions {
  /** Custom password source, primarily for alternate backends and tests. */
  readonly source?: KeyringSource;
}

/**
 * Context that provides an asynchronous keyring source to bound parsers.
 *
 * @since 1.3.0
 */
export interface KeyringContext extends SourceContext {
  /** Password source captured by this context. */
  readonly source: KeyringSource;
}

async function defaultKeyringSource(
  service: string,
  username: string,
): Promise<string | undefined> {
  const { AsyncEntry } = await import("@napi-rs/keyring");
  return await new AsyncEntry(service, username).getPassword() ?? undefined;
}

function getTypeName(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/**
 * Creates a single-pass context for keyring-backed parser fallbacks.
 *
 * The selected source is snapshotted into parse annotations. Creating the
 * context and collecting its annotations never reads the credential store.
 *
 * @param options Optional custom source configuration.
 * @returns A keyring context with a unique annotation identity.
 * @throws {TypeError} If `source` is present but is not a function.
 * @since 1.3.0
 */
export function createKeyringContext(
  options: KeyringContextOptions = {},
): KeyringContext {
  const rawSource = options.source;
  if (rawSource !== undefined && typeof rawSource !== "function") {
    throw new TypeError(
      `Expected source to be a function, but got: ${getTypeName(rawSource)}.`,
    );
  }
  const source = rawSource ?? defaultKeyringSource;
  const contextId = Symbol(`@optique/keyring context:${Math.random()}`);

  return {
    id: contextId,
    source,
    phase: "single-pass",
    getAnnotations(): Annotations {
      return { [contextId]: { source } };
    },
    [Symbol.dispose]() {},
  };
}
