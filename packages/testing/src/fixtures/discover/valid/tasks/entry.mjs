import { argument } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { defineCommand } from "@optique/discover";

export default defineCommand({
  parser: argument(string()),
  handler(value, context) {
    context.resource.push(value);
  },
});
