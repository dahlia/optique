import {
  choice,
  domain,
  email,
  float,
  hostname,
  integer,
  ipv4,
  ipv6,
  isValueParser,
  locale,
  macAddress,
  type NonEmptyString,
  port,
  portRange,
  socketAddress,
  string,
  url,
  uuid,
} from "@optique/core/valueparser";
import { message, text, values } from "@optique/core/message";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("isValueParser", () => {
  it("should return true for valid ValueParser objects", () => {
    const parser = integer({});
    assert.ok(isValueParser(parser));
  });

  it("should return true for different types of value parsers", () => {
    const stringParser = {
      $mode: "sync" as const,
      metavar: "STRING",
      parse: () => ({ success: true as const, value: "test" }),
      format: (v: string) => v,
    };
    const numberParser = {
      $mode: "sync" as const,
      metavar: "NUMBER",
      parse: () => ({ success: true as const, value: 42 }),
      format: (v: number) => v.toString(),
    };

    assert.ok(isValueParser(stringParser));
    assert.ok(isValueParser(numberParser));
  });

  it("should return false for objects missing metavar property", () => {
    const invalidParser = {
      parse: () => ({ success: true, value: "test" }),
      format: (v: string) => v,
    };
    assert.ok(!isValueParser(invalidParser));
  });

  it("should return false for objects missing parse property", () => {
    const invalidParser = { metavar: "STRING", format: (v: string) => v };
    assert.ok(!isValueParser(invalidParser));
  });

  it("should return false for objects missing format property", () => {
    const invalidParser = {
      metavar: "STRING",
      parse: () => ({ success: true, value: "test" }),
    };
    assert.ok(!isValueParser(invalidParser));
  });

  it("should return false for objects with wrong property types", () => {
    const invalidParser1 = {
      metavar: 123,
      parse: () => ({ success: true, value: "test" }),
      format: (v: string) => v,
    };
    const invalidParser2 = {
      metavar: "STRING",
      parse: "not-a-function",
      format: (v: string) => v,
    };
    const invalidParser3 = {
      metavar: "STRING",
      parse: () => ({ success: true, value: "test" }),
      format: "not-a-function",
    };

    assert.ok(!isValueParser(invalidParser1));
    assert.ok(!isValueParser(invalidParser2));
    assert.ok(!isValueParser(invalidParser3));
  });

  it("should return false for primitive values", () => {
    assert.ok(!isValueParser(null));
    assert.ok(!isValueParser(undefined));
    assert.ok(!isValueParser("string"));
    assert.ok(!isValueParser(42));
    assert.ok(!isValueParser(true));
    assert.ok(!isValueParser([]));
  });

  it("should return false for empty objects", () => {
    assert.ok(!isValueParser({}));
  });

  it("should work with built-in value parsers", () => {
    const integerParser = integer({});
    const choiceParser = choice(["a", "b"]);
    const floatParser = float({});
    const urlParser = url({});
    const localeParser = locale({});
    const uuidParser = uuid({});

    assert.ok(isValueParser(integerParser));
    assert.ok(isValueParser(choiceParser));
    assert.ok(isValueParser(floatParser));
    assert.ok(isValueParser(urlParser));
    assert.ok(isValueParser(localeParser));
    assert.ok(isValueParser(uuidParser));
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

      const result3 = parser.parse("42.0");
      assert.ok(!result3.success);

      const result4 = parser.parse("1e5");
      assert.ok(!result4.success);

      const result5 = parser.parse("");
      assert.ok(!result5.success);

      const result6 = parser.parse("  42  ");
      assert.ok(!result6.success);
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
      const parser = integer({ min: 1, max: 0xffff });

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
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected a valid integer, but got " },
            { type: "value", value: "invalid" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for min constraint violation", () => {
      const parser = integer({ min: 10 });
      const result = parser.parse("5");

      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            {
              type: "text",
              text: "Expected a value greater than or equal to ",
            },
            { type: "text", text: "10" },
            { type: "text", text: ", but got " },
            { type: "value", value: "5" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for max constraint violation", () => {
      const parser = integer({ max: 100 });
      const result = parser.parse("150");

      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected a value less than or equal to " },
            { type: "text", text: "100" },
            { type: "text", text: ", but got " },
            { type: "value", value: "150" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for BigInt invalid input", () => {
      const parser = integer({ type: "bigint" });
      const result = parser.parse("invalid");

      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected a valid integer, but got " },
            { type: "value", value: "invalid" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for BigInt constraint violations", () => {
      const parser = integer({ type: "bigint", min: 0n, max: 100n });

      const result1 = parser.parse("-5");
      assert.ok(!result1.success);
      if (!result1.success) {
        assert.deepEqual(
          result1.error,
          [
            {
              type: "text",
              text: "Expected a value greater than or equal to ",
            },
            { type: "text", text: "0" },
            { type: "text", text: ", but got " },
            { type: "value", value: "-5" },
            { type: "text", text: "." },
          ] as const,
        );
      }

      const result2 = parser.parse("150");
      assert.ok(!result2.success);
      if (!result2.success) {
        assert.deepEqual(
          result2.error,
          [
            { type: "text", text: "Expected a value less than or equal to " },
            { type: "text", text: "100" },
            { type: "text", text: ", but got " },
            { type: "value", value: "150" },
            { type: "text", text: "." },
          ] as const,
        );
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
        assert.deepEqual(
          result1.error,
          [
            { type: "text", text: "Expected one of " },
            { type: "value", value: "yes" },
            { type: "text", text: " and " },
            { type: "value", value: "no" },
            { type: "text", text: ", but got " },
            { type: "value", value: "maybe" },
            { type: "text", text: "." },
          ] as const,
        );
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
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected one of " },
            { type: "value", value: "alpha" },
            { type: "text", text: ", " },
            { type: "value", value: "beta" },
            { type: "text", text: ", and " },
            { type: "value", value: "gamma" },
            { type: "text", text: ", but got " },
            { type: "value", value: "delta" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages with single choice", () => {
      const parser = choice(["only"]);
      const result = parser.parse("other");

      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected one of " },
            { type: "value", value: "only" },
            { type: "text", text: ", but got " },
            { type: "value", value: "other" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for empty choice list", () => {
      const parser = choice([]);
      const result = parser.parse("anything");

      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected one of " },
            { type: "text", text: ", but got " },
            { type: "value", value: "anything" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for case insensitive parser", () => {
      const parser = choice(["YES", "NO"], { caseInsensitive: true });
      const result = parser.parse("maybe");

      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected one of " },
            { type: "value", value: "YES" },
            { type: "text", text: " and " },
            { type: "value", value: "NO" },
            { type: "text", text: ", but got " },
            { type: "value", value: "maybe" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should show original choices in error message, not normalized ones", () => {
      const parser = choice(["High", "Medium", "Low"], {
        caseInsensitive: true,
      });
      const result = parser.parse("none");

      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected one of " },
            { type: "value", value: "High" },
            { type: "text", text: ", " },
            { type: "value", value: "Medium" },
            { type: "text", text: ", and " },
            { type: "value", value: "Low" },
            { type: "text", text: ", but got " },
            { type: "value", value: "none" },
            { type: "text", text: "." },
          ] as const,
        );
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

  describe("number choices", () => {
    it("should parse valid number values from the choice list", () => {
      const parser = choice([8, 10, 12]);

      const result1 = parser.parse("8");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 8);
        assert.equal(typeof result1.value, "number");
      }

      const result2 = parser.parse("10");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 10);
      }

      const result3 = parser.parse("12");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, 12);
      }
    });

    it("should reject values not in the number choice list", () => {
      const parser = choice([8, 10]);

      const result1 = parser.parse("9");
      assert.ok(!result1.success);
      if (!result1.success) {
        assert.deepEqual(
          result1.error,
          [
            { type: "text", text: "Expected one of " },
            { type: "value", value: "8" },
            { type: "text", text: " and " },
            { type: "value", value: "10" },
            { type: "text", text: ", but got " },
            { type: "value", value: "9" },
            { type: "text", text: "." },
          ] as const,
        );
      }

      const result2 = parser.parse("abc");
      assert.ok(!result2.success);

      const result3 = parser.parse("");
      assert.ok(!result3.success);

      // Note: "8.0" parses to 8, which is in the choice list
      const result4 = parser.parse("8.0");
      assert.ok(result4.success);
      if (result4.success) {
        assert.equal(result4.value, 8);
      }
    });

    it("should work with single number choice", () => {
      const parser = choice([42]);

      const result1 = parser.parse("42");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 42);
      }

      const result2 = parser.parse("43");
      assert.ok(!result2.success);
    });

    it("should work with negative number choices", () => {
      const parser = choice([-1, 0, 1]);

      const result1 = parser.parse("-1");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, -1);
      }

      const result2 = parser.parse("0");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 0);
      }

      const result3 = parser.parse("1");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, 1);
      }

      const result4 = parser.parse("-2");
      assert.ok(!result4.success);
    });

    it("should work with floating point number choices", () => {
      const parser = choice([0.5, 1.0, 1.5]);

      const result1 = parser.parse("0.5");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 0.5);
      }

      const result2 = parser.parse("1");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 1.0);
      }

      const result3 = parser.parse("1.5");
      assert.ok(result3.success);

      const result4 = parser.parse("2.0");
      assert.ok(!result4.success);
    });

    it("should use custom metavar for number choices", () => {
      const parser = choice([8, 10, 12], { metavar: "BIT_DEPTH" });
      assert.equal(parser.metavar, "BIT_DEPTH");
    });

    it("should use default metavar when not provided for number choices", () => {
      const parser = choice([1, 2, 3]);
      assert.equal(parser.metavar, "TYPE");
    });

    it("should format number values back to strings", () => {
      const parser = choice([8, 10, 12]);
      assert.equal(parser.format(8), "8");
      assert.equal(parser.format(10), "10");
      assert.equal(parser.format(12), "12");
    });

    it("should provide suggestions for number choices", () => {
      const parser = choice([8, 10, 12]);

      // All suggestions when prefix is empty
      const allSuggestions = [...parser.suggest!("")];
      assert.deepEqual(allSuggestions, [
        { kind: "literal", text: "8" },
        { kind: "literal", text: "10" },
        { kind: "literal", text: "12" },
      ]);

      // Filtered suggestions
      const filteredSuggestions = [...parser.suggest!("1")];
      assert.deepEqual(filteredSuggestions, [
        { kind: "literal", text: "10" },
        { kind: "literal", text: "12" },
      ]);

      // No matches
      const noMatches = [...parser.suggest!("9")];
      assert.deepEqual(noMatches, []);
    });

    it("should maintain type safety with const assertion for numbers", () => {
      const bitDepths = [8, 10, 12] as const;
      const parser = choice(bitDepths);

      const result = parser.parse("8");
      assert.ok(result.success);
      if (result.success) {
        // The type should be 8 | 10 | 12
        assert.equal(result.value, 8);
        assert.ok([8, 10, 12].includes(result.value));
      }
    });

    it("should handle custom error messages for number choices", () => {
      const parser = choice([8, 10], {
        errors: {
          invalidChoice: (
            input,
            _choices,
          ) => [{ type: "text", text: `Invalid bit depth: ${input}` }],
        },
      });

      const result = parser.parse("9");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(result.error, [
          { type: "text", text: "Invalid bit depth: 9" },
        ]);
      }
    });

    it("should work with empty number choice list", () => {
      const parser = choice([] as number[]);

      const result = parser.parse("1");
      assert.ok(!result.success);
    });

    it("should handle duplicate number values", () => {
      const parser = choice([1, 1, 2]);

      const result1 = parser.parse("1");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 1);
      }

      const result2 = parser.parse("2");
      assert.ok(result2.success);
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
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected a valid number, but got " },
            { type: "value", value: "invalid" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for min constraint violation", () => {
      const parser = float({ min: 0 });
      const result = parser.parse("-5.5");

      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            {
              type: "text",
              text: "Expected a value greater than or equal to ",
            },
            { type: "text", text: "0" },
            { type: "text", text: ", but got " },
            { type: "value", value: "-5.5" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for max constraint violation", () => {
      const parser = float({ max: 100 });
      const result = parser.parse("150.5");

      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected a value less than or equal to " },
            { type: "text", text: "100" },
            { type: "text", text: ", but got " },
            { type: "value", value: "150.5" },
            { type: "text", text: "." },
          ] as const,
        );
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
        assert.deepEqual(
          result3.error,
          [
            { type: "text", text: "URL protocol " },
            { type: "value", value: "ftp:" },
            { type: "text", text: " is not allowed. Allowed protocols: " },
            { type: "value", value: "http:, https:" },
            { type: "text", text: "." },
          ] as const,
        );
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
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Invalid URL: " },
            { type: "value", value: "not-a-url" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for protocol violations", () => {
      const parser = url({ allowedProtocols: ["https:"] });
      const result = parser.parse("http://example.com");

      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "URL protocol " },
            { type: "value", value: "http:" },
            { type: "text", text: " is not allowed. Allowed protocols: " },
            { type: "value", value: "https:" },
            { type: "text", text: "." },
          ] as const,
        );
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
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Invalid locale: " },
            { type: "value", value: "x-private-only" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for empty input", () => {
      const parser = locale({});
      const result = parser.parse("");

      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(typeof result.error, "object");
        // Note: empty string might not show up in formatted error, so we just check the error exists
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
          assert.deepEqual(
            result.error,
            [
              { type: "text", text: "Invalid locale: " },
              { type: "value", value: malformed },
              { type: "text", text: "." },
            ] as const,
          );
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

describe("uuid", () => {
  describe("basic parsing", () => {
    it("should parse valid UUID strings", () => {
      const parser = uuid({});

      const result1 = parser.parse("550e8400-e29b-41d4-a716-446655440000");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "550e8400-e29b-41d4-a716-446655440000");
        assert.equal(typeof result1.value, "string");
      }

      const result2 = parser.parse("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "6ba7b810-9dad-11d1-80b4-00c04fd430c8");
      }

      const result3 = parser.parse("6ba7b811-9dad-11d1-80b4-00c04fd430c8");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, "6ba7b811-9dad-11d1-80b4-00c04fd430c8");
      }
    });

    it("should parse UUIDs with uppercase letters", () => {
      const parser = uuid({});

      const result1 = parser.parse("550E8400-E29B-41D4-A716-446655440000");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "550E8400-E29B-41D4-A716-446655440000");
      }

      const result2 = parser.parse("6BA7B810-9DAD-11D1-80B4-00C04FD430C8");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "6BA7B810-9DAD-11D1-80B4-00C04FD430C8");
      }
    });

    it("should parse UUIDs with mixed case", () => {
      const parser = uuid({});

      const result = parser.parse("550e8400-E29B-41d4-A716-446655440000");
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "550e8400-E29B-41d4-A716-446655440000");
      }
    });

    it("should reject invalid UUID strings", () => {
      const parser = uuid({});

      const invalidUuids = [
        "not-a-uuid",
        "550e8400-e29b-41d4-a716", // too short
        "550e8400-e29b-41d4-a716-446655440000-extra", // too long
        "550e8400-e29b-41d4-a716-44665544000g", // invalid character 'g'
        "550e8400e29b41d4a716446655440000", // missing dashes
        "550e8400-e29b-41d4-a716-4466554400000", // extra character
        "", // empty string
        "   ", // whitespace only
        "550e8400-e29b-41d4-a716-44665544000", // one character short
        "550e8400-e29b-41d4-a71-446655440000", // wrong segment length
      ];

      for (const invalidUuid of invalidUuids) {
        const result = parser.parse(invalidUuid);
        assert.ok(
          !result.success,
          `Should reject invalid UUID: ${invalidUuid}`,
        );
        if (!result.success) {
          assert.equal(typeof result.error, "object");
        }
      }
    });

    it("should reject UUIDs with wrong format", () => {
      const parser = uuid({});

      const wrongFormats = [
        "550e8400_e29b_41d4_a716_446655440000", // underscores instead of dashes
        "550e8400:e29b:41d4:a716:446655440000", // colons instead of dashes
        "{550e8400-e29b-41d4-a716-446655440000}", // wrapped in braces
        "(550e8400-e29b-41d4-a716-446655440000)", // wrapped in parentheses
        "550e8400-e29b-41d4-a716-446655440000 ", // trailing space
        " 550e8400-e29b-41d4-a716-446655440000", // leading space
      ];

      for (const wrongFormat of wrongFormats) {
        const result = parser.parse(wrongFormat);
        assert.ok(
          !result.success,
          `Should reject wrong format: ${wrongFormat}`,
        );
        if (!result.success) {
          assert.equal(typeof result.error, "object");
        }
      }
    });
  });

  describe("version validation", () => {
    it("should allow specific versions when specified", () => {
      const parser = uuid({ allowedVersions: [4] });

      // UUID v4 (random)
      const result1 = parser.parse("550e8400-e29b-41d4-a716-446655440000");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "550e8400-e29b-41d4-a716-446655440000");
      }

      const result2 = parser.parse("f47ac10b-58cc-4372-a567-0e02b2c3d479");
      assert.ok(result2.success);
    });

    it("should reject versions not in allowed list", () => {
      const parser = uuid({ allowedVersions: [4] });

      // UUID v1 (time-based)
      const result1 = parser.parse("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
      assert.ok(!result1.success);
      if (!result1.success) {
        assert.deepEqual(
          result1.error,
          [
            { type: "text", text: "Expected UUID version " },
            { type: "value", value: "4" },
            { type: "text", text: ", but got version " },
            { type: "value", value: "1" },
            { type: "text", text: "." },
          ] as const,
        );
      }

      // UUID v5 (name-based with SHA-1)
      const result2 = parser.parse("6ba7b815-9dad-51d1-80b4-00c04fd430c8");
      assert.ok(!result2.success);
      if (!result2.success) {
        assert.deepEqual(
          result2.error,
          [
            { type: "text", text: "Expected UUID version " },
            { type: "value", value: "4" },
            { type: "text", text: ", but got version " },
            { type: "value", value: "5" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should allow multiple versions", () => {
      const parser = uuid({ allowedVersions: [1, 4, 5] });

      // UUID v1
      const result1 = parser.parse("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
      assert.ok(result1.success);

      // UUID v4
      const result2 = parser.parse("550e8400-e29b-41d4-a716-446655440000");
      assert.ok(result2.success);

      // UUID v5
      const result3 = parser.parse("6ba7b815-9dad-51d1-80b4-00c04fd430c8");
      assert.ok(result3.success);

      // UUID v3 should be rejected
      const result4 = parser.parse("6ba7b813-9dad-31d1-80b4-00c04fd430c8");
      assert.ok(!result4.success);
      if (!result4.success) {
        assert.deepEqual(
          result4.error,
          [
            { type: "text", text: "Expected UUID version " },
            { type: "value", value: "1" },
            { type: "text", text: ", " },
            { type: "value", value: "4" },
            { type: "text", text: ", or " },
            { type: "value", value: "5" },
            { type: "text", text: ", but got version " },
            { type: "value", value: "3" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should accept any version when allowedVersions is not specified", () => {
      const parser = uuid({});

      const versions = [
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8", // v1
        "6ba7b812-9dad-21d1-80b4-00c04fd430c8", // v2
        "6ba7b813-9dad-31d1-80b4-00c04fd430c8", // v3
        "6ba7b814-9dad-41d1-80b4-00c04fd430c8", // v4
        "6ba7b815-9dad-51d1-80b4-00c04fd430c8", // v5
      ];

      for (const uuid of versions) {
        const result = parser.parse(uuid);
        assert.ok(result.success, `Should accept any version: ${uuid}`);
      }
    });

    it("should accept any version when allowedVersions is empty", () => {
      const parser = uuid({ allowedVersions: [] });

      const result = parser.parse("6ba7b814-9dad-11d1-80b4-00c04fd430c8");
      assert.ok(result.success);
    });
  });

  describe("real-world UUID examples", () => {
    it("should parse common UUID formats", () => {
      const parser = uuid({});

      const realWorldUuids = [
        "00000000-0000-0000-0000-000000000000", // nil UUID
        "550e8400-e29b-41d4-a716-446655440000", // example UUID
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8", // namespace DNS
        "6ba7b811-9dad-11d1-80b4-00c04fd430c8", // namespace URL
        "6ba7b812-9dad-11d1-80b4-00c04fd430c8", // namespace OID
        "6ba7b814-9dad-11d1-80b4-00c04fd430c8", // namespace X.500
        "f47ac10b-58cc-4372-a567-0e02b2c3d479", // random v4
        "886313e1-3b8a-5372-9b90-0c9aee199e5d", // v5 example
      ];

      for (const uuid of realWorldUuids) {
        const result = parser.parse(uuid);
        assert.ok(result.success, `Should parse real-world UUID: ${uuid}`);
        if (result.success) {
          assert.equal(result.value, uuid);
        }
      }
    });

    it("should handle database-generated UUIDs", () => {
      const parser = uuid({});

      // Simulate UUIDs that might come from different databases/systems
      const dbUuids = [
        "01234567-89ab-cdef-0123-456789abcdef", // all hex digits
        "fedcba98-7654-3210-fedc-ba9876543210", // reverse pattern
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", // repeating patterns
        "12345678-1234-1234-1234-123456789012", // repeating sequences
      ];

      for (const uuid of dbUuids) {
        const result = parser.parse(uuid);
        assert.ok(result.success, `Should parse database UUID: ${uuid}`);
      }
    });
  });

  describe("error messages", () => {
    it("should provide structured error messages for invalid format", () => {
      const parser = uuid({});
      const result = parser.parse("not-a-uuid");

      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected a valid UUID in format " },
            { type: "value", value: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" },
            { type: "text", text: ", but got " },
            { type: "value", value: "not-a-uuid" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for version mismatch", () => {
      const parser = uuid({ allowedVersions: [4] });
      const result = parser.parse("6ba7b815-9dad-51d1-80b4-00c04fd430c8"); // v5

      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected UUID version " },
            { type: "value", value: "4" },
            { type: "text", text: ", but got version " },
            { type: "value", value: "5" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for multiple version requirements", () => {
      const parser = uuid({ allowedVersions: [1, 4] });
      const result = parser.parse("6ba7b815-9dad-51d1-80b4-00c04fd430c8"); // v5

      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected UUID version " },
            { type: "value", value: "1" },
            { type: "text", text: ", or " },
            { type: "value", value: "4" },
            { type: "text", text: ", but got version " },
            { type: "value", value: "5" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });
  });

  describe("custom metavar", () => {
    it("should use custom metavar when provided", () => {
      const parser = uuid({ metavar: "ID" });
      assert.equal(parser.metavar, "ID");
    });

    it("should use default metavar when not provided", () => {
      const parser = uuid({});
      assert.equal(parser.metavar, "UUID");
    });

    it("should use custom metavar with version restrictions", () => {
      const parser = uuid({ metavar: "IDENTIFIER", allowedVersions: [4] });
      assert.equal(parser.metavar, "IDENTIFIER");
    });
  });

  describe("edge cases", () => {
    it("should handle nil UUID", () => {
      const parser = uuid({});
      const result = parser.parse("00000000-0000-0000-0000-000000000000");

      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "00000000-0000-0000-0000-000000000000");
      }
    });

    it("should handle all uppercase UUID", () => {
      const parser = uuid({});
      const result = parser.parse("550E8400-E29B-41D4-A716-446655440000");

      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "550E8400-E29B-41D4-A716-446655440000");
      }
    });

    it("should handle version 0 (invalid but format-correct)", () => {
      const parser = uuid({});
      const result = parser.parse("6ba7b800-9dad-01d1-80b4-00c04fd430c8"); // v0

      assert.ok(result.success); // Format is correct, even if version is unusual
    });

    it("should handle version validation edge cases", () => {
      const parser = uuid({ allowedVersions: [0, 15] }); // Edge versions

      const result1 = parser.parse("6ba7b800-9dad-01d1-80b4-00c04fd430c8"); // v0
      assert.ok(result1.success);

      const result2 = parser.parse("6ba7b8f0-9dad-f1d1-80b4-00c04fd430c8"); // v15 (f in hex)
      assert.ok(result2.success);

      const result3 = parser.parse("6ba7b810-9dad-11d1-80b4-00c04fd430c8"); // v1
      assert.ok(!result3.success);
    });
  });
});

describe("error customization", () => {
  describe("string parser", () => {
    it("should use custom patternMismatch error message", () => {
      const parser = string({
        pattern: /^\d+$/,
        errors: {
          patternMismatch: message`Custom error: input must be numeric.`,
        },
      });

      const result = parser.parse("abc");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Custom error: input must be numeric." },
      ]);
    });

    it("should use function-based patternMismatch error message", () => {
      const parser = string({
        pattern: /^\d+$/,
        errors: {
          patternMismatch: (input, pattern) =>
            message`Value ${input} does not match pattern ${
              text(pattern.source)
            }.`,
        },
      });

      const result = parser.parse("abc");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Value " },
        { type: "value", value: "abc" },
        { type: "text", text: " does not match pattern " },
        { type: "text", text: "^\\d+$" },
        { type: "text", text: "." },
      ]);
    });
  });

  describe("choice parser", () => {
    it("should use custom invalidChoice error message", () => {
      const parser = choice(["red", "green", "blue"], {
        errors: {
          invalidChoice: message`Please select a valid color.`,
        },
      });

      const result = parser.parse("yellow");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Please select a valid color." },
      ]);
    });

    it("should use function-based invalidChoice error message", () => {
      const parser = choice(["red", "green", "blue"], {
        errors: {
          invalidChoice: (input, choices) =>
            message`${input} is not valid. Choose from: ${values(choices)}.`,
        },
      });

      const result = parser.parse("yellow");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "value", value: "yellow" },
        { type: "text", text: " is not valid. Choose from: " },
        { type: "values", values: ["red", "green", "blue"] },
        { type: "text", text: "." },
      ]);
    });
  });

  describe("integer parser", () => {
    it("should use custom invalidInteger error message", () => {
      const parser = integer({
        errors: {
          invalidInteger: message`Must be a whole number.`,
        },
      });

      const result = parser.parse("abc");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Must be a whole number." },
      ]);
    });

    it("should use custom belowMinimum error message", () => {
      const parser = integer({
        min: 10,
        errors: {
          belowMinimum: (value, min) =>
            message`Value ${text(value.toString())} is too small (minimum: ${
              text(min.toString())
            }).`,
        },
      });

      const result = parser.parse("5");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Value " },
        { type: "text", text: "5" },
        { type: "text", text: " is too small (minimum: " },
        { type: "text", text: "10" },
        { type: "text", text: ")." },
      ]);
    });

    it("should use custom aboveMaximum error message", () => {
      const parser = integer({
        max: 100,
        errors: {
          aboveMaximum: (value, max) =>
            message`Value ${text(value.toString())} exceeds maximum of ${
              text(max.toString())
            }.`,
        },
      });

      const result = parser.parse("150");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Value " },
        { type: "text", text: "150" },
        { type: "text", text: " exceeds maximum of " },
        { type: "text", text: "100" },
        { type: "text", text: "." },
      ]);
    });
  });

  describe("float parser", () => {
    it("should use custom invalidNumber error message", () => {
      const parser = float({
        errors: {
          invalidNumber: message`Please enter a valid decimal number.`,
        },
      });

      const result = parser.parse("not-a-number");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Please enter a valid decimal number." },
      ]);
    });

    it("should use custom belowMinimum error message", () => {
      const parser = float({
        min: 0.5,
        errors: {
          belowMinimum: (value, min) =>
            message`${
              text(value.toString())
            } is below the minimum threshold of ${text(min.toString())}.`,
        },
      });

      const result = parser.parse("0.1");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "0.1" },
        { type: "text", text: " is below the minimum threshold of " },
        { type: "text", text: "0.5" },
        { type: "text", text: "." },
      ]);
    });

    it("should use custom aboveMaximum error message", () => {
      const parser = float({
        max: 10.0,
        errors: {
          aboveMaximum: (value, max) =>
            message`${text(value.toString())} exceeds the maximum limit of ${
              text(max.toString())
            }.`,
        },
      });

      const result = parser.parse("15.5");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "15.5" },
        { type: "text", text: " exceeds the maximum limit of " },
        { type: "text", text: "10" },
        { type: "text", text: "." },
      ]);
    });
  });

  describe("url parser", () => {
    it("should use custom invalidUrl error message", () => {
      const parser = url({
        errors: {
          invalidUrl: message`Please provide a valid web address.`,
        },
      });

      const result = parser.parse("not-a-url");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Please provide a valid web address." },
      ]);
    });

    it("should use custom disallowedProtocol error message", () => {
      const parser = url({
        allowedProtocols: ["https:"],
        errors: {
          disallowedProtocol: (protocol, allowedProtocols) =>
            message`Protocol ${protocol} not allowed. Use: ${
              values(allowedProtocols)
            }.`,
        },
      });

      const result = parser.parse("http://example.com");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Protocol " },
        { type: "value", value: "http:" },
        { type: "text", text: " not allowed. Use: " },
        { type: "values", values: ["https:"] },
        { type: "text", text: "." },
      ]);
    });
  });

  describe("locale parser", () => {
    it("should use custom invalidLocale error message", () => {
      const parser = locale({
        errors: {
          invalidLocale: message`Please use a valid language code.`,
        },
      });

      const result = parser.parse("xyz-INVALID-123");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Please use a valid language code." },
      ]);
    });

    it("should use function-based invalidLocale error message", () => {
      const parser = locale({
        errors: {
          invalidLocale: (input) =>
            message`${input} is not a recognized locale identifier.`,
        },
      });

      const result = parser.parse("xyz-INVALID-123");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "value", value: "xyz-INVALID-123" },
        { type: "text", text: " is not a recognized locale identifier." },
      ]);
    });
  });

  describe("uuid parser", () => {
    it("should use custom invalidUuid error message", () => {
      const parser = uuid({
        errors: {
          invalidUuid: message`Please provide a valid UUID string.`,
        },
      });

      const result = parser.parse("not-a-uuid");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Please provide a valid UUID string." },
      ]);
    });

    it("should use custom disallowedVersion error message", () => {
      const parser = uuid({
        allowedVersions: [4],
        errors: {
          disallowedVersion: (version, allowedVersions) =>
            message`UUID version ${
              text(version.toString())
            } not supported. Need version ${
              values(allowedVersions.map((v) => v.toString()))
            }.`,
        },
      });

      const result = parser.parse("6ba7b810-9dad-11d1-80b4-00c04fd430c8"); // v1
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "UUID version " },
        { type: "text", text: "1" },
        { type: "text", text: " not supported. Need version " },
        { type: "values", values: ["4"] },
        { type: "text", text: "." },
      ]);
    });
  });

  describe("error fallback behavior", () => {
    it("should fall back to default error when custom error is not provided", () => {
      const parser = integer({
        min: 10,
        errors: {
          invalidInteger: message`Custom invalid message.`,
          // belowMinimum is not customized, should use default
        },
      });

      const result1 = parser.parse("abc");
      assert.ok(!result1.success);
      assert.deepEqual(result1.error, [
        { type: "text", text: "Custom invalid message." },
      ]);

      const result2 = parser.parse("5");
      assert.ok(!result2.success);
      // Should use default error message for belowMinimum
      assert.ok(
        result2.error.some((term) =>
          term.type === "text" &&
          term.text.includes("Expected a value greater than or equal to")
        ),
      );
    });

    it("should work correctly when no errors option is provided", () => {
      const parser = integer({ min: 10 });

      const result = parser.parse("5");
      assert.ok(!result.success);
      // Should use default error message
      assert.ok(
        result.error.some((term) =>
          term.type === "text" &&
          term.text.includes("Expected a value greater than or equal to")
        ),
      );
    });
  });
});

