import { message } from "@optique/core/message";
import { valibot } from "@optique/valibot";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as v from "valibot";

describe("valibot()", () => {
  describe("basic parsing", () => {
    it("should parse valid string input", () => {
      const parser = valibot(v.string());
      const result = parser.parse("hello");

      assert.ok(result.success);
      assert.equal(result.value, "hello");
    });

    it("should parse valid email", () => {
      const parser = valibot(v.pipe(v.string(), v.email()));
      const result = parser.parse("user@example.com");

      assert.ok(result.success);
      assert.equal(result.value, "user@example.com");
    });

    it("should reject invalid email", () => {
      const parser = valibot(v.pipe(v.string(), v.email()));
      const result = parser.parse("not-an-email");

      assert.ok(!result.success);
    });

    it("should parse valid URL", () => {
      const parser = valibot(v.pipe(v.string(), v.url()));
      const result = parser.parse("https://example.com");

      assert.ok(result.success);
      assert.equal(result.value, "https://example.com");
    });

    it("should reject invalid URL", () => {
      const parser = valibot(v.pipe(v.string(), v.url()));
      const result = parser.parse("not-a-url");

      assert.ok(!result.success);
    });
  });

  describe("number transformation", () => {
    it("should parse number with transformation", () => {
      const parser = valibot(v.pipe(v.string(), v.transform(Number)));
      const result = parser.parse("42");

      assert.ok(result.success);
      assert.equal(result.value, 42);
    });

    it("should parse integer with validation", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform(Number), v.number(), v.integer()),
      );
      const result = parser.parse("42");

      assert.ok(result.success);
      assert.equal(result.value, 42);
    });

    it("should reject non-integer when integer() is required", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform(Number), v.number(), v.integer()),
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
      );
      const result = parser.parse("not-a-number");

      assert.ok(!result.success);
    });
  });

  describe("picklist validation", () => {
    it("should parse valid picklist value", () => {
      const parser = valibot(v.picklist(["debug", "info", "warn", "error"]));
      const result = parser.parse("info");

      assert.ok(result.success);
      assert.equal(result.value, "info");
    });

    it("should reject invalid picklist value", () => {
      const parser = valibot(v.picklist(["debug", "info", "warn", "error"]));
      const result = parser.parse("trace");

      assert.ok(!result.success);
    });
  });

  describe("transformations", () => {
    it("should apply transformations", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform((s) => s.toUpperCase())),
      );
      const result = parser.parse("hello");

      assert.ok(result.success);
      assert.equal(result.value, "HELLO");
    });

    it("should parse and transform dates", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform((s) => new Date(s))),
      );
      const result = parser.parse("2025-01-01");

      assert.ok(result.success);
      assert.ok(result.value instanceof Date);
      assert.equal(result.value.getFullYear(), 2025);
    });
  });

  describe("metavar inference", () => {
    describe("basic types", () => {
      it("should infer STRING for v.string()", () => {
        const parser = valibot(v.string());
        assert.equal(parser.metavar, "STRING");
      });

      it("should infer NUMBER for v.number()", () => {
        const parser = valibot(v.number());
        assert.equal(parser.metavar, "NUMBER");
      });

      it("should infer INTEGER for v.pipe(v.number(), v.integer())", () => {
        const parser = valibot(v.pipe(v.number(), v.integer()));
        assert.equal(parser.metavar, "INTEGER");
      });

      it("should infer BOOLEAN for v.boolean()", () => {
        const parser = valibot(v.boolean());
        assert.equal(parser.metavar, "BOOLEAN");
      });

      it("should infer DATE for v.date()", () => {
        const parser = valibot(v.date());
        assert.equal(parser.metavar, "DATE");
      });
    });

    describe("refined string types", () => {
      it("should infer EMAIL for v.pipe(v.string(), v.email())", () => {
        const parser = valibot(v.pipe(v.string(), v.email()));
        assert.equal(parser.metavar, "EMAIL");
      });

      it("should infer URL for v.pipe(v.string(), v.url())", () => {
        const parser = valibot(v.pipe(v.string(), v.url()));
        assert.equal(parser.metavar, "URL");
      });

      it("should infer UUID for v.pipe(v.string(), v.uuid())", () => {
        const parser = valibot(v.pipe(v.string(), v.uuid()));
        assert.equal(parser.metavar, "UUID");
      });

      it("should infer ULID for v.pipe(v.string(), v.ulid())", () => {
        const parser = valibot(v.pipe(v.string(), v.ulid()));
        assert.equal(parser.metavar, "ULID");
      });

      it("should infer CUID2 for v.pipe(v.string(), v.cuid2())", () => {
        const parser = valibot(v.pipe(v.string(), v.cuid2()));
        assert.equal(parser.metavar, "CUID2");
      });
    });

    describe("picklist and union types", () => {
      it("should infer CHOICE for v.picklist()", () => {
        const parser = valibot(v.picklist(["debug", "info", "warn", "error"]));
        assert.equal(parser.metavar, "CHOICE");
      });

      it("should infer VALUE for v.union()", () => {
        const parser = valibot(v.union([v.string(), v.number()]));
        assert.equal(parser.metavar, "VALUE");
      });

      it("should infer VALUE for v.literal()", () => {
        const parser = valibot(v.literal("production"));
        assert.equal(parser.metavar, "VALUE");
      });
    });

    describe("edge cases", () => {
      it("should use first validation for multiple validations", () => {
        const parser = valibot(
          v.pipe(v.string(), v.email(), v.minLength(5)),
        );
        assert.equal(parser.metavar, "EMAIL");
      });

      it("should unwrap optional schemas", () => {
        const parser = valibot(v.optional(v.pipe(v.string(), v.email())));
        assert.equal(parser.metavar, "EMAIL");
      });

      it("should unwrap nullable schemas", () => {
        const parser = valibot(v.nullable(v.number()));
        assert.equal(parser.metavar, "NUMBER");
      });

      it("should unwrap nullish schemas", () => {
        const parser = valibot(v.nullish(v.pipe(v.string(), v.email())));
        assert.equal(parser.metavar, "EMAIL");
      });

      it("should allow manual override", () => {
        const parser = valibot(v.pipe(v.string(), v.email()), {
          metavar: "CUSTOM",
        });
        assert.equal(parser.metavar, "CUSTOM");
      });

      it("should fallback to VALUE for unknown types", () => {
        const parser = valibot(v.object({ name: v.string() }));
        assert.equal(parser.metavar, "VALUE");
      });

      it("should fallback to VALUE for transform schemas without pipeline type", () => {
        const parser = valibot(
          v.pipe(v.string(), v.transform((s) => s.toUpperCase())),
        );
        assert.equal(parser.metavar, "VALUE");
      });

      it("should fallback to VALUE for array schemas", () => {
        const parser = valibot(v.array(v.string()));
        assert.equal(parser.metavar, "VALUE");
      });
    });

    describe("number with constraints", () => {
      it("should infer INTEGER for v.pipe(v.number(), v.integer(), v.minValue())", () => {
        const parser = valibot(
          v.pipe(v.number(), v.integer(), v.minValue(1024), v.maxValue(65535)),
        );
        assert.equal(parser.metavar, "INTEGER");
      });

      it("should infer NUMBER for v.pipe(v.number(), v.minValue()) without integer()", () => {
        const parser = valibot(
          v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
        );
        assert.equal(parser.metavar, "NUMBER");
      });
    });
  });

  describe("format()", () => {
    it("should format string values", () => {
      const parser = valibot(v.string());
      assert.equal(parser.format("hello"), "hello");
    });

    it("should format number values", () => {
      const parser = valibot(v.number());
      assert.equal(parser.format(42), "42");
    });

    it("should format boolean values", () => {
      const parser = valibot(v.boolean());
      assert.equal(parser.format(true), "true");
      assert.equal(parser.format(false), "false");
    });

    it("should format date values", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform((s) => new Date(s))),
      );
      const date = new Date("2025-01-01T00:00:00.000Z");
      const formatted = parser.format(date);
      assert.ok(formatted.includes("2025"));
    });
  });

  describe("error customization", () => {
    it("should use custom static error message", () => {
      const parser = valibot(v.pipe(v.string(), v.email()), {
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
          errors: {
            valibotError: (issues, input) => {
              const issue = issues[0];
              // deno-lint-ignore no-explicit-any
              const issueType = (issue as any)?.type ?? (issue as any)?.kind;
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
      const parser = valibot(v.pipe(v.string(), v.email()));
      const result = parser.parse("not-an-email");

      assert.ok(!result.success);
      // Should have some error message from Valibot
      assert.ok(result.error.length > 0);
    });

    it("should handle validation errors gracefully", () => {
      const parser = valibot(
        v.pipe(v.string(), v.transform(Number), v.number(), v.minValue(10)),
      );
      const result = parser.parse("5");

      assert.ok(!result.success);
      assert.ok(result.error.length > 0);
    });
  });

  describe("edge cases", () => {
    it("should handle empty string", () => {
      const parser = valibot(v.pipe(v.string(), v.minLength(1)));
      const result = parser.parse("");

      assert.ok(!result.success);
    });

    it("should handle optional schemas", () => {
      const parser = valibot(v.optional(v.string()));
      const result = parser.parse("hello");

      assert.ok(result.success);
      assert.equal(result.value, "hello");
    });

    it("should handle literal values", () => {
      const parser = valibot(v.literal("production"));

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
      const parser = valibot(v.pipe(v.string(), v.regex(/^[A-Z]{3}$/)));

      const validResult = parser.parse("ABC");
      assert.ok(validResult.success);

      const invalidResult = parser.parse("abc");
      assert.ok(!invalidResult.success);
    });

    it("should handle length constraints", () => {
      const parser = valibot(v.pipe(v.string(), v.length(5)));

      const validResult = parser.parse("hello");
      assert.ok(validResult.success);

      const invalidResult = parser.parse("hi");
      assert.ok(!invalidResult.success);
    });

    it("should handle min/max length", () => {
      const parser = valibot(
        v.pipe(v.string(), v.minLength(2), v.maxLength(10)),
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
