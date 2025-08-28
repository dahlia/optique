import { map, option, or, withDefault } from "@optique/core/parser";
import { run } from "@optique/run";

const modeParser = withDefault(
  or(
    map(option("-a", "--mode-a"), () => "a" as const),
    map(option("-b", "--mode-b"), () => "b" as const),
    map(option("-c", "--mode-c"), () => "c" as const),
  ),
  "default" as const,
);

const mode = run(modeParser);
console.log(mode);