describe("ValueParser suggest() methods", () => {
  describe("url parser", () => {
    it("should suggest protocol completions when allowedProtocols is set", () => {
      const parser = url({
        allowedProtocols: ["https:", "http:", "ftp:"],
      });

      const suggestions = Array.from(parser.suggest!("ht"));
      const texts = suggestions.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      ).sort();

      assert.deepEqual(texts, ["http://", "https://"]);
    });

    it("should suggest all protocols for single character prefix", () => {
      const parser = url({
        allowedProtocols: ["https:", "http:", "ftp:"],
      });

      const suggestions = Array.from(parser.suggest!("h"));
      const texts = suggestions.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      ).sort();

      assert.deepEqual(texts, ["http://", "https://"]);
    });

    it("should not suggest protocols when input contains ://", () => {
      const parser = url({
        allowedProtocols: ["https:", "http:", "ftp:"],
      });

      const suggestions = Array.from(parser.suggest!("https://example"));
      assert.equal(suggestions.length, 0);
    });

    it("should not suggest when no allowedProtocols is set", () => {
      const parser = url();

      const suggestions = Array.from(parser.suggest!("ht"));
      assert.equal(suggestions.length, 0);
    });

    it("should handle case insensitive matching", () => {
      const parser = url({
        allowedProtocols: ["HTTPS:", "HTTP:"],
      });

      const suggestions = Array.from(parser.suggest!("ht"));
      const texts = suggestions.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      ).sort();

      assert.deepEqual(texts, ["http://", "https://"]);
    });
  });

  describe("locale parser", () => {
    it("should suggest common locales with matching prefix", () => {
      const parser = locale();

      const suggestions = Array.from(parser.suggest!("en"));
      const texts = suggestions.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      );

      assert.ok(texts.includes("en"));
      assert.ok(texts.includes("en-US"));
      assert.ok(texts.includes("en-GB"));
      assert.ok(!texts.includes("fr"));
    });

    it("should suggest multiple language families", () => {
      const parser = locale();

      const suggestions = Array.from(parser.suggest!("de"));
      const texts = suggestions.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      );

      assert.ok(texts.includes("de"));
      assert.ok(texts.includes("de-DE"));
      assert.ok(texts.includes("de-AT"));
    });

    it("should handle case insensitive matching", () => {
      const parser = locale();

      const suggestions = Array.from(parser.suggest!("EN"));
      const texts = suggestions.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      );

      assert.ok(texts.length > 0);
      assert.ok(texts.includes("en"));
    });

    it("should return empty for non-matching prefix", () => {
      const parser = locale();

      const suggestions = Array.from(parser.suggest!("xyz"));
      assert.equal(suggestions.length, 0);
    });
  });
});

