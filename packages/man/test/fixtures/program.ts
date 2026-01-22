/**
 * Test fixture: Program with default export.
 */
import { defineProgram } from "@optique/core/program";
import { object } from "@optique/core/constructs";
import { argument, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { optional, withDefault } from "@optique/core/modifiers";
import { message } from "@optique/core/message";

export default defineProgram({
  parser: object({
    name: argument(string({ metavar: "NAME" }), {
      description: message`The name to greet.`,
    }),
    count: withDefault(
      option("-c", "--count", integer({ min: 1 }), {
        description: message`Number of times to repeat the greeting.`,
      }),
      1,
    ),
    loud: optional(
      option("-l", "--loud", {
        description: message`Print greeting in uppercase.`,
      }),
    ),
  }),
  metadata: {
    name: "greet",
    version: "1.0.0",
    brief: message`A friendly greeting program`,
    description: message`This program greets the specified person.
You can customize the greeting with various options.`,
    author: message`Test Author <test@example.com>`,
    examples: message`Basic usage:

  greet Alice

Greet multiple times:

  greet Alice --count 3

Loud greeting:

  greet Bob -l`,
    bugs: message`Report bugs to: https://example.com/issues`,
  },
});
