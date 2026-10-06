import type { Usage } from "../usage.ts";

/**
 * Recognizes empty-input routes described by built-in usage terms.
 * @param usage The usage sequence to inspect.
 * @returns Whether the sequence describes an empty-input route.
 * @since 1.0.12
 */
export function acceptsEmptyUsage(usage: Usage): boolean {
  return usage.every((term) => {
    switch (term.type) {
      case "optional":
      case "passthrough":
        return true;
      case "multiple":
        return term.acceptsEmpty ??
          (term.min === 0 || term.min === 1 && producesEmptyItem(term.terms));
      case "exclusive":
        return term.acceptsEmpty ?? term.terms.some(acceptsEmptyUsage);
      default:
        return false;
    }
  });
}

/**
 * Recognizes a zero-token item rather than omission of an optional term.
 * @param usage The usage sequence to inspect.
 * @returns Whether the sequence describes a zero-token item.
 * @since 1.0.12
 */
export function producesEmptyItem(usage: Usage): boolean {
  return usage.every((term) => {
    switch (term.type) {
      case "optional":
        return producesEmptyItem(term.terms);
      case "multiple":
        return term.acceptsEmpty !== false && term.min <= 1 &&
          producesEmptyItem(term.terms);
      case "exclusive":
        return term.acceptsEmpty !== false &&
          term.terms.some(producesEmptyItem);
      default:
        return false;
    }
  });
}
