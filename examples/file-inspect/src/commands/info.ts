import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { argument } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { defineCommand, type ProgramHookContext } from "@optique/discover";
import type { InputScope } from "../input.ts";

/** A statically registered command whose handler input is inferred. */
export const info = defineCommand({
  path: ["file", "info"],
  metadata: { brief: message`Report a local file's path and size in bytes.` },
  parser: object({
    path: argument(string({
      metavar: "PATH",
      pattern: /^(?!-$).+$/s,
      errors: {
        patternMismatch:
          message`Expected a nonempty file path; stdin (-) is not supported.`,
      },
    })),
  }),
  async handler(value, context?: ProgramHookContext<InputScope>) {
    const scope = context?.resource;
    if (scope == null) throw new TypeError("Input resource is missing.");
    const input = await scope.open(value.path);
    if (input.kind !== "file") throw new TypeError("Expected a file input.");
    scope.write(
      JSON.stringify({
        path: value.path,
        bytes: (await input.handle.stat()).size,
      }),
    );
  },
});
