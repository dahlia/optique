import { bindEnv, bool, createEnvContext } from "@optique/env";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { print, runAsync } from "@optique/run";

// This example demonstrates how to use @optique/env for type-safe
// environment variable fallbacks.  When a CLI argument is not provided,
// the parser checks the corresponding environment variable before
// falling back to the default value.
//
// Priority order: CLI argument > environment variable > default
//
// Usage:
//   deno run -A examples/patterns/env-variables.ts --host example.com
//   MYAPP_HOST=example.com deno run -A examples/patterns/env-variables.ts
//   MYAPP_PORT=9090 deno run -A examples/patterns/env-variables.ts --host 0.0.0.0
//   MYAPP_DEBUG=true deno run -A examples/patterns/env-variables.ts

// Create the environment context with a prefix.
// All bound keys will be prefixed with "MYAPP_".
const envContext = createEnvContext({ prefix: "MYAPP_" });

// Define the CLI parser with environment variable bindings
const parser = object({
  host: bindEnv(
    option("-h", "--host", string({ metavar: "HOST" }), {
      description: message`Server host`,
    }),
    {
      context: envContext,
      key: "HOST",
      parser: string(),
      default: "localhost",
    },
  ),
  port: bindEnv(
    option("-p", "--port", integer({ metavar: "PORT", min: 1, max: 65535 }), {
      description: message`Server port`,
    }),
    {
      context: envContext,
      key: "PORT",
      parser: integer({ min: 1, max: 65535 }),
      default: 3000,
    },
  ),
  debug: bindEnv(
    option("-d", "--debug", bool(), {
      description: message`Enable debug mode`,
    }),
    {
      context: envContext,
      key: "DEBUG",
      parser: bool(),
      default: false,
    },
  ),
});

// Run with the environment context
const result = await runAsync(parser, {
  contexts: [envContext],
  args: Deno.args,
});

print(message`Server configuration:`);
print(message`  Host:  ${result.host}`);
print(message`  Port:  ${String(result.port)}`);
print(message`  Debug: ${String(result.debug)}`);

// Examples:
//
//   $ deno run -A examples/patterns/env-variables.ts
//   Server configuration:
//     Host:  localhost
//     Port:  3000
//     Debug: false
//
//   $ MYAPP_HOST=0.0.0.0 MYAPP_PORT=8080 deno run -A examples/patterns/env-variables.ts
//   Server configuration:
//     Host:  0.0.0.0
//     Port:  8080
//     Debug: false
//
//   $ MYAPP_PORT=8080 deno run -A examples/patterns/env-variables.ts --host example.com
//   Server configuration:
//     Host:  example.com   (CLI wins over env)
//     Port:  8080           (env wins over default)
//     Debug: false
