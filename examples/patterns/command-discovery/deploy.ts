import { object } from "@optique/core/constructs";
import { message, text } from "@optique/core/message";
import { flag, option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
import { defineCommand } from "@optique/discover/command";
import { print } from "@optique/run";

export default defineCommand({
  parser: object({
    environment: option(
      "--env",
      choice(["staging", "production"] as const),
      {
        description: message`Deployment environment`,
      },
    ),
    dryRun: flag("--dry-run", {
      description: message`Show the deployment plan without applying it`,
    }),
  }),
  metadata: {
    brief: message`Deploy the project.`,
  },
  handler(value) {
    const mode = value.dryRun ? "Planning" : "Deploying";
    print(message`${text(mode)} ${text(value.environment)}.`);
  },
});
