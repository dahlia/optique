/**
 * Test fixture: File with no default export.
 */
import { defineProgram } from "@optique/core/program";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { optional } from "@optique/core/modifiers";
import { message } from "@optique/core/message";

// Only named exports, no default export
export const firstProgram = defineProgram({
  parser: object({
    verbose: optional(
      option("-v", "--verbose", {
        description: message`Enable verbose output.`,
      }),
    ),
  }),
  metadata: {
    name: "first",
    version: "1.0.0",
    brief: message`First program`,
  },
});

export const secondProgram = defineProgram({
  parser: object({
    quiet: optional(
      option("-q", "--quiet", {
        description: message`Enable quiet mode.`,
      }),
    ),
  }),
  metadata: {
    name: "second",
    version: "2.0.0",
    brief: message`Second program`,
  },
});
