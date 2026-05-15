import { object } from "@optique/core/constructs";
import { message, text } from "@optique/core/message";
import { withDefault } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { defineCommand } from "@optique/discover/command";
import { print } from "@optique/run";

export default defineCommand({
  parser: object({
    target: withDefault(
      option("--target", string({ metavar: "TARGET" }), {
        description: message`Build target`,
      }),
      "app",
    ),
  }),
  metadata: {
    brief: message`Build the project.`,
  },
  handler(value) {
    print(message`Building ${text(value.target)}.`);
  },
});