describe("string", () => {
  describe("basic parsing", () => {
    it("should parse any string without options", () => {
      const parser = string();

      const result1 = parser.parse("hello");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "hello");
      }

      const result2 = parser.parse("123");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "123");
      }
    });

    it("should parse empty string", () => {
      const parser = string();

      const result = parser.parse("");
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "");
      }
    });

    it("should parse strings with unicode characters", () => {
      const parser = string();

      const result1 = parser.parse("hello 세계");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "hello 세계");
      }

      const result2 = parser.parse("日本語");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "日本語");
      }

      const result3 = parser.parse("émojis: 🎉🚀");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, "émojis: 🎉🚀");
      }
    });

    it("should parse strings with special characters", () => {
      const parser = string();

      const result1 = parser.parse("hello\nworld");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "hello\nworld");
      }

      const result2 = parser.parse("tab\there");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "tab\there");
      }
    });
  });

  describe("pattern matching", () => {
    it("should accept strings matching pattern", () => {
      const parser = string({ pattern: /^[a-z]+$/ });

      const result = parser.parse("hello");
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "hello");
      }
    });

    it("should reject strings not matching pattern", () => {
      const parser = string({ pattern: /^[a-z]+$/ });

      const result = parser.parse("Hello123");
      assert.ok(!result.success);
    });

    it("should handle pattern with empty string", () => {
      const parser = string({ pattern: /^$/ });

      const result1 = parser.parse("");
      assert.ok(result1.success);

      const result2 = parser.parse("non-empty");
      assert.ok(!result2.success);
    });
  });
});

describe("integer edge cases", () => {
  describe("number parser edge cases", () => {
    it("should handle leading zeros", () => {
      const parser = integer({});

      const result1 = parser.parse("007");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 7);
      }

      const result2 = parser.parse("00123");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 123);
      }
    });

    it("should handle Number.MAX_SAFE_INTEGER boundary", () => {
      const parser = integer({});

      const result1 = parser.parse(Number.MAX_SAFE_INTEGER.toString());
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, Number.MAX_SAFE_INTEGER);
      }

      // Note: Values beyond MAX_SAFE_INTEGER may lose precision
      const result2 = parser.parse("9007199254740993"); // MAX_SAFE_INTEGER + 2
      assert.ok(result2.success);
      // Precision may be lost
    });

    it("should accept negative integers", () => {
      const parser = integer({});

      const result = parser.parse("-42");
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, -42);
      }
    });
  });

  describe("bigint parser edge cases", () => {
    it("should handle leading zeros", () => {
      const parser = integer({ type: "bigint" });

      const result = parser.parse("007");
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, 7n);
      }
    });

    it("should handle extremely large numbers", () => {
      const parser = integer({ type: "bigint" });
      const veryLarge =
        "123456789012345678901234567890123456789012345678901234567890";

      const result = parser.parse(veryLarge);
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, BigInt(veryLarge));
      }
    });

    it("should handle negative zero", () => {
      const parser = integer({ type: "bigint" });

      const result = parser.parse("-0");
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, 0n);
      }
    });
  });
});

describe("float edge cases", () => {
  it("should handle very large exponents", () => {
    const parser = float({});

    const result1 = parser.parse("1e308");
    assert.ok(result1.success);
    if (result1.success) {
      assert.equal(result1.value, 1e308);
    }

    const result2 = parser.parse("1e-308");
    assert.ok(result2.success);
    if (result2.success) {
      assert.equal(result2.value, 1e-308);
    }
  });

  // Note: Currently, numeric strings that overflow to Infinity are NOT rejected
  // even when allowInfinity is false. This is the current behavior.
  // Only literal "Infinity" strings are controlled by allowInfinity.
  it("should accept values that overflow to Infinity (current behavior)", () => {
    const parser = float({});

    // 1e309 is beyond the range of a JavaScript number and becomes Infinity
    const result = parser.parse("1e309");
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, Infinity);
    }
  });

  it("should accept values that become Infinity when allowInfinity is true", () => {
    const parser = float({ allowInfinity: true });

    const result = parser.parse("1e309");
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, Infinity);
    }
  });

  it("should handle negative zero", () => {
    const parser = float({});

    const result = parser.parse("-0");
    assert.ok(result.success);
    if (result.success) {
      // Note: Object.is can distinguish -0 from 0
      assert.ok(Object.is(result.value, -0));
    }
  });

  it("should handle subnormal numbers", () => {
    const parser = float({});

    // Smallest positive subnormal number
    const result = parser.parse("5e-324");
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, 5e-324);
    }
  });

  it("should handle numbers very close to zero", () => {
    const parser = float({});

    const result = parser.parse("0.0000000001");
    assert.ok(result.success);
    if (result.success) {
      assert.equal(result.value, 0.0000000001);
    }
  });
});

describe("ensureNonEmptyString", () => {
  it("should throw TypeError for empty metavar in string()", () => {
    assert.throws(
      () => string({ metavar: "" as unknown as NonEmptyString }),
      TypeError,
      "Expected a non-empty string.",
    );
  });

  it("should throw TypeError for empty metavar in choice()", () => {
    assert.throws(
      () => choice(["a", "b"], { metavar: "" as unknown as NonEmptyString }),
      TypeError,
      "Expected a non-empty string.",
    );
  });

  it("should throw TypeError for empty metavar in integer()", () => {
    assert.throws(
      () => integer({ metavar: "" as unknown as NonEmptyString }),
      TypeError,
      "Expected a non-empty string.",
    );
  });

  it("should throw TypeError for empty metavar in integer() with bigint", () => {
    assert.throws(
      () =>
        integer({ type: "bigint", metavar: "" as unknown as NonEmptyString }),
      TypeError,
      "Expected a non-empty string.",
    );
  });

  it("should throw TypeError for empty metavar in float()", () => {
    assert.throws(
      () => float({ metavar: "" as unknown as NonEmptyString }),
      TypeError,
      "Expected a non-empty string.",
    );
  });

  it("should throw TypeError for empty metavar in url()", () => {
    assert.throws(
      () => url({ metavar: "" as unknown as NonEmptyString }),
      TypeError,
      "Expected a non-empty string.",
    );
  });

  it("should throw TypeError for empty metavar in locale()", () => {
    assert.throws(
      () => locale({ metavar: "" as unknown as NonEmptyString }),
      TypeError,
      "Expected a non-empty string.",
    );
  });

  it("should throw TypeError for empty metavar in uuid()", () => {
    assert.throws(
      () => uuid({ metavar: "" as unknown as NonEmptyString }),
      TypeError,
      "Expected a non-empty string.",
    );
  });

  it("should accept non-empty metavar", () => {
    const parser = string({ metavar: "FILE" });
    assert.equal(parser.metavar, "FILE");
  });
});

