import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { object } from "@optique/core/constructs";
import type { SourceContext } from "@optique/core/context";
import { message } from "@optique/core/message";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import {
  createProgramParser,
  defineCommand,
  type ProgramHelpOptions,
  runProgram,
  type RunProgramOptions,
} from "./index.ts";

describe("runProgram() bare group help", () => {
  it("should show root and implicit namespace help with successful exits", async () => {
    const commands = [defineCommand({
      path: ["tagging", "changes"],
      parser: object({}),
      handler() {
        assert.fail("Help must not run the handler.");
      },
    })];
    for (const args of [[], ["tagging"]]) {
      const result = await capture({
        commands,
        args,
        help: { bareGroup: "namespace" },
      });
      const explicit = await capture({ commands, args: [...args, "--help"] });
      assert.deepEqual(result, explicit);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
    }
  });

  it("should override executable root and required parent only with always", async () => {
    const commands = [
      defineCommand({
        path: [],
        parser: option("--root", string()),
        handler() {
          assert.fail();
        },
      }),
      defineCommand({
        path: ["tagging"],
        parser: option("--name", string()),
        handler() {
          assert.fail();
        },
      }),
      defineCommand({
        path: ["tagging", "changes"],
        parser: object({}),
        handler() {
          assert.fail();
        },
      }),
    ];
    for (const args of [[], ["tagging"]]) {
      assert.equal(
        (await capture({ commands, args, help: { bareGroup: "namespace" } }))
          .exitCode,
        1,
      );
      const result = await capture({
        commands,
        args,
        help: { bareGroup: "always" },
      });
      assert.deepEqual(
        result,
        await capture({ commands, args: [...args, "--help"] }),
      );
    }
  });

  it("should preserve parent dispatch by default and with never or namespace", async () => {
    let calls = 0;
    const commands = [
      defineCommand({
        path: ["tagging"],
        parser: object({}),
        handler() {
          calls++;
        },
      }),
      defineCommand({
        path: ["tagging", "changes"],
        parser: object({}),
        handler() {
          assert.fail();
        },
      }),
    ];
    for (
      const help of [undefined, false, "both", { bareGroup: "never" }, {
        bareGroup: "namespace",
      }] as const
    ) {
      const result = await capture({ commands, args: ["tagging"], help });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "");
    }
    assert.equal(calls, 5);
    const result = await capture({
      commands,
      args: ["tagging"],
      help: { bareGroup: "always" },
    });
    assert.match(result.stdout, /changes/);
    assert.equal(calls, 5);
  });

  it("should leave leaves, extra arguments, unknown paths and terminators alone", async () => {
    const calls: string[] = [];
    const commands = [
      defineCommand({
        path: ["tagging"],
        parser: option("--verbose"),
        handler() {
          calls.push("parent");
        },
      }),
      defineCommand({
        path: ["tagging", "changes"],
        parser: option("--json", string()),
        handler() {
          calls.push("leaf");
        },
      }),
    ];
    for (
      const args of [["tagging", "changes"], ["unknown"], [
        "tagging",
        "unknown",
      ], ["tagging", "--bad"]]
    ) {
      const result = await capture({
        commands,
        args,
        help: { bareGroup: "always" },
      });
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
    }
    for (
      const args of [["tagging", "--verbose"], ["tagging", "--"], [
        "tagging",
        "changes",
        "--json",
        "{}",
      ]]
    ) {
      assert.equal(
        (await capture({ commands, args, help: { bareGroup: "always" } }))
          .exitCode,
        0,
      );
    }
    assert.deepEqual(calls, ["parent", "parent", "leaf"]);
  });

  it("should execute a root leaf even with always", async () => {
    let calls = 0;
    const commands = [defineCommand({
      path: [],
      parser: object({}),
      handler() {
        calls++;
      },
    })];
    assert.equal(
      (await capture({ commands, args: [], help: { bareGroup: "always" } }))
        .stdout,
      "",
    );
    assert.equal(calls, 1);
  });

  it("should preserve nested aliases and configured help formatting", async () => {
    const commands = [
      defineCommand({
        path: ["database"],
        metadata: { aliases: ["db"], showUsage: false },
        parser: object({}),
        handler() {
          assert.fail();
        },
      }),
      defineCommand({
        path: ["database", "remote"],
        metadata: { aliases: ["r"], brief: message`Manage remotes.` },
        parser: object({}),
        handler() {
          assert.fail();
        },
      }),
      defineCommand({
        path: ["database", "remote", "list"],
        parser: object({}),
        handler() {
          assert.fail();
        },
      }),
    ];
    for (const args of [["db"], ["db", "r"]]) {
      const settings = {
        commands,
        showAliases: true,
        helpSections: { commands: "Commands" },
        commandList: "top-level",
        footer: message`Footer.`,
      } as const;
      assert.deepEqual(
        await capture({ ...settings, args, help: { bareGroup: "always" } }),
        await capture({ ...settings, args: [...args, "--help"] }),
      );
    }
  });

  it("should show user group docs for built-in command names", async () => {
    for (const name of ["help", "version", "completion"]) {
      const commands = [
        defineCommand({
          path: [name, "child"],
          parser: object({}),
          handler() {
            assert.fail();
          },
        }),
      ];
      const result = await capture({
        commands,
        args: [name],
        help: { bareGroup: "always" },
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /child/);
      assert.deepEqual(
        result,
        await capture({ commands, args: [name, "--help"] }),
      );
    }
  });

  it("should default policy-only objects to both help entry points", async () => {
    const commands = [
      defineCommand({
        path: ["tagging", "changes"],
        parser: object({}),
        handler() {
          assert.fail();
        },
      }),
    ];
    for (
      const help of [{ bareGroup: "never" }, {
        command: undefined,
        option: undefined,
        bareGroup: "never",
      }] as const
    ) {
      const root = await capture({ commands, args: ["--help"], help });
      assert.equal(root.exitCode, 0);
      assert.match(root.stdout, /help\s+Show help/);
      assert.deepEqual(root, await capture({ commands, args: ["help"], help }));
    }
  });

  it("should support command-only and custom help names", async () => {
    const commands = [
      defineCommand({
        path: ["tagging", "changes"],
        parser: object({}),
        handler() {
          assert.fail();
        },
      }),
    ];
    const commandOnly: ProgramHelpOptions = {
      command: { names: ["assist"] },
      bareGroup: "always",
    };
    const bare = await capture({
      commands,
      args: ["tagging"],
      help: commandOnly,
    });
    assert.deepEqual(
      bare,
      await capture({
        commands,
        args: ["assist", "tagging"],
        help: commandOnly,
      }),
    );
    assert.equal(
      (await capture({ commands, args: ["--help"], help: commandOnly }))
        .exitCode,
      1,
    );
    const custom: ProgramHelpOptions = {
      option: { names: ["--assist"] },
      bareGroup: "always",
    };
    assert.deepEqual(
      await capture({ commands, args: [], help: custom }),
      await capture({ commands, args: ["--assist"], help: custom }),
    );
  });

  it("should skip execution hooks and phase two while disposing contexts", async () => {
    const phases: string[] = [];
    const context: SourceContext = {
      id: Symbol("bare-help"),
      phase: "two-pass",
      getAnnotations(request) {
        phases.push(request?.phase ?? "phase1");
        return {};
      },
      [Symbol.dispose]() {
        phases.push("dispose");
      },
    };
    const commands = [
      defineCommand({
        path: ["tagging"],
        parser: object({}),
        hooks: {
          beforeEach() {
            assert.fail();
          },
        },
        handler() {
          assert.fail();
        },
      }),
      defineCommand({
        path: ["tagging", "changes"],
        parser: object({}),
        handler() {
          assert.fail();
        },
      }),
    ];
    const result = await capture({
      commands,
      args: ["tagging"],
      help: { bareGroup: "always" },
      contexts: [context],
      hooks: {
        beforeEach() {
          assert.fail();
        },
      },
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(phases, ["phase1", "dispose"]);
  });

  it("should show help without completing an async parent parser", async () => {
    const base = object({
      value: option("--value", {
        mode: "async" as const,
        metavar: "VALUE" as const,
        placeholder: "",
        format(value: string) {
          return value;
        },
        parse() {
          return Promise.resolve({ success: true as const, value: "value" });
        },
      }),
    });
    const commands = [
      defineCommand({
        path: ["tagging"],
        parser: {
          ...base,
          complete() {
            assert.fail("Help must not complete the parent parser.");
          },
        },
        handler() {
          assert.fail("Help must not dispatch.");
        },
      }),
      defineCommand({
        path: ["tagging", "changes"],
        parser: object({}),
        handler() {
          assert.fail();
        },
      }),
    ];
    const result = await capture({
      commands,
      args: ["tagging"],
      help: { bareGroup: "always" },
    });
    assert.equal(result.exitCode, 0);
    assert.match(result.stdout, /changes/);
  });

  it("should use process arguments when args is omitted", async () => {
    const saved = process.argv;
    try {
      process.argv = [saved[0], "tool", "tagging"];
      const commands = [
        defineCommand({
          path: ["tagging", "changes"],
          parser: object({}),
          handler() {
            assert.fail();
          },
        }),
      ];
      const result = await capture({ commands, help: { bareGroup: "always" } });
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /changes/);
    } finally {
      process.argv = saved;
    }
  });

  it("should work with file discovery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "optique-bare-help-"));
    try {
      const moduleUrl = new URL("./command.ts", import.meta.url).href;
      const constructsUrl =
        new URL("../../core/src/constructs.ts", import.meta.url).href;
      await writeFile(
        join(dir, "child.ts"),
        `import { defineCommand } from ${
          JSON.stringify(moduleUrl)
        };\nimport { object } from ${
          JSON.stringify(constructsUrl)
        };\nexport default defineCommand({ parser: object({}), handler() { throw new Error("Unexpected handler."); } });\n`,
      );
      const result = await capture({
        dir,
        args: [],
        help: { bareGroup: "namespace" },
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /child/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should reject invalid policies before importing command modules", async () => {
    await assert.rejects(
      () =>
        runProgram(
          {
            dir: "/does-not-exist",
            metadata: { name: "tool" },
            help: { bareGroup: "invalid" },
          } as never,
        ),
      { name: "TypeError", message: "Invalid bareGroup help policy: invalid" },
    );
  });

  it("should reject colliding sibling aliases before displaying help", async () => {
    const commands = [
      defineCommand({
        path: ["a"],
        metadata: { aliases: ["b"] },
        parser: object({}),
        handler() {},
      }),
      defineCommand({ path: ["b", "child"], parser: object({}), handler() {} }),
    ];
    assert.throws(
      () =>
        createProgramParser(
          commands.map((command) => ({ path: command.path, command })),
        ),
      TypeError,
    );
    await assert.rejects(
      () => capture({ commands, args: [], help: { bareGroup: "always" } }),
      TypeError,
    );
  });
});

// Helpers
type WithoutMetadata<T> = T extends unknown ? Omit<T, "metadata"> : never;
type CaptureOptions = WithoutMetadata<RunProgramOptions>;
async function capture(options: CaptureOptions) {
  class Exit extends Error {
    readonly code: number;
    constructor(code: number) {
      super("Exit.");
      this.code = code;
    }
  }
  let stdout = "";
  let stderr = "";
  let exitCode = 0;
  try {
    await runProgram({
      metadata: { name: "tool" },
      colors: false,
      maxWidth: 80,
      ...options,
      stdout(text) {
        stdout += `${text}\n`;
      },
      stderr(text) {
        stderr += `${text}\n`;
      },
      onExit(code): never {
        throw new Exit(code);
      },
    });
  } catch (error) {
    if (!(error instanceof Exit)) throw error;
    exitCode = error.code;
  }
  return { stdout, stderr, exitCode };
}
