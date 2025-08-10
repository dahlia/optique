import { type ErrorMessage, message } from "@optique/core/error";
import { float, integer } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Helper function to check if an ErrorMessage is a structured error
function isStructuredError(error: ErrorMessage): error is {
  readonly message: TemplateStringsArray;
  readonly values: readonly unknown[];
} {
  return (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    "values" in error
  );
}
describe("message", () => {
  it("should create structured error message from template literal", () => {
    const expected = 42;
    const actual = "invalid";
    const error = message`Expected ${expected}, got ${actual}.`;

    assert.equal(typeof error, "object");
    if (!isStructuredError(error)) {
      throw new Error("Expected structured error message");
    }
    assert.ok("message" in error);
    assert.ok("values" in error);
    assert.equal(error.values.length, 2);
    assert.equal(error.values[0], expected);
    assert.equal(error.values[1], actual);
  });

  it("should handle template literals with no interpolated values", () => {
    const error = message`Simple error message`;

    assert.equal(typeof error, "object");
    if (!isStructuredError(error)) {
      throw new Error("Expected structured error message");
    }
    assert.ok("message" in error);
    assert.ok("values" in error);
    assert.equal(error.values.length, 0);
  });

  it("should handle template literals with multiple values", () => {
    const min = 1;
    const max = 100;
    const value = 150;
    const error = message`Value ${value} is out of range [${min}, ${max}]`;

    assert.equal(typeof error, "object");
    if (!isStructuredError(error)) {
      throw new Error("Expected structured error message");
    }
    assert.equal(error.values.length, 3);
    assert.equal(error.values[0], value);
    assert.equal(error.values[1], min);
    assert.equal(error.values[2], max);
  });
});

