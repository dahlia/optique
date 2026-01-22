/**
 * Test fixture: Parser with default export (no Program wrapper).
 */
import { object } from "@optique/core/constructs";
import { argument, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { optional } from "@optique/core/modifiers";
import { message } from "@optique/core/message";

export default object({
  input: argument(string({ metavar: "INPUT" }), {
    description: message`Input file to process.`,
  }),
  output: optional(
    option("-o", "--output", string({ metavar: "OUTPUT" }), {
      description: message`Output file path.`,
    }),
  ),
  verbose: optional(
    option("-v", "--verbose", {
      description: message`Enable verbose output.`,
    }),
  ),
  level: optional(
    option("-l", "--level", integer({ min: 0, max: 5 }), {
      description: message`Processing level (0-5).`,
    }),
  ),
});
