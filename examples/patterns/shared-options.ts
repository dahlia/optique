import { group, merge, object, or } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { argument, command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";

const globals = group(
  "Global options",
  object({
    verbose: option("-v", "--verbose"),
    config: optional(option("-c", "--config", string({ metavar: "FILE" }))),
  }),
);

const buildCommand = command(
  "build",
  object({
    action: constant("build"),
    target: argument(string({ metavar: "TARGET" })),
  }),
);

const deployCommand = command(
  "deploy",
  object({
    action: constant("deploy"),
    environment: argument(string({ metavar: "ENV" })),
    force: option("--force"),
  }),
);

const parser = merge(globals, or(buildCommand, deployCommand));

const result = run(parser, { help: "both" });

if (result.action === "build") {
  print(
    message`Building ${result.target}${result.verbose ? " (verbose)" : ""}.`,
  );
} else {
  print(
    message`Deploying to ${result.environment}${
      result.force ? " (forced)" : ""
    }.`,
  );
}
