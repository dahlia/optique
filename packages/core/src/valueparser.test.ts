import {
  checkBooleanOption,
  checkEnumOption,
  choice,
  cidr,
  domain,
  email,
  float,
  hostname,
  integer,
  ip,
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
import { formatMessage, message, text, values } from "@optique/core/message";
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
      placeholder: "test",
      parse: () => ({ success: true as const, value: "test" }),
      format: (v: string) => v,
    };
    const numberParser = {
      $mode: "sync" as const,
      metavar: "NUMBER",
      placeholder: 0,
      parse: () => ({ success: true as const, value: 42 }),
      format: (v: number) => v.toString(),
    };

    assert.ok(isValueParser(stringParser));
    assert.ok(isValueParser(numberParser));
  });

  it("should throw TypeError for parser-like objects missing placeholder", () => {
    const invalidParser = {
      $mode: "sync" as const,
      metavar: "STRING",
      parse: () => ({ success: true as const, value: "test" }),
      format: (v: string) => v,
    };
    assert.throws(
      () => isValueParser(invalidParser),
      {
        name: "TypeError",
        message: "Value parser is missing the required placeholder property. " +
          "All value parsers must define a placeholder value.",
      },
    );
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

    it("should reject non-decimal literals and whitespace", () => {
      const parser = integer({ type: "bigint" });

      // Empty string
      assert.ok(!parser.parse("").success);

      // Whitespace-only
      assert.ok(!parser.parse("   ").success);

      // Signed-plus
      assert.ok(!parser.parse("+1").success);

      // Hex literal
      assert.ok(!parser.parse("0x10").success);

      // Binary literal
      assert.ok(!parser.parse("0b10").success);

      // Octal literal
      assert.ok(!parser.parse("0o10").success);

      // Whitespace-padded
      assert.ok(!parser.parse(" 42 ").success);
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

      // Test empty string for BigInt (should fail)
      const result5 = bigintParser.parse("");
      assert.ok(!result5.success);

      // Test whitespace-only string for BigInt (should fail)
      const result6 = bigintParser.parse("   ");
      assert.ok(!result6.success);
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

  describe("contradictory min > max", () => {
    it("should throw RangeError for number mode when min > max", () => {
      assert.throws(
        () => integer({ min: 10, max: 5 }),
        RangeError,
      );
    });

    it("should throw RangeError for bigint mode when min > max", () => {
      assert.throws(
        () => integer({ type: "bigint", min: 10n, max: 5n }),
        RangeError,
      );
    });

    it("should not throw when min equals max (number mode)", () => {
      assert.doesNotThrow(() => integer({ min: 5, max: 5 }));
    });

    it("should not throw when min equals max (bigint mode)", () => {
      assert.doesNotThrow(() => integer({ type: "bigint", min: 5n, max: 5n }));
    });
  });

  describe("non-finite bounds", () => {
    it("should throw RangeError when min is NaN", () => {
      assert.throws(
        () => integer({ min: NaN as never }),
        RangeError,
      );
    });

    it("should throw RangeError when max is NaN", () => {
      assert.throws(
        () => integer({ max: NaN as never }),
        RangeError,
      );
    });

    it("should throw RangeError when min is Infinity", () => {
      assert.throws(
        () => integer({ min: Infinity as never }),
        RangeError,
      );
    });

    it("should throw RangeError when min is -Infinity", () => {
      assert.throws(
        () => integer({ min: -Infinity as never }),
        RangeError,
      );
    });

    it("should throw RangeError when max is Infinity", () => {
      assert.throws(
        () => integer({ max: Infinity as never }),
        RangeError,
      );
    });

    it("should throw RangeError when max is -Infinity", () => {
      assert.throws(
        () => integer({ max: -Infinity as never }),
        RangeError,
      );
    });
  });

  describe("type discriminant validation", () => {
    it("should reject invalid type discriminant", () => {
      assert.throws(
        () => integer({ type: "num" as never }),
        TypeError,
      );
      assert.throws(
        () => integer({ type: 123 as never }),
        TypeError,
      );
      assert.throws(
        () => integer({ type: null as never }),
        TypeError,
      );
      assert.throws(
        () => integer({ type: "" as never }),
        TypeError,
      );
    });

    it("should accept valid type discriminant", () => {
      assert.ok(integer({ type: "number" }));
      assert.ok(integer({ type: "bigint" }));
      assert.ok(integer());
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

    it("should throw TypeError for empty choice list", () => {
      assert.throws(
        () => choice([]),
        TypeError,
      );
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

    it("should throw TypeError for empty choice list", () => {
      assert.throws(
        () => choice([] as string[]),
        TypeError,
      );
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

    it("should reject empty string in choices", () => {
      assert.throws(
        () => choice(["", "value"]),
        TypeError,
      );
    });

    it("should reject a single empty string choice", () => {
      assert.throws(
        () => choice([""]),
        TypeError,
      );
    });

    it("should reject all-empty-string choices", () => {
      assert.throws(
        () => choice(["", ""]),
        TypeError,
      );
    });

    it("should reject unsupported types like boolean", () => {
      assert.throws(
        () => choice([true] as never),
        TypeError,
      );
    });

    it("should reject unsupported types like object", () => {
      assert.throws(
        () => choice([{}] as never),
        TypeError,
      );
    });

    it("should reject mixed string and number choices (number first)", () => {
      assert.throws(
        () => choice([1, "2"] as never),
        TypeError,
      );
    });

    it("should reject mixed string and number choices (string first)", () => {
      assert.throws(
        () => choice(["a", 1] as never),
        TypeError,
      );
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

    it("should throw TypeError for case-insensitive choices with normalized duplicates", () => {
      assert.throws(
        () => choice(["JSON", "json", "Yaml"], { caseInsensitive: true }),
        {
          name: "TypeError",
          message:
            /Ambiguous choices for case-insensitive matching:.*"JSON".*"json".*normalize to.*"json"/,
        },
      );
    });

    it("should throw TypeError for case-insensitive choices like ['a', 'A']", () => {
      assert.throws(
        () => choice(["a", "A"], { caseInsensitive: true }),
        {
          name: "TypeError",
          message:
            /Ambiguous choices for case-insensitive matching:.*"a".*"A".*normalize to.*"a"/,
        },
      );
    });

    it("should allow ['a', 'A'] without caseInsensitive", () => {
      const parser = choice(["a", "A"]);

      const result1 = parser.parse("a");
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, "a");
      }

      const result2 = parser.parse("A");
      assert.ok(result2.success);
      if (result2.success) {
        assert.equal(result2.value, "A");
      }
    });

    it("should allow non-colliding choices with caseInsensitive", () => {
      const parser = choice(["json", "yaml"], { caseInsensitive: true });

      const result = parser.parse("JSON");
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "json");
      }
    });

    it("should allow exact duplicate choices with caseInsensitive", () => {
      const parser = choice(["json", "json", "yaml"], {
        caseInsensitive: true,
      });

      const result = parser.parse("JSON");
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "json");
      }
    });

    it("should reject non-boolean caseInsensitive option", () => {
      assert.throws(
        () => choice(["JSON", "YAML"], { caseInsensitive: "no" as never }),
        TypeError,
      );
      assert.throws(
        () => choice(["JSON", "YAML"], { caseInsensitive: 1 as never }),
        TypeError,
      );
      assert.throws(
        () => choice(["JSON", "YAML"], { caseInsensitive: "true" as never }),
        TypeError,
      );
      assert.throws(
        () => choice(["JSON", "YAML"], { caseInsensitive: 0 as never }),
        TypeError,
      );
      assert.throws(
        () => choice(["JSON", "YAML"], { caseInsensitive: null as never }),
        TypeError,
      );
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

      // "8.0" is an alternate decimal spelling of 8, which is in the list
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

    it("should throw TypeError for empty number choice list", () => {
      assert.throws(
        () => choice([] as number[]),
        TypeError,
      );
    });

    it("should reject hex, binary, octal, and scientific notation", () => {
      const parser = choice([0, 2, 8, 16]);

      // Hex notation "0x10" should not be accepted as 16
      const hex = parser.parse("0x10");
      assert.ok(!hex.success);

      // Binary notation "0b10" should not be accepted as 2
      const bin = parser.parse("0b10");
      assert.ok(!bin.success);

      // Octal notation "0o10" should not be accepted as 8
      const oct = parser.parse("0o10");
      assert.ok(!oct.success);

      // Scientific notation "2e0" should not be accepted as 2
      const sci = parser.parse("2e0");
      assert.ok(!sci.success);
    });

    it("should reject empty and whitespace-only strings", () => {
      const parser = choice([0, 1, 2]);

      // Empty string should not be accepted as 0
      const empty = parser.parse("");
      assert.ok(!empty.success);

      // Whitespace-only should not be accepted as 0
      const space = parser.parse("   ");
      assert.ok(!space.success);
    });

    it("should accept alternate decimal and scientific spellings for large/small numbers", () => {
      const parser = choice([1e21, 1e-7, 42]);

      // Decimal spelling of 1e21
      const big = parser.parse("1000000000000000000000");
      assert.ok(big.success);
      if (big.success) {
        assert.equal(big.value, 1e21);
      }

      // Canonical form should also work
      const bigCanon = parser.parse("1e+21");
      assert.ok(bigCanon.success);
      if (bigCanon.success) {
        assert.equal(bigCanon.value, 1e21);
      }

      // Decimal spelling of 1e-7
      const small = parser.parse("0.0000001");
      assert.ok(small.success);
      if (small.success) {
        assert.equal(small.value, 1e-7);
      }

      // Canonical form should also work
      const smallCanon = parser.parse("1e-7");
      assert.ok(smallCanon.success);
      if (smallCanon.success) {
        assert.equal(smallCanon.value, 1e-7);
      }

      // Alternate scientific notation spellings should work for
      // values whose canonical form uses scientific notation
      const altSci1 = parser.parse("1e21");
      assert.ok(altSci1.success);
      if (altSci1.success) {
        assert.equal(altSci1.value, 1e21);
      }

      const altSci2 = parser.parse("1.0e-7");
      assert.ok(altSci2.success);
      if (altSci2.success) {
        assert.equal(altSci2.value, 1e-7);
      }

      const altSci3 = parser.parse("10e20");
      assert.ok(altSci3.success);
      if (altSci3.success) {
        assert.equal(altSci3.value, 1e21);
      }

      // Leading + sign should work
      const altSci4 = parser.parse("+1e21");
      assert.ok(altSci4.success);
      if (altSci4.success) {
        assert.equal(altSci4.value, 1e21);
      }

      // Leading-dot mantissa should work
      const altSci5 = parser.parse(".1e-6");
      assert.ok(altSci5.success);
      if (altSci5.success) {
        assert.equal(altSci5.value, 1e-7);
      }

      // But scientific notation for a value whose canonical form is plain
      // decimal should still be rejected
      const sci = parser.parse("4.2e1");
      assert.ok(!sci.success);
    });

    it("should reject decimals that only round to a choice value", () => {
      // "1000000000000000000001" rounds to 1e21 in IEEE-754 but is
      // mathematically different
      const parser1 = choice([1e21]);
      const rounded = parser1.parse("1000000000000000000001");
      assert.ok(!rounded.success);

      // "0.10000000000000001" rounds to 0.1 in IEEE-754 but is
      // mathematically different
      const parser2 = choice([0.1]);
      const rounded2 = parser2.parse("0.10000000000000001");
      assert.ok(!rounded2.success);

      // But exact alternate spellings should still work
      const exact = parser1.parse("1000000000000000000000");
      assert.ok(exact.success);
    });

    it("should reject overflowed and underflowed decimal inputs", () => {
      const parser = choice([Infinity, -Infinity, 0]);

      // A 400-digit decimal should not overflow to Infinity
      const bigOverflow = parser.parse("9".repeat(400));
      assert.ok(!bigOverflow.success);

      // A negative 400-digit decimal should not overflow to -Infinity
      const negOverflow = parser.parse("-" + "9".repeat(400));
      assert.ok(!negOverflow.success);

      // An extremely small decimal should not underflow to 0
      const tinyUnderflow = parser.parse("0." + "0".repeat(400) + "1");
      assert.ok(!tinyUnderflow.success);

      // But legitimate alternate zero spellings should still work
      const zeroAlt = parser.parse("0.0");
      assert.ok(zeroAlt.success);
      if (zeroAlt.success) {
        assert.equal(zeroAlt.value, 0);
      }

      const zeroAlt2 = parser.parse("0.00");
      assert.ok(zeroAlt2.success);

      const zeroAlt3 = parser.parse(".0");
      assert.ok(zeroAlt3.success);
    });

    it("should accept Infinity and -Infinity when in the choice list", () => {
      const parser = choice([Infinity, -Infinity, 0]);

      const inf = parser.parse("Infinity");
      assert.ok(inf.success);
      if (inf.success) {
        assert.equal(inf.value, Infinity);
      }

      const negInf = parser.parse("-Infinity");
      assert.ok(negInf.success);
      if (negInf.success) {
        assert.equal(negInf.value, -Infinity);
      }

      // Alternate forms like "+Infinity" should not work
      const plusInf = parser.parse("+Infinity");
      assert.ok(!plusInf.success);
    });

    it("should preserve negative zero as a valid choice", () => {
      const parser = choice([-0, 1]);

      const result = parser.parse("-0");
      assert.ok(result.success);
      if (result.success) {
        assert.ok(Object.is(result.value, -0));
      }

      // "0" should not match -0, and the error should show "-0" not "0"
      const result2 = parser.parse("0");
      assert.ok(!result2.success);
      if (!result2.success) {
        assert.deepEqual(
          result2.error,
          [
            { type: "text", text: "Expected one of " },
            { type: "value", value: "-0" },
            { type: "text", text: " and " },
            { type: "value", value: "1" },
            { type: "text", text: ", but got " },
            { type: "value", value: "0" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should distinguish 0 and -0 when both are in choices", () => {
      const parser = choice([0, -0]);

      const pos = parser.parse("0");
      assert.ok(pos.success);
      if (pos.success) {
        assert.ok(Object.is(pos.value, 0));
      }

      const neg = parser.parse("-0");
      assert.ok(neg.success);
      if (neg.success) {
        assert.ok(Object.is(neg.value, -0));
      }
    });

    it("should accept -0 spellings when only 0 is in the choice list", () => {
      const parser = choice([0, 1, 2]);

      // "-0" should match 0 when -0 is not explicitly in the list
      const neg = parser.parse("-0");
      assert.ok(neg.success);
      if (neg.success) {
        assert.equal(neg.value, 0);
      }

      // "-0.0" should also match 0
      const negAlt = parser.parse("-0.0");
      assert.ok(negAlt.success);
      if (negAlt.success) {
        assert.equal(negAlt.value, 0);
      }

      // "-000" should also match 0
      const negZeros = parser.parse("-000");
      assert.ok(negZeros.success);
      if (negZeros.success) {
        assert.equal(negZeros.value, 0);
      }
    });

    it("should reject NaN at construction time", () => {
      assert.throws(() => choice([NaN]), TypeError);
      assert.throws(() => choice([NaN, 1, 2]), TypeError);
      assert.throws(() => choice([1, NaN, 2]), TypeError);
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

  describe("choices metadata", () => {
    it("should expose choices array for string choices", () => {
      const parser = choice(["red", "green", "blue"]);
      assert.deepEqual(parser.choices, ["red", "green", "blue"]);
    });

    it("should expose choices array for number choices", () => {
      const parser = choice([8, 10, 12]);
      assert.deepEqual(parser.choices, [8, 10, 12]);
    });

    it("should preserve original case for case-insensitive string choices", () => {
      const parser = choice(["JSON", "YAML"], { caseInsensitive: true });
      assert.deepEqual(parser.choices, ["JSON", "YAML"]);
    });

    it("should throw TypeError for empty choices", () => {
      assert.throws(
        () => choice([] as string[]),
        TypeError,
      );
    });

    it("should expose single-element array for single choice", () => {
      const parser = choice(["only"]);
      assert.deepEqual(parser.choices, ["only"]);
    });

    it("should deduplicate string choices in metadata", () => {
      const parser = choice(["json", "json", "yaml"]);
      assert.deepEqual(parser.choices, ["json", "yaml"]);
    });

    it("should deduplicate number choices in metadata", () => {
      const parser = choice([1, 1, 2]);
      assert.deepEqual(parser.choices, [1, 2]);
    });
  });

  describe("deduplication", () => {
    it("should not produce duplicate string suggestions", () => {
      const parser = choice(["json", "json", "yaml"]);
      const suggestions = [...parser.suggest!("j")];
      assert.deepEqual(suggestions, [
        { kind: "literal", text: "json" },
      ]);
    });

    it("should not produce duplicate number suggestions", () => {
      const parser = choice([1, 1, 2]);
      const suggestions = [...parser.suggest!("1")];
      assert.deepEqual(suggestions, [
        { kind: "literal", text: "1" },
      ]);
    });

    it("should not include duplicates in string error messages", () => {
      const parser = choice(["json", "json", "yaml"]);
      const result = parser.parse("xml");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected one of " },
            { type: "value", value: "json" },
            { type: "text", text: " and " },
            { type: "value", value: "yaml" },
            { type: "text", text: ", but got " },
            { type: "value", value: "xml" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should not include duplicates in number error messages", () => {
      const parser = choice([1, 1, 2]);
      const result = parser.parse("3");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            { type: "text", text: "Expected one of " },
            { type: "value", value: "1" },
            { type: "text", text: " and " },
            { type: "value", value: "2" },
            { type: "text", text: ", but got " },
            { type: "value", value: "3" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should deduplicate case-insensitive string choices", () => {
      const parser = choice(["JSON", "JSON", "yaml"], {
        caseInsensitive: true,
      });
      assert.deepEqual(parser.choices, ["JSON", "yaml"]);
      const suggestions = [...parser.suggest!("")];
      assert.deepEqual(suggestions, [
        { kind: "literal", text: "JSON" },
        { kind: "literal", text: "yaml" },
      ]);
    });

    it("should not change behavior after post-construction caseInsensitive mutation", () => {
      const options: { caseInsensitive: boolean } = {
        caseInsensitive: false,
      };
      const parser = choice(["Foo", "Bar"], options);

      // Before mutation: case-sensitive, "foo" doesn't match "Foo"
      assert.ok(!parser.parse("foo").success);
      assert.deepEqual([...parser.suggest!("f")], []);

      // Mutate options after construction
      options.caseInsensitive = true;

      // After mutation: behavior should NOT change (still case-sensitive)
      assert.ok(!parser.parse("foo").success);
      assert.deepEqual([...parser.suggest!("f")], []);
    });

    it("should snapshot choices array at construction time", () => {
      const choices = ["a", "b", "c"];
      const parser = choice(choices);
      choices[0] = "z";
      // Parser should still accept "a" (original value), not "z"
      assert.ok(parser.parse("a").success);
      assert.ok(!parser.parse("z").success);
    });

    it("should not allow mutation through the public choices property", () => {
      const parser = choice(["a", "b", "c"]);
      // The choices property should be frozen
      assert.throws(() => {
        (parser.choices as string[])[0] = "z";
      }, TypeError);
      // Parser should still work correctly
      assert.ok(parser.parse("a").success);
    });

    it("should snapshot number choices array at construction time", () => {
      const choices: number[] = [1, 2, 3];
      const parser = choice(choices);
      choices[0] = 99;
      // Parser should still accept "1" (original value), not "99"
      assert.ok(parser.parse("1").success);
      assert.ok(!parser.parse("99").success);
    });

    it("should not allow mutation through the public number choices property", () => {
      const parser = choice([1, 2, 3]);
      assert.throws(() => {
        (parser.choices as number[])[0] = 99;
      }, TypeError);
      assert.ok(parser.parse("1").success);
    });

    it("should snapshot errors.invalidChoice at construction time", () => {
      const errors: { invalidChoice: string } = {
        invalidChoice: "original error",
      };
      const parser = choice(["a", "b"], { errors: errors as never });
      const result = parser.parse("z");
      assert.ok(!result.success);
      if (!result.success) assert.equal(result.error, "original error");
      // Mutate errors after construction
      errors.invalidChoice = "mutated error";
      const result2 = parser.parse("z");
      assert.ok(!result2.success);
      if (!result2.success) assert.equal(result2.error, "original error");
    });

    it("should snapshot errors.invalidChoice for number choices at construction time", () => {
      const errors: { invalidChoice: string } = {
        invalidChoice: "original error",
      };
      const parser = choice([1, 2], { errors: errors as never });
      const result = parser.parse("99");
      assert.ok(!result.success);
      if (!result.success) assert.equal(result.error, "original error");
      errors.invalidChoice = "mutated error";
      const result2 = parser.parse("99");
      assert.ok(!result2.success);
      if (!result2.success) assert.equal(result2.error, "original error");
    });

    it("should work with all-duplicate list", () => {
      const parser = choice(["a", "a"]);
      assert.deepEqual(parser.choices, ["a"]);
      const result = parser.parse("a");
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "a");
      }
    });
  });
});

describe("non-choice parsers should not have choices metadata", () => {
  it("string() should not have choices", () => {
    const parser = string();
    assert.equal(parser.choices, undefined);
  });

  it("integer() should not have choices", () => {
    const parser = integer({});
    assert.equal(parser.choices, undefined);
  });

  it("float() should not have choices", () => {
    const parser = float({});
    assert.equal(parser.choices, undefined);
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

  describe("contradictory min > max", () => {
    it("should throw RangeError when min > max", () => {
      assert.throws(
        () => float({ min: 10, max: 5 }),
        RangeError,
      );
    });

    it("should not throw when min equals max", () => {
      assert.doesNotThrow(() => float({ min: 5, max: 5 }));
    });
  });

  describe("non-finite bounds", () => {
    it("should throw RangeError when min is NaN", () => {
      assert.throws(
        () => float({ min: NaN as never }),
        RangeError,
      );
    });

    it("should throw RangeError when max is NaN", () => {
      assert.throws(
        () => float({ max: NaN as never }),
        RangeError,
      );
    });

    it("should throw RangeError when min is Infinity", () => {
      assert.throws(
        () => float({ min: Infinity as never }),
        RangeError,
      );
    });

    it("should throw RangeError when min is -Infinity", () => {
      assert.throws(
        () => float({ min: -Infinity as never }),
        RangeError,
      );
    });

    it("should throw RangeError when max is Infinity", () => {
      assert.throws(
        () => float({ max: Infinity as never }),
        RangeError,
      );
    });

    it("should throw RangeError when max is -Infinity", () => {
      assert.throws(
        () => float({ max: -Infinity as never }),
        RangeError,
      );
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
            { type: "value", value: "http:" },
            { type: "text", text: " and " },
            { type: "value", value: "https:" },
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

    it("should throw TypeError when empty protocol list is provided", () => {
      assert.throws(
        () => url({ allowedProtocols: [] }),
        {
          name: "TypeError",
          message: "allowedProtocols must not be empty.",
        },
      );
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

    it("should snapshot allowedProtocols at construction time", () => {
      const protocols = ["https:"];
      const parser = url({ allowedProtocols: protocols });
      assert.ok(parser.parse("https://example.com").success);
      assert.ok(!parser.parse("http://example.com").success);
      // Mutate protocols after construction
      protocols[0] = "http:";
      // Parser should still accept https and reject http
      assert.ok(parser.parse("https://example.com").success);
      assert.ok(!parser.parse("http://example.com").success);
    });

    it("should snapshot errors.invalidUrl at construction time", () => {
      const errors: { invalidUrl: string } = {
        invalidUrl: "original error",
      };
      const parser = url({ errors: errors as never });
      const result = parser.parse("not-a-url");
      assert.ok(!result.success);
      if (!result.success) assert.equal(result.error, "original error");
      errors.invalidUrl = "mutated error";
      const result2 = parser.parse("not-a-url");
      assert.ok(!result2.success);
      if (!result2.success) assert.equal(result2.error, "original error");
    });

    it("should snapshot errors.disallowedProtocol at construction time", () => {
      const errors: { disallowedProtocol: string } = {
        disallowedProtocol: "original error",
      };
      const parser = url({
        allowedProtocols: ["https:"],
        errors: errors as never,
      });
      const result = parser.parse("http://example.com");
      assert.ok(!result.success);
      if (!result.success) assert.equal(result.error, "original error");
      errors.disallowedProtocol = "mutated error";
      const result2 = parser.parse("http://example.com");
      assert.ok(!result2.success);
      if (!result2.success) assert.equal(result2.error, "original error");
    });
  });

  describe("allowedProtocols validation", () => {
    it("should reject non-string entries", () => {
      assert.throws(
        () => url({ allowedProtocols: [123 as never] }),
        {
          name: "TypeError",
          message: /got: 123\./,
        },
      );
      assert.throws(
        () => url({ allowedProtocols: [null as never] }),
        {
          name: "TypeError",
          message: /got: null\./,
        },
      );
      assert.throws(
        () => url({ allowedProtocols: [undefined as never] }),
        {
          name: "TypeError",
          message: /got: undefined\./,
        },
      );
    });

    it("should reject entries missing the trailing colon", () => {
      assert.throws(
        () => url({ allowedProtocols: ["https" as never] }),
        {
          name: "TypeError",
          message: /got: "https"\./,
        },
      );
      assert.throws(
        () => url({ allowedProtocols: ["http" as never] }),
        {
          name: "TypeError",
          message: /got: "http"\./,
        },
      );
    });

    it("should reject entries with :// suffix", () => {
      assert.throws(
        () => url({ allowedProtocols: ["https://" as never] }),
        {
          name: "TypeError",
          message: /got: "https:\/\/"\./,
        },
      );
    });

    it("should reject empty string", () => {
      assert.throws(
        () => url({ allowedProtocols: ["" as never] }),
        {
          name: "TypeError",
          message: /got: ""\./,
        },
      );
    });

    it("should accept valid protocol entries", () => {
      assert.doesNotThrow(() => url({ allowedProtocols: ["https:"] }));
      assert.doesNotThrow(() => url({ allowedProtocols: ["HTTP:"] }));
      assert.doesNotThrow(
        () => url({ allowedProtocols: ["https:", "http:", "ftp:"] }),
      );
      assert.doesNotThrow(
        () => url({ allowedProtocols: ["custom+proto:"] }),
      );
    });

    it("should deduplicate case-only duplicates", () => {
      const parser = url({ allowedProtocols: ["HTTP:", "http:"] });
      const suggestions = [...parser.suggest!("ht")]
        .filter((s) => s.kind === "literal")
        .map((s) => s.text);
      assert.deepEqual(suggestions, ["http://"]);
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

    it("should handle database-generated UUIDs with strict: false", () => {
      const parser = uuid({ strict: false });

      // These UUIDs have non-standard version/variant values
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

  describe("strict mode", () => {
    it("should reject version 0 by default", () => {
      const parser = uuid({});
      const result = parser.parse("6ba7b800-9dad-01d1-80b4-00c04fd430c8");
      assert.ok(!result.success);
    });

    it("should reject versions 9 through f by default", () => {
      const parser = uuid({});
      const hexDigits = "9abcdef";
      for (const digit of hexDigits) {
        const input = `6ba7b800-9dad-${digit}1d1-80b4-00c04fd430c8` as const;
        const result = parser.parse(input);
        assert.ok(
          !result.success,
          `Should reject version ${digit}: ${input}`,
        );
      }
    });

    it("should accept versions 1 through 8 by default", () => {
      const parser = uuid({});
      for (let v = 1; v <= 8; v++) {
        const input = `6ba7b800-9dad-${
          v.toString(16)
        }1d1-80b4-00c04fd430c8` as const;
        const result = parser.parse(input);
        assert.ok(result.success, `Should accept version ${v}: ${input}`);
      }
    });

    it("should reject non-RFC 9562 variant nibbles by default", () => {
      const parser = uuid({});
      const invalidVariants = ["0", "3", "7", "c", "d", "f"];
      for (const v of invalidVariants) {
        const input = `550e8400-e29b-41d4-${v}716-446655440000` as const;
        const result = parser.parse(input);
        assert.ok(
          !result.success,
          `Should reject variant ${v}: ${input}`,
        );
      }
    });

    it("should accept valid RFC 9562 variant nibbles", () => {
      const parser = uuid({});
      const validVariants = ["8", "9", "a", "b", "A", "B"];
      for (const v of validVariants) {
        const input = `550e8400-e29b-41d4-${v}716-446655440000` as const;
        const result = parser.parse(input);
        assert.ok(
          result.success,
          `Should accept variant ${v}: ${input}`,
        );
      }
    });

    it("should accept nil UUID as special standard value", () => {
      const parser = uuid({});
      const result = parser.parse("00000000-0000-0000-0000-000000000000");
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "00000000-0000-0000-0000-000000000000");
      }
    });

    it("should accept max UUID as special standard value", () => {
      const parser = uuid({});
      const result = parser.parse("ffffffff-ffff-ffff-ffff-ffffffffffff");
      assert.ok(result.success);
      if (result.success) {
        assert.equal(result.value, "ffffffff-ffff-ffff-ffff-ffffffffffff");
      }
    });

    it("should accept uppercase max UUID", () => {
      const parser = uuid({});
      const result = parser.parse("FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF");
      assert.ok(result.success);
    });

    it("should behave the same with strict: true as default", () => {
      const defaultParser = uuid({});
      const strictParser = uuid({ strict: true });

      const cases = [
        "550e8400-e29b-41d4-a716-446655440000", // valid v4
        "6ba7b800-9dad-01d1-80b4-00c04fd430c8", // invalid v0
        "550e8400-e29b-41d4-0716-446655440000", // invalid variant
        "00000000-0000-0000-0000-000000000000", // nil
        "ffffffff-ffff-ffff-ffff-ffffffffffff", // max
      ];

      for (const input of cases) {
        assert.deepEqual(
          defaultParser.parse(input),
          strictParser.parse(input),
          `Mismatch for: ${input}`,
        );
      }
    });

    it("should accept any version and variant with strict: false", () => {
      const parser = uuid({ strict: false });

      const cases = [
        "6ba7b800-9dad-01d1-80b4-00c04fd430c8", // v0
        "6ba7b800-9dad-f1d1-80b4-00c04fd430c8", // v15
        "550e8400-e29b-41d4-0716-446655440000", // variant 0
        "550e8400-e29b-41d4-f716-446655440000", // variant f
        "01234567-89ab-cdef-0123-456789abcdef", // non-standard
      ];

      for (const input of cases) {
        const result = parser.parse(input);
        assert.ok(result.success, `Should accept with strict: false: ${input}`);
      }
    });

    it("should still validate variant bits with allowedVersions in strict mode", () => {
      const parser = uuid({ allowedVersions: [4] });
      // v4 UUID with invalid variant nibble (0)
      const result = parser.parse("550e8400-e29b-41d4-0716-446655440000");
      assert.ok(!result.success);
    });

    it("should skip variant check with allowedVersions and strict: false", () => {
      const parser = uuid({ allowedVersions: [4], strict: false });
      // v4 UUID with invalid variant nibble (0)
      const result = parser.parse("550e8400-e29b-41d4-0716-446655440000");
      assert.ok(result.success);
    });

    it("should still reject disallowed versions with strict: false", () => {
      const parser = uuid({ allowedVersions: [4], strict: false });
      // v1 UUID should be rejected by allowedVersions
      const result = parser.parse("6ba7b810-9dad-11d1-80b4-00c04fd430c8");
      assert.ok(!result.success);
    });

    it("should accept nil UUID even with allowedVersions", () => {
      const parser = uuid({ allowedVersions: [4] });
      const result = parser.parse("00000000-0000-0000-0000-000000000000");
      assert.ok(result.success);
    });

    it("should accept max UUID even with allowedVersions", () => {
      const parser = uuid({ allowedVersions: [4] });
      const result = parser.parse("ffffffff-ffff-ffff-ffff-ffffffffffff");
      assert.ok(result.success);
    });

    it("should accept nil and max UUIDs with allowedVersions and strict: false", () => {
      const parser = uuid({ allowedVersions: [4], strict: false });
      assert.ok(
        parser.parse("00000000-0000-0000-0000-000000000000").success,
      );
      assert.ok(
        parser.parse("ffffffff-ffff-ffff-ffff-ffffffffffff").success,
      );
    });

    it("should reject non-RFC variant in default strict mode (issue #334)", () => {
      const parser = uuid();
      // variant 'c' is outside RFC 9562 set {8, 9, a, b}
      const r1 = parser.parse("123e4567-e89b-12d3-c456-426614174000");
      assert.ok(!r1.success);
      if (!r1.success) {
        assert.deepEqual(
          r1.error,
          [
            {
              type: "text",
              text:
                "Expected RFC 9562 variant (8, 9, a, or b at position 20), but got ",
            },
            { type: "value", value: "c" },
            { type: "text", text: " in " },
            { type: "value", value: "123e4567-e89b-12d3-c456-426614174000" },
            { type: "text", text: "." },
          ] as const,
        );
      }
      // variant 'f' is outside RFC 9562 set
      const r2 = parser.parse("123e4567-e89b-12d3-f456-426614174000");
      assert.ok(!r2.success);
      if (!r2.success) {
        assert.deepEqual(
          r2.error,
          [
            {
              type: "text",
              text:
                "Expected RFC 9562 variant (8, 9, a, or b at position 20), but got ",
            },
            { type: "value", value: "f" },
            { type: "text", text: " in " },
            { type: "value", value: "123e4567-e89b-12d3-f456-426614174000" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should reject non-RFC variant even with allowedVersions (issue #334)", () => {
      const parser = uuid({ allowedVersions: [1] });
      // version 1 matches, but variant 'f' is invalid
      const result = parser.parse("123e4567-e89b-12d3-f456-426614174000");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            {
              type: "text",
              text:
                "Expected RFC 9562 variant (8, 9, a, or b at position 20), but got ",
            },
            { type: "value", value: "f" },
            { type: "text", text: " in " },
            { type: "value", value: "123e4567-e89b-12d3-f456-426614174000" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide default error message for invalid variant", () => {
      const parser = uuid({});
      const result = parser.parse("550e8400-e29b-41d4-0716-446655440000");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            {
              type: "text",
              text:
                "Expected RFC 9562 variant (8, 9, a, or b at position 20), but got ",
            },
            { type: "value", value: "0" },
            { type: "text", text: " in " },
            { type: "value", value: "550e8400-e29b-41d4-0716-446655440000" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should provide default error message for invalid version", () => {
      const parser = uuid({});
      const result = parser.parse("6ba7b800-9dad-01d1-80b4-00c04fd430c8");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          [
            {
              type: "text",
              text: "Expected UUID version 1 through 8, but got version ",
            },
            { type: "value", value: "0" },
            { type: "text", text: "." },
          ] as const,
        );
      }
    });

    it("should use custom invalidVariant error message", () => {
      const parser = uuid({
        errors: {
          invalidVariant: message`Bad variant bits.`,
        },
      });
      const result = parser.parse("550e8400-e29b-41d4-0716-446655440000");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(result.error, [
          { type: "text", text: "Bad variant bits." },
        ]);
      }
    });

    it("should use custom invalidVariant function error", () => {
      const parser = uuid({
        errors: {
          invalidVariant: (input) => message`Invalid variant in ${input}.`,
        },
      });
      const result = parser.parse("550e8400-e29b-41d4-0716-446655440000");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(result.error, [
          { type: "text", text: "Invalid variant in " },
          { type: "value", value: "550e8400-e29b-41d4-0716-446655440000" },
          { type: "text", text: "." },
        ]);
      }
    });

    it("should snapshot strict option at construction time", () => {
      const options: { strict: boolean } = { strict: false };
      const parser = uuid(options);
      // v0 UUID should pass with strict: false
      assert.ok(
        parser.parse("6ba7b800-9dad-01d1-80b4-00c04fd430c8").success,
      );
      // Mutate strict after construction
      options.strict = true;
      // Parser should still accept v0
      assert.ok(
        parser.parse("6ba7b800-9dad-01d1-80b4-00c04fd430c8").success,
      );
    });

    it("should reject non-boolean strict option", () => {
      assert.throws(
        () => uuid({ strict: 1 as never }),
        TypeError,
      );
      assert.throws(
        () => uuid({ strict: "true" as never }),
        TypeError,
      );
      assert.throws(
        () => uuid({ strict: 0 as never }),
        TypeError,
      );
    });

    it("should snapshot errors.invalidVariant at construction time", () => {
      const errors: { invalidVariant: string } = {
        invalidVariant: "original error",
      };
      const parser = uuid({ errors: errors as never });
      const result = parser.parse("550e8400-e29b-41d4-0716-446655440000");
      assert.ok(!result.success);
      if (!result.success) assert.equal(result.error, "original error");
      errors.invalidVariant = "mutated error";
      const result2 = parser.parse("550e8400-e29b-41d4-0716-446655440000");
      assert.ok(!result2.success);
      if (!result2.success) assert.equal(result2.error, "original error");
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

    it("should reject version 0 in strict mode", () => {
      const parser = uuid({});
      const result = parser.parse("6ba7b800-9dad-01d1-80b4-00c04fd430c8"); // v0

      assert.ok(!result.success);
    });

    it("should accept version 0 with strict: false", () => {
      const parser = uuid({ strict: false });
      const result = parser.parse("6ba7b800-9dad-01d1-80b4-00c04fd430c8"); // v0

      assert.ok(result.success);
    });

    it("should reject non-integer allowedVersions", () => {
      assert.throws(
        () => uuid({ allowedVersions: [4.5] as never }),
        (e: unknown) =>
          e instanceof TypeError &&
          e.message ===
            'Expected every element of allowedVersions to be an integer, but got value "4.5" of type "number".',
      );
      assert.throws(
        () => uuid({ allowedVersions: [NaN] as never }),
        (e: unknown) =>
          e instanceof TypeError &&
          e.message ===
            'Expected every element of allowedVersions to be an integer, but got value "NaN" of type "number".',
      );
      assert.throws(
        () => uuid({ allowedVersions: ["4" as never] }),
        (e: unknown) =>
          e instanceof TypeError &&
          e.message ===
            'Expected every element of allowedVersions to be an integer, but got value "4" of type "string".',
      );
    });

    it("should reject out-of-range allowedVersions", () => {
      assert.throws(
        () => uuid({ allowedVersions: [0] as never }),
        (e: unknown) =>
          e instanceof RangeError &&
          e.message ===
            "Expected every element of allowedVersions to be between 1 and 8, but got: 0.",
      );
      assert.throws(
        () => uuid({ allowedVersions: [9] as never }),
        (e: unknown) =>
          e instanceof RangeError &&
          e.message ===
            "Expected every element of allowedVersions to be between 1 and 8, but got: 9.",
      );
      assert.throws(
        () => uuid({ allowedVersions: [-1] as never }),
        (e: unknown) =>
          e instanceof RangeError &&
          e.message ===
            "Expected every element of allowedVersions to be between 1 and 8, but got: -1.",
      );
      assert.throws(
        () => uuid({ allowedVersions: [99] as never }),
        (e: unknown) =>
          e instanceof RangeError &&
          e.message ===
            "Expected every element of allowedVersions to be between 1 and 8, but got: 99.",
      );
      assert.throws(
        () => uuid({ allowedVersions: [15] as never }),
        (e: unknown) =>
          e instanceof RangeError &&
          e.message ===
            "Expected every element of allowedVersions to be between 1 and 8, but got: 15.",
      );
    });

    it("should deduplicate allowedVersions", () => {
      const parser = uuid({ allowedVersions: [4, 4, 4] as never });
      const result = parser.parse("6ba7b810-9dad-11d1-80b4-00c04fd430c8"); // v1
      assert.ok(!result.success);
      if (!result.success) {
        assert.equal(
          formatMessage(result.error, { quotes: false }),
          "Expected UUID version 4, but got version 1.",
        );
      }
    });

    it("should accept valid allowedVersions", () => {
      assert.doesNotThrow(() => uuid({ allowedVersions: [1, 4, 7] }));
      assert.doesNotThrow(() => uuid({ allowedVersions: [] }));
    });

    it("should snapshot allowedVersions at construction time", () => {
      const versions: number[] = [4];
      const parser = uuid({ allowedVersions: versions });
      // v4 UUID should pass
      assert.ok(
        parser.parse("550e8400-e29b-41d4-a716-446655440000").success,
      );
      // v1 UUID should fail
      assert.ok(
        !parser.parse("6ba7b810-9dad-11d1-80b4-00c04fd430c8").success,
      );
      // Mutate versions after construction
      versions[0] = 1;
      // Parser should still accept v4 and reject v1
      assert.ok(
        parser.parse("550e8400-e29b-41d4-a716-446655440000").success,
      );
      assert.ok(
        !parser.parse("6ba7b810-9dad-11d1-80b4-00c04fd430c8").success,
      );
    });

    it("should snapshot errors.invalidUuid at construction time", () => {
      const errors: { invalidUuid: string } = {
        invalidUuid: "original error",
      };
      const parser = uuid({ errors: errors as never });
      const result = parser.parse("not-a-uuid");
      assert.ok(!result.success);
      if (!result.success) assert.equal(result.error, "original error");
      errors.invalidUuid = "mutated error";
      const result2 = parser.parse("not-a-uuid");
      assert.ok(!result2.success);
      if (!result2.success) assert.equal(result2.error, "original error");
    });

    it("should snapshot errors.disallowedVersion at construction time", () => {
      const errors: { disallowedVersion: string } = {
        disallowedVersion: "original error",
      };
      const parser = uuid({
        allowedVersions: [4],
        errors: errors as never,
      });
      // v1 UUID triggers disallowedVersion
      const result = parser.parse(
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      );
      assert.ok(!result.success);
      if (!result.success) assert.equal(result.error, "original error");
      errors.disallowedVersion = "mutated error";
      const result2 = parser.parse(
        "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      );
      assert.ok(!result2.success);
      if (!result2.success) assert.equal(result2.error, "original error");
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

    it("should suggest non-hierarchical schemes with ':' not '://'", () => {
      const parser = url({
        allowedProtocols: ["mailto:", "urn:", "https:"],
      });

      const suggestions = Array.from(parser.suggest!("m"));
      const texts = suggestions.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      );
      assert.deepEqual(texts, ["mailto:"]);

      const suggestions2 = Array.from(parser.suggest!("u"));
      const texts2 = suggestions2.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      );
      assert.deepEqual(texts2, ["urn:"]);

      const suggestions3 = Array.from(parser.suggest!("h"));
      const texts3 = suggestions3.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      );
      assert.deepEqual(texts3, ["https://"]);
    });

    it("should stop suggesting after prefix contains ':'", () => {
      const parser = url({
        allowedProtocols: ["mailto:", "https:"],
      });

      assert.deepEqual(
        Array.from(parser.suggest!("mailto:someone")),
        [],
      );
      assert.deepEqual(
        Array.from(parser.suggest!("https:")),
        [],
      );
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

    it("should throw TypeError when pattern is not a RegExp", () => {
      assert.throws(
        () => string({ pattern: "abc" as never }),
        TypeError,
      );
      assert.throws(
        () => string({ pattern: 123 as never }),
        TypeError,
      );
    });

    it("should snapshot pattern at construction time", () => {
      const options: { pattern: RegExp } = { pattern: /^a$/ };
      const parser = string(options);
      assert.ok(parser.parse("a").success);
      assert.ok(!parser.parse("b").success);
      // Mutate the options after construction
      options.pattern = /^b$/;
      // Parser should still use the original pattern
      assert.ok(parser.parse("a").success);
      assert.ok(!parser.parse("b").success);
    });

    it("should snapshot errors.patternMismatch at construction time", () => {
      const errors: {
        patternMismatch: string | ((i: string, p: RegExp) => string);
      } = {
        patternMismatch: "original error",
      };
      const parser = string({ pattern: /^a$/, errors: errors as never });
      const result = parser.parse("b");
      assert.ok(!result.success);
      if (!result.success) assert.equal(result.error, "original error");
      // Mutate errors after construction
      errors.patternMismatch = "mutated error";
      const result2 = parser.parse("b");
      assert.ok(!result2.success);
      if (!result2.success) assert.equal(result2.error, "original error");
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

      // MAX_SAFE_INTEGER + 1: exactly representable as a number, but outside
      // the safe integer range
      const result2 = parser.parse("9007199254740992"); // MAX_SAFE_INTEGER + 1
      assert.ok(!result2.success);
      if (!result2.success) {
        assert.deepEqual(
          result2.error,
          message`Expected a safe integer between ${
            text(Number.MIN_SAFE_INTEGER.toLocaleString("en"))
          } and ${
            text(Number.MAX_SAFE_INTEGER.toLocaleString("en"))
          }, but got ${"9007199254740992"}. Use type: "bigint" for large values.`,
        );
      }

      // MAX_SAFE_INTEGER + 2
      const result3 = parser.parse("9007199254740993");
      assert.ok(!result3.success);
    });

    it("should handle Number.MIN_SAFE_INTEGER boundary", () => {
      const parser = integer({});

      const result1 = parser.parse(Number.MIN_SAFE_INTEGER.toString());
      assert.ok(result1.success);
      if (result1.success) {
        assert.equal(result1.value, Number.MIN_SAFE_INTEGER);
      }

      // MIN_SAFE_INTEGER - 1
      const result2 = parser.parse("-9007199254740992");
      assert.ok(!result2.success);

      // MIN_SAFE_INTEGER - 2
      const result3 = parser.parse("-9007199254740993");
      assert.ok(!result3.success);
    });

    it("should reject very large integers in number mode", () => {
      const parser = integer({});

      const result = parser.parse("9999999999999999999999999999");
      assert.ok(!result.success);
    });

    it("should use custom unsafeInteger function callback", () => {
      const parser = integer({
        errors: {
          unsafeInteger: (input: string) => message`Unsafe value: ${input}.`,
        },
      });

      const result = parser.parse("9007199254740993");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          message`Unsafe value: ${"9007199254740993"}.`,
        );
      }
    });

    it("should use custom unsafeInteger static message", () => {
      const parser = integer({
        errors: {
          unsafeInteger: message`Value out of safe range.`,
        },
      });

      const result = parser.parse("9007199254740993");
      assert.ok(!result.success);
      if (!result.success) {
        assert.deepEqual(
          result.error,
          message`Value out of safe range.`,
        );
      }
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

  it("should reject values that overflow to Infinity by default", () => {
    const parser = float({});

    // 1e309 is beyond the range of a JavaScript number and becomes Infinity
    const result1 = parser.parse("1e309");
    assert.ok(!result1.success);

    const result2 = parser.parse("-1e309");
    assert.ok(!result2.success);
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

    it("should reject non-decimal literals and whitespace", () => {
      const parser = port({ type: "bigint" });

      assert.ok(!parser.parse("").success);
      assert.ok(!parser.parse("   ").success);
      assert.ok(!parser.parse("+1").success);
      assert.ok(!parser.parse("0x50").success);
      assert.ok(!parser.parse("0b10").success);
      assert.ok(!parser.parse("0o10").success);
      assert.ok(!parser.parse(" 8080 ").success);
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

  describe("boolean option validation", () => {
    it("should reject non-boolean disallowWellKnown option", () => {
      assert.throws(
        () => port({ disallowWellKnown: "no" as never }),
        TypeError,
      );
      assert.throws(
        () => port({ disallowWellKnown: 1 as never }),
        TypeError,
      );
      assert.throws(
        () => port({ disallowWellKnown: "true" as never }),
        TypeError,
      );
      assert.throws(
        () => port({ disallowWellKnown: 0 as never }),
        TypeError,
      );
      assert.throws(
        () => port({ disallowWellKnown: null as never }),
        TypeError,
      );
    });

    it("should reject non-boolean disallowWellKnown option (bigint)", () => {
      assert.throws(
        () => port({ type: "bigint", disallowWellKnown: "no" as never }),
        TypeError,
      );
      assert.throws(
        () => port({ type: "bigint", disallowWellKnown: 1 as never }),
        TypeError,
      );
      assert.throws(
        () => port({ type: "bigint", disallowWellKnown: "true" as never }),
        TypeError,
      );
      assert.throws(
        () => port({ type: "bigint", disallowWellKnown: 0 as never }),
        TypeError,
      );
      assert.throws(
        () => port({ type: "bigint", disallowWellKnown: null as never }),
        TypeError,
      );
    });
  });

  describe("type discriminant validation", () => {
    it("should reject invalid type discriminant", () => {
      assert.throws(
        () => port({ type: "num" as never }),
        TypeError,
      );
      assert.throws(
        () => port({ type: 123 as never }),
        TypeError,
      );
      assert.throws(
        () => port({ type: null as never }),
        TypeError,
      );
      assert.throws(
        () => port({ type: "" as never }),
        TypeError,
      );
    });

    it("should accept valid type discriminant", () => {
      assert.ok(port({ type: "number" }));
      assert.ok(port({ type: "bigint" }));
      assert.ok(port());
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

      it("should reject non-decimal octet representations", () => {
        const parser = ipv4();

        const nonDecimal = [
          "192e0.168.1.1", // Scientific notation
          "+127.0.0.1", // Unary plus
          "1e2.0.0.1", // 100 via scientific notation
          "25e0.0.0.1", // 25 via scientific notation
        ];

        for (const addr of nonDecimal) {
          const result = parser.parse(addr);
          assert.ok(
            !result.success,
            `Should reject non-decimal IPv4 octet: ${addr}`,
          );
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

  describe("contradictory min > max", () => {
    it("should throw RangeError for number mode when min > max", () => {
      assert.throws(
        () => port({ min: 1000, max: 100 }),
        RangeError,
      );
    });

    it("should throw RangeError for bigint mode when min > max", () => {
      assert.throws(
        () => port({ type: "bigint", min: 1000n, max: 100n }),
        RangeError,
      );
    });

    it("should not throw when min equals max (number mode)", () => {
      assert.doesNotThrow(() => port({ min: 8080, max: 8080 }));
    });

    it("should not throw when min equals max (bigint mode)", () => {
      assert.doesNotThrow(
        () => port({ type: "bigint", min: 8080n, max: 8080n }),
      );
    });

    it("should throw RangeError when min exceeds default max", () => {
      assert.throws(
        () => port({ min: 70000 }),
        RangeError,
      );
    });

    it("should throw RangeError when max is below default min", () => {
      assert.throws(
        () => port({ max: 0 }),
        RangeError,
      );
    });

    it("should throw RangeError when bigint min exceeds default max", () => {
      assert.throws(
        () => port({ type: "bigint", min: 70000n }),
        RangeError,
      );
    });

    it("should throw RangeError when bigint max is below default min", () => {
      assert.throws(
        () => port({ type: "bigint", max: 0n }),
        RangeError,
      );
    });
  });

  describe("non-finite bounds", () => {
    it("should throw RangeError when min is NaN", () => {
      assert.throws(
        () => port({ min: NaN as never }),
        RangeError,
      );
    });

    it("should throw RangeError when max is NaN", () => {
      assert.throws(
        () => port({ max: NaN as never }),
        RangeError,
      );
    });

    it("should throw RangeError when min is Infinity", () => {
      assert.throws(
        () => port({ min: Infinity as never }),
        RangeError,
      );
    });

    it("should throw RangeError when min is -Infinity", () => {
      assert.throws(
        () => port({ min: -Infinity as never }),
        RangeError,
      );
    });

    it("should throw RangeError when max is Infinity", () => {
      assert.throws(
        () => port({ max: Infinity as never }),
        RangeError,
      );
    });

    it("should throw RangeError when max is -Infinity", () => {
      assert.throws(
        () => port({ max: -Infinity as never }),
        RangeError,
      );
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

    it("should reject wildcard outside leftmost position", () => {
      const parser = hostname({ allowWildcard: true });

      const result1 = parser.parse("foo.*.com");
      assert.ok(!result1.success);

      const result2 = parser.parse("example.*");
      assert.ok(!result2.success);
    });

    it("should reject bare wildcard", () => {
      const parser = hostname({ allowWildcard: true });

      const result = parser.parse("*");
      assert.ok(!result.success);
    });

    it("should reject wildcard forms when allowWildcard is false", () => {
      const parser = hostname();

      const result1 = parser.parse("*");
      assert.ok(!result1.success);

      const result2 = parser.parse("foo.*.com");
      assert.ok(!result2.success);

      const result3 = parser.parse("example.*");
      assert.ok(!result3.success);
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

    it("should reject case variants of localhost", () => {
      const parser = hostname({ allowLocalhost: false });

      for (const variant of ["LOCALHOST", "LocalHost", "Localhost"]) {
        const result = parser.parse(variant);
        assert.ok(!result.success, `expected ${variant} to be rejected`);
        assert.deepStrictEqual(result.error, [
          { type: "text", text: "Hostname 'localhost' is not allowed." },
        ]);
      }
    });

    it("should accept case variants when allowLocalhost is true", () => {
      const parser = hostname({ allowLocalhost: true });

      for (const variant of ["LOCALHOST", "LocalHost", "Localhost"]) {
        const result = parser.parse(variant);
        assert.ok(result.success, `expected ${variant} to be accepted`);
      }
    });

    it("should reject wildcard localhost when allowLocalhost is false", () => {
      const parser = hostname({
        allowLocalhost: false,
        allowWildcard: true,
      });

      for (
        const variant of ["*.localhost", "*.LOCALHOST", "*.LocalHost"]
      ) {
        const result = parser.parse(variant);
        assert.ok(!result.success, `expected ${variant} to be rejected`);
        assert.deepStrictEqual(result.error, [
          { type: "text", text: "Hostname 'localhost' is not allowed." },
        ]);
      }
    });

    it("should accept wildcard localhost when allowLocalhost is true", () => {
      const parser = hostname({
        allowLocalhost: true,
        allowWildcard: true,
      });

      const result = parser.parse("*.localhost");
      assert.ok(result.success);
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

    it("should throw RangeError when maxLength is 0", () => {
      assert.throws(
        () => hostname({ maxLength: 0 }),
        {
          name: "RangeError",
          message: "maxLength must be an integer greater than or equal to 1.",
        },
      );
    });

    it("should throw RangeError when maxLength is negative", () => {
      assert.throws(
        () => hostname({ maxLength: -1 }),
        {
          name: "RangeError",
          message: "maxLength must be an integer greater than or equal to 1.",
        },
      );
    });

    it("should throw RangeError when maxLength is NaN", () => {
      assert.throws(
        () => hostname({ maxLength: NaN }),
        {
          name: "RangeError",
          message: "maxLength must be an integer greater than or equal to 1.",
        },
      );
    });

    it("should throw RangeError when maxLength is fractional", () => {
      assert.throws(
        () => hostname({ maxLength: 1.5 }),
        {
          name: "RangeError",
          message: "maxLength must be an integer greater than or equal to 1.",
        },
      );
    });

    it("should not throw when maxLength is 1", () => {
      assert.doesNotThrow(
        () => hostname({ maxLength: 1 }),
      );
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

    it("should reject dotted all-numeric strings (IPv4-like)", () => {
      const parser = hostname();

      // Dotted all-numeric patterns should be rejected
      assert.ok(!parser.parse("192.168.0.1").success);
      assert.ok(!parser.parse("127.0.0.1").success);
      assert.ok(!parser.parse("999.999.999.999").success);
      assert.ok(!parser.parse("1.2.3.4").success);
      assert.ok(!parser.parse("123.456.789").success);
      assert.ok(!parser.parse("0.0").success);
    });

    it("should accept single numeric labels", () => {
      const parser = hostname();

      // A single numeric label is fine (not dotted)
      assert.ok(parser.parse("123").success);
      assert.ok(parser.parse("0").success);
    });

    it("should accept mixed numeric and alphabetic labels", () => {
      const parser = hostname();

      // At least one label has a non-digit character
      assert.ok(parser.parse("server1.123.com").success);
      assert.ok(parser.parse("1a.2b.3c.4d").success);
      assert.ok(parser.parse("192.168.0.example").success);
    });
  });

  describe("runtime option type validation", () => {
    it("should throw TypeError for non-boolean allowWildcard", () => {
      assert.throws(
        () => hostname({ allowWildcard: "yes" as never }),
        {
          name: "TypeError",
          message:
            "Expected allowWildcard to be a boolean, but got string: yes.",
        },
      );
    });

    it("should throw TypeError for non-boolean allowUnderscore", () => {
      assert.throws(
        () => hostname({ allowUnderscore: "yes" as never }),
        {
          name: "TypeError",
          message:
            "Expected allowUnderscore to be a boolean, but got string: yes.",
        },
      );
    });

    it("should throw TypeError for non-boolean allowLocalhost", () => {
      assert.throws(
        () => hostname({ allowLocalhost: "no" as never }),
        {
          name: "TypeError",
          message:
            "Expected allowLocalhost to be a boolean, but got string: no.",
        },
      );
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

      // All-numeric domain labels (IPv4-like patterns)
      const result11 = parser.parse("user@192.168.0.1");
      assert.ok(!result11.success);

      const result12 = parser.parse("user@127.0.0.1");
      assert.ok(!result12.success);

      const result13 = parser.parse("user@999.999.999.999");
      assert.ok(!result13.success);

      const result14 = parser.parse("user@0.0.0.0");
      assert.ok(!result14.success);

      // Mixed numeric and alphabetic labels should still be valid
      const result15 = parser.parse("user@123.example.com");
      assert.ok(result15.success);

      // All-numeric but not exactly 4 labels (not IPv4-like) should be valid
      const result16 = parser.parse("user@123.456");
      assert.ok(result16.success);

      const result17 = parser.parse("user@1.2.3");
      assert.ok(result17.success);
    });

    it("should accept local part with exactly 64 characters", () => {
      const parser = email();
      const localPart = "a".repeat(64);
      const result = parser.parse(`${localPart}@example.com`);
      assert.ok(result.success);
    });

    it("should reject local part exceeding 64 characters", () => {
      const parser = email();
      const localPart = "a".repeat(65);
      const result = parser.parse(`${localPart}@example.com`);
      assert.ok(!result.success);
    });

    it("should reject quoted local part exceeding 64 characters", () => {
      const parser = email();
      // Quoted local part: quotes are included in the 64-char limit
      const inner = "a".repeat(63);
      const result = parser.parse(`"${inner}"@example.com`);
      assert.ok(!result.success);
    });

    it("should measure local-part limit in octets, not code units", () => {
      const parser = email();
      // "¢" is U+00A2, 2 bytes in UTF-8; 32 of them = 64 bytes
      // Plus 2 quote characters = 66 bytes, exceeding the 64-octet limit
      const result = parser.parse(`"${"\u00A2".repeat(32)}"@example.com`);
      assert.ok(!result.success);
    });

    it("should accept quoted local part at exactly 64 octets with multibyte characters", () => {
      const parser = email();
      // "¢" is U+00A2, 2 bytes in UTF-8; 31 of them = 62 bytes
      // Plus 2 quote characters = 64 bytes, exactly at the limit
      const localPart = `"${"\u00A2".repeat(31)}"`;
      assert.strictEqual(new TextEncoder().encode(localPart).length, 64);
      const result = parser.parse(`${localPart}@example.com`);
      assert.ok(result.success);
    });

    it("should accept address with exactly 254 characters", () => {
      const parser = email();
      // "user" (4) + "@" (1) + domain (249) = 254
      // domain: 63 + "." + 63 + "." + 63 + "." + 57 = 249
      const label = "a".repeat(63);
      const domain = `${label}.${label}.${label}.${"a".repeat(57)}`;
      assert.strictEqual(domain.length, 249);
      const addr = `user@${domain}`;
      assert.strictEqual(addr.length, 254);
      const result = parser.parse(addr);
      assert.ok(result.success);
    });

    it("should reject address exceeding 254 characters", () => {
      const parser = email();
      const label = "a".repeat(63);
      const domain = `${label}.${label}.${label}.${"a".repeat(58)}`;
      assert.strictEqual(domain.length, 250);
      const addr = `user@${domain}`;
      assert.strictEqual(addr.length, 255);
      const result = parser.parse(addr);
      assert.ok(!result.success);
    });

    it("should enforce length limits with allowDisplayName", () => {
      const parser = email({ allowDisplayName: true });
      const localPart = "a".repeat(65);
      const result = parser.parse(`John Doe <${localPart}@example.com>`);
      assert.ok(!result.success);
    });

    it("should enforce length limits with allowMultiple", () => {
      const parser = email({ allowMultiple: true });
      const localPart = "a".repeat(65);
      const result = parser.parse(
        `valid@example.com, ${localPart}@example.com`,
      );
      assert.ok(!result.success);
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

    it("should not split on commas inside quoted local parts", () => {
      const parser = email({ allowMultiple: true });

      const result = parser.parse('"a,b"@example.com, c@example.com');
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, [
        '"a,b"@example.com',
        "c@example.com",
      ]);
    });

    it("should not split on commas inside quoted local parts for a single email", () => {
      const parser = email({ allowMultiple: true });

      const result = parser.parse('"a,b"@example.com');
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, ['"a,b"@example.com']);
    });

    it("should not split on commas after escaped quotes in local parts", () => {
      const parser = email({ allowMultiple: true });

      const result = parser.parse('"a\\",b"@example.com, c@example.com');
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, [
        '"a\\",b"@example.com',
        "c@example.com",
      ]);
    });

    it("should not split on commas after escaped quotes in display names", () => {
      const parser = email({
        allowMultiple: true,
        allowDisplayName: true,
      });

      const result = parser.parse(
        '"Doe \\", John" <john@example.com>, jane@example.com',
      );
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, [
        "john@example.com",
        "jane@example.com",
      ]);
    });

    it("should handle consecutive quotes in local parts without regression", () => {
      const parser = email({ allowMultiple: true });

      const result = parser.parse('"""@example.com, c@example.com');
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, [
        '"""@example.com',
        "c@example.com",
      ]);
    });

    it("should not split on commas inside display names", () => {
      const parser = email({
        allowMultiple: true,
        allowDisplayName: true,
      });

      const result = parser.parse(
        '"Doe, John" <john@example.com>, jane@example.com',
      );
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, [
        "john@example.com",
        "jane@example.com",
      ]);
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

    it("should reject malformed display name with multiple angle-bracket groups", () => {
      const parser = email({ allowDisplayName: true });

      const result1 = parser.parse(
        "Name <user@example.com> extra <x@y.com>",
      );
      assert.ok(!result1.success);

      const result2 = parser.parse(
        "junk <first@example.com> <second@example.com>",
      );
      assert.ok(!result2.success);

      const result3 = parser.parse("Name <user@example.com> extra");
      assert.ok(!result3.success);
    });

    it("should reject bare angle-bracket wrapper without display name", () => {
      const parser = email({ allowDisplayName: true });

      const result = parser.parse("<user@example.com>");
      assert.ok(!result.success);
    });

    it("should reject empty or whitespace-only quoted display names", () => {
      const parser = email({ allowDisplayName: true });

      const result1 = parser.parse('"" <user@example.com>');
      assert.ok(!result1.success);

      const result2 = parser.parse('"   " <user@example.com>');
      assert.ok(!result2.success);
    });

    it("should accept well-formed display names with dots and hyphens", () => {
      const parser = email({ allowDisplayName: true });

      const result = parser.parse("Dr. Smith-Jones <smith@example.com>");
      assert.ok(result.success);
      assert.strictEqual(result.value, "smith@example.com");
    });

    it("should accept mixed quoted and unquoted words in display name", () => {
      const parser = email({ allowDisplayName: true });

      const result1 = parser.parse(
        'John "Johnny" Doe <john@example.com>',
      );
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "john@example.com");

      const result2 = parser.parse('"John" Doe <john@example.com>');
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "john@example.com");
    });

    it("should accept quoted display names containing angle brackets", () => {
      const parser = email({ allowDisplayName: true });

      const result = parser.parse(
        '"Team <Ops>" <alerts@example.com>',
      );
      assert.ok(result.success);
      assert.strictEqual(result.value, "alerts@example.com");
    });
  });

  describe("lowercase option", () => {
    it("should lowercase only the domain when lowercase is true", () => {
      const parser = email({ lowercase: true });

      const result1 = parser.parse("User@Example.COM");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "User@example.com");

      const result2 = parser.parse("ADMIN@COMPANY.NET");
      assert.ok(result2.success);
      assert.strictEqual(result2.value, "ADMIN@company.net");
    });

    it("should preserve local part case including quoted local parts", () => {
      const parser = email({ lowercase: true });

      const result1 = parser.parse("User.Name+Tag@Example.COM");
      assert.ok(result1.success);
      assert.strictEqual(result1.value, "User.Name+Tag@example.com");

      const result2 = parser.parse('"Case.Sensitive"@Example.COM');
      assert.ok(result2.success);
      assert.strictEqual(result2.value, '"Case.Sensitive"@example.com');
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
        "User1@example.com",
        "User2@example.org",
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
        { type: "text", text: " is not allowed. Allowed domains: " },
        { type: "value", value: "example.com" },
        { type: "text", text: " and " },
        { type: "value", value: "example.org" },
        { type: "text", text: "." },
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

    it("should throw TypeError when allowedDomains is empty", () => {
      assert.throws(
        () => email({ allowedDomains: [] }),
        {
          name: "TypeError",
          message: "allowedDomains must not be empty.",
        },
      );
    });

    it("should throw TypeError when allowedDomains is empty with allowMultiple", () => {
      assert.throws(
        () => email({ allowedDomains: [], allowMultiple: true }),
        {
          name: "TypeError",
          message: "allowedDomains must not be empty.",
        },
      );
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

    it("should return multiple emails joined by comma-space", () => {
      const parser = email({ allowMultiple: true });

      assert.strictEqual(
        parser.format(["user1@example.com", "user2@example.com"]),
        "user1@example.com, user2@example.com",
      );
    });

    it("should round-trip emails with quoted commas in local part", () => {
      const parser = email({ allowMultiple: true });
      const value = ['"Doe, John"@example.com', "x@example.com"];

      const formatted = parser.format(value);
      const parsed = parser.parse(formatted);
      assert.ok(parsed.success);
      assert.deepStrictEqual(parsed.value, value);
    });

    it("should round-trip emails with escaped quotes and commas", () => {
      const parser = email({ allowMultiple: true });
      const value = ['"a\\",b"@example.com', "d@example.com"];

      const formatted = parser.format(value);
      const parsed = parser.parse(formatted);
      assert.ok(parsed.success);
      assert.deepStrictEqual(parsed.value, value);
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
        "User1@example.com",
        "User2@example.com",
      ]);
    });

    it("should snapshot allowedDomains at construction time", () => {
      const domains = ["example.com"];
      const parser = email({ allowedDomains: domains });
      assert.ok(parser.parse("a@example.com").success);
      assert.ok(!parser.parse("a@other.com").success);
      // Mutate domains after construction
      domains[0] = "other.com";
      // Parser should still accept example.com and reject other.com
      assert.ok(parser.parse("a@example.com").success);
      assert.ok(!parser.parse("a@other.com").success);
    });

    it("should snapshot errors.invalidEmail at construction time", () => {
      const errors: { invalidEmail: string } = {
        invalidEmail: "original error",
      };
      const parser = email({ errors: errors as never });
      const result = parser.parse("not-an-email");
      assert.ok(!result.success);
      if (!result.success) assert.equal(result.error, "original error");
      errors.invalidEmail = "mutated error";
      const result2 = parser.parse("not-an-email");
      assert.ok(!result2.success);
      if (!result2.success) assert.equal(result2.error, "original error");
    });

    it("should snapshot errors.domainNotAllowed at construction time", () => {
      const errors: { domainNotAllowed: string } = {
        domainNotAllowed: "original error",
      };
      const parser = email({
        allowedDomains: ["example.com"],
        errors: errors as never,
      });
      const result = parser.parse("a@other.com");
      assert.ok(!result.success);
      if (!result.success) assert.equal(result.error, "original error");
      errors.domainNotAllowed = "mutated error";
      const result2 = parser.parse("a@other.com");
      assert.ok(!result2.success);
      if (!result2.success) assert.equal(result2.error, "original error");
    });

    it("should throw TypeError for non-string allowedDomains entries", () => {
      assert.throws(
        () => email({ allowedDomains: [123 as never] }),
        { name: "TypeError", message: /allowedDomains\[0\].*must be a string/ },
      );
      assert.throws(
        () => email({ allowedDomains: [null as never] }),
        { name: "TypeError", message: /allowedDomains\[0\].*must be a string/ },
      );
      assert.throws(
        () => email({ allowedDomains: [undefined as never] }),
        { name: "TypeError", message: /allowedDomains\[0\].*must be a string/ },
      );
    });

    it("should throw TypeError for allowedDomains entries with leading @", () => {
      assert.throws(
        () => email({ allowedDomains: ["@example.com"] as never }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*must not start with "@"/,
        },
      );
    });

    it("should throw TypeError for allowedDomains entries with trailing dot", () => {
      assert.throws(
        () => email({ allowedDomains: ["example.com."] as never }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*not a valid domain/,
        },
      );
    });

    it("should throw TypeError for allowedDomains entries with whitespace", () => {
      assert.throws(
        () => email({ allowedDomains: [" example.com "] as never }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*whitespace/,
        },
      );
      assert.throws(
        () => email({ allowedDomains: [" example.com"] as never }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*whitespace/,
        },
      );
      assert.throws(
        () => email({ allowedDomains: ["example.com "] as never }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*whitespace/,
        },
      );
    });

    it("should throw TypeError for empty string allowedDomains entries", () => {
      assert.throws(
        () => email({ allowedDomains: [""] as never }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*not a valid domain/,
        },
      );
    });

    it("should throw TypeError for malformed domain syntax", () => {
      // Leading dot
      assert.throws(
        () => email({ allowedDomains: [".example.com"] as never }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*not a valid domain/,
        },
      );
      // Consecutive dots
      assert.throws(
        () => email({ allowedDomains: ["foo..bar.com"] as never }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*not a valid domain/,
        },
      );
      // Embedded space
      assert.throws(
        () => email({ allowedDomains: ["exa mple.com"] as never }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*not a valid domain/,
        },
      );
      // No dot (bare label)
      assert.throws(
        () => email({ allowedDomains: ["localhost"] as never }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*not a valid domain/,
        },
      );
      // Leading hyphen
      assert.throws(
        () => email({ allowedDomains: ["-example.com"] as never }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*not a valid domain/,
        },
      );
      // Trailing hyphen
      assert.throws(
        () => email({ allowedDomains: ["example-.com"] as never }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*not a valid domain/,
        },
      );
      // Label exceeding 63 characters
      assert.throws(
        () =>
          email({
            allowedDomains: [`${"a".repeat(64)}.com`] as never,
          }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*not a valid domain/,
        },
      );
      // IPv4-like dotted-quad
      assert.throws(
        () => email({ allowedDomains: ["192.168.0.1"] as never }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*not a valid domain/,
        },
      );
      assert.throws(
        () => email({ allowedDomains: ["999.999.999.999"] as never }),
        {
          name: "TypeError",
          message: /allowedDomains\[0\].*not a valid domain/,
        },
      );
    });

    it("should accept valid allowedDomains entries without throwing", () => {
      assert.doesNotThrow(
        () => email({ allowedDomains: ["example.com", "test.org"] }),
      );
      assert.doesNotThrow(
        () => email({ allowedDomains: ["sub.example.com"] }),
      );
      assert.doesNotThrow(
        () => email({ allowedDomains: ["my-domain.co.uk"] }),
      );
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

    it("should reject non-decimal literals in ranges", () => {
      const parser = portRange({ type: "bigint" });

      // Plus-signed
      assert.ok(!parser.parse("+80-81").success);

      // Hex literals
      assert.ok(!parser.parse("0x50-0x51").success);

      // Binary literals
      assert.ok(!parser.parse("0b1010000-0b1010001").success);

      // Octal literals
      assert.ok(!parser.parse("0o120-0o121").success);
    });

    it("should reject non-decimal literals in single port mode", () => {
      const parser = portRange({ type: "bigint", allowSingle: true });

      assert.ok(!parser.parse("+80").success);
      assert.ok(!parser.parse("0x50").success);
      assert.ok(!parser.parse("0b1010000").success);
      assert.ok(!parser.parse("0o120").success);
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

    it("should reflect custom separator in default metavar", () => {
      assert.strictEqual(
        portRange({ separator: ":" }).metavar,
        "PORT:PORT",
      );
      assert.strictEqual(
        portRange({ separator: " to " }).metavar,
        "PORT to PORT",
      );
    });

    it("should prefer explicit metavar over separator-derived one", () => {
      const parser = portRange({ separator: ":", metavar: "CUSTOM" });
      assert.strictEqual(parser.metavar, "CUSTOM");
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

  describe("boolean option validation", () => {
    it("should reject non-boolean disallowWellKnown option", () => {
      assert.throws(
        () => portRange({ disallowWellKnown: "no" as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ disallowWellKnown: 1 as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ disallowWellKnown: "true" as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ disallowWellKnown: 0 as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ disallowWellKnown: null as never }),
        TypeError,
      );
    });

    it("should reject non-boolean disallowWellKnown option (bigint)", () => {
      assert.throws(
        () => portRange({ type: "bigint", disallowWellKnown: "no" as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ type: "bigint", disallowWellKnown: 1 as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ type: "bigint", disallowWellKnown: "true" as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ type: "bigint", disallowWellKnown: 0 as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ type: "bigint", disallowWellKnown: null as never }),
        TypeError,
      );
    });

    it("should reject non-boolean allowSingle option", () => {
      assert.throws(
        () => portRange({ allowSingle: "no" as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ allowSingle: 1 as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ allowSingle: "true" as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ allowSingle: 0 as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ allowSingle: null as never }),
        TypeError,
      );
    });

    it("should reject non-boolean allowSingle option (bigint)", () => {
      assert.throws(
        () => portRange({ type: "bigint", allowSingle: "no" as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ type: "bigint", allowSingle: 1 as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ type: "bigint", allowSingle: "true" as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ type: "bigint", allowSingle: 0 as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ type: "bigint", allowSingle: null as never }),
        TypeError,
      );
    });
  });

  describe("type discriminant validation", () => {
    it("should reject invalid type discriminant", () => {
      assert.throws(
        () => portRange({ type: "num" as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ type: 123 as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ type: null as never }),
        TypeError,
      );
      assert.throws(
        () => portRange({ type: "" as never }),
        TypeError,
      );
    });

    it("should accept valid type discriminant", () => {
      assert.ok(portRange({ type: "number" }));
      assert.ok(portRange({ type: "bigint" }));
      assert.ok(portRange());
    });
  });

  describe("separator validation", () => {
    it("should reject empty separator", () => {
      assert.throws(
        () => portRange({ separator: "" }),
        {
          name: "TypeError",
          message: "Expected separator to not be empty.",
        },
      );
      assert.throws(
        () => portRange({ type: "bigint", separator: "" }),
        {
          name: "TypeError",
          message: "Expected separator to not be empty.",
        },
      );
    });

    it("should reject separator containing digits", () => {
      assert.throws(
        () => portRange({ separator: "0" }),
        TypeError,
      );
      assert.throws(
        () => portRange({ separator: "8" }),
        TypeError,
      );
      assert.throws(
        () => portRange({ separator: "123" }),
        TypeError,
      );
      assert.throws(
        () => portRange({ separator: "a1b" }),
        TypeError,
      );
      // Unicode digits (Arabic-Indic)
      assert.throws(
        () => portRange({ separator: "\u0661" }),
        TypeError,
      );
      // Unicode digits (Devanagari)
      assert.throws(
        () => portRange({ separator: "\u0967" }),
        TypeError,
      );
    });

    it("should reject separator containing digits (bigint)", () => {
      assert.throws(
        () => portRange({ type: "bigint", separator: "0" }),
        TypeError,
      );
      assert.throws(
        () => portRange({ type: "bigint", separator: "8" }),
        TypeError,
      );
    });

    it("should accept separator without digits", () => {
      assert.ok(portRange({ separator: ":" }));
      assert.ok(portRange({ separator: " to " }));
      assert.ok(portRange({ separator: ".." }));
      assert.ok(portRange({ separator: "-" }));
    });
  });

  describe("contradictory min > max", () => {
    it("should throw RangeError for number mode when min > max", () => {
      assert.throws(
        () => portRange({ min: 9000, max: 1000 }),
        RangeError,
      );
    });

    it("should throw RangeError for bigint mode when min > max", () => {
      assert.throws(
        () => portRange({ type: "bigint", min: 9000n, max: 1000n }),
        RangeError,
      );
    });

    it("should not throw when min equals max (number mode)", () => {
      assert.doesNotThrow(() => portRange({ min: 8080, max: 8080 }));
    });

    it("should not throw when min equals max (bigint mode)", () => {
      assert.doesNotThrow(
        () => portRange({ type: "bigint", min: 8080n, max: 8080n }),
      );
    });

    it("should throw RangeError when min exceeds default max", () => {
      assert.throws(
        () => portRange({ min: 70000 }),
        RangeError,
      );
    });

    it("should throw RangeError when max is below default min", () => {
      assert.throws(
        () => portRange({ max: 0 }),
        RangeError,
      );
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

    it("should reflect custom separator in default metavar", () => {
      assert.strictEqual(
        socketAddress({ separator: " " }).metavar,
        "HOST PORT",
      );
    });

    it("should prefer explicit metavar over separator-derived one", () => {
      const parser = socketAddress({ separator: " ", metavar: "CUSTOM" });
      assert.strictEqual(parser.metavar, "CUSTOM");
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

  describe("separator validation", () => {
    it("should reject empty separator", () => {
      assert.throws(
        () => socketAddress({ separator: "", defaultPort: 80 }),
        {
          name: "TypeError",
          message: "Expected separator to not be empty.",
        },
      );
    });

    it("should reject separator containing digits", () => {
      assert.throws(
        () => socketAddress({ separator: "0", defaultPort: 80 }),
        TypeError,
      );
      assert.throws(
        () => socketAddress({ separator: "8", defaultPort: 80 }),
        TypeError,
      );
      assert.throws(
        () => socketAddress({ separator: "123", defaultPort: 80 }),
        TypeError,
      );
      assert.throws(
        () => socketAddress({ separator: "a1b", defaultPort: 80 }),
        TypeError,
      );
      // Unicode digits (Arabic-Indic)
      assert.throws(
        () => socketAddress({ separator: "\u0661", defaultPort: 80 }),
        TypeError,
      );
      // Unicode digits (Devanagari)
      assert.throws(
        () => socketAddress({ separator: "\u0967", defaultPort: 80 }),
        TypeError,
      );
    });

    it("should accept separator without digits", () => {
      assert.ok(socketAddress({ separator: ":", defaultPort: 80 }));
      assert.ok(socketAddress({ separator: " ", defaultPort: 80 }));
    });
  });

  describe("IP bypass prevention in both mode", () => {
    it("should reject private IP with specific error in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowPrivate: false } },
      });

      const result = parser.parse("192.168.1.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "192.168.1.1" },
        { type: "text", text: " is a private IP address." },
      ]);
    });

    it("should reject loopback IP with specific error in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
      });

      const result = parser.parse("127.0.0.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "127.0.0.1" },
        { type: "text", text: " is a loopback address." },
      ]);
    });

    it("should reject link-local IP with specific error in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLinkLocal: false } },
      });

      const result = parser.parse("169.254.1.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "169.254.1.1" },
        { type: "text", text: " is a link-local address." },
      ]);
    });

    it("should reject invalid IPv4 with specific error in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both" },
      });

      const result1 = parser.parse("999.999.999.999");
      assert.ok(!result1.success);
      assert.deepStrictEqual(result1.error, [
        { type: "text", text: "Expected a valid IPv4 address, but got " },
        { type: "value", value: "999.999.999.999" },
        { type: "text", text: "." },
      ]);

      const result2 = parser.parse("256.256.256.256");
      assert.ok(!result2.success);
      assert.deepStrictEqual(result2.error, [
        { type: "text", text: "Expected a valid IPv4 address, but got " },
        { type: "value", value: "256.256.256.256" },
        { type: "text", text: "." },
      ]);
    });

    it("should reject restricted IP with port in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowPrivate: false } },
      });

      const result = parser.parse("192.168.1.1:80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "192.168.1.1" },
        { type: "text", text: " is a private IP address." },
      ]);
    });

    it("should still accept valid hostnames in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowPrivate: false } },
      });

      const result1 = parser.parse("example.com:443");
      assert.ok(result1.success);
      assert.strictEqual(result1.value.host, "example.com");

      const result2 = parser.parse("localhost");
      assert.ok(result2.success);
      assert.strictEqual(result2.value.host, "localhost");
    });

    it("should still accept valid unrestricted IPs in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowPrivate: false } },
      });

      const result = parser.parse("8.8.8.8:53");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "8.8.8.8");
      assert.strictEqual(result.value.port, 53);
    });

    it("should use custom invalidFormat over specific IP error", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowPrivate: false } },
        errors: {
          invalidFormat: message`Custom error`,
        },
      });

      const result = parser.parse("192.168.1.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Custom error" },
      ]);
    });

    it("should use socket-level format error for empty host", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both" },
      });

      // Empty host gets socket-level error, not host parser error
      const result = parser.parse(":8080");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: ":" },
        { type: "text", text: "port, but got " },
        { type: "value", value: ":8080" },
        { type: "text", text: "." },
      ]);
    });

    it("should propagate hostname error for non-IP malformed host", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both" },
      });

      // Invalid hostname gets the specific hostname parser error
      const result = parser.parse("-invalid.com:80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid hostname, but got " },
        { type: "value", value: "-invalid.com" },
        { type: "text", text: "." },
      ]);
    });

    it("should treat non-decimal dotted strings as hostnames in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowPrivate: false } },
      });

      // "192e0" is not a valid decimal IPv4 octet, so 192e0.168.1.1
      // is not an IPv4 address.  It IS a valid DNS hostname label
      // (alphanumeric), so it is accepted as a hostname.
      const result = parser.parse("192e0.168.1.1");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "192e0.168.1.1");
    });

    it("should reject IP-shaped input in hostname mode regardless of IP restrictions", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "hostname", ip: { allowPrivate: false } },
      });

      // Even though IP parser with allowPrivate:false would reject this,
      // it should still be detected as IP-shaped and rejected
      const result = parser.parse("192.168.1.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid hostname, but got " },
        { type: "value", value: "192.168.1.1" },
        { type: "text", text: "." },
      ]);
    });
  });

  describe("alternate IPv4 literal rejection", () => {
    it("should reject hex-dotted octets in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
      });

      const result = parser.parse("0x7f.0x0.0x0.0x1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "0x7f.0x0.0x0.0x1" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should reject mixed hex/decimal dotted in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
      });

      const result = parser.parse("0x7f.0.0.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "0x7f.0.0.1" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should reject single hex integer in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
      });

      const result = parser.parse("0x7f000001");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "0x7f000001" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should reject octal integer in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
      });

      // 017700000001 in octal = 2130706433 = 127.0.0.1
      const result = parser.parse("017700000001");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "017700000001" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should reject short octal integer in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both" },
      });

      // 0177 in octal = 127 → 0.0.0.127
      const result = parser.parse("0177");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "0177" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should reject pure octal-dotted forms with specific error", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
      });

      // 4-part: 0177 = octal 127 → 127.0.0.1
      const result1 = parser.parse("0177.0.0.1");
      assert.ok(!result1.success);
      assert.deepStrictEqual(result1.error, [
        { type: "value", value: "0177.0.0.1" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);

      // 2-part: 0177 = octal 127, 1 → WHATWG: 127.0.0.1
      const result2 = parser.parse("0177.1");
      assert.ok(!result2.success);
      assert.deepStrictEqual(result2.error, [
        { type: "value", value: "0177.1" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);

      // 3-part: 0177 = octal 127 → WHATWG: 127.0.1
      const result3 = parser.parse("0177.0.1");
      assert.ok(!result3.success);
      assert.deepStrictEqual(result3.error, [
        { type: "value", value: "0177.0.1" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should reject pure octal-dotted forms in hostname mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "hostname" },
      });

      const result = parser.parse("0177.0.0.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "0177.0.0.1" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should reject 2-part hex dotted in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
      });

      const result = parser.parse("0x7f.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "0x7f.1" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should reject 3-part hex dotted in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
      });

      const result = parser.parse("0x7f.0.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "0x7f.0.1" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should reject hex-dotted with port in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
      });

      const result = parser.parse("0x7f.0x0.0x0.0x1:80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "0x7f.0x0.0x0.0x1" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should reject uppercase hex in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
      });

      const result = parser.parse("0X7F000001");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "0X7F000001" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should reject mixed hex/octal dotted forms in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
      });

      // 0377 = octal 255, 0x1 = hex 1 → WHATWG: 255.0.0.1
      const result1 = parser.parse("0377.0.0.0x1");
      assert.ok(!result1.success);
      assert.deepStrictEqual(result1.error, [
        { type: "value", value: "0377.0.0.0x1" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);

      // 0177 = octal 127 → WHATWG: 127.0.0.1 (loopback)
      const result2 = parser.parse("0177.0x0.0.1");
      assert.ok(!result2.success);
      assert.deepStrictEqual(result2.error, [
        { type: "value", value: "0177.0x0.0.1" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should accept mixed dotted forms with invalid octal digits", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both" },
      });

      // 08 contains digit 8, not valid octal — WHATWG IPv4 parsing
      // fails on this part, so the form is not a valid IPv4 literal
      const result = parser.parse("08.0.0.0x1");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "08.0.0.0x1");
    });

    it("should reject private IP in hex-dotted in both mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowPrivate: false } },
      });

      const result = parser.parse("0xC0.0xA8.0x01.0x01");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "0xC0.0xA8.0x01.0x01" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should reject hex-dotted octets in hostname mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "hostname" },
      });

      const result = parser.parse("0x7f.0x0.0x0.0x1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "0x7f.0x0.0x0.0x1" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should reject single hex integer in hostname mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "hostname" },
      });

      const result = parser.parse("0x7f000001");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "0x7f000001" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should still accept non-hex alphanumeric dotted hostnames", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
      });

      // "192e0" is not hex-prefixed, so it's a valid hostname label
      const result1 = parser.parse("192e0.168.1.1");
      assert.ok(result1.success);
      assert.strictEqual(result1.value.host, "192e0.168.1.1");

      // Purely alphabetic dotted hostnames remain valid
      const result2 = parser.parse("abc.def.ghi.jkl");
      assert.ok(result2.success);
      assert.strictEqual(result2.value.host, "abc.def.ghi.jkl");
    });

    it("should still accept valid hostnames and IPs alongside alt literal rejection", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowPrivate: false } },
      });

      const result1 = parser.parse("example.com:443");
      assert.ok(result1.success);
      assert.strictEqual(result1.value.host, "example.com");

      const result2 = parser.parse("8.8.8.8:53");
      assert.ok(result2.success);
      assert.strictEqual(result2.value.host, "8.8.8.8");
    });

    it("should use custom invalidFormat over alt literal error", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
        errors: {
          invalidFormat: message`Custom error`,
        },
      });

      const result = parser.parse("0x7f000001");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Custom error" },
      ]);
    });

    it("should accept plain decimal integers as hostnames", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both" },
      });

      // Plain decimal integers have no syntactic marker (unlike 0x or
      // leading-zero octal), so they are genuinely ambiguous between
      // hostnames and IPv4 literals.  Accept them as hostnames.
      const result1 = parser.parse("123");
      assert.ok(result1.success);
      assert.strictEqual(result1.value.host, "123");

      const result2 = parser.parse("1234");
      assert.ok(result2.success);
      assert.strictEqual(result2.value.host, "1234");

      const result3 = parser.parse("2130706433");
      assert.ok(result3.success);
      assert.strictEqual(result3.value.host, "2130706433");
    });

    it("should accept plain decimal integers in hostname mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "hostname" },
      });

      const result = parser.parse("1234");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "1234");
    });

    it("should reject octal integer in hostname mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "hostname" },
      });

      const result = parser.parse("017700000001");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "017700000001" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should accept leading-zero numbers with non-octal digits as hostnames", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both" },
      });

      // Contains digits 8/9, not valid octal — treat as hostname
      const result = parser.parse("0189");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "0189");
    });

    it("should accept octal integers exceeding 32-bit range as hostnames", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both" },
      });

      // 040000000000 in octal = 2^32, exceeds 32-bit IPv4 range
      const result = parser.parse("040000000000");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "040000000000");
    });

    it("should accept hex integers exceeding 32-bit range as hostnames", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
      });

      // 0x100000000 = 2^32, exceeds the 32-bit IPv4 range
      const result1 = parser.parse("0x100000000");
      assert.ok(result1.success);
      assert.strictEqual(result1.value.host, "0x100000000");

      // Very large hex value, clearly not IPv4
      const result2 = parser.parse("0xDEADBEEF0");
      assert.ok(result2.success);
      assert.strictEqual(result2.value.host, "0xDEADBEEF0");
    });

    it("should still reject hex integers within 32-bit range", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowLoopback: false } },
      });

      // 0xFFFFFFFF = max 32-bit value, still a valid IPv4 literal
      const result = parser.parse("0xFFFFFFFF");
      assert.ok(!result.success);
    });

    it("should accept hex integers exceeding 32-bit range in hostname mode", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "hostname" },
      });

      const result = parser.parse("0x100000000");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "0x100000000");
    });

    it("should accept dotted hex with out-of-range octets as hostnames", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowPrivate: false } },
      });

      // 0xFFF = 4095 > 255, can't be an IPv4 octet in any part position
      const result = parser.parse("0xFFF.0.0.1");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "0xFFF.0.0.1");
    });
  });

  describe("separator disambiguation", () => {
    it("should not split host-only input when separator appears inside hostname", () => {
      const parser = socketAddress({ separator: "to", defaultPort: 80 });

      const result1 = parser.parse("toronto");
      assert.ok(result1.success);
      assert.strictEqual(result1.value.host, "toronto");
      assert.strictEqual(result1.value.port, 80);

      const result2 = parser.parse("proto");
      assert.ok(result2.success);
      assert.strictEqual(result2.value.host, "proto");
      assert.strictEqual(result2.value.port, 80);
    });

    it("should prefer valid split over host-only to preserve round-trip", () => {
      const parser = socketAddress({ separator: "to", defaultPort: 80 });

      // "exampleto80" has a valid split: host="example", port=80.
      // The split must win over host-only so that parse(format(v)) == v.
      const result1 = parser.parse("exampleto80");
      assert.ok(result1.success);
      assert.strictEqual(result1.value.host, "example");
      assert.strictEqual(result1.value.port, 80);

      const result2 = parser.parse("serverto443");
      assert.ok(result2.success);
      assert.strictEqual(result2.value.host, "server");
      assert.strictEqual(result2.value.port, 443);
    });

    it("should split at separator when requirePort is true", () => {
      const parser = socketAddress({ separator: "to", requirePort: true });

      const result = parser.parse("torontoto8080");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "toronto");
      assert.strictEqual(result.value.port, 8080);
    });

    it("should route to invalidFormat when requirePort is true and separator is present but no valid split exists", () => {
      const parser = socketAddress({ separator: "to", requirePort: true });

      // "toronto" contains "to" but no split produces a valid parse.
      // Since the separator IS present, the error should be
      // invalidFormat, not missingPort.
      const result = parser.parse("toronto");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "to" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "toronto" },
        { type: "text", text: "." },
      ]);
    });

    it("should split when whole input is not a valid hostname", () => {
      // Default separator ":" never appears in valid hostnames,
      // so splitting always works correctly.
      const parser = socketAddress({ separator: ":", defaultPort: 80 });

      const result = parser.parse("localhost:3000");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "localhost");
      assert.strictEqual(result.value.port, 3000);
    });

    it("should report missingPort for valid hostname when no defaultPort", () => {
      // With no defaultPort and requirePort: false (default), a valid
      // hostname should get missingPort, not invalidFormat.
      const parser = socketAddress({ separator: "to" });

      const result = parser.parse("toronto");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        {
          type: "text",
          text: "Port number is required but was not specified.",
        },
      ]);
    });

    it("should try multiple separator positions from right to left", () => {
      const parser = socketAddress({ separator: "to", requirePort: true });

      // "prototo80" has "to" at positions 3 and 5.
      // Right-to-left: pos 5 → host="proto", port="80" → both valid → accept
      const result = parser.parse("prototo80");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "proto");
      assert.strictEqual(result.value.port, 80);
    });

    it("should round-trip through format and parse", () => {
      const parser = socketAddress({ separator: "to", defaultPort: 80 });

      // format() appends separator+port, and since the separator cannot
      // contain digits, parse() always finds that boundary correctly.
      const value = { host: "toronto", port: 8080 };
      const formatted = parser.format(value);
      assert.strictEqual(formatted, "torontoto8080");
      const result = parser.parse(formatted);
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, value);
    });

    it("should fall back to host-only when no valid split exists", () => {
      const parser = socketAddress({ separator: "-", defaultPort: 80 });

      // "example-server" has no valid split (port "server" is not a
      // number), so the whole input is treated as a hostname.
      const result = parser.parse("example-server");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "example-server");
      assert.strictEqual(result.value.port, 80);
    });

    it("should reject when split has valid host but invalid numeric port", () => {
      // "db-70000" should NOT be silently accepted as a hostname.
      // The port part "70000" is all digits → user intended a port.
      // But since the separator "-" can appear in hostnames and the
      // whole input is a valid hostname, the split is ambiguous.
      // The generic format error is returned.
      const parser = socketAddress({ separator: "-", defaultPort: 80 });

      const result = parser.parse("db-70000");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "-" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "db-70000" },
        { type: "text", text: "." },
      ]);
    });

    it("should propagate IP error over numeric port rejection when host is restricted", () => {
      // "192.168.1.1:70000" has a private IP host + out-of-range port.
      // The IP-specific error should surface, not the generic format
      // error from validHostNumericPortInvalid.
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowPrivate: false } },
      });

      const result = parser.parse("192.168.1.1:70000");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "192.168.1.1" },
        { type: "text", text: " is a private IP address." },
      ]);
    });

    it("should reject doubled-separator inputs with invalid numeric port", () => {
      // "db--70000" has host "db-" (invalid trailing hyphen) + port
      // "70000".  The all-digit suffix is still a port typo even though
      // the host part at that split point is invalid.  But since the
      // whole input is a valid hostname, the split is ambiguous and
      // the generic format error is returned.
      const parser = socketAddress({ separator: "-", defaultPort: 80 });

      const result = parser.parse("db--70000");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "-" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "db--70000" },
        { type: "text", text: "." },
      ]);
    });

    it("should ignore non-IP split host errors when the whole input is a valid hostname", () => {
      // "db--oops" splits as host "db-" (invalid trailing hyphen) +
      // port "oops" (non-numeric).  The non-IP host error should be
      // deferred, and the whole input "db--oops" accepted as a hostname.
      const parser = socketAddress({ separator: "-", defaultPort: 80 });

      const result = parser.parse("db--oops");
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, { host: "db--oops", port: 80 });
    });

    it("should route to invalidFormat, not missingPort, when separator is present", () => {
      // "example-com" with separator "-" and requirePort: the separator
      // is present, so the user attempted a split.  Error should be
      // invalidFormat, not missingPort.
      const parser = socketAddress({
        separator: "-",
        requirePort: true,
        errors: {
          invalidFormat: message`Bad format`,
          missingPort: message`Port needed`,
        },
      });

      const result = parser.parse("example-com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Bad format" },
      ]);
    });

    it("should reject invalid numeric port even with requirePort", () => {
      const parser = socketAddress({ separator: "to", requirePort: true });

      // "dbto70000" has a valid host + all-digit invalid port.
      // But since "dbto70000" is a valid hostname and the separator
      // "to" can appear in hostnames, the split is ambiguous.
      const result = parser.parse("dbto70000");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "to" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "dbto70000" },
        { type: "text", text: "." },
      ]);
    });

    it("should propagate IP-specific error, not missing port, for invalid host with requirePort", () => {
      const parser = socketAddress({
        separator: "to",
        requirePort: true,
        host: { type: "both" },
      });

      // "999.999.999.999to80" has valid port but invalid IP host.
      // Error should be about the IP, not "missing port".
      const result = parser.parse("999.999.999.999to80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid IPv4 address, but got " },
        { type: "value", value: "999.999.999.999" },
        { type: "text", text: "." },
      ]);
    });

    it("should treat trailing separator as omitted port", () => {
      const parser = socketAddress({ defaultPort: 80 });

      // "localhost:" has a trailing ":" — host is "localhost", port omitted.
      const result = parser.parse("localhost:");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "localhost");
      assert.strictEqual(result.value.port, 80);
    });

    it("should prefer host-only over trailing separator when input is a valid hostname", () => {
      const parser = socketAddress({ separator: "to", defaultPort: 80 });

      // "exampleto" is a valid hostname, so host-only wins.
      // The trailing "to" is not treated as a separator.
      const result = parser.parse("exampleto");
      assert.ok(result.success);
      assert.strictEqual(result.value.host, "exampleto");
      assert.strictEqual(result.value.port, 80);
    });

    it("should report missing port for trailing separator with requirePort", () => {
      const parser = socketAddress({ requirePort: true });

      const result = parser.parse("localhost:");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        {
          type: "text",
          text: "Port number is required but was not specified.",
        },
      ]);
    });

    it("should not let trailing separator error override valid hostname", () => {
      // "0177.0.0.1to" with separator "to" and hostname mode:
      // the trailing "to" split gives host "0177.0.0.1" which fails
      // (alt IPv4), but "0177.0.0.1to" itself is a valid hostname
      // (label "1to" is alphanumeric).  The trailing separator error
      // should NOT fire when the whole input is a valid hostname.
      const parser = socketAddress({
        separator: "to",
        host: { type: "hostname" },
        requirePort: true,
      });

      const result = parser.parse("0177.0.0.1to");
      assert.ok(!result.success);
      // Should be invalidFormat (separator found, no valid split),
      // NOT the alt-IPv4 error for "0177.0.0.1".
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "to" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "0177.0.0.1to" },
        { type: "text", text: "." },
      ]);
    });

    it("should propagate IP-specific error for trailing separator with invalid host", () => {
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowPrivate: false } },
      });

      const result = parser.parse("192.168.0.1:");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "192.168.0.1" },
        { type: "text", text: " is a private IP address." },
      ]);
    });

    it("should propagate alt IPv4 error for trailing separator", () => {
      const parser = socketAddress({ defaultPort: 80 });

      const result = parser.parse("0x7f000001:");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "0x7f000001" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });

    it("should not let custom invalidFormat turn valid host-only into failure", () => {
      // "db-to80" with separator "to" is a valid hostname.
      // Adding errors.invalidFormat should not change the parse result.
      const withoutError = socketAddress({
        separator: "to",
        defaultPort: 80,
      });
      const withError = socketAddress({
        separator: "to",
        defaultPort: 80,
        errors: { invalidFormat: message`Custom error` },
      });

      const result1 = withoutError.parse("db-to80");

      const result2 = withError.parse("db-to80");
      assert.deepStrictEqual(result1, result2);
      assert.ok(result1.success);
      assert.deepStrictEqual(result1.value, { host: "db-to80", port: 80 });
    });

    it("should reject IP-shaped split host before host-only fallback", () => {
      // "192.168.0.1-80" with separator "-" and allowPrivate: false:
      // the split finds host "192.168.0.1" (private, disallowed) + port
      // "80" (valid).  The IP error must surface, not be masked by
      // host-only accepting "192.168.0.1-80" as a hostname.
      const parser = socketAddress({
        separator: "-",
        defaultPort: 80,
        host: { type: "both", ip: { allowPrivate: false } },
      });

      const result = parser.parse("192.168.0.1-80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "192.168.0.1" },
        { type: "text", text: " is a private IP address." },
      ]);
    });

    it("should reject malformed IPv4 split host before host-only fallback", () => {
      const parser = socketAddress({ separator: "-", defaultPort: 80 });

      const result = parser.parse("999.999.999.999-80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid IPv4 address, but got " },
        { type: "value", value: "999.999.999.999" },
        { type: "text", text: "." },
      ]);
    });

    it("should use custom invalidFormat over IP-specific split errors", () => {
      const parser = socketAddress({
        separator: "-",
        defaultPort: 80,
        host: { type: "both", ip: { allowPrivate: false } },
        errors: { invalidFormat: message`Custom error` },
      });

      const result = parser.parse("192.168.0.1-80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Custom error" },
      ]);
    });

    it("should propagate IP-specific error even when port suffix is invalid", () => {
      // "192.168.1.1:abc" has an invalid port "abc", but the host
      // "192.168.1.1" is IP-shaped.  The specific IP error should
      // still surface rather than a generic format error.
      const parser = socketAddress({
        defaultPort: 80,
        host: { type: "both", ip: { allowPrivate: false } },
      });

      const result = parser.parse("192.168.1.1:abc");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "192.168.1.1" },
        { type: "text", text: " is a private IP address." },
      ]);
    });

    it("should propagate alt IPv4 error even when port suffix is invalid", () => {
      const parser = socketAddress({ defaultPort: 80 });

      const result = parser.parse("0x7f000001:abc");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "0x7f000001" },
        {
          type: "text",
          text: " appears to be a non-standard IPv4 address notation.",
        },
      ]);
    });
  });

  describe("sub-parser error propagation", () => {
    it("should propagate port min error instead of generic format error", () => {
      const parser = socketAddress({ port: { min: 1024 } });

      const result = parser.parse("localhost:80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        {
          type: "text",
          text: "Expected a port number greater than or equal to ",
        },
        { type: "text", text: "1,024" },
        { type: "text", text: ", but got " },
        { type: "value", value: "80" },
        { type: "text", text: "." },
      ]);
    });

    it("should propagate hostname localhostNotAllowed error", () => {
      const parser = socketAddress({
        host: {
          type: "hostname",
          hostname: { allowLocalhost: false },
        },
      });

      const result = parser.parse("localhost:80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Hostname 'localhost' is not allowed." },
      ]);
    });

    it("should propagate IP allowPrivate error", () => {
      const parser = socketAddress({
        host: {
          type: "ip",
          ip: { allowPrivate: false },
        },
      });

      const result = parser.parse("192.168.1.1:80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "192.168.1.1" },
        { type: "text", text: " is a private IP address." },
      ]);
    });

    it("should propagate localhostNotAllowed for trailing separator", () => {
      const parser = socketAddress({
        host: {
          type: "hostname",
          hostname: { allowLocalhost: false },
        },
        requirePort: true,
      });

      const result = parser.parse("localhost:");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Hostname 'localhost' is not allowed." },
      ]);
    });

    it("should propagate disallowWellKnown port error", () => {
      const parser = socketAddress({
        port: { disallowWellKnown: true },
      });

      const result = parser.parse("localhost:80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Port " },
        { type: "value", value: "80" },
        {
          type: "text",
          text:
            " is a well-known port (1-1023) and may require elevated privileges.",
        },
      ]);
    });

    it("should propagate localhostNotAllowed in both mode", () => {
      const parser = socketAddress({
        host: {
          type: "both",
          hostname: { allowLocalhost: false },
        },
      });

      const result = parser.parse("localhost:80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Hostname 'localhost' is not allowed." },
      ]);
    });

    it("should prefer custom invalidFormat over sub-parser errors", () => {
      const parser = socketAddress({
        host: {
          type: "hostname",
          hostname: { allowLocalhost: false },
        },
        errors: {
          invalidFormat: message`Custom error`,
        },
      });

      const result = parser.parse("localhost:80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Custom error" },
      ]);
    });

    it("should prefer custom invalidFormat over port sub-parser errors", () => {
      const parser = socketAddress({
        port: { min: 1024 },
        errors: {
          invalidFormat: message`Custom error`,
        },
      });

      const result = parser.parse("localhost:80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Custom error" },
      ]);
    });

    it("should not propagate split-host error when whole input is a valid hostname", () => {
      // "db--80" with separator "-" splits as host "db-" (invalid
      // trailing hyphen) + port "80" (valid).  But "db--80" is a valid
      // single-label hostname, so the split was likely wrong.  The
      // generic format error should be returned instead.
      const parser = socketAddress({ separator: "-", requirePort: true });

      const result = parser.parse("db--80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "-" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "db--80" },
        { type: "text", text: "." },
      ]);
    });

    it("should propagate split-host error when whole input is also invalid", () => {
      // "bad..host:80" splits as host "bad..host" (empty label) + port
      // "80" (valid).  The whole input "bad..host:80" is also invalid as
      // a hostname (contains colon).  The specific host error is more
      // informative than the generic format error.
      const parser = socketAddress({ requirePort: true });

      const result = parser.parse("bad..host:80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid hostname, but got " },
        { type: "value", value: "bad..host" },
        { type: "text", text: "." },
      ]);
    });

    it("should use generic format error for bare separator", () => {
      // ":" is just a bare separator with no host or port.
      // Should get the generic format error, not a hostname error
      // for the empty string.
      const parser = socketAddress({ requirePort: true });

      const result = parser.parse(":");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: ":" },
        { type: "text", text: "port, but got " },
        { type: "value", value: ":" },
        { type: "text", text: "." },
      ]);
    });

    it("should use generic format error for bare custom separator", () => {
      const parser = socketAddress({
        separator: "-",
        requirePort: true,
      });

      const result = parser.parse("-");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "-" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "-" },
        { type: "text", text: "." },
      ]);
    });

    it("should not surface IP error for hostname-like input in ip mode with ambiguous separator", () => {
      // "foo-80" with separator "-" and host type "ip" splits as
      // host "foo" (invalid IP) + port 80.  But "foo-80" is a
      // syntactically valid hostname, so the split is ambiguous.
      // Generic format error should be used, not the IP error.
      const parser = socketAddress({
        separator: "-",
        requirePort: true,
        host: { type: "ip" },
      });

      const result = parser.parse("foo-80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "-" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "foo-80" },
        { type: "text", text: "." },
      ]);
    });

    it("should not surface IP error for trailing separator in ip mode with ambiguous separator", () => {
      // "autoto" with separator "to" and host type "ip" has a
      // trailing "to" giving host "auto" (invalid IP).  But
      // "autoto" is a valid hostname, so the split is ambiguous.
      const parser = socketAddress({
        separator: "to",
        requirePort: true,
        host: { type: "ip" },
      });

      const result = parser.parse("autoto");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "to" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "autoto" },
        { type: "text", text: "." },
      ]);
    });

    it("should not let hostname policy options affect disambiguation in ip mode", () => {
      // hostname.maxLength is documented as applying only to
      // hostname/both mode.  It should not affect disambiguation
      // in ip mode.  "foo-80" is syntactically a valid hostname
      // (length 6 > maxLength 1), so the split is ambiguous and
      // the generic format error should be returned.
      const parser = socketAddress({
        separator: "-",
        requirePort: true,
        host: { type: "ip", hostname: { maxLength: 1 } },
      });

      const result = parser.parse("foo-80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "-" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "foo-80" },
        { type: "text", text: "." },
      ]);
    });

    it("should not surface split-host error for wildcard hostnames with ambiguous separator", () => {
      // "*.example--80" is a valid hostname under allowWildcard.
      // The split "*.example-" + "80" is ambiguous, so the generic
      // format error should be returned.
      const parser = socketAddress({
        separator: "-",
        requirePort: true,
        host: { type: "hostname", hostname: { allowWildcard: true } },
      });

      const result = parser.parse("*.example--80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "-" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "*.example--80" },
        { type: "text", text: "." },
      ]);
    });

    it("should not surface split-host error for underscore hostnames with ambiguous separator", () => {
      // "_service--80" is a valid hostname under allowUnderscore.
      const parser = socketAddress({
        separator: "-",
        requirePort: true,
        host: { type: "hostname", hostname: { allowUnderscore: true } },
      });

      const result = parser.parse("_service--80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "-" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "_service--80" },
        { type: "text", text: "." },
      ]);
    });

    it("should respect enlarged maxLength in disambiguation", () => {
      // A multi-label hostname longer than 253 chars is valid when
      // maxLength is raised.  The disambiguation check should
      // respect this so the input is treated as an ambiguous
      // hostname-like token.  (Single labels are limited to 63 chars
      // by RFC 1123 regardless of maxLength.)
      const base = "aa" + ".aa".repeat(84); // 254 chars, 85 labels
      const input = `${base}--80`; // 258 chars
      const parser = socketAddress({
        separator: "-",
        requirePort: true,
        host: { type: "hostname", hostname: { maxLength: 300 } },
      });

      const result = parser.parse(input);
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "-" },
        { type: "text", text: "port, but got " },
        { type: "value", value: input },
        { type: "text", text: "." },
      ]);
    });

    it("should use generic format error for repeated default separator", () => {
      // "::80" splits as host ":" + port 80, but ":" is just a
      // separator artifact.  The generic format error is correct.
      const parser = socketAddress({ requirePort: true });

      const result = parser.parse("::80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: ":" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "::80" },
        { type: "text", text: "." },
      ]);
    });

    it("should use generic format error for repeated custom separator", () => {
      const parser = socketAddress({
        separator: "-",
        requirePort: true,
      });

      const result = parser.parse("--80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "-" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "--80" },
        { type: "text", text: "." },
      ]);
    });

    it("should not surface port error for ambiguous separator when whole input is a hostname", () => {
      // "foo-70000" with separator "-": the port 70000 is out of
      // range, but "foo-70000" is also a valid hostname.  The split
      // is ambiguous — same as "foo-80" — so the generic format
      // error should be returned, not the port error.
      const parser = socketAddress({
        separator: "-",
        requirePort: true,
        host: { type: "ip" },
      });

      const result = parser.parse("foo-70000");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a socket address in format host" },
        { type: "value", value: "-" },
        { type: "text", text: "port, but got " },
        { type: "value", value: "foo-70000" },
        { type: "text", text: "." },
      ]);
    });

    it("should still propagate port error for unambiguous separator", () => {
      // "example.com:70000" with separator ":": colons never appear
      // in hostnames, so the split is unambiguous.  The specific
      // port error should be returned.
      const parser = socketAddress({ requirePort: true });

      const result = parser.parse("example.com:70000");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        {
          type: "text",
          text: "Expected a port number less than or equal to ",
        },
        { type: "text", text: "65,535" },
        { type: "text", text: ", but got " },
        { type: "value", value: "70000" },
        { type: "text", text: "." },
      ]);
    });

    it("should prioritize host error over port error when both fail", () => {
      // "localhost:70000" with allowLocalhost: false.  Both host and
      // port are invalid, but the host error is more fundamental —
      // fixing the port still leaves a rejected host.
      const parser = socketAddress({
        requirePort: true,
        host: {
          type: "hostname",
          hostname: { allowLocalhost: false },
        },
      });

      const result = parser.parse("localhost:70000");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Hostname 'localhost' is not allowed." },
      ]);
    });

    it("should propagate host error for disallowed underscore with ambiguous separator", () => {
      // "_host-80" with allowUnderscore: false.  The user's parser
      // rejects "_host-80" as a hostname, so the split is unambiguous.
      const parser = socketAddress({
        separator: "-",
        requirePort: true,
        host: {
          type: "hostname",
          hostname: { allowUnderscore: false },
        },
      });

      const result = parser.parse("_host-80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        {
          type: "text",
          text: "Hostname ",
        },
        { type: "value", value: "_host" },
        {
          type: "text",
          text: " contains underscore, which is not allowed.",
        },
      ]);
    });

    it("should propagate host error for maxLength violation with ambiguous separator", () => {
      // "foobar-80" with maxLength: 5.  "foobar-80" exceeds 5 chars,
      // so the user's parser rejects it.  The split is unambiguous.
      const parser = socketAddress({
        separator: "-",
        requirePort: true,
        host: {
          type: "hostname",
          hostname: { maxLength: 5 },
        },
      });

      const result = parser.parse("foobar-80");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Hostname " },
        { type: "value", value: "foobar" },
        { type: "text", text: " is too long (maximum " },
        { type: "text", text: "5" },
        { type: "text", text: " characters)." },
      ]);
    });

    it("should propagate host error with dot separator for dotted hosts", () => {
      // When separator is ".", dotted hosts like "192.168.1.1"
      // inherently contain the separator.  The degenerate-host guard
      // should not suppress error propagation for these.
      const parser = socketAddress({
        separator: ".",
        requirePort: true,
        host: { type: "ip", ip: { allowPrivate: false } },
      });

      const result = parser.parse("192.168.1.1.");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "192.168.1.1" },
        { type: "text", text: " is a private IP address." },
      ]);
    });

    it("should prefer custom invalidFormat when both host and port fail", () => {
      const parser = socketAddress({
        host: {
          type: "both",
          ip: { allowPrivate: false },
        },
        errors: {
          invalidFormat: message`Custom error`,
        },
      });

      const result = parser.parse("192.168.1.1:70000");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Custom error" },
      ]);
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

    it("should accept and zero-pad single-digit octets with colons", () => {
      const parser = macAddress();

      const result = parser.parse("0:1:2:3:4:5");
      assert.ok(result.success);
      assert.strictEqual(result.value, "00:01:02:03:04:05");
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

    it("should zero-pad single-digit octets with colon outputSeparator", () => {
      const parser = macAddress({ outputSeparator: ":" });

      const result = parser.parse("0:1:2:3:4:5");
      assert.ok(result.success);
      assert.strictEqual(result.value, "00:01:02:03:04:05");
    });

    it("should zero-pad single-digit octets with hyphen outputSeparator", () => {
      const parser = macAddress({ outputSeparator: "-" });

      const result = parser.parse("0:1:2:3:4:5");
      assert.ok(result.success);
      assert.strictEqual(result.value, "00-01-02-03-04-05");
    });

    it("should zero-pad single-digit octets with dot outputSeparator", () => {
      const parser = macAddress({ outputSeparator: "." });

      const result = parser.parse("0:1:2:3:4:5");
      assert.ok(result.success);
      assert.strictEqual(result.value, "0001.0203.0405");
    });

    it("should zero-pad single-digit octets with none outputSeparator", () => {
      const parser = macAddress({ outputSeparator: "none" });

      const result = parser.parse("0:1:2:3:4:5");
      assert.ok(result.success);
      assert.strictEqual(result.value, "000102030405");
    });

    it("should round-trip single-digit octets through dot format", () => {
      const dotParser = macAddress({ outputSeparator: ".", case: "upper" });
      const first = dotParser.parse("0:1:2:3:4:5");
      assert.ok(first.success);
      assert.strictEqual(first.value, "0001.0203.0405");

      const second = dotParser.parse(first.value);
      assert.ok(second.success);
      assert.strictEqual(second.value, first.value);
    });

    it("should zero-pad and apply case conversion together", () => {
      const parser = macAddress({ outputSeparator: ":", case: "upper" });

      const result = parser.parse("a:1b:2:3c:4d:5");
      assert.ok(result.success);
      assert.strictEqual(result.value, "0A:1B:02:3C:4D:05");
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

    it("should accept and zero-pad single-digit octets with hyphens", () => {
      const parser = macAddress();

      const result = parser.parse("0-1-2-3-4-5");
      assert.ok(result.success);
      assert.strictEqual(result.value, "00-01-02-03-04-05");
    });

    it("should accept and zero-pad mixed single and double digit octets with colons", () => {
      const parser = macAddress();

      const result = parser.parse("0A:1:2B:3:4D:5");
      assert.ok(result.success);
      assert.strictEqual(result.value, "0A:01:2B:03:4D:05");
    });

    it("should accept and zero-pad mixed single and double digit octets with hyphens", () => {
      const parser = macAddress();

      const result = parser.parse("0A-1-2B-3-4D-5");
      assert.ok(result.success);
      assert.strictEqual(result.value, "0A-01-2B-03-4D-05");
    });

    it("should keep dot-separated input strict (4 hex chars per group)", () => {
      const parser = macAddress({ separator: "." });

      assert.ok(!parser.parse("01.23.45").success);
      assert.ok(!parser.parse("1.0203.0405").success);
    });

    it("should keep no-separator input strict (12 hex chars)", () => {
      const parser = macAddress({ separator: "none" });

      assert.ok(!parser.parse("012345").success);
      assert.ok(!parser.parse("00010203045").success);
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

    it("should zero-pad single-digit octets in all positions", () => {
      const parser = macAddress();

      const result = parser.parse("0:1:2:3:4:5");
      assert.ok(result.success);
      assert.strictEqual(result.value, "00:01:02:03:04:05");
    });

    it("should zero-pad single-digit octets with outputSeparator", () => {
      const parser = macAddress({ outputSeparator: ":" });

      const result = parser.parse("0:1:2:3:4:5");
      assert.ok(result.success);
      assert.strictEqual(result.value, "00:01:02:03:04:05");
    });

    it("should handle mixed case input with case conversion", () => {
      const parser = macAddress({ case: "upper" });

      const result = parser.parse("aA:bB:cC:dD:eE:fF");
      assert.ok(result.success);
      assert.strictEqual(result.value, "AA:BB:CC:DD:EE:FF");
    });
  });

  describe("option validation", () => {
    it("should throw TypeError for invalid separator value", () => {
      assert.throws(
        () => macAddress({ separator: "foo" as never }),
        {
          name: "TypeError",
          message:
            'Expected separator to be one of ":", "-", ".", "none", "any", but got string: "foo".',
        },
      );
    });

    it("should throw TypeError for invalid outputSeparator value", () => {
      assert.throws(
        () => macAddress({ outputSeparator: "any" as never }),
        {
          name: "TypeError",
          message:
            'Expected outputSeparator to be one of ":", "-", ".", "none", but got string: "any".',
        },
      );
    });

    it("should throw TypeError for invalid case value", () => {
      assert.throws(
        () => macAddress({ case: "weird" as never }),
        {
          name: "TypeError",
          message:
            'Expected case to be one of "preserve", "upper", "lower", but got string: "weird".',
        },
      );
    });

    it("should accept all valid separator values", () => {
      for (const sep of [":", "-", ".", "none", "any"] as const) {
        macAddress({ separator: sep });
      }
    });

    it("should accept all valid outputSeparator values", () => {
      for (const sep of [":", "-", ".", "none"] as const) {
        macAddress({ outputSeparator: sep });
      }
    });

    it("should accept all valid case values", () => {
      for (const c of ["preserve", "upper", "lower"] as const) {
        macAddress({ case: c });
      }
    });

    it("should accept undefined options", () => {
      macAddress();
      macAddress({});
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

    it("should throw TypeError when allowSubdomains is false and minLabels > 2", () => {
      assert.throws(
        () => domain({ allowSubdomains: false, minLabels: 3 }),
        {
          name: "TypeError",
          message:
            "allowSubdomains: false is incompatible with minLabels > 2, " +
            "as non-subdomain domains have exactly 2 labels.",
        },
      );
    });

    it("should not throw when allowSubdomains is false and minLabels is 2", () => {
      assert.doesNotThrow(
        () => domain({ allowSubdomains: false, minLabels: 2 }),
      );
    });

    it("should not throw when allowSubdomains is false and minLabels is 1", () => {
      assert.doesNotThrow(
        () => domain({ allowSubdomains: false, minLabels: 1 }),
      );
    });

    it("should not throw when allowSubdomains is true and minLabels > 2", () => {
      assert.doesNotThrow(
        () => domain({ allowSubdomains: true, minLabels: 3 }),
      );
    });

    it("should throw RangeError when minLabels is 0", () => {
      assert.throws(
        () => domain({ minLabels: 0 }),
        {
          name: "RangeError",
          message: "minLabels must be an integer greater than or equal to 1.",
        },
      );
    });

    it("should throw RangeError when minLabels is negative", () => {
      assert.throws(
        () => domain({ minLabels: -1 }),
        {
          name: "RangeError",
          message: "minLabels must be an integer greater than or equal to 1.",
        },
      );
    });

    it("should throw RangeError when minLabels is NaN", () => {
      assert.throws(
        () => domain({ minLabels: NaN }),
        {
          name: "RangeError",
          message: "minLabels must be an integer greater than or equal to 1.",
        },
      );
    });

    it("should throw RangeError when minLabels is fractional", () => {
      assert.throws(
        () => domain({ minLabels: 1.5 }),
        {
          name: "RangeError",
          message: "minLabels must be an integer greater than or equal to 1.",
        },
      );
    });

    it("should not throw when minLabels is 1", () => {
      assert.doesNotThrow(
        () => domain({ minLabels: 1 }),
      );
    });
  });

  describe("allowedTlds option", () => {
    it("should accept domain with allowed TLD", () => {
      const parser = domain({ allowedTlds: ["com", "org", "net"] });
      const result = parser.parse("example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "example.com");
    });

    it("should accept domain with allowed TLD (case-insensitive)", () => {
      const parser = domain({ allowedTlds: ["com", "org", "net"] });
      const result = parser.parse("example.COM");
      assert.ok(result.success);
      assert.strictEqual(result.value, "example.COM");
    });

    it("should reject domain with disallowed TLD", () => {
      const parser = domain({ allowedTlds: ["com", "org", "net"] });
      const result = parser.parse("example.io");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Top-level domain " },
        { type: "value", value: "io" },
        { type: "text", text: " is not allowed. Allowed TLDs: " },
        { type: "value", value: "com" },
        { type: "text", text: ", " },
        { type: "value", value: "org" },
        { type: "text", text: ", and " },
        { type: "value", value: "net" },
        { type: "text", text: "." },
      ]);
    });

    it("should accept subdomain with allowed TLD", () => {
      const parser = domain({ allowedTlds: ["com", "org"] });
      const result = parser.parse("www.example.org");
      assert.ok(result.success);
      assert.strictEqual(result.value, "www.example.org");
    });

    it("should throw TypeError when allowedTlds is empty", () => {
      assert.throws(
        () => domain({ allowedTlds: [] }),
        {
          name: "TypeError",
          message: "allowedTlds must not be empty.",
        },
      );
    });

    it("should throw TypeError for non-string entry", () => {
      assert.throws(
        () => domain({ allowedTlds: [123 as never] }),
        {
          name: "TypeError",
          message: "allowedTlds[0] must be a string, but got number.",
        },
      );
    });

    it("should throw TypeError for array entry", () => {
      assert.throws(
        () => domain({ allowedTlds: [["com"] as never] }),
        {
          name: "TypeError",
          message: "allowedTlds[0] must be a string, but got array.",
        },
      );
    });

    it("should throw TypeError for entry containing a dot", () => {
      assert.throws(
        () => domain({ allowedTlds: [".com"] as never }),
        {
          name: "TypeError",
          message: 'allowedTlds[0] must not contain dots: ".com".',
        },
      );
    });

    it("should throw TypeError for entry with leading whitespace", () => {
      assert.throws(
        () => domain({ allowedTlds: [" com"] as never }),
        {
          name: "TypeError",
          message: "allowedTlds[0] must not have leading or trailing " +
            'whitespace: " com".',
        },
      );
    });

    it("should throw TypeError for entry with trailing whitespace", () => {
      assert.throws(
        () => domain({ allowedTlds: ["com "] as never }),
        {
          name: "TypeError",
          message: "allowedTlds[0] must not have leading or trailing " +
            'whitespace: "com ".',
        },
      );
    });

    it("should throw TypeError for entry with leading and trailing whitespace", () => {
      assert.throws(
        () => domain({ allowedTlds: [" com "] as never }),
        {
          name: "TypeError",
          message: "allowedTlds[0] must not have leading or trailing " +
            'whitespace: " com ".',
        },
      );
    });

    it("should throw TypeError for empty string entry", () => {
      assert.throws(
        () => domain({ allowedTlds: [""] as never }),
        {
          name: "TypeError",
          message: "allowedTlds[0] must not be an empty string.",
        },
      );
    });

    it("should include index in error message", () => {
      assert.throws(
        () => domain({ allowedTlds: ["com", "org", 42 as never] }),
        {
          name: "TypeError",
          message: "allowedTlds[2] must be a string, but got number.",
        },
      );
    });

    it("should throw TypeError for entry starting with hyphen", () => {
      assert.throws(
        () => domain({ allowedTlds: ["-com"] as never }),
        {
          name: "TypeError",
          message: 'allowedTlds[0] is not a valid DNS label: "-com".',
        },
      );
    });

    it("should throw TypeError for entry ending with hyphen", () => {
      assert.throws(
        () => domain({ allowedTlds: ["com-"] as never }),
        {
          name: "TypeError",
          message: 'allowedTlds[0] is not a valid DNS label: "com-".',
        },
      );
    });

    it("should throw TypeError for entry with underscore", () => {
      assert.throws(
        () => domain({ allowedTlds: ["co_m"] as never }),
        {
          name: "TypeError",
          message: 'allowedTlds[0] is not a valid DNS label: "co_m".',
        },
      );
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
        allowedTlds: ["com", "org"],
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

    it("should reject all-numeric domains like IPv4 addresses", () => {
      const parser = domain();
      for (
        const input of [
          "192.168.0.1",
          "127.0.0.1",
          "999.999.999.999",
          "1.2",
          "12.34.56",
        ]
      ) {
        const result = parser.parse(input);
        assert.ok(!result.success, `Expected ${input} to be rejected`);
        assert.deepStrictEqual(result.error, [
          { type: "text", text: "Expected a valid domain name, but got " },
          { type: "value", value: input },
          { type: "text", text: "." },
        ]);
      }
    });

    it("should accept domains with some numeric labels", () => {
      const parser = domain();
      for (
        const input of [
          "123.456.com",
          "example.123",
          "1.example.com",
        ]
      ) {
        const result = parser.parse(input);
        assert.ok(result.success, `Expected ${input} to be accepted`);
      }
    });

    it("should accept single-label numeric names with minLabels: 1", () => {
      const parser = domain({ minLabels: 1 });
      const result = parser.parse("123");
      assert.ok(result.success);
      assert.strictEqual(result.value, "123");

      const multiLabel = parser.parse("1.2");
      assert.ok(
        !multiLabel.success,
        "Expected all-numeric multi-label domains to be rejected even when minLabels is 1",
      );
    });

    it("should work with allowSubdomains and allowedTlds together", () => {
      const parser = domain({
        allowSubdomains: false,
        allowedTlds: ["com", "org"],
      });
      const result = parser.parse("example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "example.com");
    });

    it("should reject subdomain with restricted TLDs", () => {
      const parser = domain({
        allowSubdomains: false,
        allowedTlds: ["com", "org"],
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
        allowedTlds: ["com", "org", "net"],
        minLabels: 2,
        lowercase: true,
      });
      const result = parser.parse("API.Example.COM");
      assert.ok(result.success);
      assert.strictEqual(result.value, "api.example.com");
    });

    it("should snapshot allowedTlds at construction time", () => {
      const tlds = ["com"];
      const parser = domain({ allowedTlds: tlds });
      assert.ok(parser.parse("example.com").success);
      assert.ok(!parser.parse("example.org").success);
      // Mutate tlds after construction
      tlds[0] = "org";
      // Parser should still accept .com and reject .org
      assert.ok(parser.parse("example.com").success);
      assert.ok(!parser.parse("example.org").success);
    });

    it("should snapshot errors.invalidDomain at construction time", () => {
      const errors: { invalidDomain: string } = {
        invalidDomain: "original error",
      };
      const parser = domain({ errors: errors as never });
      const result = parser.parse("");
      assert.ok(!result.success);
      if (!result.success) assert.equal(result.error, "original error");
      errors.invalidDomain = "mutated error";
      const result2 = parser.parse("");
      assert.ok(!result2.success);
      if (!result2.success) assert.equal(result2.error, "original error");
    });

    it("should snapshot errors.tldNotAllowed at construction time", () => {
      const errors: { tldNotAllowed: string } = {
        tldNotAllowed: "original error",
      };
      const parser = domain({
        allowedTlds: ["com"],
        errors: errors as never,
      });
      const result = parser.parse("example.org");
      assert.ok(!result.success);
      if (!result.success) assert.equal(result.error, "original error");
      errors.tldNotAllowed = "mutated error";
      const result2 = parser.parse("example.org");
      assert.ok(!result2.success);
      if (!result2.success) assert.equal(result2.error, "original error");
    });

    it("should snapshot errors.tooFewLabels at construction time", () => {
      const errors: { tooFewLabels: string } = {
        tooFewLabels: "original error",
      };
      const parser = domain({
        minLabels: 3,
        errors: errors as never,
      });
      const result = parser.parse("example.com");
      assert.ok(!result.success);
      if (!result.success) assert.equal(result.error, "original error");
      errors.tooFewLabels = "mutated error";
      const result2 = parser.parse("example.com");
      assert.ok(!result2.success);
      if (!result2.success) assert.equal(result2.error, "original error");
    });
  });

  describe("maxLength option", () => {
    it("should reject domain exceeding default 253-character limit", () => {
      const parser = domain();
      const label = "a".repeat(63);
      const longDomain = `${label}.${label}.${label}.${label}.com`;
      assert.ok(longDomain.length > 253);
      const result = parser.parse(longDomain);
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Domain " },
        { type: "value", value: longDomain },
        { type: "text", text: " is too long (maximum " },
        { type: "text", text: "253" },
        { type: "text", text: " characters)." },
      ]);
    });

    it("should accept domain at exactly 253 characters", () => {
      const parser = domain();
      // 63 + 1 + 63 + 1 + 63 + 1 + 58 + 1 + 2 = 253
      const domain253 = `${"a".repeat(63)}.${"b".repeat(63)}.${
        "c".repeat(63)
      }.${"d".repeat(58)}.co`;
      assert.strictEqual(domain253.length, 253);
      const result = parser.parse(domain253);
      assert.ok(result.success);
      assert.strictEqual(result.value, domain253);
    });

    it("should reject domain exceeding custom maxLength", () => {
      const parser = domain({ maxLength: 50 });
      const longDomain =
        "abcdefghijklmnopqrstuvwxyz.abcdefghijklmnopqrstuvwx.com";
      assert.ok(longDomain.length > 50);
      const result = parser.parse(longDomain);
      assert.ok(!result.success);
    });

    it("should accept domain within custom maxLength", () => {
      const parser = domain({ maxLength: 50 });
      const result = parser.parse("example.com");
      assert.ok(result.success);
      assert.strictEqual(result.value, "example.com");
    });

    it("should use custom tooLong error function", () => {
      const parser = domain({
        maxLength: 20,
        errors: {
          tooLong: (domain, maxLen) =>
            message`${text(domain)} exceeds ${text(maxLen.toString())}`,
        },
      });
      const result = parser.parse("this-is-a-long-name.example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "this-is-a-long-name.example.com" },
        { type: "text", text: " exceeds " },
        { type: "text", text: "20" },
      ]);
    });

    it("should use static tooLong error message", () => {
      const parser = domain({
        maxLength: 20,
        errors: {
          tooLong: message`Domain is too long.`,
        },
      });
      const result = parser.parse("this-is-a-long-name.example.com");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Domain is too long." },
      ]);
    });

    it("should throw RangeError when maxLength is 0", () => {
      assert.throws(
        () => domain({ maxLength: 0 }),
        {
          name: "RangeError",
          message: "maxLength must be an integer greater than or equal to 1.",
        },
      );
    });

    it("should throw RangeError when maxLength is negative", () => {
      assert.throws(
        () => domain({ maxLength: -1 }),
        {
          name: "RangeError",
          message: "maxLength must be an integer greater than or equal to 1.",
        },
      );
    });

    it("should throw RangeError when maxLength is NaN", () => {
      assert.throws(
        () => domain({ maxLength: NaN }),
        {
          name: "RangeError",
          message: "maxLength must be an integer greater than or equal to 1.",
        },
      );
    });

    it("should throw RangeError when maxLength is fractional", () => {
      assert.throws(
        () => domain({ maxLength: 1.5 }),
        {
          name: "RangeError",
          message: "maxLength must be an integer greater than or equal to 1.",
        },
      );
    });

    it("should snapshot errors.tooLong at construction time", () => {
      const errors: { tooLong: string } = {
        tooLong: "original error",
      };
      const parser = domain({
        maxLength: 10,
        errors: errors as never,
      });
      const result = parser.parse("this-is-long.example.com");
      assert.ok(!result.success);
      if (!result.success) assert.equal(result.error, "original error");
      errors.tooLong = "mutated error";
      const result2 = parser.parse("this-is-long.example.com");
      assert.ok(!result2.success);
      if (!result2.success) assert.equal(result2.error, "original error");
    });
  });

  describe("runtime option type validation", () => {
    it("should throw TypeError for non-boolean allowSubdomains", () => {
      assert.throws(
        () => domain({ allowSubdomains: "no" as never }),
        {
          name: "TypeError",
          message:
            "Expected allowSubdomains to be a boolean, but got string: no.",
        },
      );
    });

    it("should throw TypeError for non-boolean lowercase", () => {
      assert.throws(
        () => domain({ lowercase: "yes" as never }),
        {
          name: "TypeError",
          message: "Expected lowercase to be a boolean, but got string: yes.",
        },
      );
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

    it("should reject IPv4-mapped addresses with leading zeros", () => {
      const parser = ipv6();

      const withLeadingZeros = [
        "::ffff:01.02.03.04",
        "::ffff:192.168.001.1",
        "::ffff:010.0.0.1",
        "::ffff:192.168.1.01",
        "::ffff:01.01.01.01",
      ];

      for (const addr of withLeadingZeros) {
        const result = parser.parse(addr);
        assert.ok(
          !result.success,
          `Should reject IPv4-mapped IPv6 with leading zeros: ${addr}`,
        );
      }
    });
  });
});

describe("ip()", () => {
  describe("basic validation (both versions)", () => {
    it("should accept IPv4 address", () => {
      const parser = ip();
      const result = parser.parse("192.0.2.1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "192.0.2.1");
    });

    it("should accept IPv6 address", () => {
      const parser = ip();
      const result = parser.parse("2001:db8::1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "2001:db8::1");
    });

    it("should reject invalid input", () => {
      const parser = ip();
      const result = parser.parse("not-an-ip");
      assert.ok(!result.success);
    });
  });

  describe("version option", () => {
    it("should accept only IPv4 when version is 4", () => {
      const parser = ip({ version: 4 });
      const result4 = parser.parse("192.0.2.1");
      assert.ok(result4.success);
      assert.strictEqual(result4.value, "192.0.2.1");

      const result6 = parser.parse("2001:db8::1");
      assert.ok(!result6.success);
    });

    it("should accept only IPv6 when version is 6", () => {
      const parser = ip({ version: 6 });
      const result6 = parser.parse("2001:db8::1");
      assert.ok(result6.success);
      assert.strictEqual(result6.value, "2001:db8::1");

      const result4 = parser.parse("192.0.2.1");
      assert.ok(!result4.success);
    });

    it("should accept both when version is 'both'", () => {
      const parser = ip({ version: "both" });
      const result4 = parser.parse("192.0.2.1");
      assert.ok(result4.success);
      assert.strictEqual(result4.value, "192.0.2.1");

      const result6 = parser.parse("2001:db8::1");
      assert.ok(result6.success);
      assert.strictEqual(result6.value, "2001:db8::1");
    });
  });

  describe("ipv4 options passthrough", () => {
    it("should pass through allowPrivate option", () => {
      const parser = ip({ ipv4: { allowPrivate: false } });
      const result = parser.parse("192.168.1.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "192.168.1.1" },
        { type: "text", text: " is a private IP address." },
      ]);
    });

    it("should pass through allowLoopback option", () => {
      const parser = ip({ ipv4: { allowLoopback: false } });
      const result = parser.parse("127.0.0.1");
      assert.ok(!result.success);
    });
  });

  describe("ipv6 options passthrough", () => {
    it("should pass through allowLoopback option", () => {
      const parser = ip({ ipv6: { allowLoopback: false } });
      const result = parser.parse("::1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::1" },
        { type: "text", text: " is a loopback address." },
      ]);
    });

    it("should pass through allowLinkLocal option", () => {
      const parser = ip({ ipv6: { allowLinkLocal: false } });
      const result = parser.parse("fe80::1");
      assert.ok(!result.success);
    });
  });

  describe("shared error options", () => {
    it("should use shared loopbackNotAllowed for IPv4", () => {
      const parser = ip({
        errors: {
          loopbackNotAllowed: [
            { type: "text", text: "No loopback allowed!" },
          ],
        },
        ipv4: { allowLoopback: false },
      });
      const result = parser.parse("127.0.0.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "No loopback allowed!" },
      ]);
    });

    it("should use shared loopbackNotAllowed for IPv6", () => {
      const parser = ip({
        errors: {
          loopbackNotAllowed: [
            { type: "text", text: "No loopback allowed!" },
          ],
        },
        ipv6: { allowLoopback: false },
      });
      const result = parser.parse("::1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "No loopback allowed!" },
      ]);
    });
  });

  describe("custom error messages", () => {
    it("should use custom invalidIP message", () => {
      const parser = ip({
        errors: {
          invalidIP: [
            { type: "text", text: "Not a valid IP!" },
          ],
        },
      });
      const result = parser.parse("invalid");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Not a valid IP!" },
      ]);
    });

    it("should use custom invalidIP function", () => {
      const parser = ip({
        errors: {
          invalidIP: (input) => [
            { type: "text", text: "Bad: " },
            { type: "value", value: input },
          ],
        },
      });
      const result = parser.parse("bad");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Bad: " },
        { type: "value", value: "bad" },
      ]);
    });
  });

  describe("metavar", () => {
    it("should return default metavar", () => {
      const parser = ip();
      assert.strictEqual(parser.metavar, "IP");
    });

    it("should return custom metavar", () => {
      const parser = ip({ metavar: "IP_ADDR" });
      assert.strictEqual(parser.metavar, "IP_ADDR");
    });
  });

  describe("edge cases", () => {
    it("should try IPv4 first when both versions allowed", () => {
      const parser = ip();
      // IPv4-mapped IPv6 should be parsed as IPv6
      const result = parser.parse("::ffff:192.0.2.1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "::ffff:c000:201");
    });

    it("should normalize IPv4 addresses", () => {
      const parser = ip();
      const result = parser.parse("192.0.2.1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "192.0.2.1");
    });

    it("should normalize IPv6 addresses", () => {
      const parser = ip();
      const result = parser.parse("2001:0db8:0000:0000:0000:0000:0000:0001");
      assert.ok(result.success);
      assert.strictEqual(result.value, "2001:db8::1");
    });

    it("should reject IPv4-mapped addresses with leading zeros", () => {
      const parser = ip();

      const withLeadingZeros = [
        "::ffff:01.02.03.04",
        "::ffff:192.168.001.1",
      ];

      for (const addr of withLeadingZeros) {
        const result = parser.parse(addr);
        assert.ok(
          !result.success,
          `Should reject IPv4-mapped IPv6 with leading zeros in ip(): ${addr}`,
        );
      }
    });
  });

  describe("IPv4-mapped IPv6 restrictions", () => {
    it("should reject IPv4-mapped private address when allowPrivate is false", () => {
      const parser = ip({ ipv4: { allowPrivate: false } });
      const result = parser.parse("::ffff:192.168.0.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::ffff:c0a8:1" },
        { type: "text", text: " is a private IP address." },
      ]);
    });

    it("should reject IPv4-mapped loopback address when allowLoopback is false", () => {
      const parser = ip({ ipv4: { allowLoopback: false } });
      const result = parser.parse("::ffff:127.0.0.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::ffff:7f00:1" },
        { type: "text", text: " is a loopback address." },
      ]);
    });

    it("should reject IPv4-mapped link-local address when allowLinkLocal is false", () => {
      const parser = ip({ ipv4: { allowLinkLocal: false } });
      const result = parser.parse("::ffff:169.254.1.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::ffff:a9fe:101" },
        { type: "text", text: " is a link-local address." },
      ]);
    });

    it("should reject IPv4-mapped multicast address when allowMulticast is false", () => {
      const parser = ip({ ipv4: { allowMulticast: false } });
      const result = parser.parse("::ffff:224.0.0.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::ffff:e000:1" },
        { type: "text", text: " is a multicast address." },
      ]);
    });

    it("should reject IPv4-mapped broadcast address when allowBroadcast is false", () => {
      const parser = ip({ ipv4: { allowBroadcast: false } });
      const result = parser.parse("::ffff:255.255.255.255");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::ffff:ffff:ffff" },
        { type: "text", text: " is the broadcast address." },
      ]);
    });

    it("should reject IPv4-mapped zero address when allowZero is false", () => {
      const parser = ip({ ipv4: { allowZero: false } });
      const result = parser.parse("::ffff:0.0.0.0");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::ffff:0:0" },
        { type: "text", text: " is the zero address." },
      ]);
    });

    it("should accept IPv4-mapped public address when allowPrivate is false", () => {
      const parser = ip({ ipv4: { allowPrivate: false } });
      const result = parser.parse("::ffff:203.0.113.1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "::ffff:cb00:7101");
    });

    it("should accept non-mapped IPv6 with IPv4 restrictions", () => {
      const parser = ip({ ipv4: { allowPrivate: false } });
      const result = parser.parse("2001:db8::1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "2001:db8::1");
    });

    it("should use custom error callback for IPv4-mapped restriction", () => {
      const parser = ip({
        ipv4: { allowPrivate: false },
        errors: {
          privateNotAllowed: (addr) =>
            message`Private address ${addr} not allowed.`,
        },
      });
      const result = parser.parse("::ffff:10.0.0.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Private address " },
        { type: "value", value: "::ffff:a00:1" },
        { type: "text", text: " not allowed." },
      ]);
    });

    it("should not apply IPv4-mapped checks when version is 6", () => {
      const parser = ip({ version: 6, ipv4: { allowPrivate: false } });
      // ::ffff:192.168.0.1 is a valid IPv6 address; no IPv4 restrictions
      const result = parser.parse("::ffff:192.168.0.1");
      assert.ok(result.success);
      assert.strictEqual(result.value, "::ffff:c0a8:1");
    });

    it("should snapshot IPv4 restrictions at construction time", () => {
      const ipv4Opts = { allowPrivate: false };
      const parser = ip({ ipv4: ipv4Opts });
      // Mutate nested field after construction — should have no effect
      ipv4Opts.allowPrivate = true;
      const result = parser.parse("::ffff:192.168.0.1");
      assert.ok(!result.success);
    });

    it("should snapshot error callbacks at construction time", () => {
      const errors = {
        privateNotAllowed: () => message`original mapped error`,
      };
      const parser = ip({
        ipv4: { allowPrivate: false },
        errors,
      });
      errors.privateNotAllowed = () => message`mutated mapped error`;
      const result = parser.parse("::ffff:10.0.0.1");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "original mapped error" },
      ]);
    });
  });
});

