import { object, or } from "@optique/core/constructs";
import { type RunOptions, runParser } from "@optique/core/facade";
import { type Message, message } from "@optique/core/message";
import { withDefault } from "@optique/core/modifiers";
import { command, constant, option } from "@optique/core/primitives";
import { choice, string, type ValueParser } from "@optique/core/valueparser";
import { withAutomaticWidth } from "#src/terminal-width.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("errorUsage", () => {
  for (const mode of ["sync", "async"] as const) {
    it(`should add no ${mode} evaluation and preserve callbacks`, async () => {
      const results = [];
      const error = message`Rejected port.`;
      for (const preamble of ["none", "root", "command"] as const) {
        const trace: string[] = [];
        const writes: string[] = [];
        const callbacks: { readonly code: number; readonly error: Message }[] =
          [];
        const sync: ValueParser<"sync", string> = {
          mode: "sync",
          metavar: "PORT",
          placeholder: "80",
          parse() {
            trace.push("value");
            return { success: false, error };
          },
          format: (value) => value,
        };
        const async: ValueParser<"async", string> = {
          mode: "async",
          metavar: sync.metavar,
          placeholder: sync.placeholder,
          format: sync.format,
          parse(input) {
            return Promise.resolve(sync.parse(input));
          },
        };
        const leaf = option("--port", mode === "sync" ? sync : async);
        const tracked = {
          ...leaf,
          parse(context: Parameters<typeof leaf.parse>[0]) {
            trace.push("parse");
            return leaf.parse(context);
          },
          complete(...args: Parameters<typeof leaf.complete>) {
            trace.push("complete");
            return leaf.complete(...args);
          },
          getDocFragments(): never {
            throw new Error("Unexpected documentation evaluation.");
          },
        };
        const override = (): never => {
          throw new Error("Unexpected usage override.");
        };
        const parser = or(
          command(
            "config",
            object({
              port: tracked,
              name: withDefault(option("--name", string()), () => {
                trace.push("default");
                return "local";
              }),
            }),
            { usageLine: override },
          ),
          command("serve", constant(null)),
        );

        const result = runParser(parser, "tool", ["config", "--port", "bad"], {
          colors: false,
          maxWidth: 80,
          aboveError: preamble === "none" ? "none" : "usage",
          errorUsage: preamble === "command" ? "command" : "root",
          usageLine: override,
          stdout: () => assert.fail("Failures do not write stdout."),
          stderr(chunk) {
            writes.push(chunk);
          },
          onError(code, received) {
            assert.ok(writes.at(-1)?.startsWith("Error:"));
            callbacks.push({ code, error: received });
            return "handled";
          },
        });
        if (mode === "sync") assert.ok(!(result instanceof Promise));
        else assert.ok(result instanceof Promise);
        assert.equal(await result, "handled");
        assert.equal(callbacks.length, 1);
        assert.equal(callbacks[0].code, 1);
        assert.deepEqual(callbacks[0].error.slice(-error.length), error);
        assert.ok(trace.includes("parse"));
        assert.equal(trace.filter((event) => event === "value").length, 1);
        assert.equal(writes.length, preamble === "none" ? 1 : 2);
        if (preamble === "command") assert.doesNotMatch(writes[0], /serve/);
        results.push({ trace, callbacks, error: writes.at(-1) });
      }
      assert.deepEqual(results[1], results[0]);
      assert.deepEqual(results[2], results[0]);
    });
  }

  for (const aboveError of ["none", "help"] as const) {
    it(`should leave aboveError=${aboveError} unchanged`, () => {
      const parser = or(
        command("config", option("--port", choice(["80"]))),
        command("serve", constant(null)),
      );
      const render = (errorUsage: "root" | "command") => {
        const chunks: string[] = [];
        runParser(parser, "tool", ["config", "--port", "bad"], {
          aboveError,
          errorUsage,
          colors: false,
          maxWidth: 80,
          stderr: (chunk) => chunks.push(chunk),
          onError: () => null,
        });
        return chunks;
      };
      assert.deepEqual(render("command"), render("root"));
    });
  }

  it("should preserve full help without documentation fragments", () => {
    const inner = command("config", option("--port", choice(["80"])));
    const parser = {
      ...inner,
      usage: or(inner, command("serve", constant(null))).usage,
      getDocFragments: () => ({ fragments: [] }),
    };
    const render = (errorUsage: "root" | "command") => {
      const chunks: string[] = [];
      runParser(parser, "tool", ["config", "--port", "bad"], {
        aboveError: "help",
        errorUsage,
        colors: false,
        stderr: (chunk) => chunks.push(chunk),
        onError: () => null,
      });
      return chunks;
    };
    const root = render("root");
    assert.match(root[0], /^Usage: tool config --port TYPE/);
    assert.deepEqual(render("command"), root);
  });

  it("should resolve automatic width from the selected usage", () => {
    const parser = or(
      command("a", option("-p", choice(["80"]))),
      command("a-very-long-unrelated-command", constant(null)),
    );
    const widths = [];
    for (const errorUsage of ["root", "command"] as const) {
      let width: number | undefined;
      const options: RunOptions<never, null> = withAutomaticWidth({
        colors: false,
        maxWidth: 16,
        errorUsage,
        messageFormatter(_message, format) {
          width = format?.maxWidth;
          return "failure";
        },
        stderr: () => {},
        onError: () => null,
      });
      runParser(parser, "tool", ["a", "-p", "bad"], options);
      widths.push(width);
    }
    assert.deepEqual(widths, [undefined, 16]);
  });
});
