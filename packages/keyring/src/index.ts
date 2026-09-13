/**
 * OS credential-store fallback support for Optique.
 *
 * @module
 * @since 1.3.0
 */

export {
  createKeyringContext,
  type KeyringContext,
  type KeyringContextOptions,
  type KeyringSource,
} from "./context.ts";
export { bindKeyring, type BindKeyringOptions } from "./parser.ts";