describe("cidr()", () => {
  describe("basic validation", () => {
    it("should accept IPv4 CIDR", () => {
      const parser = cidr();
      const result = parser.parse("192.0.2.0/24");
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, {
        address: "192.0.2.0",
        prefix: 24,
        version: 4,
      });
    });

    it("should accept IPv6 CIDR", () => {
      const parser = cidr();
      const result = parser.parse("2001:db8::/32");
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, {
        address: "2001:db8::",
        prefix: 32,
        version: 6,
      });
    });

    it("should reject invalid format (no slash)", () => {
      const parser = cidr();
      const result = parser.parse("192.0.2.0");
      assert.ok(!result.success);
    });

    it("should reject invalid format (empty prefix)", () => {
      const parser = cidr();
      const result = parser.parse("192.0.2.0/");
      assert.ok(!result.success);
    });
  });

  describe("version option", () => {
    it("should accept only IPv4 CIDR when version is 4", () => {
      const parser = cidr({ version: 4 });
      const result4 = parser.parse("192.0.2.0/24");
      assert.ok(result4.success);
      assert.strictEqual(result4.value.version, 4);

      const result6 = parser.parse("2001:db8::/32");
      assert.ok(!result6.success);
    });

    it("should accept only IPv6 CIDR when version is 6", () => {
      const parser = cidr({ version: 6 });
      const result6 = parser.parse("2001:db8::/32");
      assert.ok(result6.success);
      assert.strictEqual(result6.value.version, 6);

      const result4 = parser.parse("192.0.2.0/24");
      assert.ok(!result4.success);
    });
  });

  describe("prefix validation", () => {
    it("should accept valid IPv4 prefix (0-32)", () => {
      const parser = cidr();
      const result0 = parser.parse("192.0.2.0/0");
      assert.ok(result0.success);
      assert.strictEqual(result0.value.prefix, 0);

      const result32 = parser.parse("192.0.2.0/32");
      assert.ok(result32.success);
      assert.strictEqual(result32.value.prefix, 32);
    });

    it("should reject invalid IPv4 prefix (>32)", () => {
      const parser = cidr();
      const result = parser.parse("192.0.2.0/33");
      assert.ok(!result.success);
    });

    it("should accept valid IPv6 prefix (0-128)", () => {
      const parser = cidr();
      const result0 = parser.parse("2001:db8::/0");
      assert.ok(result0.success);
      assert.strictEqual(result0.value.prefix, 0);

      const result128 = parser.parse("2001:db8::/128");
      assert.ok(result128.success);
      assert.strictEqual(result128.value.prefix, 128);
    });

    it("should reject invalid IPv6 prefix (>128)", () => {
      const parser = cidr();
      const result = parser.parse("2001:db8::/129");
      assert.ok(!result.success);
    });

    it("should reject non-integer prefix", () => {
      const parser = cidr();
      const result = parser.parse("192.0.2.0/24.5");
      assert.ok(!result.success);
    });

    it("should reject negative prefix", () => {
      const parser = cidr();
      const result = parser.parse("192.0.2.0/-1");
      assert.ok(!result.success);
    });
  });

  describe("minPrefix option", () => {
    it("should reject prefix below minimum", () => {
      const parser = cidr({ minPrefix: 16 });
      const result = parser.parse("192.0.2.0/8");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        {
          type: "text",
          text: "Expected a prefix length greater than or equal to ",
        },
        { type: "text", text: "16" },
        { type: "text", text: ", but got " },
        { type: "text", text: "8" },
        { type: "text", text: "." },
      ]);
    });

    it("should accept prefix at minimum", () => {
      const parser = cidr({ minPrefix: 16 });
      const result = parser.parse("192.0.2.0/16");
      assert.ok(result.success);
    });
  });

  describe("maxPrefix option", () => {
    it("should reject prefix above maximum", () => {
      const parser = cidr({ maxPrefix: 24 });
      const result = parser.parse("192.0.2.0/32");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        {
          type: "text",
          text: "Expected a prefix length less than or equal to ",
        },
        { type: "text", text: "24" },
        { type: "text", text: ", but got " },
        { type: "text", text: "32" },
        { type: "text", text: "." },
      ]);
    });

    it("should accept prefix at maximum", () => {
      const parser = cidr({ maxPrefix: 24 });
      const result = parser.parse("192.0.2.0/24");
      assert.ok(result.success);
    });
  });

  describe("IP address normalization", () => {
    it("should normalize IPv4 address", () => {
      const parser = cidr();
      const result = parser.parse("192.0.2.0/24");
      assert.ok(result.success);
      assert.strictEqual(result.value.address, "192.0.2.0");
    });

    it("should normalize IPv6 address", () => {
      const parser = cidr();
      const result = parser.parse("2001:0db8:0000:0000:0000:0000:0000:0000/32");
      assert.ok(result.success);
      assert.strictEqual(result.value.address, "2001:db8::");
    });
  });

  describe("custom error messages", () => {
    it("should use custom invalidCidr message", () => {
      const parser = cidr({
        errors: {
          invalidCidr: [
            { type: "text", text: "Not a valid CIDR!" },
          ],
        },
      });
      const result = parser.parse("invalid");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Not a valid CIDR!" },
      ]);
    });

    it("should use custom invalidPrefix message", () => {
      const parser = cidr({
        errors: {
          invalidPrefix: (prefix, version) => [
            { type: "text", text: `Bad prefix ${prefix} for IPv${version}` },
          ],
        },
      });
      const result = parser.parse("192.0.2.0/33");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Bad prefix 33 for IPv4" },
      ]);
    });

    it("should use custom prefixBelowMinimum message", () => {
      const parser = cidr({
        minPrefix: 16,
        errors: {
          prefixBelowMinimum: [
            { type: "text", text: "Too small!" },
          ],
        },
      });
      const result = parser.parse("192.0.2.0/8");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Too small!" },
      ]);
    });

    it("should use custom prefixAboveMaximum message", () => {
      const parser = cidr({
        maxPrefix: 24,
        errors: {
          prefixAboveMaximum: [
            { type: "text", text: "Too large!" },
          ],
        },
      });
      const result = parser.parse("192.0.2.0/32");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Too large!" },
      ]);
    });
  });

  describe("metavar", () => {
    it("should return default metavar", () => {
      const parser = cidr();
      assert.strictEqual(parser.metavar, "CIDR");
    });

    it("should return custom metavar", () => {
      const parser = cidr({ metavar: "IP_CIDR" });
      assert.strictEqual(parser.metavar, "IP_CIDR");
    });
  });

  describe("contradictory minPrefix > maxPrefix", () => {
    it("should throw RangeError when minPrefix > maxPrefix", () => {
      assert.throws(
        () => cidr({ minPrefix: 30, maxPrefix: 20 }),
        RangeError,
      );
    });

    it("should not throw when minPrefix equals maxPrefix", () => {
      assert.doesNotThrow(() => cidr({ minPrefix: 24, maxPrefix: 24 }));
    });

    it("should throw RangeError when minPrefix exceeds IPv4 max", () => {
      assert.throws(
        () => cidr({ version: 4, minPrefix: 64 }),
        RangeError,
      );
    });

    it("should throw RangeError when maxPrefix is negative", () => {
      assert.throws(
        () => cidr({ maxPrefix: -1 }),
        RangeError,
      );
    });

    it("should not throw when minPrefix is at IPv4 max", () => {
      assert.doesNotThrow(() => cidr({ version: 4, minPrefix: 32 }));
    });

    it("should not throw when minPrefix is within IPv6 range", () => {
      assert.doesNotThrow(() => cidr({ version: 6, minPrefix: 64 }));
    });

    it("should throw RangeError when minPrefix exceeds IPv6 max", () => {
      assert.throws(
        () => cidr({ version: 6, minPrefix: 129 }),
        RangeError,
      );
    });

    it("should throw RangeError when minPrefix is negative", () => {
      assert.throws(
        () => cidr({ minPrefix: -5 }),
        RangeError,
      );
    });

    it("should throw RangeError when maxPrefix exceeds IPv4 max", () => {
      assert.throws(
        () => cidr({ version: 4, maxPrefix: 33 }),
        RangeError,
      );
    });

    it("should throw RangeError when maxPrefix exceeds IPv6 max", () => {
      assert.throws(
        () => cidr({ version: 6, maxPrefix: 200 }),
        RangeError,
      );
    });

    it("should throw RangeError when minPrefix is NaN", () => {
      assert.throws(
        () => cidr({ minPrefix: NaN as never }),
        RangeError,
      );
    });

    it("should throw RangeError when maxPrefix is NaN", () => {
      assert.throws(
        () => cidr({ maxPrefix: NaN as never }),
        RangeError,
      );
    });

    it("should throw RangeError when minPrefix is Infinity", () => {
      assert.throws(
        () => cidr({ minPrefix: Infinity as never }),
        RangeError,
      );
    });

    it("should throw RangeError when minPrefix is -Infinity", () => {
      assert.throws(
        () => cidr({ minPrefix: -Infinity as never }),
        RangeError,
      );
    });

    it("should throw RangeError when maxPrefix is Infinity", () => {
      assert.throws(
        () => cidr({ maxPrefix: Infinity as never }),
        RangeError,
      );
    });

    it("should throw RangeError when maxPrefix is -Infinity", () => {
      assert.throws(
        () => cidr({ maxPrefix: -Infinity as never }),
        RangeError,
      );
    });
  });

  describe("nested IP validation error propagation", () => {
    it("should preserve private IP error from IPv4", () => {
      const parser = cidr({ ipv4: { allowPrivate: false } });
      const result = parser.parse("192.168.0.0/24");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "192.168.0.0" },
        { type: "text", text: " is a private IP address." },
      ]);
    });

    it("should preserve loopback error from IPv4", () => {
      const parser = cidr({ ipv4: { allowLoopback: false } });
      const result = parser.parse("127.0.0.0/8");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "127.0.0.0" },
        { type: "text", text: " is a loopback address." },
      ]);
    });

    it("should preserve multicast error from IPv6", () => {
      const parser = cidr({
        version: 6,
        ipv6: { allowMulticast: false },
      });
      const result = parser.parse("ff00::/8");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "ff00::" },
        { type: "text", text: " is a multicast address." },
      ]);
    });

    it("should preserve loopback error from IPv6", () => {
      const parser = cidr({ ipv6: { allowLoopback: false } });
      const result = parser.parse("::1/128");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::1" },
        { type: "text", text: " is a loopback address." },
      ]);
    });

    it("should return generic CIDR error for structurally invalid IP", () => {
      const parser = cidr({ ipv4: { allowPrivate: false } });
      const result = parser.parse("not-an-ip/24");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a valid CIDR notation, but got " },
        { type: "value", value: "not-an-ip/24" },
        { type: "text", text: "." },
      ]);
    });

    it("should still succeed when no restrictions are violated", () => {
      const parser = cidr({ version: 4 });
      const result = parser.parse("192.168.0.0/24");
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, {
        address: "192.168.0.0",
        prefix: 24,
        version: 4,
      });
    });

    it("should use custom privateNotAllowed error", () => {
      const parser = cidr({
        ipv4: { allowPrivate: false },
        errors: {
          privateNotAllowed: (ip) =>
            message`Private IP ${ip} not allowed in CIDR.`,
        },
      });
      const result = parser.parse("192.168.0.0/24");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Private IP " },
        { type: "value", value: "192.168.0.0" },
        { type: "text", text: " not allowed in CIDR." },
      ]);
    });

    it("should use custom loopbackNotAllowed error", () => {
      const parser = cidr({
        ipv4: { allowLoopback: false },
        errors: {
          loopbackNotAllowed: message`Loopback denied.`,
        },
      });
      const result = parser.parse("127.0.0.0/8");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Loopback denied." },
      ]);
    });

    it("should use custom multicastNotAllowed error for IPv6", () => {
      const parser = cidr({
        version: 6,
        ipv6: { allowMulticast: false },
        errors: {
          multicastNotAllowed: (ip) => message`Multicast ${ip} rejected.`,
        },
      });
      const result = parser.parse("ff00::/8");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Multicast " },
        { type: "value", value: "ff00::" },
        { type: "text", text: " rejected." },
      ]);
    });

    it("should use custom uniqueLocalNotAllowed error for IPv6", () => {
      const parser = cidr({
        version: 6,
        ipv6: { allowUniqueLocal: false },
        errors: {
          uniqueLocalNotAllowed: message`Unique local denied.`,
        },
      });
      const result = parser.parse("fd00::/8");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Unique local denied." },
      ]);
    });

    it("should use custom linkLocalNotAllowed error", () => {
      const parser = cidr({
        ipv4: { allowLinkLocal: false },
        errors: {
          linkLocalNotAllowed: message`Link-local denied.`,
        },
      });
      const result = parser.parse("169.254.1.0/24");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Link-local denied." },
      ]);
    });

    it("should use custom broadcastNotAllowed error", () => {
      const parser = cidr({
        ipv4: { allowBroadcast: false },
        errors: {
          broadcastNotAllowed: message`Broadcast denied.`,
        },
      });
      const result = parser.parse("255.255.255.255/32");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Broadcast denied." },
      ]);
    });

    it("should use custom zeroNotAllowed error", () => {
      const parser = cidr({
        ipv4: { allowZero: false },
        errors: {
          zeroNotAllowed: message`Zero denied.`,
        },
      });
      const result = parser.parse("0.0.0.0/32");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Zero denied." },
      ]);
    });

    it("should not misclassify custom error containing 'Expected'", () => {
      const parser = cidr({
        ipv4: { allowPrivate: false },
        errors: {
          privateNotAllowed: (ip) =>
            message`Expected a public IP, but got ${ip}.`,
        },
      });
      const result = parser.parse("192.168.0.0/24");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Expected a public IP, but got " },
        { type: "value", value: "192.168.0.0" },
        { type: "text", text: "." },
      ]);
    });

    it("should report invalidPrefix over private restriction for IPv4", () => {
      const parser = cidr({ ipv4: { allowPrivate: false } });
      const result = parser.parse("192.168.0.0/33");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        {
          type: "text",
          text: "Expected a prefix length between 0 and ",
        },
        { type: "text", text: "32" },
        { type: "text", text: " for IPv4, but got " },
        { type: "text", text: "33" },
        { type: "text", text: "." },
      ]);
    });

    it("should report invalidPrefix over loopback restriction for IPv6", () => {
      const parser = cidr({
        version: 6,
        ipv6: { allowLoopback: false },
      });
      const result = parser.parse("::1/129");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        {
          type: "text",
          text: "Expected a prefix length between 0 and ",
        },
        { type: "text", text: "128" },
        { type: "text", text: " for IPv6, but got " },
        { type: "text", text: "129" },
        { type: "text", text: "." },
      ]);
    });

    it("should report prefixBelowMinimum over restriction error", () => {
      const parser = cidr({
        ipv4: { allowPrivate: false },
        minPrefix: 16,
      });
      const result = parser.parse("192.168.0.0/8");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        {
          type: "text",
          text: "Expected a prefix length greater than or equal to ",
        },
        { type: "text", text: "16" },
        { type: "text", text: ", but got " },
        { type: "text", text: "8" },
        { type: "text", text: "." },
      ]);
    });

    it("should report prefixAboveMaximum over restriction error", () => {
      const parser = cidr({
        ipv4: { allowLoopback: false },
        maxPrefix: 24,
      });
      const result = parser.parse("127.0.0.0/32");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        {
          type: "text",
          text: "Expected a prefix length less than or equal to ",
        },
        { type: "text", text: "24" },
        { type: "text", text: ", but got " },
        { type: "text", text: "32" },
        { type: "text", text: "." },
      ]);
    });
  });

  describe("IPv4-mapped IPv6 CIDR restrictions", () => {
    it("should not apply IPv4-mapped checks when version is 6", () => {
      const parser = cidr({ version: 6, ipv4: { allowPrivate: false } });
      const result = parser.parse("::ffff:192.168.0.0/120");
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, {
        address: "::ffff:c0a8:0",
        prefix: 120,
        version: 6,
      });
    });

    it("should reject IPv4-mapped private CIDR when allowPrivate is false", () => {
      const parser = cidr({ ipv4: { allowPrivate: false } });
      const result = parser.parse("::ffff:192.168.0.0/120");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::ffff:c0a8:0" },
        { type: "text", text: " is a private IP address." },
      ]);
    });

    it("should reject IPv4-mapped loopback CIDR when allowLoopback is false", () => {
      const parser = cidr({ ipv4: { allowLoopback: false } });
      const result = parser.parse("::ffff:127.0.0.1/128");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::ffff:7f00:1" },
        { type: "text", text: " is a loopback address." },
      ]);
    });

    it("should accept IPv4-mapped public CIDR when allowPrivate is false", () => {
      const parser = cidr({ ipv4: { allowPrivate: false } });
      const result = parser.parse("::ffff:203.0.113.0/120");
      assert.ok(result.success);
      assert.deepStrictEqual(result.value, {
        address: "::ffff:cb00:7100",
        prefix: 120,
        version: 6,
      });
    });

    it("should use custom error for IPv4-mapped CIDR restriction", () => {
      const parser = cidr({
        ipv4: { allowPrivate: false },
        errors: {
          privateNotAllowed: (addr) =>
            message`Private ${addr} not allowed in CIDR.`,
        },
      });
      const result = parser.parse("::ffff:10.0.0.0/104");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "Private " },
        { type: "value", value: "::ffff:a00:0" },
        { type: "text", text: " not allowed in CIDR." },
      ]);
    });

    it("should report invalidPrefix over mapped restriction", () => {
      const parser = cidr({ ipv4: { allowPrivate: false } });
      const result = parser.parse("::ffff:10.0.0.0/129");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        {
          type: "text",
          text: "Expected a prefix length between 0 and ",
        },
        { type: "text", text: "128" },
        { type: "text", text: " for IPv6, but got " },
        { type: "text", text: "129" },
        { type: "text", text: "." },
      ]);
    });

    it("should report prefixBelowMinimum over mapped restriction", () => {
      const parser = cidr({
        ipv4: { allowPrivate: false },
        minPrefix: 112,
      });
      const result = parser.parse("::ffff:10.0.0.0/96");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        {
          type: "text",
          text: "Expected a prefix length greater than or equal to ",
        },
        { type: "text", text: "112" },
        { type: "text", text: ", but got " },
        { type: "text", text: "96" },
        { type: "text", text: "." },
      ]);
    });

    it("should report prefixAboveMaximum over mapped restriction", () => {
      const parser = cidr({
        ipv4: { allowLoopback: false },
        maxPrefix: 120,
      });
      const result = parser.parse("::ffff:127.0.0.1/128");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        {
          type: "text",
          text: "Expected a prefix length less than or equal to ",
        },
        { type: "text", text: "120" },
        { type: "text", text: ", but got " },
        { type: "text", text: "128" },
        { type: "text", text: "." },
      ]);
    });

    it("should check base address regardless of prefix length", () => {
      // Consistent with how ipv4() checks regular IPv4 CIDRs:
      // the base address is validated, not the network range.
      const parser = cidr({ ipv4: { allowPrivate: false } });

      // Broad prefix — base address 10.0.0.0 is still private
      const r1 = parser.parse("::ffff:10.0.0.0/97");
      assert.ok(!r1.success);

      // Prefix at /96 — base address is still checked
      const r2 = parser.parse("::ffff:10.0.0.0/96");
      assert.ok(!r2.success);

      // Prefix below /96 — base address is still checked
      const r3 = parser.parse("::ffff:10.0.0.0/80");
      assert.ok(!r3.success);

      // Non-private base address with same broad prefix → accepted
      const r4 = parser.parse("::ffff:203.0.113.0/97");
      assert.ok(r4.success);
    });

    it("should reject mapped broadcast CIDR regardless of prefix", () => {
      const parser = cidr({ ipv4: { allowBroadcast: false } });
      const result = parser.parse("::ffff:255.255.255.255/127");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::ffff:ffff:ffff" },
        { type: "text", text: " is the broadcast address." },
      ]);
    });

    it("should reject IPv4-mapped link-local CIDR when allowLinkLocal is false", () => {
      const parser = cidr({ ipv4: { allowLinkLocal: false } });
      const result = parser.parse("::ffff:169.254.0.0/120");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::ffff:a9fe:0" },
        { type: "text", text: " is a link-local address." },
      ]);
    });

    it("should reject IPv4-mapped multicast CIDR when allowMulticast is false", () => {
      const parser = cidr({ ipv4: { allowMulticast: false } });
      const result = parser.parse("::ffff:224.0.0.0/120");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::ffff:e000:0" },
        { type: "text", text: " is a multicast address." },
      ]);
    });

    it("should reject IPv4-mapped zero CIDR when allowZero is false", () => {
      const parser = cidr({ ipv4: { allowZero: false } });
      const result = parser.parse("::ffff:0.0.0.0/120");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "value", value: "::ffff:0:0" },
        { type: "text", text: " is the zero address." },
      ]);
    });

    it("should reject IPv4-mapped CIDR with leading zeros", () => {
      const parser = cidr();

      const withLeadingZeros = [
        "::ffff:01.02.03.04/96",
        "::ffff:192.168.001.1/128",
      ];

      for (const addr of withLeadingZeros) {
        const result = parser.parse(addr);
        assert.ok(
          !result.success,
          `Should reject IPv4-mapped CIDR with leading zeros: ${addr}`,
        );
      }
    });

    it("should snapshot IPv4 restrictions at construction time", () => {
      const ipv4Opts = { allowPrivate: false };
      const parser = cidr({ ipv4: ipv4Opts });
      // Mutate nested field after construction — should have no effect
      ipv4Opts.allowPrivate = true;
      const result = parser.parse("::ffff:192.168.0.0/120");
      assert.ok(!result.success);
    });

    it("should snapshot error callbacks at construction time", () => {
      const errors = {
        privateNotAllowed: () => message`original mapped cidr error`,
      };
      const parser = cidr({
        ipv4: { allowPrivate: false },
        errors,
      });
      errors.privateNotAllowed = () => message`mutated mapped cidr error`;
      const result = parser.parse("::ffff:10.0.0.0/104");
      assert.ok(!result.success);
      assert.deepStrictEqual(result.error, [
        { type: "text", text: "original mapped cidr error" },
      ]);
    });
  });
});

