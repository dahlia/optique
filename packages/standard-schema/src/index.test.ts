import { formatMessage, message } from "@optique/core/message";
import { option } from "@optique/core/primitives";
import { parseAsync, parseSync } from "@optique/core/parser";
import { standardSchema, standardSchemaAsync } from "@optique/standard-schema";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import assert from "node:assert/strict";
import process from "node:process";
import { describe, it } from "node:test";

function schema<Input, Output>(
  validate: StandardSchemaV1.Props<Input, Output>["validate"],
): StandardSchemaV1<Input, Output> {
  return {
    "~standard": {
      version: 1,
      vendor: "test",
      validate,
    },
  };
}

const integerSchema = schema<unknown, number>((value) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    return { issues: [{ message: "Expected an integer." }] };
  }
  return { value: parsed };
});

describe("standardSchema()", () => {
  describe("missing placeholder", () => {
    it("should throw TypeError when options are omitted", () => {
      assert.throws(
        // @ts-expect-error: intentionally omitting required options
        () => standardSchema(integerSchema),
        {
          name: "TypeError",
          message: "standardSchema() requires an options object.",
        },
      );
    });

    it("should throw TypeError when options is an array", () => {
      assert.throws(
        // @ts-expect-error: intentionally passing an array
        () => standardSchema(integerSchema, []),
        {
          name: "TypeError",
          message: "standardSchema() requires an options object, got array.",
        },
      );
    });

    it("should throw TypeError when placeholder is missing from options", () => {
      assert.throws(
        // @ts-expect-error: intentionally omitting placeholder
        () => standardSchema(integerSchema, {}),
        {
          name: "TypeError",
          message:
            "standardSchema() options must include a placeholder property.",
        },
      );
    });
  });

  describe("basic parsing", () => {
    it("should parse valid input", () => {
      const parser = standardSchema(integerSchema, { placeholder: 0 });
      const result = parser.parse("42");

      assert.ok(result.success);
      assert.equal(result.value, 42);
    });

    it("should reject invalid input with the first issue message", () => {
      const parser = standardSchema(integerSchema, { placeholder: 0 });
      const result = parser.parse("nope");

      assert.ok(!result.success);
      assert.deepEqual(result.error, message`Expected an integer.`);
    });

    it("should use a generic message when there are no issues", () => {
      const parser = standardSchema(
        schema<unknown, string>(() => ({ issues: [] })),
        { placeholder: "" },
      );
      const result = parser.parse("hello");

      assert.ok(!result.success);
      assert.deepEqual(result.error, message`Validation failed.`);
    });
  });

  describe("options", () => {
    it("should use the default metavar", () => {
      const parser = standardSchema(integerSchema, { placeholder: 0 });

      assert.equal(parser.metavar, "VALUE");
    });

    it("should use a custom metavar", () => {
      const parser = standardSchema(integerSchema, {
        placeholder: 0,
        metavar: "COUNT",
      });

      assert.equal(parser.metavar, "COUNT");
    });

    it("should reject an empty metavar", () => {
      assert.throws(
        () =>
          standardSchema(integerSchema, {
            placeholder: 0,
            metavar: "" as never,
          }),
        {
          name: "TypeError",
          message: "Expected a non-empty string.",
        },
      );
    });

    it("should use a custom error message", () => {
      const parser = standardSchema(integerSchema, {
        placeholder: 0,
        errors: {
          schemaError: message`Please provide a whole number.`,
        },
      });
      const result = parser.parse("nope");

      assert.ok(!result.success);
      assert.deepEqual(result.error, message`Please provide a whole number.`);
    });

    it("should use a custom error callback", () => {
      const parser = standardSchema(integerSchema, {
        placeholder: 0,
        errors: {
          schemaError: (issues, input) =>
            message`${input} failed: ${issues[0]?.message ?? "unknown"}`,
        },
      });
      const result = parser.parse("nope");

      assert.ok(!result.success);
      assert.equal(
        formatMessage(result.error),
        '"nope" failed: "Expected an integer."',
      );
    });

    it("should format values with the custom formatter", () => {
      const parser = standardSchema(integerSchema, {
        placeholder: 0,
        format: (value) => `${value} items`,
      });

      assert.equal(parser.format(3), "3 items");
    });

    it("should not throw for non-JSON-serializable objects", () => {
      const parser = standardSchema(
        schema<unknown, { readonly id: bigint }>((value) => ({
          value: { id: BigInt(String(value)) },
        })),
        { placeholder: { id: 0n } },
      );

      assert.equal(parser.format({ id: 1n }), "[object Object]");
    });

    it("should not throw for cyclic objects", () => {
      const parser = standardSchema(
        schema<unknown, { readonly raw: string; readonly self?: unknown }>(
          (value) => ({ value: { raw: String(value) } }),
        ),
        { placeholder: { raw: "" } },
      );
      const cyclic: { raw: string; self?: unknown } = { raw: "hello" };
      cyclic.self = cyclic;

      assert.equal(parser.format(cyclic), "[object Object]");
    });

    it("should handle objects with toJSON returning undefined", () => {
      const parser = standardSchema(
        schema<unknown, { readonly toJSON: () => undefined }>(() => ({
          value: { toJSON: () => undefined },
        })),
        { placeholder: { toJSON: () => undefined } },
      );

      assert.equal(
        parser.format({ toJSON: () => undefined }),
        "[object Object]",
      );
    });
  });

  describe("validation", () => {
    it("should validate transformed fallback values through format and parse", () => {
      const parser = standardSchema(
        schema<unknown, number>((value) => {
          if (typeof value !== "string") {
            return { issues: [{ message: "Expected a string." }] };
          }
          const parsed = Number(value);
          if (!Number.isInteger(parsed)) {
            return { issues: [{ message: "Expected an integer." }] };
          }
          return { value: parsed };
        }),
        { placeholder: 0 },
      );

      const result = option("--count", parser).validateValue?.(3);

      assert.ok(result?.success);
      assert.equal(result.value, 3);
    });
  });

  describe("sync and async schemas", () => {
    it("should throw when a sync parser receives an async validation result", () => {
      const asyncSchema = schema<unknown, string>(async (value) => {
        await Promise.resolve();
        return { value: String(value) };
      });
      const parser = standardSchema(asyncSchema, { placeholder: "" });

      assert.throws(
        () => parser.parse("hello"),
        {
          name: "TypeError",
          message:
            "Async Standard Schema validators are not supported by standardSchema(). Use standardSchemaAsync() instead.",
        },
      );
    });

    it("should observe rejected async validation results", async () => {
      const asyncSchema = schema<unknown, string>(async () => {
        await Promise.resolve();
        throw new Error("Validation crashed.");
      });
      const parser = standardSchema(asyncSchema, { placeholder: "" });
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => {
        unhandled.push(reason);
      };
      process.on("unhandledRejection", onUnhandled);

      try {
        assert.throws(
          () => parser.parse("hello"),
          {
            name: "TypeError",
            message:
              "Async Standard Schema validators are not supported by standardSchema(). Use standardSchemaAsync() instead.",
          },
        );
        await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }

      assert.deepEqual(unhandled, []);
    });

    it("should attach a rejection handler to async validation results", () => {
      let handled = false;
      const result = Promise.reject<StandardSchemaV1.Result<string>>(
        new Error("Validation crashed."),
      );
      const originalThen = result.then.bind(result);
      Object.defineProperty(result, "then", {
        value<TResult1 = StandardSchemaV1.Result<string>, TResult2 = never>(
          onFulfilled?:
            | ((
              value: StandardSchemaV1.Result<string>,
            ) => TResult1 | PromiseLike<TResult1>)
            | null,
          onRejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null,
        ): Promise<TResult1 | TResult2> {
          handled = onRejected != null;
          return originalThen(onFulfilled, onRejected);
        },
      });
      const asyncSchema = schema<unknown, string>(() => result);
      const parser = standardSchema(asyncSchema, { placeholder: "" });

      assert.throws(
        () => parser.parse("hello"),
        {
          name: "TypeError",
          message:
            "Async Standard Schema validators are not supported by standardSchema(). Use standardSchemaAsync() instead.",
        },
      );
      assert.ok(handled);
    });

    it("should work with parseSync()", () => {
      const parser = option(
        "--count",
        standardSchema(integerSchema, {
          placeholder: 0,
        }),
      );
      const result = parseSync(parser, ["--count", "42"]);

      assert.equal(result.success, true);
      assert.equal(result.value, 42);
    });
  });
});

