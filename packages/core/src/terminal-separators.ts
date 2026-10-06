import type { TerminalFragment } from "./terminal.ts";

/**
 * Text fragments that only separate the items around them, such as the
 * spaces the default `values` formatter puts between values.  When message
 * wrapping moves such a fragment to the start of a new line, its leading
 * whitespace may be dropped.
 * @internal
 */
export const wrapTrimmableFragments: WeakSet<TerminalFragment> = new WeakSet();
