import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { object } from "@optique/core/constructs";
import type { SourceContext } from "@optique/core/context";
import { dependency } from "@optique/core/dependency";
import { multiple, withDefault } from "@optique/core/modifiers";
import { argument, option } from "@optique/core/primitives";
import { choice, integer, string } from "@optique/core/valueparser";
import { runProgram, type RunProgramOptions } from "#src/index.ts";
import { defineCommand } from "#src/command.ts";

const presentation = { metadata: { name: "admin" }, colors: false } as const;

function fixture() {
  const calls: unknown[] = [];
  const root = defineCommand({
    path: [],
    parser: object({
      verbose: option("--verbose"),
      source: multiple(argument(string({ metavar: "SOURCE" })), { min: 1 }),
    }),
    handler(value) {
      calls.push(["root", value.source]);
    },
  });
  const build = defineCommand({
    path: ["build"],
    metadata: { aliases: ["b"] },
    parser: object({ count: argument(integer()), output: option("--output") }),
    handler(value) {
      calls.push(["build", value.count]);
    },
  });
  return { root, build, calls };
}

describe("runProgram() root command precedence", () => {
  it("shows full root help and nested help before consuming root positionals", async () => {
    const { root, build, calls } = fixture();
    for (const commands of [[root], [root, build]]) {
      const help = await captureProgramRun({
        ...presentation,
        commands,
        args: ["help"],
      });
      const optionHelp = await captureProgramRun({
        ...presentation,
        commands,
        args: ["--help"],
      });
      assert.deepEqual(help, optionHelp);
      assert.equal(help.exitCode, 0);
      assert.match(help.stdout, /SOURCE/);
      assert.match(help.stdout, /--verbose/);
    }
    const help = await captureProgramRun({
      ...presentation,
      commands: [root, build],
      args: ["help", "build"],
    });
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /Usage: admin build/);
    assert.match(help.stdout, /--output/);
    assert.doesNotMatch(help.stdout, /--verbose/);
    assert.deepEqual(calls, []);
  });

  it("dispatches registered names and aliases before a greedy root", async () => {
    const { root, build, calls } = fixture();
    for (const name of ["build", "b"]) {
      const success = await captureProgramRun({
        ...presentation,
        commands: [root, build],
        args: [name, "1"],
      });
      assert.equal(success.exitCode, 0);
      const failure = await captureProgramRun({
        ...presentation,
        commands: [root, build],
        args: [name, "oops"],
      });
      assert.equal(failure.exitCode, 1);
      assert.match(failure.stderr, /integer/i);
      assert.match(failure.stderr, /SOURCE/);
    }
    assert.deepEqual(calls, [["build", 1], ["build", 1]]);
  });

  it("keeps registered meta names and aliases final, including parse errors", async () => {
    const { root, calls } = fixture();
    const help = defineCommand({
      path: ["help"],
      metadata: { aliases: ["assist"], hidden: true },
      parser: argument(integer()),
      handler(value) {
        calls.push(["help", value]);
      },
    });
    for (const name of ["help", "assist"]) {
      const success = await captureProgramRun({
        ...presentation,
        commands: [root, help],
        args: [name, "2"],
        help: { command: { names: ["help", "assist"] } },
      });
      assert.equal(success.exitCode, 0);
      const failure = await captureProgramRun({
        ...presentation,
        commands: [root, help],
        args: [name, "oops"],
        help: { command: { names: ["help", "assist"] } },
      });
      assert.equal(failure.exitCode, 1);
      assert.match(failure.stderr, /integer/i);
      assert.equal(failure.stdout, "");
    }
    assert.deepEqual(calls, [["help", 2], ["help", 2]]);
  });

  it("recognizes enabled custom meta names and every alias", async () => {
    const { root, build, calls } = fixture();
    for (const name of ["assist", "h"]) {
      const result = await captureProgramRun({
        ...presentation,
        commands: [root, build],
        args: [name, "build"],
        help: { command: { names: ["assist", "h"], hidden: true } },
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /Usage: admin build/);
    }
    for (const name of ["release", "v"]) {
      const result = await captureProgramRun({
        ...presentation,
        commands: [root],
        args: [name],
        version: { value: "1.2.3", command: { names: ["release", "v"] } },
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "1.2.3\n");
    }
    for (const name of ["complete", "c"]) {
      const result = await captureProgramRun({
        ...presentation,
        commands: [root, build],
        args: [name, "bash"],
        completion: { command: { names: ["complete", "c"] } },
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, /complete/);
    }
    assert.deepEqual(calls, []);
  });

  it("leaves disabled, option-only and replaced meta names as root data", async () => {
    const { root, calls } = fixture();
    const cases = [
      { args: ["help"], help: false },
      { args: ["help"], help: "option" },
      { args: ["help"], help: { option: true } },
      { args: ["help"], help: { command: { names: ["assist"] } } },
      { args: ["completion", "bash"], completion: false },
      { args: ["completion", "bash"], completion: "option" },
      { args: ["version"], version: false },
      { args: ["version"], version: "1.2.3" },
    ] as const;
    for (const options of cases) {
      const result = await captureProgramRun({
        ...presentation,
        commands: [root],
        ...options,
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "");
    }
    assert.deepEqual(calls, cases.map(({ args }) => ["root", args]));
  });

  it("only reserves the first token before the option terminator", async () => {
    const { root, build, calls } = fixture();
    for (
      const args of [["--", "help"], ["./help"], ["--verbose", "help"], [
        "file.ts",
        "build",
      ]]
    ) {
      const result = await captureProgramRun({
        ...presentation,
        commands: [root, build],
        args,
      });
      assert.equal(result.exitCode, 0);
    }
    assert.deepEqual(calls, [
      ["root", ["help"]],
      ["root", ["./help"]],
      ["root", ["help"]],
      ["root", ["file.ts", "build"]],
    ]);
  });

  it("reserves synthetic namespaces", async () => {
    const { root, calls } = fixture();
    const add = defineCommand({
      path: ["user", "add"],
      parser: argument(integer()),
      handler(value) {
        calls.push(["add", value]);
      },
    });
    const result = await captureProgramRun({
      ...presentation,
      commands: [root, add],
      args: ["user", "add", "3"],
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls, [["add", 3]]);
    const help = await captureProgramRun({
      ...presentation,
      commands: [root, add],
      args: ["help", "user"],
    });
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /admin user/);
  });

  it("retains root and child completion queries through the command form", async () => {
    const { build } = fixture();
    const root = defineCommand({
      path: [],
      parser: object({
        verbose: option("--verbose"),
        source: multiple(
          argument(
            choice(["alpha", "help", "build", "1", "completion", "bash"]),
          ),
        ),
      }),
      handler() {
        assert.fail("Completion must not run a handler.");
      },
    });
    for (const commands of [[root], [root, build]]) {
      for (const words of [[""], ["--v"], ["help", ""]]) {
        const command = await captureProgramRun({
          ...presentation,
          commands,
          args: ["completion", "bash", ...words],
        });
        const option = await captureProgramRun({
          ...presentation,
          commands,
          args: ["--completion", "bash", ...words],
        });
        assert.equal(command.exitCode, 0);
        assert.deepEqual(command, option);
        if (words[0] === "") assert.match(command.stdout, /alpha/);
        if (words[0] === "--v") assert.match(command.stdout, /--verbose/);
      }
    }
    const child = await captureProgramRun({
      ...presentation,
      commands: [root, build],
      args: ["completion", "bash", "build", "1", "--"],
    });
    assert.equal(child.exitCode, 0);
    assert.match(child.stdout, /--output/);
    assert.doesNotMatch(child.stdout, /--verbose/);
  });

  it("preserves mixed modes and skips root effects and phase two for meta", async () => {
    const calls: unknown[] = [];
    const phases: unknown[] = [];
    const context: SourceContext = {
      id: Symbol("meta-context"),
      phase: "two-pass",
      getAnnotations(request) {
        phases.push(request?.phase);
        return {};
      },
    };
    const text = string();
    const root = defineCommand({
      path: [],
      parser: multiple(argument({
        metavar: text.metavar,
        format: text.format,
        placeholder: "",
        mode: "async",
        parse(value) {
          calls.push(["parse", value]);
          return Promise.resolve(text.parse(value));
        },
      })),
      handler(value) {
        calls.push(["root", value]);
      },
    });
    const { build } = fixture();
    for (const args of [["help"], ["version"], ["completion", "bash"]]) {
      phases.length = 0;
      const result = await captureProgramRun({
        ...presentation,
        commands: [root, build],
        args,
        contexts: [context],
        version: { value: "1.2.3", command: true },
        hooks: {
          beforeEach() {
            assert.fail("Meta must not run hooks.");
          },
        },
      });
      assert.equal(result.exitCode, 0);
      assert.ok(phases.includes("phase1"));
      assert.ok(!phases.includes("phase2"));
      assert.deepEqual(calls, []);
    }
    const result = await captureProgramRun({
      ...presentation,
      commands: [root, build],
      args: ["build", "1"],
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls, []);
  });

  it("keeps root dependency-backed completion values in both entry points", async () => {
    const mode = dependency(choice(["dev", "prod"]));
    const root = defineCommand({
      path: [],
      parser: object({
        mode: withDefault(option("--mode", mode), "prod"),
        source: argument(mode.derive({
          metavar: "SOURCE",
          mode: "sync",
          defaultValue: () => "prod",
          factory: (value) =>
            choice(value === "prod" ? ["release"] : ["debug"]),
        })),
      }),
      handler() {
        assert.fail("Completion must not run a handler.");
      },
    });
    const { build } = fixture();
    for (const commands of [[root], [root, build]]) {
      const command = await captureProgramRun({
        ...presentation,
        commands,
        args: ["completion", "bash", ""],
      });
      const option = await captureProgramRun({
        ...presentation,
        commands,
        args: ["--completion", "bash", ""],
      });
      assert.equal(command.exitCode, 0);
      assert.deepEqual(command, option);
      assert.match(command.stdout, /release/);
      assert.doesNotMatch(command.stdout, /debug/);
    }
  });

  it("keeps malformed meta requests final and renders root error help", async () => {
    const { root, calls } = fixture();
    const result = await captureProgramRun({
      ...presentation,
      commands: [root],
      args: ["version", "extra"],
      version: { value: "1.2.3", command: true },
      aboveError: "help",
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /SOURCE/);
    assert.match(result.stderr, /--verbose/);
    assert.match(result.stderr, /Error:/);
    assert.deepEqual(calls, []);
  });
});

async function captureProgramRun(options: RunProgramOptions) {
  class ProgramExit extends Error {
    readonly code: number;
    constructor(code: number) {
      super(`Program exited with code ${code}.`);
      this.code = code;
    }
  }
  let stdout = "";
  let stderr = "";
  try {
    await runProgram({
      ...options,
      stdout(text) {
        stdout += `${text}\n`;
      },
      stderr(text) {
        stderr += `${text}\n`;
      },
      onExit(code): never {
        throw new ProgramExit(code);
      },
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    if (!(error instanceof ProgramExit)) throw error;
    return { exitCode: error.code, stdout, stderr };
  }
}
