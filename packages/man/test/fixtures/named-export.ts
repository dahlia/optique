/**
 * Test fixture: Named export (no default export).
 */
import { defineProgram } from "@optique/core/program";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { optional } from "@optique/core/modifiers";
import { message } from "@optique/core/message";

export const myProgram = defineProgram({
  parser: object({
    config: optional(
      option("-c", "--config", string({ metavar: "FILE" }), {
        description: message`Configuration file path.`,
      }),
    ),
  }),
  metadata: {
    name: "named-app",
    version: "2.0.0",
    brief: message`An app with named export`,
  },
});

export const anotherProgram = defineProgram({
  parser: object({
    debug: optional(
      option("-d", "--debug", {
        description: message`Enable debug mode.`,
      }),
    ),
  }),
  metadata: {
    name: "another-app",
    version: "1.0.0",
    brief: message`Another program`,
  },
});
