import { object } from "@optique/core/constructs";
import { formatDocPage } from "@optique/core/doc";
import { formatMessage, message } from "@optique/core/message";
import { withDefault } from "@optique/core/modifiers";
import { getDocPageAsync, type ParserContext } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import type { SourceContext } from "@optique/core/context";
import { integer, string } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { defineCommand } from "#src/command.ts";
import {
  type CommandPath,
  createProgramParser,
  discoverCommands,
  getDefaultExtensions,
  runProgram,
} from "#src/index.ts";

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

  it("preserves static command paths", () => {
    const staticCommand = defineCommand({
      path: ["user", "add"],
      parser: object({
        name: option("--name", string()),
      }),
      handler(value) {
        const name: string = value.name;
        assert.equal(typeof name, "string");
      },
    });

    const path: CommandPath = staticCommand.path;
    assert.deepEqual(path, ["user", "add"]);
  });

  it("preserves static root command paths", () => {
    const staticCommand = defineCommand({
      path: [],
      parser: object({}),
      handler() {},
    });

    const path: CommandPath = staticCommand.path;
    assert.deepEqual(path, []);
  });

  it("rejects malformed command definitions", () => {
    assert.throws(
      () =>
        defineCommand({
          parser: {} as never,
          handler() {},
        }),
      {
        name: "TypeError",
        message: "Command parser must be an Optique parser.",
      },
    );
    assert.throws(
      () =>
        defineCommand({
          parser: object({}),
          handler: undefined as never,
        }),
      { name: "TypeError", message: "Command handler must be a function." },
    );
    assert.throws(
      () =>
        defineCommand({
          path: ["build", ""] as never,
          parser: object({}),
          handler() {},
        }),
      {
        name: "TypeError",
        message: "Command path must be an array of non-empty strings.",
      },
    );
    assert.throws(
      () =>
        defineCommand({
          path: [1] as never,
          parser: object({}),
          handler() {},
        }),
      {
        name: "TypeError",
        message: "Command path must be an array of non-empty strings.",
      },
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

  it("rejects duplicate command paths", async () => {
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
  });

  it("allows executable parent command files with nested commands", async () => {
    const dir = await makeTempDir();
    try {
      await writeCommand(dir, ["user.ts"], "user");
      await writeCommand(dir, ["user", "add.ts"], "add");

      const commands = await discoverCommands({ dir, extensions: [".ts"] });

      assert.deepEqual(commands.map((command) => command.path), [
        ["user"],
        ["user", "add"],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("maps entry files to containing command paths", async () => {
    const dir = await makeTempDir();
    try {
      await writeCommand(dir, ["index.ts"], "root");
      await writeCommand(dir, ["build.ts"], "build");
      await writeCommand(dir, ["stash", "index.ts"], "stash");
      await writeCommand(dir, ["stash", "list.ts"], "list");

      const commands = await discoverCommands({ dir, extensions: [".ts"] });

      assert.deepEqual(commands.map((command) => command.path), [
        [],
        ["build"],
        ["stash"],
        ["stash", "list"],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("supports custom and disabled entry file names", async () => {
    const modDir = await makeTempDir();
    try {
      await writeCommand(modDir, ["mod.ts"], "root");
      await writeCommand(modDir, ["stash", "mod.ts"], "stash");

      const commands = await discoverCommands({
        dir: modDir,
        extensions: [".ts"],
        entryFileName: "mod",
      });

      assert.deepEqual(commands.map((command) => command.path), [
        [],
        ["stash"],
      ]);
    } finally {
      await rm(modDir, { recursive: true, force: true });
    }

    const indexDir = await makeTempDir();
    try {
      await writeCommand(indexDir, ["index.ts"], "index");
      await writeCommand(indexDir, ["stash", "index.ts"], "stash-index");

      const commands = await discoverCommands({
        dir: indexDir,
        extensions: [".ts"],
        entryFileName: false,
      });

      assert.deepEqual(commands.map((command) => command.path), [
        ["index"],
        ["stash", "index"],
      ]);
    } finally {
      await rm(indexDir, { recursive: true, force: true });
    }
  });

  it("rejects malformed entry file names", async () => {
    const dir = await makeTempDir();
    try {
      await assert.rejects(
        () =>
          discoverCommands({
            dir,
            entryFileName: null as never,
          }),
        {
          name: "TypeError",
          message:
            "Command entry file name must be a non-empty file name: null",
        },
      );
      await assert.rejects(
        () =>
          discoverCommands({
            dir,
            entryFileName: "",
          }),
        {
          name: "TypeError",
          message: "Command entry file name must be a non-empty file name: ",
        },
      );
      await assert.rejects(
        () =>
          discoverCommands({
            dir,
            entryFileName: "mod/index",
          }),
        {
          name: "TypeError",
          message:
            "Command entry file name must be a non-empty file name: mod/index",
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects duplicate root entry command paths", async () => {
    const dir = await makeTempDir();
    try {
      await writeCommand(dir, ["index.ts"], "root");
      await writeCommand(dir, ["index.cmd.ts"], "root");

      await assert.rejects(
        () =>
          discoverCommands({
            dir,
            extensions: [".cmd.ts", ".ts"],
          }),
        /Duplicate command path "<root>"/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("keeps command path segments distinct when they contain spaces", async () => {
    const dir = await makeTempDir();
    try {
      await writeCommand(dir, ["foo bar", "c.ts"], "foo-bar-c");
      await writeCommand(dir, ["foo", "bar c.ts"], "foo-bar-c");

      const commands = await discoverCommands({ dir, extensions: [".ts"] });

      assert.deepEqual(commands.map((command) => command.path), [
        ["foo bar", "c"],
        ["foo", "bar c"],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
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

  it("unwraps CommonJS default-wrapped command exports", async () => {
    const dir = await makeTempDir();
    const globalCommand = defineCommand({
      parser: object({}),
      metadata: { brief: message`Build the project.` },
      handler() {},
    });
    const testGlobal = globalThis as {
      __optiqueDiscoverDefaultWrappedCommand?: unknown;
    };
    testGlobal.__optiqueDiscoverDefaultWrappedCommand = globalCommand;
    try {
      await writeFile(
        join(dir, "build.cjs"),
        `
          module.exports = {
            default: globalThis.__optiqueDiscoverDefaultWrappedCommand,
          };
        `,
      );

      const commands = await discoverCommands({ dir, extensions: [".cjs"] });

      assert.deepEqual(commands.map((command) => command.path), [["build"]]);
      assert.equal(commands[0]?.command, globalCommand);
    } finally {
      delete testGlobal.__optiqueDiscoverDefaultWrappedCommand;
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("follows symlinked command files and directories", async () => {
    const dir = await makeTempDir();
    try {
      const targetDir = join(dir, "targets");
      await writeCommand(targetDir, ["build.ts"], "build");
      await writeCommand(targetDir, ["deploy.ts"], "deploy");
      await symlink(
        join(targetDir, "build.ts"),
        join(dir, "linked-build.ts"),
      );
      await symlink(targetDir, join(dir, "linked"));
      await symlink(dir, join(targetDir, "loop"));

      const commands = await discoverCommands({ dir, extensions: [".ts"] });

      assert.deepEqual(commands.map((command) => command.path), [
        ["linked-build"],
        ["linked", "build"],
        ["linked", "deploy"],
        ["targets", "build"],
        ["targets", "deploy"],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects declared paths that do not match file-derived paths", async () => {
    const dir = await makeTempDir();
    try {
      await writeCommand(
        dir,
        ["build.ts"],
        "build",
        `
          import { defineCommand } from "${
          runtimeModuleUrl("command.ts", "../dist/command.js")
        }";
          import { object } from "${
          runtimeModuleUrl(
            "../../core/src/constructs.ts",
            "../../core/dist/constructs.js",
          )
        }";

          export default defineCommand({
            path: ["deploy"],
            parser: object({}),
            handler() {},
          });
        `,
      );

      await assert.rejects(
        () => discoverCommands({ dir, extensions: [".ts"] }),
        /declares command path "deploy" but file path defines "build"\./,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts declared paths that match file-derived paths", async () => {
    const dir = await makeTempDir();
    try {
      await writeCommand(
        dir,
        ["user", "add.ts"],
        "add",
        `
          import { defineCommand } from "${
          runtimeModuleUrl("command.ts", "../dist/command.js")
        }";
          import { object } from "${
          runtimeModuleUrl(
            "../../core/src/constructs.ts",
            "../../core/dist/constructs.js",
          )
        }";

          export default defineCommand({
            path: ["user", "add"],
            parser: object({}),
            handler() {},
          });
        `,
      );

      const commands = await discoverCommands({ dir, extensions: [".ts"] });

      assert.deepEqual(commands.map((command) => command.path), [
        ["user", "add"],
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts declared root paths that match entry files", async () => {
    const dir = await makeTempDir();
    try {
      await writeCommand(
        dir,
        ["index.ts"],
        "root",
        `
          import { defineCommand } from "${
          runtimeModuleUrl("command.ts", "../dist/command.js")
        }";
          import { object } from "${
          runtimeModuleUrl(
            "../../core/src/constructs.ts",
            "../../core/dist/constructs.js",
          )
        }";

          export default defineCommand({
            path: [],
            parser: object({}),
            handler() {},
          });
        `,
      );

      const commands = await discoverCommands({ dir, extensions: [".ts"] });

      assert.deepEqual(commands.map((command) => command.path), [
        [],
      ]);
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

    assert.ok(result.success);
    if (result.success) {
      await result.value.handler(result.value.value);
    }
    assert.deepEqual(calls, [{ name: "Ada" }]);
  });

  it("dispatches executable parent commands and nested commands", async () => {
    const calls: unknown[] = [];
    const parser = createProgramParser([
      {
        path: ["stash"],
        command: defineCommand({
          parser: object({
            message: withDefault(option("--message", string()), "parent"),
          }),
          metadata: { brief: message`Stash changes.` },
          handler(value) {
            calls.push(["stash", value]);
          },
        }),
      },
      {
        path: ["stash", "list"],
        command: defineCommand({
          parser: object({
            limit: withDefault(option("--limit", integer()), 10),
          }),
          metadata: { brief: message`List stashes.` },
          handler(value) {
            calls.push(["stash list", value]);
          },
        }),
      },
    ]);

    const parentState = await parseAll(parser, ["stash", "--message", "wip"]);
    const parentResult = await parser.complete(parentState);
    assert.ok(parentResult.success);
    if (parentResult.success) {
      await parentResult.value.handler(parentResult.value.value);
    }

    const childState = await parseAll(parser, [
      "stash",
      "list",
      "--limit",
      "3",
    ]);
    const childResult = await parser.complete(childState);
    assert.ok(childResult.success);
    if (childResult.success) {
      await childResult.value.handler(childResult.value.value);
    }

    assert.deepEqual(calls, [
      ["stash", { message: "wip" }],
      ["stash list", { limit: 3 }],
    ]);
  });

  it("does not switch to nested commands after parsing parent arguments", async () => {
    const calls: unknown[] = [];
    const parser = createProgramParser([
      {
        path: ["stash"],
        command: defineCommand({
          parser: object({
            message: withDefault(option("--message", string()), "parent"),
          }),
          handler(value) {
            calls.push(["stash", value]);
          },
        }),
      },
      {
        path: ["stash", "list"],
        command: defineCommand({
          parser: object({}),
          handler(value) {
            calls.push(["stash list", value]);
          },
        }),
      },
    ]);

    let context: ParserContext<unknown> = {
      buffer: ["stash", "--message", "wip", "list"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    };
    let failed = false;
    while (context.buffer.length > 0) {
      const result = await parser.parse(context);
      if (!result.success) {
        failed = true;
        break;
      }
      context = result.next;
    }

    assert.ok(failed);
    assert.deepEqual(calls, []);
  });

  it("dispatches root commands alongside nested commands", async () => {
    const calls: unknown[] = [];
    const parser = createProgramParser([
      {
        path: [],
        command: defineCommand({
          parser: object({
            name: option("--name", string()),
          }),
          metadata: { brief: message`Create an app.` },
          handler(value) {
            calls.push(["root", value]);
          },
        }),
      },
      {
        path: ["build"],
        command: defineCommand({
          parser: object({}),
          metadata: { brief: message`Build the app.` },
          handler(value) {
            calls.push(["build", value]);
          },
        }),
      },
    ]);

    const rootState = await parseAll(parser, ["--name", "demo"]);
    const rootResult = await parser.complete(rootState);
    assert.ok(rootResult.success);
    if (rootResult.success) {
      await rootResult.value.handler(rootResult.value.value);
    }

    const buildState = await parseAll(parser, ["build"]);
    const buildResult = await parser.complete(buildState);
    assert.ok(buildResult.success);
    if (buildResult.success) {
      await buildResult.value.handler(buildResult.value.value);
    }

    assert.deepEqual(calls, [
      ["root", { name: "demo" }],
      ["build", {}],
    ]);
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

  it("shows root command options and nested commands in root help", async () => {
    const parser = createProgramParser([
      {
        path: [],
        command: defineCommand({
          parser: object({
            name: option("--name", string()),
          }),
          metadata: { brief: message`Create an app.` },
          handler() {},
        }),
      },
      {
        path: ["build"],
        command: defineCommand({
          parser: object({}),
          metadata: { brief: message`Build the app.` },
          handler() {},
        }),
      },
    ], { brief: message`Project tool.` });

    const page = await getDocPageAsync(parser);
    assert.ok(page != null);
    const text = formatDocPage("tool", page);

    assert.match(text, /--name/);
    assert.match(text, /build\s+Build the app\./);
    assert.doesNotMatch(text, /^\s+Create an app\./m);
  });

  it("keeps executable parent metadata out of nested command help", async () => {
    const parser = createProgramParser([
      {
        path: ["stash"],
        command: defineCommand({
          parser: object({
            message: withDefault(option("--message", string()), "parent"),
          }),
          metadata: {
            description: message`Manage saved changes.`,
            footer: message`Use stash list to inspect entries.`,
            hidden: "usage",
            usageLine: [{ type: "literal", value: "stash-usage" }],
          },
          handler() {},
        }),
      },
      {
        path: ["stash", "list"],
        command: defineCommand({
          parser: object({}),
          metadata: { brief: message`List saved changes.` },
          handler() {},
        }),
      },
    ]);

    const page = await getDocPageAsync(parser, ["stash", "list"]);
    assert.ok(page != null);
    const text = formatDocPage("git", page);

    assert.match(text, /Usage: git stash list/);
    assert.match(text, /List saved changes\./);
    assert.doesNotMatch(text, /Manage saved changes\./);

    const parentPage = await getDocPageAsync(parser, [
      "stash",
      "--message",
      "wip",
    ]);
    assert.ok(parentPage != null);
    const parentText = formatDocPage("git", parentPage);

    assert.match(parentText, /Manage saved changes\./);

    const usageLinePage = await getDocPageAsync(parser, ["stash"]);
    assert.ok(usageLinePage != null);
    const usageLineText = formatDocPage("git", usageLinePage);

    assert.match(usageLineText, /Usage: git stash stash-usage/);
    assert.match(usageLineText, /Manage saved changes\./);
    assert.match(usageLineText, /Use stash list to inspect entries\./);
  });

  it("dispatches executable parent command aliases", async () => {
    const calls: unknown[] = [];
    const parser = createProgramParser([
      {
        path: ["stash"],
        command: defineCommand({
          parser: object({
            message: withDefault(option("--message", string()), "parent"),
          }),
          metadata: { aliases: ["st"] },
          handler(value) {
            calls.push(["stash", value]);
          },
        }),
      },
      {
        path: ["stash", "list"],
        command: defineCommand({
          parser: object({}),
          handler(value) {
            calls.push(["stash list", value]);
          },
        }),
      },
    ]);

    const parentState = await parseAll(parser, ["st", "--message", "wip"]);
    const parentResult = await parser.complete(parentState);
    assert.ok(parentResult.success);
    if (parentResult.success) {
      await parentResult.value.handler(parentResult.value.value);
    }

    const childState = await parseAll(parser, ["st", "list"]);
    const childResult = await parser.complete(childState);
    assert.ok(childResult.success);
    if (childResult.success) {
      await childResult.value.handler(childResult.value.value);
    }

    assert.deepEqual(calls, [
      ["stash", { message: "wip" }],
      ["stash list", {}],
    ]);
  });

  it("uses executable parent command errors for namespaces", async () => {
    const parser = createProgramParser([
      {
        path: ["stash"],
        command: defineCommand({
          parser: object({}),
          metadata: {
            errors: { notMatched: message`Choose stash.` },
          },
          handler() {},
        }),
      },
      {
        path: ["stash", "list"],
        command: defineCommand({
          parser: object({}),
          handler() {},
        }),
      },
    ]);

    const result = await parser.parse({
      buffer: ["stahs"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: parser.usage,
    });

    assert.ok(!result.success);
    if (!result.success) {
      assert.equal(formatMessage(result.error), "Choose stash.");
    }
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

  it("does not collapse distinct static paths before validation", () => {
    const makeCommand = () =>
      defineCommand({
        parser: object({}),
        handler() {},
      });

    assert.throws(
      () =>
        createProgramParser([
          { path: ["foo bar", "c"], command: makeCommand() },
          { path: ["foo", "bar c"], command: makeCommand() },
        ]),
      /Command name must not contain whitespace: "foo bar"\./,
    );
  });
});

describe("runProgram()", () => {
  it("runs statically registered commands and waits for async handlers", async () => {
    const calls: unknown[] = [];
    const writeCommand = defineCommand({
      path: ["write"],
      parser: object({
        value: option("--value", string()),
      }),
      async handler(value) {
        await Promise.resolve();
        calls.push(value);
      },
    });

    await runProgram({
      commands: [writeCommand],
      metadata: { name: "tool", version: "1.0.0" },
      args: ["write", "--value", "done"],
      stdout() {},
      stderr() {},
      onExit(exitCode): never {
        throw new Error(`Unexpected exit ${exitCode}.`);
      },
    });

    assert.deepEqual(calls, [{ value: "done" }]);
  });

  it("runs statically registered root commands", async () => {
    const calls: unknown[] = [];
    const createCommand = defineCommand({
      path: [],
      parser: object({
        name: option("--name", string()),
      }),
      handler(value) {
        calls.push(value);
      },
    });

    await runProgram({
      commands: [createCommand],
      metadata: { name: "create-demo", version: "1.0.0" },
      args: ["--name", "demo"],
      stdout() {},
      stderr() {},
      onExit(exitCode): never {
        throw new Error(`Unexpected exit ${exitCode}.`);
      },
    });

    assert.deepEqual(calls, [{ name: "demo" }]);
  });

  it("shows statically registered nested commands in root help", async () => {
    const addCommand = defineCommand({
      path: ["user", "add"],
      parser: object({}),
      metadata: { brief: message`Add a user.` },
      handler() {},
    });
    const removeCommand = defineCommand({
      path: ["user", "remove"],
      parser: object({}),
      metadata: { brief: message`Remove a user.` },
      handler() {},
    });
    let stdout = "";

    await assert.rejects(
      () =>
        runProgram({
          commands: [addCommand, removeCommand],
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
    assert.match(stdout, /user add\s+Add a user\./);
    assert.match(stdout, /user remove\s+Remove a user\./);
  });

  it("passes static command values to phase-two source contexts", async () => {
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
    const showCommand = defineCommand({
      path: ["show"],
      parser: object({
        config: withDefault(option("--config", string()), "app.json"),
      }),
      handler() {},
    });

    await runProgram({
      commands: [showCommand],
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
  });

  it("rejects ambiguous command sources", async () => {
    await assert.rejects(
      () =>
        runProgram({
          dir: ".",
          commands: [],
          metadata: { name: "tool" },
        } as never),
      /runProgram\(\) requires exactly one of dir or commands\./,
    );

    await assert.rejects(
      () =>
        runProgram({
          metadata: { name: "tool" },
        } as never),
      /runProgram\(\) requires exactly one of dir or commands\./,
    );
  });

  it("rejects static command values not created by defineCommand()", async () => {
    await assert.rejects(
      () =>
        runProgram({
          commands: [{
            path: ["build"],
            parser: object({}),
            handler() {},
          }] as never,
          metadata: { name: "tool" },
          args: ["build"],
          stdout() {},
          stderr() {},
          onExit(exitCode): never {
            throw new Error(`Unexpected exit ${exitCode}.`);
          },
        }),
      {
        name: "TypeError",
        message: "Static command entries must be created with defineCommand().",
      },
    );
  });

  it("rejects static commands without declared paths", async () => {
    const command = defineCommand({
      parser: object({}),
      handler() {},
    });

    await assert.rejects(
      () =>
        runProgram({
          commands: [command] as never,
          metadata: { name: "tool" },
          args: ["build"],
          stdout() {},
          stderr() {},
          onExit(exitCode): never {
            throw new Error(`Unexpected exit ${exitCode}.`);
          },
        }),
      {
        name: "TypeError",
        message: "Static command entries must declare a path.",
      },
    );
  });

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
          import { defineCommand } from "${
          runtimeModuleUrl("command.ts", "../dist/command.js")
        }";
          import { object } from "${
          runtimeModuleUrl(
            "../../core/src/constructs.ts",
            "../../core/dist/constructs.js",
          )
        }";
          import { option } from "${
          runtimeModuleUrl(
            "../../core/src/primitives.ts",
            "../../core/dist/primitives.js",
          )
        }";
          import { string } from "${
          runtimeModuleUrl(
            "../../core/src/valueparser.ts",
            "../../core/dist/valueparser.js",
          )
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
          import { defineCommand } from "${
          runtimeModuleUrl("command.ts", "../dist/command.js")
        }";
          import { object } from "${
          runtimeModuleUrl(
            "../../core/src/constructs.ts",
            "../../core/dist/constructs.js",
          )
        }";
          import { withDefault } from "${
          runtimeModuleUrl(
            "../../core/src/modifiers.ts",
            "../../core/dist/modifiers.js",
          )
        }";
          import { option } from "${
          runtimeModuleUrl(
            "../../core/src/primitives.ts",
            "../../core/dist/primitives.js",
          )
        }";
          import { string } from "${
          runtimeModuleUrl(
            "../../core/src/valueparser.ts",
            "../../core/dist/valueparser.js",
          )
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
  readonly exitCode: number;

  constructor(exitCode: number) {
    super(`Exited with ${exitCode}.`);
    this.exitCode = exitCode;
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
    import { defineCommand } from "${
    runtimeModuleUrl("command.ts", "../dist/command.js")
  }";
    import { object } from "${
    runtimeModuleUrl(
      "../../core/src/constructs.ts",
      "../../core/dist/constructs.js",
    )
  }";
    import { message } from "${
    runtimeModuleUrl("../../core/src/message.ts", "../../core/dist/message.js")
  }";

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

function runtimeModuleUrl(
  sourceRelative: string,
  nodeRelative: string,
): string {
  const runtime = globalThis as {
    readonly Bun?: unknown;
    readonly Deno?: unknown;
    readonly process?: { readonly release?: { readonly name?: string } };
  };
  const isNode = runtime.process?.release?.name === "node" &&
    runtime.Bun === undefined &&
    runtime.Deno === undefined;
  return moduleUrl(isNode ? nodeRelative : sourceRelative);
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
    assert.ok(result.success);
    if (!result.success) break;
    context = result.next;
  }
  return context.state;
}