describe("port", () => {
  describe("number parser", () => {
    it("should parse valid port numbers", () => {
      const parser = port({});

      const result1 = parser.parse("8080");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 8080);
        assert.equal(typeof result1.value, "number");
      }

      const result2 = parser.parse("1");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 1);
      }

      const result3 = parser.parse("65535");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, 65535);
      }

      const result4 = parser.parse("3000");
      assert.ok(result4.success);
      if (result4.success) {
        assert.equal(result4.value, 3000);
      }
    });

    it("should reject invalid port numbers", () => {
      const parser = port({});

      const result1 = parser.parse("abc");
      assert.ok(!result1.success);

      const result2 = parser.parse("8080.5");
      assert.ok(!result2.success);

      const result3 = parser.parse("1e4");
      assert.ok(!result3.success);

      const result4 = parser.parse("");
      assert.ok(!result4.success);

      const result5 = parser.parse("  8080  ");
      assert.ok(!result5.success);

      const result6 = parser.parse("-8080");
      assert.ok(!result6.success);
    });

    it("should enforce default minimum constraint (1)", () => {
      const parser = port({});

      const result1 = parser.parse("1");
      assert.ok(result1.success);

      const result2 = parser.parse("0");
      assert.ok(!result2.success);

      const result3 = parser.parse("-1");
      assert.ok(!result3.success);
    });

    it("should enforce default maximum constraint (65535)", () => {
      const parser = port({});

      const result1 = parser.parse("65535");
      assert.ok(result1.success);

      const result2 = parser.parse("65536");
      assert.ok(!result2.success);

      const result3 = parser.parse("100000");
      assert.ok(!result3.success);
    });

    it("should enforce custom minimum constraint", () => {
      const parser = port({ min: 1024 });

      const result1 = parser.parse("1024");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 1024);
      }

      const result2 = parser.parse("8080");
      assert.ok(result2.success);

      const result3 = parser.parse("1023");
      assert.ok(!result3.success);

      const result4 = parser.parse("80");
      assert.ok(!result4.success);
    });

    it("should enforce custom maximum constraint", () => {
      const parser = port({ max: 9000 });

      const result1 = parser.parse("9000");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 9000);
      }

      const result2 = parser.parse("8080");
      assert.ok(result2.success);

      const result3 = parser.parse("9001");
      assert.ok(!result3.success);

      const result4 = parser.parse("65535");
      assert.ok(!result4.success);
    });

    it("should enforce both min and max constraints", () => {
      const parser = port({ min: 3000, max: 9000 });

      const result1 = parser.parse("3000");
      assert.ok(result1.success);

      const result2 = parser.parse("8080");
      assert.ok(result2.success);

      const result3 = parser.parse("9000");
      assert.ok(result3.success);

      const result4 = parser.parse("2999");
      assert.ok(!result4.success);

      const result5 = parser.parse("9001");
      assert.ok(!result5.success);
    });

    it("should disallow well-known ports when requested", () => {
      const parser = port({ disallowWellKnown: true });

      const result1 = parser.parse("1024");
      assert.ok(result1.success);

      const result2 = parser.parse("8080");
      assert.ok(result2.success);

      const result3 = parser.parse("1023");
      assert.ok(!result3.success);

      const result4 = parser.parse("80");
      assert.ok(!result4.success);

      const result5 = parser.parse("443");
      assert.ok(!result5.success);

      const result6 = parser.parse("22");
      assert.ok(!result6.success);

      const result7 = parser.parse("1");
      assert.ok(!result7.success);
    });

    it("should allow well-known ports by default", () => {
      const parser = port({});

      const result1 = parser.parse("80");
      assert.ok(result1.success);

      const result2 = parser.parse("443");
      assert.ok(result2.success);

      const result3 = parser.parse("22");
      assert.ok(result3.success);

      const result4 = parser.parse("1023");
      assert.ok(result4.success);
    });

    it("should work with custom min and disallowWellKnown together", () => {
      const parser = port({ min: 100, disallowWellKnown: true });

      const result1 = parser.parse("1024");
      assert.ok(result1.success);

      const result2 = parser.parse("500");
      assert.ok(!result2.success); // below 1024 (well-known)

      const result3 = parser.parse("99");
      assert.ok(!result3.success); // below min and well-known
    });
  });

  describe("bigint parser", () => {
    it("should parse valid port numbers as bigint", () => {
      const parser = port({ type: "bigint" });

      const result1 = parser.parse("8080");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 8080n);
        assert.equal(typeof result1.value, "bigint");
      }

      const result2 = parser.parse("1");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, 1n);
      }

      const result3 = parser.parse("65535");
      assert.ok(result3.success);
      if (result3.success) {
        assert.equal(result3.value, 65535n);
      }
    });

    it("should reject invalid port numbers", () => {
      const parser = port({ type: "bigint" });

      const result1 = parser.parse("abc");
      assert.ok(!result1.success);

      const result2 = parser.parse("8080.5");
      assert.ok(!result2.success);

      const result3 = parser.parse("1e4");
      assert.ok(!result3.success);
    });

    it("should enforce bigint minimum constraint", () => {
      const parser = port({ type: "bigint", min: 1024n });

      const result1 = parser.parse("1024");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 1024n);
      }

      const result2 = parser.parse("8080");
      assert.ok(result2.success);

      const result3 = parser.parse("1023");
      assert.ok(!result3.success);
    });

    it("should enforce bigint maximum constraint", () => {
      const parser = port({ type: "bigint", max: 9000n });

      const result1 = parser.parse("9000");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, 9000n);
      }

      const result2 = parser.parse("8080");
      assert.ok(result2.success);

      const result3 = parser.parse("9001");
      assert.ok(!result3.success);
    });

    it("should enforce default constraints with bigint", () => {
      const parser = port({ type: "bigint" });

      const result1 = parser.parse("1");
      assert.ok(result1.success);

      const result2 = parser.parse("0");
      assert.ok(!result2.success);

      const result3 = parser.parse("65535");
      assert.ok(result3.success);

      const result4 = parser.parse("65536");
      assert.ok(!result4.success);
    });

    it("should disallow well-known ports with bigint", () => {
      const parser = port({ type: "bigint", disallowWellKnown: true });

      const result1 = parser.parse("1024");
      assert.ok(result1.success);

      const result2 = parser.parse("80");
      assert.ok(!result2.success);

      const result3 = parser.parse("443");
      assert.ok(!result3.success);
    });
  });

  describe("format() method", () => {
    it("should format number port correctly", () => {
      const parser = port({});

      assert.equal(parser.format(8080), "8080");
      assert.equal(parser.format(80), "80");
      assert.equal(parser.format(65535), "65535");
      assert.equal(parser.format(1), "1");
    });

    it("should format bigint port correctly", () => {
      const parser = port({ type: "bigint" });

      assert.equal(parser.format(8080n), "8080");
      assert.equal(parser.format(80n), "80");
      assert.equal(parser.format(65535n), "65535");
      assert.equal(parser.format(1n), "1");
    });
  });

  describe("error messages", () => {
    it("should provide structured error messages for invalid port", () => {
      const parser = port({});

      const result = parser.parse("abc");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected a valid port number, but got " },
            { type: "value", value: "abc" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for below minimum", () => {
      const parser = port({ min: 1024 });

      const result = parser.parse("80");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            {
              type: "text",
              text: "Expected a port number greater than or equal to ",
            },
            { type: "text", text: "1,024" },
            { type: "text", text: ", but got " },
            { type: "value", value: "80" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for above maximum", () => {
      const parser = port({ max: 9000 });

      const result = parser.parse("10000");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            {
              type: "text",
              text: "Expected a port number less than or equal to ",
            },
            { type: "text", text: "9,000" },
            { type: "text", text: ", but got " },
            { type: "value", value: "10000" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide structured error messages for well-known ports", () => {
      const parser = port({ disallowWellKnown: true });

      const result = parser.parse("80");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Port " },
            { type: "value", value: "80" },
            {
              type: "text",
              text:
                " is a well-known port (1-1023) and may require elevated privileges.",
            },
          ] as const,
        );
      }
    });
  });

  describe("custom error messages", () => {
    it("should use custom invalidPort error message", () => {
      const parser = port({
        errors: {
          invalidPort: message`Must be a valid port number.`,
        },
      });

      const result = parser.parse("abc");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(result.error, [
          { type: "text", text: "Must be a valid port number." },
        ]);
      }
    });

    it("should use function-based invalidPort error message", () => {
      const parser = port({
        errors: {
          invalidPort: (input) => message`${input} is not a valid port.`,
        },
      });

      const result = parser.parse("abc");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(result.error, [
          { type: "value", value: "abc" },
          { type: "text", text: " is not a valid port." },
        ]);
      }
    });

    it("should use custom belowMinimum error message", () => {
      const parser = port({
        min: 1024,
        errors: {
          belowMinimum: (port, min) =>
            message`Port ${text(port.toString())} is below minimum ${
              text(min.toString())
            }.`,
        },
      });

      const result = parser.parse("80");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(result.error, [
          { type: "text", text: "Port " },
          { type: "text", text: "80" },
          { type: "text", text: " is below minimum " },
          { type: "text", text: "1024" },
          { type: "text", text: "." },
        ]);
      }
    });

    it("should use custom aboveMaximum error message", () => {
      const parser = port({
        max: 9000,
        errors: {
          aboveMaximum: (port, max) =>
            message`Port ${text(port.toString())} exceeds maximum ${
              text(max.toString())
            }.`,
        },
      });

      const result = parser.parse("10000");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(result.error, [
          { type: "text", text: "Port " },
          { type: "text", text: "10000" },
          { type: "text", text: " exceeds maximum " },
          { type: "text", text: "9000" },
          { type: "text", text: "." },
        ]);
      }
    });

    it("should use custom wellKnownNotAllowed error message", () => {
      const parser = port({
        disallowWellKnown: true,
        errors: {
          wellKnownNotAllowed: (port) =>
            message`Cannot use privileged port ${text(port.toString())}.`,
        },
      });

      const result = parser.parse("80");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(result.error, [
          { type: "text", text: "Cannot use privileged port " },
          { type: "text", text: "80" },
          { type: "text", text: "." },
        ]);
      }
    });
  });

  describe("custom metavar", () => {
    it("should use custom metavar when provided", () => {
      const parser = port({ metavar: "SERVER_PORT" });
      assert.equal(parser.metavar, "SERVER_PORT");
    });

    it("should use default metavar when not provided", () => {
      const parser = port({});
      assert.equal(parser.metavar, "PORT");
    });

    it("should use custom metavar with bigint type", () => {
      const parser = port({ type: "bigint", metavar: "LISTEN_PORT" });
      assert.equal(parser.metavar, "LISTEN_PORT");
    });
  });

  describe("edge cases", () => {
    it("should handle common web server ports", () => {
      const parser = port({});

      const commonPorts = [
        "80", // HTTP
        "443", // HTTPS
        "8080", // HTTP alternate
        "8443", // HTTPS alternate
        "3000", // Node.js dev
        "5000", // Flask dev
        "8000", // Django dev
      ];

      for (const portStr of commonPorts) {
        const result = parser.parse(portStr);
        assert.ok(result.success, `Should accept common port ${portStr}`);
      }
    });

    it("should handle database ports", () => {
      const parser = port({});

      const dbPorts = [
        "3306", // MySQL
        "5432", // PostgreSQL
        "27017", // MongoDB
        "6379", // Redis
        "9042", // Cassandra
      ];

      for (const portStr of dbPorts) {
        const result = parser.parse(portStr);
        assert.ok(result.success, `Should accept database port ${portStr}`);
      }
    });

    it("should reject port 0", () => {
      const parser = port({});

      const result = parser.parse("0");
      assert.ok(!result.success);
    });

    it("should accept minimum port with custom min", () => {
      const parser = port({ min: 0 });

      const result = parser.parse("0");
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, 0);
      }
    });
  });

  describe("ipv4()", () => {
    describe("basic validation", () => {
      it("should accept valid IPv4 addresses", () => {
        const parser = ipv4();

        const validAddresses = [
          "192.168.1.1",
          "10.0.0.1",
          "172.16.0.1",
          "8.8.8.8",
          "1.1.1.1",
          "255.255.255.255",
          "0.0.0.0",
          "127.0.0.1",
        ];

        for (const addr of validAddresses) {
          const result = parser.parse(addr);
          assert.ok(
            result.success,
            `Should accept valid IPv4 address ${addr}`,
          );
          if (result.success) {
            assert.equal(result.value, addr);
          }
        }
      });

      it("should reject invalid IPv4 addresses", () => {
        const parser = ipv4();

        const invalidAddresses = [
          "256.1.1.1", // Octet > 255
          "1.256.1.1",
          "1.1.256.1",
          "1.1.1.256",
          "192.168.1", // Only 3 octets
          "192.168.1.1.1", // 5 octets
          "192.168.1.a", // Non-numeric
          "192.168.1.-1", // Negative
          "192.168.1.1.1.1", // Too many octets
          "", // Empty
          "192.168..1", // Empty octet
          "....", // All dots
          "not-an-ip",
        ];

        for (const addr of invalidAddresses) {
          const result = parser.parse(addr);
          assert.ok(
            !result.success,
            `Should reject invalid IPv4 address ${addr}`,
          );
        }
      });

      it("should reject leading zeros", () => {
        const parser = ipv4();

        const withLeadingZeros = [
          "192.168.001.1",
          "010.0.0.1",
          "192.168.1.01",
          "01.01.01.01",
        ];

        for (const addr of withLeadingZeros) {
          const result = parser.parse(addr);
          assert.ok(
            !result.success,
            `Should reject IPv4 with leading zeros: ${addr}`,
          );
        }
      });

      it("should accept single zero octet", () => {
        const parser = ipv4();

        const result = parser.parse("192.168.0.1");
        assert.ok(result.success);
        if (result.success) {
          assert.equal(result.value, "192.168.0.1");
        }
      });
    });

    describe("private IP filtering", () => {
      it("should allow private IPs by default", () => {
        const parser = ipv4();

        const privateIps = [
          "10.0.0.1",
          "10.255.255.255",
          "172.16.0.1",
          "172.31.255.255",
          "192.168.0.1",
          "192.168.255.255",
        ];

        for (const ip of privateIps) {
          const result = parser.parse(ip);
          assert.ok(result.success, `Should accept private IP ${ip}`);
        }
      });

      it("should reject private IPs when disallowed", () => {
        const parser = ipv4({ allowPrivate: false });

        const privateIps = [
          "10.0.0.1", // 10.0.0.0/8
          "10.255.255.255",
          "172.16.0.1", // 172.16.0.0/12
          "172.31.255.255",
          "192.168.0.1", // 192.168.0.0/16
          "192.168.255.255",
        ];

        for (const ip of privateIps) {
          const result = parser.parse(ip);
          assert.ok(!result.success, `Should reject private IP ${ip}`);
        }
      });

      it("should accept public IPs when private is disallowed", () => {
        const parser = ipv4({ allowPrivate: false });

        const publicIps = [
          "8.8.8.8",
          "1.1.1.1",
          "172.32.0.1", // Just outside 172.16.0.0/12
          "172.15.255.255",
          "11.0.0.1", // Just outside 10.0.0.0/8
        ];

        for (const ip of publicIps) {
          const result = parser.parse(ip);
          assert.ok(result.success, `Should accept public IP ${ip}`);
        }
      });
    });

    describe("loopback IP filtering", () => {
      it("should allow loopback IPs by default", () => {
        const parser = ipv4();

        const loopbackIps = [
          "127.0.0.1",
          "127.0.0.0",
          "127.255.255.255",
          "127.1.2.3",
        ];

        for (const ip of loopbackIps) {
          const result = parser.parse(ip);
          assert.ok(result.success, `Should accept loopback IP ${ip}`);
        }
      });

      it("should reject loopback IPs when disallowed", () => {
        const parser = ipv4({ allowLoopback: false });

        const loopbackIps = [
          "127.0.0.1",
          "127.0.0.0",
          "127.255.255.255",
          "127.1.2.3",
        ];

        for (const ip of loopbackIps) {
          const result = parser.parse(ip);
          assert.ok(!result.success, `Should reject loopback IP ${ip}`);
        }
      });

      it("should accept non-loopback IPs when loopback is disallowed", () => {
        const parser = ipv4({ allowLoopback: false });

        const result = parser.parse("8.8.8.8");
        assert.ok(result.success);
      });
    });

    describe("link-local IP filtering", () => {
      it("should allow link-local IPs by default", () => {
        const parser = ipv4();

        const linkLocalIps = [
          "169.254.0.0",
          "169.254.1.1",
          "169.254.255.255",
        ];

        for (const ip of linkLocalIps) {
          const result = parser.parse(ip);
          assert.ok(result.success, `Should accept link-local IP ${ip}`);
        }
      });

      it("should reject link-local IPs when disallowed", () => {
        const parser = ipv4({ allowLinkLocal: false });

        const linkLocalIps = [
          "169.254.0.0",
          "169.254.1.1",
          "169.254.255.255",
        ];

        for (const ip of linkLocalIps) {
          const result = parser.parse(ip);
          assert.ok(!result.success, `Should reject link-local IP ${ip}`);
        }
      });
    });

    describe("multicast IP filtering", () => {
      it("should allow multicast IPs by default", () => {
        const parser = ipv4();

        const multicastIps = [
          "224.0.0.0",
          "224.0.0.1",
          "239.255.255.255",
          "230.1.2.3",
        ];

        for (const ip of multicastIps) {
          const result = parser.parse(ip);
          assert.ok(result.success, `Should accept multicast IP ${ip}`);
        }
      });

      it("should reject multicast IPs when disallowed", () => {
        const parser = ipv4({ allowMulticast: false });

        const multicastIps = [
          "224.0.0.0",
          "224.0.0.1",
          "239.255.255.255",
          "230.1.2.3",
        ];

        for (const ip of multicastIps) {
          const result = parser.parse(ip);
          assert.ok(!result.success, `Should reject multicast IP ${ip}`);
        }
      });
    });

    describe("broadcast IP filtering", () => {
      it("should allow broadcast IP by default", () => {
        const parser = ipv4();

        const result = parser.parse("255.255.255.255");
        assert.ok(result.success);
        if (result.success) {
          assert.equal(result.value, "255.255.255.255");
        }
      });

      it("should reject broadcast IP when disallowed", () => {
        const parser = ipv4({ allowBroadcast: false });

        const result = parser.parse("255.255.255.255");
        assert.ok(!result.success);
      });

      it("should accept non-broadcast IPs when broadcast is disallowed", () => {
        const parser = ipv4({ allowBroadcast: false });

        const result = parser.parse("255.255.255.254");
        assert.ok(result.success);
      });
    });

    describe("zero address filtering", () => {
      it("should allow zero address by default", () => {
        const parser = ipv4();

        const result = parser.parse("0.0.0.0");
        assert.ok(result.success);
        if (result.success) {
          assert.equal(result.value, "0.0.0.0");
        }
      });

      it("should reject zero address when disallowed", () => {
        const parser = ipv4({ allowZero: false });

        const result = parser.parse("0.0.0.0");
        assert.ok(!result.success);
      });

      it("should accept non-zero IPs when zero is disallowed", () => {
        const parser = ipv4({ allowZero: false });

        const result = parser.parse("0.0.0.1");
        assert.ok(result.success);
      });
    });

    describe("combined filters", () => {
      it("should apply multiple filters", () => {
        const parser = ipv4({
          allowPrivate: false,
          allowLoopback: false,
          allowLinkLocal: false,
        });

        // Should reject private
        assert.ok(!parser.parse("192.168.1.1").success);
        // Should reject loopback
        assert.ok(!parser.parse("127.0.0.1").success);
        // Should reject link-local
        assert.ok(!parser.parse("169.254.1.1").success);
        // Should accept public
        assert.ok(parser.parse("8.8.8.8").success);
      });

      it("should accept when all filters allow", () => {
        const parser = ipv4({
          allowPrivate: true,
          allowLoopback: true,
          allowLinkLocal: true,
          allowMulticast: true,
          allowBroadcast: true,
          allowZero: true,
        });

        assert.ok(parser.parse("192.168.1.1").success);
        assert.ok(parser.parse("127.0.0.1").success);
        assert.ok(parser.parse("169.254.1.1").success);
        assert.ok(parser.parse("224.0.0.1").success);
        assert.ok(parser.parse("255.255.255.255").success);
        assert.ok(parser.parse("0.0.0.0").success);
      });
    });

    describe("custom error messages", () => {
      it("should use custom invalidIpv4 error message", () => {
        const customError = message`Custom IPv4 error`;
        const parser = ipv4({
          errors: {
            invalidIpv4: customError,
          },
        });

        const result = parser.parse("not-an-ip");
        assert.ok(!result.success);
        if (!result.success) {
          assert.deepEqual(result.error, customError);
        }
      });

      it("should use custom privateNotAllowed error message", () => {
        const customError = message`Private IP not allowed`;
        const parser = ipv4({
          allowPrivate: false,
          errors: {
            privateNotAllowed: customError,
          },
        });

        const result = parser.parse("192.168.1.1");
        assert.ok(!result.success);
        if (!result.success) {
          assert.deepEqual(result.error, customError);
        }
      });

      it("should use custom error function", () => {
        const parser = ipv4({
          allowLoopback: false,
          errors: {
            loopbackNotAllowed: (ip) => message`No loopback: ${ip}`,
          },
        });

        const result = parser.parse("127.0.0.1");
        assert.ok(!result.success);
        if (!result.success) {
          assert.deepEqual(result.error, [
            { type: "text", text: "No loopback: " },
            { type: "value", value: "127.0.0.1" },
          ]);
        }
      });
    });

    describe("format()", () => {
      it("should format IPv4 address", () => {
        const parser = ipv4();

        assert.equal(parser.format("192.168.1.1"), "192.168.1.1");
        assert.equal(parser.format("8.8.8.8"), "8.8.8.8");
      });
    });

    describe("metavar", () => {
      it("should use default metavar", () => {
        const parser = ipv4();
        assert.equal(parser.metavar, "IPV4");
      });

      it("should use custom metavar", () => {
        const parser = ipv4({ metavar: "IP_ADDRESS" });
        assert.equal(parser.metavar, "IP_ADDRESS");
      });
    });

    describe("edge cases", () => {
      it("should handle boundary values for octets", () => {
        const parser = ipv4();

        assert.ok(parser.parse("0.0.0.0").success);
        assert.ok(parser.parse("255.255.255.255").success);
        assert.ok(!parser.parse("256.0.0.0").success);
        assert.ok(!parser.parse("0.0.0.256").success);
      });

      it("should handle whitespace", () => {
        const parser = ipv4();

        assert.ok(!parser.parse(" 192.168.1.1").success);
        assert.ok(!parser.parse("192.168.1.1 ").success);
        assert.ok(!parser.parse("192. 168.1.1").success);
      });
    });
  });
});

