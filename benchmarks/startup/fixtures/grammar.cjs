const { object } = require("@optique/core/constructs");
const { argument, option } = require("@optique/core/primitives");
const { multiple, withDefault } = require("@optique/core/modifiers");
const { choice, string } = require("@optique/core/valueparser");

function start() {
  return object({
    mode: withDefault(option("--mode", choice(["fast", "safe"])), "safe"),
    paths: multiple(argument(string({ metavar: "PATH" }))),
  });
}
function status() {
  return object({
    format: withDefault(option("--format", choice(["text", "json"])), "text"),
  });
}
function set() {
  return object({
    key: argument(choice(["color", "width"])),
    values: multiple(argument(string({ metavar: "VALUE" })), { min: 1 }),
  });
}
const options = {
  programName: "baseline",
  version: "1.0.0",
  help: "both",
  completion: "both",
  colors: false,
  maxWidth: 80,
  showDefault: true,
  showChoices: true,
};

module.exports = { options, set, start, status };
