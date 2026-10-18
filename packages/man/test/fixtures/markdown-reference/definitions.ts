import { object, or } from "@optique/core/constructs";
import { map, multiple, withDefault } from "@optique/core/modifiers";
import { argument, command, constant, option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";

export const parser = object({
  verbose: option("-v", "--verbose"),
  action: or(
    map(
      command(
        "serve",
        object({
          port: withDefault(
            option("--port", integer({ metavar: "PORT" })),
            8080,
          ),
          tags: multiple(option("--tag", string({ metavar: "TAG" }))),
        }),
      ),
      (value) => ({ type: "serve" as const, ...value }),
    ),
    command(
      "config",
      or(
        map(
          command(
            "get",
            multiple(argument(string({ metavar: "KEY" })), { min: 1 }),
            { aliases: ["g", "old-get"] },
          ),
          (keys) => ({ type: "get" as const, keys }),
        ),
        map(
          command(
            "set",
            object({
              key: argument(string({ metavar: "KEY" })),
              format: withDefault(
                option(
                  "--format",
                  choice(["json", "text"], { metavar: "FORMAT" }),
                ),
                "json",
              ),
            }),
          ),
          (value) => ({ type: "set" as const, ...value }),
        ),
      ),
    ),
    command("docs", constant({ type: "docs" as const })),
  ),
});