describe("hostname()", () => {
  describe("basic validation", () => {
    it("should accept valid hostnames", () => {
      const parser = hostname();

      // Simple hostname
      const result1 = parser.parse("example");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "example");

      // FQDN
      const result2 = parser.parse("example.com");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "example.com");

      // Subdomain
      const result3 = parser.parse("sub.example.com");
      assert.ok(result3.success);
      assert.strictEqual(result3.value, "sub.example.com");

      // With hyphens
      const result4 = parser.parse("my-server.example.com");
      assert.ok(result4.success);
      assert.strictEqual(result4.value, "my-server.example.com");

      // Numbers
      const result5 = parser.parse("server123.example.com");
      assert.ok(result5.success);
      assert.strictEqual(result5.value, "server123.example.com");

      // localhost
      const result6 = parser.parse("localhost");
      assert.ok(result6.success);
      assert.strictEqual(result6.value, "localhost");

      // Long but valid (253 chars)
      const longHostname = "a".repeat(63) + "." + "b".repeat(63) + "." +
        "c".repeat(63) + "." + "d".repeat(59);
      const result7 = parser.parse(longHostname);
      assert.ok(result7.success);
      assert.strictEqual(result7.value, longHostname);
    });

    it("should reject invalid hostnames", () => {
      const parser = hostname();

      // Empty string
      const result1 = parser.parse("");
      assert.ok(!result1.success);
      assert.deepStrictEqual(result1.error, [
        { type: "text", text: "Expected a valid hostname, but got " },
        { type: "value", value: "" },
        { type: "text", text: "." },
      ]);

      // Starts with hyphen
      const result2 = parser.parse("-example.com");
      assert.ok(!result2.success);

      // Ends with hyphen
      const result3 = parser.parse("example-.com");
      assert.ok(!result3.success);

      // Label too long (>63 chars)
      const result4 = parser.parse("a".repeat(64) + ".example.com");
      assert.ok(!result4.success);

      // Double dots
      const result5 = parser.parse("example..com");
      assert.ok(!result5.success);

      // Trailing dot alone not valid
      const result6 = parser.parse("example.com.");
      assert.ok(!result6.success);

      // Contains spaces
      const result7 = parser.parse("example .com");
      assert.ok(!result7.success);

      // Special characters
      const result8 = parser.parse("example@.com");
      assert.ok(!result8.success);

      // Wildcard by default not allowed
      const result9 = parser.parse("*.example.com");
      assert.ok(!result9.success);

      // Underscore by default not allowed
      const result10 = parser.parse("_service.example.com");
      assert.ok(!result10.success);
    });
  });

  describe("allowWildcard option", () => {
    it("should accept wildcard hostnames when allowWildcard is true", () => {
      const parser = hostname({ allowWildcard: true });

      const result1 = parser.parse("*.example.com");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "*.example.com");

      const result2 = parser.parse("*.sub.example.com");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "*.sub.example.com");
    });

    it("should reject wildcard hostnames when allowWildcard is false", () => {
      const parser = hostname({ allowWildcard: false });

      const result = parser.parse("*.example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Wildcard hostname " },
        { type: "value", value: "*.example.com" },
        { type: "text", text: " is not allowed." },
      ]);
    });

    it("should reject multiple wildcards", () => {
      const parser = hostname({ allowWildcard: true });

      const result1 = parser.parse("*.*.example.com");
      assert.ok(!result1.success);

      const result2 = parser.parse("*.*");
      assert.ok(!result2.success);
    });
  });

  describe("allowUnderscore option", () => {
    it("should accept underscores when allowUnderscore is true", () => {
      const parser = hostname({ allowUnderscore: true });

      const result1 = parser.parse("_service.example.com");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "_service.example.com");

      const result2 = parser.parse("my_server.example.com");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "my_server.example.com");
    });

    it("should reject underscores when allowUnderscore is false", () => {
      const parser = hostname({ allowUnderscore: false });

      const result = parser.parse("_service.example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Hostname " },
        { type: "value", value: "_service.example.com" },
        {
          type: "text",
          text: " contains underscore, which is not allowed.",
        },
      ]);
    });
  });

  describe("allowLocalhost option", () => {
    it("should accept localhost when allowLocalhost is true", () => {
      const parser = hostname({ allowLocalhost: true });

      const result = parser.parse("localhost");
      assert.ok(result.success);
      assert.strictEqual(result.value, "localhost");
    });

    it("should reject localhost when allowLocalhost is false", () => {
      const parser = hostname({ allowLocalhost: false });

      const result = parser.parse("localhost");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Hostname 'localhost' is not allowed." },
      ]);
    });

    it("should only reject exact localhost string", () => {
      const parser = hostname({ allowLocalhost: false });

      // These should still be valid
      const result1 = parser.parse("localhosts");
      assert.ok(result1.success);

      const result2 = parser.parse("my-localhost.com");
      assert.ok(result2.success);
    });
  });

  describe("maxLength option", () => {
    it("should accept hostnames within maxLength", () => {
      const parser = hostname({ maxLength: 20 });

      const result = parser.parse("example.com");
      assert.ok(result.success);
    });

    it("should reject hostnames exceeding maxLength", () => {
      const parser = hostname({ maxLength: 10 });

      const result = parser.parse("example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Hostname " },
        { type: "value", value: "example.com" },
        { type: "text", text: " is too long (maximum " },
        { type: "text", text: "10" },
        { type: "text", text: " characters)." },
      ]);
    });

    it("should default to 253 characters", () => {
      const parser = hostname();

      // 253 chars should be valid
      const validHostname = "a".repeat(63) + "." + "b".repeat(63) + "." +
        "c".repeat(63) + "." + "d".repeat(61);
      const result1 = parser.parse(validHostname);
      assert.strictEqual(validHostname.length, 253);
      assert.ok(result1.success);

      // 254 chars should be invalid
      const invalidHostname = validHostname + "x";
      const result2 = parser.parse(invalidHostname);
      assert.strictEqual(invalidHostname.length, 254);
      assert.ok(!result2.success);
    });
  });

  describe("custom error messages", () => {
    it("should use custom static error message for invalidHostname", () => {
      const parser = hostname({
        errors: {
          invalidHostname: message`Bad hostname format!`,
        },
      });

      const result = parser.parse("invalid..hostname");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Bad hostname format!" },
      ]);
    });

    it("should use custom error function for invalidHostname", () => {
      const parser = hostname({
        errors: {
          invalidHostname: (input) => message`Not valid: ${input}`,
        },
      });

      const result = parser.parse("-invalid");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Not valid: " },
        { type: "value", value: "-invalid" },
      ]);
    });

    it("should use custom error message for wildcardNotAllowed", () => {
      const parser = hostname({
        allowWildcard: false,
        errors: {
          wildcardNotAllowed: (hostname) =>
            message`Wildcards forbidden: ${hostname}`,
        },
      });

      const result = parser.parse("*.example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Wildcards forbidden: " },
        { type: "value", value: "*.example.com" },
      ]);
    });

    it("should use custom error message for underscoreNotAllowed", () => {
      const parser = hostname({
        allowUnderscore: false,
        errors: {
          underscoreNotAllowed: message`Underscores not accepted`,
        },
      });

      const result = parser.parse("_service.example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Underscores not accepted" },
      ]);
    });

    it("should use custom error message for localhostNotAllowed", () => {
      const parser = hostname({
        allowLocalhost: false,
        errors: {
          localhostNotAllowed: message`No localhost allowed!`,
        },
      });

      const result = parser.parse("localhost");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "No localhost allowed!" },
      ]);
    });

    it("should use custom error message for tooLong", () => {
      const parser = hostname({
        maxLength: 10,
        errors: {
          tooLong: (hostname, max) =>
            message`Too big: ${hostname} (max: ${text(max.toString())})`,
        },
      });

      const result = parser.parse("verylonghostname.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Too big: " },
        { type: "value", value: "verylonghostname.com" },
        { type: "text", text: " (max: " },
        { type: "text", text: "10" },
        { type: "text", text: ")" },
      ]);
    });
  });

  describe("format()", () => {
    it("should return hostname as-is", () => {
      const parser = hostname();

      assert.strictEqual(parser.format("example.com"), "example.com");
      assert.strictEqual(parser.format("EXAMPLE.COM"), "EXAMPLE.COM");
      assert.strictEqual(parser.format("localhost"), "localhost");
    });
  });

  describe("metavar", () => {
    it("should use default metavar HOST", () => {
      const parser = hostname();

      assert.strictEqual(parser.metavar, "HOST");
    });

    it("should use custom metavar", () => {
      const parser = hostname({ metavar: "HOSTNAME" });

      assert.strictEqual(parser.metavar, "HOSTNAME");
    });
  });

  describe("edge cases", () => {
    it("should handle case sensitivity correctly", () => {
      const parser = hostname();

      const result1 = parser.parse("EXAMPLE.COM");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "EXAMPLE.COM");

      const result2 = parser.parse("Example.Com");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "Example.Com");
    });

    it("should reject hostnames with invalid label positions", () => {
      const parser = hostname();

      // Starting with dot
      const result1 = parser.parse(".example.com");
      assert.ok(!result1.success);

      // Multiple consecutive dots
      const result2 = parser.parse("example...com");
      assert.ok(!result2.success);
    });

    it("should handle boundary label lengths", () => {
      const parser = hostname();

      // Exactly 63 chars (valid)
      const validLabel = "a".repeat(63) + ".com";
      const result1 = parser.parse(validLabel);
      assert.ok(result1.success);

      // 64 chars (invalid)
      const invalidLabel = "a".repeat(64) + ".com";
      const result2 = parser.parse(invalidLabel);
      assert.ok(!result2.success);
    });

    it("should handle numeric-only labels", () => {
      const parser = hostname();

      // Numeric labels are valid in hostnames (not IPs though)
      const result = parser.parse("123.456.789");
      assert.ok(result.success);
    });
  });
});

describe("email()", () => {
  describe("basic validation", () => {
    it("should accept valid email addresses", () => {
      const parser = email();

      // Simple email
      const result1 = parser.parse("user@example.com");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "user@example.com");

      // With subdomain
      const result2 = parser.parse("user@mail.example.com");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "user@mail.example.com");

      // With dots in local part (RFC 5322 dot-atom)
      const result3 = parser.parse("first.last@example.com");
      assert.ok(result3.success);
      assert.strictEqual(result3.value, "first.last@example.com");

      // With hyphens
      const result4 = parser.parse("user-name@example.com");
      assert.ok(result4.success);
      assert.strictEqual(result4.value, "user-name@example.com");

      // With plus sign (RFC 5322 atext)
      const result5 = parser.parse("user+tag@example.com");
      assert.ok(result5.success);
      assert.strictEqual(result5.value, "user+tag@example.com");

      // With numbers
      const result6 = parser.parse("user123@example456.com");
      assert.ok(result6.success);
      assert.strictEqual(result6.value, "user123@example456.com");

      // With underscores
      const result7 = parser.parse("user_name@example.com");
      assert.ok(result7.success);
      assert.strictEqual(result7.value, "user_name@example.com");

      // Quoted string local part (RFC 5322)
      const result8 = parser.parse('"user name"@example.com');
      assert.ok(result8.success);
      assert.strictEqual(result8.value, '"user name"@example.com');

      // Quoted string with special chars
      const result9 = parser.parse('"user@domain"@example.com');
      assert.ok(result9.success);
      assert.strictEqual(result9.value, '"user@domain"@example.com');
    });

    it("should reject invalid email addresses", () => {
      const parser = email();

      // No @ sign
      const result1 = parser.parse("userexample.com");
      assert.ok(!result1.success);
      assert.deepStrictEqual(result1.error, [
        { type: "text", text: "Expected a valid email address, but got " },
        { type: "value", value: "userexample.com" },
        { type: "text", text: "." },
      ]);

      // Multiple @ signs
      const result2 = parser.parse("user@@example.com");
      assert.ok(!result2.success);

      // Missing local part
      const result3 = parser.parse("@example.com");
      assert.ok(!result3.success);

      // Missing domain
      const result4 = parser.parse("user@");
      assert.ok(!result4.success);

      // No dot in domain
      const result5 = parser.parse("user@example");
      assert.ok(!result5.success);

      // Empty string
      const result6 = parser.parse("");
      assert.ok(!result6.success);

      // Spaces
      const result7 = parser.parse("user @example.com");
      assert.ok(!result7.success);

      // Special characters in local part (not allowed in simplified RFC)
      const result8 = parser.parse("user!name@example.com");
      assert.ok(!result8.success);

      // Domain starting with dot
      const result9 = parser.parse("user@.example.com");
      assert.ok(!result9.success);

      // Domain ending with dot
      const result10 = parser.parse("user@example.com.");
      assert.ok(!result10.success);
    });
  });

  describe("allowMultiple option", () => {
    it("should accept multiple email addresses when allowMultiple is true", () => {
      const parser = email({ allowMultiple: true });

      const result1 = parser.parse("user1@example.com,user2@example.com");
      assert.ok(result1.success);
      assert.deepStrictEqual(result1.value, [
        "user1@example.com",
        "user2@example.com",
      ]);

      const result2 = parser.parse(
        "alice@example.com,bob@example.org,charlie@test.com",
      );
      assert.ok(result2.success);
      assert.deepStrictEqual(result2.value, [
        "alice@example.com",
        "bob@example.org",
        "charlie@test.com",
      ]);

      // Single email should still work
      const result3 = parser.parse("single@example.com");
      assert.ok(result3.success);
      assert.deepStrictEqual(result3.value, ["single@example.com"]);
    });

    it("should trim whitespace around emails in multiple mode", () => {
      const parser = email({ allowMultiple: true });

      const result = parser.parse(
        "user1@example.com, user2@example.com , user3@example.com",
      );
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, [
        "user1@example.com",
        "user2@example.com",
        "user3@example.com",
      ]);
    });

    it("should reject if any email in the list is invalid", () => {
      const parser = email({ allowMultiple: true });

      const result = parser.parse("valid@example.com,invalid,another@test.com");
      assert.ok(!result.success);
    });

    it("should return single email when allowMultiple is false", () => {
      const parser = email({ allowMultiple: false });

      const result = parser.parse("user@example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "user@example.com");
    });
  });

  describe("allowDisplayName option", () => {
    it("should accept display name format when allowDisplayName is true", () => {
      const parser = email({ allowDisplayName: true });

      const result1 = parser.parse("John Doe <john@example.com>");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "john@example.com");

      const result2 = parser.parse("Alice Smith <alice.smith@example.com>");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "alice.smith@example.com");

      // Without display name should still work
      const result3 = parser.parse("bob@example.com");
      assert.ok(result3.success);
      assert.strictEqual(result3.value, "bob@example.com");
    });

    it("should reject display name format when allowDisplayName is false", () => {
      const parser = email({ allowDisplayName: false });

      const result = parser.parse("John Doe <john@example.com>");
      assert.ok(!result.success);
    });

    it("should handle display names with special characters", () => {
      const parser = email({ allowDisplayName: true });

      const result1 = parser.parse('"Smith, John" <john.smith@example.com>');
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "john.smith@example.com");
    });
  });

  describe("lowercase option", () => {
    it("should convert email to lowercase when lowercase is true", () => {
      const parser = email({ lowercase: true });

      const result1 = parser.parse("User@Example.COM");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "user@example.com");

      const result2 = parser.parse("ADMIN@COMPANY.NET");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "admin@company.net");
    });

    it("should preserve case when lowercase is false", () => {
      const parser = email({ lowercase: false });

      const result = parser.parse("User@Example.COM");
      assert.ok(result.success);
      assert.strictEqual(result.value, "User@Example.COM");
    });

    it("should work with allowMultiple", () => {
      const parser = email({ allowMultiple: true, lowercase: true });

      const result = parser.parse("User1@Example.COM,User2@Example.ORG");
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, [
        "user1@example.com",
        "user2@example.org",
      ]);
    });
  });

  describe("allowedDomains option", () => {
    it("should accept emails from allowed domains", () => {
      const parser = email({
        allowedDomains: ["example.com", "example.org"],
      });

      const result1 = parser.parse("user@example.com");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "user@example.com");

      const result2 = parser.parse("user@example.org");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "user@example.org");
    });

    it("should reject emails from disallowed domains", () => {
      const parser = email({
        allowedDomains: ["example.com", "example.org"],
      });

      const result = parser.parse("user@other.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Email domain " },
        { type: "value", value: "other.com" },
        {
          type: "text",
          text: " is not allowed. Allowed domains: example.com, example.org.",
        },
      ]);
    });

    it("should be case-insensitive for domain matching", () => {
      const parser = email({
        allowedDomains: ["example.com"],
      });

      const result1 = parser.parse("user@Example.COM");
      assert.ok(result1.success);

      const result2 = parser.parse("user@EXAMPLE.com");
      assert.ok(result2.success);
    });

    it("should work with allowMultiple", () => {
      const parser = email({
        allowMultiple: true,
        allowedDomains: ["example.com"],
      });

      const result1 = parser.parse("user1@example.com,user2@example.com");
      assert.ok(result1.success);

      const result2 = parser.parse("user1@example.com,user2@other.com");
      assert.ok(!result2.success);
    });
  });

  describe("custom error messages", () => {
    it("should use custom static error message for invalidEmail", () => {
      const parser = email({
        errors: {
          invalidEmail: message`Not a valid email!`,
        },
      });

      const result = parser.parse("invalid");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Not a valid email!" },
      ]);
    });

    it("should use custom error function for invalidEmail", () => {
      const parser = email({
        errors: {
          invalidEmail: (input) => message`Bad email: ${input}`,
        },
      });

      const result = parser.parse("bad@");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Bad email: " },
        { type: "value", value: "bad@" },
      ]);
    });

    it("should use custom error message for domainNotAllowed", () => {
      const parser = email({
        allowedDomains: ["company.com"],
        errors: {
          domainNotAllowed: (email, _domains) =>
            message`Domain not allowed for ${email}`,
        },
      });

      const result = parser.parse("user@other.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Domain not allowed for " },
        { type: "value", value: "user@other.com" },
      ]);
    });
  });

  describe("format()", () => {
    it("should return single email as-is", () => {
      const parser = email();

      assert.strictEqual(parser.format("user@example.com"), "user@example.com");
    });

    it("should return multiple emails joined by comma", () => {
      const parser = email({ allowMultiple: true });

      assert.strictEqual(
        parser.format(["user1@example.com", "user2@example.com"]),
        "user1@example.com,user2@example.com",
      );
    });
  });

  describe("metavar", () => {
    it("should use default metavar EMAIL", () => {
      const parser = email();

      assert.strictEqual(parser.metavar, "EMAIL");
    });

    it("should use custom metavar", () => {
      const parser = email({ metavar: "ADDR" });

      assert.strictEqual(parser.metavar, "ADDR");
    });
  });

  describe("edge cases", () => {
    it("should handle very long email addresses", () => {
      const parser = email();

      const longLocal = "a".repeat(64);
      const result1 = parser.parse(`${longLocal}@example.com`);
      assert.ok(result1.success);
    });

    it("should handle consecutive dots in local part", () => {
      const parser = email();

      // Consecutive dots are technically invalid in simplified RFC
      const result = parser.parse("user..name@example.com");
      assert.ok(!result.success);
    });

    it("should handle local part starting with dot", () => {
      const parser = email();

      const result = parser.parse(".user@example.com");
      assert.ok(!result.success);
    });

    it("should handle local part ending with dot", () => {
      const parser = email();

      const result = parser.parse("user.@example.com");
      assert.ok(!result.success);
    });

    it("should work with mixed options", () => {
      const parser = email({
        allowMultiple: true,
        lowercase: true,
        allowedDomains: ["example.com"],
      });

      const result = parser.parse("User1@Example.COM,User2@Example.COM");
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, [
        "user1@example.com",
        "user2@example.com",
      ]);
    });
  });
});

