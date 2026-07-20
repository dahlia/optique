import { object } from "@optique/core/constructs";
import { getAnnotations } from "@optique/core/annotations";
import { dependency } from "@optique/core/dependency";
import { formatDocPage } from "@optique/core/doc";
import {
  defineTraits,
  inheritAnnotations,
  injectAnnotations,
} from "@optique/core/extension";
import { formatMessage, message } from "@optique/core/message";
import { withDefault } from "@optique/core/modifiers";
import {
  getDocPageAsync,
  type Parser,
  type ParserContext,
  type ParserResult,
  suggestAsync,
} from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import type { OptionName } from "@optique/core/usage";
import type { SourceContext } from "@optique/core/context";
import {
  choice,
  integer,
  string,
  type ValueParserResult,
} from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { defineCommand } from "#src/command.ts";
import {
  type AnyStaticCommand,
  type CommandPath,
  commandsFromModules,
  createProgramParser,
  discoverCommands,
  getDefaultExtensions,
  type ProgramHookContext,
  type ProgramHooks,
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

  it("should reject non-object command definitions", () => {
    assert.throws(
      () => defineCommand([] as never),
      { name: "TypeError", message: "Expected object, got array." },
    );
    assert.throws(
      () => defineCommand(null as never),
      { name: "TypeError", message: "Expected object." },
    );
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
    assert.throws(
      () =>
        defineCommand({
          parser: object({}),
          hooks: "nope" as never,
          handler() {},
        }),
      { name: "TypeError", message: "Command hooks must be an object." },
    );
    assert.throws(
      () =>
        defineCommand({
          parser: object({}),
          hooks: [] as never,
          handler() {},
        }),
      {
        name: "TypeError",
        message: "Command hooks must be an object, not an array.",
      },
    );
    assert.throws(
      () =>
        defineCommand({
          parser: object({}),
          hooks: { beforeEach: "nope" as never },
          handler() {},
        }),
      {
        name: "TypeError",
        message: 'Command hook "beforeEach" must be a function.',
      },
    );
  });

  it("accepts a command with lifecycle hooks", () => {
    const order: string[] = [];
    const cmd = defineCommand({
      parser: object({}),
      hooks: {
        beforeEach() {
          order.push("before");
          return { resource: order };
        },
      },
      handler() {},
    });
    assert.equal(typeof cmd.hooks?.beforeEach, "function");
    assert.deepEqual(order, []);
  });

  it("infers command hook resources in hooks and handlers", () => {
    const cmd = defineCommand({
      parser: object({}),
      hooks: {
        beforeEach() {
          return { resource: { label: "command" } };
        },
        afterEach(context) {
          const label: string | undefined = context.resource?.label;
          assert.equal(label, "command");
        },
        onError(context) {
          const label: string | undefined = context.resource?.label;
          assert.equal(label, "command");
        },
      },
      handler(_value, context) {
        const label: string | undefined = context?.resource?.label;
        assert.equal(label, "command");
      },
    });

    assert.equal(typeof cmd.hooks?.beforeEach, "function");
  });

  it("rejects mismatched command hook resources", () => {
    interface CommandResource {
      readonly label: string;
    }

    const hooks: ProgramHooks<CommandResource> = {
      // @ts-expect-error: beforeEach must produce CommandResource.
      beforeEach() {
        return { resource: { count: 1 } };
      },
    };

    assert.equal(typeof hooks.beforeEach, "function");
  });
});

