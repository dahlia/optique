import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { conditional, longestMatch, merge, object, or } from "./constructs.ts";
import {
  createDeferredFailure,
  withConsumedDepth,
} from "./internal/failure.ts";
import { formatMessage, message } from "./message.ts";
import { multiple, optional } from "./modifiers.ts";
import { parseAsync, parseSync } from "./parser.ts";
import {
  argument,
  command,
  flag,
  negatableFlag,
  option,
} from "./primitives.ts";
import { findSimilar } from "./suggestion.ts";
import { choice, string, type ValueParser } from "./valueparser.ts";

const asyncString: ValueParser<"async", string> = {
  mode: "async",
  metavar: "STRING",
  placeholder: "",
  parse: (input) => Promise.resolve({ success: true, value: input }),
  format: (value) => value,
};

describe("deferred parse diagnostics", () => {
  it("does not call noMatch for discarded failures", () => {
    let calls = 0;
    const parser = object({
      option: optional(option("--output", string(), {
        errors: {
          noMatch: () => {
            calls++;
            return message`No match.`;
          },
        },
      })),
      paths: multiple(argument(string())),
    });
    const args = Array.from({ length: 20 }, (_, i) => `src/file-${i}.ts`);

    const result = parseSync(parser, args);

    assert.ok(result.success);
    assert.equal(calls, 0);
  });

  it("invokes the callback once when an error is read and caches its message", () => {
    let calls = 0;
    let traversals = 0;
    const custom = message`Try --output.`;
    const parser = option("--output", {
      errors: {
        noMatch: (token, suggestions) => {
          calls++;
          assert.equal(token, "--outpu");
          assert.deepEqual(suggestions, findSimilar(token, ["--output"]));
          return custom;
        },
      },
    });
    const result = parser.parse({
      buffer: ["--outpu"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: [{
        type: "option",
        get names() {
          traversals++;
          return ["--output"] as const;
        },
      }],
    });

    assert.ok(!result.success);
    assert.equal(calls, 0);
    assert.equal(traversals, 0);
    if (!result.success) {
      assert.strictEqual(result.error, custom);
      assert.strictEqual(result.error, custom);
    }
    assert.equal(calls, 1);
    assert.equal(traversals, 1);
  });

  it("materializes the selected error before parseSync returns", () => {
    let calls = 0;
    const parser = option("--output", {
      errors: {
        noMatch: () => {
          calls++;
          return message`No match.`;
        },
      },
    });

    const result = parseSync(parser, ["--outpu"]);

    assert.ok(!result.success);
    assert.equal(calls, 1);
    if (!result.success) {
      assert.equal(formatMessage(result.error), "No match.");
      assert.ok("value" in Object.getOwnPropertyDescriptor(result, "error")!);
    }
  });

  it("defers default suggestions in discarded alternatives", () => {
    let formatterCalls = 0;
    const parser = or(
      or(option("--output"), option("--format"), {
        errors: {
          suggestions: () => {
            formatterCalls++;
            return message`Try another option.`;
          },
        },
      }),
      argument(string()),
    );
    const result = parseSync(parser, ["path.ts"]);

    assert.ok(result.success);
    assert.equal(formatterCalls, 0);
  });

  it("defers suggestions in discarded async alternatives", async () => {
    let formatterCalls = 0;
    const parser = or(
      or(option("--output", asyncString), option("--format"), {
        errors: {
          suggestions: () => {
            formatterCalls++;
            return message`Try another option.`;
          },
        },
      }),
      argument(string()),
    );

    assert.equal(parser.mode, "async");
    const result = await parseAsync(parser, ["path.ts"]);
    assert.ok(result.success);
    assert.equal(formatterCalls, 0);
  });

  it("skips discarded exclusive and object callbacks", () => {
    let calls = 0;
    const errors = {
      unexpectedInput: () => {
        calls++;
        return message`Unexpected input.`;
      },
    };
    const parsers = [
      or(option("-a"), option("-b"), { errors }),
      longestMatch(option("-a"), option("-b"), { errors }),
      object({ a: option("-a") }, { errors }),
    ];

    for (const parser of parsers) {
      const result = parseSync(or(parser, argument(string())), ["path.ts"]);
      assert.ok(result.success);
    }
    assert.equal(calls, 0);
  });

  it("skips discarded async exclusive and object callbacks", async () => {
    let calls = 0;
    const errors = {
      unexpectedInput: () => {
        calls++;
        return message`Unexpected input.`;
      },
    };
    const parsers = [
      or(option("-a", asyncString), option("-b"), { errors }),
      longestMatch(option("-a", asyncString), option("-b"), { errors }),
      object({ a: option("-a", asyncString) }, { errors }),
    ];

    for (const parser of parsers) {
      assert.equal(parser.mode, "async");
      const result = await parseAsync(
        or(parser, argument(string())),
        ["path.ts"],
      );
      assert.ok(result.success);
    }
    assert.equal(calls, 0);
  });

  it("skips a discarded object callback through merge", async () => {
    let calls = 0;
    const parser = or(
      merge(
        object({ a: option("-a", asyncString) }, {
          errors: {
            unexpectedInput: () => {
              calls++;
              return message`Unexpected input.`;
            },
          },
        }),
        object({ b: optional(flag("-b")) }),
      ),
      argument(string()),
    );

    assert.equal(parser.mode, "async");
    const result = await parseAsync(parser, ["path.ts"]);

    assert.ok(result.success);
    assert.equal(calls, 0);
  });

  it("does not scan suggestions for an unread merge failure", () => {
    let traversals = 0;
    const parser = merge(
      object({ a: optional(option("--alpha")) }),
      object({ b: optional(flag("--beta")) }),
    );
    const result = parser.parse({
      buffer: ["path.ts"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: [{
        type: "option",
        get names() {
          traversals++;
          return ["--alpha"] as const;
        },
      }],
    });

    assert.ok(!result.success);
    assert.equal(traversals, 0);
  });

  it("skips a discarded conditional no-match callback", () => {
    let calls = 0;
    const conditionalParser = conditional(
      option("--type", choice(["a"])),
      { a: object({}) },
      object({}),
      {
        errors: {
          noMatch: () => {
            calls++;
            return message`No match.`;
          },
        },
      },
    );

    const result = parseSync(
      or(conditionalParser, argument(string())),
      ["path.ts"],
    );

    assert.ok(result.success);
    assert.equal(calls, 0);
  });

  it("skips a discarded async conditional no-match callback", async () => {
    let calls = 0;
    const conditionalParser = conditional(
      option("--type", choice(["a"])),
      { a: object({ value: option("-a", asyncString) }) },
      object({}),
      {
        errors: {
          noMatch: () => {
            calls++;
            return message`No match.`;
          },
        },
      },
    );

    assert.equal(conditionalParser.mode, "async");
    const result = await parseAsync(
      or(conditionalParser, argument(string())),
      ["path.ts"],
    );
    assert.ok(result.success);
    assert.equal(calls, 0);
  });

  it("defers discarded flag callbacks in an async object", async () => {
    let calls = 0;
    const parser = object({
      verbose: optional(flag("--verbose", {
        errors: {
          noMatch: () => {
            calls++;
            return message`No match.`;
          },
        },
      })),
      paths: multiple(argument(asyncString)),
    });

    assert.equal(parser.mode, "async");
    const result = await parseAsync(parser, ["path.ts"]);

    assert.ok(result.success);
    assert.equal(calls, 0);
  });

  it("does not call a discarded command callback", () => {
    let calls = 0;
    const parser = or(
      command("commit", argument(string()), {
        errors: {
          notMatched: () => {
            calls++;
            return message`No match.`;
          },
        },
      }),
      command("status", argument(string())),
    );

    const result = parseSync(parser, ["status", "short"]);

    assert.ok(result.success);
    assert.equal(calls, 0);
  });

  it("does not scan usage for a literal negatable flag error", () => {
    let traversals = 0;
    const literal = message`No match.`;
    const parser = negatableFlag({
      positive: "--color",
      negative: "--no-color",
    }, { errors: { noMatch: literal } });

    const result = parser.parse({
      buffer: ["--colr"],
      state: parser.initialState,
      optionsTerminated: false,
      usage: [{
        type: "option",
        get names() {
          traversals++;
          return ["--color"] as const;
        },
      }],
    });

    assert.ok(!result.success);
    if (!result.success) assert.strictEqual(result.error, literal);
    assert.equal(traversals, 0);
  });

  it("caches a callback exception on repeated error access", () => {
    let calls = 0;
    const thrown = new Error("callback failure");
    const result = createDeferredFailure(0, () => {
      calls++;
      throw thrown;
    });

    assert.throws(() => result.error, (error) => error === thrown);
    assert.throws(() => result.error, (error) => error === thrown);
    assert.equal(calls, 1);
  });

  it("preserves an accessor's receiver when consumed depth changes", () => {
    let calls = 0;
    const value = message`Custom error.`;
    const source = {
      success: false as const,
      consumed: 0,
      marker: "custom",
      get error() {
        assert.strictEqual(this, source);
        calls++;
        return value;
      },
    };

    const copied = withConsumedDepth(source, 2);

    assert.equal(calls, 0);
    assert.equal(copied.consumed, 2);
    assert.equal(Reflect.get(copied, "marker"), "custom");
    assert.strictEqual(copied.error, value);
    assert.equal(calls, 1);
  });

  it("preserves the receiver of option and flag error callbacks", () => {
    let calls = 0;
    const errors = {
      noMatch(this: unknown) {
        assert.strictEqual(this, errors);
        calls++;
        return message`Receiver kept.`;
      },
    };
    const parsers = [
      option("--output", { errors }),
      flag("--output", { errors }),
      negatableFlag({ positive: "--output", negative: "--no-output" }, {
        errors,
      }),
    ];

    for (const parser of parsers) {
      const result = parseSync(parser, ["--outpu"]);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(formatMessage(result.error), "Receiver kept.");
      }
    }
    assert.equal(calls, parsers.length);
  });

  it("preserves the receiver of exclusive unexpected-input callbacks", () => {
    let calls = 0;
    const errors = {
      unexpectedInput(this: unknown) {
        assert.strictEqual(this, errors);
        calls++;
        return message`Receiver kept.`;
      },
    };
    const parsers = [
      or(option("--output"), option("--format"), { errors }),
      longestMatch(option("--output"), option("--format"), { errors }),
    ];

    for (const parser of parsers) {
      const result = parseSync(parser, ["--outpu"]);
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(formatMessage(result.error), "Receiver kept.");
      }
    }
    assert.equal(calls, parsers.length);
  });

  it("preserves the receiver of conditional no-match callbacks", () => {
    const errors = {
      noMatch(this: unknown) {
        assert.strictEqual(this, errors);
        return message`Receiver kept.`;
      },
    };
    const parser = conditional(
      option("--type", choice(["a"])),
      { a: object({}) },
      object({}),
      { errors },
    );

    const result = parseSync(parser, ["--unknown"]);
    assert.ok(!result.success);
    if (!result.success) {
      assert.equal(formatMessage(result.error), "Receiver kept.");
    }
  });
});
