// This example demonstrates how to implement positive and negative Boolean
// option pairs commonly found in Linux CLI tools, such as --color and
// --no-color.
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { withDefault } from "@optique/core/modifiers";
import { negatableFlag, option } from "@optique/core/primitives";
import { print, run } from "@optique/run";

function detectColorSupport(): boolean {
  return true;
}

const configParser = object({
  codeFence: withDefault(
    negatableFlag({
      positive: "--code-fence",
      negative: "--no-code-fence",
    }, {
      description: message`Enable or disable Markdown code fences.`,
    }),
    true,
  ),

  lineNumbers: option("--line-numbers"),

  colors: withDefault(
    negatableFlag({
      positive: "--colors",
      negative: "--no-colors",
    }, {
      description: message`Enable or disable colored output.`,
    }),
    () => detectColorSupport(),
    { message: message`auto` },
  ),

  syntax: withDefault(
    negatableFlag({
      positive: "--syntax",
      negative: "--no-syntax",
    }, {
      description: message`Enable or disable syntax highlighting.`,
    }),
    true,
  ),
});

const result = run(configParser);

print(message`Code fences: ${String(result.codeFence)}.`);
print(message`Line numbers: ${String(result.lineNumbers)}.`);
print(message`Colors: ${String(result.colors)}.`);
print(message`Syntax highlighting: ${String(result.syntax)}.`);
