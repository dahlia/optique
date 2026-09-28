import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { constant } from "@optique/core/primitives";
import type { DocEntry } from "@optique/core/doc";
import { run, runAsync, runSync } from "@optique/run";

describe("runner environment documentation", () => {
  const entry: DocEntry = {
    term: { type: "option", names: ["--name"] },
    envVars: ["APP_NAME"],
  };
  const parser = {
    ...constant("unused"),
    getDocFragments: () => ({
      fragments: [{ type: "entry" as const, ...entry }],
    }),
  };
  const exited = new Error("Exited.");

  it("forwards environment formatting through run and runSync", () => {
    for (const invoke of [run, runSync]) {
      const output: string[] = [];
      assert.throws(
        () =>
          invoke(parser, {
            args: ["--help"],
            help: "option",
            colors: false,
            showEnvironment: { placement: "both" },
            stdout: (line) => output.push(line),
            onExit() {
              throw exited;
            },
          }),
        (error) => error === exited,
      );
      assert.match(output.join("\n"), /\[env: APP_NAME\]/);
      assert.match(output.join("\n"), /Environment:/);
    }
  });

  it("forwards environment formatting through runAsync", async () => {
    const output: string[] = [];
    await assert.rejects(
      async () =>
        await runAsync(parser, {
          args: ["--help"],
          help: "option",
          colors: false,
          showEnvironment: { placement: "section" },
          stdout: (line) => output.push(line),
          onExit() {
            throw exited;
          },
        }),
      (error) => error === exited,
    );
    assert.match(output.join("\n"), /Environment:/);
    assert.ok(!output.join("\n").includes("[env:"));
  });
});

it("preserves source-only metadata through runner help wrappers", async () => {
  const parser = {
    ...constant("unused"),
    getDocFragments: () => ({
      fragments: [],
      sourceOnly: true as const,
      environmentBindings: [{ name: "VISIBLE" }, {
        name: "HIDDEN",
        hidden: true,
      }],
    }),
  };
  for (const invoke of [runSync, runAsync]) {
    const output: string[] = [];
    const exited = new Error("Exited.");
    await assert.rejects(async () =>
      await invoke(parser, {
        args: ["--help"],
        help: "option",
        showEnvironment: true,
        stdout: (line) => output.push(line),
        colors: false,
        onExit() {
          throw exited;
        },
      }), (error) => error === exited);
    assert.ok(output.join("\n").includes("VISIBLE"));
    assert.ok(!output.join("\n").includes("HIDDEN"));
  }
});
