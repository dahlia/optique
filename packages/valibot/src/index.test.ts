import { message } from "@optique/core/message";
import { valibot } from "@optique/valibot";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as v from "valibot";

describe("valibot()", () => {
  describe("missing placeholder", () => {
    it("should throw TypeError when options are omitted", () => {
      assert.throws(
        // @ts-expect-error: intentionally omitting required options
        () => valibot(v.string()),
        {
          name: "TypeError",
          message:
            "valibot() requires an options object with a placeholder property.",
        },
      );
    });

    it("should throw TypeError when placeholder is missing from options", () => {
      assert.throws(
        // @ts-expect-error: intentionally omitting placeholder
        () => valibot(v.string(), {}),
        {
          name: "TypeError",
          message: "valibot() options must include a placeholder property.",
        },
      );
    });
  });

  describe("basic parsing", () => {
    it("should parse valid string input", () => {
      const parser = valibot(v.string(), { placeholder: "" });
      const result = parser.parse("hello");

      assert.ok(result.success);
      assert.equal(result.value, "hello");
    });

    it("should parse valid email", () => {
      const parser = valibot(v.pipe(v.string(), v.email()), {
        placeholder: "",
      });
      const result = parser.parse("user@example.com");

      assert.ok(result.success);
      assert.equal(result.value, "user@example.com");
    });

    it("should reject invalid email", () => {
      const parser = valibot(v.pipe(v.string(), v.email()), {
        placeholder: "",
      });
      const result = parser.parse("not-an-email");

      assert.ok(!result.success);
    });

    it("should parse valid URL", () => {
      const parser = valibot(v.pipe(v.string(), v.url()), { placeholder: "" });
      const result = parser.parse("https://example.com");

      assert.ok(result.success);
      assert.equal(result.value, "https://example.com");
    });

    it("should reject invalid URL", () => {
      const parser = valibot(v.pipe(v.string(), v.url()), { placeholder: "" });
      const result = parser.parse("not-a-url");

      assert.ok(!result.success);
    });
  });

  describe("number transformation", () => {
    it("should parse number with transformation", () => {
      const parser = valibot(v.pipe(v.string(), v.transform(Number)), {
        placeholder: 0,
      });
      const result = parser.parse("42");

      assert.ok(result.success);
      assert.equal(result.value, 42);
    });

    it("should parse integer with validation", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform(Number), v.number(), v.integer()),
        { placeholder: 0 },
      );
      const result = parser.parse("42");

      assert.ok(result.success);
      assert.equal(result.value, 42);
    });

    it("should reject non-integer when integer() is required", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform(Number), v.number(), v.integer()),
        { placeholder: 0 },
      );
      const result = parser.parse("42.5");

      assert.ok(!result.success);
    });

    it("should validate number ranges", () => {
      const parser = valibot(
        v.pipe(
          v.string(),
          v.transform(Number),
          v.number(),
          v.integer(),
          v.minValue(1024),
          v.maxValue(65535),
        ),
        { placeholder: 0 },
      );

      const validResult = parser.parse("8080");
      assert.ok(validResult.success);
      assert.equal(validResult.value, 8080);

      const tooSmallResult = parser.parse("100");
      assert.ok(!tooSmallResult.success);

      const tooLargeResult = parser.parse("70000");
      assert.ok(!tooLargeResult.success);
    });

    it("should reject non-numeric input with transformation", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform(Number), v.number()),
        { placeholder: 0 },
      );
      const result = parser.parse("not-a-number");

      assert.ok(!result.success);
    });
  });

  describe("picklist validation", () => {
    it("should parse valid picklist value", () => {
      const parser = valibot(v.picklist(["debug", "info", "warn", "error"]), {
        placeholder: "debug",
      });
      const result = parser.parse("info");

      assert.ok(result.success);
      assert.equal(result.value, "info");
    });

    it("should reject invalid picklist value", () => {
      const parser = valibot(v.picklist(["debug", "info", "warn", "error"]), {
        placeholder: "debug",
      });
      const result = parser.parse("trace");

      assert.ok(!result.success);
    });
  });

  describe("transformations", () => {
    it("should apply transformations", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform((s) => s.toUpperCase())),
        { placeholder: "" },
      );
      const result = parser.parse("hello");

      assert.ok(result.success);
      assert.equal(result.value, "HELLO");
    });

    it("should parse and transform dates", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform((s) => new Date(s))),
        { placeholder: new Date(0) },
      );
      const result = parser.parse("2025-01-01");

      assert.ok(result.success);
      assert.ok(result.value instanceof Date);
      assert.equal(result.value.getUTCFullYear(), 2025);
    });
  });

  describe("metavar inference", () => {
    describe("basic types", () => {
      it("should infer STRING for v.string()", () => {
        const parser = valibot(v.string(), { placeholder: "" });
        assert.equal(parser.metavar, "STRING");
      });

      it("should infer NUMBER for v.number()", () => {
        const parser = valibot(v.number(), { placeholder: 0 });
        assert.equal(parser.metavar, "NUMBER");
      });

      it("should infer INTEGER for v.pipe(v.number(), v.integer())", () => {
        const parser = valibot(v.pipe(v.number(), v.integer()), {
          placeholder: 0,
        });
        assert.equal(parser.metavar, "INTEGER");
      });

      it("should infer BOOLEAN for v.boolean()", () => {
        const parser = valibot(v.boolean(), { placeholder: false });
        assert.equal(parser.metavar, "BOOLEAN");
      });

      it("should infer DATE for v.date()", () => {
        const parser = valibot(v.date(), { placeholder: new Date(0) });
        assert.equal(parser.metavar, "DATE");
      });
    });

    describe("refined string types", () => {
      it("should infer EMAIL for v.pipe(v.string(), v.email())", () => {
        const parser = valibot(v.pipe(v.string(), v.email()), {
          placeholder: "",
        });
        assert.equal(parser.metavar, "EMAIL");
      });

      it("should infer URL for v.pipe(v.string(), v.url())", () => {
        const parser = valibot(v.pipe(v.string(), v.url()), {
          placeholder: "",
        });
        assert.equal(parser.metavar, "URL");
      });

      it("should infer UUID for v.pipe(v.string(), v.uuid())", () => {
        const parser = valibot(v.pipe(v.string(), v.uuid()), {
          placeholder: "",
        });
        assert.equal(parser.metavar, "UUID");
      });

      it("should infer ULID for v.pipe(v.string(), v.ulid())", () => {
        const parser = valibot(v.pipe(v.string(), v.ulid()), {
          placeholder: "",
        });
        assert.equal(parser.metavar, "ULID");
      });

      it("should infer CUID2 for v.pipe(v.string(), v.cuid2())", () => {
        const parser = valibot(v.pipe(v.string(), v.cuid2()), {
          placeholder: "",
        });
        assert.equal(parser.metavar, "CUID2");
      });

      it("should infer additional string refinements from internal pipeline", () => {
        const make = (actionType: string) =>
          valibot({
            type: "string",
            pipe: [{ type: actionType }],
          } as unknown as v.BaseSchema<
            unknown,
            unknown,
            v.BaseIssue<unknown>
          >, { placeholder: "" as unknown });

        assert.equal(make("iso_date").metavar, "DATE");
        assert.equal(make("iso_date_time").metavar, "DATETIME");
        assert.equal(make("iso_time").metavar, "TIME");
        assert.equal(make("iso_timestamp").metavar, "TIMESTAMP");
        assert.equal(make("ipv4").metavar, "IPV4");
        assert.equal(make("ipv6").metavar, "IPV6");
        assert.equal(make("ip").metavar, "IP");
        assert.equal(make("emoji").metavar, "EMOJI");
        assert.equal(make("base64").metavar, "BASE64");
      });
    });

    describe("picklist and union types", () => {
      it("should infer CHOICE for v.picklist()", () => {
        const parser = valibot(v.picklist(["debug", "info", "warn", "error"]), {
          placeholder: "debug",
        });
        assert.equal(parser.metavar, "CHOICE");
      });

      it("should infer VALUE for v.union()", () => {
        const parser = valibot(v.union([v.string(), v.number()]), {
          placeholder: "",
        });
        assert.equal(parser.metavar, "VALUE");
      });

      it("should infer CHOICE for v.literal()", () => {
        const parser = valibot(v.literal("production"), {
          placeholder: "production",
        });
        assert.equal(parser.metavar, "CHOICE");
      });
    });

    describe("edge cases", () => {
      it("should use first validation for multiple validations", () => {
        const parser = valibot(
          v.pipe(v.string(), v.email(), v.minLength(5)),
          { placeholder: "" },
        );
        assert.equal(parser.metavar, "EMAIL");
      });

      it("should unwrap optional schemas", () => {
        const parser = valibot(v.optional(v.pipe(v.string(), v.email())), {
          placeholder: "",
        });
        assert.equal(parser.metavar, "EMAIL");
      });

      it("should unwrap nullable schemas", () => {
        const parser = valibot(v.nullable(v.number()), { placeholder: 0 });
        assert.equal(parser.metavar, "NUMBER");
      });

      it("should unwrap nullish schemas", () => {
        const parser = valibot(v.nullish(v.pipe(v.string(), v.email())), {
          placeholder: "",
        });
        assert.equal(parser.metavar, "EMAIL");
      });

      it("should allow manual override", () => {
        const parser = valibot(v.pipe(v.string(), v.email()), {
          placeholder: "",
          metavar: "CUSTOM",
        });
        assert.equal(parser.metavar, "CUSTOM");
      });

      it("should reject empty metavar", () => {
        assert.throws(
          () => valibot(v.string(), { placeholder: "", metavar: "" as never }),
          {
            name: "TypeError",
            message: "Expected a non-empty string.",
          },
        );
      });

      it("should fallback to VALUE for unknown types", () => {
        const parser = valibot(v.object({ name: v.string() }), {
          placeholder: { name: "" },
        });
        assert.equal(parser.metavar, "VALUE");
      });

      it("should fallback to VALUE for transform schemas without pipeline type", () => {
        const parser = valibot(
          v.pipe(v.string(), v.transform((s) => s.toUpperCase())),
          { placeholder: "" },
        );
        assert.equal(parser.metavar, "VALUE");
      });

      it("should fallback to VALUE when internal schema type is missing", () => {
        const parser = valibot({
          pipe: [{ type: "email" }],
        } as unknown as v.BaseSchema<
          unknown,
          unknown,
          v.BaseIssue<unknown>
        >, { placeholder: "" as unknown });
        assert.equal(parser.metavar, "VALUE");
      });

      it("should infer VALUE for number pipeline with transform", () => {
        const parser = valibot({
          type: "number",
          pipe: [{ type: "transform" }],
        } as unknown as v.BaseSchema<
          unknown,
          unknown,
          v.BaseIssue<unknown>
        >, { placeholder: "" as unknown });
        assert.equal(parser.metavar, "VALUE");
      });

      it("should fallback to VALUE for array schemas", () => {
        const parser = valibot(v.array(v.string()), { placeholder: [] });
        assert.equal(parser.metavar, "VALUE");
      });
    });

    describe("number with constraints", () => {
      it("should infer INTEGER for v.pipe(v.number(), v.integer(), v.minValue())", () => {
        const parser = valibot(
          v.pipe(v.number(), v.integer(), v.minValue(1024), v.maxValue(65535)),
          { placeholder: 0 },
        );
        assert.equal(parser.metavar, "INTEGER");
      });

      it("should infer NUMBER for v.pipe(v.number(), v.minValue()) without integer()", () => {
        const parser = valibot(
          v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
          { placeholder: 0 },
        );
        assert.equal(parser.metavar, "NUMBER");
      });
    });
  });

  describe("format()", () => {
    it("should format string values", () => {
      const parser = valibot(v.string(), { placeholder: "" });
      assert.equal(parser.format("hello"), "hello");
    });

    it("should format number values", () => {
      const parser = valibot(v.number(), { placeholder: 0 });
      assert.equal(parser.format(42), "42");
    });

    it("should format boolean values", () => {
      const parser = valibot(v.boolean(), { placeholder: false });
      assert.equal(parser.format(true), "true");
      assert.equal(parser.format(false), "false");
    });

    it("should format date values as ISO strings", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform((s) => new Date(s))),
        { placeholder: new Date(0) },
      );
      const date = new Date("2025-06-15T00:00:00.000Z");
      assert.equal(parser.format(date), "2025-06-15T00:00:00.000Z");
    });

    it("should not throw for invalid date values", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform((s) => new Date(s))),
        { placeholder: new Date(0) },
      );
      const invalid = new Date("bad");
      assert.equal(parser.format(invalid), "Invalid Date");
    });

    it("should format object values as JSON", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform((s) => ({ raw: s }))),
        { placeholder: { raw: "" } },
      );
      assert.equal(parser.format({ raw: "hello" }), '{"raw":"hello"}');
    });

    it("should format array values as comma-separated string", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform((s) => s.split(","))),
        { placeholder: [] },
      );
      assert.equal(parser.format(["a", "b", "c"]), "a,b,c");
    });

    it("should preserve array formatting even with [object Object] element", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform((s) => s.split(","))),
        { placeholder: [] },
      );
      assert.equal(
        parser.format(["a", "[object Object]", "c"]),
        "a,[object Object],c",
      );
    });

    it("should format arrays of objects via String()", () => {
      const parser = valibot(
        v.pipe(
          v.string(),
          v.transform((s) => s.split(",").map((x) => ({ v: x }))),
        ),
        { placeholder: [] },
      );
      assert.equal(
        parser.format([{ v: "a" }, { v: "b" }]),
        "[object Object],[object Object]",
      );
    });

    it("should not throw for non-JSON-serializable objects", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform((s) => ({ id: BigInt(s) }))),
        { placeholder: { id: 0n } },
      );
      assert.equal(parser.format({ id: 1n }), "[object Object]");
    });

    it("should not throw for cyclic objects", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform((s) => ({ raw: s }))),
        { placeholder: { raw: "" } },
      );
      const cyclic: { raw: string; self?: unknown } = { raw: "hello" };
      cyclic.self = cyclic;
      assert.equal(parser.format(cyclic), "[object Object]");
    });

    it("should handle objects with toJSON returning undefined", () => {
      const parser = valibot(
        v.pipe(
          v.string(),
          v.transform(() => ({ toJSON: () => undefined })),
        ),
        { placeholder: { toJSON: () => undefined } },
      );
      assert.equal(
        parser.format({ toJSON: () => undefined }),
        "[object Object]",
      );
    });

    it("should use custom format function from options", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform((s) => ({ raw: s }))),
        { placeholder: { raw: "" }, format: (val) => val.raw },
      );
      assert.equal(parser.format({ raw: "hello" }), "hello");
    });
  });

  describe("error customization", () => {
    it("should use custom static error message", () => {
      const parser = valibot(v.pipe(v.string(), v.email()), {
        placeholder: "",
        errors: {
          valibotError: message`Please provide a valid email address.`,
        },
      });

      const result = parser.parse("not-an-email");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Please provide a valid email address." },
      ]);
    });

    it("should use custom error function with input", () => {
      const parser = valibot(v.pipe(v.string(), v.email()), {
        placeholder: "",
        errors: {
          valibotError: (_issues, input) =>
            message`Please provide a valid email address, got ${input}.`,
        },
      });

      const result = parser.parse("not-an-email");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Please provide a valid email address, got " },
        { type: "value", value: "not-an-email" },
        { type: "text", text: "." },
      ]);
    });

    it("should use custom error function with Valibot issues", () => {
      const parser = valibot(
        v.pipe(
          v.string(),
          v.transform(Number),
          v.number(),
          v.integer(),
          v.minValue(1),
          v.maxValue(10),
        ),
        {
          placeholder: 0,
          errors: {
            valibotError: (issues, input) => {
              const issue = issues[0];
              const issueLike = issue as
                | { readonly type?: string; readonly kind?: string }
                | undefined;
              const issueType = issueLike?.type ?? issueLike?.kind;
              if (issueType === "min_value") {
                return message`Value must be at least 1.`;
              }
              if (issueType === "max_value") {
                return message`Value must be at most 10.`;
              }
              return message`Invalid value: ${input}`;
            },
          },
        },
      );

      const tooSmallResult = parser.parse("0");
      assert.ok(!tooSmallResult.success);
      assert.deepEqual(tooSmallResult.error, [
        { type: "text", text: "Value must be at least 1." },
      ]);

      const tooBigResult = parser.parse("100");
      assert.ok(!tooBigResult.success);
      assert.deepEqual(tooBigResult.error, [
        { type: "text", text: "Value must be at most 10." },
      ]);
    });
  });

  describe("default error messages", () => {
    it("should provide default error for invalid input", () => {
      const parser = valibot(v.pipe(v.string(), v.email()), {
        placeholder: "",
      });
      const result = parser.parse("not-an-email");

      assert.ok(!result.success);
      // Should have some error message from Valibot
      assert.ok(result.error.length > 0);
    });

    it("should handle validation errors gracefully", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform(Number), v.number(), v.minValue(10)),
        { placeholder: 0 },
      );
      const result = parser.parse("5");

      assert.ok(!result.success);
      assert.ok(result.error.length > 0);
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      const parser = valibot(v.pipe(v.string(), v.minLength(1)), {
        placeholder: "",
      });
      const result = parser.parse("");

      assert.ok(!result.success);
    });

    it("should handle optional schemas", () => {
      const parser = valibot(v.optional(v.string()), { placeholder: "" });
      const result = parser.parse("hello");

      assert.ok(result.success);
      assert.equal(result.value, "hello");
    });

    it("should handle literal values", () => {
      const parser = valibot(v.literal("production"), {
        placeholder: "production",
      });

      const validResult = parser.parse("production");
      assert.ok(validResult.success);
      assert.equal(validResult.value, "production");

      const invalidResult = parser.parse("development");
      assert.ok(!invalidResult.success);
    });

    it("should handle union types", () => {
      const parser = valibot(
        v.union([
          v.literal("auto"),
          v.pipe(v.string(), v.transform(Number), v.number(), v.integer()),
        ]),
        { placeholder: "auto" },
      );

      const literalResult = parser.parse("auto");
      assert.ok(literalResult.success);
      assert.equal(literalResult.value, "auto");

      const numberResult = parser.parse("42");
      assert.ok(numberResult.success);
      assert.equal(numberResult.value, 42);

      const invalidResult = parser.parse("invalid");
      assert.ok(!invalidResult.success);
    });
  });

  describe("complex schemas", () => {
    it("should handle regex validation", () => {
      const parser = valibot(v.pipe(v.string(), v.regex(/^[A-Z]{3}$/)), {
        placeholder: "",
      });

      const validResult = parser.parse("ABC");
      assert.ok(validResult.success);

      const invalidResult = parser.parse("abc");
      assert.ok(!invalidResult.success);
    });

    it("should handle length constraints", () => {
      const parser = valibot(v.pipe(v.string(), v.length(5)), {
        placeholder: "",
      });

      const validResult = parser.parse("hello");
      assert.ok(validResult.success);

      const invalidResult = parser.parse("hi");
      assert.ok(!invalidResult.success);
    });

    it("should handle min/max length", () => {
      const parser = valibot(
        v.pipe(v.string(), v.minLength(2), v.maxLength(10)),
        { placeholder: "" },
      );

      const validResult = parser.parse("hello");
      assert.ok(validResult.success);

      const tooShortResult = parser.parse("a");
      assert.ok(!tooShortResult.success);

      const tooLongResult = parser.parse("this is too long");
      assert.ok(!tooLongResult.success);
    });

    it("should handle startsWith/endsWith", () => {
      const parser = valibot(
        v.union([
          v.pipe(v.string(), v.startsWith("http://")),
          v.pipe(v.string(), v.startsWith("https://")),
        ]),
        { placeholder: "" },
      );

      const httpResult = parser.parse("http://example.com");
      assert.ok(httpResult.success);

      const httpsResult = parser.parse("https://example.com");
      assert.ok(httpsResult.success);

      const invalidResult = parser.parse("ftp://example.com");
      assert.ok(!invalidResult.success);
    });
  });

  describe("choices and suggest", () => {
    it("should expose choices for v.picklist()", () => {
      const parser = valibot(v.picklist(["debug", "info", "warn", "error"]), {
        placeholder: "debug",
      });
      assert.deepEqual(parser.choices, ["debug", "info", "warn", "error"]);
    });

    it("should provide suggest() for v.picklist()", () => {
      const parser = valibot(v.picklist(["debug", "info", "warn", "error"]), {
        placeholder: "debug",
      });
      assert.ok(parser.suggest != null);
      const suggestions = [...parser.suggest!("d")];
      assert.deepEqual(suggestions, [{ kind: "literal", text: "debug" }]);
    });

    it("should suggest all choices for empty prefix", () => {
      const parser = valibot(v.picklist(["debug", "info", "warn", "error"]), {
        placeholder: "debug",
      });
      const suggestions = [...parser.suggest!("")];
      assert.deepEqual(suggestions, [
        { kind: "literal", text: "debug" },
        { kind: "literal", text: "info" },
        { kind: "literal", text: "warn" },
        { kind: "literal", text: "error" },
      ]);
    });

    it("should expose choices for v.literal()", () => {
      const parser = valibot(v.literal("production"), {
        placeholder: "production",
      });
      assert.deepEqual(parser.choices, ["production"]);
    });

    it("should expose choices for v.literal() with empty string", () => {
      const parser = valibot(v.literal(""), { placeholder: "" });
      assert.deepEqual(parser.choices, [""]);
      const suggestions = [...parser.suggest!("")];
      assert.deepEqual(suggestions, [{ kind: "literal", text: "" }]);
    });

    it("should not expose choices for v.literal() with number", () => {
      const parser = valibot(v.literal(42), { placeholder: 42 });
      assert.equal(parser.choices, undefined);
      assert.equal(parser.suggest, undefined);
      assert.equal(parser.metavar, "VALUE");
    });

    it("should expose choices for v.union() of literals", () => {
      const parser = valibot(
        v.union([v.literal("dev"), v.literal("prod")]),
        { placeholder: "dev" },
      );
      assert.deepEqual(parser.choices, ["dev", "prod"]);
    });

    it("should not expose choices for v.union() with non-literal member", () => {
      const parser = valibot(
        v.union([v.literal("auto"), v.string()]),
        { placeholder: "auto" },
      );
      assert.equal(parser.choices, undefined);
      assert.equal(parser.suggest, undefined);
    });

    it("should not expose choices for v.union() of numeric literals", () => {
      const parser = valibot(
        v.union([v.literal(1), v.literal(2)]),
        { placeholder: 1 },
      );
      assert.equal(parser.choices, undefined);
      assert.equal(parser.suggest, undefined);
      assert.equal(parser.metavar, "VALUE");
    });

    it("should preserve choices through v.optional()", () => {
      const parser = valibot(
        v.optional(v.picklist(["a", "b"])),
        { placeholder: "a" },
      );
      assert.deepEqual(parser.choices, ["a", "b"]);
    });

    it("should preserve choices through v.nullable()", () => {
      const parser = valibot(
        v.nullable(v.picklist(["a", "b"])),
        { placeholder: "a" },
      );
      assert.deepEqual(parser.choices, ["a", "b"]);
    });

    it("should preserve choices through v.nullish()", () => {
      const parser = valibot(
        v.nullish(v.picklist(["a", "b"])),
        { placeholder: "a" },
      );
      assert.deepEqual(parser.choices, ["a", "b"]);
    });

    it("should not expose choices for v.string()", () => {
      const parser = valibot(v.string(), { placeholder: "" });
      assert.equal(parser.choices, undefined);
      assert.equal(parser.suggest, undefined);
    });

    it("should infer CHOICE metavar for v.union() of literals", () => {
      const parser = valibot(
        v.union([v.literal("dev"), v.literal("prod")]),
        { placeholder: "dev" },
      );
      assert.equal(parser.metavar, "CHOICE");
    });
  });

  describe("async schema rejection", () => {
    const expectedError = {
      name: "TypeError",
      message: "Async Valibot schemas (e.g., async validations) are not " +
        "supported by valibot(). Use synchronous schemas instead.",
    };

    it("should throw TypeError for async validations", () => {
      const asyncSchema = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      assert.throws(
        () => valibot(asyncSchema as never, { placeholder: "" as never }),
        expectedError,
      );
    });

    it("should throw TypeError for async schema inside optional()", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      const asyncSchema = v.optional(asyncInner as never);
      assert.throws(
        () => valibot(asyncSchema as never, { placeholder: "" as never }),
        expectedError,
      );
    });

    it("should throw TypeError for async schema inside nullable()", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      const asyncSchema = v.nullable(asyncInner as never);
      assert.throws(
        () => valibot(asyncSchema as never, { placeholder: "" as never }),
        expectedError,
      );
    });

    it("should not reject unions with a catch-all sync string arm", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      // Union with a bare v.string() arm is safe because CLI input is
      // always a string, so the sync arm matches first.
      const asyncSchema = v.union([v.string(), asyncInner] as never);
      const parser = valibot(asyncSchema as never, {
        placeholder: "" as never,
      });
      const result = parser.parse("hello");
      assert.ok(result.success);
    });

    it("should throw TypeError for union without catch-all sync arm", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      // v.literal("a") only matches "a", so non-"a" inputs reach the
      // async arm — this must be rejected.
      const asyncSchema = v.union([v.literal("a"), asyncInner] as never);
      assert.throws(
        () => valibot(asyncSchema as never, { placeholder: "" as never }),
        expectedError,
      );
    });

    it("should not reject unions with wrapped catch-all string arm", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      // v.optional(v.string()) is still a catch-all for string input
      const asyncSchema = v.union([
        v.optional(v.string()),
        asyncInner,
      ] as never);
      const parser = valibot(asyncSchema as never, {
        placeholder: "" as never,
      });
      const result = parser.parse("hello");
      assert.ok(result.success);
    });

    it("should not reject union with piped non-rejecting string arm", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      // v.pipe(v.string(), v.trim()) normalizes but never rejects
      const asyncSchema = v.union([
        v.pipe(v.string(), v.trim()),
        asyncInner,
      ] as never);
      const parser = valibot(asyncSchema as never, {
        placeholder: "" as never,
      });
      const result = parser.parse("hello");
      assert.ok(result.success);
    });

    it("should not reject union with v.unknown() arm after transform", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      // v.unknown() accepts every value, so async arm is unreachable
      // even after a type-changing transform.
      const asyncSchema = v.pipe(
        v.string(),
        v.transform(JSON.parse),
        v.union([v.unknown(), asyncInner] as never),
      );
      const parser = valibot(asyncSchema as never, {
        placeholder: "" as never,
      });
      const result = parser.parse('"hello"');
      assert.ok(result.success);
    });

    it("should reject union with string arm after transform", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      // After a transform, string catch-all is no longer trusted since
      // we cannot determine the output type statically.
      const asyncSchema = v.pipe(
        v.string(),
        v.transform((s: string) => s.trim()),
        v.union([v.string(), asyncInner] as never),
      );
      assert.throws(
        () => valibot(asyncSchema as never, { placeholder: "" as never }),
        expectedError,
      );
    });

    it("should throw TypeError for async schema inside intersect()", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      const asyncSchema = v.intersect([v.string(), asyncInner] as never);
      assert.throws(
        () => valibot(asyncSchema as never, { placeholder: "" as never }),
        expectedError,
      );
    });

    it("should not reject async entries in direct containers", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      // Direct containers are unreachable from string input — the outer
      // type check (object/array/tuple) rejects the string first.
      const objParser = valibot(v.object({ a: asyncInner } as never), {
        placeholder: "" as never,
      });
      assert.ok(!objParser.parse("hello").success);
      const arrParser = valibot(v.array(asyncInner as never), {
        placeholder: "" as never,
      });
      assert.ok(!arrParser.parse("hello").success);
      const tupParser = valibot(v.tuple([asyncInner] as never), {
        placeholder: "" as never,
      });
      assert.ok(!tupParser.parse("hello").success);
    });

    it("should not reject async rest/promise in direct containers", () => {
      const asyncRest = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      // Direct containers are unreachable from string input.
      const owrParser = valibot(
        v.objectWithRest({}, asyncRest as never),
        { placeholder: "" as never },
      );
      assert.ok(!owrParser.parse("hello").success);
      const twrParser = valibot(v.tupleWithRest([], asyncRest as never), {
        placeholder: "" as never,
      });
      assert.ok(!twrParser.parse("hello").success);
      const promParser = valibot(v.promise(asyncRest as never), {
        placeholder: "" as never,
      });
      assert.ok(!promParser.parse("hello").success);
    });

    it("should reject async entries after transform in pipe", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      // After JSON.parse, the object schema's entries become reachable.
      const asyncSchema = v.pipe(
        v.string(),
        v.transform(JSON.parse),
        v.object({ a: asyncInner } as never),
      );
      assert.throws(
        () => valibot(asyncSchema as never, { placeholder: "" as never }),
        expectedError,
      );
    });

    it("should reject async union arm after transform", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      // After JSON.parse, v.string() is no longer a catch-all since
      // the value may not be a string.
      const asyncSchema = v.pipe(
        v.string(),
        v.transform(JSON.parse),
        v.union([v.string(), asyncInner] as never),
      );
      assert.throws(
        () => valibot(asyncSchema as never, { placeholder: "" as never }),
        expectedError,
      );
    });

    it("should not reject union with v.unknown() after transform", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      // v.unknown() is type-agnostic, so it's still catch-all after
      // transforms.
      const asyncSchema = v.pipe(
        v.string(),
        v.transform(JSON.parse),
        v.union([v.unknown(), asyncInner] as never),
      );
      const parser = valibot(asyncSchema as never, {
        placeholder: "" as never,
      });
      const result = parser.parse('"hello"');
      assert.ok(result.success);
    });

    it("should detect async in shared schema reused after transform", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      // Shared schema node used in both a direct (unreachable) position
      // and a post-transform (reachable) position.  The second visit
      // must not be skipped by the cycle detector.
      const shared = v.object({ a: asyncInner } as never);
      const asyncSchema = v.union([
        shared,
        v.pipe(v.string(), v.transform(JSON.parse), shared),
      ] as never);
      assert.throws(
        () => valibot(asyncSchema as never, { placeholder: "" as never }),
        expectedError,
      );
    });

    it("should throw TypeError for async schema inside v.lazy()", () => {
      const asyncInner = v.pipeAsync(
        v.string(),
        // deno-lint-ignore require-await
        v.checkAsync(async (val) => val === "ok", "not ok"),
      );
      // v.lazy() wrapping async schema cannot be detected at construction
      // time because the getter depends on actual parse input.  The runtime
      // safety check in parse() must catch this.
      const lazySchema = v.lazy(
        () =>
          asyncInner as unknown as v.BaseSchema<
            unknown,
            string,
            v.BaseIssue<unknown>
          >,
      );
      const parser = valibot(lazySchema);
      assert.throws(() => parser.parse("ok"), expectedError);
    });

    it("should work normally with sync schema inside v.lazy()", () => {
      const syncSchema = v.lazy(() => v.string());
      const parser = valibot(syncSchema as never);
      const result = parser.parse("hello");
      assert.ok(result.success);
      if (result.success) assert.equal(result.value, "hello");
    });
  });
});
