import { type ErrorMessage, message } from "@optique/core/error";
import { choice, float, integer, locale, url } from "@optique/core/valueparser";
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

describe("choice", () => {
  describe("basic parsing", () => {
    it("should parse valid values from the choice list", () => {
      const parser = choice(["red", "green", "blue"]);

      const result1 = parser.parse("red");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "red");
        assert.equal(typeof result1.value, "string");
      }

      const result2 = parser.parse("green");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "green");
      }

      const result3 = parser.parse("blue");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, "blue");
      }
    });

    it("should reject values not in the choice list", () => {
      const parser = choice(["yes", "no"]);

      const result1 = parser.parse("maybe");
      assert.ok(!result1.success);
      if (!result1.success) {
        assert.equal(typeof result1.error, "object");
        if (isStructuredError(result1.error)) {
          assert.ok("message" in result1.error);
          assert.ok("values" in result1.error);
          assert.equal(result1.error.values.length, 2);
          assert.equal(result1.error.values[0], "yes, no");
          assert.equal(result1.error.values[1], "maybe");
        }
      }

      const result2 = parser.parse("YES");
      assert.ok(!result2.success);

      const result3 = parser.parse("");
      assert.ok(!result3.success);

      const result4 = parser.parse("true");
      assert.ok(!result4.success);
    });

    it("should work with single value choice", () => {
      const parser = choice(["only"]);

      const result1 = parser.parse("only");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "only");
      }

      const result2 = parser.parse("other");
      assert.ok(!result2.success);
    });

    it("should work with numeric string choices", () => {
      const parser = choice(["1", "2", "3"]);

      const result1 = parser.parse("1");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "1");
        assert.equal(typeof result1.value, "string");
      }

      const result2 = parser.parse("2");
      assert.ok(result2.success);

      const result3 = parser.parse("4");
      assert.ok(!result3.success);

      // Should not parse numbers, only exact string matches
      const result4 = parser.parse("01");
      assert.ok(!result4.success);
    });

    it("should work with empty choice list", () => {
      const parser = choice([]);

      const result1 = parser.parse("anything");
      assert.ok(!result1.success);

      const result2 = parser.parse("");
      assert.ok(!result2.success);
    });

    it("should handle choices with special characters", () => {
      const parser = choice(["--verbose", "-v", "debug:trace", "key=value"]);

      const result1 = parser.parse("--verbose");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "--verbose");
      }

      const result2 = parser.parse("-v");
      assert.ok(result2.success);

      const result3 = parser.parse("debug:trace");
      assert.ok(result3.success);

      const result4 = parser.parse("key=value");
      assert.ok(result4.success);

      const result5 = parser.parse("--other");
      assert.ok(!result5.success);
    });

    it("should preserve exact string values with whitespace", () => {
      const parser = choice(["  spaced  ", "tab\there", "new\nline"]);

      const result1 = parser.parse("  spaced  ");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "  spaced  ");
      }

      const result2 = parser.parse("tab\there");
      assert.ok(result2.success);

      const result3 = parser.parse("new\nline");
      assert.ok(result3.success);

      // Should not match trimmed versions
      const result4 = parser.parse("spaced");
      assert.ok(!result4.success);
    });
  });

  describe("case sensitivity", () => {
    it("should be case sensitive by default", () => {
      const parser = choice(["Red", "Green", "Blue"]);

      const result1 = parser.parse("Red");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "Red");
      }

      const result2 = parser.parse("red");
      assert.ok(!result2.success);

      const result3 = parser.parse("RED");
      assert.ok(!result3.success);

      const result4 = parser.parse("rEd");
      assert.ok(!result4.success);
    });

    it("should support case insensitive matching when enabled", () => {
      const parser = choice(["Red", "Green", "Blue"], {
        caseInsensitive: true,
      });

      const result1 = parser.parse("Red");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "Red"); // Should return original casing
      }

      const result2 = parser.parse("red");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "Red"); // Should return original casing
      }

      const result3 = parser.parse("RED");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, "Red"); // Should return original casing
      }

      const result4 = parser.parse("rEd");
      assert.ok(result4.success);
      if (result4.success) {
        assert.equal(result4.value, "Red"); // Should return original casing
      }

      const result5 = parser.parse("yellow");
      assert.ok(!result5.success);
    });

    it("should handle case insensitive matching with mixed case choices", () => {
      const parser = choice(["CamelCase", "snake_case", "kebab-case"], {
        caseInsensitive: true,
      });

      const result1 = parser.parse("camelcase");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "CamelCase");
      }

      const result2 = parser.parse("SNAKE_CASE");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "snake_case");
      }

      const result3 = parser.parse("Kebab-Case");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, "kebab-case");
      }
    });

    it("should explicitly reject case insensitive when disabled", () => {
      const parser = choice(["True", "False"], { caseInsensitive: false });

      const result1 = parser.parse("True");
      assert.ok(result1.success);

      const result2 = parser.parse("true");
      assert.ok(!result2.success);

      const result3 = parser.parse("FALSE");
      assert.ok(!result3.success);
    });

    it("should handle case insensitive matching with accented characters", () => {
      const parser = choice(["Café", "Naïve", "Résumé"], {
        caseInsensitive: true,
      });

      const result1 = parser.parse("café");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "Café");
      }

      const result2 = parser.parse("NAÏVE");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "Naïve");
      }

      const result3 = parser.parse("résumé");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, "Résumé");
      }
    });
  });

  describe("custom metavar", () => {
    it("should use custom metavar when provided", () => {
      const parser = choice(["on", "off"], { metavar: "SWITCH" });
      assert.equal(parser.metavar, "SWITCH");
    });

    it("should use default metavar when not provided", () => {
      const parser = choice(["yes", "no"]);
      assert.equal(parser.metavar, "TYPE");
    });

    it("should use custom metavar with case insensitive option", () => {
      const parser = choice(["enabled", "disabled"], {
        metavar: "STATE",
        caseInsensitive: true,
      });
      assert.equal(parser.metavar, "STATE");
    });
  });

  describe("error messages", () => {
    it("should provide structured error messages for invalid input", () => {
      const parser = choice(["alpha", "beta", "gamma"]);
      const result = parser.parse("delta");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (isStructuredError(result.error)) {
          assert.ok("message" in result.error);
          assert.ok("values" in result.error);
          assert.equal(result.error.values.length, 2);
          assert.equal(result.error.values[0], "alpha, beta, gamma");
          assert.equal(result.error.values[1], "delta");
        }
      }
    });

    it("should provide structured error messages with single choice", () => {
      const parser = choice(["only"]);
      const result = parser.parse("other");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (isStructuredError(result.error)) {
          assert.equal(result.error.values.length, 2);
          assert.equal(result.error.values[0], "only");
          assert.equal(result.error.values[1], "other");
        }
      }
    });

    it("should provide structured error messages for empty choice list", () => {
      const parser = choice([]);
      const result = parser.parse("anything");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (isStructuredError(result.error)) {
          assert.equal(result.error.values.length, 2);
          assert.equal(result.error.values[0], "");
          assert.equal(result.error.values[1], "anything");
        }
      }
    });

    it("should provide structured error messages for case insensitive parser", () => {
      const parser = choice(["YES", "NO"], { caseInsensitive: true });
      const result = parser.parse("maybe");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (isStructuredError(result.error)) {
          assert.equal(result.error.values.length, 2);
          assert.equal(result.error.values[0], "YES, NO");
          assert.equal(result.error.values[1], "maybe");
        }
      }
    });

    it("should show original choices in error message, not normalized ones", () => {
      const parser = choice(["High", "Medium", "Low"], {
        caseInsensitive: true,
      });
      const result = parser.parse("none");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (isStructuredError(result.error)) {
          // Should show original choices, not lowercased versions
          assert.equal(result.error.values[0], "High, Medium, Low");
          assert.equal(result.error.values[1], "none");
        }
      }
    });
  });

  describe("edge cases", () => {
    it("should handle choices with duplicate values", () => {
      const parser = choice(["duplicate", "duplicate", "unique"]);

      const result1 = parser.parse("duplicate");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "duplicate");
      }

      const result2 = parser.parse("unique");
      assert.ok(result2.success);

      const result3 = parser.parse("other");
      assert.ok(!result3.success);
    });

    it("should handle empty string as a valid choice", () => {
      const parser = choice(["", "value"]);

      const result1 = parser.parse("");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "");
      }

      const result2 = parser.parse("value");
      assert.ok(result2.success);

      const result3 = parser.parse("other");
      assert.ok(!result3.success);
    });

    it("should handle choices with unicode characters", () => {
      const parser = choice(["🔴", "🟢", "🔵", "α", "β", "γ"]);

      const result1 = parser.parse("🔴");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "🔴");
      }

      const result2 = parser.parse("α");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "α");
      }

      const result3 = parser.parse("🟡");
      assert.ok(!result3.success);
    });

    it("should handle very long choice lists", () => {
      const longChoices = Array.from({ length: 100 }, (_, i) => `option${i}`);
      const parser = choice(longChoices);

      const result1 = parser.parse("option0");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "option0");
      }

      const result2 = parser.parse("option99");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "option99");
      }

      const result3 = parser.parse("option100");
      assert.ok(!result3.success);
    });

    it("should handle choices with only whitespace differences", () => {
      const parser = choice([" ", "  ", "\t", "\n"]);

      const result1 = parser.parse(" ");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, " ");
      }

      const result2 = parser.parse("  ");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "  ");
      }

      const result3 = parser.parse("\t");
      assert.ok(result3.success);

      const result4 = parser.parse("\n");
      assert.ok(result4.success);

      const result5 = parser.parse("   ");
      assert.ok(!result5.success);
    });

    it("should maintain type safety with const assertion", () => {
      // This test verifies TypeScript compile-time behavior
      const modes = ["development", "production", "test"] as const;
      const parser = choice(modes);

      const result = parser.parse("development");
      assert.ok(result.success);
      if (result.success) {
        // The type should be "development" | "production" | "test"
        assert.equal(result.value, "development");
        assert.ok(["development", "production", "test"].includes(result.value));
      }
    });

    it("should handle boundary values correctly with case insensitive", () => {
      const parser = choice(["a", "A"], { caseInsensitive: true });

      const result1 = parser.parse("a");
      assert.ok(result1.success);
      if (result1.success) {
        // Should return the first match in the original array
        assert.equal(result1.value, "a");
      }

      const result2 = parser.parse("A");
      assert.ok(result2.success);
      if (result2.success) {
        // Should return the first match in the original array
        assert.equal(result2.value, "a");
      }
    });

    it("should handle null-like string values", () => {
      const parser = choice(["null", "undefined", "NaN", "false"]);

      const result1 = parser.parse("null");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "null");
        assert.equal(typeof result1.value, "string");
      }

      const result2 = parser.parse("undefined");
      assert.ok(result2.success);

      const result3 = parser.parse("NaN");
      assert.ok(result3.success);

      const result4 = parser.parse("false");
      assert.ok(result4.success);

      const result5 = parser.parse("true");
      assert.ok(!result5.success);
    });
  });

  describe("real-world usage examples", () => {
    it("should handle common boolean-like choices", () => {
      const parser = choice(["true", "false"], { caseInsensitive: true });

      const result1 = parser.parse("true");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "true");
      }

      const result2 = parser.parse("FALSE");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "false");
      }

      const result3 = parser.parse("1");
      assert.ok(!result3.success);
    });

    it("should handle log level choices", () => {
      const parser = choice(["error", "warn", "info", "debug", "trace"]);

      const result1 = parser.parse("error");
      assert.ok(result1.success);

      const result2 = parser.parse("debug");
      assert.ok(result2.success);

      const result3 = parser.parse("verbose");
      assert.ok(!result3.success);
    });

    it("should handle environment choices", () => {
      const parser = choice(["development", "staging", "production"], {
        metavar: "ENV",
        caseInsensitive: true,
      });

      assert.equal(parser.metavar, "ENV");

      const result1 = parser.parse("development");
      assert.ok(result1.success);

      const result2 = parser.parse("PRODUCTION");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "production");
      }

      const result3 = parser.parse("testing");
      assert.ok(!result3.success);
    });

    it("should handle format choices", () => {
      const parser = choice(["json", "yaml", "xml", "csv"]);

      const result1 = parser.parse("json");
      assert.ok(result1.success);

      const result2 = parser.parse("yaml");
      assert.ok(result2.success);

      const result3 = parser.parse("txt");
      assert.ok(!result3.success);
    });

    it("should handle HTTP method choices", () => {
      const parser = choice(["GET", "POST", "PUT", "DELETE", "PATCH"], {
        metavar: "METHOD",
      });

      const result1 = parser.parse("GET");
      assert.ok(result1.success);

      const result2 = parser.parse("POST");
      assert.ok(result2.success);

      const result3 = parser.parse("get");
      assert.ok(!result3.success); // Case sensitive by default

      const result4 = parser.parse("OPTIONS");
      assert.ok(!result4.success);
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

describe("url", () => {
  describe("basic parsing", () => {
    it("should parse valid URLs", () => {
      const parser = url({});

      const result1 = parser.parse("https://example.com");
      assert.ok(result1.success);
      if (result1.success) {
        assert.ok(result1.value instanceof URL);
        assert.equal(result1.value.hostname, "example.com");
        assert.equal(result1.value.protocol, "https:");
      }

      const result2 = parser.parse("http://localhost:8080/path?query=value");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.hostname, "localhost");
        assert.equal(result2.value.port, "8080");
        assert.equal(result2.value.pathname, "/path");
        assert.equal(result2.value.search, "?query=value");
      }

      const result3 = parser.parse("ftp://files.example.com/file.txt");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value.protocol, "ftp:");
        assert.equal(result3.value.hostname, "files.example.com");
        assert.equal(result3.value.pathname, "/file.txt");
      }
    });

    it("should parse URLs with different protocols", () => {
      const parser = url({});

      const protocols = [
        "https://example.com",
        "http://example.com",
        "ftp://example.com",
        "file:///path/to/file",
        "mailto:test@example.com",
        "ws://websocket.example.com",
        "wss://secure-websocket.example.com",
      ];

      for (const urlString of protocols) {
        const result = parser.parse(urlString);
        assert.ok(result.success, `Should parse ${urlString}`);
        if (result.success) {
          assert.ok(result.value instanceof URL);
        }
      }
    });

    it("should reject invalid URLs", () => {
      const parser = url({});

      const invalidUrls = [
        "not-a-url",
        "://missing-protocol",
        "http://",
        "",
        "   ",
        "http:// invalid url",
        "http://[invalid-ipv6",
      ];

      for (const invalidUrl of invalidUrls) {
        const result = parser.parse(invalidUrl);
        assert.ok(!result.success, `Should reject ${invalidUrl}`);
        if (!result.success) {
          assert.equal(typeof result.error, "object");
        }
      }
    });
  });

  describe("protocol restrictions", () => {
    it("should allow only specified protocols", () => {
      const parser = url({ allowedProtocols: ["http:", "https:"] });

      const result1 = parser.parse("https://example.com");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value.protocol, "https:");
      }

      const result2 = parser.parse("http://example.com");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.protocol, "http:");
      }

      const result3 = parser.parse("ftp://example.com");
      assert.ok(!result3.success);
      if (!result3.success) {
        assert.equal(typeof result3.error, "object");
        if (isStructuredError(result3.error)) {
          assert.equal(result3.error.values.length, 2);
          assert.equal(result3.error.values[0], "ftp:");
          assert.equal(result3.error.values[1], "http:, https:");
        }
      }
    });

    it("should handle case insensitive protocol matching", () => {
      const parser = url({ allowedProtocols: ["HTTP:", "HTTPS:"] });

      const result1 = parser.parse("https://example.com");
      assert.ok(result1.success);

      const result2 = parser.parse("http://example.com");
      assert.ok(result2.success);

      const result3 = parser.parse("ftp://example.com");
      assert.ok(!result3.success);
    });

    it("should allow single protocol restriction", () => {
      const parser = url({ allowedProtocols: ["https:"] });

      const result1 = parser.parse("https://example.com");
      assert.ok(result1.success);

      const result2 = parser.parse("http://example.com");
      assert.ok(!result2.success);
    });

    it("should reject all protocols when empty protocol list is provided", () => {
      const parser = url({ allowedProtocols: [] });

      const result1 = parser.parse("https://example.com");
      assert.ok(!result1.success);

      const result2 = parser.parse("ftp://example.com");
      assert.ok(!result2.success);
    });
  });

  describe("URL object properties", () => {
    it("should provide access to URL components", () => {
      const parser = url({});
      const result = parser.parse(
        "https://user:pass@example.com:8080/path/to/resource?query=value&param=test#fragment",
      );

      assert.ok(result.success);
      if (result.success) {
        const url = result.value;
        assert.equal(url.protocol, "https:");
        assert.equal(url.hostname, "example.com");
        assert.equal(url.port, "8080");
        assert.equal(url.pathname, "/path/to/resource");
        assert.equal(url.search, "?query=value&param=test");
        assert.equal(url.hash, "#fragment");
        assert.equal(url.username, "user");
        assert.equal(url.password, "pass");
      }
    });

    it("should handle URLs without optional components", () => {
      const parser = url({});
      const result = parser.parse("https://example.com");

      assert.ok(result.success);
      if (result.success) {
        const url = result.value;
        assert.equal(url.protocol, "https:");
        assert.equal(url.hostname, "example.com");
        assert.equal(url.port, "");
        assert.equal(url.pathname, "/");
        assert.equal(url.search, "");
        assert.equal(url.hash, "");
        assert.equal(url.username, "");
        assert.equal(url.password, "");
      }
    });
  });

  describe("edge cases", () => {
    it("should handle IPv4 addresses", () => {
      const parser = url({});
      const result = parser.parse("http://192.168.1.1:8080/api");

      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.hostname, "192.168.1.1");
        assert.equal(result.value.port, "8080");
      }
    });

    it("should handle IPv6 addresses", () => {
      const parser = url({});
      const result = parser.parse("http://[2001:db8::1]:8080/api");

      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.hostname, "[2001:db8::1]");
        assert.equal(result.value.port, "8080");
      }
    });

    it("should handle URLs with encoded characters", () => {
      const parser = url({});
      const result = parser.parse(
        "https://example.com/path%20with%20spaces?query=hello%20world",
      );

      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.pathname, "/path%20with%20spaces");
        assert.equal(result.value.search, "?query=hello%20world");
      }
    });

    it("should handle file URLs", () => {
      const parser = url({});
      const result = parser.parse("file:///absolute/path/to/file.txt");

      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value.protocol, "file:");
        assert.equal(result.value.pathname, "/absolute/path/to/file.txt");
      }
    });

    it("should handle localhost variations", () => {
      const parser = url({});

      const localhosts = [
        "http://localhost",
        "http://127.0.0.1",
        "http://[::1]",
      ];

      for (const localhost of localhosts) {
        const result = parser.parse(localhost);
        assert.ok(result.success, `Should parse ${localhost}`);
      }
    });
  });

  describe("error messages", () => {
    it("should provide structured error messages for invalid URLs", () => {
      const parser = url({});
      const result = parser.parse("not-a-url");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (isStructuredError(result.error)) {
          assert.ok("message" in result.error);
          assert.ok("values" in result.error);
          assert.equal(result.error.values.length, 1);
          assert.equal(result.error.values[0], "not-a-url");
        }
      }
    });

    it("should provide structured error messages for protocol violations", () => {
      const parser = url({ allowedProtocols: ["https:"] });
      const result = parser.parse("http://example.com");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (isStructuredError(result.error)) {
          assert.ok("message" in result.error);
          assert.ok("values" in result.error);
          assert.equal(result.error.values.length, 2);
          assert.equal(result.error.values[0], "http:");
          assert.equal(result.error.values[1], "https:");
        }
      }
    });
  });

  describe("custom metavar", () => {
    it("should use custom metavar when provided", () => {
      const parser = url({ metavar: "ENDPOINT" });
      assert.equal(parser.metavar, "ENDPOINT");
    });

    it("should use default metavar when not provided", () => {
      const parser = url({});
      assert.equal(parser.metavar, "URL");
    });
  });
});

