import { object } from "@optique/core/constructs";
import { formatDocPage } from "@optique/core/doc";
import { message } from "@optique/core/message";
import { withDefault } from "@optique/core/modifiers";
import { getDocPageAsync } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import type { SourceContext } from "@optique/core/context";
import { integer, string } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { defineCommand } from "./command.ts";
import {
  createProgramParser,
  discoverCommands,
  getDefaultExtensions,
  runProgram,
} from "./index.ts";

describe("defineCommand()", () => {
  it("preserves handler value inference", () => {
    defineCommand({
      parser: object({
        count: withDefault(option("--count", integer()), 1),
        name: option("--name", string()),
      }),
      handler(value) {
        const count: number = value.count;
        const name: string = value.name;
        assert.equal(count, 1);
        assert.equal(typeof name, "string");
      },
    });
  });

  it("rejects malformed command definitions", () => {
    assert.throws(
      () =>
        defineCommand({
          parser: {} as never,
          handler() {},
        }),
      /Command parser must be an Optique parser\./,
    );
    assert.throws(
      () =>
        defineCommand({
          parser: object({}),
          handler: undefined as never,
        }),
      /Command handler must be a function\./,
    );
  });
});

describe("discoverCommands()", () => {
  it("discovers nested command modules in deterministic order", async () => {
    const dir = await makeTempDir();
    try {
      await writeCommand(dir, ["user", "add.cmd.ts"], "add");
      await writeCommand(dir, ["build.cmd.ts"], "build");

      const commands = await discoverCommands({
        dir,
        extensions: [".cmd.ts"],
      });

      assert.deepEqual(commands.map((command) => command.path), [
        ["build"],
        ["user", "add"],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns commands sorted by command path after extension stripping", async () => {
    const dir = await makeTempDir();
    try {
      await writeCommand(dir, ["a-zzz.ts"], "a-zzz");
      await writeCommand(dir, ["a.cmd.ts"], "a");

      const commands = await discoverCommands({
        dir,
        extensions: [".cmd.ts", ".ts"],
      });

      assert.deepEqual(commands.map((command) => command.path), [
        ["a"],
        ["a-zzz"],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects duplicate command paths and file namespace conflicts", async () => {
    const duplicateDir = await makeTempDir();
    try {
      await writeCommand(duplicateDir, ["build.ts"], "build");
      await writeCommand(duplicateDir, ["build.cmd.ts"], "build");

      await assert.rejects(
        () =>
          discoverCommands({
            dir: duplicateDir,
            extensions: [".cmd.ts", ".ts"],
          }),
        /Duplicate command path "build"/,
      );
    } finally {
      await rm(duplicateDir, { recursive: true, force: true });
    }

    const conflictDir = await makeTempDir();
    try {
      await writeCommand(conflictDir, ["user.ts"], "user");
      await writeCommand(conflictDir, ["user", "add.ts"], "add");

      await assert.rejects(
        () => discoverCommands({ dir: conflictDir, extensions: [".ts"] }),
        /Command path "user" conflicts with nested command "user add"\./,
      );
    } finally {
      await rm(conflictDir, { recursive: true, force: true });
    }
  });

  it("rejects modules whose default export is not a command", async () => {
    const dir = await makeTempDir();
    try {
      await writeFile(join(dir, "bad.ts"), "export default {};\n");

      await assert.rejects(
        () => discoverCommands({ dir, extensions: [".ts"] }),
        /default export must be created with defineCommand\(\)\./,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("ignores TypeScript declaration files", async () => {
    const dir = await makeTempDir();
    try {
      await writeCommand(dir, ["build.ts"], "build");
      await writeFile(join(dir, "build.d.ts"), "export default {};\n");

      const commands = await discoverCommands({ dir, extensions: [".ts"] });

      assert.deepEqual(commands.map((command) => command.path), [["build"]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns runtime-aware extension defaults", () => {
    const nodeDefaults = getDefaultExtensions({
      runtime: "node",
      execArgv: [],
      nodeOptions: "",
      nodeTypeScriptSupport: false,
    });
    assert.deepEqual(nodeDefaults, [".js", ".mjs", ".cjs"]);

    const nodeNativeTsDefaults = getDefaultExtensions({
      runtime: "node",
      execArgv: [],
      nodeOptions: "",
      nodeTypeScriptSupport: true,
    });
    assert.deepEqual(nodeNativeTsDefaults, [
      ".js",
      ".mjs",
      ".cjs",
      ".ts",
      ".mts",
      ".cts",
    ]);

    const nodeTsDefaults = getDefaultExtensions({
      runtime: "node",
      execArgv: ["--import", "tsx"],
      nodeOptions: "",
      nodeTypeScriptSupport: false,
    });
    assert.deepEqual(nodeTsDefaults, [
      ".js",
      ".mjs",
      ".cjs",
      ".ts",
      ".mts",
      ".cts",
    ]);

    const denoDefaults = getDefaultExtensions({ runtime: "deno" });
    assert.deepEqual(denoDefaults, [".ts", ".mts", ".js", ".mjs"]);
  });
});

describe("createProgramParser()", () => {
  it("dispatches to the matched command handler with parsed values", async () => {
    const calls: unknown[] = [];
    const parser = createProgramParser([
      {
        path: ["build"],
        command: defineCommand({
          parser: object({
            target: option("--target", string()),
          }),
          metadata: { brief: message`Build the project.` },
          handler(value) {
            calls.push(value);
          },
        }),
      },
      {
        path: ["user", "add"],
        command: defineCommand({
          parser: object({
            name: option("--name", string()),
          }),
          metadata: { brief: message`Add a user.` },
          handler(value) {
            calls.push(value);
          },
        }),
      },
    ]);

    const state = await parseAll(parser, ["user", "add", "--name", "Ada"]);
    const result = await parser.complete(state);

    assert.equal(result.success, true);
    if (result.success) {
      await result.value.handler(result.value.value);
    }
    assert.deepEqual(calls, [{ name: "Ada" }]);
  });

  it("shows leaf command paths in root help", async () => {
    const parser = createProgramParser([
      {
        path: ["build"],
        command: defineCommand({
          parser: object({}),
          metadata: { brief: message`Build the project.` },
          handler() {},
        }),
      },
      {
        path: ["user", "add"],
        command: defineCommand({
          parser: object({}),
          metadata: { brief: message`Add a user.` },
          handler() {},
        }),
      },
    ], { brief: message`Project tool.` });

    const page = await getDocPageAsync(parser);
    assert.ok(page != null);
    const text = formatDocPage("tool", page);

    assert.match(text, /Usage: tool build/);
    assert.match(text, /tool user add/);
    assert.match(text, /build\s+Build the project\./);
    assert.match(text, /user add\s+Add a user\./);
  });

  it("rejects duplicate command paths", () => {
    const makeCommand = () =>
      defineCommand({
        parser: object({}),
        handler() {},
      });

    assert.throws(
      () =>
        createProgramParser([
          { path: ["build"], command: makeCommand() },
          { path: ["build"], command: makeCommand() },
        ]),
      /Duplicate command path "build"/,
    );
  });
});

describe("runProgram()", () => {
  it("runs the discovered command and waits for async handlers", async () => {
    const dir = await makeTempDir();
    const output = join(dir, "out.txt");
    try {
      await writeCommand(
        dir,
        ["write.ts"],
        "write",
        `
          import { writeFile } from "node:fs/promises";
          import { defineCommand } from "${moduleUrl("command.ts")}";
          import { object } from "${moduleUrl("../../core/src/constructs.ts")}";
          import { option } from "${moduleUrl("../../core/src/primitives.ts")}";
          import { string } from "${
          moduleUrl("../../core/src/valueparser.ts")
        }";

          export default defineCommand({
            parser: object({ value: option("--value", string()) }),
            async handler(value) {
              await writeFile(${JSON.stringify(output)}, value.value, "utf-8");
            },
          });
        `,
      );

      await runProgram({
        dir,
        extensions: [".ts"],
        metadata: { name: "tool", version: "1.0.0" },
        args: ["write", "--value", "done"],
        stdout() {},
        stderr() {},
        onExit(exitCode): never {
          throw new Error(`Unexpected exit ${exitCode}.`);
        },
      });

      const { readFile } = await import("node:fs/promises");
      assert.equal(await readFile(output, "utf-8"), "done");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not run handlers for help output", async () => {
    const dir = await makeTempDir();
    let stdout = "";
    try {
      await writeCommand(dir, ["build.ts"], "build");

      await assert.rejects(
        () =>
          runProgram({
            dir,
            extensions: [".ts"],
            metadata: { name: "tool", version: "1.0.0" },
            args: ["--help"],
            stdout(text) {
              stdout += `${text}\n`;
            },
            stderr() {},
            onExit(exitCode): never {
              throw new ExitSignal(exitCode);
            },
          }),
        ExitSignal,
      );

      assert.match(stdout, /Usage: tool build/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("shows nested leaf commands in root help output", async () => {
    const dir = await makeTempDir();
    let stdout = "";
    try {
      await writeCommand(dir, ["user", "add.ts"], "Add a user");
      await writeCommand(dir, ["user", "remove.ts"], "Remove a user");

      await assert.rejects(
        () =>
          runProgram({
            dir,
            extensions: [".ts"],
            metadata: { name: "tool", version: "1.0.0" },
            args: ["--help"],
            stdout(text) {
              stdout += `${text}\n`;
            },
            stderr() {},
            onExit(exitCode): never {
              throw new ExitSignal(exitCode);
            },
          }),
        ExitSignal,
      );

      assert.match(stdout, /Usage: tool user add/);
      assert.match(stdout, /user add\s+Add a user command\./);
      assert.match(stdout, /user remove\s+Remove a user command\./);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("passes command values to phase-two source contexts", async () => {
    const dir = await makeTempDir();
    const phase2Values: unknown[] = [];
    const context: SourceContext = {
      id: Symbol("test-context"),
      phase: "two-pass",
      getAnnotations(request) {
        if (request?.phase === "phase2") {
          phase2Values.push(request.parsed);
        }
        return {};
      },
    };
    try {
      await writeCommand(
        dir,
        ["show.ts"],
        "show",
        `
          import { defineCommand } from "${moduleUrl("command.ts")}";
          import { object } from "${moduleUrl("../../core/src/constructs.ts")}";
          import { withDefault } from "${
          moduleUrl("../../core/src/modifiers.ts")
        }";
          import { option } from "${moduleUrl("../../core/src/primitives.ts")}";
          import { string } from "${
          moduleUrl("../../core/src/valueparser.ts")
        }";

          export default defineCommand({
            parser: object({
              config: withDefault(option("--config", string()), "app.json"),
            }),
            handler() {},
          });
        `,
      );

      await runProgram({
        dir,
        extensions: [".ts"],
        metadata: { name: "tool", version: "1.0.0" },
        args: ["show"],
        contexts: [context],
        stdout() {},
        stderr() {},
        onExit(exitCode): never {
          throw new Error(`Unexpected exit ${exitCode}.`);
        },
      });

      assert.deepEqual(phase2Values, [{ config: "app.json" }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

class ExitSignal extends Error {
  constructor(readonly exitCode: number) {
    super(`Exited with ${exitCode}.`);
  }
}

async function makeTempDir(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return await mkdtemp(join(tmpdir(), "optique-discover-"));
}

async function writeCommand(
  baseDir: string,
  path: readonly string[],
  label: string,
  body = `
    import { defineCommand } from "${moduleUrl("command.ts")}";
    import { object } from "${moduleUrl("../../core/src/constructs.ts")}";
    import { message } from "${moduleUrl("../../core/src/message.ts")}";

    export default defineCommand({
      parser: object({}),
      metadata: { brief: message\`${label} command.\` },
      handler() {
        throw new Error("Handler should not run.");
      },
    });
  `,
): Promise<void> {
  const filePath = join(baseDir, ...path);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, body, "utf-8");
}

function moduleUrl(relative: string): string {
  return new URL(relative, import.meta.url).href;
}

async function parseAll(
  parser: ReturnType<typeof createProgramParser>,
  args: readonly string[],
): Promise<unknown> {
  let context = {
    buffer: args,
    state: parser.initialState,
    optionsTerminated: false,
    usage: parser.usage,
  };
  while (context.buffer.length > 0) {
    const result = await parser.parse(context);
    assert.equal(result.success, true);
    if (!result.success) break;
    context = result.next;
  }
  return context.state;
}
