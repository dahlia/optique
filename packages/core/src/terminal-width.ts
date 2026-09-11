import { formatTerminalTerm, fragmentTokens } from "./terminal-internal.ts";
import type { TerminalTheme } from "./terminal.ts";
import { measureText } from "./text-layout.ts";
import { formatUsageTerm, type Usage } from "./usage.ts";

const automaticWidth = Symbol.for("@optique/core/automaticWidth");

/**
 * Marks runner options without changing their public type. The enumerable
 * symbol survives the option copies made by Program and context runners.
 * @param options The options whose width was automatically detected.
 * @param onResolved Receives the effective width before message rendering.
 * @returns A marked copy of the options.
 * @internal
 */
export function withAutomaticWidth<T extends object>(
  options: T,
  onResolved: (width: number | undefined) => void = () => {},
): T {
  return { ...options, [automaticWidth]: onResolved };
}

/**
 * Checks whether a width is a runner hint rather than an explicit constraint.
 * @param options The formatting or runner options.
 * @returns Whether automatic width fallback is enabled.
 * @internal
 */
export function hasAutomaticWidth(options: object): boolean {
  return automaticWidth in options &&
    typeof options[automaticWidth] === "function";
}

/**
 * Reports the resolved width before any opaque message formatter runs.
 * @param options The marked formatting options.
 * @param width The width selected by layout validation.
 * @internal
 */
export function reportAutomaticWidth(
  options: object,
  width: number | undefined,
): void {
  if (
    automaticWidth in options && typeof options[automaticWidth] === "function"
  ) {
    options[automaticWidth](width);
  }
}

/**
 * Measures the minimum usage layout, allowing long atomic terms to overflow.
 * @param programName The program name shown in the usage line.
 * @param usage The visible usage tree.
 * @param label The rendered usage label, including its trailing space.
 * @param theme The semantic terminal theme.
 * @returns The minimum feasible width for the usage block.
 * @internal
 */
export function minimumUsageWidth(
  programName: string,
  usage: Usage,
  label: string,
  theme?: TerminalTheme,
): number {
  const labelWidth = measureText(label).lastLineWidth;
  const programWidth = Math.max(
    0,
    ...[
      ...fragmentTokens(
        formatTerminalTerm({ type: "programName", programName }, theme),
      ),
    ].map((token) => token.width),
  );
  const atomicWidth = usage.reduce((widest, term) =>
    Math.max(
      widest,
      measureText(formatUsageTerm(term, { theme, maxWidth: 1 })).maxLineWidth,
    ), 0);
  return Math.max(
    measureText(label).maxLineWidth,
    labelWidth +
      Math.max(programWidth, Math.min(atomicWidth, programWidth + labelWidth)),
  );
}