describe("runProgram() hook resource types", () => {
  it("types program hooks and discovered command contexts", () => {
    interface AppResource {
      readonly label: string;
    }

    const run = () =>
      runProgram<AppResource>({
        dir: new URL("./commands/", import.meta.url),
        metadata: { name: "tasks" },
        hooks: {
          beforeEach() {
            return { resource: { label: "program" } };
          },
          afterEach(context) {
            const label: string | undefined = context.resource?.label;
            assert.equal(label, "program");
          },
          onError(context) {
            const label: string | undefined = context.resource?.label;
            assert.equal(label, "program");
          },
        },
      });
    const handle = (
      _value: unknown,
      context?: ProgramHookContext<AppResource>,
    ) => {
      const label: string | undefined = context?.resource?.label;
      assert.equal(label, "program");
    };

    assert.equal(typeof run, "function");
    assert.equal(typeof handle, "function");
  });

  it("should reject mismatched static command handler resources", () => {
    interface AppResource {
      readonly label: string;
    }

    interface OtherResource {
      readonly count: number;
    }

    const command = defineCommand({
      path: ["show"],
      parser: object({}),
      handler(
        _value,
        context?: ProgramHookContext<OtherResource>,
      ) {
        assert.equal(context?.resource?.count, 1);
      },
    });
    const run = () =>
      runProgram<AppResource>({
        // @ts-expect-error: the handler must consume AppResource.
        commands: [command],
        metadata: { name: "tasks" },
        hooks: {
          beforeEach() {
            return { resource: { label: "program" } };
          },
        },
      });
    const runEntry = () =>
      runProgram<AppResource>({
        // @ts-expect-error: command entries must preserve AppResource.
        commands: [{ path: ["show"], command }],
        metadata: { name: "tasks" },
        hooks: {
          beforeEach() {
            return { resource: { label: "program" } };
          },
        },
      });
    const inferredRun = () =>
      runProgram({
        // @ts-expect-error: hooks infer AppResource for static handlers.
        commands: [command],
        metadata: { name: "tasks" },
        hooks: {
          beforeEach() {
            return { resource: { label: "program" } };
          },
        },
      });

    assert.equal(typeof run, "function");
    assert.equal(typeof runEntry, "function");
    assert.equal(typeof inferredRun, "function");
  });

  it("should allow a static command to provide its own resource", () => {
    interface AppResource {
      readonly label: string;
    }

    const programCommand = defineCommand({
      path: ["list"],
      parser: object({}),
      handler(
        _value,
        context?: ProgramHookContext<AppResource>,
      ) {
        assert.equal(context?.resource?.label, "program");
      },
    });
    const contextFreeCommand = defineCommand({
      path: ["help"],
      parser: object({}),
      handler() {},
    });
    const commandWithoutBeforeEach = defineCommand({
      path: ["check"],
      parser: object({}),
      hooks: {
        afterEach() {},
      },
      handler() {},
    });
    const ownResourceCommand = defineCommand({
      path: ["show"],
      parser: object({}),
      hooks: {
        beforeEach() {
          return { resource: { count: 1 } };
        },
      },
      handler(_value, context) {
        const count: number | undefined = context?.resource?.count;
        assert.equal(count, 1);
      },
    });
    const run = () =>
      runProgram<AppResource>({
        commands: [
          programCommand,
          contextFreeCommand,
          commandWithoutBeforeEach,
          ownResourceCommand,
        ],
        metadata: { name: "tasks" },
        hooks: {
          beforeEach() {
            return { resource: { label: "program" } };
          },
        },
      });

    assert.equal(typeof run, "function");
  });

  it("rejects mismatched program hook resources", () => {
    interface AppResource {
      readonly label: string;
    }

    interface OtherResource {
      readonly count: number;
    }

    const run = () =>
      runProgram<AppResource>({
        dir: new URL("./commands/", import.meta.url),
        metadata: { name: "tasks" },
        hooks: {
          // @ts-expect-error: beforeEach must produce AppResource.
          beforeEach() {
            return { resource: { count: 1 } };
          },
        },
      });
    const hooks: ProgramHooks<AppResource> = {
      // @ts-expect-error: later hooks must consume AppResource.
      afterEach(context: ProgramHookContext<OtherResource>) {
        assert.equal(context.resource?.count, 1);
      },
    };

    assert.equal(typeof run, "function");
    assert.equal(typeof hooks.afterEach, "function");
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

  it("skips co-located test and spec files", async () => {
    const dir = await makeTempDir();
    try {
      await writeCommand(dir, ["build.ts"], "build");
      await writeFile(join(dir, "build.test.ts"), "export default {};\n");
      await writeFile(join(dir, "build.spec.ts"), "export default {};\n");

      const commands = await discoverCommands({ dir, extensions: [".ts"] });

      assert.deepEqual(commands.map((command) => command.path), [["build"]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips test files even when they export a command", async () => {
    const dir = await makeTempDir();
    try {
      await writeCommand(dir, ["greet.ts"], "greet");
      await writeCommand(dir, ["greet.test.ts"], "greet test");

      const commands = await discoverCommands({ dir, extensions: [".ts"] });

      assert.deepEqual(commands.map((command) => command.path), [["greet"]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("skips test and spec files for non-TypeScript extensions", async () => {
    const dir = await makeTempDir();
    try {
      await writeCommand(dir, ["build.js"], "build");
      await writeFile(join(dir, "build.test.js"), "export default {};\n");
      await writeFile(join(dir, "build.spec.js"), "export default {};\n");

      const commands = await discoverCommands({ dir, extensions: [".js"] });

      assert.deepEqual(commands.map((command) => command.path), [["build"]]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("does not skip command files whose names merely contain test or spec", async () => {
    const dir = await makeTempDir();
    try {
      await writeCommand(dir, ["test.ts"], "test");
      await writeCommand(dir, ["spec.ts"], "spec");
      await writeCommand(dir, ["latest.ts"], "latest");
      await writeCommand(dir, ["manifest.ts"], "manifest");

      const commands = await discoverCommands({ dir, extensions: [".ts"] });

      assert.deepEqual(commands.map((command) => command.path), [
        ["latest"],
        ["manifest"],
        ["spec"],
        ["test"],
      ]);
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

describe("commandsFromModules()", () => {
  it("should reject non-object module maps", () => {
    assert.throws(
      () => commandsFromModules([] as never),
      { name: "TypeError", message: "Expected object, got array." },
    );
    assert.throws(
      () => commandsFromModules(null as never),
      { name: "TypeError", message: "Expected object." },
    );
  });

  it("derives command paths from static module map keys", () => {
    const buildCommand = makeCommand();
    const addCommand = makeCommand();

    const commands = commandsFromModules({
      "./commands/user/add.ts": { default: addCommand },
      "./commands/build.ts": { default: buildCommand },
    }, {
      base: "./commands",
      extensions: [".ts"],
    });

    assert.deepEqual(commands.map((command) => command.path), [
      ["build"],
      ["user", "add"],
    ]);
    assert.equal(commands[0]?.command, buildCommand);
    assert.equal(commands[1]?.command, addCommand);
  });

  it("maps entry files to containing command paths", () => {
    const rootCommand = makeCommand();
    const stashCommand = makeCommand();
    const listCommand = makeCommand();

    const commands = commandsFromModules({
      "./commands/stash/list.ts": { default: listCommand },
      "./commands/index.ts": { default: rootCommand },
      "./commands/stash/index.ts": { default: stashCommand },
    }, {
      base: "./commands",
      extensions: [".ts"],
    });

    assert.deepEqual(commands.map((command) => command.path), [
      [],
      ["stash"],
      ["stash", "list"],
    ]);
    assert.equal(commands[0]?.command, rootCommand);
    assert.equal(commands[1]?.command, stashCommand);
    assert.equal(commands[2]?.command, listCommand);
  });

  it("matches compound extension precedence and ignores declaration files", () => {
    const commandCommand = makeCommand();
    const zzzCommand = makeCommand();

    const commands = commandsFromModules({
      "./commands/a.d.ts": { default: makeCommand() },
      "./commands/a.cmd.ts": { default: commandCommand },
      "./commands/a-zzz.ts": { default: zzzCommand },
    }, {
      base: "./commands",
      extensions: [".ts", ".cmd.ts"],
    });

    assert.deepEqual(commands.map((command) => command.path), [
      ["a"],
      ["a-zzz"],
    ]);
    assert.equal(commands[0]?.command, commandCommand);
    assert.equal(commands[1]?.command, zzzCommand);
  });

  it("ignores co-located test and spec module keys", () => {
    const buildCommand = makeCommand();

    const commands = commandsFromModules({
      "./commands/build.ts": { default: buildCommand },
      "./commands/build.test.ts": { default: makeCommand() },
      "./commands/build.spec.ts": { default: makeCommand() },
    }, {
      base: "./commands",
      extensions: [".ts"],
    });

    assert.deepEqual(commands.map((command) => command.path), [["build"]]);
    assert.equal(commands[0]?.command, buildCommand);
  });

  it("supports custom and disabled entry file names", () => {
    const modCommands = commandsFromModules({
      "./commands/mod.ts": { default: makeCommand() },
      "./commands/stash/mod.ts": { default: makeCommand() },
    }, {
      base: "./commands",
      extensions: [".ts"],
      entryFileName: "mod",
    });

    assert.deepEqual(modCommands.map((command) => command.path), [
      [],
      ["stash"],
    ]);

    const indexCommands = commandsFromModules({
      "./commands/index.ts": { default: makeCommand() },
      "./commands/stash/index.ts": { default: makeCommand() },
    }, {
      base: "./commands",
      extensions: [".ts"],
      entryFileName: false,
    });

    assert.deepEqual(indexCommands.map((command) => command.path), [
      ["index"],
      ["stash", "index"],
    ]);
  });

  it("rejects duplicate command paths", () => {
    assert.throws(
      () =>
        commandsFromModules({
          "./commands/build.ts": { default: makeCommand() },
          "./commands/build.cmd.ts": { default: makeCommand() },
        }, {
          base: "./commands",
          extensions: [".cmd.ts", ".ts"],
        }),
      /Duplicate command path "build" from \.\/commands\/build\.cmd\.ts and \.\/commands\/build\.ts\./,
    );
  });

  it("rejects modules whose default export is not a command", () => {
    assert.throws(
      () =>
        commandsFromModules({
          "./commands/bad.ts": {},
        }, {
          base: "./commands",
          extensions: [".ts"],
        }),
      {
        name: "TypeError",
        message:
          "Module ./commands/bad.ts default export must be created with defineCommand().",
      },
    );
  });

  it("unwraps CommonJS default-wrapped command exports", () => {
    const buildCommand = makeCommand();

    const commands = commandsFromModules({
      "./commands/build.cjs": { default: { default: buildCommand } },
    }, {
      base: "./commands",
      extensions: [".cjs"],
    });

    assert.deepEqual(commands.map((command) => command.path), [["build"]]);
    assert.equal(commands[0]?.command, buildCommand);
  });

  it("rejects declared paths that do not match module-derived paths", () => {
    assert.throws(
      () =>
        commandsFromModules({
          "./commands/build.ts": {
            default: defineCommand({
              path: ["deploy"],
              parser: object({}),
              handler() {},
            }),
          },
        }, {
          base: "./commands",
          extensions: [".ts"],
        }),
      /declares command path "deploy" but module path defines "build"\./,
    );
  });

  it("works with createProgramParser() for help and dispatch", async () => {
    const calls: unknown[] = [];
    const commands = commandsFromModules({
      "./commands/index.ts": {
        default: defineCommand({
          parser: object({
            name: option("--name", string()),
          }),
          metadata: { brief: message`Create an app.` },
          handler(value) {
            calls.push(["root", value]);
          },
        }),
      },
      "./commands/build.ts": {
        default: defineCommand({
          parser: object({}),
          metadata: { brief: message`Build the app.` },
          handler(value) {
            calls.push(["build", value]);
          },
        }),
      },
    }, {
      base: "./commands",
      extensions: [".ts"],
    });
    const parser = createProgramParser(commands);

    const page = await getDocPageAsync(parser);
    assert.ok(page != null);
    const text = formatDocPage("tool", page);
    assert.match(text, /--name/);
    assert.match(text, /build\s+Build the app\./);

    const state = await parseAll(parser, ["build"]);
    const result = await parser.complete(state);
    assert.ok(result.success);
    if (result.success) {
      await result.value.handler(result.value.value);
    }
    assert.deepEqual(calls, [["build", {}]]);
  });
});

describe("createProgramParser()", () => {
  it("returns a fluent parser", () => {
    const parser = createProgramParser([
      {
        path: ["build"],
        command: defineCommand({
          parser: object({}),
          metadata: { brief: message`Build the project.` },
          handler() {},
        }),
      },
    ]).map((value) => value);

    assert.equal(typeof parser.map, "function");
  });

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

  it("lists only top-level commands in root docs when commandList is top-level", async () => {
    const parser = createProgramParser([
      {
        path: ["user"],
        command: defineCommand({
          parser: object({}),
          metadata: { brief: message`Manage users.` },
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
      {
        path: ["user", "remove"],
        command: defineCommand({
          parser: object({}),
          metadata: { brief: message`Remove a user.` },
          handler() {},
        }),
      },
    ], {
      commandList: "top-level",
    });

    const page = await getDocPageAsync(parser);
    assert.ok(page);
    const output = formatDocPage("tool", page, { showUsage: false });

    assert.match(output, /user\s+Manage users\./);
    assert.doesNotMatch(output, /user add/);
    assert.doesNotMatch(output, /user remove/);
  });

  it("preserves source annotations for executable parent commands", async () => {
    const sourceId = Symbol("source");
    const context = createStringSourceContext(sourceId, "from-source");
    const calls: unknown[] = [];

    await runProgram({
      commands: [
        defineCommand({
          path: ["stash"],
          parser: createSourceBackedParser(sourceId),
          handler(value) {
            calls.push(["stash", value]);
          },
        }),
        defineCommand({
          path: ["stash", "list"],
          parser: object({}),
          handler(value) {
            calls.push(["stash list", value]);
          },
        }),
      ],
      metadata: { name: "git" },
      args: ["stash"],
      contexts: [context],
      stdout() {},
      stderr() {},
      onExit(exitCode): never {
        throw new Error(`Unexpected exit ${exitCode}.`);
      },
    });

    await runProgram({
      commands: [
        defineCommand({
          path: [],
          parser: createSourceBackedParser(sourceId),
          handler(value) {
            calls.push(["root", value]);
          },
        }),
        defineCommand({
          path: ["build"],
          parser: object({}),
          handler(value) {
            calls.push(["build", value]);
          },
        }),
      ],
      metadata: { name: "tool" },
      args: [],
      contexts: [context],
      stdout() {},
      stderr() {},
      onExit(exitCode): never {
        throw new Error(`Unexpected exit ${exitCode}.`);
      },
    });

    assert.deepEqual(calls, [
      ["stash", "from-source"],
      ["root", "from-source"],
    ]);
  });

  it("preserves phase-two seeds for executable parent commands", async () => {
    const sourceId = Symbol("source");
    const phase2Values: unknown[] = [];
    const calls: unknown[] = [];
    const context: SourceContext = {
      id: Symbol("test-context"),
      phase: "two-pass",
      getAnnotations(request) {
        if (request?.phase !== "phase2") return {};
        phase2Values.push(request.parsed);
        const config = request.parsed != null &&
            typeof request.parsed === "object"
          ? (request.parsed as { readonly config?: unknown }).config
          : undefined;
        return typeof config === "string"
          ? { [sourceId]: `loaded:${config}` }
          : {};
      },
    };

    await runProgram({
      commands: [
        defineCommand({
          path: ["stash"],
          parser: object({
            config: option("--config", string()),
            source: createSourceBackedOptionParser(sourceId, "--source"),
          }),
          handler(value) {
            calls.push(["stash", value]);
          },
        }),
        defineCommand({
          path: ["stash", "list"],
          parser: object({}),
          handler(value) {
            calls.push(["stash list", value]);
          },
        }),
      ],
      metadata: { name: "git" },
      args: ["stash", "--config", "stash.json"],
      contexts: [context],
      stdout() {},
      stderr() {},
      onExit(exitCode): never {
        throw new Error(`Unexpected exit ${exitCode}.`);
      },
    });

    assert.deepEqual(calls, [
      [
        "stash",
        { config: "stash.json", source: "loaded:stash.json" },
      ],
    ]);
    assert.equal(phase2Values.length, 1);
    assert.equal(
      phase2Values[0] != null && typeof phase2Values[0] === "object"
        ? (phase2Values[0] as { readonly config?: unknown }).config
        : undefined,
      "stash.json",
    );
  });

  it("completes source-backed executable parents without CLI tokens", async () => {
    const sourceId = Symbol("source");
    const context = createStringSourceContext(sourceId, "from-source");
    const calls: unknown[] = [];
    const parser = createProgramParser([
      {
        path: [],
        command: defineCommand({
          parser: createSourceBackedOptionParser(sourceId, "--source"),
          handler(value) {
            calls.push(["root complete", value]);
          },
        }),
      },
      {
        path: ["build"],
        command: defineCommand({
          parser: object({}),
          handler(value) {
            calls.push(["build complete", value]);
          },
        }),
      },
    ]);

    const result = await parser.complete(
      injectAnnotations(parser.initialState, { [sourceId]: "from-source" }),
    );
    assert.ok(result.success);
    if (result.success) {
      await result.value.handler(result.value.value);
    }

    await runProgram({
      commands: [
        defineCommand({
          path: [],
          parser: createSourceBackedOptionParser(sourceId, "--source"),
          handler(value) {
            calls.push(["root", value]);
          },
        }),
        defineCommand({
          path: ["build"],
          parser: object({}),
          handler(value) {
            calls.push(["build", value]);
          },
        }),
      ],
      metadata: { name: "tool" },
      args: [],
      contexts: [context],
      stdout() {},
      stderr() {},
      onExit(exitCode): never {
        throw new Error(`Unexpected exit ${exitCode}.`);
      },
    });

    assert.deepEqual(calls, [
      ["root complete", "from-source"],
      ["root", "from-source"],
    ]);
  });

  it("includes source nodes for uncommitted executable parent completion", async () => {
    const modeParser = dependency(choice(["dev", "prod"] as const));
    const parser = createProgramParser([
      {
        path: ["stash"],
        command: defineCommand({
          parser: object({
            mode: withDefault(option("--mode", modeParser), "prod" as const),
          }),
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

    const state = await parseAll(parser, ["stash"]);
    const sourceNode = parser.getSuggestRuntimeNodes?.(state, [])?.find(
      (node) => node.parser.dependencyMetadata?.source != null,
    );

    assert.ok(sourceNode);
    assert.deepEqual(sourceNode.path, ["stash", 1, "mode"]);
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

  it("shows executable parent descriptions in namespace help", async () => {
    const parser = createProgramParser([
      {
        path: ["repo", "remote"],
        command: defineCommand({
          parser: object({}),
          metadata: { description: message`Manage remotes.` },
          handler() {},
        }),
      },
      {
        path: ["repo", "remote", "add"],
        command: defineCommand({
          parser: object({}),
          metadata: { brief: message`Add a remote.` },
          handler() {},
        }),
      },
    ]);

    const page = await getDocPageAsync(parser, ["repo"]);
    assert.ok(page != null);
    const text = formatDocPage("git", page);

    assert.match(text, /remote\s+Manage remotes\./);

    const childPage = await getDocPageAsync(parser, ["repo", "remote", "add"]);
    assert.ok(childPage != null);
    const childText = formatDocPage("git", childPage);

    assert.doesNotMatch(childText, /Manage remotes\./);
  });

  it("keeps hidden executable parent namespaces out of help and suggestions", async () => {
    const parser = createProgramParser([
      {
        path: ["repo", "remote"],
        command: defineCommand({
          parser: object({}),
          metadata: {
            description: message`Manage remotes.`,
            hidden: true,
          },
          handler() {},
        }),
      },
      {
        path: ["repo", "remote", "add"],
        command: defineCommand({
          parser: object({}),
          metadata: { brief: message`Add a remote.` },
          handler() {},
        }),
      },
    ]);

    const page = await getDocPageAsync(parser, ["repo"]);
    assert.ok(page != null);
    const text = formatDocPage("git", page);

    assert.doesNotMatch(text, /\bremote\b/);

    const rootPage = await getDocPageAsync(parser);
    assert.ok(rootPage != null);
    const rootText = formatDocPage("git", rootPage);

    assert.doesNotMatch(rootText, /repo remote add/);
    assert.doesNotMatch(rootText, /Usage: git repo add/);

    const suggestions = await suggestAsync(parser, ["repo", ""]);
    assert.ok(
      !suggestions.some((suggestion) =>
        suggestion.kind === "literal" && suggestion.text === "remote"
      ),
    );

    const childPage = await getDocPageAsync(parser, [
      "repo",
      "remote",
      "add",
    ]);
    assert.ok(childPage != null);
    const childText = formatDocPage("git", childPage);

    assert.match(childText, /Usage: git repo remote add/);
  });

  it("wraps executable parent completion with async mode", async () => {
    const asyncChildParser: Parser<"async", Record<string, never>, undefined> =
      {
        $valueType: [],
        $stateType: [],
        mode: "async",
        priority: 0,
        usage: [],
        leadingNames: new Set(),
        acceptingAnyToken: false,
        initialState: undefined,
        parse(context) {
          return Promise.resolve({
            success: true,
            consumed: [],
            next: context,
          });
        },
        complete() {
          return Promise.resolve({ success: true, value: {} });
        },
        async *suggest() {},
        getDocFragments() {
          return { fragments: [] };
        },
      };
    const parser = createProgramParser([
      {
        path: ["stash"],
        command: defineCommand({
          parser: object({}),
          handler() {},
        }),
      },
      {
        path: ["stash", "list"],
        command: defineCommand({
          parser: asyncChildParser,
          handler() {},
        }),
      },
    ]);

    assert.equal(parser.mode, "async");

    const parentState = await parseAll(parser, ["stash"]);
    const result = parser.complete(parentState);

    assert.ok(result instanceof Promise);
    assert.ok((await result).success);
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
  it("should reject non-object options", async () => {
    await assert.rejects(
      () => runProgram([] as never),
      { name: "TypeError", message: "Expected object, got array." },
    );
    await assert.rejects(
      () => runProgram(null as never),
      { name: "TypeError", message: "Expected object." },
    );
  });

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

  it("runs commands converted from a static module map", async () => {
    const calls: unknown[] = [];
    const commands = commandsFromModules({
      "./commands/write.ts": {
        default: defineCommand({
          parser: object({
            value: option("--value", string()),
          }),
          handler(value) {
            calls.push(value);
          },
        }),
      },
    }, {
      base: "./commands",
      extensions: [".ts"],
    });

    await runProgram({
      commands,
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

  it("omits usage from statically registered root help when showUsage is false", async () => {
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
          showUsage: false,
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

    assert.doesNotMatch(stdout, /Usage:/);
    assert.match(stdout, /user add\s+Add a user\./);
    assert.match(stdout, /user remove\s+Remove a user\./);
  });

  it("lists only top-level commands in root help when commandList is top-level", async () => {
    const userCommand = defineCommand({
      path: ["user"],
      parser: object({}),
      metadata: { brief: message`Manage users.` },
      handler() {},
    });
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
    let rootStdout = "";
    let userStdout = "";

    await assert.rejects(
      () =>
        runProgram({
          commands: [userCommand, addCommand, removeCommand],
          metadata: { name: "tool", version: "1.0.0" },
          args: ["--help"],
          commandList: "top-level",
          showUsage: false,
          stdout(text) {
            rootStdout += `${text}\n`;
          },
          stderr() {},
          onExit(exitCode): never {
            throw new ExitSignal(exitCode);
          },
        }),
      ExitSignal,
    );

    await assert.rejects(
      () =>
        runProgram({
          commands: [userCommand, addCommand, removeCommand],
          metadata: { name: "tool", version: "1.0.0" },
          args: ["user", "--help"],
          commandList: "top-level",
          showUsage: false,
          stdout(text) {
            userStdout += `${text}\n`;
          },
          stderr() {},
          onExit(exitCode): never {
            throw new ExitSignal(exitCode);
          },
        }),
      ExitSignal,
    );

    assert.match(rootStdout, /user\s+Manage users\./);
    assert.doesNotMatch(rootStdout, /user add/);
    assert.doesNotMatch(rootStdout, /user remove/);
    assert.match(userStdout, /add\s+Add a user\./);
    assert.match(userStdout, /remove\s+Remove a user\./);
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

describe("runProgram() lifecycle hooks", () => {
  function runHooked(
    commands: readonly AnyStaticCommand[],
    args: readonly string[],
    hooks?: ProgramHooks,
  ): Promise<void> {
    return runProgram({
      commands,
      metadata: { name: "tool", version: "1.0.0" },
      args,
      hooks,
      stdout() {},
      stderr() {},
      onExit(exitCode): never {
        throw new ExitSignal(exitCode);
      },
    });
  }

  it("produces identical handler output with and without hooks", async () => {
    const calls: unknown[] = [];
    const greet = defineCommand({
      path: ["greet"],
      parser: object({ name: option("--name", string()) }),
      handler(value) {
        calls.push(value);
      },
    });

    await runHooked([greet], ["greet", "--name", "world"]);
    await runHooked([greet], ["greet", "--name", "world"], {});

    assert.deepEqual(calls, [{ name: "world" }, { name: "world" }]);
  });

  it("calls the handler with one argument unless a beforeEach runs", async () => {
    const argCounts: number[] = [];
    const greet = defineCommand({
      path: ["greet"],
      parser: object({}),
      handler(...args: unknown[]) {
        argCounts.push(args.length);
      },
    });

    await runHooked([greet], ["greet"]);
    await runHooked([greet], ["greet"], {});
    await runHooked([greet], ["greet"], { afterEach() {} });
    await runHooked([greet], ["greet"], {
      beforeEach: () => ({ resource: 1 }),
    });

    assert.deepEqual(argCounts, [1, 1, 1, 2]);
  });

  it("forwards the beforeEach resource to the handler", async () => {
    const scope = { id: "log-scope" };
    let received: unknown;
    const greet = defineCommand({
      path: ["greet"],
      parser: object({}),
      handler(_value, context) {
        received = context?.resource;
      },
    });

    await runHooked([greet], ["greet"], {
      beforeEach: () => ({ resource: scope }),
    });

    assert.equal(received, scope);
  });

  it("runs afterEach after a successful handler with the same context", async () => {
    const order: string[] = [];
    const scope = { id: "scope" };
    let afterContext: unknown;
    const greet = defineCommand({
      path: ["greet"],
      parser: object({}),
      handler() {
        order.push("handler");
      },
    });

    await runHooked([greet], ["greet"], {
      beforeEach() {
        order.push("before");
        return { resource: scope };
      },
      afterEach(context) {
        order.push("after");
        afterContext = context.resource;
      },
    });

    assert.deepEqual(order, ["before", "handler", "after"]);
    assert.equal(afterContext, scope);
  });

  it("invokes onError and re-throws the original handler error", async () => {
    const error = new Error("boom");
    let observed: unknown;
    let afterEachRan = false;
    const fail = defineCommand({
      path: ["fail"],
      parser: object({}),
      handler() {
        throw error;
      },
    });

    await assert.rejects(
      () =>
        runHooked([fail], ["fail"], {
          afterEach() {
            afterEachRan = true;
          },
          onError(_context, caught) {
            observed = caught;
          },
        }),
      (caught) => caught === error,
    );

    assert.equal(observed, error);
    assert.ok(!afterEachRan);
  });

  it("re-throws the same handler error with and without onError", async () => {
    const error = new Error("boom");
    const fail = defineCommand({
      path: ["fail"],
      parser: object({}),
      handler() {
        throw error;
      },
    });

    // Without hooks: the error propagates out of runProgram untouched, and the
    // error-exit path (onExit) is never reached.  Asserting the rejection is the
    // original error proves onExit was not triggered, so exit-code behavior is
    // identical with hooks installed.
    await assert.rejects(
      () => runHooked([fail], ["fail"]),
      (caught) => caught === error,
    );
    await assert.rejects(
      () => runHooked([fail], ["fail"], { onError() {} }),
      (caught) => caught === error,
    );
  });

  it("rejects with an async handler rejection and runs onError", async () => {
    const error = new Error("async boom");
    let observed: unknown;
    const fail = defineCommand({
      path: ["fail"],
      parser: object({}),
      async handler() {
        await Promise.resolve();
        throw error;
      },
    });

    await assert.rejects(
      () =>
        runHooked([fail], ["fail"], {
          onError(_context, caught) {
            observed = caught;
          },
        }),
      (caught) => caught === error,
    );

    assert.equal(observed, error);
  });

  it("skips the handler and invokes onError when beforeEach rejects", async () => {
    const error = new Error("preflight failed");
    let handlerRan = false;
    let observed: unknown;
    const greet = defineCommand({
      path: ["greet"],
      parser: object({}),
      handler() {
        handlerRan = true;
      },
    });

    await assert.rejects(
      () =>
        runHooked([greet], ["greet"], {
          beforeEach() {
            throw error;
          },
          onError(_context, caught) {
            observed = caught;
          },
        }),
      (caught) => caught === error,
    );

    assert.ok(!handlerRan);
    assert.equal(observed, error);
  });

  it("treats an afterEach rejection as a handler error", async () => {
    const error = new Error("teardown failed");
    let observed: unknown;
    const greet = defineCommand({
      path: ["greet"],
      parser: object({}),
      handler() {},
    });

    await assert.rejects(
      () =>
        runHooked([greet], ["greet"], {
          afterEach() {
            throw error;
          },
          onError(_context, caught) {
            observed = caught;
          },
        }),
      (caught) => caught === error,
    );

    assert.equal(observed, error);
  });

  it("awaits asynchronous hooks around the handler", async () => {
    const order: string[] = [];
    const greet = defineCommand({
      path: ["greet"],
      parser: object({}),
      async handler() {
        await Promise.resolve();
        order.push("handler");
      },
    });

    await runHooked([greet], ["greet"], {
      async beforeEach() {
        await Promise.resolve();
        order.push("before");
        return {};
      },
      async afterEach() {
        await Promise.resolve();
        order.push("after");
      },
    });

    assert.deepEqual(order, ["before", "handler", "after"]);
  });

  it("composes program-level and command-level hooks in order", async () => {
    const order: string[] = [];
    const deploy = defineCommand({
      path: ["deploy"],
      parser: object({}),
      hooks: {
        beforeEach() {
          order.push("command.before");
          return { resource: "command" };
        },
        afterEach() {
          order.push("command.after");
        },
      },
      handler(_value, context) {
        order.push(`handler:${String(context?.resource)}`);
      },
    });

    await runHooked([deploy], ["deploy"], {
      beforeEach() {
        order.push("program.before");
        return { resource: "program" };
      },
      afterEach() {
        order.push("program.after");
      },
    });

    assert.deepEqual(order, [
      "program.before",
      "command.before",
      "handler:command",
      "command.after",
      "program.after",
    ]);
  });

  it("threads the program context to the handler without command beforeEach", async () => {
    let received: unknown;
    const deploy = defineCommand({
      path: ["deploy"],
      parser: object({}),
      hooks: {
        afterEach() {},
      },
      handler(_value, context) {
        received = context?.resource;
      },
    });

    await runHooked([deploy], ["deploy"], {
      beforeEach: () => ({ resource: "program" }),
    });

    assert.equal(received, "program");
  });

  it("should pass program context to command afterEach without beforeEach", async () => {
    let received: unknown;
    const deploy = defineCommand({
      path: ["deploy"],
      parser: object({}),
      hooks: {
        afterEach(context) {
          received = context.resource;
        },
      },
      handler() {},
    });

    await runHooked([deploy], ["deploy"], {
      beforeEach: () => ({ resource: "program" }),
    });

    assert.equal(received, "program");
  });

  it("should pass program context to command onError without beforeEach", async () => {
    const error = new Error("boom");
    let received: unknown;
    const fail = defineCommand({
      path: ["fail"],
      parser: object({}),
      hooks: {
        onError(context) {
          received = context.resource;
        },
      },
      handler() {
        throw error;
      },
    });

    await assert.rejects(
      () =>
        runHooked([fail], ["fail"], {
          beforeEach: () => ({ resource: "program" }),
        }),
      (caught) => caught === error,
    );

    assert.equal(received, "program");
  });

  it("should isolate command context when command beforeEach rejects", async () => {
    const error = new Error("preflight failed");
    let received: unknown;
    const fail = defineCommand({
      path: ["fail"],
      parser: object({}),
      hooks: {
        beforeEach() {
          throw error;
        },
        onError(context) {
          received = context.resource;
        },
      },
      handler() {},
    });

    await assert.rejects(
      () =>
        runHooked([fail], ["fail"], {
          beforeEach: () => ({ resource: "program" }),
        }),
      (caught) => caught === error,
    );

    assert.equal(received, undefined);
  });

  it("runs command onError before program onError on failure", async () => {
    const order: string[] = [];
    const error = new Error("boom");
    const fail = defineCommand({
      path: ["fail"],
      parser: object({}),
      hooks: {
        onError() {
          order.push("command.error");
        },
      },
      handler() {
        throw error;
      },
    });

    await assert.rejects(
      () =>
        runHooked([fail], ["fail"], {
          onError() {
            order.push("program.error");
          },
        }),
      (caught) => caught === error,
    );

    assert.deepEqual(order, ["command.error", "program.error"]);
  });

  it("does not let a throwing onError mask the original error", async () => {
    const original = new Error("handler boom");
    const fail = defineCommand({
      path: ["fail"],
      parser: object({}),
      handler() {
        throw original;
      },
    });

    await assert.rejects(
      () =>
        runHooked([fail], ["fail"], {
          onError() {
            throw new Error("onError boom");
          },
        }),
      (caught) => caught === original,
    );
  });

  it("keeps the original error when a command onError throws", async () => {
    const original = new Error("handler boom");
    let programObserved: unknown;
    const fail = defineCommand({
      path: ["fail"],
      parser: object({}),
      hooks: {
        onError() {
          throw new Error("command onError boom");
        },
      },
      handler() {
        throw original;
      },
    });

    await assert.rejects(
      () =>
        runHooked([fail], ["fail"], {
          onError(_context, caught) {
            programObserved = caught;
          },
        }),
      (caught) => caught === original,
    );

    // The program-level onError still observes the original handler error,
    // not the command-level onError's own failure.
    assert.equal(programObserved, original);
  });

  it("rejects malformed program-level hooks", async () => {
    const greet = defineCommand({
      path: ["greet"],
      parser: object({}),
      handler() {},
    });

    await assert.rejects(
      () => runHooked([greet], ["greet"], "nope" as never),
      { name: "TypeError", message: "Program hooks must be an object." },
    );
    await assert.rejects(
      () => runHooked([greet], ["greet"], [] as never),
      {
        name: "TypeError",
        message: "Program hooks must be an object, not an array.",
      },
    );
    await assert.rejects(
      () => runHooked([greet], ["greet"], { afterEach: "nope" as never }),
      {
        name: "TypeError",
        message: 'Program hook "afterEach" must be a function.',
      },
    );
  });

  it("defaults a nullish beforeEach result to an empty context", async () => {
    let afterContext: unknown = "unset";
    let handlerContext: unknown = "unset";
    const greet = defineCommand({
      path: ["greet"],
      parser: object({}),
      handler(_value, context) {
        handlerContext = context;
      },
    });

    await runHooked([greet], ["greet"], {
      // beforeEach may omit a return; the dispatcher substitutes an empty
      // context for the nullish result.
      beforeEach() {},
      afterEach(context) {
        afterContext = context;
      },
    });

    assert.deepEqual(afterContext, {});
    assert.deepEqual(handlerContext, {});
  });

  it("exposes the resolved command path to hooks", async () => {
    const invocationPaths: (readonly string[])[] = [];
    const commandPaths: unknown[] = [];
    // commandsFromModules derives the path from the module key while the
    // command definition omits an explicit path, mirroring file-based
    // discovery.
    const commands = commandsFromModules({
      "./commands/user/add.ts": {
        default: defineCommand({
          parser: object({}),
          handler() {},
        }),
      },
    }, { base: "./commands", extensions: [".ts"] });

    await runProgram({
      commands,
      metadata: { name: "tool", version: "1.0.0" },
      args: ["user", "add"],
      hooks: {
        beforeEach(invocation) {
          invocationPaths.push(invocation.path);
          commandPaths.push(invocation.command.path);
          return {};
        },
      },
      stdout() {},
      stderr() {},
      onExit(exitCode): never {
        throw new ExitSignal(exitCode);
      },
    });

    // The resolved path identifies the command even though the definition
    // itself declared no path.
    assert.deepEqual(invocationPaths, [["user", "add"]]);
    assert.deepEqual(commandPaths, [undefined]);
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

function makeCommand() {
  return defineCommand({
    parser: object({}),
    handler() {},
  });
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

function createStringSourceContext(
  id: symbol,
  value: string,
): SourceContext {
  return {
    id,
    phase: "single-pass",
    getAnnotations() {
      return { [id]: value };
    },
  };
}

function createSourceBackedParser(
  sourceId: symbol,
): Parser<"sync", string, undefined> {
  const parser: Parser<"sync", string, undefined> = {
    mode: "sync",
    $valueType: [],
    $stateType: [],
    priority: 0,
    usage: [],
    leadingNames: new Set(),
    acceptingAnyToken: false,
    initialState: undefined,
    parse(context) {
      return {
        success: true,
        next: context,
        consumed: [],
      };
    },
    complete(state) {
      const value = getAnnotations(state)?.[sourceId];
      return typeof value === "string"
        ? { success: true, value }
        : { success: false, error: message`Missing source value.` };
    },
    suggest() {
      return [];
    },
    getDocFragments() {
      return { fragments: [] };
    },
  };
  defineTraits(parser, {
    inheritsAnnotations: true,
    completesFromSource: true,
  });
  return parser;
}

interface SourceBackedOptionState {
  readonly hasCliValue: boolean;
  readonly cliState?: ValueParserResult<string> | undefined;
}

function isSourceBackedOptionState(
  value: unknown,
): value is SourceBackedOptionState {
  return value != null &&
    typeof value === "object" &&
    typeof (value as { readonly hasCliValue?: unknown }).hasCliValue ===
      "boolean";
}

function createSourceBackedOptionParser(
  sourceId: symbol,
  name: OptionName,
): Parser<"sync", string, SourceBackedOptionState | undefined> {
  const cliParser = option(name, string());
  const parser: Parser<"sync", string, SourceBackedOptionState | undefined> = {
    mode: "sync",
    $valueType: [],
    $stateType: [],
    priority: cliParser.priority,
    usage: cliParser.usage,
    leadingNames: cliParser.leadingNames,
    acceptingAnyToken: cliParser.acceptingAnyToken,
    initialState: undefined,
    parse(context) {
      const currentState = isSourceBackedOptionState(context.state)
        ? context.state.cliState ?? cliParser.initialState
        : cliParser.initialState;
      const result = cliParser.parse({ ...context, state: currentState });
      if (result.success) {
        return wrapSourceBackedOptionParseResult(context.state, result);
      }
      if (result.consumed > 0) {
        return result;
      }
      return {
        success: true,
        next: {
          ...context,
          state: inheritAnnotations(context.state, { hasCliValue: false }),
        },
        consumed: [],
      };
    },
    complete(state, exec) {
      if (isSourceBackedOptionState(state) && state.hasCliValue) {
        return cliParser.complete(
          inheritAnnotations(state, state.cliState ?? cliParser.initialState),
          exec,
        );
      }
      const value = getAnnotations(state)?.[sourceId];
      return typeof value === "string"
        ? { success: true, value }
        : { success: false, error: message`Missing source value.` };
    },
    suggest(context, prefix) {
      return cliParser.suggest({
        ...context,
        state: cliParser.initialState,
      }, prefix);
    },
    getDocFragments(state, defaultValue) {
      return cliParser.getDocFragments(
        state.kind === "available" && isSourceBackedOptionState(state.state) &&
          state.state.hasCliValue
          ? {
            kind: "available",
            state: inheritAnnotations(
              state.state,
              state.state.cliState ?? cliParser.initialState,
            ),
          }
          : { kind: "unavailable" },
        defaultValue,
      );
    },
  };
  defineTraits(parser, {
    inheritsAnnotations: true,
    completesFromSource: true,
  });
  return parser;
}

function wrapSourceBackedOptionParseResult(
  sourceState: unknown,
  result: ParserResult<ValueParserResult<string> | undefined>,
): ParserResult<SourceBackedOptionState | undefined> {
  if (!result.success) return result;
  const state: SourceBackedOptionState = result.consumed.length > 0
    ? { hasCliValue: true, cliState: result.next.state }
    : { hasCliValue: false };
  return {
    success: true,
    ...(result.provisional ? { provisional: true as const } : {}),
    next: {
      ...result.next,
      state: inheritAnnotations(sourceState, state),
    },
    consumed: result.consumed,
  };
}
