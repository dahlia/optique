import { object } from "@optique/core/constructs";
import type {
  Annotations,
  ParserValuePlaceholder,
  SourceContext,
} from "@optique/core/context";
import { runWith } from "@optique/core/facade";
import { message } from "@optique/core/message";
import { optional, withDefault } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { print } from "@optique/run";

// This example demonstrates how to create a custom SourceContext from scratch.
// For most config file use cases, prefer using @optique/config instead.
// See config-file-context.ts for the recommended approach.
//
// Use this pattern when you need:
// - Custom validation logic beyond Standard Schema
// - Integration with non-file data sources (databases, APIs, etc.)
// - Complex transformation logic before annotation injection
//
// Usage:
//   deno run -A examples/patterns/custom-source-context.ts --host example.com
//   deno run -A examples/patterns/custom-source-context.ts --config config.json
//   deno run -A examples/patterns/custom-source-context.ts --config config.json --port 8080

// Symbol for our config context annotations
const configKey = Symbol.for("@example/config");

// The shape of config file data
interface ConfigData {
  readonly host?: string;
  readonly port?: number;
}

// Declare required options using ParserValuePlaceholder.
// This tells TypeScript that runWith() must provide a getConfigPath function
// whose parameter type will be substituted with the actual parser result type.
interface ConfigContextOptions {
  getConfigPath: (parsed: ParserValuePlaceholder) => string | undefined;
}

// The context type extends SourceContext with our required options
interface ConfigContext extends SourceContext<ConfigContextOptions> {
  getConfigPath?: (parsed: unknown) => string | undefined;
}

// Factory function to create the config context
function createConfigContext(): ConfigContext {
  const context: ConfigContext = {
    id: configKey,
    async getAnnotations(parsed?: unknown): Promise<Annotations> {
      if (!parsed) return {}; // First pass - no config yet

      // Use the injected getConfigPath function
      const configPath = context.getConfigPath?.(parsed);
      if (!configPath) return {}; // No config file specified

      try {
        // Read and parse the config file
        const content = await Deno.readTextFile(configPath);
        const data: ConfigData = JSON.parse(content);

        // Custom validation (this is where you'd add logic
        // that goes beyond what Standard Schema can do)
        if (data.port !== undefined && (data.port < 1 || data.port > 65535)) {
          throw new Error("Port must be between 1 and 65535.");
        }

        return { [configKey]: data };
      } catch (error) {
        // You can choose to throw errors or gracefully degrade
        if (error instanceof Error && error.message.includes("Port")) {
          throw error; // Re-throw validation errors
        }
        // Config file not found or invalid JSON - gracefully degrade
        return {};
      }
    },
  };
  return context;
}

// Define the CLI parser
const parser = object({
  config: optional(
    option("-c", "--config", string({ metavar: "FILE" }), {
      description: message`Path to config file (JSON)`,
    }),
  ),
  host: withDefault(
    option("-h", "--host", string({ metavar: "HOST" }), {
      description: message`Server host`,
    }),
    "localhost",
  ),
  port: withDefault(
    option("-p", "--port", integer({ metavar: "PORT", min: 1, max: 65535 }), {
      description: message`Server port`,
    }),
    3000,
  ),
});

// Create the config context
const configContext = createConfigContext();

// Run with the config context.
// TypeScript REQUIRES getConfigPath and types `parsed` from the parser!
const result = await runWith(
  parser,
  "custom-context-example",
  [configContext],
  {
    args: Deno.args,
    help: { mode: "option" },
    // getConfigPath is required because configContext declares ConfigContextOptions.
    // The `parsed` parameter is automatically typed as:
    //   { config?: string; host: string; port: number }
    getConfigPath: (parsed) => parsed.config,
  },
);

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
// Key differences from @optique/config:
// - Manual implementation of getAnnotations()
// - Custom validation logic (port range check)
// - No automatic Standard Schema validation
// - More control over error handling
// - More boilerplate code
