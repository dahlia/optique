import { longestMatch, object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { nonEmpty, optional, withDefault } from "@optique/core/modifiers";
import { constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { print, run } from "@optique/run";

// This example demonstrates how to use nonEmpty() with longestMatch() to
// implement conditional default values. The use case is:
//
//   cli dev         → Show help (no options provided)
//   cli dev --key X → Run development server with options
//
// Without nonEmpty(), the activeParser would always win because it consumes
// 0 tokens with all defaults.

// activeParser: Requires at least one option to be provided
const activeParser = nonEmpty(object({
  mode: constant("active" as const),
  cwd: withDefault(
    option("--cwd", string(), {
      description: message`Working directory`,
    }),
    "./",
  ),
  key: optional(
    option("--key", string(), {
      description: message`API key for the service`,
    }),
  ),
}));

// helpParser: Falls back to help mode when no options are provided
const helpParser = object({
  mode: constant("help" as const),
});

const parser = longestMatch(activeParser, helpParser);

const result = run(parser);

if (result.mode === "help") {
  print(message`No options provided. Running in help mode.`);
  print(message`Usage: cli dev --key <KEY> [--cwd <DIR>]`);
} else {
  print(message`Running in active mode.`);
  print(message`  Working directory: ${result.cwd}`);
  if (result.key) {
    print(message`  API key: ${result.key}`);
  } else {
    print(message`  API key: (not provided)`);
  }
}