describe("branch coverage regressions", () => {
  it("covers bigint-only custom port error branches", () => {
    const parser = port({
      type: "bigint",
      min: 2000n,
      max: 9000n,
      disallowWellKnown: true,
      errors: {
        invalidPort: message`invalid bigint port`,
        belowMinimum: message`too small bigint port`,
        aboveMaximum: message`too large bigint port`,
        wellKnownNotAllowed: message`well-known bigint port denied`,
      },
    });

    const invalid = parser.parse("abc");
    assert.ok(!invalid.success);
    if (!invalid.success) {
      assert.deepStrictEqual(invalid.error, [
        { type: "text", text: "invalid bigint port" },
      ]);
    }

    const below = parser.parse("1024");
    assert.ok(!below.success);
    if (!below.success) {
      assert.deepStrictEqual(below.error, [
        { type: "text", text: "too small bigint port" },
      ]);
    }

    const above = parser.parse("10000");
    assert.ok(!above.success);
    if (!above.success) {
      assert.deepStrictEqual(above.error, [
        { type: "text", text: "too large bigint port" },
      ]);
    }

    // Use a separate parser with no min constraint so well-known port
    // check is reached before belowMinimum:
    const wkParser = port({
      type: "bigint",
      disallowWellKnown: true,
      errors: {
        wellKnownNotAllowed: message`well-known bigint port denied`,
      },
    });
    const wellKnown = wkParser.parse("80");
    assert.ok(!wellKnown.success);
    if (!wellKnown.success) {
      assert.deepStrictEqual(wellKnown.error, [
        { type: "text", text: "well-known bigint port denied" },
      ]);
    }
  });

  it("covers hostname wildcard and label custom invalid branches", () => {
    const parser = hostname({
      allowWildcard: true,
      errors: {
        invalidHostname: (input) => message`invalid host: ${input}`,
      },
    });

    const wildcard = parser.parse("*.*.example.com");
    assert.ok(!wildcard.success);

    const emptyLabel = parser.parse("example..com");
    assert.ok(!emptyLabel.success);

    const longLabel = parser.parse(`${"a".repeat(64)}.example.com`);
    assert.ok(!longLabel.success);
  });

  it("covers email quoted/local/domain edge branches", () => {
    const parser = email();

    const unclosedQuote = parser.parse('"abc@example.com');
    assert.ok(!unclosedQuote.success);

    const hyphenLabel = parser.parse("user@-example.com");
    assert.ok(!hyphenLabel.success);

    const badLabelChar = parser.parse("user@exam_ple.com");
    assert.ok(!badLabelChar.success);

    const longLabel = parser.parse(`user@${"a".repeat(64)}.com`);
    assert.ok(!longLabel.success);
  });

  it("covers email allowMultiple domainNotAllowed function branch", () => {
    const parser = email({
      allowMultiple: true,
      allowedDomains: ["example.com"],
      errors: {
        domainNotAllowed: (addr, domains) =>
          message`${addr} not in ${text(domains.join(","))}`,
      },
    });

    const result = parser.parse("one@example.com,two@other.com");
    assert.ok(!result.success);
  });

  it("covers socketAddress missingPort function branches", () => {
    const required = socketAddress({
      requirePort: true,
      errors: {
        missingPort: (input) => message`missing port from ${input}`,
      },
    });
    const requiredResult = required.parse("localhost");
    assert.ok(!requiredResult.success);

    const noDefault = socketAddress({
      requirePort: false,
      errors: {
        missingPort: (input) => message`still missing: ${input}`,
      },
    });
    const noDefaultResult = noDefault.parse("example.com");
    assert.ok(!noDefaultResult.success);
  });

  it("covers portRange allowSingle failure and bigint invalidRange", () => {
    const allowSingle = portRange({ allowSingle: true });
    const singleInvalid = allowSingle.parse("abc");
    assert.ok(!singleInvalid.success);

    const bigintRange = portRange({
      type: "bigint",
      errors: {
        invalidRange: (start, end) =>
          message`${text(start.toString())} > ${text(end.toString())}`,
      },
    });
    const reversed = bigintRange.parse("9000-8000");
    assert.ok(!reversed.success);
  });

  it("covers domain invalidDomain function branches", () => {
    const parser = domain({
      errors: {
        invalidDomain: (input) => message`invalid domain: ${input}`,
      },
    });

    const empty = parser.parse("");
    assert.ok(!empty.success);

    const invalidLabel = parser.parse("foo_.example.com");
    assert.ok(!invalidLabel.success);
  });

  it("covers ipv6 custom function error branches", () => {
    const invalid = ipv6({
      errors: {
        invalidIpv6: (input) => message`invalid ipv6: ${input}`,
      },
    });
    const invalidResult = invalid.parse("::ffff:1.2.3");
    assert.ok(!invalidResult.success);

    const zero = ipv6({
      allowZero: false,
      errors: {
        zeroNotAllowed: (addr) => message`zero denied: ${addr}`,
      },
    });
    const zeroResult = zero.parse("::");
    assert.ok(!zeroResult.success);

    const loopback = ipv6({
      allowLoopback: false,
      errors: {
        loopbackNotAllowed: (addr) => message`loopback denied: ${addr}`,
      },
    });
    const loopbackResult = loopback.parse("::1");
    assert.ok(!loopbackResult.success);

    const linkLocal = ipv6({
      allowLinkLocal: false,
      errors: {
        linkLocalNotAllowed: (addr) => message`link-local denied: ${addr}`,
      },
    });
    const linkLocalResult = linkLocal.parse("fe80::1");
    assert.ok(!linkLocalResult.success);

    const uniqueLocal = ipv6({
      allowUniqueLocal: false,
      errors: {
        uniqueLocalNotAllowed: (addr) => message`ula denied: ${addr}`,
      },
    });
    const uniqueLocalResult = uniqueLocal.parse("fc00::1");
    assert.ok(!uniqueLocalResult.success);

    const multicast = ipv6({
      allowMulticast: false,
      errors: {
        multicastNotAllowed: (addr) => message`multicast denied: ${addr}`,
      },
    });
    const multicastResult = multicast.parse("ff02::1");
    assert.ok(!multicastResult.success);
  });

  it("covers cidr custom function branches", () => {
    const invalidCidr = cidr({
      errors: {
        invalidCidr: (input) => message`bad cidr: ${input}`,
      },
    });

    const noSlash = invalidCidr.parse("192.0.2.0");
    assert.ok(!noSlash.success);

    const nonNumericPrefix = invalidCidr.parse("192.0.2.0/abc");
    assert.ok(!nonNumericPrefix.success);

    const invalidAddress = invalidCidr.parse("999.0.2.0/24");
    assert.ok(!invalidAddress.success);

    const invalidPrefix = cidr({
      errors: {
        invalidPrefix: (prefix, version) =>
          message`prefix ${text(prefix.toString())} invalid for v${
            text(version.toString())
          }`,
      },
    });
    const ipv6TooWide = invalidPrefix.parse("2001:db8::/129");
    assert.ok(!ipv6TooWide.success);

    const constrained = cidr({
      minPrefix: 16,
      maxPrefix: 24,
      errors: {
        prefixBelowMinimum: (prefix, min) =>
          message`${text(prefix.toString())} < ${text(min.toString())}`,
        prefixAboveMaximum: (prefix, max) =>
          message`${text(prefix.toString())} > ${text(max.toString())}`,
      },
    });
    const below = constrained.parse("192.0.2.0/8");
    assert.ok(!below.success);

    const above = constrained.parse("192.0.2.0/30");
    assert.ok(!above.success);
  });

  it("covers integer/float/url/locale/uuid uncovered branches", () => {
    const bigintInteger = integer({
      type: "bigint",
      min: 10n,
      max: 20n,
      errors: {
        invalidInteger: (input) => message`bad bigint integer: ${input}`,
        belowMinimum: (value, min) =>
          message`${text(value.toString())} < ${text(min.toString())}`,
        aboveMaximum: (value, max) =>
          message`${text(value.toString())} > ${text(max.toString())}`,
      },
    });
    assert.ok(!bigintInteger.parse("abc").success);
    assert.ok(!bigintInteger.parse("9").success);
    assert.ok(!bigintInteger.parse("21").success);
    assert.equal(bigintInteger.format(12n), "12");

    const numberInteger = integer({
      min: 10,
      max: 20,
      errors: {
        invalidInteger: (input) => message`bad integer: ${input}`,
        belowMinimum: message`below min`,
        aboveMaximum: message`above max`,
      },
    });
    assert.ok(!numberInteger.parse("abc").success);
    assert.ok(!numberInteger.parse("9").success);
    assert.ok(!numberInteger.parse("21").success);
    assert.equal(numberInteger.format(12), "12");

    const floatParser = float({
      min: 1,
      max: 2,
      errors: {
        invalidNumber: (input) => message`bad float: ${input}`,
        belowMinimum: (value, min) =>
          message`${text(value.toString())} < ${text(min.toString())}`,
        aboveMaximum: (value, max) =>
          message`${text(value.toString())} > ${text(max.toString())}`,
      },
    });
    assert.ok(!floatParser.parse("abc").success);
    assert.ok(!floatParser.parse("0.5").success);
    assert.ok(!floatParser.parse("2.5").success);
    assert.equal(floatParser.format(1.5), "1.5");

    const urlParser = url({
      allowedProtocols: ["https:"],
      errors: {
        invalidUrl: (input) => message`bad url: ${input}`,
        disallowedProtocol: message`protocol blocked`,
      },
    });
    assert.ok(!urlParser.parse("not-a-url").success);
    assert.ok(!urlParser.parse("http://example.com").success);
    assert.equal(
      urlParser.format(new URL("https://example.com/path")),
      "https://example.com/path",
    );

    const localeParser = locale({
      errors: {
        invalidLocale: message`bad locale`,
      },
    });
    assert.ok(!localeParser.parse("xyz-INVALID-123").success);
    assert.equal(localeParser.format(new Intl.Locale("en-US")), "en-US");
    assert.equal(
      localeParser.format(new Intl.Locale("en-US-u-ca-buddhist")),
      "en-US-u-ca-buddhist",
    );
    assert.equal(
      localeParser.format(new Intl.Locale("zh-Hant-TW-u-nu-hanidec")),
      "zh-Hant-TW-u-nu-hanidec",
    );

    const uuidParser = uuid({
      allowedVersions: [4],
      errors: {
        invalidUuid: (input) => message`bad uuid: ${input}`,
        disallowedVersion: message`version blocked`,
      },
    });
    assert.ok(!uuidParser.parse("not-a-uuid").success);
    assert.ok(
      !uuidParser.parse("6ba7b810-9dad-11d1-80b4-00c04fd430c8").success,
    );
    assert.equal(
      uuidParser.format("550e8400-e29b-41d4-a716-446655440000"),
      "550e8400-e29b-41d4-a716-446655440000",
    );
  });

  it("covers port and ipv4 uncovered custom function branches", () => {
    const bigintPort = port({
      type: "bigint",
      min: 2000n,
      max: 9000n,
      disallowWellKnown: true,
      errors: {
        invalidPort: (input) => message`bad bigint port: ${input}`,
        belowMinimum: (value, min) =>
          message`${text(value.toString())} < ${text(min.toString())}`,
        aboveMaximum: (value, max) =>
          message`${text(value.toString())} > ${text(max.toString())}`,
        wellKnownNotAllowed: (value) =>
          message`well-known denied: ${text(value.toString())}`,
      },
    });
    assert.ok(!bigintPort.parse("abc").success);
    assert.ok(!bigintPort.parse("1024").success);
    assert.ok(!bigintPort.parse("10000").success);
    assert.equal(bigintPort.format(8080n), "8080");

    const bigintWellKnownOnly = port({
      type: "bigint",
      disallowWellKnown: true,
      errors: {
        wellKnownNotAllowed: (value) =>
          message`wk denied: ${text(value.toString())}`,
      },
    });
    assert.ok(!bigintWellKnownOnly.parse("80").success);

    const numberPort = port({
      min: 2000,
      max: 9000,
      disallowWellKnown: true,
      errors: {
        invalidPort: message`bad number port`,
        belowMinimum: (value, min) =>
          message`${text(value.toString())} < ${text(min.toString())}`,
        aboveMaximum: (value, max) =>
          message`${text(value.toString())} > ${text(max.toString())}`,
        wellKnownNotAllowed: (value) =>
          message`wk denied: ${text(value.toString())}`,
      },
    });
    assert.ok(!numberPort.parse("abc").success);
    assert.ok(!numberPort.parse("1024").success);
    assert.ok(!numberPort.parse("10000").success);
    assert.equal(numberPort.format(8080), "8080");

    const numberWellKnownOnly = port({
      disallowWellKnown: true,
      errors: {
        wellKnownNotAllowed: (value) =>
          message`wk denied: ${text(value.toString())}`,
      },
    });
    assert.ok(!numberWellKnownOnly.parse("80").success);

    const invalidIpv4 = ipv4({
      errors: {
        invalidIpv4: (input) => message`bad ipv4: ${input}`,
      },
    });
    assert.ok(!invalidIpv4.parse("1..2.3").success);
    assert.ok(!invalidIpv4.parse("1. 2.3.4").success);
    assert.ok(!invalidIpv4.parse("01.2.3.4").success);
    assert.ok(!invalidIpv4.parse("300.2.3.4").success);

    assert.ok(
      !ipv4({
        allowPrivate: false,
        errors: {
          privateNotAllowed: (ip) => message`private denied: ${ip}`,
        },
      }).parse("192.168.1.1").success,
    );
    assert.ok(
      !ipv4({
        allowLinkLocal: false,
        errors: {
          linkLocalNotAllowed: (ip) => message`link-local denied: ${ip}`,
        },
      }).parse("169.254.1.1").success,
    );
    assert.ok(
      !ipv4({
        allowMulticast: false,
        errors: {
          multicastNotAllowed: (ip) => message`multicast denied: ${ip}`,
        },
      }).parse("224.0.0.1").success,
    );
    assert.ok(
      !ipv4({
        allowBroadcast: false,
        errors: {
          broadcastNotAllowed: (ip) => message`broadcast denied: ${ip}`,
        },
      }).parse("255.255.255.255").success,
    );
    assert.ok(
      !ipv4({
        allowZero: false,
        errors: {
          zeroNotAllowed: (ip) => message`zero denied: ${ip}`,
        },
      }).parse("0.0.0.0").success,
    );
  });

  it("covers hostname/email/ipv6/socket/mac/domain uncovered branches", () => {
    const host = hostname({
      allowLocalhost: false,
      allowUnderscore: false,
      errors: {
        localhostNotAllowed: (input) => message`localhost blocked: ${input}`,
        underscoreNotAllowed: (input) => message`underscore blocked: ${input}`,
        invalidHostname: (input) => message`invalid host: ${input}`,
      },
    });
    assert.ok(!host.parse("localhost").success);
    assert.ok(!host.parse("a_b.example.com").success);
    assert.ok(!host.parse("").success);
    assert.ok(!host.parse("example..com").success);
    assert.ok(!host.parse("exa$mple.com").success);

    const emailParser = email({
      allowMultiple: true,
      errors: {
        invalidEmail: (input) => message`invalid email: ${input}`,
      },
    });
    assert.ok(!emailParser.parse("user@-example.com").success);
    assert.ok(!emailParser.parse("user@example-.com").success);
    assert.ok(!emailParser.parse("good@example.com,bad@-example.com").success);

    const socket = socketAddress({
      errors: {
        invalidFormat: (input) => message`bad socket: ${input}`,
      },
    });
    assert.ok(!socket.parse("localhost:99999").success);
    assert.ok(!socket.parse("localhost:not-port").success);

    const mac = macAddress({ separator: "none" });
    const macResult = mac.parse("aabbccddeeff");
    assert.ok(macResult.success);
    assert.equal(mac.format("aa:bb:cc:dd:ee:ff"), "aa:bb:cc:dd:ee:ff");

    const dom = domain();
    assert.equal(dom.format("example.com"), "example.com");

    const ipv6Parser = ipv6({
      errors: {
        invalidIpv6: (input) => message`invalid ipv6: ${input}`,
      },
    });
    assert.ok(!ipv6Parser.parse("::ffff:300.1.2.3").success);
    assert.ok(!ipv6Parser.parse("1:2:3:4:5:6:7:8:9").success);
    assert.ok(!ipv6Parser.parse("2001::db8::1").success);
    assert.ok(ipv6Parser.parse("2001:0:0:1:0:0:0:1").success);
    assert.equal(ipv6Parser.format("::1"), "::1");
  });

  it("covers ip/cidr format and ipv6 normalization edge branches", () => {
    const ipParser = ip({
      errors: {
        invalidIP: (input) => message`invalid ip literal: ${input}`,
      },
    });
    const ipFailure = ipParser.parse("not-an-ip");
    assert.ok(!ipFailure.success);
    assert.equal(ipParser.format("203.0.113.10"), "203.0.113.10");

    const cidrParser = cidr();
    const cidrResult = cidrParser.parse("192.0.2.0/24");
    assert.ok(cidrResult.success);
    assert.equal(
      cidrParser.format({ address: "192.0.2.0", prefix: 24, version: 4 }),
      "192.0.2.0/24",
    );

    const ipv6Parser = ipv6();
    const noCompression = ipv6Parser.parse("2001:db8:1:2:3:4:5:6");
    assert.ok(noCompression.success);
    if (noCompression.success) {
      assert.equal(noCompression.value, "2001:db8:1:2:3:4:5:6");
    }

    const badMappedLength = ipv6Parser.parse("::ffff:192.0.2");
    assert.ok(!badMappedLength.success);

    const badMappedRange = ipv6Parser.parse("::ffff:192.0.2.999");
    assert.ok(!badMappedRange.success);
  });

  it("covers rethrow branches for non-standard constructor errors", () => {
    const originalBigInt = globalThis.BigInt;
    const originalLocale = Intl.Locale;

    // Construct localeParser before mocking Intl.Locale, since the
    // placeholder eagerly creates new Intl.Locale("und").
    const localeParser = locale();

    try {
      (globalThis as unknown as { BigInt: typeof BigInt }).BigInt = ((
        _input: string,
      ) => {
        throw new TypeError("bigint boom");
      }) as unknown as typeof BigInt;

      Object.defineProperty(Intl, "Locale", {
        value: class FakeLocale {
          constructor(_input: string) {
            throw new TypeError("locale boom");
          }
        },
        configurable: true,
      });

      const bigintParser = integer({ type: "bigint" });
      assert.throws(
        () => bigintParser.parse("123"),
        TypeError,
        "bigint boom",
      );

      const bigintPortParser = port({ type: "bigint" });
      assert.throws(
        () => bigintPortParser.parse("8080"),
        TypeError,
        "bigint boom",
      );

      assert.throws(
        () => localeParser.parse("en-US"),
        TypeError,
        "locale boom",
      );
    } finally {
      (globalThis as unknown as { BigInt: typeof BigInt }).BigInt =
        originalBigInt;
      Object.defineProperty(Intl, "Locale", {
        value: originalLocale,
        configurable: true,
      });
    }
  });

  it("covers number-choice custom invalidChoice callback for numeric choices", () => {
    const parser = choice([10, 20], {
      errors: {
        invalidChoice: (input, choices) =>
          message`bad ${input}; valid count ${text(String(choices.length))}`,
      },
    });

    const result = parser.parse("abc");
    assert.ok(!result.success);
    if (!result.success) {
      assert.deepEqual(result.error, [
        { type: "text", text: "bad " },
        { type: "value", value: "abc" },
        { type: "text", text: "; valid count " },
        { type: "text", text: "2" },
      ]);
    }
  });

  it("covers static custom invalidChoice for numeric choice parser", () => {
    const parser = choice([1, 2, 3], {
      errors: {
        invalidChoice: message`pick one of the numeric choices`,
      },
    });

    const result = parser.parse("999");
    assert.ok(!result.success);
    if (!result.success) {
      assert.deepEqual(result.error, [
        { type: "text", text: "pick one of the numeric choices" },
      ]);
    }
  });

  it("covers bigint integer static custom error branches", () => {
    const parser = integer({
      type: "bigint",
      min: 10n,
      max: 20n,
      errors: {
        invalidInteger: message`bigint parse failed`,
        belowMinimum: message`bigint is too small`,
        aboveMaximum: message`bigint is too large`,
      },
    });

    const invalid = parser.parse("not-a-bigint");
    assert.ok(!invalid.success);
    const tooSmall = parser.parse("9");
    assert.ok(!tooSmall.success);
    const tooLarge = parser.parse("21");
    assert.ok(!tooLarge.success);
  });

  it("covers float parser function custom min/max errors", () => {
    const parser = float({
      min: 10,
      max: 20,
      errors: {
        belowMinimum: (value, min) =>
          message`num ${text(String(value))} < ${text(String(min))}`,
        aboveMaximum: (value, max) =>
          message`num ${text(String(value))} > ${text(String(max))}`,
      },
    });

    assert.ok(!parser.parse("9").success);
    assert.ok(!parser.parse("21").success);
  });

  it("covers port number static and function error branches", () => {
    const staticParser = port({
      min: 2000,
      max: 3000,
      disallowWellKnown: true,
      errors: {
        belowMinimum: message`port too small`,
        aboveMaximum: message`port too large`,
        wellKnownNotAllowed: message`well-known port denied`,
      },
    });
    assert.ok(!staticParser.parse("1024").success);
    assert.ok(!staticParser.parse("4000").success);
    assert.ok(!staticParser.parse("80").success);

    const functionParser = port({
      min: 2000,
      max: 3000,
      disallowWellKnown: true,
      errors: {
        belowMinimum: (value, min) =>
          message`port ${text(String(value))} < ${text(String(min))}`,
        aboveMaximum: (value, max) =>
          message`port ${text(String(value))} > ${text(String(max))}`,
        wellKnownNotAllowed: (value) =>
          message`port ${text(String(value))} is reserved`,
      },
    });
    assert.ok(!functionParser.parse("1024").success);
    assert.ok(!functionParser.parse("4000").success);
    assert.ok(!functionParser.parse("80").success);
  });

  it("covers ip invalidIP function branch when both sub-parsers are generic", () => {
    const parser = ip({
      errors: {
        invalidIP: (input) => message`invalid ip via callback: ${input}`,
      },
    });

    const result = parser.parse("not-an-ip-literal");
    assert.ok(!result.success);
  });
});

