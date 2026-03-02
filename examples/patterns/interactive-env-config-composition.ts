import { z } from "zod";
import { bindConfig, createConfigContext } from "@optique/config";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { prompt } from "@optique/inquirer";
import { print, runAsync } from "@optique/run";

// This example demonstrates composing @optique/inquirer with @optique/env and
// @optique/config so that missing values are requested interactively.
//
// Priority order:
//   CLI argument > environment variable > config file > interactive prompt
//
// Usage:
//   deno run -A examples/patterns/interactive-env-config-composition.ts
//   deno run -A examples/patterns/interactive-env-config-composition.ts -c config.json
//   MYAPP_HOST=env.example.com deno run -A examples/patterns/interactive-env-config-composition.ts
//   deno run -A examples/patterns/interactive-env-config-composition.ts --host cli.example.com --api-key CLI_KEY

function getConfigPathFromArgs(args: readonly string[]): string | undefined {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];

    if (arg === "-c" || arg === "--config") {
      return args[index + 1];
    }
    if (arg.startsWith("--config=")) {
      return arg.slice("--config=".length);
    }
  }
  return undefined;
}

const configSchema = z.object({
  host: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
  apiKey: z.string().optional(),
});

const envContext = createEnvContext({ prefix: "MYAPP_" });
const configContext = createConfigContext({ schema: configSchema });

const args = Deno.args;

// Preload config annotations once and expose them through a static context so
// prompt() remains the final fallback after CLI/env/config values.
const configAnnotations = await configContext.getAnnotations(
  { config: getConfigPathFromArgs(args) },
  { getConfigPath: (parsed: { readonly config?: string }) => parsed.config },
);

const staticConfigContext = {
  id: configContext.id,
  mode: "static" as const,
  getAnnotations() {
    return configAnnotations;
  },
};

const parser = object({
  config: optional(
    option("-c", "--config", string({ metavar: "FILE" }), {
      description: message`Path to config file (JSON)`,
    }),
  ),

  host: prompt(
    bindEnv(
      bindConfig(
        option("-h", "--host", string({ metavar: "HOST" }), {
          description: message`Server host`,
        }),
        { context: configContext, key: "host" },
      ),
      { context: envContext, key: "HOST", parser: string() },
    ),
    {
      type: "input",
      message: "Server host:",
      default: "localhost",
      validate: (value) => value.trim().length > 0 || "Host cannot be empty.",
    },
  ),

  port: prompt(
    bindEnv(
      bindConfig(
        option(
          "-p",
          "--port",
          integer({ metavar: "PORT", min: 1, max: 65535 }),
          {
            description: message`Server port`,
          },
        ),
        { context: configContext, key: "port" },
      ),
      {
        context: envContext,
        key: "PORT",
        parser: integer({ min: 1, max: 65535 }),
      },
    ),
    {
      type: "number",
      message: "Server port:",
      default: 3000,
      min: 1,
      max: 65535,
    },
  ),

  apiKey: prompt(
    bindEnv(
      bindConfig(
        option("--api-key", string({ metavar: "API_KEY" }), {
          description: message`API key for authentication`,
        }),
        { context: configContext, key: "apiKey" },
      ),
      { context: envContext, key: "API_KEY", parser: string() },
    ),
    {
      type: "password",
      message: "API key:",
      mask: true,
      validate: (value) =>
        value.trim().length > 0 || "API key cannot be empty.",
    },
  ),
});

const result = await runAsync(parser, {
  args,
  contexts: [envContext, staticConfigContext],
});

print(message`Server configuration:`);
print(message`  Host: ${result.host}`);
print(message`  Port: ${String(result.port)}`);
if (result.config) {
  print(message`  Config file: ${result.config}`);
}
print(message`  API key length: ${String(result.apiKey.length)}`);

// Example config.json file:
// {
//   "host": "config.example.com",
//   "port": 8080,
//   "apiKey": "CONFIG_KEY"
// }