describe("locale", () => {
  describe("basic parsing", () => {
    it("should parse valid locale identifiers", () => {
      const parser = locale({});

      const result1 = parser.parse("en");
      assert.ok(result1.success);
      if (result1.success) {
        assert.ok(result1.value instanceof Intl.Locale);
        assert.equal(result1.value.language, "en");
        assert.equal(result1.value.region, undefined);
      }

      const result2 = parser.parse("en-US");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value.language, "en");
        assert.equal(result2.value.region, "US");
      }

      const result3 = parser.parse("zh-Hans-CN");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value.language, "zh");
        assert.equal(result3.value.script, "Hans");
        assert.equal(result3.value.region, "CN");
      }
    });

    it("should parse language-only locales", () => {
      const parser = locale({});

      const languages = [
        "en",
        "es",
        "fr",
        "de",
        "ja",
        "ko",
        "zh",
        "ar",
        "hi",
        "ru",
      ];

      for (const lang of languages) {
        const result = parser.parse(lang);
        assert.ok(result.success, `Should parse language ${lang}`);
        if (result.success) {
          assert.equal(result.value.language, lang);
        }
      }
    });

    it("should parse language-region locales", () => {
      const parser = locale({});

      const locales = [
        { input: "en-US", language: "en", region: "US" },
        { input: "en-GB", language: "en", region: "GB" },
        { input: "fr-FR", language: "fr", region: "FR" },
        { input: "de-DE", language: "de", region: "DE" },
        { input: "ja-JP", language: "ja", region: "JP" },
        { input: "ko-KR", language: "ko", region: "KR" },
        { input: "pt-BR", language: "pt", region: "BR" },
        { input: "es-ES", language: "es", region: "ES" },
        { input: "es-MX", language: "es", region: "MX" },
      ];

      for (const { input, language, region } of locales) {
        const result = parser.parse(input);
        assert.ok(result.success, `Should parse locale ${input}`);
        if (result.success) {
          assert.equal(result.value.language, language);
          assert.equal(result.value.region, region);
        }
      }
    });

    it("should parse locales with scripts", () => {
      const parser = locale({});

      const locales = [
        { input: "zh-Hans", language: "zh", script: "Hans" },
        { input: "zh-Hant", language: "zh", script: "Hant" },
        { input: "zh-Hans-CN", language: "zh", script: "Hans", region: "CN" },
        { input: "zh-Hant-TW", language: "zh", script: "Hant", region: "TW" },
        { input: "sr-Cyrl", language: "sr", script: "Cyrl" },
        { input: "sr-Latn", language: "sr", script: "Latn" },
      ];

      for (const { input, language, script, region } of locales) {
        const result = parser.parse(input);
        assert.ok(result.success, `Should parse locale ${input}`);
        if (result.success) {
          assert.equal(result.value.language, language);
          assert.equal(result.value.script, script);
          if (region) {
            assert.equal(result.value.region, region);
          }
        }
      }
    });

    it("should parse locales with Unicode extensions", () => {
      const parser = locale({});

      const locales = [
        "en-US-u-ca-gregory",
        "ja-JP-u-ca-japanese",
        "en-US-u-nu-arab",
        "de-DE-u-co-phonebk",
        "th-TH-u-nu-thai",
      ];

      for (const localeString of locales) {
        const result = parser.parse(localeString);
        assert.ok(
          result.success,
          `Should parse locale with extension ${localeString}`,
        );
        if (result.success) {
          assert.ok(result.value instanceof Intl.Locale);
        }
      }
    });

    it("should reject invalid locale identifiers", () => {
      const parser = locale({});

      const invalidLocales = [
        "",
        "   ",
        "toolongcode",
        "en-",
        "-US",
        "en--US",
        "x-private-only", // Private use only without language subtag
      ];

      for (const invalidLocale of invalidLocales) {
        const result = parser.parse(invalidLocale);
        assert.ok(
          !result.success,
          `Should reject invalid locale ${invalidLocale}`,
        );
        if (!result.success) {
          assert.equal(typeof result.error, "object");
        }
      }
    });
  });

  describe("locale object properties", () => {
    it("should provide access to locale components", () => {
      const parser = locale({});
      const result = parser.parse("zh-Hans-CN-u-ca-chinese-nu-hanidec");

      assert.ok(result.success);
      if (result.success) {
        const locale = result.value;
        assert.equal(locale.language, "zh");
        assert.equal(locale.script, "Hans");
        assert.equal(locale.region, "CN");
        assert.ok(locale.toString().includes("zh"));
      }
    });

    it("should handle minimal locale identifiers", () => {
      const parser = locale({});
      const result = parser.parse("en");

      assert.ok(result.success);
      if (result.success) {
        const locale = result.value;
        assert.equal(locale.language, "en");
        assert.equal(locale.script, undefined);
        assert.equal(locale.region, undefined);
      }
    });

    it("should normalize locale identifiers", () => {
      const parser = locale({});

      // Test case normalization
      const result1 = parser.parse("EN-us");
      assert.ok(result1.success);
      if (result1.success) {
        // Note: Intl.Locale normalizes case
        assert.equal(result1.value.language, "en");
        assert.equal(result1.value.region, "US");
      }
    });
  });

  describe("edge cases", () => {
    it("should handle private use subtags", () => {
      const parser = locale({});

      const privateUseCases = [
        "en-x-private",
        "en-US-x-private",
      ];

      for (const privateUse of privateUseCases) {
        const result = parser.parse(privateUse);
        assert.ok(
          result.success,
          `Should parse private use locale ${privateUse}`,
        );
        if (result.success) {
          assert.ok(result.value instanceof Intl.Locale);
        }
      }
    });

    it("should handle grandfathered locale tags", () => {
      const parser = locale({});

      const grandfatheredCases = [
        "i-default",
        "i-klingon",
        "art-lojban",
      ];

      for (const grandfathered of grandfatheredCases) {
        const result = parser.parse(grandfathered);
        // Some grandfathered tags may or may not be supported depending on implementation
        if (result.success) {
          assert.ok(result.value instanceof Intl.Locale);
        }
      }
    });

    it("should handle variant subtags", () => {
      const parser = locale({});

      const variantCases = [
        "de-DE-1996", // German orthography reform
        "sl-rozaj", // Resian dialect of Slovenian
        "de-CH-1901", // Traditional German orthography for Switzerland
      ];

      for (const variant of variantCases) {
        const result = parser.parse(variant);
        assert.ok(result.success, `Should parse variant locale ${variant}`);
        if (result.success) {
          assert.ok(result.value instanceof Intl.Locale);
        }
      }
    });

    it("should handle case variations", () => {
      const parser = locale({});

      const caseCombinations = [
        { input: "EN", expected: "en" },
        { input: "en-us", expected: "en-US" },
        { input: "ZH-HANS-CN", expected: "zh-Hans-CN" },
        { input: "De-De", expected: "de-DE" },
      ];

      for (const { input, expected } of caseCombinations) {
        const result = parser.parse(input);
        assert.ok(result.success, `Should parse case variation ${input}`);
        if (result.success) {
          // Check if the parsed locale matches expected normalization
          const normalized = result.value.toString();
          assert.ok(normalized.toLowerCase().includes(expected.toLowerCase()));
        }
      }
    });

    it("should handle locale options and keywords", () => {
      const parser = locale({});

      const localeOptions = [
        "en-US-u-ca-gregory-nu-latn",
        "ja-JP-u-ca-japanese-hc-h24",
        "ar-EG-u-nu-arab-ca-islamic",
        "de-DE-u-co-phonebk-kn-true",
      ];

      for (const option of localeOptions) {
        const result = parser.parse(option);
        assert.ok(result.success, `Should parse locale with options ${option}`);
        if (result.success) {
          assert.ok(result.value instanceof Intl.Locale);
          // Verify the locale string contains expected parts
          const localeString = result.value.toString();
          assert.ok(localeString.includes("-u-"));
        }
      }
    });
  });

  describe("error messages", () => {
    it("should provide structured error messages for invalid locales", () => {
      const parser = locale({});
      const result = parser.parse("x-private-only");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (isStructuredError(result.error)) {
          assert.ok("message" in result.error);
          assert.ok("values" in result.error);
          assert.equal(result.error.values.length, 1);
          assert.equal(result.error.values[0], "x-private-only");
        }
      }
    });

    it("should provide structured error messages for empty input", () => {
      const parser = locale({});
      const result = parser.parse("");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        if (isStructuredError(result.error)) {
          assert.ok("message" in result.error);
          assert.ok("values" in result.error);
          assert.equal(result.error.values.length, 1);
          assert.equal(result.error.values[0], "");
        }
      }
    });

    it("should provide structured error messages for malformed locales", () => {
      const parser = locale({});

      const malformedLocales = [
        "en-",
        "-US",
        "en--US",
        "toolongcode",
      ];

      for (const malformed of malformedLocales) {
        const result = parser.parse(malformed);
        assert.ok(
          !result.success,
          `Should reject malformed locale ${malformed}`,
        );
        if (!result.success) {
          assert.equal(typeof result.error, "object");
          if (isStructuredError(result.error)) {
            assert.ok("message" in result.error);
            assert.ok("values" in result.error);
            assert.equal(result.error.values.length, 1);
            assert.equal(result.error.values[0], malformed);
          }
        }
      }
    });
  });

  describe("custom metavar", () => {
    it("should use custom metavar when provided", () => {
      const parser = locale({ metavar: "LANG" });
      assert.equal(parser.metavar, "LANG");
    });

    it("should use default metavar when not provided", () => {
      const parser = locale({});
      assert.equal(parser.metavar, "LOCALE");
    });
  });

  describe("real-world locale examples", () => {
    it("should parse common locale identifiers", () => {
      const parser = locale({});

      const commonLocales = [
        // Major world languages
        "en-US",
        "en-GB",
        "en-CA",
        "en-AU",
        "es-ES",
        "es-MX",
        "es-AR",
        "fr-FR",
        "fr-CA",
        "de-DE",
        "de-AT",
        "de-CH",
        "it-IT",
        "pt-PT",
        "pt-BR",
        "ru-RU",
        "ja-JP",
        "ko-KR",
        "zh-CN",
        "zh-TW",
        "zh-HK",
        "ar-SA",
        "ar-EG",
        "hi-IN",
        "th-TH",
        "vi-VN",
        "tr-TR",
        "pl-PL",
        "nl-NL",
        "nl-BE",
        "sv-SE",
        "da-DK",
        "no-NO",
        "fi-FI",
      ];

      for (const localeId of commonLocales) {
        const result = parser.parse(localeId);
        assert.ok(result.success, `Should parse common locale ${localeId}`);
        if (result.success) {
          assert.ok(result.value instanceof Intl.Locale);
          assert.ok(result.value.language.length >= 2);
        }
      }
    });

    it("should parse complex real-world locales", () => {
      const parser = locale({});

      const complexLocales = [
        "zh-Hans-CN-u-ca-chinese-nu-hanidec",
        "ja-JP-u-ca-japanese-hc-h24-nu-jpan",
        "ar-SA-u-ca-islamic-nu-arab",
        "th-TH-u-ca-buddhist-nu-thai",
        "he-IL-u-ca-hebrew-nu-hebr",
        "fa-IR-u-ca-persian-nu-arabext",
        "en-US-u-ca-gregory-hc-h12-nu-latn-tz-usnyc",
      ];

      for (const complex of complexLocales) {
        const result = parser.parse(complex);
        assert.ok(result.success, `Should parse complex locale ${complex}`);
        if (result.success) {
          assert.ok(result.value instanceof Intl.Locale);
          // Verify Unicode extensions are preserved
          const localeString = result.value.toString();
          if (complex.includes("-u-")) {
            assert.ok(localeString.includes("-u-"));
          }
        }
      }
    });
  });
});
