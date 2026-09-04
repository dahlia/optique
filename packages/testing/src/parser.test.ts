import { getAnnotations } from "@optique/core/annotations";
import { message } from "@optique/core/message";
import type { Parser } from "@optique/core/parser";
import { command, constant, option } from "@optique/core/primitives";
import type { ValueParser } from "@optique/core/valueparser";
import { parseArgs, parseArgsSync } from "@optique/testing/parser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const asyncString: ValueParser<"async", string> = {
  mode: "async",
  metavar: "VALUE",
  placeholder: "",
  parse(input) {
    return Promise.resolve({
      success: true as const,
      value: input.toUpperCase(),
    });
  },
  format(value) {
    return value;
  },
  async *suggest() {},
};

describe("parseArgsSync()", () => {
  it("should preserve the inferred parser value", () => {
    const result = parseArgsSync(option("--verbose"), ["--verbose"]);

    assert.ok(result.success);
    if (result.success) {
      const value: boolean = result.value;
      assert.ok(value);
    }
  });

  it("should report remaining arguments and the canonical command path", () => {
    const parser = command(
      "serve",
      command("http", option("--port"), { aliases: ["web"] }),
    );
    const result = parseArgsSync(parser, ["serve", "web", "--unknown"]);

    assert.ok(!result.success);
    if (!result.success) {
      assert.deepEqual(result.remainingArgs, ["--unknown"]);
      assert.deepEqual(result.commandPath, ["serve", "http"]);
    }
  });

  it("should report no remaining arguments when completion fails", () => {
    const result = parseArgsSync(option("--required"), []);

    assert.ok(!result.success);
    if (!result.success) {
      assert.deepEqual(result.remainingArgs, []);
      assert.deepEqual(result.commandPath, []);
    }
  });

  it("should pass annotations through ParseOptions", () => {
    const key = Symbol.for("@optique/testing/parser-test");
    const base = constant("ok");
    const parser = {
      ...base,
      complete(state: typeof base.initialState) {
        assert.equal(getAnnotations(state)?.[key], "value");
        return base.complete(state);
      },
    };

    const result = parseArgsSync(parser, [], {
      annotations: { [key]: "value" },
    });
    assert.deepEqual(result, { success: true, value: "ok" });
  });

  it("should use frozen parser instances without wrapping them", () => {
    class FrozenParser {
      readonly mode = "sync" as const;
      readonly $valueType = [] as readonly number[];
      readonly $stateType = [] as readonly number[];
      readonly priority = 0;
      readonly usage = [];
      readonly leadingNames = new Set<string>();
      readonly acceptingAnyToken = true;
      readonly initialState = 0;
      #parseCalls = 0;

      parse(context: Parameters<Parser<"sync", number, number>["parse"]>[0]) {
        this.#parseCalls++;
        return {
          success: true as const,
          consumed: [context.buffer[0] ?? ""],
          next: {
            ...context,
            buffer: context.buffer.slice(1),
            state: context.state + 1,
          },
        };
      }

      complete(state: number) {
        return { success: true as const, value: state + this.#parseCalls };
      }

      *suggest() {}

      getDocFragments() {
        return { fragments: [] };
      }
    }

    const parser = Object.freeze(new FrozenParser());
    assert.deepEqual(parseArgsSync(parser, ["one"]), {
      success: true,
      value: 2,
    });
  });

  it("should reject async parsers before invoking them", () => {
    let invoked = false;
    const parser: Parser<"async", string, undefined> = {
      mode: "async",
      $valueType: [],
      $stateType: [],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: undefined,
      parse() {
        invoked = true;
        return Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`unused`,
        });
      },
      complete() {
        invoked = true;
        return Promise.resolve({ success: true as const, value: "unused" });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    assert.throws(
      // @ts-expect-error An async parser is invalid for parseArgsSync().
      () => parseArgsSync(parser, []),
      {
        name: "TypeError",
        message:
          "Cannot use an async parser with parseArgsSync(). Use parseArgs() instead.",
      },
    );
    assert.ok(!invoked);
  });
});

describe("parseArgs()", () => {
  it("should always return a promise for sync parsers", async () => {
    const promise = parseArgs(constant("ok"), []);

    assert.ok(promise instanceof Promise);
    assert.deepEqual(await promise, { success: true, value: "ok" });
  });

  it("should isolate concurrent calls", async () => {
    const parser = command("show", option("--json"));
    const [success, failure] = await Promise.all([
      parseArgs(parser, ["show", "--json"]),
      parseArgs(parser, ["show", "--unknown"]),
    ]);

    assert.deepEqual(success, { success: true, value: true });
    assert.ok(!failure.success);
    if (!failure.success) {
      assert.deepEqual(failure.remainingArgs, ["--unknown"]);
      assert.deepEqual(failure.commandPath, ["show"]);
    }
  });

  it("should run asynchronous parsers", async () => {
    const result = await parseArgs(option("--value", asyncString), [
      "--value",
      "hello",
    ]);
    assert.deepEqual(result, { success: true, value: "HELLO" });
  });

  it("should preserve failure progress for asynchronous parsers", async () => {
    const parser = command("show", option("--value", asyncString));
    const result = await parseArgs(parser, ["show", "--unknown"]);

    assert.ok(!result.success);
    if (!result.success) {
      assert.deepEqual(result.remainingArgs, ["--unknown"]);
      assert.deepEqual(result.commandPath, ["show"]);
    }
  });

  it("should turn synchronous exceptions into promise rejections", async () => {
    const base = constant("ok");
    const parser = {
      ...base,
      complete(): ReturnType<typeof base.complete> {
        throw new RangeError("Completion failed.");
      },
    };

    await assert.rejects(parseArgs(parser, []), {
      name: "RangeError",
      message: "Completion failed.",
    });
  });
});
