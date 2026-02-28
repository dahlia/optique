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

      it("should infer VALUE for z.literal()", () => {
        const parser = zod(z.literal("production"));
        assert.equal(parser.metavar, "VALUE");
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

    it("should format date values", () => {
      const parser = zod(z.string().transform((s) => new Date(s)));
      // Use a mid-year date so that local-time rendering cannot roll the year backward in any timezone.
      const date = new Date("2025-06-15T00:00:00.000Z");
      const formatted = parser.format(date);
      assert.ok(formatted.includes("2025"));
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
});
