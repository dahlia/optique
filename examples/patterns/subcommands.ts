import { object, optional, or } from "@optique/core/parser";
import { argument, command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";

const addCommand = command(
  "add",
  object({
    action: constant("add"),
    key: argument(string({ metavar: "KEY" })),
    value: argument(string({ metavar: "VALUE" })),
  }),
);

const removeCommand = command(
  "remove",
  object({
    action: constant("remove"),
    key: argument(string({ metavar: "KEY" })),
  }),
);

const editCommand = command(
  "edit",
  object({
    action: constant("edit"),
    key: argument(string({ metavar: "KEY" })),
    value: argument(string({ metavar: "VALUE" })),
  }),
);

const listCommand = command(
  "list",
  object({
    action: constant("list"),
    pattern: optional(
      option("-p", "--pattern", string({ metavar: "PATTERN" })),
    ),
  }),
);

const parser = or(addCommand, removeCommand, editCommand, listCommand);

const result = run(parser, {
  help: "both",
  version: { mode: "both", value: "1.0.0" },
});
print(message`${JSON.stringify(result, null, 2)}`);