describe("integer", () => {
  describe("number parser", () => {
    it("should parse valid integers", () => {
      const parser = integer({});

      const result1 = parser.parse("42");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 42);
        assert.equal(typeof result1.value, "number");
      }

      const result2 = parser.parse("0");
      assert.equal(result2.success, true);
      if (result2.success) {
        assert.equal(result2.value, 0);
      }

      const result3 = parser.parse("999");
      assert.equal(result3.success, true);
      if (result3.success) {
        assert.equal(result3.value, 999);
      }
    });

    it("should reject invalid integers", () => {
      const parser = integer({});

      const result1 = parser.parse("abc");
      assert.ok(!result1.success);
      if (!result1.success) {
        assert.equal(typeof result1.error, "object");
      }

      const result2 = parser.parse("12.34");
      assert.ok(!result2.success);

      const result3 = parser.parse("-42");
      assert.ok(!result3.success);

      const result4 = parser.parse("42.0");
      assert.ok(!result4.success);

      const result5 = parser.parse("1e5");
      assert.ok(!result5.success);

      const result6 = parser.parse("");
      assert.ok(!result6.success);

      const result7 = parser.parse("  42  ");
      assert.ok(!result7.success);
    });

    it("should enforce minimum constraint", () => {
      const parser = integer({ min: 10 });

      const result1 = parser.parse("15");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 15);
      }

      const result2 = parser.parse("10");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 10);
      }

      const result3 = parser.parse("5");
      assert.ok(!result3.success);
      if (!result3.success) {
        assert.equal(typeof result3.error, "object");
      }
    });

    it("should enforce maximum constraint", () => {
      const parser = integer({ max: 100 });

      const result1 = parser.parse("50");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 50);
      }

      const result2 = parser.parse("100");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 100);
      }

      const result3 = parser.parse("150");
      assert.ok(!result3.success);
      if (!result3.success) {
        assert.equal(typeof result3.error, "object");
      }
    });

    it("should enforce both min and max constraints", () => {
      const parser = integer({ min: 1, max: 65535 });

      const result1 = parser.parse("8080");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 8080);
      }

      const result2 = parser.parse("1");
      assert.ok(result2.success);

      const result3 = parser.parse("65535");
      assert.ok(result3.success);

      const result4 = parser.parse("0");
      assert.ok(!result4.success);

      const result5 = parser.parse("65536");
      assert.ok(!result5.success);
    });

    it("should work with explicit number type", () => {
      const parser = integer({ type: "number", min: 0, max: 1000 });

      const result = parser.parse("500");
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, 500);
        assert.equal(typeof result.value, "number");
      }
    });
  });

  describe("bigint parser", () => {
    it("should parse valid integers as BigInt", () => {
      const parser = integer({ type: "bigint" });

      const result1 = parser.parse("42");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 42n);
        assert.equal(typeof result1.value, "bigint");
      }

      const result2 = parser.parse("0");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 0n);
      }

      const result3 = parser.parse("9007199254740992"); // Number.MAX_SAFE_INTEGER + 1
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, 9007199254740992n);
      }

      const result4 = parser.parse("-42");
      assert.ok(result4.success);
      if (result4.success) {
        assert.equal(result4.value, -42n);
      }
    });

    it("should reject invalid integers for BigInt", () => {
      const parser = integer({ type: "bigint" });

      const result1 = parser.parse("abc");
      assert.ok(!result1.success);
      if (!result1.success) {
        assert.equal(typeof result1.error, "object");
      }

      const result2 = parser.parse("12.34");
      assert.ok(!result2.success);

      const result3 = parser.parse("1e5");
      assert.ok(!result3.success);

      const result4 = parser.parse("0x");
      assert.ok(!result4.success);

      const result5 = parser.parse("Infinity");
      assert.ok(!result5.success);
    });

    it("should enforce minimum constraint for BigInt", () => {
      const parser = integer({ type: "bigint", min: 10n });

      const result1 = parser.parse("15");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 15n);
      }

      const result2 = parser.parse("10");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 10n);
      }

      const result3 = parser.parse("5");
      assert.ok(!result3.success);
      if (!result3.success) {
        assert.equal(typeof result3.error, "object");
      }
    });

    it("should enforce maximum constraint for BigInt", () => {
      const parser = integer({ type: "bigint", max: 100n });

      const result1 = parser.parse("50");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 50n);
      }

      const result2 = parser.parse("100");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 100n);
      }

      const result3 = parser.parse("150");
      assert.ok(!result3.success);
      if (!result3.success) {
        assert.equal(typeof result3.error, "object");
      }
    });

    it("should enforce both min and max constraints for BigInt", () => {
      const parser = integer({ type: "bigint", min: -1000n, max: 1000n });

      const result1 = parser.parse("0");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 0n);
      }

      const result2 = parser.parse("-1000");
      assert.ok(result2.success);

      const result3 = parser.parse("1000");
      assert.ok(result3.success);

      const result4 = parser.parse("-1001");
      assert.ok(!result4.success);

      const result5 = parser.parse("1001");
      assert.ok(!result5.success);
    });

    it("should handle very large BigInt values", () => {
      const parser = integer({ type: "bigint" });
      const veryLargeNumber = "12345678901234567890123456789";

      const result = parser.parse(veryLargeNumber);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, BigInt(veryLargeNumber));
        assert.equal(typeof result.value, "bigint");
      }
    });
  });

  describe("error messages", () => {
    it("should provide structured error messages for invalid input", () => {
      const parser = integer({});
      const result = parser.parse("invalid");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (!isStructuredError(result.error)) {
          throw new Error("Expected structured error message");
        }
        assert.ok("message" in result.error);
        assert.ok("values" in result.error);
        assert.equal(result.error.values.length, 1);
        assert.equal(result.error.values[0], "invalid");
      }
    });

    it("should provide structured error messages for min constraint violation", () => {
      const parser = integer({ min: 10 });
      const result = parser.parse("5");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (!isStructuredError(result.error)) {
          throw new Error("Expected structured error message");
        }
        assert.ok("message" in result.error);
        assert.ok("values" in result.error);
        assert.equal(result.error.values.length, 2);
        assert.equal(result.error.values[0], 10);
        assert.equal(result.error.values[1], 5);
      }
    });

    it("should provide structured error messages for max constraint violation", () => {
      const parser = integer({ max: 100 });
      const result = parser.parse("150");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (!isStructuredError(result.error)) {
          throw new Error("Expected structured error message");
        }
        assert.ok("message" in result.error);
        assert.ok("values" in result.error);
        assert.equal(result.error.values.length, 2);
        assert.equal(result.error.values[0], 100);
        assert.equal(result.error.values[1], 150);
      }
    });

    it("should provide structured error messages for BigInt invalid input", () => {
      const parser = integer({ type: "bigint" });
      const result = parser.parse("invalid");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (!isStructuredError(result.error)) {
          throw new Error("Expected structured error message");
        }
        assert.ok("message" in result.error);
        assert.ok("values" in result.error);
        assert.equal(result.error.values.length, 1);
        assert.equal(result.error.values[0], "invalid");
      }
    });

    it("should provide structured error messages for BigInt constraint violations", () => {
      const parser = integer({ type: "bigint", min: 0n, max: 100n });

      const result1 = parser.parse("-5");
      assert.ok(!result1.success);
      if (!result1.success) {
        if (!isStructuredError(result1.error)) {
          throw new Error("Expected structured error message");
        }
        assert.equal(result1.error.values[0], 0n);
        assert.equal(result1.error.values[1], -5n);
      }

      const result2 = parser.parse("150");
      assert.ok(!result2.success);
      if (!result2.success) {
        if (!isStructuredError(result2.error)) {
          throw new Error("Expected structured error message");
        }
        assert.equal(result2.error.values[0], 100n);
        assert.equal(result2.error.values[1], 150n);
      }
    });
  });

  describe("function overloads", () => {
    it("should return correct type based on options", () => {
      // Type checking is handled by TypeScript, but we can verify runtime behavior
      const numberParser = integer({ type: "number" });
      const bigintParser = integer({ type: "bigint" });

      const numberResult = numberParser.parse("42");
      const bigintResult = bigintParser.parse("42");

      assert.ok(numberResult.success);
      assert.ok(bigintResult.success);

      if (numberResult.success && bigintResult.success) {
        assert.equal(typeof numberResult.value, "number");
        assert.equal(typeof bigintResult.value, "bigint");
        assert.equal(numberResult.value, 42);
        assert.equal(bigintResult.value, 42n);
      }
    });

    it("should default to number type when type is not specified", () => {
      const parser = integer({});
      const result = parser.parse("42");

      assert.ok(result.success);
      if (result.success) {
        assert.equal(typeof result.value, "number");
        assert.equal(result.value, 42);
      }
    });

    it("should handle edge cases correctly", () => {
      const numberParser = integer({});
      const bigintParser = integer({ type: "bigint" });

      // Test leading zeros
      const result1 = numberParser.parse("007");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 7);
      }

      const result2 = bigintParser.parse("0000042");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 42n);
      }

      // Test single digit zero
      const result3 = numberParser.parse("0");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, 0);
      }

      const result4 = bigintParser.parse("0");
      assert.ok(result4.success);
      if (result4.success) {
        assert.equal(result4.value, 0n);
      }

      // Test empty string for BigInt (should succeed as 0n)
      const result5 = bigintParser.parse("");
      assert.ok(result5.success);
      if (result5.success) {
        assert.equal(result5.value, 0n);
      }

      // Test whitespace-only string for BigInt (should succeed as 0n)
      const result6 = bigintParser.parse("   ");
      assert.ok(result6.success);
      if (result6.success) {
        assert.equal(result6.value, 0n);
      }
    });

    it("should handle boundary values correctly", () => {
      // Test with Number.MAX_SAFE_INTEGER
      const numberParser = integer({ max: Number.MAX_SAFE_INTEGER });
      const result1 = numberParser.parse(String(Number.MAX_SAFE_INTEGER));
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, Number.MAX_SAFE_INTEGER);
      }

      // Test BigInt with very large values
      const bigintParser = integer({ type: "bigint" });
      const veryLargePositive = "999999999999999999999999999999999";
      const veryLargeNegative = "-999999999999999999999999999999999";

      const result2 = bigintParser.parse(veryLargePositive);
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, BigInt(veryLargePositive));
      }

      const result3 = bigintParser.parse(veryLargeNegative);
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, BigInt(veryLargeNegative));
      }
    });

    it("should validate constraints at boundary values", () => {
      // Test exact boundary values
      const parser1 = integer({ min: 0, max: 100 });

      const result1 = parser1.parse("0");
      assert.ok(result1.success);

      const result2 = parser1.parse("100");
      assert.ok(result2.success);

      // Test BigInt boundaries
      const parser2 = integer({ type: "bigint", min: -5n, max: 5n });

      const result3 = parser2.parse("-5");
      assert.ok(result3.success);

      const result4 = parser2.parse("5");
      assert.ok(result4.success);

      const result5 = parser2.parse("-6");
      assert.ok(!result5.success);

      const result6 = parser2.parse("6");
      assert.ok(!result6.success);
    });
  });
});