describe("portRange()", () => {
  describe("basic validation (number type)", () => {
    it("should accept valid port ranges", () => {
      const parser = portRange();

      // Simple range
      const result1 = parser.parse("8000-8080");
      assert.ok(result1.success);
      assert.strictEqual(result1.value.start, 8000);
      assert.strictEqual(result1.value.end, 8080);

      // Same start and end
      const result2 = parser.parse("8080-8080");
      assert.ok(result2.success);
      assert.strictEqual(result2.value.start, 8080);
      assert.strictEqual(result2.value.end, 8080);

      // Full range
      const result3 = parser.parse("1-65535");
      assert.ok(result3.success);
      assert.strictEqual(result3.value.start, 1);
      assert.strictEqual(result3.value.end, 65535);

      // Well-known range
      const result4 = parser.parse("80-443");
      assert.ok(result4.success);
      assert.strictEqual(result4.value.start, 80);
      assert.strictEqual(result4.value.end, 443);
    });

    it("should reject invalid port ranges", () => {
      const parser = portRange();

      // No separator
      const result1 = parser.parse("8000");
      assert.ok(!result1.success);
      assert.deepStrictEqual(result1.error, [
        {
          type: "text",
          text: "Expected a port range in format start-end, but got ",
        },
        { type: "value", value: "8000" },
        { type: "text", text: "." },
      ]);

      // Start > end
      const result2 = parser.parse("8080-8000");
      assert.ok(!result2.success);
      assert.deepStrictEqual(result2.error, [
        { type: "text", text: "Start port " },
        { type: "value", value: "8080" },
        { type: "text", text: " must be less than or equal to end port " },
        { type: "value", value: "8000" },
        { type: "text", text: "." },
      ]);

      // Invalid port number
      const result3 = parser.parse("abc-8080");
      assert.ok(!result3.success);

      // Port out of range
      const result4 = parser.parse("0-8080");
      assert.ok(!result4.success);

      // Port too high
      const result5 = parser.parse("8000-70000");
      assert.ok(!result5.success);

      // Empty string
      const result6 = parser.parse("");
      assert.ok(!result6.success);

      // Multiple separators
      const result7 = parser.parse("8000-8080-9000");
      assert.ok(!result7.success);
    });
  });

  describe("basic validation (bigint type)", () => {
    it("should accept valid port ranges with bigint", () => {
      const parser = portRange({ type: "bigint" });

      const result = parser.parse("8000-8080");
      assert.ok(result.success);
      assert.strictEqual(result.value.start, 8000n);
      assert.strictEqual(result.value.end, 8080n);
    });

    it("should reject invalid ranges with bigint", () => {
      const parser = portRange({ type: "bigint" });

      // Start > end
      const result = parser.parse("8080-8000");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Start port " },
        { type: "value", value: "8080" },
        { type: "text", text: " must be less than or equal to end port " },
        { type: "value", value: "8000" },
        { type: "text", text: "." },
      ]);
    });
  });

  describe("allowSingle option", () => {
    it("should accept single port when allowSingle is true", () => {
      const parser = portRange({ allowSingle: true });

      const result = parser.parse("8080");
      assert.ok(result.success);
      assert.strictEqual(result.value.start, 8080);
      assert.strictEqual(result.value.end, 8080);
    });

    it("should reject single port when allowSingle is false", () => {
      const parser = portRange({ allowSingle: false });

      const result = parser.parse("8080");
      assert.ok(!result.success);
    });

    it("should work with bigint type", () => {
      const parser = portRange({ type: "bigint", allowSingle: true });

      const result = parser.parse("8080");
      assert.ok(result.success);
      assert.strictEqual(result.value.start, 8080n);
      assert.strictEqual(result.value.end, 8080n);
    });
  });

  describe("separator option", () => {
    it("should use custom separator", () => {
      const parser = portRange({ separator: ":" });

      const result = parser.parse("8000:8080");
      assert.ok(result.success);
      assert.strictEqual(result.value.start, 8000);
      assert.strictEqual(result.value.end, 8080);
    });

    it("should reject input with wrong separator", () => {
      const parser = portRange({ separator: ":" });

      const result = parser.parse("8000-8080");
      assert.ok(!result.success);
    });

    it("should work with multi-character separator", () => {
      const parser = portRange({ separator: " to " });

      const result = parser.parse("8000 to 8080");
      assert.ok(result.success);
      assert.strictEqual(result.value.start, 8000);
      assert.strictEqual(result.value.end, 8080);
    });
  });

  describe("min and max options", () => {
    it("should enforce minimum port", () => {
      const parser = portRange({ min: 1024 });

      // Below minimum
      const result1 = parser.parse("80-8080");
      assert.ok(!result1.success);

      // At minimum
      const result2 = parser.parse("1024-8080");
      assert.ok(result2.success);
    });

    it("should enforce maximum port", () => {
      const parser = portRange({ max: 9000 });

      // Above maximum
      const result1 = parser.parse("8000-10000");
      assert.ok(!result1.success);

      // At maximum
      const result2 = parser.parse("8000-9000");
      assert.ok(result2.success);
    });

    it("should apply to both start and end ports", () => {
      const parser = portRange({ min: 1024, max: 9000 });

      // Start below minimum
      const result1 = parser.parse("80-8080");
      assert.ok(!result1.success);

      // End above maximum
      const result2 = parser.parse("8000-10000");
      assert.ok(!result2.success);

      // Both in range
      const result3 = parser.parse("1024-9000");
      assert.ok(result3.success);
    });

    it("should work with bigint type", () => {
      const parser = portRange({ type: "bigint", min: 1024n, max: 9000n });

      const result1 = parser.parse("80-8080");
      assert.ok(!result1.success);

      const result2 = parser.parse("1024-9000");
      assert.ok(result2.success);
      assert.strictEqual(result2.value.start, 1024n);
      assert.strictEqual(result2.value.end, 9000n);
    });
  });

  describe("disallowWellKnown option", () => {
    it("should reject well-known ports when disallowWellKnown is true", () => {
      const parser = portRange({ disallowWellKnown: true });

      // Both well-known
      const result1 = parser.parse("80-443");
      assert.ok(!result1.success);

      // Start well-known
      const result2 = parser.parse("80-8080");
      assert.ok(!result2.success);

      // End well-known
      const result3 = parser.parse("8000-443");
      assert.ok(!result3.success);

      // Both non-well-known
      const result4 = parser.parse("1024-8080");
      assert.ok(result4.success);
    });

    it("should work with bigint type", () => {
      const parser = portRange({ type: "bigint", disallowWellKnown: true });

      const result1 = parser.parse("80-443");
      assert.ok(!result1.success);

      const result2 = parser.parse("1024-8080");
      assert.ok(result2.success);
    });
  });

  describe("custom error messages", () => {
    it("should use custom static error message for invalidFormat", () => {
      const parser = portRange({
        errors: {
          invalidFormat: message`Bad port range format`,
        },
      });

      // Single port without allowSingle triggers invalidFormat
      const result = parser.parse("8080");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Bad port range format" },
      ]);
    });

    it("should use custom error function for invalidFormat", () => {
      const parser = portRange({
        errors: {
          invalidFormat: (input) => message`Cannot parse: ${input}`,
        },
      });

      const result = parser.parse("abc");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Cannot parse: " },
        { type: "value", value: "abc" },
      ]);
    });

    it("should use custom error message for invalidRange", () => {
      const parser = portRange({
        errors: {
          invalidRange: (start, end) =>
            message`Range error: ${start.toString()} > ${end.toString()}`,
        },
      });

      const result = parser.parse("8080-8000");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Range error: " },
        { type: "value", value: "8080" },
        { type: "text", text: " > " },
        { type: "value", value: "8000" },
      ]);
    });

    it("should use custom error for port validation", () => {
      const parser = portRange({
        min: 1024,
        errors: {
          belowMinimum: (port, min) =>
            message`Port ${port.toString()} is too low (min: ${min.toString()})`,
        },
      });

      const result = parser.parse("80-8080");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Port " },
        { type: "value", value: "80" },
        { type: "text", text: " is too low (min: " },
        { type: "value", value: "1024" },
        { type: "text", text: ")" },
      ]);
    });
  });

  describe("format()", () => {
    it("should return port range in start-end format", () => {
      const parser = portRange();

      const formatted = parser.format({ start: 8000, end: 8080 });
      assert.strictEqual(formatted, "8000-8080");
    });

    it("should use custom separator in format", () => {
      const parser = portRange({ separator: ":" });

      const formatted = parser.format({ start: 8000, end: 8080 });
      assert.strictEqual(formatted, "8000:8080");
    });

    it("should work with bigint values", () => {
      const parser = portRange({ type: "bigint" });

      const formatted = parser.format({ start: 8000n, end: 8080n });
      assert.strictEqual(formatted, "8000-8080");
    });

    it("should handle single port (same start and end)", () => {
      const parser = portRange({ allowSingle: true });

      const formatted = parser.format({ start: 8080, end: 8080 });
      assert.strictEqual(formatted, "8080-8080");
    });
  });

  describe("metavar", () => {
    it("should use default metavar PORT-PORT", () => {
      const parser = portRange();
      assert.strictEqual(parser.metavar, "PORT-PORT");
    });

    it("should use custom metavar", () => {
      const parser = portRange({ metavar: "RANGE" });
      assert.strictEqual(parser.metavar, "RANGE");
    });
  });

  describe("edge cases", () => {
    it("should handle minimum port range (1-1)", () => {
      const parser = portRange({ allowSingle: true });

      const result = parser.parse("1");
      assert.ok(result.success);
      assert.strictEqual(result.value.start, 1);
      assert.strictEqual(result.value.end, 1);
    });

    it("should handle maximum port range (65535-65535)", () => {
      const parser = portRange({ allowSingle: true });

      const result = parser.parse("65535");
      assert.ok(result.success);
      assert.strictEqual(result.value.start, 65535);
      assert.strictEqual(result.value.end, 65535);
    });

    it("should handle wide range (1-65535)", () => {
      const parser = portRange();

      const result = parser.parse("1-65535");
      assert.ok(result.success);
      assert.strictEqual(result.value.start, 1);
      assert.strictEqual(result.value.end, 65535);
    });

    it("should work with mixed options", () => {
      const parser = portRange({
        allowSingle: true,
        min: 1024,
        max: 65535,
        disallowWellKnown: true,
      });

      // Single port in range
      const result1 = parser.parse("8080");
      assert.ok(result1.success);

      // Range in bounds
      const result2 = parser.parse("1024-9000");
      assert.ok(result2.success);

      // Well-known port rejected
      const result3 = parser.parse("80-443");
      assert.ok(!result3.success);
    });
  });
});

describe("socketAddress()", () => {
  describe("basic validation", () => {
    it("should accept valid socket addresses", () => {
      const parser = socketAddress({ defaultPort: 8080 });

      // Hostname with port
      const result1 = parser.parse("localhost:3000");
      assert.ok(result1.success);
      assert.strictEqual(result1.value.host, "localhost");
      assert.strictEqual(result1.value.port, 3000);

      // Hostname without port (uses default)
      const result2 = parser.parse("example.com");
      assert.ok(result2.success);
      assert.strictEqual(result2.value.host, "example.com");
      assert.strictEqual(result2.value.port, 8080);

      // IPv4 with port
      const result3 = parser.parse("192.168.1.1:80");
      assert.ok(result3.success);
      assert.strictEqual(result3.value.host, "192.168.1.1");
      assert.strictEqual(result3.value.port, 80);

      // IPv4 without port
      const result4 = parser.parse("10.0.0.1");
      assert.ok(result4.success);
      assert.strictEqual(result4.value.host, "10.0.0.1");
      assert.strictEqual(result4.value.port, 8080);

      // Subdomain with port
      const result5 = parser.parse("api.example.com:443");
      assert.ok(result5.success);
      assert.strictEqual(result5.value.host, "api.example.com");
      assert.strictEqual(result5.value.port, 443);
    });

    it("should reject invalid socket addresses", () => {
      const parser = socketAddress({ defaultPort: 8080 });

      // Invalid hostname
      const result1 = parser.parse("-invalid.com:80");
      assert.ok(!result1.success);

      // Invalid port (too high)
      const result2 = parser.parse("example.com:70000");
      assert.ok(!result2.success);

      // Invalid port (not a number)
      const result3 = parser.parse("example.com:abc");
      assert.ok(!result3.success);

      // Empty string
      const result4 = parser.parse("");
      assert.ok(!result4.success);

      // Only port
      const result5 = parser.parse(":8080");
      assert.ok(!result5.success);
    });
  });

  describe("requirePort option", () => {
    it("should require port when requirePort is true", () => {
      const parser = socketAddress({ requirePort: true });

      // With port - valid
      const result1 = parser.parse("localhost:3000");
      assert.ok(result1.success);
      assert.strictEqual(result1.value.host, "localhost");
      assert.strictEqual(result1.value.port, 3000);

      // Without port - invalid
      const result2 = parser.parse("localhost");
      assert.ok(!result2.success);
      assert.deepStrictEqual(result2.error, [
        {
          type: "text",
          text: "Port number is required but was not specified.",
        },
      ]);
    });

    it("should allow omitting port when requirePort is false and defaultPort is set", () => {
      const parser = socketAddress({ requirePort: false, defaultPort: 80 });

      const result = parser.parse("example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "example.com");
      assert.strictEqual(result.value.port, 80);
    });

    it("should reject missing port when no defaultPort and requirePort is false", () => {
      const parser = socketAddress({ requirePort: false });

      const result = parser.parse("example.com");
      assert.ok(!result.success);
    });
  });

  describe("separator option", () => {
    it("should use custom separator", () => {
      const parser = socketAddress({ separator: " " });

      const result = parser.parse("localhost 3000");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "localhost");
      assert.strictEqual(result.value.port, 3000);
    });

    it("should reject input with wrong separator", () => {
      const parser = socketAddress({ separator: " " });

      const result = parser.parse("localhost:3000");
      assert.ok(!result.success);
    });
  });

  describe("host.type option", () => {
    it("should accept only hostnames when type is hostname", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "hostname" },
      });

      // Hostname - valid
      const result1 = parser.parse("example.com:443");
      assert.ok(result1.success);
      assert.strictEqual(result1.value.host, "example.com");

      // IPv4 - invalid
      const result2 = parser.parse("192.168.1.1:80");
      assert.ok(!result2.success);
    });

    it("should accept only IPs when type is ip", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "ip" },
      });

      // IPv4 - valid
      const result1 = parser.parse("192.168.1.1:80");
      assert.ok(result1.success);
      assert.strictEqual(result1.value.host, "192.168.1.1");

      // Hostname - invalid
      const result2 = parser.parse("example.com:443");
      assert.ok(!result2.success);
    });

    it("should accept both hostnames and IPs when type is both", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both" },
      });

      // Hostname
      const result1 = parser.parse("example.com:443");
      assert.ok(result1.success);

      // IPv4
      const result2 = parser.parse("192.168.1.1:80");
      assert.ok(result2.success);
    });
  });

  describe("host options propagation", () => {
    it("should pass hostname options to hostname parser", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: {
          type: "hostname",
          hostname: { allowLocalhost: false },
        },
      });

      // localhost rejected
      const result1 = parser.parse("localhost:80");
      assert.ok(!result1.success);

      // Regular hostname accepted
      const result2 = parser.parse("example.com:80");
      assert.ok(result2.success);
    });

    it("should pass IP options to IP parser", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: {
          type: "ip",
          ip: { allowPrivate: false },
        },
      });

      // Private IP rejected
      const result1 = parser.parse("192.168.1.1:80");
      assert.ok(!result1.success);

      // Public IP accepted
      const result2 = parser.parse("8.8.8.8:80");
      assert.ok(result2.success);
    });
  });

  describe("port options propagation", () => {
    it("should pass port options to port parser", () => {
      const parser = socketAddress({
        defaultPort: 8080,
        port: { min: 1024, max: 65535 },
      });

      // Port too low
      const result1 = parser.parse("localhost:80");
      assert.ok(!result1.success);

      // Port in range
      const result2 = parser.parse("localhost:8080");
      assert.ok(result2.success);
    });

    it("should disallow well-known ports when configured", () => {
      const parser = socketAddress({
        defaultPort: 8080,
        port: { disallowWellKnown: true },
      });

      // Well-known port rejected
      const result1 = parser.parse("localhost:80");
      assert.ok(!result1.success);

      // Non-well-known port accepted
      const result2 = parser.parse("localhost:8080");
      assert.ok(result2.success);
    });
  });

  describe("custom error messages", () => {
    it("should use custom static error message for invalidFormat", () => {
      const parser = socketAddress({
        requirePort: true,
        errors: {
          invalidFormat: message`Bad socket address format`,
        },
      });

      // Invalid hostname with port
      const result = parser.parse("-invalid:8080");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Bad socket address format" },
      ]);
    });

    it("should use custom error function for invalidFormat", () => {
      const parser = socketAddress({
        requirePort: true,
        errors: {
          invalidFormat: (input) => message`Cannot parse: ${input}`,
        },
      });

      const result = parser.parse("bad:format:here");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Cannot parse: " },
        { type: "value", value: "bad:format:here" },
      ]);
    });

    it("should use custom error message for missingPort", () => {
      const parser = socketAddress({
        requirePort: true,
        errors: {
          missingPort: message`You must specify a port`,
        },
      });

      const result = parser.parse("localhost");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "You must specify a port" },
      ]);
    });
  });

  describe("format()", () => {
    it("should return socket address in host:port format", () => {
      const parser = socketAddress({ defaultPort: 80 });

      const formatted = parser.format({ host: "example.com", port: 443 });
      assert.strictEqual(formatted, "example.com:443");
    });

    it("should use custom separator in format", () => {
      const parser = socketAddress({ separator: " ", defaultPort: 80 });

      const formatted = parser.format({ host: "localhost", port: 3000 });
      assert.strictEqual(formatted, "localhost 3000");
    });
  });

  describe("metavar", () => {
    it("should use default metavar HOST:PORT", () => {
      const parser = socketAddress({ defaultPort: 80 });
      assert.strictEqual(parser.metavar, "HOST:PORT");
    });

    it("should use custom metavar", () => {
      const parser = socketAddress({ defaultPort: 80, metavar: "ENDPOINT" });
      assert.strictEqual(parser.metavar, "ENDPOINT");
    });
  });

  describe("edge cases", () => {
    it("should handle very high port numbers within range", () => {
      const parser = socketAddress({ defaultPort: 8080 });

      const result = parser.parse("localhost:65535");
      assert.ok(result.success);
      assert.strictEqual(result.value.port, 65535);
    });

    it("should handle port 1", () => {
      const parser = socketAddress({ defaultPort: 8080 });

      const result = parser.parse("localhost:1");
      assert.ok(result.success);
      assert.strictEqual(result.value.port, 1);
    });

    it("should handle complex hostnames", () => {
      const parser = socketAddress({ defaultPort: 80 });

      const result = parser.parse("very.long.subdomain.example.com:443");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "very.long.subdomain.example.com");
      assert.strictEqual(result.value.port, 443);
    });

    it("should work with mixed options", () => {
      const parser = socketAddress({
        defaultPort: 8080,
        host: {
          type: "both",
          hostname: { allowLocalhost: true },
          ip: { allowPrivate: true },
        },
        port: { min: 1024 },
      });

      const result1 = parser.parse("localhost:3000");
      assert.ok(result1.success);

      const result2 = parser.parse("192.168.1.1:8080");
      assert.ok(result2.success);

      const result3 = parser.parse("example.com");
      assert.ok(result3.success);
      assert.strictEqual(result3.value.port, 8080);
    });
  });
});

