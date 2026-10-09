import type { SourceContext } from "@optique/core/context";
import assert from "node:assert/strict";
import { it } from "node:test";
import { object } from "@optique/core/constructs";
import { command, option } from "@optique/core/primitives";
import { run } from "./run.ts";

it("run preserves command policy through Program and source-context wrappers", async () => {
  const parser = object({
    command: command("build", option("--verbose"), { showUsage: true }),
  });
  const exit = new Error("Help completed.");
  const context: SourceContext = {
    id: Symbol("help context"),
    phase: "single-pass",
    getAnnotations: () => ({}),
  };
  for (const useContext of [false, true]) {
    const contexts: readonly SourceContext[] = useContext ? [context] : [];
    let output = "";
    let exitCode: number | undefined;
    await assert.rejects(async () => {
      await run({ parser, metadata: { name: "tool" } }, {
        args: ["build", "--help"],
        help: "both",
        showUsage: false,
        contexts,
        colors: false,
        stdout: (text) => {
          output += text;
        },
        onExit(code): never {
          exitCode = code;
          throw exit;
        },
      });
    }, (error: unknown) => error === exit);
    assert.equal(exitCode, 0);
    assert.match(output, /Usage: tool build/);
  }
});
