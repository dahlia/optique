import { conditional, object, or, seq } from "@optique/core/constructs";
import { multiple, optional } from "@optique/core/modifiers";
import {
  argument,
  command,
  constant,
  flag,
  option,
} from "@optique/core/primitives";
import { parseSync } from "@optique/core/parser";
import type { HiddenVisibility, Usage } from "@optique/core/usage";
import { choice, string } from "@optique/core/valueparser";
import { captureRun } from "@optique/testing/run";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";

const format = { programName: "tool", colors: false, maxWidth: 80 } as const;

describe("command-scoped error usage", () => {
  for (const tail of [["--unknown"], ["--port"], ["--port", "invalid"]]) {
    it(`should narrow nested ${tail.join(" ")} errors`, async () => {
      const parser = nestedCommands();
      const options = {
        ...format,
        args: ["config", "set", ...tail],
        help: "both",
        version: { value: "1.0", option: true, command: true },
        completion: "both",
      } as const;

      const before = await captureRun(parser, options);
      const root = await captureRun(parser, { ...options, errorUsage: "root" });
      const after = await captureRun(parser, {
        ...options,
        errorUsage: "command",
      });

      assert.deepEqual(root, before);
      assert.equal(after.kind, "exited");
      assert.equal(after.exitCode, 1);
      assert.equal(after.stdout, "");
      const usage = after.stderr.slice(0, after.stderr.indexOf("Error:"));
      assert.match(usage, /tool config set/);
      for (
        const name of ["--port", "--verbose", "--global", "--help", "--version"]
      ) {
        assert.ok(usage.includes(name), usage);
      }
      assert.doesNotMatch(
        usage,
        /\b(?:get|serve|deploy|completion|help COMMAND)\b/,
      );
      assert.match(before.stderr, /serve/);
      assert.equal(errorText(after.stderr), errorText(before.stderr));
    });
  }

  for (const aliases of [["cfg", "s"], ["configuration", "change"]]) {
    it(`should show canonical names for ${aliases.join(" ")}`, async () => {
      const result = await captureRun(nestedCommands(), {
        ...format,
        args: [...aliases, "--port", "invalid"],
        errorUsage: "command",
      });
      assert.match(result.stderr, /tool config set/);
      assert.doesNotMatch(result.stderr, /tool (?:cfg|configuration)/);
      assert.doesNotMatch(result.stderr, /serve/);
    });
  }

  for (const args of [["config"], ["config", "unknown"]]) {
    it(`should keep child alternatives for ${args.join(" ")}`, async () => {
      const result = await captureRun(nestedCommands(), {
        ...format,
        args,
        errorUsage: "command",
      });
      const usage = result.stderr.slice(0, result.stderr.indexOf("Error:"));
      assert.match(usage, /config/);
      assert.match(usage, /set --port PORT/);
      assert.match(usage, /get KEY/);
      assert.match(usage, /--global/);
      assert.doesNotMatch(usage, /serve|deploy/);
      assert.equal(result.exitCode, 1);
    });
  }

  it("should retain root alternatives for an unknown root command", async () => {
    const parser = nestedCommands();
    const options = { ...format, args: ["unknown"] };
    assert.deepEqual(
      await captureRun(parser, { ...options, errorUsage: "command" }),
      await captureRun(parser, { ...options, errorUsage: "root" }),
    );
  });

  for (const hidden of [true, "usage", "help", "doc", false] as const) {
    it(`should honor matched command visibility ${hidden}`, async () => {
      const parser = nestedCommands(hidden);
      const options = { ...format, args: ["config", "set", "--port", "bad"] };
      const root = await captureRun(parser, { ...options, errorUsage: "root" });
      const result = await captureRun(parser, {
        ...options,
        errorUsage: "command",
      });
      if (hidden === true || hidden === "usage" || hidden === "help") {
        assert.deepEqual(result, root);
        assert.match(result.stderr, /serve/);
        assert.doesNotMatch(result.stderr, /tool config/);
      } else {
        assert.match(result.stderr, /tool config set/);
        assert.doesNotMatch(result.stderr, /serve/);
      }
    });
  }

  for (
    const args of [
      ["--", "config", "set", "--port", "bad"],
      ["config", "set", "--", "--unknown"],
    ]
  ) {
    it(`should use recorded command context with ${args.join(" ")}`, async () => {
      const result = await captureRun(nestedCommands(), {
        ...format,
        args,
        errorUsage: "command",
      });
      assert.match(result.stderr, /tool config set/);
      assert.doesNotMatch(result.stderr, /serve/);
      assert.equal(result.exitCode, 1);
    });
  }

  for (const wrapper of [optional, multiple]) {
    it(`should fall back for ${wrapper.name} command hosts`, async () => {
      const parser = object({
        commands: wrapper(or(
          command("config", option("--port", choice(["80", "443"]))),
          command("serve", constant(null)),
        )),
      });
      const options = { ...format, args: ["config", "--port", "bad"] };
      const root = await captureRun(parser, { ...options, errorUsage: "root" });
      assert.match(root.stderr, /serve/);
      assert.deepEqual(
        await captureRun(parser, { ...options, errorUsage: "command" }),
        root,
      );
      const control = await captureRun(
        or(
          command("config", option("--port", choice(["80", "443"]))),
          command("serve", constant(null)),
        ),
        { ...options, errorUsage: "command" },
      );
      assert.doesNotMatch(control.stderr, /serve/);
    });
  }

  it("should fall back when a custom parser's canonical path is absent", async () => {
    const inner = command("config", option("--port", choice(["80", "443"])));
    const parser = { ...inner, usage: command("serve", constant(null)).usage };
    const options = { ...format, args: ["config", "--port", "bad"] };
    const root = await captureRun(parser, { ...options, errorUsage: "root" });
    assert.match(root.stderr, /serve/);
    assert.deepEqual(
      await captureRun(parser, {
        ...options,
        errorUsage: "command",
      }),
      root,
    );
    const control = await captureRun({
      ...inner,
      usage: or(inner, command("serve", constant(null))).usage,
    }, { ...options, errorUsage: "command" });
    assert.doesNotMatch(control.stderr, /serve/);
  });

  for (const wrapped of [false, true]) {
    it(`should fall back for custom duplicate ${wrapped ? "wrapped" : "direct"} paths`, async () => {
      const inner = command("config", option("--port", choice(["80", "443"])));
      const branch: Usage = [{ type: "command", name: "config" }, {
        type: "option",
        names: ["--other"],
      }];
      const parser = {
        ...inner,
        usage: [{
          type: "exclusive",
          terms: [
            inner.usage,
            wrapped ? [{ type: "optional", terms: branch }] : branch,
            [{ type: "command", name: "serve" }],
          ],
        }] satisfies Usage,
      };
      const options = { ...format, args: ["config", "--port", "bad"] };
      const root = await captureRun(parser, { ...options, errorUsage: "root" });
      assert.match(root.stderr, /serve/);
      assert.deepEqual(
        await captureRun(parser, {
          ...options,
          errorUsage: "command",
        }),
        root,
      );
      const control = await captureRun({
        ...inner,
        usage: or(inner, command("serve", constant(null))).usage,
      }, { ...options, errorUsage: "command" });
      assert.doesNotMatch(control.stderr, /serve/);
    });
  }

  it("should fall back for independent free-order command groups", async () => {
    const commands = or(
      command("config", option("--port", choice(["80", "443"]))),
      command("serve", constant(null)),
    );
    const parser = object({
      region: or(
        command("region", constant(null)),
        option("--region", string()),
      ),
      commands,
    });
    const options = { ...format, args: ["region", "config", "--port", "bad"] };
    const root = await captureRun(parser, { ...options, errorUsage: "root" });
    assert.match(root.stderr, /serve/);
    assert.deepEqual(
      await captureRun(parser, {
        ...options,
        errorUsage: "command",
      }),
      root,
    );
    const control = await captureRun(commands, {
      ...format,
      args: ["config", "--port", "bad"],
      errorUsage: "command",
    });
    assert.doesNotMatch(control.stderr, /serve/);
  });

  it("should fall back when a nested matched segment is hidden", async () => {
    for (const hidden of [true, false]) {
      const parser = or(
        command(
          "config",
          or(
            command("set", option("--port", choice(["80", "443"])), { hidden }),
            command("get", constant(null)),
          ),
        ),
        command("serve", constant(null)),
      );
      const options = { ...format, args: ["config", "set", "--port", "bad"] };
      const result = await captureRun(parser, {
        ...options,
        errorUsage: "command",
      });
      if (hidden) {
        assert.deepEqual(
          result,
          await captureRun(parser, { ...options, errorUsage: "root" }),
        );
        assert.match(result.stderr, /serve/);
        assert.doesNotMatch(result.stderr.split("Error:")[0], /\bset\b/);
      } else {
        assert.match(result.stderr, /tool config set/);
        assert.doesNotMatch(result.stderr, /serve/);
      }
    }
  });

  it("should keep globals supplied before and inside the command path", async () => {
    const result = await captureRun(nestedCommands(), {
      ...format,
      args: ["--global", "config", "--verbose", "set", "--port", "bad"],
      errorUsage: "command",
    });
    assert.match(result.stderr, /tool config set/);
    assert.match(result.stderr, /--global/);
    assert.match(result.stderr, /--verbose/);
    assert.doesNotMatch(result.stderr, /serve/);
  });

  it("should distinguish user command-free alternatives from runner options", async () => {
    const parser = or(
      command("config", option("--port", choice(["80"]))),
      argument(string({ metavar: "FILE" })),
    );
    for (const help of [undefined, "option"] as const) {
      const result = await captureRun(parser, {
        ...format,
        help,
        args: ["config", "--port", "bad"],
        errorUsage: "command",
      });
      assert.match(result.stderr, /tool config --port TYPE/);
      assert.doesNotMatch(result.stderr, /FILE/);
      if (help != null) assert.match(result.stderr, /--help/);
    }
  });

  it("should preserve an ordered positional prefix with meta commands only", async () => {
    const parser = seq(
      argument(string({ metavar: "ENV" })),
      or(
        command("config", option("--port", choice(["80", "443"]))),
        command("serve", constant(null)),
      ),
    );
    for (
      const help of [{ command: true }, {
        option: { hidden: "usage" },
      }] as const
    ) {
      const result = await captureRun(parser, {
        ...format,
        help,
        args: ["prod", "config", "--port", "bad"],
        errorUsage: "command",
      });
      assert.match(result.stderr, /^Usage: tool ENV config --port TYPE\n/);
      assert.doesNotMatch(result.stderr, /serve|\(ENV/);
    }
  });

  for (const multipleBranches of [false, true]) {
    for (const help of [undefined, "option"] as const) {
      it(`should keep a conditional discriminator before its command (${multipleBranches}, ${help})`, async () => {
        const branches = {
          x: or(
            command("a", option("--x", choice(["ok"]))),
            command("unused", constant(null)),
          ),
          ...(multipleBranches ? { y: command("b", constant(null)) } : {}),
        };
        const parser = conditional(option("--kind", string()), branches);
        assert.ok(parseSync(parser, ["--kind", "x", "a", "--x", "ok"]).success);
        assert.ok(
          !parseSync(parser, ["a", "--kind", "x", "--x", "ok"]).success,
        );
        const options = {
          ...format,
          help,
          args: ["--kind", "x", "a", "--x", "bad"],
        } as const;
        const root = await captureRun(parser, options);
        const result = await captureRun(parser, {
          ...options,
          errorUsage: "command",
        });
        const usage = result.stderr.split("Error:")[0];
        assert.equal(result.exitCode, 1);
        assert.match(usage, /--kind x a --x TYPE/);
        assert.doesNotMatch(usage, /unused|--kind y/);
        assert.equal(errorText(result.stderr), errorText(root.stderr));
        if (help != null) assert.match(usage, /--help/);
      });
    }
  }

  it("should keep a positional discriminator before its command", async () => {
    const parser = conditional(
      argument(choice(["x", "y"], { metavar: "KIND" })),
      {
        x: command("a", option("--x", choice(["ok"]))),
        y: command("b", constant(null)),
      },
    );
    assert.ok(parseSync(parser, ["x", "a", "--x", "ok"]).success);
    assert.ok(!parseSync(parser, ["a", "x", "--x", "ok"]).success);
    const result = await captureRun(parser, {
      ...format,
      args: ["x", "a", "--x", "bad"],
      errorUsage: "command",
    });
    const usage = result.stderr.split("Error:")[0];
    assert.match(usage, /tool KIND a --x TYPE/);
    assert.doesNotMatch(usage, /\bb\b/);
    assert.equal(result.exitCode, 1);
  });

  it("should distinguish completion-option-only configuration from augmentation", async () => {
    const result = await captureRun(nestedCommands(), {
      ...format,
      completion: "option",
      args: ["config", "set", "--port", "bad"],
      errorUsage: "command",
    });
    assert.match(result.stderr, /tool config set/);
    assert.doesNotMatch(result.stderr, /serve/);
  });

  it("should discard empty-alternative brackets after a command matches", async () => {
    const parser = or(
      command("config", option("--port", choice(["80", "443"]))),
      command("serve", constant(null)),
      constant(null),
    );
    const result = await captureRun(parser, {
      ...format,
      args: ["config", "--port", "bad"],
      errorUsage: "command",
    });
    assert.match(result.stderr, /tool config --port TYPE/);
    assert.doesNotMatch(result.stderr, /\[config|serve/);
  });

  it("should match the existing help synopsis for the same simple grammar", async () => {
    const parser = or(
      command("config", argument(string({ metavar: "PORT" }))),
      command("serve", constant(null)),
    );
    const options = { ...format, args: ["config", "8080", "extra"] } as const;
    const usage = await captureRun(parser, {
      ...options,
      errorUsage: "command",
    });
    const help = await captureRun(parser, { ...options, aboveError: "help" });
    assert.equal(usage.stderr.split("\n")[0], "Usage: tool config PORT");
    assert.equal(usage.stderr.split("\n")[0], help.stderr.split("\n")[0]);
  });

  it("should honor width, color and custom failure exits", async () => {
    const result = await captureRun(nestedCommands(), {
      ...format,
      colors: true,
      maxWidth: 40,
      errorExitCode: 7,
      args: ["config", "set", "--port", "bad"],
      errorUsage: "command",
    });
    const plain = stripVTControlCharacters(result.stderr);
    assert.notEqual(result.stderr, plain);
    assert.equal(result.exitCode, 7);
    assert.match(plain, /tool config set/);
    assert.doesNotMatch(plain, /serve/);
    assert.ok(plain.split("\n").every((line) => line.length <= 40), plain);
  });

  for (
    const args of [["completion", "unknown-shell"], ["version", "extra"], [
      "help",
      "unknown",
    ]]
  ) {
    it(`should preserve meta failure behavior for ${args.join(" ")}`, async () => {
      const options = {
        ...format,
        args,
        help: "both",
        completion: "both",
        version: { value: "1.0", command: true, option: true },
      } as const;
      assert.deepEqual(
        await captureRun(nestedCommands(), {
          ...options,
          errorUsage: "command",
        }),
        await captureRun(nestedCommands(), { ...options, errorUsage: "root" }),
      );
    });
  }
});

// Helpers
function nestedCommands(hidden?: HiddenVisibility) {
  return object({
    global: optional(flag("--global")),
    commands: or(
      command(
        "config",
        object({
          verbose: optional(flag("--verbose")),
          commands: or(
            command(
              "set",
              option("--port", choice(["80", "443"], { metavar: "PORT" })),
              {
                aliases: ["s", "change"],
              },
            ),
            command("get", argument(string({ metavar: "KEY" }))),
          ),
        }),
        { aliases: ["cfg", "configuration"], hidden },
      ),
      command("serve", constant(null)),
      command("deploy", constant(null)),
    ),
  });
}

function errorText(output: string): string {
  return output.slice(output.indexOf("Error:"));
}
