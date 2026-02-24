import { z } from "zod";
import { bindConfig, createConfigContext } from "@optique/config";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { print, runAsync } from "@optique/run";

// This example demonstrates how to use @optique/config for type-safe
// configuration file integration with automatic validation.
//
// Usage:
//   deno run -A examples/patterns/config-file-context.ts --host example.com
//   deno run -A examples/patterns/config-file-context.ts --config config.json
//   deno run -A examples/patterns/config-file-context.ts --config config.json --port 8080
//
// For custom SourceContext implementation, see custom-source-context.ts

// Define the config file schema using Zod
const configSchema = z.object({
  host: z.string().optional(),
  port: z.number().int().min(1).max(65535).optional(),
});

// Create the config context with schema validation
const configContext = createConfigContext({ schema: configSchema });

// Define the CLI parser with config file bindings
const parser = object({
  config: optional(
    option("-c", "--config", string({ metavar: "FILE" }), {
      description: message`Path to config file (JSON)`,
    }),
  ),
  // bindConfig() creates parsers that fall back to config values
  host: bindConfig(
    option("-h", "--host", string({ metavar: "HOST" }), {
      description: message`Server host`,
    }),
    {
      context: configContext,
      key: "host",
      default: "localhost",
    },
  ),
  port: bindConfig(
    option("-p", "--port", integer({ metavar: "PORT", min: 1, max: 65535 }), {
      description: message`Server port`,
    }),
    {
      context: configContext,
      key: "port",
      default: 3000,
    },
  ),
});

// Run with config file support
// Two-pass parsing: 1) extract config path, 2) parse with config data
const result = await runAsync(parser, {
  contexts: [configContext],
  getConfigPath: (parsed) => parsed.config,
  args: Deno.args,
});

print(message`Configuration loaded:`);
print(message`  Host: ${result.host}`);
print(message`  Port: ${String(result.port)}`);
if (result.config) {
  print(message`  Config file: ${result.config}`);
}

// Example config.json file:
// {
//   "host": "api.example.com",
//   "port": 8080
// }
//
// Priority order: CLI arguments > config file > defaults
// So: --host overrides config.host, --port overrides config.port
//
// The config file is automatically validated against the Zod schema.
// Invalid config files will result in clear error messages.
