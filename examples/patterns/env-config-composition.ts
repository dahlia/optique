import { z } from "zod";
import { bindConfig, createConfigContext } from "@optique/config";
import { bindEnv, createEnvContext } from "@optique/env";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { print, runAsync } from "@optique/run";

// This example demonstrates composing @optique/env with @optique/config
// to achieve a four-level fallback chain:
//
//   CLI argument > environment variable > config file > default
//
// The nesting order of bindEnv and bindConfig determines the priority.
// The outermost wrapper is checked first after CLI, so:
//   bindEnv(bindConfig(option(...)))  →  CLI > Env > Config > Default
//
// Usage:
//   deno run -A examples/patterns/env-config-composition.ts --host example.com
//   deno run -A examples/patterns/env-config-composition.ts -c config.json
//   MYAPP_HOST=env.example.com deno run -A examples/patterns/env-config-composition.ts
//   MYAPP_PORT=9090 deno run -A examples/patterns/env-config-composition.ts -c config.json

// Define the config file schema using Zod
const configSchema = z.object({
  host: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
});

// Create both contexts
const envContext = createEnvContext({ prefix: "MYAPP_" });
const configContext = createConfigContext({ schema: configSchema });

// Compose parsers with both env and config bindings.
// Nesting order matters: bindEnv wraps bindConfig wraps the base option.
const parser = object({
  config: optional(
    option("-c", "--config", string({ metavar: "FILE" }), {
      description: message`Path to config file (JSON)`,
    }),
  ),
  host: bindEnv(
    bindConfig(
      option("-h", "--host", string({ metavar: "HOST" }), {
        description: message`Server host`,
      }),
      {
        context: configContext,
        key: "host",
        default: "localhost",
      },
    ),
    {
      context: envContext,
      key: "HOST",
      parser: string(),
    },
  ),
  port: bindEnv(
    bindConfig(
      option("-p", "--port", integer({ metavar: "PORT", min: 1, max: 65535 }), {
        description: message`Server port`,
      }),
      {
        context: configContext,
        key: "port",
        default: 3000,
      },
    ),
    {
      context: envContext,
      key: "PORT",
      parser: integer({ min: 1, max: 65535 }),
    },
  ),
});

// Run with both contexts
const result = await runAsync(parser, {
  contexts: [envContext, configContext],
  getConfigPath: (parsed) => parsed.config,
  args: Deno.args,
});

print(message`Server configuration:`);
print(message`  Host: ${result.host}`);
print(message`  Port: ${String(result.port)}`);
if (result.config) {
  print(message`  Config file: ${result.config}`);
}

// Example config.json:
// {
//   "host": "config.example.com",
//   "port": 8080
// }
//
// Examples:
//
//   # All defaults (localhost:3000)
//   $ deno run -A examples/patterns/env-config-composition.ts
//
//   # Config file provides values
//   $ deno run -A examples/patterns/env-config-composition.ts -c config.json
//   Host: config.example.com, Port: 8080
//
//   # Env overrides config
//   $ MYAPP_HOST=env.example.com deno run -A examples/patterns/env-config-composition.ts -c config.json
//   Host: env.example.com, Port: 8080
//
//   # CLI overrides everything
//   $ MYAPP_HOST=env.example.com deno run -A examples/patterns/env-config-composition.ts -c config.json --host cli.example.com
//   Host: cli.example.com, Port: 8080
