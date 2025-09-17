import { map, or, withDefault } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";

const modeParser = withDefault(
  or(
    map(option("-a", "--mode-a"), () => "a" as const),
    map(option("-b", "--mode-b"), () => "b" as const),
    map(option("-c", "--mode-c"), () => "c" as const),
  ),
  "default" as const,
);

const result = run(modeParser);
print(message`Mode selected: ${result}.`);
