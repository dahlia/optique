// This example demonstrates how to use group() to organize mutually exclusive
// options under a labeled section in help output while maintaining clean code.
import { group, map, or, withDefault } from "@optique/core/parser";
import { flag } from "@optique/core/parser";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";

const formatParser = withDefault(
  group(
    "Formatting options",
    or(
      map(flag("--json"), () => "json" as const),
      map(flag("--yaml"), () => "yaml" as const),
      map(flag("--toml"), () => "toml" as const),
      map(flag("--xml"), () => "xml" as const),
    ),
  ),
  "json" as const,
);

const result = run(formatParser, { help: "option" });
print(message`Output format: ${result}.`);
