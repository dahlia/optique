import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { object } from "@optique/core/constructs";
import { getDocPage } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { defineCommand } from "./command.ts";
import { createProgramParser, runProgram } from "./index.ts";

describe("discovered command showUsage", () => {
  it("preserves explicit namespace defaults and descendant overrides", async () => {
    const parser = createProgramParser([
      {
        path: ["admin"],
        command: defineCommand({
          parser: object({}),
          metadata: { showUsage: false },
          handler() {},
        }),
      },
      {
        path: ["admin", "create"],
        command: defineCommand({ parser: option("--verbose"), handler() {} }),
      },
      {
        path: ["admin", "delete"],
        command: defineCommand({
          parser: option("--force"),
          metadata: { showUsage: true },
          handler() {},
        }),
      },
    ]);
    assert.ok((await getDocPage(parser, ["admin"]))?.showUsage === false);
    assert.ok(
      (await getDocPage(parser, ["admin", "create"]))?.showUsage === false,
    );
    assert.ok((await getDocPage(parser, ["admin", "delete"]))?.showUsage);
  });

  it("does not copy a descendant policy into a synthetic namespace", async () => {
    const parser = createProgramParser([{
      path: ["admin", "create"],
      command: defineCommand({
        parser: option("--verbose"),
        metadata: { showUsage: true },
        handler() {},
      }),
    }]);
    assert.equal((await getDocPage(parser, ["admin"]))?.showUsage, undefined);
    assert.ok((await getDocPage(parser, ["admin", "create"]))?.showUsage);
  });

  it("forwards the runner default through runProgram", async () => {
    const exit = new Error("Help completed.");
    let output = "";
    let exitCode: number | undefined;
    await assert.rejects(async () => {
      await runProgram({
        commands: [defineCommand({
          path: ["build"],
          parser: option("--verbose"),
          metadata: { showUsage: true },
          handler() {
            assert.fail("Help must not dispatch the handler.");
          },
        })],
        metadata: { name: "tool" },
        args: ["build", "--help"],
        showUsage: false,
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
  });
});
