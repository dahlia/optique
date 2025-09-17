// This example demonstrates how to use group() to organize mutually exclusive
// options under a labeled section in help output while maintaining clean code.
import { map, withDefault } from "@optique/core/modifiers";
import { group, or } from "@optique/core/parser";
import { flag } from "@optique/core/primitives";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";

const formatParser = withDefault(
  group(
    "Formatting options",
    or(
      map(
        flag("--json", { description: message`Use JSON format.` }),
        () => "json" as const,
      ),
      map(
        flag("--yaml", { description: message`Use YAML format.` }),
        () => "yaml" as const,
      ),
      map(
        flag("--toml", { description: message`Use TOML format.` }),
        () => "toml" as const,
      ),
      map(
        flag("--xml", { description: message`Use XML format.` }),
        () => "xml" as const,
      ),
    ),
  ),
  "json" as const,
);

const result = run(formatParser, { help: "option" });
print(message`Output format: ${result}.`);
