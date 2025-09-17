// This example demonstrates how to implement --no- prefix boolean options
// commonly found in Linux CLI tools, where --no-option negates a default
// behavior.
import { map } from "@optique/core/modifiers";
import { object } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { run } from "@optique/run";

const configParser = object({
  // Code fence is enabled by default, --no-code-fence disables it
  codeFence: map(option("--no-code-fence"), (o) => !o),

  // Line numbers are disabled by default, --line-numbers enables it
  lineNumbers: option("--line-numbers"),

  // Colors are enabled by default, --no-colors disables them
  colors: map(option("--no-colors"), (o) => !o),

  // Syntax highlighting is enabled by default, --no-syntax disables it
  syntax: map(option("--no-syntax"), (o) => !o),
});

const result = run(configParser);

console.log(result);
