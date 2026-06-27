import { object } from "@optique/core/constructs";
import { message, text } from "@optique/core/message";
import { withDefault } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { choice, string } from "@optique/core/valueparser";
import { defineCommand, runProgram } from "@optique/discover";
import { print } from "@optique/run";
import process from "node:process";

// This example shows how runProgram()'s lifecycle hooks let cross-cutting
// concerns — timing, structured logging, resource setup, error reporting —
// live in one place instead of being copied into every command handler.
//
// Usage:
//   deno run -A examples/patterns/program-hooks.ts build --target web
//   deno run -A examples/patterns/program-hooks.ts deploy --env staging
//   deno run -A examples/patterns/program-hooks.ts deploy --env production

// A tiny stand-in for a real log scope, tracing span, or pooled resource.
// A beforeEach hook opens one and returns it as the hook context's resource;
// the matching afterEach and onError hooks receive the same object, and the
// command handler reads it through its second parameter.
interface Scope {
  readonly label: string;
  readonly startedAt: number;
  log(line: string): void;
}

function openScope(label: string): Scope {
  print(message`▶ ${text(label)} started.`);
  return {
    label,
    startedAt: Date.now(),
    log(line: string) {
      print(message`  ${text(label)}: ${text(line)}`);
    },
  };
}

const build = defineCommand({
  path: ["build"],
  parser: object({
    target: withDefault(
      option("--target", string({ metavar: "TARGET" })),
      "app",
    ),
  }),
  metadata: { brief: message`Build the project.` },
  // build has no command-level hooks, so its handler receives the program-level
  // scope opened by the program beforeEach below.
  handler(value, context) {
    const scope = context?.resource as Scope;
    scope.log(`compiling ${value.target}`);
  },
});

const deploy = defineCommand({
  path: ["deploy"],
  parser: object({
    environment: option("--env", choice(["staging", "production"] as const)),
    dryRun: option("--dry-run"),
  }),
  metadata: { brief: message`Deploy the project.` },
  // A per-command preflight that lives with the command, not in the program
  // hook: deploy always refreshes its auth token before running.  Because this
  // command defines its own beforeEach, the handler receives this command-level
  // scope instead of the program-level one.
  hooks: {
    beforeEach({ value }) {
      const { environment } = value as { environment: string };
      const scope = openScope(`deploy:${environment}`);
      scope.log("refreshed auth token");
      return { resource: scope };
    },
    // Release the token on both the success and failure paths, the same way a
    // try/finally would: afterEach runs after a successful handler, onError
    // after a failing one.
    afterEach(context) {
      const scope = context.resource as Scope;
      scope.log("released auth token");
    },
    onError(context) {
      const scope = context.resource as Scope | undefined;
      scope?.log("released auth token");
    },
  },
  handler(value, context) {
    const scope = context?.resource as Scope;
    const action = value.dryRun ? "planning" : "deploying";
    scope.log(`${action} ${value.environment}`);
  },
});

await runProgram({
  commands: [build, deploy],
  metadata: {
    name: "tasks",
    version: "1.0.0",
    brief: message`Project task runner with lifecycle hooks.`,
  },
  args: process.argv.slice(2),
  // Program-level hooks wrap every command.  beforeEach opens a scope keyed by
  // the command path and threads it forward; afterEach reports the elapsed time
  // on success; onError reports failures without swallowing them (runProgram
  // re-throws so the process still exits non-zero).
  hooks: {
    beforeEach({ path }) {
      const label = path.length > 0 ? path.join(" ") : "tasks";
      return { resource: openScope(label) };
    },
    afterEach(context) {
      const scope = context.resource as Scope;
      print(
        message`✔ ${text(scope.label)} finished in ${
          text(`${Date.now() - scope.startedAt}ms`)
        }.`,
      );
    },
    onError(context, error) {
      // beforeEach may have failed before opening a scope, so the resource can
      // be absent here.
      const scope = context.resource as Scope | undefined;
      const label = scope?.label ?? "tasks";
      print(message`✘ ${text(label)} failed: ${text(String(error))}`);
    },
  },
});