describe("macAddress()", () => {
  describe("basic validation with any separator", () => {
    it("should accept colon-separated MAC addresses", () => {
      const parser = macAddress();

      const result = parser.parse("00:1A:2B:3C:4D:5E");
      assert.ok(result.success);
      assert.strictEqual(result.value, "00:1A:2B:3C:4D:5E");
    });

    it("should accept lowercase colon-separated", () => {
      const parser = macAddress();

      const result = parser.parse("00:1a:2b:3c:4d:5e");
      assert.ok(result.success);
      assert.strictEqual(result.value, "00:1a:2b:3c:4d:5e");
    });

    it("should accept hyphen-separated MAC addresses", () => {
      const parser = macAddress();

      const result = parser.parse("00-1A-2B-3C-4D-5E");
      assert.ok(result.success);
      assert.strictEqual(result.value, "00-1A-2B-3C-4D-5E");
    });

    it("should accept dot-separated MAC addresses (Cisco format)", () => {
      const parser = macAddress();

      const result = parser.parse("001A.2B3C.4D5E");
      assert.ok(result.success);
      assert.strictEqual(result.value, "001A.2B3C.4D5E");
    });

    it("should accept dot-separated with lowercase", () => {
      const parser = macAddress();

      const result = parser.parse("001a.2b3c.4d5e");
      assert.ok(result.success);
      assert.strictEqual(result.value, "001a.2b3c.4d5e");
    });

    it("should accept no separator", () => {
      const parser = macAddress();

      const result = parser.parse("001A2B3C4D5E");
      assert.ok(result.success);
      assert.strictEqual(result.value, "001A2B3C4D5E");
    });

    it("should accept single-digit octets with colons", () => {
      const parser = macAddress();

      const result = parser.parse("0:1:2:3:4:5");
      assert.ok(result.success);
      assert.strictEqual(result.value, "0:1:2:3:4:5");
    });
  });

  describe("separator option", () => {
    it("should only accept colon-separated when separator is :", () => {
      const parser = macAddress({ separator: ":" });

      const result1 = parser.parse("00:1A:2B:3C:4D:5E");
      assert.ok(result1.success);

      const result2 = parser.parse("00-1A-2B-3C-4D-5E");
      assert.ok(!result2.success);

      const result3 = parser.parse("001A.2B3C.4D5E");
      assert.ok(!result3.success);

      const result4 = parser.parse("001A2B3C4D5E");
      assert.ok(!result4.success);
    });

    it("should only accept hyphen-separated when separator is -", () => {
      const parser = macAddress({ separator: "-" });

      const result1 = parser.parse("00-1A-2B-3C-4D-5E");
      assert.ok(result1.success);

      const result2 = parser.parse("00:1A:2B:3C:4D:5E");
      assert.ok(!result2.success);
    });

    it("should only accept dot-separated when separator is .", () => {
      const parser = macAddress({ separator: "." });

      const result1 = parser.parse("001A.2B3C.4D5E");
      assert.ok(result1.success);

      const result2 = parser.parse("00:1A:2B:3C:4D:5E");
      assert.ok(!result2.success);
    });

    it("should only accept no separator when separator is none", () => {
      const parser = macAddress({ separator: "none" });

      const result1 = parser.parse("001A2B3C4D5E");
      assert.ok(result1.success);

      const result2 = parser.parse("00:1A:2B:3C:4D:5E");
      assert.ok(!result2.success);
    });
  });

  describe("case option", () => {
    it("should preserve case by default", () => {
      const parser = macAddress();

      const result1 = parser.parse("00:1A:2B:3C:4D:5E");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "00:1A:2B:3C:4D:5E");

      const result2 = parser.parse("00:1a:2b:3c:4d:5e");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "00:1a:2b:3c:4d:5e");
    });

    it("should convert to uppercase when case is upper", () => {
      const parser = macAddress({ case: "upper" });

      const result1 = parser.parse("00:1a:2b:3c:4d:5e");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "00:1A:2B:3C:4D:5E");

      const result2 = parser.parse("00-1a-2b-3c-4d-5e");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "00-1A-2B-3C-4D-5E");

      const result3 = parser.parse("001a.2b3c.4d5e");
      assert.ok(result3.success);
      assert.strictEqual(result3.value, "001A.2B3C.4D5E");
    });

    it("should convert to lowercase when case is lower", () => {
      const parser = macAddress({ case: "lower" });

      const result1 = parser.parse("00:1A:2B:3C:4D:5E");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "00:1a:2b:3c:4d:5e");

      const result2 = parser.parse("00-1A-2B-3C-4D-5E");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "00-1a-2b-3c-4d-5e");
    });
  });

  describe("outputSeparator option", () => {
    it("should normalize to colon separator", () => {
      const parser = macAddress({ outputSeparator: ":" });

      const result1 = parser.parse("00:1A:2B:3C:4D:5E");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "00:1A:2B:3C:4D:5E");

      const result2 = parser.parse("00-1A-2B-3C-4D-5E");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "00:1A:2B:3C:4D:5E");

      const result3 = parser.parse("001A.2B3C.4D5E");
      assert.ok(result3.success);
      assert.strictEqual(result3.value, "00:1A:2B:3C:4D:5E");

      const result4 = parser.parse("001A2B3C4D5E");
      assert.ok(result4.success);
      assert.strictEqual(result4.value, "00:1A:2B:3C:4D:5E");
    });

    it("should normalize to hyphen separator", () => {
      const parser = macAddress({ outputSeparator: "-" });

      const result1 = parser.parse("00:1A:2B:3C:4D:5E");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "00-1A-2B-3C-4D-5E");

      const result2 = parser.parse("001A.2B3C.4D5E");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "00-1A-2B-3C-4D-5E");
    });

    it("should normalize to dot separator (Cisco format)", () => {
      const parser = macAddress({ outputSeparator: "." });

      const result1 = parser.parse("00:1A:2B:3C:4D:5E");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "001A.2B3C.4D5E");

      const result2 = parser.parse("00-1A-2B-3C-4D-5E");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "001A.2B3C.4D5E");

      const result3 = parser.parse("001A2B3C4D5E");
      assert.ok(result3.success);
      assert.strictEqual(result3.value, "001A.2B3C.4D5E");
    });

    it("should normalize to no separator", () => {
      const parser = macAddress({ outputSeparator: "none" });

      const result1 = parser.parse("00:1A:2B:3C:4D:5E");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "001A2B3C4D5E");

      const result2 = parser.parse("001A.2B3C.4D5E");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "001A2B3C4D5E");
    });

    it("should combine outputSeparator with case conversion", () => {
      const parser = macAddress({ outputSeparator: ":", case: "upper" });

      const result = parser.parse("00-1a-2b-3c-4d-5e");
      assert.ok(result.success);
      assert.strictEqual(result.value, "00:1A:2B:3C:4D:5E");
    });
  });

  describe("invalid input", () => {
    it("should reject non-hex characters", () => {
      const parser = macAddress();

      const result = parser.parse("00:1G:2B:3C:4D:5E");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepStrictEqual(result.error, [
          { type: "text", text: "Expected a valid MAC address, but got " },
          { type: "value", value: "00:1G:2B:3C:4D:5E" },
          { type: "text", text: "." },
        ]);
      }
    });

    it("should reject too few octets", () => {
      const parser = macAddress();

      const result = parser.parse("00:1A:2B:3C:4D");
      assert.ok(!result.success);
    });

    it("should reject too many octets", () => {
      const parser = macAddress();

      const result = parser.parse("00:1A:2B:3C:4D:5E:FF");
      assert.ok(!result.success);
    });

    it("should reject invalid dot format (not 3 groups)", () => {
      const parser = macAddress();

      const result = parser.parse("001A.2B3C");
      assert.ok(!result.success);
    });

    it("should reject invalid dot format (wrong group size)", () => {
      const parser = macAddress();

      const result = parser.parse("001A.2B3.C4D5E");
      assert.ok(!result.success);
    });

    it("should reject mixed separators", () => {
      const parser = macAddress();

      const result = parser.parse("00:1A-2B:3C:4D:5E");
      assert.ok(!result.success);
    });

    it("should reject empty string", () => {
      const parser = macAddress();

      const result = parser.parse("");
      assert.ok(!result.success);
    });

    it("should reject octets > FF", () => {
      const parser = macAddress();

      const result = parser.parse("00:1A:2B:3C:4D:1FF");
      assert.ok(!result.success);
    });
  });

  describe("custom error messages", () => {
    it("should use custom static error message", () => {
      const parser = macAddress({
        errors: {
          invalidMacAddress: message`Not a valid MAC address`,
        },
      });

      const result = parser.parse("invalid");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepStrictEqual(result.error, [
          { type: "text", text: "Not a valid MAC address" },
        ]);
      }
    });

    it("should use custom function error message", () => {
      const parser = macAddress({
        errors: {
          invalidMacAddress: (input) => message`Invalid MAC: ${text(input)}`,
        },
      });

      const result = parser.parse("00:1G:2B");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepStrictEqual(result.error, [
          { type: "text", text: "Invalid MAC: " },
          { type: "text", text: "00:1G:2B" },
        ]);
      }
    });
  });

  describe("metavar", () => {
    it("should return default metavar", () => {
      const parser = macAddress();
      assert.strictEqual(parser.metavar, "MAC");
    });

    it("should return custom metavar", () => {
      const parser = macAddress({ metavar: "MAC_ADDR" });
      assert.strictEqual(parser.metavar, "MAC_ADDR");
    });
  });

  describe("edge cases", () => {
    it("should handle all zeros", () => {
      const parser = macAddress();

      const result = parser.parse("00:00:00:00:00:00");
      assert.ok(result.success);
      assert.strictEqual(result.value, "00:00:00:00:00:00");
    });

    it("should handle all Fs", () => {
      const parser = macAddress();

      const result = parser.parse("FF:FF:FF:FF:FF:FF");
      assert.ok(result.success);
      assert.strictEqual(result.value, "FF:FF:FF:FF:FF:FF");
    });

    it("should handle single-digit octets in all positions", () => {
      const parser = macAddress();

      const result = parser.parse("0:1:2:3:4:5");
      assert.ok(result.success);
      assert.strictEqual(result.value, "0:1:2:3:4:5");
    });

    it("should normalize single-digit octets with outputSeparator", () => {
      const parser = macAddress({ outputSeparator: ":" });

      const result = parser.parse("0:1:2:3:4:5");
      assert.ok(result.success);
      assert.strictEqual(result.value, "0:1:2:3:4:5");
    });

    it("should handle mixed case input with case conversion", () => {
      const parser = macAddress({ case: "upper" });

      const result = parser.parse("aA:bB:cC:dD:eE:fF");
      assert.ok(result.success);
      assert.strictEqual(result.value, "AA:BB:CC:DD:EE:FF");
    });
  });
});

