/**
 * Internal key used to bypass duplicate leading command name validation when
 * composing built-in meta commands with user parsers.
 */
export const allowDuplicateLeadingCommandNamesKey = Symbol(
  "allowDuplicateLeadingCommandNames",
);