describe("float", () => {
  describe("basic parsing", () => {
    it("should parse valid floating-point numbers", () => {
      const parser = float({});

      const result1 = parser.parse("42.5");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 42.5);
        assert.equal(typeof result1.value, "number");
      }

      const result2 = parser.parse("0.0");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 0.0);
      }

      const result3 = parser.parse("-3.14159");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, -3.14159);
      }

      const result4 = parser.parse("1e5");
      assert.ok(result4.success);
      if (result4.success) {
        assert.equal(result4.value, 100000);
      }

      const result5 = parser.parse("2.5e-3");
      assert.ok(result5.success);
      if (result5.success) {
        assert.equal(result5.value, 0.0025);
      }

      const result6 = parser.parse(".5");
      assert.ok(result6.success);
      if (result6.success) {
        assert.equal(result6.value, 0.5);
      }

      const result7 = parser.parse("-.75");
      assert.ok(result7.success);
      if (result7.success) {
        assert.equal(result7.value, -0.75);
      }
    });

    it("should parse integer values as floats", () => {
      const parser = float({});

      const result1 = parser.parse("42");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 42);
        assert.equal(typeof result1.value, "number");
      }

      const result2 = parser.parse("-5");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, -5);
      }
    });

    it("should reject Infinity by default", () => {
      const parser = float({});

      const result1 = parser.parse("Infinity");
      assert.ok(!result1.success);

      const result2 = parser.parse("-Infinity");
      assert.ok(!result2.success);

      const result3 = parser.parse("+Infinity");
      assert.ok(!result3.success);

      const result4 = parser.parse("infinity");
      assert.ok(!result4.success);

      const result5 = parser.parse("INFINITY");
      assert.ok(!result5.success);
    });

    it("should reject NaN by default", () => {
      const parser = float({});

      const result1 = parser.parse("NaN");
      assert.ok(!result1.success);

      const result2 = parser.parse("nan");
      assert.ok(!result2.success);
    });

    it("should reject invalid numeric strings", () => {
      const parser = float({});

      const result1 = parser.parse("abc");
      assert.ok(!result1.success);
      if (!result1.success) {
        assert.equal(typeof result1.error, "object");
      }

      const result2 = parser.parse("12.34.56");
      assert.ok(!result2.success);

      const result3 = parser.parse("--5");
      assert.ok(!result3.success);

      const result4 = parser.parse("5e");
      assert.ok(!result4.success);

      const result5 = parser.parse("e5");
      assert.ok(!result5.success);

      const result6 = parser.parse("not-a-number");
      assert.ok(!result6.success);

      const result7 = parser.parse("");
      assert.ok(!result7.success);

      const result8 = parser.parse("   ");
      assert.ok(!result8.success);

      const result9 = parser.parse("0x10");
      assert.ok(!result9.success);

      const result10 = parser.parse("0b10");
      assert.ok(!result10.success);

      const result11 = parser.parse("0o10");
      assert.ok(!result11.success);

      const result12 = parser.parse(".");
      assert.ok(!result12.success);

      const result13 = parser.parse("+");
      assert.ok(!result13.success);

      const result14 = parser.parse("-");
      assert.ok(!result14.success);

      const result15 = parser.parse("++5");
      assert.ok(!result15.success);

      const result16 = parser.parse("5.5.5");
      assert.ok(!result16.success);
    });
  });

  describe("NaN handling", () => {
    it("should allow NaN when allowNaN is true", () => {
      const parser = float({ allowNaN: true });

      const result1 = parser.parse("NaN");
      assert.ok(result1.success);
      if (result1.success) {
        assert.ok(Number.isNaN(result1.value));
      }

      const result2 = parser.parse("nan");
      assert.ok(result2.success);
      if (result2.success) {
        assert.ok(Number.isNaN(result2.value));
      }
    });

    it("should reject NaN when allowNaN is false", () => {
      const parser = float({ allowNaN: false });

      const result1 = parser.parse("NaN");
      assert.ok(!result1.success);

      const result2 = parser.parse("nan");
      assert.ok(!result2.success);
    });
  });

  describe("Infinity handling", () => {
    it("should allow Infinity when allowInfinity is true", () => {
      const parser = float({ allowInfinity: true });

      const result1 = parser.parse("Infinity");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, Infinity);
      }

      const result2 = parser.parse("-Infinity");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, -Infinity);
      }

      const result3 = parser.parse("+Infinity");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, Infinity);
      }
    });

    it("should allow Infinity with case insensitivity when allowInfinity is true", () => {
      const parser = float({ allowInfinity: true });

      const result1 = parser.parse("infinity");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, Infinity);
      }

      const result2 = parser.parse("INFINITY");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, Infinity);
      }

      const result3 = parser.parse("-infinity");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, -Infinity);
      }

      const result4 = parser.parse("+INFINITY");
      assert.ok(result4.success);
      if (result4.success) {
        assert.equal(result4.value, Infinity);
      }
    });

    it("should reject Infinity when allowInfinity is false", () => {
      const parser = float({ allowInfinity: false });

      const result1 = parser.parse("Infinity");
      assert.ok(!result1.success);

      const result2 = parser.parse("-Infinity");
      assert.ok(!result2.success);

      const result3 = parser.parse("infinity");
      assert.ok(!result3.success);
    });
  });

  describe("constraints", () => {
    it("should enforce minimum constraint", () => {
      const parser = float({ min: 0 });

      const result1 = parser.parse("5.5");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 5.5);
      }

      const result2 = parser.parse("0");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 0);
      }

      const result3 = parser.parse("-1.5");
      assert.ok(!result3.success);
      if (!result3.success) {
        assert.equal(typeof result3.error, "object");
      }
    });

    it("should enforce maximum constraint", () => {
      const parser = float({ max: 100 });

      const result1 = parser.parse("50.5");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 50.5);
      }

      const result2 = parser.parse("100");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 100);
      }

      const result3 = parser.parse("150.5");
      assert.ok(!result3.success);
      if (!result3.success) {
        assert.equal(typeof result3.error, "object");
      }
    });

    it("should enforce both min and max constraints", () => {
      const parser = float({ min: -10.5, max: 10.5 });

      const result1 = parser.parse("5.25");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 5.25);
      }

      const result2 = parser.parse("-10.5");
      assert.ok(result2.success);

      const result3 = parser.parse("10.5");
      assert.ok(result3.success);

      const result4 = parser.parse("-10.6");
      assert.ok(!result4.success);

      const result5 = parser.parse("10.6");
      assert.ok(!result5.success);
    });

    it("should handle NaN constraints when allowNaN is true", () => {
      const parser = float({ allowNaN: true, min: 0 });

      const result1 = parser.parse("NaN");
      assert.ok(result1.success);
      if (result1.success) {
        assert.ok(Number.isNaN(result1.value));
      }

      const result2 = parser.parse("-5");
      assert.ok(!result2.success);
    });

    it("should handle Infinity constraints when allowInfinity is true", () => {
      const parser = float({ allowInfinity: true, max: 100 });

      const result1 = parser.parse("Infinity");
      assert.ok(!result1.success);

      const result2 = parser.parse("-Infinity");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, -Infinity);
      }

      const result3 = parser.parse("50");
      assert.ok(result3.success);
    });

    it("should handle both NaN and Infinity options", () => {
      const parser = float({ allowNaN: true, allowInfinity: true });

      const result1 = parser.parse("NaN");
      assert.ok(result1.success);
      if (result1.success) {
        assert.ok(Number.isNaN(result1.value));
      }

      const result2 = parser.parse("Infinity");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, Infinity);
      }

      const result3 = parser.parse("-Infinity");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, -Infinity);
      }
    });
  });

  describe("error messages", () => {
    it("should provide structured error messages for invalid input", () => {
      const parser = float({});
      const result = parser.parse("invalid");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (!isStructuredError(result.error)) {
          throw new Error("Expected structured error message");
        }
        assert.ok("message" in result.error);
        assert.ok("values" in result.error);
        assert.equal(result.error.values.length, 1);
        assert.equal(result.error.values[0], "invalid");
      }
    });

    it("should provide structured error messages for min constraint violation", () => {
      const parser = float({ min: 0 });
      const result = parser.parse("-5.5");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (!isStructuredError(result.error)) {
          throw new Error("Expected structured error message");
        }
        assert.ok("message" in result.error);
        assert.ok("values" in result.error);
        assert.equal(result.error.values.length, 2);
        assert.equal(result.error.values[0], 0);
        assert.equal(result.error.values[1], -5.5);
      }
    });

    it("should provide structured error messages for max constraint violation", () => {
      const parser = float({ max: 100 });
      const result = parser.parse("150.5");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (!isStructuredError(result.error)) {
          throw new Error("Expected structured error message");
        }
        assert.ok("message" in result.error);
        assert.ok("values" in result.error);
        assert.equal(result.error.values.length, 2);
        assert.equal(result.error.values[0], 100);
        assert.equal(result.error.values[1], 150.5);
      }
    });
  });

  describe("edge cases", () => {
    it("should handle zero correctly", () => {
      const parser = float({});

      const result1 = parser.parse("0");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 0);
      }

      const result2 = parser.parse("-0");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, -0);
        assert.ok(Object.is(result2.value, -0));
      }

      const result3 = parser.parse("0.0");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, 0.0);
      }
    });

    it("should handle very small and very large numbers", () => {
      const parser = float({});

      const result1 = parser.parse("1e-10");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 1e-10);
      }

      const result2 = parser.parse("1e10");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 1e10);
      }
    });

    it("should reject numbers with leading/trailing whitespace", () => {
      const parser = float({});

      // Strict parsing should reject whitespace-padded numbers
      const result1 = parser.parse("  42.5  ");
      assert.ok(!result1.success);

      const result2 = parser.parse("\t3.14\n");
      assert.ok(!result2.success);

      const result3 = parser.parse(" 123");
      assert.ok(!result3.success);

      const result4 = parser.parse("456 ");
      assert.ok(!result4.success);
    });

    it("should handle precision edge cases", () => {
      const parser = float({});

      const result1 = parser.parse("0.1");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 0.1);
      }

      const result2 = parser.parse("0.123456789012345");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 0.123456789012345);
      }
    });
  });

  describe("custom metavar", () => {
    it("should use custom metavar when provided", () => {
      const parser = float({ metavar: "RATE" });
      assert.equal(parser.metavar, "RATE");
    });

    it("should use default metavar when not provided", () => {
      const parser = float({});
      assert.equal(parser.metavar, "NUMBER");
    });
  });
});
