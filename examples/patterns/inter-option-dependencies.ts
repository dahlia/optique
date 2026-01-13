/**
 * Inter-option value dependencies example.
 *
 * This pattern demonstrates how to create options whose valid values depend
 * on the value of another option. For example, a --log-level option that
 * accepts different values depending on whether --mode is "dev" or "prod".
 *
 * This is different from dependent-options.ts which controls whether options
 * are *available* based on a flag's presence. This pattern controls which
 * *values are valid* based on another option's value.
 *
 * @since 0.10.0
 * @module
 */
import { dependency, deriveFrom } from "@optique/core/dependency";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";

// =============================================================================
// Example 1: Single dependency
// =============================================================================

// Create a dependency source - the mode option that other options depend on
const modeParser = dependency(choice(["dev", "prod"] as const));

// Create a derived parser - log levels that are valid depend on the mode
const logLevelParser = modeParser.derive({
  metavar: "LEVEL",
  factory: (mode) => {
    // In dev mode, allow verbose logging options
    if (mode === "dev") {
      return choice(["debug", "info", "warn", "error"] as const);
    }
    // In prod mode, only allow less verbose options
    return choice(["warn", "error"] as const);
  },
  // Default value used when --mode is not provided
  defaultValue: () => "dev" as const,
});

const simpleParser = object({
  mode: option("--mode", "-m", modeParser, {
    description: message`Application mode (dev or prod)`,
  }),
  logLevel: option("--log-level", "-l", logLevelParser, {
    description: message`Log level (available options depend on mode)`,
  }),
});

// =============================================================================
// Example 2: Multiple dependencies with deriveFrom()
// =============================================================================

// Multiple dependency sources
const envParser = dependency(
  choice(["local", "staging", "production"] as const),
);
const regionParser = dependency(
  choice(["us-east", "us-west", "eu-west"] as const),
);

// Server names depend on both environment AND region
const serverParser = deriveFrom({
  metavar: "SERVER",
  dependencies: [envParser, regionParser] as const,
  factory: (env, region) => {
    if (env === "local") {
      return choice(["localhost", "127.0.0.1"] as const);
    }
    // Generate server names based on environment and region
    return choice(
      [
        `${env}-${region}-1`,
        `${env}-${region}-2`,
        `${env}-${region}-3`,
      ] as const,
    );
  },
  defaultValues: () => ["local", "us-east"] as const,
});

const _multiDepParser = object({
  env: option("--env", "-e", envParser, {
    description: message`Deployment environment`,
  }),
  region: option("--region", "-r", regionParser, {
    description: message`Deployment region`,
  }),
  server: option("--server", "-s", serverParser, {
    description: message`Target server (depends on env and region)`,
  }),
});

// =============================================================================
// Run the example
// =============================================================================

// This example demonstrates the single dependency pattern.
// Valid combinations:
//   --mode dev --log-level debug
//   --mode dev --log-level info
//   --mode prod --log-level warn
//   --mode prod --log-level error
// Invalid: --mode prod --log-level debug (debug not allowed in prod)

const result = run(simpleParser);
print(message`Result: ${JSON.stringify(result, null, 2)}`);

// The multiDepParser above shows the pattern for multiple dependencies.
// To test it, replace `simpleParser` with `multiDepParser` and run:
//   --env local --server localhost
//   --env staging --region us-east --server staging-us-east-1
//   --env production --region eu-west --server production-eu-west-2
