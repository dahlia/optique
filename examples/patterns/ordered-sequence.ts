import { object, or, seq } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { argument, command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";

const parser = seq(
  optional(argument(string({ metavar: "PROFILE" }))),
  or(
    command(
      "build",
      object({
        action: constant("build"),
        target: argument(string({ metavar: "TARGET" })),
      }),
      {
        description: message`Build an artifact for the selected profile.`,
      },
    ),
    command(
      "deploy",
      object({
        action: constant("deploy"),
        environment: argument(string({ metavar: "ENV" })),
        force: option("--force", {
          description: message`Deploy even when safety checks fail.`,
        }),
      }),
      {
        description: message`Deploy an environment for the selected profile.`,
      },
    ),
  ),
);

const [profile, commandResult] = run(parser, {
  help: "both",
  version: { command: true, option: true, value: "1.0.0" },
});

const profileName = profile ?? "default";

if (commandResult.action === "build") {
  print(message`Building ${commandResult.target} with ${profileName}.`);
} else {
  const suffix = commandResult.force ? " with force" : "";
  print(
    message`Deploying ${commandResult.environment} with ${profileName}${suffix}.`,
  );
}
