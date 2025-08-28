import {
  argument,
  command,
  constant,
  object,
  option,
  optional,
  or,
} from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
import { run } from "@optique/run";

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

const result = run(parser, { help: "both" });
console.log(result);