describe("standardSchemaAsync()", () => {
  it("should also accept a synchronous validator", async () => {
    const parser = standardSchemaAsync(
      schema<unknown, number>((value) => ({ value: Number(value) })),
      { placeholder: 0 },
    );

    const result = await parser.parse("42");

    assert.ok(result.success);
    assert.equal(result.value, 42);
  });

  it("should parse with an async validator", async () => {
    const parser = standardSchemaAsync(
      schema<unknown, string>(async (value) => {
        await Promise.resolve();
        if (value === "known") return { value };
        return { issues: [{ message: "Unknown value." }] };
      }),
      { placeholder: "" },
    );

    const result = await parser.parse("known");

    assert.ok(result.success);
    assert.equal(result.value, "known");
  });

  it("should reject invalid input from an async validator", async () => {
    const parser = standardSchemaAsync(
      schema<unknown, string>(async () => {
        await Promise.resolve();
        return { issues: [{ message: "Unknown value." }] };
      }),
      { placeholder: "" },
    );

    const result = await parser.parse("missing");

    assert.ok(!result.success);
    assert.deepEqual(result.error, message`Unknown value.`);
  });

  it("should work with parseAsync()", async () => {
    const parser = option(
      "--name",
      standardSchemaAsync(
        schema<unknown, string>(async (value) => {
          await Promise.resolve();
          return { value: String(value) };
        }),
        { placeholder: "" },
      ),
    );
    const result = await parseAsync(parser, ["--name", "Alice"]);

    assert.equal(result.success, true);
    assert.equal(result.value, "Alice");
  });
});