describe("format() for network-address value parsers", () => {
  it("macAddress().format() should return the value, not metavar", () => {
    const mac = macAddress();
    assert.equal(mac.format("00:1a:2b:3c:4d:5e"), "00:1a:2b:3c:4d:5e");
  });

  it("macAddress() parse-format round-trips for all separator styles", () => {
    const mac = macAddress();
    for (
      const input of [
        "aa:bb:cc:dd:ee:ff",
        "aa-bb-cc-dd-ee-ff",
        "aabb.ccdd.eeff",
        "aabbccddeeff",
      ]
    ) {
      const parsed = mac.parse(input);
      assert.ok(parsed.success);
      if (parsed.success) {
        assert.equal(mac.format(parsed.value), parsed.value);
      }
    }
  });

  it("macAddress().format() should normalize with configured options", () => {
    const mac = macAddress({ case: "upper", outputSeparator: ":" });
    assert.equal(mac.format("aa-bb-cc-dd-ee-ff"), "AA:BB:CC:DD:EE:FF");
  });

  it("domain().format() should return the value, not metavar", () => {
    const dom = domain();
    assert.equal(dom.format("Example.COM"), "Example.COM");
  });

  it("domain().format() should lowercase when configured", () => {
    const dom = domain({ lowercase: true });
    assert.equal(dom.format("Example.COM"), "example.com");
  });

  it("domain() parse-format round-trips with lowercase", () => {
    const dom = domain({ lowercase: true });
    const parsed = dom.parse("Example.COM");
    assert.ok(parsed.success);
    if (parsed.success) {
      assert.equal(dom.format(parsed.value), parsed.value);
    }
  });

  it("ipv6().format() should return the value, not metavar", () => {
    const v6 = ipv6();
    assert.equal(v6.format("2001:db8::1"), "2001:db8::1");
  });

  it("ip().format() should return the value, not metavar", () => {
    const ipParser = ip();
    assert.equal(ipParser.format("192.0.2.1"), "192.0.2.1");
    assert.equal(ipParser.format("2001:db8::1"), "2001:db8::1");
  });

  it("cidr().format() should return CIDR notation, not metavar", () => {
    const cidrParser = cidr();
    assert.equal(
      cidrParser.format({ address: "192.0.2.0", prefix: 24, version: 4 }),
      "192.0.2.0/24",
    );
    assert.equal(
      cidrParser.format({ address: "2001:db8::", prefix: 48, version: 6 }),
      "2001:db8::/48",
    );
  });
});

