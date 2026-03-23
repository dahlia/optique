import { message } from "@optique/core/message";
import { zod } from "@optique/zod";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";

describe("zod()", () => {
  describe("basic parsing", () => {
    it("should parse valid string input", () => {
      const parser = zod(z.string());
      const result = parser.parse("hello");

      assert.ok(result.success);
      assert.equal(result.value, "hello");
    });

    it("should parse valid email", () => {
      const parser = zod(z.string().email());
      const result = parser.parse("user@example.com");

      assert.ok(result.success);
      assert.equal(result.value, "user@example.com");
    });

    it("should reject invalid email", () => {
      const parser = zod(z.string().email());
      const result = parser.parse("not-an-email");

      assert.ok(!result.success);
    });

    it("should parse valid URL", () => {
      const parser = zod(z.string().url());
      const result = parser.parse("https://example.com");

      assert.ok(result.success);
      assert.equal(result.value, "https://example.com");
    });

    it("should reject invalid URL", () => {
      const parser = zod(z.string().url());
      const result = parser.parse("not-a-url");

      assert.ok(!result.success);
    });
  });

  describe("number coercion", () => {
    it("should parse number with coercion", () => {
      const parser = zod(z.coerce.number());
      const result = parser.parse("42");

      assert.ok(result.success);
      assert.equal(result.value, 42);
    });

    it("should parse integer with coercion", () => {
      const parser = zod(z.coerce.number().int());
      const result = parser.parse("42");

      assert.ok(result.success);
      assert.equal(result.value, 42);
    });

    it("should reject non-integer when int() is required", () => {
      const parser = zod(z.coerce.number().int());
      const result = parser.parse("42.5");

      assert.ok(!result.success);
    });

    it("should validate number ranges", () => {
      const parser = zod(z.coerce.number().int().min(1024).max(65535));

      const validResult = parser.parse("8080");
      assert.ok(validResult.success);
      assert.equal(validResult.value, 8080);

      const tooSmallResult = parser.parse("100");
      assert.ok(!tooSmallResult.success);

      const tooLargeResult = parser.parse("70000");
      assert.ok(!tooLargeResult.success);
    });

    it("should reject non-numeric input with coercion", () => {
      const parser = zod(z.coerce.number());
      const result = parser.parse("not-a-number");

      assert.ok(!result.success);
    });
  });

  describe("enum validation", () => {
    it("should parse valid enum value", () => {
      const parser = zod(z.enum(["debug", "info", "warn", "error"]));
      const result = parser.parse("info");

      assert.ok(result.success);
      assert.equal(result.value, "info");
    });

    it("should reject invalid enum value", () => {
      const parser = zod(z.enum(["debug", "info", "warn", "error"]));
      const result = parser.parse("trace");

      assert.ok(!result.success);
    });
  });

  describe("transformations", () => {
    it("should apply transformations", () => {
      const parser = zod(z.string().transform((s) => s.toUpperCase()));
      const result = parser.parse("hello");

      assert.ok(result.success);
      assert.equal(result.value, "HELLO");
    });

    it("should parse and transform dates", () => {
      const parser = zod(
        z.string().transform((s) => new Date(s)),
      );
      const result = parser.parse("2025-01-01");

      assert.ok(result.success);
      assert.ok(result.value instanceof Date);
      assert.equal(result.value.getUTCFullYear(), 2025);
    });
  });

  describe("metavar inference", () => {
    describe("basic types", () => {
      it("should infer STRING for z.string()", () => {
        const parser = zod(z.string());
        assert.equal(parser.metavar, "STRING");
      });

      it("should infer NUMBER for z.coerce.number()", () => {
        const parser = zod(z.coerce.number());
        assert.equal(parser.metavar, "NUMBER");
      });

      it("should infer INTEGER for z.coerce.number().int()", () => {
        const parser = zod(z.coerce.number().int());
        assert.equal(parser.metavar, "INTEGER");
      });

      it("should infer BOOLEAN for z.coerce.boolean()", () => {
        const parser = zod(z.coerce.boolean());
        assert.equal(parser.metavar, "BOOLEAN");
      });

      it("should infer DATE for z.coerce.date()", () => {
        const parser = zod(z.coerce.date());
        assert.equal(parser.metavar, "DATE");
      });
    });

    describe("refined string types", () => {
      it("should infer EMAIL for z.string().email()", () => {
        const parser = zod(z.string().email());
        assert.equal(parser.metavar, "EMAIL");
      });

      it("should infer URL for z.string().url()", () => {
        const parser = zod(z.string().url());
        assert.equal(parser.metavar, "URL");
      });

      it("should infer UUID for z.string().uuid()", () => {
        const parser = zod(z.string().uuid());
        assert.equal(parser.metavar, "UUID");
      });

      it("should infer DATETIME for z.string().datetime()", () => {
        const parser = zod(z.string().datetime());
        assert.equal(parser.metavar, "DATETIME");
      });

      it("should infer DATE for z.string().date()", () => {
        const parser = zod(z.string().date());
        assert.equal(parser.metavar, "DATE");
      });

      it("should infer TIME for z.string().time()", () => {
        const parser = zod(z.string().time());
        assert.equal(parser.metavar, "TIME");
      });

      it("should infer DURATION for z.string().duration()", () => {
        const parser = zod(z.string().duration());
        assert.equal(parser.metavar, "DURATION");
      });

      it("should infer CUID for z.string().cuid()", () => {
        const parser = zod(z.string().cuid());
        assert.equal(parser.metavar, "CUID");
      });

      it("should infer CUID2 for z.string().cuid2()", () => {
        const parser = zod(z.string().cuid2());
        assert.equal(parser.metavar, "CUID2");
      });

      it("should infer ULID for z.string().ulid()", () => {
        const parser = zod(z.string().ulid());
        assert.equal(parser.metavar, "ULID");
      });

      it("should infer IPV4/IPV6/IP/JWT/EMOJI/BASE64 from internal checks", () => {
        const make = (check: Record<string, unknown>) =>
          zod({
            _def: { type: "string", checks: [check] },
            safeParse: (input: unknown) => ({ success: true, data: input }),
          } as unknown as z.Schema<unknown>);

        assert.equal(make({ kind: "ip", version: "v4" }).metavar, "IPV4");
        assert.equal(make({ kind: "ip", version: "v6" }).metavar, "IPV6");
        assert.equal(make({ kind: "ip" }).metavar, "IP");
        assert.equal(make({ kind: "jwt" }).metavar, "JWT");
        assert.equal(make({ kind: "emoji" }).metavar, "EMOJI");
        assert.equal(make({ kind: "base64" }).metavar, "BASE64");
      });
    });

    describe("enum and union types", () => {
      it("should infer CHOICE for z.enum()", () => {
        const parser = zod(z.enum(["debug", "info", "warn", "error"]));
        assert.equal(parser.metavar, "CHOICE");
      });

      it("should infer VALUE for z.union()", () => {
        const parser = zod(z.union([z.string(), z.coerce.number()]));
        assert.equal(parser.metavar, "VALUE");
      });

      it("should infer CHOICE for z.literal()", () => {
        const parser = zod(z.literal("production"));
        assert.equal(parser.metavar, "CHOICE");
      });

      it("should infer VALUE for z.nativeEnum() with numeric values", () => {
        const NumericEnum = { A: 0, B: 1, 0: "A", 1: "B" } as const;
        const parser = zod(z.nativeEnum(NumericEnum));
        assert.equal(parser.metavar, "VALUE");
      });

      it("should infer CHOICE for z.nativeEnum() with string values", () => {
        const StringEnum = { Debug: "debug", Info: "info" } as const;
        const parser = zod(z.nativeEnum(StringEnum));
        assert.equal(parser.metavar, "CHOICE");
      });
    });

    describe("edge cases", () => {
      it("should use first refinement for multiple refinements", () => {
        const parser = zod(z.string().email().min(5));
        assert.equal(parser.metavar, "EMAIL");
      });

      it("should unwrap optional schemas", () => {
        const parser = zod(z.string().email().optional());
        assert.equal(parser.metavar, "EMAIL");
      });

      it("should unwrap nullable schemas", () => {
        const parser = zod(z.coerce.number().nullable());
        assert.equal(parser.metavar, "NUMBER");
      });

      it("should unwrap default schemas", () => {
        const parser = zod(z.string().email().default("user@example.com"));
        assert.equal(parser.metavar, "EMAIL");
      });

      it("should allow manual override", () => {
        const parser = zod(z.string().email(), { metavar: "CUSTOM" });
        assert.equal(parser.metavar, "CUSTOM");
      });

      it("should reject empty metavar", () => {
        assert.throws(() => zod(z.string(), { metavar: "" as never }), {
          name: "TypeError",
          message: "Expected a non-empty string.",
        });
      });

      it("should fallback to VALUE for unknown types", () => {
        const parser = zod(z.object({ name: z.string() }));
        assert.equal(parser.metavar, "VALUE");
      });

      it("should fallback to VALUE for transform schemas", () => {
        const parser = zod(z.string().transform((s) => s.toUpperCase()));
        assert.equal(parser.metavar, "VALUE");
      });

      it("should fallback to VALUE for array schemas", () => {
        const parser = zod(z.array(z.string()));
        assert.equal(parser.metavar, "VALUE");
      });

      it("should fallback to VALUE when schema definition is missing", () => {
        const parser = zod({
          safeParse: (input: unknown) => ({ success: true, data: input }),
        } as unknown as z.Schema<unknown>);
        assert.equal(parser.metavar, "VALUE");
      });

      it("should fallback to VALUE for optional/default without innerType", () => {
        const optionalLike = zod({
          _def: { type: "optional" },
          safeParse: (input: unknown) => ({ success: true, data: input }),
        } as unknown as z.Schema<unknown>);
        const defaultLike = zod({
          _def: { type: "default" },
          safeParse: (input: unknown) => ({ success: true, data: input }),
        } as unknown as z.Schema<unknown>);

        assert.equal(optionalLike.metavar, "VALUE");
        assert.equal(defaultLike.metavar, "VALUE");
      });
    });

    describe("number with constraints", () => {
      it("should infer INTEGER for z.coerce.number().int().min()", () => {
        const parser = zod(z.coerce.number().int().min(1024).max(65535));
        assert.equal(parser.metavar, "INTEGER");
      });

      it("should infer NUMBER for z.coerce.number().min() without int()", () => {
        const parser = zod(z.coerce.number().min(0).max(1));
        assert.equal(parser.metavar, "NUMBER");
      });

      it("should infer INTEGER for z.coerce.number().int().positive()", () => {
        const parser = zod(z.coerce.number().int().positive());
        assert.equal(parser.metavar, "INTEGER");
      });
    });
  });

  describe("format()", () => {
    it("should format string values", () => {
      const parser = zod(z.string());
      assert.equal(parser.format("hello"), "hello");
    });

    it("should format number values", () => {
      const parser = zod(z.coerce.number());
      assert.equal(parser.format(42), "42");
    });

    it("should format boolean values", () => {
      const parser = zod(z.coerce.boolean());
      assert.equal(parser.format(true), "true");
      assert.equal(parser.format(false), "false");
    });

    it("should format date values as ISO strings", () => {
      const parser = zod(z.string().transform((s) => new Date(s)));
      const date = new Date("2025-06-15T00:00:00.000Z");
      assert.equal(parser.format(date), "2025-06-15T00:00:00.000Z");
    });

    it("should not throw for invalid date values", () => {
      const parser = zod(z.string().transform((s) => new Date(s)));
      const invalid = new Date("bad");
      assert.equal(parser.format(invalid), "Invalid Date");
    });

    it("should format object values as JSON", () => {
      const parser = zod(
        z.string().transform((s) => ({ raw: s })),
      );
      assert.equal(parser.format({ raw: "hello" }), '{"raw":"hello"}');
    });

    it("should format array values as comma-separated string", () => {
      const parser = zod(
        z.string().transform((s) => s.split(",")),
      );
      assert.equal(parser.format(["a", "b", "c"]), "a,b,c");
    });

    it("should preserve array formatting even with [object Object] element", () => {
      const parser = zod(
        z.string().transform((s) => s.split(",")),
      );
      assert.equal(
        parser.format(["a", "[object Object]", "c"]),
        "a,[object Object],c",
      );
    });

    it("should format arrays of objects via String()", () => {
      const parser = zod(
        z.string().transform((s) => s.split(",").map((x) => ({ v: x }))),
      );
      assert.equal(
        parser.format([{ v: "a" }, { v: "b" }]),
        "[object Object],[object Object]",
      );
    });

    it("should not throw for non-JSON-serializable objects", () => {
      const parser = zod(
        z.string().transform((s) => ({ id: BigInt(s) })),
      );
      assert.equal(parser.format({ id: 1n }), "[object Object]");
    });

    it("should not throw for cyclic objects", () => {
      const parser = zod(
        z.string().transform((s) => ({ raw: s })),
      );
      const cyclic: { raw: string; self?: unknown } = { raw: "hello" };
      cyclic.self = cyclic;
      assert.equal(parser.format(cyclic), "[object Object]");
    });

    it("should handle objects with toJSON returning undefined", () => {
      const parser = zod(
        z.string().transform(() => ({ toJSON: () => undefined })),
      );
      assert.equal(
        parser.format({ toJSON: () => undefined }),
        "[object Object]",
      );
    });

    it("should use custom format function from options", () => {
      const parser = zod(
        z.string().transform((s) => ({ raw: s })),
        { format: (v) => v.raw },
      );
      assert.equal(parser.format({ raw: "hello" }), "hello");
    });
  });

  describe("error customization", () => {
    it("should use custom static error message", () => {
      const parser = zod(z.string().email(), {
        errors: {
          zodError: message`Please provide a valid email address.`,
        },
      });

      const result = parser.parse("not-an-email");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Please provide a valid email address." },
      ]);
    });

    it("should use custom error function with input", () => {
      const parser = zod(z.string().email(), {
        errors: {
          zodError: (_error, input) =>
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

    it("should use custom error function with Zod error", () => {
      const parser = zod(z.coerce.number().int().min(1).max(10), {
        errors: {
          zodError: (error, input) => {
            const issue = error.issues[0];
            if (issue?.code === "too_small") {
              return message`Value must be at least 1.`;
            }
            if (issue?.code === "too_big") {
              return message`Value must be at most 10.`;
            }
            return message`Invalid value: ${input}`;
          },
        },
      });

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
      const parser = zod(z.string().email());
      const result = parser.parse("not-an-email");

      assert.ok(!result.success);
      // Should have some error message from Zod
      assert.ok(result.error.length > 0);
    });

    it("should handle validation errors gracefully", () => {
      const parser = zod(z.coerce.number().min(10));
      const result = parser.parse("5");

      assert.ok(!result.success);
      assert.ok(result.error.length > 0);
    });

    it("uses prettifyError when available", () => {
      const schema = z.string().email();
      const ctor = schema.constructor as {
        prettifyError?: (e: unknown) => string;
      };
      const original = ctor.prettifyError;
      ctor.prettifyError = () => "Pretty zod error";
      try {
        const parser = zod(schema);
        const result = parser.parse("not-an-email");
        assert.ok(!result.success);
        assert.deepEqual(result.error, [{
          type: "value",
          value: "Pretty zod error",
        }]);
      } finally {
        ctor.prettifyError = original;
      }
    });

    it("falls back when prettifyError throws", () => {
      const schema = z.string().email();
      const ctor = schema.constructor as {
        prettifyError?: (e: unknown) => string;
      };
      const original = ctor.prettifyError;
      ctor.prettifyError = () => {
        throw new Error("boom");
      };
      try {
        const parser = zod(schema);
        const result = parser.parse("not-an-email");
        assert.ok(!result.success);
        assert.ok(result.error.length > 0);
      } finally {
        ctor.prettifyError = original;
      }
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      const parser = zod(z.string().min(1));
      const result = parser.parse("");

      assert.ok(!result.success);
    });

    it("should handle optional schemas", () => {
      const parser = zod(z.string().optional());
      const result = parser.parse("hello");

      assert.ok(result.success);
      assert.equal(result.value, "hello");
    });

    it("should handle literal values", () => {
      const parser = zod(z.literal("production"));

      const validResult = parser.parse("production");
      assert.ok(validResult.success);
      assert.equal(validResult.value, "production");

      const invalidResult = parser.parse("development");
      assert.ok(!invalidResult.success);
    });

    it("should handle union types", () => {
      const parser = zod(z.union([
        z.literal("auto"),
        z.coerce.number().int().positive(),
      ]));

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
    it("should handle regexp validation", () => {
      const parser = zod(z.string().regex(/^[A-Z]{3}$/));

      const validResult = parser.parse("ABC");
      assert.ok(validResult.success);

      const invalidResult = parser.parse("abc");
      assert.ok(!invalidResult.success);
    });

    it("should handle length constraints", () => {
      const parser = zod(z.string().length(5));

      const validResult = parser.parse("hello");
      assert.ok(validResult.success);

      const invalidResult = parser.parse("hi");
      assert.ok(!invalidResult.success);
    });

    it("should handle min/max length", () => {
      const parser = zod(z.string().min(2).max(10));

      const validResult = parser.parse("hello");
      assert.ok(validResult.success);

      const tooShortResult = parser.parse("a");
      assert.ok(!tooShortResult.success);

      const tooLongResult = parser.parse("this is too long");
      assert.ok(!tooLongResult.success);
    });

    it("should handle startsWith/endsWith", () => {
      const parser = zod(
        z.string().startsWith("http://").or(
          z.string().startsWith("https://"),
        ),
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
    it("should expose choices for z.enum()", () => {
      const parser = zod(z.enum(["debug", "info", "warn", "error"]));
      assert.deepEqual(parser.choices, ["debug", "info", "warn", "error"]);
    });

    it("should provide suggest() for z.enum()", () => {
      const parser = zod(z.enum(["debug", "info", "warn", "error"]));
      assert.ok(parser.suggest != null);
      const suggestions = [...parser.suggest!("d")];
      assert.deepEqual(suggestions, [{ kind: "literal", text: "debug" }]);
    });

    it("should suggest all choices for empty prefix", () => {
      const parser = zod(z.enum(["debug", "info", "warn", "error"]));
      const suggestions = [...parser.suggest!("")];
      assert.deepEqual(suggestions, [
        { kind: "literal", text: "debug" },
        { kind: "literal", text: "info" },
        { kind: "literal", text: "warn" },
        { kind: "literal", text: "error" },
      ]);
    });

    it("should expose choices for z.literal()", () => {
      const parser = zod(z.literal("production"));
      assert.deepEqual(parser.choices, ["production"]);
    });

    it("should expose choices for z.literal() with empty string", () => {
      const parser = zod(z.literal(""));
      assert.deepEqual(parser.choices, [""]);
      const suggestions = [...parser.suggest!("")];
      assert.deepEqual(suggestions, [{ kind: "literal", text: "" }]);
    });

    it("should not expose choices for z.literal() with number", () => {
      const parser = zod(z.literal(42));
      assert.equal(parser.choices, undefined);
      assert.equal(parser.suggest, undefined);
      assert.equal(parser.metavar, "VALUE");
    });

    it("should expose choices for z.union() of literals", () => {
      const parser = zod(z.union([z.literal("dev"), z.literal("prod")]));
      assert.deepEqual(parser.choices, ["dev", "prod"]);
    });

    it("should not expose choices for z.union() with non-literal member", () => {
      const parser = zod(z.union([z.literal("auto"), z.coerce.number()]));
      assert.equal(parser.choices, undefined);
      assert.equal(parser.suggest, undefined);
    });

    it("should not expose choices for z.union() of numeric literals", () => {
      const parser = zod(z.union([z.literal(1), z.literal(2)]));
      assert.equal(parser.choices, undefined);
      assert.equal(parser.suggest, undefined);
    });

    it("should not expose choices for z.nativeEnum() with numeric values", () => {
      // Simulate a numeric TypeScript enum with reverse mappings
      const NumericEnum = { A: 0, B: 1, 0: "A", 1: "B" } as const;
      const parser = zod(z.nativeEnum(NumericEnum));
      assert.equal(parser.choices, undefined);
      assert.equal(parser.suggest, undefined);
    });

    it("should expose choices for z.nativeEnum() with string values", () => {
      const StringEnum = { Debug: "debug", Info: "info" } as const;
      const parser = zod(z.nativeEnum(StringEnum));
      assert.deepEqual(parser.choices, ["debug", "info"]);
    });

    it("should preserve choices through z.optional()", () => {
      const parser = zod(z.enum(["a", "b"]).optional());
      assert.deepEqual(parser.choices, ["a", "b"]);
    });

    it("should preserve choices through z.nullable()", () => {
      const parser = zod(z.enum(["a", "b"]).nullable());
      assert.deepEqual(parser.choices, ["a", "b"]);
    });

    it("should preserve choices through z.default()", () => {
      const parser = zod(z.enum(["a", "b"]).default("a"));
      assert.deepEqual(parser.choices, ["a", "b"]);
    });

    it("should not expose choices through z.catch()", () => {
      // .catch() makes any input valid (falls back to the default),
      // so advertising a closed choice set would be misleading.
      const parser = zod(z.enum(["a", "b"]).catch("a"));
      assert.equal(parser.choices, undefined);
      assert.equal(parser.suggest, undefined);
    });

    it("should not expose choices for z.string()", () => {
      const parser = zod(z.string());
      assert.equal(parser.choices, undefined);
      assert.equal(parser.suggest, undefined);
    });

    it("should infer CHOICE metavar for z.union() of literals", () => {
      const parser = zod(z.union([z.literal("dev"), z.literal("prod")]));
      assert.equal(parser.metavar, "CHOICE");
    });
  });

  describe("boolean parsing", () => {
    it("should parse true literals with z.coerce.boolean()", () => {
      const parser = zod(z.coerce.boolean());
      for (const input of ["true", "1", "yes", "on"]) {
        const result = parser.parse(input);
        assert.ok(result.success, `Expected "${input}" to parse as true`);
        assert.equal(result.value, true);
      }
    });

    it("should parse false literals with z.coerce.boolean()", () => {
      const parser = zod(z.coerce.boolean());
      for (const input of ["false", "0", "no", "off"]) {
        const result = parser.parse(input);
        assert.ok(result.success, `Expected "${input}" to parse as false`);
        assert.equal(result.value, false);
      }
    });

    it("should be case-insensitive", () => {
      const parser = zod(z.coerce.boolean());
      for (
        const input of [
          "True",
          "TRUE",
          "False",
          "FALSE",
          "Yes",
          "YES",
          "No",
          "NO",
          "On",
          "ON",
          "Off",
          "OFF",
        ]
      ) {
        const result = parser.parse(input);
        assert.ok(result.success, `Expected "${input}" to parse successfully`);
      }
    });

    it("should trim whitespace", () => {
      const parser = zod(z.coerce.boolean());
      const trueResult = parser.parse("  true  ");
      assert.ok(trueResult.success);
      assert.equal(trueResult.value, true);

      const falseResult = parser.parse("\tfalse\n");
      assert.ok(falseResult.success);
      assert.equal(falseResult.value, false);
    });

    it("should reject invalid strings", () => {
      const parser = zod(z.coerce.boolean());
      for (const input of ["maybe", "2", "random", "nope", ""]) {
        const result = parser.parse(input);
        assert.ok(!result.success, `Expected "${input}" to be rejected`);
      }
    });

    it("should work with z.boolean() (non-coerced)", () => {
      const parser = zod(z.boolean());
      const trueResult = parser.parse("true");
      assert.ok(trueResult.success);
      assert.equal(trueResult.value, true);

      const falseResult = parser.parse("false");
      assert.ok(falseResult.success);
      assert.equal(falseResult.value, false);
    });

    it("should work with z.coerce.boolean().optional()", () => {
      const parser = zod(z.coerce.boolean().optional());
      const result = parser.parse("true");
      assert.ok(result.success);
      assert.equal(result.value, true);

      const falseResult = parser.parse("off");
      assert.ok(falseResult.success);
      assert.equal(falseResult.value, false);
    });

    it("should work with z.coerce.boolean().nullable()", () => {
      const parser = zod(z.coerce.boolean().nullable());
      const result = parser.parse("yes");
      assert.ok(result.success);
      assert.equal(result.value, true);
    });

    it("should work with z.coerce.boolean().default(false)", () => {
      const parser = zod(z.coerce.boolean().default(false));
      const result = parser.parse("on");
      assert.ok(result.success);
      assert.equal(result.value, true);
    });

    it("should preserve Zod refinements", () => {
      const parser = zod(z.coerce.boolean().refine((v) => v === true));
      const trueResult = parser.parse("true");
      assert.ok(trueResult.success);
      assert.equal(trueResult.value, true);

      const falseResult = parser.parse("false");
      assert.ok(!falseResult.success);
    });

    it("should expose choices for boolean schemas", () => {
      const parser = zod(z.coerce.boolean());
      assert.deepEqual(parser.choices, [true, false]);
    });

    it("should provide suggest() for boolean schemas", () => {
      const parser = zod(z.coerce.boolean());
      assert.ok(parser.suggest != null);
      const suggestions = [...parser.suggest!("t")];
      assert.deepEqual(suggestions, [{ kind: "literal", text: "true" }]);
    });

    it("should suggest all literals for empty prefix", () => {
      const parser = zod(z.coerce.boolean());
      const suggestions = [...parser.suggest!("")];
      assert.deepEqual(suggestions, [
        { kind: "literal", text: "true" },
        { kind: "literal", text: "1" },
        { kind: "literal", text: "yes" },
        { kind: "literal", text: "on" },
        { kind: "literal", text: "false" },
        { kind: "literal", text: "0" },
        { kind: "literal", text: "no" },
        { kind: "literal", text: "off" },
      ]);
    });

    it("should work with z.coerce.boolean().refine() (ZodEffects)", () => {
      const parser = zod(
        z.coerce.boolean().refine((v) => typeof v === "boolean"),
      );
      const trueResult = parser.parse("true");
      assert.ok(trueResult.success);
      assert.equal(trueResult.value, true);

      const falseResult = parser.parse("false");
      assert.ok(falseResult.success);
      assert.equal(falseResult.value, false);

      const invalidResult = parser.parse("maybe");
      assert.ok(!invalidResult.success);
    });

    it("should work with z.coerce.boolean().catch(false) (ZodCatch)", () => {
      const parser = zod(z.coerce.boolean().catch(false));
      const trueResult = parser.parse("true");
      assert.ok(trueResult.success);
      assert.equal(trueResult.value, true);

      const falseResult = parser.parse("false");
      assert.ok(falseResult.success);
      assert.equal(falseResult.value, false);

      // Invalid boolean literals are still rejected at the
      // pre-conversion layer, before Zod's catch() can fire.
      const invalidResult = parser.parse("maybe");
      assert.ok(!invalidResult.success);
    });

    it("should not expose choices for refined boolean schemas", () => {
      const parser = zod(z.coerce.boolean().refine((v) => v === true));
      assert.equal(parser.choices, undefined);
      assert.equal(parser.suggest, undefined);
    });

    it("should not expose choices for superRefined boolean schemas", () => {
      const parser = zod(
        z.boolean().superRefine((v, ctx) => {
          if (!v) ctx.addIssue({ code: "custom", message: "must be true" });
        }),
      );
      assert.equal(parser.choices, undefined);
      assert.equal(parser.suggest, undefined);
    });

    it("should not expose choices for catch-wrapped boolean schemas", () => {
      const parser = zod(z.coerce.boolean().catch(false));
      assert.equal(parser.choices, undefined);
      assert.equal(parser.suggest, undefined);
    });

    it("should still expose choices for optional boolean schemas", () => {
      const parser = zod(z.coerce.boolean().optional());
      assert.deepEqual(parser.choices, [true, false]);
    });

    it("should respect custom zodError for refinement failures", () => {
      const parser = zod(z.coerce.boolean().refine((v) => v === true), {
        errors: {
          zodError: message`Only true is accepted.`,
        },
      });
      const result = parser.parse("false");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Only true is accepted." },
      ]);
    });

    it("should respect custom static zodError for invalid boolean literals", () => {
      const parser = zod(z.coerce.boolean(), {
        errors: {
          zodError: message`Please enter true or false.`,
        },
      });
      const result = parser.parse("maybe");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Please enter true or false." },
      ]);
    });

    it("should respect custom function zodError for invalid boolean literals (non-coerced)", () => {
      const parser = zod(z.boolean(), {
        errors: {
          zodError: (_error, input) => message`Not a boolean: ${input}.`,
        },
      });
      const result = parser.parse("nope");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Not a boolean: " },
        { type: "value", value: "nope" },
        { type: "text", text: "." },
      ]);
    });

    it("should respect custom function zodError for invalid boolean literals (coerced)", () => {
      const parser = zod(z.coerce.boolean(), {
        errors: {
          zodError: (_error, input) => message`Bad value: ${input}.`,
        },
      });
      const result = parser.parse("maybe");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Bad value: " },
        { type: "value", value: "maybe" },
        { type: "text", text: "." },
      ]);
    });

    it("should pass a ZodError with flatten/format to coerced boolean callbacks", () => {
      const parser = zod(z.coerce.boolean(), {
        errors: {
          zodError: (error, input) => {
            // Must support standard ZodError API
            assert.ok(typeof error.flatten === "function");
            assert.ok(typeof error.format === "function");
            assert.ok(Array.isArray(error.issues));
            return message`Custom: ${input}.`;
          },
        },
      });
      const result = parser.parse("nope");
      assert.ok(!result.success);
    });

    it("should not interfere with z.preprocess() boolean schemas", () => {
      const parser = zod(
        z.preprocess((v) => v === "enabled", z.boolean()),
      );
      const enabledResult = parser.parse("enabled");
      assert.ok(enabledResult.success);
      assert.equal(enabledResult.value, true);

      const disabledResult = parser.parse("disabled");
      assert.ok(disabledResult.success);
      assert.equal(disabledResult.value, false);
    });

    it("should throw TypeError for async boolean schemas on any input", () => {
      // deno-lint-ignore require-await
      const asyncSchema = z.coerce.boolean().refine(async (v) => v === true);
      const parser = zod(asyncSchema as never);
      // Both valid and invalid boolean literals should throw TypeError
      assert.throws(
        () => parser.parse("true"),
        { name: "TypeError" },
      );
      assert.throws(
        () => parser.parse("maybe"),
        { name: "TypeError" },
      );
    });

    it("should not execute transforms at construction time", () => {
      let transformCalled = false;
      zod(
        z.coerce.boolean().transform((v) => {
          transformCalled = true;
          return !v;
        }),
      );
      assert.ok(!transformCalled);
    });

    it("should not execute refinements at construction time", () => {
      let refineCalled = false;
      zod(
        z.coerce.boolean().refine((v) => {
          refineCalled = true;
          return v;
        }),
      );
      assert.ok(!refineCalled);
    });

    it("should pass a real ZodError to function zodError callbacks", () => {
      const parser = zod(z.boolean(), {
        errors: {
          zodError: (error, input) => {
            // Callback should receive a real ZodError with issues
            assert.ok(Array.isArray(error.issues));
            assert.ok(error.issues.length > 0);
            return message`Custom: ${input}.`;
          },
        },
      });
      const result = parser.parse("nope");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Custom: " },
        { type: "value", value: "nope" },
        { type: "text", text: "." },
      ]);
    });

    it("should work with z.coerce.boolean().transform()", () => {
      const parser = zod(z.coerce.boolean().transform((v) => !v));
      const result = parser.parse("false");
      assert.ok(result.success);
      assert.equal(result.value, true);

      const result2 = parser.parse("true");
      assert.ok(result2.success);
      assert.equal(result2.value, false);

      const invalid = parser.parse("maybe");
      assert.ok(!invalid.success);
    });

    it("should work with z.coerce.boolean().readonly()", () => {
      const parser = zod(z.coerce.boolean().readonly());
      const trueResult = parser.parse("true");
      assert.ok(trueResult.success);
      assert.equal(trueResult.value, true);

      const falseResult = parser.parse("false");
      assert.ok(falseResult.success);
      assert.equal(falseResult.value, false);

      const invalid = parser.parse("maybe");
      assert.ok(!invalid.success);
    });

    it("should not execute refinements for rejected boolean literals", () => {
      let refineCalled = false;
      const parser = zod(
        z.coerce.boolean().refine((v) => {
          refineCalled = true;
          return v === true;
        }),
      );
      refineCalled = false;
      parser.parse("maybe");
      assert.ok(!refineCalled);
    });

    it("should not crash on throwing refinements for rejected literals", () => {
      const parser = zod(
        z.coerce.boolean().refine((v) => {
          if (v) throw new Error("boom");
          return true;
        }),
      );
      const result = parser.parse("maybe");
      assert.ok(!result.success);
    });

    it("should let z.boolean().catch() handle invalid literals", () => {
      const parser = zod(z.boolean().catch(false));
      const result = parser.parse("maybe");
      assert.ok(result.success);
      assert.equal(result.value, false);
    });

    it("should preserve union arm precedence with coerced boolean", () => {
      // Union schemas should not be affected by boolean pre-conversion.
      // The string arm should match "off" even though it's a boolean literal.
      const parser = zod(z.union([z.literal("off"), z.coerce.boolean()]));
      const offResult = parser.parse("off");
      assert.ok(offResult.success);
      assert.equal(offResult.value, "off");
    });

    it("should throw TypeError for async superRefine on valid input", () => {
      const asyncSchema = z.coerce.boolean().superRefine(
        // deno-lint-ignore require-await
        async (v, ctx) => {
          if (!v) ctx.addIssue({ code: "custom", message: "bad" });
        },
      );
      const parser = zod(asyncSchema as never);
      // Async detected via doSafeParse on valid boolean literals
      assert.throws(
        () => parser.parse("true"),
        { name: "TypeError" },
      );
    });

    it("should throw TypeError for async boolean transforms on invalid input", () => {
      // deno-lint-ignore require-await
      const asyncTransform = z.coerce.boolean().transform(async (v) => !v);
      const parser = zod(asyncTransform as never);
      assert.throws(
        () => parser.parse("maybe"),
        { name: "TypeError" },
      );
    });
  });

  describe("async schema rejection", () => {
    it("should throw TypeError for async refinements", () => {
      // deno-lint-ignore require-await
      const asyncSchema = z.string().refine(async (value) => value === "ok");
      const parser = zod(asyncSchema as never);
      assert.throws(
        () => parser.parse("ok"),
        {
          name: "TypeError",
          message:
            "Async Zod schemas (e.g., async refinements) are not supported " +
            "by zod(). Use synchronous schemas instead.",
        },
      );
    });

    it("should not mask unrelated errors containing 'Promise'", () => {
      const schema = z.string().transform(() => {
        throw new Error("Promise rejected by upstream");
      });
      const parser = zod(schema);
      assert.throws(
        () => parser.parse("ok"),
        {
          name: "Error",
          message: "Promise rejected by upstream",
        },
      );
    });
  });
});
