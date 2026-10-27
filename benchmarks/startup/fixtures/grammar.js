import { object } from "@optique/core/constructs";
import { argument, option } from "@optique/core/primitives";
import { multiple, withDefault } from "@optique/core/modifiers";
import { choice, string } from "@optique/core/valueparser";

export function start() {
  return object({
    mode: withDefault(option("--mode", choice(["fast", "safe"])), "safe"),
    paths: multiple(argument(string({ metavar: "PATH" }))),
  });
}
export function status() {
  return object({
    format: withDefault(option("--format", choice(["text", "json"])), "text"),
  });
}
export function set() {
  return object({
    key: argument(choice(["color", "width"])),
    values: multiple(argument(string({ metavar: "VALUE" })), { min: 1 }),
  });
}
export const options = {
  programName: "baseline",
  version: "1.0.0",
  help: "both",
  completion: "both",
  colors: false,
  maxWidth: 80,
  showDefault: true,
  showChoices: true,
};