describe("ValueParser.normalize()", () => {
  it("macAddress().normalize() applies case and separator", () => {
    const mac = macAddress({ case: "upper", outputSeparator: ":" });
    assert.equal(mac.normalize!("aa-bb-cc-dd-ee-ff"), "AA:BB:CC:DD:EE:FF");
  });

  it("macAddress().normalize() preserves separator when separator is any", () => {
    const mac = macAddress();
    assert.equal(mac.normalize!("aa-bb-cc-dd-ee-ff"), "aa-bb-cc-dd-ee-ff");
    assert.equal(mac.normalize!("aabb.ccdd.eeff"), "aabb.ccdd.eeff");
  });

  it("macAddress().normalize() pads shorthand octets", () => {
    const mac = macAddress({ outputSeparator: "." });
    assert.equal(mac.normalize!("0:1:2:3:4:5"), "0001.0203.0405");
  });

  it("macAddress().normalize() preserves non-MAC strings unchanged", () => {
    const mac = macAddress({ outputSeparator: ":" });
    assert.equal(mac.normalize!("local"), "local");
    assert.equal(mac.normalize!("auto"), "auto");
    assert.equal(mac.normalize!("foo.bar.baz"), "foo.bar.baz");
    // Non-Cisco dotted hex strings are preserved
    assert.equal(mac.normalize!("aaa.bbb.ccc"), "aaa.bbb.ccc");
    // 3-char octets are invalid — should not be rewritten
    assert.equal(
      mac.normalize!("aaa:bbb:ccc:ddd:eee:fff"),
      "aaa:bbb:ccc:ddd:eee:fff",
    );
    // 11-digit bare hex is invalid (need exactly 12) — should not be rewritten
    assert.equal(mac.normalize!("aabbccddeef"), "aabbccddeef");
  });

  it("macAddress().format() preserves non-MAC strings unchanged", () => {
    const mac = macAddress({ outputSeparator: ":" });
    assert.equal(mac.format("local"), "local");
  });

  it("domain().normalize() applies lowercase when configured", () => {
    const dom = domain({ lowercase: true });
    assert.equal(dom.normalize!("Example.COM"), "example.com");
  });

  it("domain().normalize() preserves non-domain sentinels", () => {
    const dom = domain({ lowercase: true });
    assert.equal(dom.normalize!("LOCAL"), "LOCAL");
    assert.equal(dom.normalize!("AUTO"), "AUTO");
  });

  it("domain() has no normalize when lowercase is false", () => {
    const dom = domain();
    assert.equal(dom.normalize, undefined);
  });

  it("ipv6().normalize() compresses non-canonical addresses", () => {
    const v6 = ipv6();
    assert.equal(
      v6.normalize!("2001:0db8:0000:0000:0000:0000:0000:0001"),
      "2001:db8::1",
    );
  });

  it("ipv6().normalize() preserves rejected addresses unchanged", () => {
    const v6 = ipv6({ allowLoopback: false });
    assert.equal(v6.normalize!("0:0:0:0:0:0:0:1"), "0:0:0:0:0:0:0:1");
  });

  it("ip().normalize() compresses IPv6 addresses", () => {
    const ipParser = ip();
    assert.equal(
      ipParser.normalize!("2001:0db8:0000:0000:0000:0000:0000:0001"),
      "2001:db8::1",
    );
    assert.equal(ipParser.normalize!("192.0.2.1"), "192.0.2.1");
  });

  it("cidr().normalize() compresses IPv6 CIDR addresses", () => {
    const cidrParser = cidr();
    const result = cidrParser.normalize!({
      address: "2001:0db8:0000:0000:0000:0000:0000:0000",
      prefix: 32,
      version: 6,
    });
    assert.deepEqual(result, {
      address: "2001:db8::",
      prefix: 32,
      version: 6,
    });
  });
});