describe("domain()", () => {
  describe("basic validation", () => {
    it("should accept valid root domain", () => {
      const parser = domain();
      const result = parser.parse("example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "example.com");
    });

    it("should accept subdomain by default", () => {
      const parser = domain();
      const result = parser.parse("www.example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "www.example.com");
    });

    it("should accept multi-level subdomain", () => {
      const parser = domain();
      const result = parser.parse("api.staging.example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "api.staging.example.com");
    });

    it("should accept domain with numbers", () => {
      const parser = domain();
      const result = parser.parse("test123.example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "test123.example.com");
    });

    it("should accept domain with hyphens", () => {
      const parser = domain();
      const result = parser.parse("my-domain.example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "my-domain.example.com");
    });
  });

  describe("allowSubdomains option", () => {
    it("should accept root domain when allowSubdomains is false", () => {
      const parser = domain({ allowSubdomains: false });
      const result = parser.parse("example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "example.com");
    });

    it("should reject subdomain when allowSubdomains is false", () => {
      const parser = domain({ allowSubdomains: false });
      const result = parser.parse("www.example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Subdomains are not allowed, but got " },
        { type: "value", value: "www.example.com" },
        { type: "text", text: "." },
      ]);
    });

    it("should reject multi-level subdomain when allowSubdomains is false", () => {
      const parser = domain({ allowSubdomains: false });
      const result = parser.parse("api.staging.example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Subdomains are not allowed, but got " },
        { type: "value", value: "api.staging.example.com" },
        { type: "text", text: "." },
      ]);
    });
  });

  describe("allowedTLDs option", () => {
    it("should accept domain with allowed TLD", () => {
      const parser = domain({ allowedTLDs: ["com", "org", "net"] });
      const result = parser.parse("example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "example.com");
    });

    it("should accept domain with allowed TLD (case-insensitive)", () => {
      const parser = domain({ allowedTLDs: ["com", "org", "net"] });
      const result = parser.parse("example.COM");
      assert.ok(result.success);
      assert.strictEqual(result.value, "example.COM");
    });

    it("should reject domain with disallowed TLD", () => {
      const parser = domain({ allowedTLDs: ["com", "org", "net"] });
      const result = parser.parse("example.io");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Top-level domain " },
        { type: "value", value: "io" },
        {
          type: "text",
          text: " is not allowed. Allowed TLDs: com, org, net.",
        },
      ]);
    });

    it("should accept subdomain with allowed TLD", () => {
      const parser = domain({ allowedTLDs: ["com", "org"] });
      const result = parser.parse("www.example.org");
      assert.ok(result.success);
      assert.strictEqual(result.value, "www.example.org");
    });
  });

  describe("minLabels option", () => {
    it("should accept domain with exact minLabels", () => {
      const parser = domain({ minLabels: 2 });
      const result = parser.parse("example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "example.com");
    });

    it("should accept domain with more than minLabels", () => {
      const parser = domain({ minLabels: 2 });
      const result = parser.parse("www.example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "www.example.com");
    });

    it("should reject domain with fewer than minLabels", () => {
      const parser = domain({ minLabels: 3 });
      const result = parser.parse("example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Domain " },
        { type: "value", value: "example.com" },
        { type: "text", text: " must have at least 3 labels." },
      ]);
    });

    it("should accept single label domain with minLabels: 1", () => {
      const parser = domain({ minLabels: 1 });
      const result = parser.parse("localhost");
      assert.ok(result.success);
      assert.strictEqual(result.value, "localhost");
    });

    it("should reject single label domain by default (minLabels: 2)", () => {
      const parser = domain();
      const result = parser.parse("localhost");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Domain " },
        { type: "value", value: "localhost" },
        { type: "text", text: " must have at least 2 labels." },
      ]);
    });
  });

  describe("lowercase option", () => {
    it("should preserve case by default", () => {
      const parser = domain();
      const result = parser.parse("Example.COM");
      assert.ok(result.success);
      assert.strictEqual(result.value, "Example.COM");
    });

    it("should convert to lowercase when lowercase is true", () => {
      const parser = domain({ lowercase: true });
      const result = parser.parse("Example.COM");
      assert.ok(result.success);
      assert.strictEqual(result.value, "example.com");
    });

    it("should convert subdomain to lowercase", () => {
      const parser = domain({ lowercase: true });
      const result = parser.parse("WWW.Example.COM");
      assert.ok(result.success);
      assert.strictEqual(result.value, "www.example.com");
    });
  });

  describe("invalid domains", () => {
    it("should reject empty string", () => {
      const parser = domain();
      const result = parser.parse("");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid domain name, but got " },
        { type: "value", value: "" },
        { type: "text", text: "." },
      ]);
    });

    it("should reject domain starting with dot", () => {
      const parser = domain();
      const result = parser.parse(".example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid domain name, but got " },
        { type: "value", value: ".example.com" },
        { type: "text", text: "." },
      ]);
    });

    it("should reject domain ending with dot", () => {
      const parser = domain();
      const result = parser.parse("example.com.");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid domain name, but got " },
        { type: "value", value: "example.com." },
        { type: "text", text: "." },
      ]);
    });

    it("should reject label starting with hyphen", () => {
      const parser = domain();
      const result = parser.parse("-example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid domain name, but got " },
        { type: "value", value: "-example.com" },
        { type: "text", text: "." },
      ]);
    });

    it("should reject label ending with hyphen", () => {
      const parser = domain();
      const result = parser.parse("example-.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid domain name, but got " },
        { type: "value", value: "example-.com" },
        { type: "text", text: "." },
      ]);
    });

    it("should reject label with special characters", () => {
      const parser = domain();
      const result = parser.parse("exam_ple.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid domain name, but got " },
        { type: "value", value: "exam_ple.com" },
        { type: "text", text: "." },
      ]);
    });

    it("should reject label longer than 63 characters", () => {
      const parser = domain();
      const longLabel = "a".repeat(64);
      const result = parser.parse(`${longLabel}.com`);
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid domain name, but got " },
        { type: "value", value: `${longLabel}.com` },
        { type: "text", text: "." },
      ]);
    });

    it("should reject consecutive dots", () => {
      const parser = domain();
      const result = parser.parse("example..com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid domain name, but got " },
        { type: "value", value: "example..com" },
        { type: "text", text: "." },
      ]);
    });

    it("should reject domain with spaces", () => {
      const parser = domain();
      const result = parser.parse("example .com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid domain name, but got " },
        { type: "value", value: "example .com" },
        { type: "text", text: "." },
      ]);
    });
  });

  describe("custom error messages", () => {
    it("should use custom invalidDomain message", () => {
      const parser = domain({
        errors: {
          invalidDomain: (input) => message`Domain ${text(input)} is not valid`,
        },
      });

      const result = parser.parse("invalid..domain");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Domain " },
        { type: "text", text: "invalid..domain" },
        { type: "text", text: " is not valid" },
      ]);
    });

    it("should use custom subdomainsNotAllowed message", () => {
      const parser = domain({
        allowSubdomains: false,
        errors: {
          subdomainsNotAllowed: (domain) =>
            message`Root domains only. Got: ${text(domain)}`,
        },
      });

      const result = parser.parse("www.example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Root domains only. Got: " },
        { type: "text", text: "www.example.com" },
      ]);
    });

    it("should use custom tldNotAllowed message", () => {
      const parser = domain({
        allowedTLDs: ["com", "org"],
        errors: {
          tldNotAllowed: (tld, allowed) =>
            message`${text(tld)} not in ${text(allowed.join(", "))}`,
        },
      });

      const result = parser.parse("example.io");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "io" },
        { type: "text", text: " not in " },
        { type: "text", text: "com, org" },
      ]);
    });

    it("should use custom tooFewLabels message", () => {
      const parser = domain({
        minLabels: 3,
        errors: {
          tooFewLabels: (domain, min) =>
            message`${text(domain)} needs ${text(min.toString())} labels`,
        },
      });

      const result = parser.parse("example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "example.com" },
        { type: "text", text: " needs " },
        { type: "text", text: "3" },
        { type: "text", text: " labels" },
      ]);
    });
  });

  describe("metavar", () => {
    it("should return default metavar", () => {
      const parser = domain();
      assert.strictEqual(parser.metavar, "DOMAIN");
    });

    it("should return custom metavar", () => {
      const parser = domain({ metavar: "DOMAIN_NAME" });
      assert.strictEqual(parser.metavar, "DOMAIN_NAME");
    });
  });

  describe("edge cases", () => {
    it("should accept maximum label length (63 characters)", () => {
      const parser = domain();
      const maxLabel = "a".repeat(63);
      const result = parser.parse(`${maxLabel}.com`);
      assert.ok(result.success);
      assert.strictEqual(result.value, `${maxLabel}.com`);
    });

    it("should accept numeric-only labels except TLD", () => {
      const parser = domain();
      const result = parser.parse("123.456.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "123.456.com");
    });

    it("should accept all-numeric TLD", () => {
      const parser = domain({ minLabels: 1 });
      const result = parser.parse("example.123");
      assert.ok(result.success);
      assert.strictEqual(result.value, "example.123");
    });

    it("should work with allowSubdomains and allowedTLDs together", () => {
      const parser = domain({
        allowSubdomains: false,
        allowedTLDs: ["com", "org"],
      });
      const result = parser.parse("example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "example.com");
    });

    it("should reject subdomain with restricted TLDs", () => {
      const parser = domain({
        allowSubdomains: false,
        allowedTLDs: ["com", "org"],
      });
      const result = parser.parse("www.example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Subdomains are not allowed, but got " },
        { type: "value", value: "www.example.com" },
        { type: "text", text: "." },
      ]);
    });

    it("should work with all options combined", () => {
      const parser = domain({
        allowSubdomains: true,
        allowedTLDs: ["com", "org", "net"],
        minLabels: 2,
        lowercase: true,
      });
      const result = parser.parse("API.Example.COM");
      assert.ok(result.success);
      assert.strictEqual(result.value, "api.example.com");
    });
  });
});

describe("ipv6()", () => {
  describe("basic validation", () => {
    it("should accept full IPv6 address", () => {
      const parser = ipv6();
      const result = parser.parse("2001:0db8:85a3:0000:0000:8a2e:0370:7334");
      assert.ok(result.success);
      assert.strictEqual(result.value, "2001:db8:85a3::8a2e:370:7334");
    });

    it("should accept compressed IPv6 address", () => {
      const parser = ipv6();
      const result = parser.parse("2001:db8::8a2e:370:7334");
      assert.ok(result.success);
      assert.strictEqual(result.value, "2001:db8::8a2e:370:7334");
    });

    it("should accept loopback address", () => {
      const parser = ipv6();
      const result = parser.parse("::1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "::1");
    });

    it("should accept zero address", () => {
      const parser = ipv6();
      const result = parser.parse("::");
      assert.ok(result.success);
      assert.strictEqual(result.value, "::");
    });

    it("should normalize to lowercase", () => {
      const parser = ipv6();
      const result = parser.parse("2001:DB8:85A3::8A2E:370:7334");
      assert.ok(result.success);
      assert.strictEqual(result.value, "2001:db8:85a3::8a2e:370:7334");
    });

    it("should accept link-local address", () => {
      const parser = ipv6();
      const result = parser.parse("fe80::1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "fe80::1");
    });

    it("should accept unique local address", () => {
      const parser = ipv6();
      const result = parser.parse("fc00::1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "fc00::1");
    });

    it("should accept multicast address", () => {
      const parser = ipv6();
      const result = parser.parse("ff02::1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "ff02::1");
    });

    it("should accept IPv4-mapped IPv6 address", () => {
      const parser = ipv6();
      const result = parser.parse("::ffff:192.0.2.1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "::ffff:c000:201");
    });
  });

  describe("allowLoopback option", () => {
    it("should reject loopback when allowLoopback is false", () => {
      const parser = ipv6({ allowLoopback: false });
      const result = parser.parse("::1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::1" },
        { type: "text", text: " is a loopback address." },
      ]);
    });

    it("should accept loopback when allowLoopback is true", () => {
      const parser = ipv6({ allowLoopback: true });
      const result = parser.parse("::1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "::1");
    });
  });

  describe("allowLinkLocal option", () => {
    it("should reject link-local when allowLinkLocal is false", () => {
      const parser = ipv6({ allowLinkLocal: false });
      const result = parser.parse("fe80::1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "fe80::1" },
        { type: "text", text: " is a link-local address." },
      ]);
    });

    it("should accept link-local when allowLinkLocal is true", () => {
      const parser = ipv6({ allowLinkLocal: true });
      const result = parser.parse("fe80::1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "fe80::1");
    });
  });

  describe("allowUniqueLocal option", () => {
    it("should reject unique local when allowUniqueLocal is false", () => {
      const parser = ipv6({ allowUniqueLocal: false });
      const result = parser.parse("fc00::1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "fc00::1" },
        { type: "text", text: " is a unique local address." },
      ]);
    });

    it("should accept unique local when allowUniqueLocal is true", () => {
      const parser = ipv6({ allowUniqueLocal: true });
      const result = parser.parse("fc00::1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "fc00::1");
    });
  });

  describe("allowMulticast option", () => {
    it("should reject multicast when allowMulticast is false", () => {
      const parser = ipv6({ allowMulticast: false });
      const result = parser.parse("ff02::1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "ff02::1" },
        { type: "text", text: " is a multicast address." },
      ]);
    });

    it("should accept multicast when allowMulticast is true", () => {
      const parser = ipv6({ allowMulticast: true });
      const result = parser.parse("ff02::1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "ff02::1");
    });
  });

  describe("allowZero option", () => {
    it("should reject zero address when allowZero is false", () => {
      const parser = ipv6({ allowZero: false });
      const result = parser.parse("::");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::" },
        { type: "text", text: " is the zero address." },
      ]);
    });

    it("should accept zero address when allowZero is true", () => {
      const parser = ipv6({ allowZero: true });
      const result = parser.parse("::");
      assert.ok(result.success);
      assert.strictEqual(result.value, "::");
    });
  });

  describe("invalid formats", () => {
    it("should reject empty string", () => {
      const parser = ipv6();
      const result = parser.parse("");
      assert.ok(!result.success);
    });

    it("should reject IPv4 address", () => {
      const parser = ipv6();
      const result = parser.parse("192.0.2.1");
      assert.ok(!result.success);
    });

    it("should reject invalid characters", () => {
      const parser = ipv6();
      const result = parser.parse("2001:db8::g123");
      assert.ok(!result.success);
    });

    it("should reject too many groups", () => {
      const parser = ipv6();
      const result = parser.parse(
        "2001:db8:85a3:0:0:8a2e:370:7334:extra",
      );
      assert.ok(!result.success);
    });

    it("should reject multiple :: compressions", () => {
      const parser = ipv6();
      const result = parser.parse("2001::db8::1");
      assert.ok(!result.success);
    });

    it("should reject groups with more than 4 hex digits", () => {
      const parser = ipv6();
      const result = parser.parse("2001:0db85:85a3::8a2e:370:7334");
      assert.ok(!result.success);
    });
  });

  describe("custom error messages", () => {
    it("should use custom invalidIpv6 message", () => {
      const parser = ipv6({
        errors: {
          invalidIpv6: [
            { type: "text", text: "Not a valid IPv6!" },
          ],
        },
      });
      const result = parser.parse("invalid");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Not a valid IPv6!" },
      ]);
    });

    it("should use custom invalidIpv6 function", () => {
      const parser = ipv6({
        errors: {
          invalidIpv6: (input) => [
            { type: "text", text: "Bad IP: " },
            { type: "value", value: input },
          ],
        },
      });
      const result = parser.parse("bad");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Bad IP: " },
        { type: "value", value: "bad" },
      ]);
    });

    it("should use custom loopbackNotAllowed message", () => {
      const parser = ipv6({
        allowLoopback: false,
        errors: {
          loopbackNotAllowed: [
            { type: "text", text: "No loopback!" },
          ],
        },
      });
      const result = parser.parse("::1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "No loopback!" },
      ]);
    });

    it("should use custom linkLocalNotAllowed message", () => {
      const parser = ipv6({
        allowLinkLocal: false,
        errors: {
          linkLocalNotAllowed: [
            { type: "text", text: "No link-local!" },
          ],
        },
      });
      const result = parser.parse("fe80::1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "No link-local!" },
      ]);
    });

    it("should use custom uniqueLocalNotAllowed message", () => {
      const parser = ipv6({
        allowUniqueLocal: false,
        errors: {
          uniqueLocalNotAllowed: [
            { type: "text", text: "No unique local!" },
          ],
        },
      });
      const result = parser.parse("fc00::1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "No unique local!" },
      ]);
    });

    it("should use custom multicastNotAllowed message", () => {
      const parser = ipv6({
        allowMulticast: false,
        errors: {
          multicastNotAllowed: [
            { type: "text", text: "No multicast!" },
          ],
        },
      });
      const result = parser.parse("ff02::1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "No multicast!" },
      ]);
    });

    it("should use custom zeroNotAllowed message", () => {
      const parser = ipv6({
        allowZero: false,
        errors: {
          zeroNotAllowed: [
            { type: "text", text: "No zero address!" },
          ],
        },
      });
      const result = parser.parse("::");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "No zero address!" },
      ]);
    });
  });

  describe("metavar", () => {
    it("should return default metavar", () => {
      const parser = ipv6();
      assert.strictEqual(parser.metavar, "IPV6");
    });

    it("should return custom metavar", () => {
      const parser = ipv6({ metavar: "IPv6_ADDR" });
      assert.strictEqual(parser.metavar, "IPv6_ADDR");
    });
  });

  describe("edge cases", () => {
    it("should compress leading zeros", () => {
      const parser = ipv6();
      const result = parser.parse(
        "2001:0db8:0000:0000:0000:0000:0000:0001",
      );
      assert.ok(result.success);
      assert.strictEqual(result.value, "2001:db8::1");
    });

    it("should handle maximum compression", () => {
      const parser = ipv6();
      const result = parser.parse("0000:0000:0000:0000:0000:0000:0000:0001");
      assert.ok(result.success);
      assert.strictEqual(result.value, "::1");
    });

    it("should handle compression at start", () => {
      const parser = ipv6();
      const result = parser.parse("::8a2e:370:7334");
      assert.ok(result.success);
      assert.strictEqual(result.value, "::8a2e:370:7334");
    });

    it("should handle compression at end", () => {
      const parser = ipv6();
      const result = parser.parse("2001:db8::");
      assert.ok(result.success);
      assert.strictEqual(result.value, "2001:db8::");
    });

    it("should handle compression in middle", () => {
      const parser = ipv6();
      const result = parser.parse("2001:db8::1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "2001:db8::1");
    });
  });
});

// cSpell: ignore résumé phonebk toolongcode hanidec jpan hebr arabext
// cSpell: ignore localhosts lojban rozaj Resian
