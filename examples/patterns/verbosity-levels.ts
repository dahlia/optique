// This example demonstrates how to implement verbosity levels using repeated
// flags, e.g., -v, -vv, -vvv, etc., to set different levels of verbosity.
import { map, multiple, object, option } from "@optique/core/parser";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";

const VERBOSITY_LEVELS = ["debug", "info", "warning", "error"] as const;

const verbosityParser = object({
  verbosity: map(
    multiple(option("-v", "--verbose")),
    (v) =>
      VERBOSITY_LEVELS.at(
        -Math.min(v.length, VERBOSITY_LEVELS.length - 1) - 1,
      )!,
  ),
});

const result = run(verbosityParser);
print(message`Verbosity level: ${result.verbosity}.`);
