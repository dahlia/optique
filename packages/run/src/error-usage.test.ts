import { or } from "@optique/core/constructs";
import type { SourceContext } from "@optique/core/context";
import { command, constant, option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
import { run, runAsync, runSync } from "@optique/run";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("errorUsage forwarding", () => {
  for (const runner of [run, runSync, runAsync]) {
    for (const withContext of [false, true]) {
      it(`should forward through ${runner.name} with contexts=${withContext}`, async () => {
        const parser = or(
          command("config", option("--port", choice(["80"]))),
          command("serve", constant(null)),
        );
        const context: SourceContext = {
          id: Symbol("test error usage"),
          phase: "single-pass",
          getAnnotations: () => ({}),
        };
        const results: string[] = [];
        for (const errorUsage of [undefined, "root", "command"] as const) {
          const exit = new Error("Captured exit.");
          let output = "";
          await assert.rejects(async () => {
            await runner(parser, {
              args: ["config", "--port", "bad"],
              programName: "tool",
              colors: false,
              maxWidth: 80,
              errorUsage,
              contexts: withContext ? [context] : [],
              stderr: (chunk) => {
                output += chunk;
              },
              onExit(code): never {
                assert.equal(code, 1);
                throw exit;
              },
            });
          }, (error: unknown) => error === exit);
          results.push(output);
        }
        assert.equal(results[0], results[1]);
        assert.match(results[0], /serve/);
        assert.match(results[2], /tool config/);
        assert.doesNotMatch(results[2], /serve/);
      });
    }
  }
});
