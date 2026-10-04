import { object, or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { command } from "@optique/core/primitives";
import { defineProgram } from "@optique/core/program";

export const parser = or(
  command("install", object({}), {
    aliases: ["i"],
    description: message`Install a package.`,
  }),
  command("remove", object({}), {
    description: message`Remove a package.`,
  }),
);
export default defineProgram({ parser, metadata: { name: "alias-example" } });
