import { object, or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { argument, command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import metadata from "../package.json" with { type: "json" };

/** The version of this private fixture, also recorded in its consumer skill. */
export const version = metadata.version;

/**
 * Creates the fixture parser. The option parameter supports a drift control.
 * @param outputOption The save destination option spelling.
 * @returns A parser with inferred count/save results.
 */
export function createParser(
  outputOption: "--output" | "--destination" = "--output",
) {
  return or(
    command(
      "count",
      object({
        action: constant("count"),
        input: argument(string({ metavar: "INPUT" })),
      }),
      {
        description: message`Count LF-delimited lines from a file or - stdin.`,
      },
    ),
    command(
      "save",
      object({
        action: constant("save"),
        input: argument(string({ metavar: "INPUT" })),
        output: option(outputOption, string({ metavar: "FILE" })),
      }),
      {
        description:
          message`Copy input bytes to a new file without overwriting.`,
      },
    ),
  );
}

/** The application's grammar, excluding runner-provided help and version. */
export const parser = createParser();
