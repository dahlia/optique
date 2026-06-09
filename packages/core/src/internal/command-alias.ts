/**
 * Internal key used to bypass duplicate leading command name validation when
 * composing built-in meta commands with user parsers.
 */
export const allowDuplicateLeadingCommandNamesKey = Symbol(
  "allowDuplicateLeadingCommandNames",
);

/**
 * Internal command() option key for aliases that are accepted by parsing but
 * omitted from completion and typo-suggestion display.
 */
export const hiddenCommandAliasesKey = Symbol("hiddenCommandAliases");

/** @internal */
export interface HiddenCommandAliasOptions {
  readonly [hiddenCommandAliasesKey]?: readonly [string, ...string[]];
}
