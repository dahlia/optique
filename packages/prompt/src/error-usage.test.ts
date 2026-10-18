import { object, or } from "@optique/core/constructs";
import { runWith } from "@optique/core/facade";
import { type Message, message } from "@optique/core/message";
import { command, constant, option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { createPromptAdapter } from "@optique/prompt";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("command error usage with source fallbacks", () => {
  for (const failure of ["source", "prompt"] as const) {
    it(`should add no evaluation to an asynchronous ${failure} failure`, async () => {
      const traces = [];
      const errors: Message[] = [];
      for (const preamble of ["none", "root", "command"] as const) {
        const trace: string[] = [];
        const env = createEnvContext({
          source(key) {
            trace.push(`source:${key}`);
            return failure === "source" ? "bad" : undefined;
          },
        });
        const prompt = createPromptAdapter<Record<never, never>>({
          execute() {
            trace.push("prompt");
            return Promise.resolve({
              success: false as const,
              error: message`Prompt cancelled.`,
            });
          },
        });
        const valueParser = choice(["80", "443"]);
        const port = bindEnv(option("--port", valueParser), {
          context: env,
          key: "PORT",
          parser: valueParser,
        });
        const parser = or(
          command("config", object({ port: prompt(port, {}) })),
          command("serve", constant(null)),
        );
        const chunks: string[] = [];

        await runWith(parser, "tool", [env], {
          args: ["config"],
          colors: false,
          maxWidth: 80,
          aboveError: preamble === "none" ? "none" : "usage",
          errorUsage: preamble === "command" ? "command" : "root",
          usageLine: () =>
            assert.fail("Compact errors do not evaluate overrides."),
          stderr: (chunk) => chunks.push(chunk),
          onError(code, error) {
            assert.equal(code, 1);
            errors.push(error);
            return null;
          },
        });

        assert.ok(trace.includes("source:PORT"));
        if (failure === "prompt") {
          assert.equal(trace.filter((event) => event === "prompt").length, 1);
        }
        if (preamble === "command") {
          assert.match(chunks[0], /tool config/);
          assert.doesNotMatch(chunks[0], /serve/);
        }
        traces.push(trace);
      }
      assert.deepEqual(traces[1], traces[0]);
      assert.deepEqual(traces[2], traces[0]);
      assert.deepEqual(errors[1], errors[0]);
      assert.deepEqual(errors[2], errors[0]);
    });
  }
});
