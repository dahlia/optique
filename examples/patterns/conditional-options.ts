import { conditional, object } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";

// Define a parser with conditional options based on the --reporter discriminator
const reporterParser = conditional(
  option("--reporter", choice(["console", "junit", "html", "json"])),
  {
    console: object({
      colors: optional(option("--colors")),
    }),
    junit: object({
      outputFile: option("--output-file", string({ metavar: "FILE" })),
    }),
    html: object({
      outputDir: option("--output-dir", string({ metavar: "DIR" })),
      title: optional(option("--title", string())),
    }),
    json: object({
      pretty: optional(option("--pretty")),
      indent: optional(option("--indent", integer({ min: 0, max: 8 }))),
    }),
  },
);

// Run the parser
const [reporter, config] = run(reporterParser);

// Type-safe pattern matching based on discriminator value
switch (reporter) {
  case "console":
    // TypeScript knows: config is { colors: boolean | undefined }
    print(
      message`Console output with colors: ${String(config.colors ?? true)}`,
    );
    break;
  case "junit":
    // TypeScript knows: config is { outputFile: string }
    print(message`Writing JUnit report to ${config.outputFile}`);
    break;
  case "html":
    // TypeScript knows: config is { outputDir: string, title: string | undefined }
    print(
      message`Writing HTML report to ${config.outputDir}${
        config.title ? ` with title "${config.title}"` : ""
      }`,
    );
    break;
  case "json":
    // TypeScript knows: config is { pretty: boolean | undefined, indent: number | undefined }
    print(
      message`JSON output, pretty: ${String(config.pretty ?? false)}, indent: ${
        String(config.indent ?? 2)
      }`,
    );
    break;
}