describe("checkBooleanOption", () => {
  it("should not throw when options is undefined", () => {
    assert.doesNotThrow(() =>
      checkBooleanOption<{ foo?: boolean }>(undefined, "foo")
    );
  });

  it("should not throw when the key is absent", () => {
    assert.doesNotThrow(() => checkBooleanOption<{ foo?: boolean }>({}, "foo"));
  });

  it("should not throw when the value is true", () => {
    assert.doesNotThrow(() => checkBooleanOption({ foo: true }, "foo"));
  });

  it("should not throw when the value is false", () => {
    assert.doesNotThrow(() => checkBooleanOption({ foo: false }, "foo"));
  });

  it("should throw TypeError for a string value", () => {
    assert.throws(
      () => checkBooleanOption({ foo: "yes" }, "foo"),
      {
        name: "TypeError",
        message: "Expected foo to be a boolean, but got string: yes.",
      },
    );
  });

  it("should throw TypeError for a number value", () => {
    assert.throws(
      () => checkBooleanOption({ foo: 1 }, "foo"),
      {
        name: "TypeError",
        message: "Expected foo to be a boolean, but got number: 1.",
      },
    );
  });
});

describe("checkEnumOption", () => {
  const allowed = ["a", "b", "c"] as const;

  it("should not throw when options is undefined", () => {
    assert.doesNotThrow(() =>
      checkEnumOption<{ foo?: string }>(undefined, "foo", allowed)
    );
  });

  it("should not throw when the key is absent", () => {
    assert.doesNotThrow(() =>
      checkEnumOption<{ foo?: string }>({}, "foo", allowed)
    );
  });

  it("should not throw when the value is one of the allowed values", () => {
    for (const v of allowed) {
      assert.doesNotThrow(() => checkEnumOption({ foo: v }, "foo", allowed));
    }
  });

  it("should throw TypeError for an invalid string value", () => {
    assert.throws(
      () => checkEnumOption({ foo: "x" }, "foo", allowed),
      {
        name: "TypeError",
        message:
          'Expected foo to be one of "a", "b", "c", but got string: "x".',
      },
    );
  });

  it("should throw TypeError for a non-string value", () => {
    assert.throws(
      () => checkEnumOption({ foo: 42 }, "foo", allowed),
      {
        name: "TypeError",
        message: 'Expected foo to be one of "a", "b", "c", but got number: 42.',
      },
    );
  });
});

// cSpell: ignore résumé phonebk toolongcode hanidec jpan hebr arabext
// cSpell: ignore localhosts lojban rozaj Resian
