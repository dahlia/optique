import {
  duration,
  instant,
  plainDate,
  plainDateTime,
  plainMonthDay,
  plainTime,
  plainYearMonth,
  type TimeZone,
  timeZone,
  zonedDateTime,
} from "@optique/temporal";
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { parseAsync, parseSync } from "@optique/core/parser";
import { argument, option } from "@optique/core/primitives";
import type {
  NonEmptyString,
  ValueParser,
  ValueParserResult,
} from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// Conditionally import Temporal polyfill only if not natively available
if (!globalThis.Temporal) {
  const polyfill = await import("@js-temporal/polyfill");
  globalThis.Temporal = polyfill.Temporal;
}

describe("instant", () => {
  const parser = instant();

  it("should have correct metavar", () => {
    assert.equal(parser.metavar, "TIMESTAMP");
  });

  it("should parse valid instant strings", () => {
    const validInputs = [
      "2020-01-23T17:04:36.491865121Z",
      "2020-01-23T17:04:36Z",
      "2020-01-23T17:04:36.123Z",
      "1970-01-01T00:00:00Z",
    ];

    for (const input of validInputs) {
      const result = parser.parse(input);
      assert.ok(result.success, `Failed to parse: ${input}`);
      assert.ok(result.value instanceof Temporal.Instant);
      assert.equal(result.value.toString(), input);
    }
  });

  it("should reject invalid instant strings", () => {
    const invalidInputs = [
      "2020-01-23T17:04:36",
      "2020-01-23",
      "invalid",
      "",
      "2020-01-23T25:04:36Z",
      "2020-13-23T17:04:36Z",
    ];

    for (const input of invalidInputs) {
      const result = parser.parse(input);
      assert.ok(!result.success, `Should not parse: ${input}`);
    }
  });

  it("should format instant values correctly", () => {
    const instant = Temporal.Instant.from("2020-01-23T17:04:36Z");
    const formatted = parser.format(instant);
    assert.equal(formatted, "2020-01-23T17:04:36Z");
  });

  it("should support custom metavar", () => {
    const customParser = instant({ metavar: "CUSTOM_INSTANT" });
    assert.equal(customParser.metavar, "CUSTOM_INSTANT");
  });
});

describe("duration", () => {
  const parser = duration();

  it("should have correct metavar", () => {
    assert.equal(parser.metavar, "DURATION");
  });

  it("should parse valid duration strings", () => {
    const validInputs = [
      "PT1H30M",
      "P1DT12H",
      "PT30S",
      "P1Y2M3DT4H5M6S",
      "PT0S",
    ];

    for (const input of validInputs) {
      const result = parser.parse(input);
      assert.ok(result.success, `Failed to parse: ${input}`);
      assert.ok(result.value instanceof Temporal.Duration);
    }
  });

  it("should reject invalid duration strings", () => {
    const invalidInputs = [
      "1H30M",
      "P1D12H",
      "invalid",
      "",
      "PT",
      "P",
    ];

    for (const input of invalidInputs) {
      const result = parser.parse(input);
      assert.ok(!result.success, `Should not parse: ${input}`);
    }
  });

  it("should format duration values correctly", () => {
    const duration = Temporal.Duration.from("PT1H30M");
    const formatted = parser.format(duration);
    assert.equal(formatted, "PT1H30M");
  });

  it("should support custom metavar", () => {
    const customParser = duration({ metavar: "TIME_SPAN" });
    assert.equal(customParser.metavar, "TIME_SPAN");
  });
});

describe("zonedDateTime", () => {
  const parser = zonedDateTime();

  it("should have correct metavar", () => {
    assert.equal(parser.metavar, "ZONED_DATETIME");
  });

  it("should parse valid zoned datetime strings", () => {
    const validInputs = [
      "2020-01-23T17:04:36.491865121+01:00[Europe/Paris]",
      "2020-01-23T17:04:36Z[UTC]",
      "2020-01-23T17:04:36+09:00[Asia/Seoul]",
    ];

    for (const input of validInputs) {
      const result = parser.parse(input);
      assert.ok(result.success, `Failed to parse: ${input}`);
      assert.ok(result.value instanceof Temporal.ZonedDateTime);
    }
  });

  it("should reject invalid zoned datetime strings", () => {
    const invalidInputs = [
      "2020-01-23T17:04:36",
      "2020-01-23T17:04:36Z",
      "2020-01-23",
      "invalid",
      "",
    ];

    for (const input of invalidInputs) {
      const result = parser.parse(input);
      assert.ok(!result.success, `Should not parse: ${input}`);
    }
  });

  it("should format zoned datetime values correctly", () => {
    const zdt = Temporal.ZonedDateTime.from(
      "2020-01-23T17:04:36+01:00[Europe/Paris]",
    );
    const formatted = parser.format(zdt);
    assert.ok(formatted.includes("Europe/Paris"));
    assert.ok(formatted.includes("2020-01-23"));
  });
});

describe("plainDate", () => {
  const parser = plainDate();

  it("should have correct metavar", () => {
    assert.equal(parser.metavar, "DATE");
  });

  it("should parse valid date strings", () => {
    const validInputs = [
      "2020-01-23",
      "2020-12-31",
      "1970-01-01",
      "2000-02-29",
    ];

    for (const input of validInputs) {
      const result = parser.parse(input);
      assert.ok(result.success, `Failed to parse: ${input}`);
      assert.ok(result.value instanceof Temporal.PlainDate);
      assert.equal(result.value.toString(), input);
    }
  });

  it("should reject invalid date strings", () => {
    const invalidInputs = [
      "2020-13-01",
      "2020-01-32",
      "2020-01",
      "invalid",
      "",
      "2020/01/23",
    ];

    for (const input of invalidInputs) {
      const result = parser.parse(input);
      assert.ok(!result.success, `Should not parse: ${input}`);
    }
  });

  it("should format date values correctly", () => {
    const date = Temporal.PlainDate.from("2020-01-23");
    const formatted = parser.format(date);
    assert.equal(formatted, "2020-01-23");
  });
});

describe("plainTime", () => {
  const parser = plainTime();

  it("should have correct metavar", () => {
    assert.equal(parser.metavar, "TIME");
  });

  it("should parse valid time strings", () => {
    const validInputs = [
      "17:04:36",
      "17:04:36.491865121",
      "00:00:00",
      "23:59:59",
      "12:30:45.123",
      "17:04", // Temporal accepts this format
    ];

    for (const input of validInputs) {
      const result = parser.parse(input);
      assert.ok(result.success, `Failed to parse: ${input}`);
      assert.ok(result.value instanceof Temporal.PlainTime);
    }
  });

  it("should reject invalid time strings", () => {
    const invalidInputs = [
      "25:04:36",
      "17:60:36",
      "invalid",
      "",
    ];

    for (const input of invalidInputs) {
      const result = parser.parse(input);
      assert.ok(!result.success, `Should not parse: ${input}`);
    }
  });

  it("should format time values correctly", () => {
    const time = Temporal.PlainTime.from("17:04:36");
    const formatted = parser.format(time);
    assert.equal(formatted, "17:04:36");
  });
});

describe("plainDateTime", () => {
  const parser = plainDateTime();

  it("should have correct metavar", () => {
    assert.equal(parser.metavar, "DATETIME");
  });

  it("should parse valid datetime strings", () => {
    const validInputs = [
      "2020-01-23T17:04:36",
      "2020-01-23T17:04:36.491865121",
      "2020-01-23T00:00:00",
      "2020-12-31T23:59:59",
      "2020-01-23", // Temporal accepts this format (converts to datetime with time 00:00:00)
    ];

    for (const input of validInputs) {
      const result = parser.parse(input);
      assert.ok(result.success, `Failed to parse: ${input}`);
      assert.ok(result.value instanceof Temporal.PlainDateTime);
    }
  });

  it("should reject invalid datetime strings", () => {
    const invalidInputs = [
      "2020-01-23T25:04:36",
      "2020-13-23T17:04:36",
      "invalid",
      "",
    ];

    for (const input of invalidInputs) {
      const result = parser.parse(input);
      assert.ok(!result.success, `Should not parse: ${input}`);
    }
  });

  it("should format datetime values correctly", () => {
    const dateTime = Temporal.PlainDateTime.from("2020-01-23T17:04:36");
    const formatted = parser.format(dateTime);
    assert.equal(formatted, "2020-01-23T17:04:36");
  });
});

describe("plainYearMonth", () => {
  const parser = plainYearMonth();

  it("should have correct metavar", () => {
    assert.equal(parser.metavar, "YEAR-MONTH");
  });

  it("should parse valid year-month strings", () => {
    const validInputs = [
      "2020-01",
      "2020-12",
      "1970-01",
      "2000-02",
    ];

    for (const input of validInputs) {
      const result = parser.parse(input);
      assert.ok(result.success, `Failed to parse: ${input}`);
      assert.ok(result.value instanceof Temporal.PlainYearMonth);
      assert.equal(result.value.toString(), input);
    }
  });

  it("should reject invalid year-month strings", () => {
    const invalidInputs = [
      "2020-13",
      "2020-00",
      "2020",
      "invalid",
      "",
      "2020/01",
    ];

    for (const input of invalidInputs) {
      const result = parser.parse(input);
      assert.ok(!result.success, `Should not parse: ${input}`);
    }
  });

  it("should format year-month values correctly", () => {
    const yearMonth = Temporal.PlainYearMonth.from("2020-01");
    const formatted = parser.format(yearMonth);
    assert.equal(formatted, "2020-01");
  });
});

describe("plainMonthDay", () => {
  const parser = plainMonthDay();

  it("should have correct metavar", () => {
    assert.equal(parser.metavar, "--MONTH-DAY");
  });

  it("should parse valid month-day strings", () => {
    const validInputs = [
      "--01-23",
      "--12-31",
      "--02-29",
      "--06-15",
    ];

    for (const input of validInputs) {
      const result = parser.parse(input);
      assert.ok(result.success, `Failed to parse: ${input}`);
      assert.ok(result.value instanceof Temporal.PlainMonthDay);
    }
  });

  it("should reject invalid month-day strings", () => {
    const invalidInputs = [
      "--13-01",
      "--01-32",
      "--00-15",
      "invalid",
      "",
    ];

    for (const input of invalidInputs) {
      const result = parser.parse(input);
      assert.ok(!result.success, `Should not parse: ${input}`);
    }
  });

  it("should format month-day values correctly", () => {
    const monthDay = Temporal.PlainMonthDay.from("--01-23");
    const formatted = parser.format(monthDay);
    assert.equal(formatted, "01-23");
  });
});

describe("timeZone", () => {
  const parser = timeZone();

  it("should have correct metavar", () => {
    assert.equal(parser.metavar, "TIMEZONE");
  });

  it("should parse valid timezone identifiers", () => {
    const validInputs: TimeZone[] = [
      "Asia/Seoul",
      "America/New_York",
      "Europe/London",
      "UTC",
      "Etc/GMT+5",
      "America/Argentina/Buenos_Aires",
      "America/Kentucky/Louisville",
    ];

    for (const input of validInputs) {
      const result = parser.parse(input);
      assert.ok(result.success, `Failed to parse: ${input}`);
      assert.equal(result.value, input);
    }
  });

  it("should reject invalid timezone identifiers", () => {
    const invalidInputs = [
      "seoul",
      "Asia",
      "Asia/",
      "/Seoul",
      "invalid",
      "",
      "Asia Seoul",
      "123/456",
    ];

    for (const input of invalidInputs) {
      const result = parser.parse(input);
      assert.ok(!result.success, `Should not parse: ${input}`);
    }
  });

  it("should format timezone values correctly", () => {
    const timezone: TimeZone = "Asia/Seoul";
    const formatted = parser.format(timezone);
    assert.equal(formatted, "Asia/Seoul");
  });

  it("should support custom metavar", () => {
    const customParser = timeZone({ metavar: "TZ" });
    assert.equal(customParser.metavar, "TZ");
  });
});

describe("error customization", () => {
  describe("instant parser", () => {
    it("should use custom invalidFormat error message", () => {
      const parser = instant({
        errors: {
          invalidFormat: message`Please provide a valid timestamp.`,
        },
      });

      const result = parser.parse("invalid-instant");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Please provide a valid timestamp." },
      ]);
    });

    it("should use function-based invalidFormat error message", () => {
      const parser = instant({
        errors: {
          invalidFormat: (input) =>
            message`${input} is not a valid ISO 8601 instant.`,
        },
      });

      const result = parser.parse("bad-timestamp");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "value", value: "bad-timestamp" },
        { type: "text", text: " is not a valid ISO 8601 instant." },
      ]);
    });
  });

  describe("duration parser", () => {
    it("should use custom invalidFormat error message", () => {
      const parser = duration({
        errors: {
          invalidFormat: message`Duration must be in ISO 8601 format.`,
        },
      });

      const result = parser.parse("not-a-duration");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Duration must be in ISO 8601 format." },
      ]);
    });

    it("should use function-based invalidFormat error message", () => {
      const parser = duration({
        errors: {
          invalidFormat: (input) =>
            message`${input} is not a valid duration format like PT1H30M.`,
        },
      });

      const result = parser.parse("invalid");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "value", value: "invalid" },
        { type: "text", text: " is not a valid duration format like PT1H30M." },
      ]);
    });
  });

  describe("zonedDateTime parser", () => {
    it("should use custom invalidFormat error message", () => {
      const parser = zonedDateTime({
        errors: {
          invalidFormat: message`Invalid zoned datetime format.`,
        },
      });

      const result = parser.parse("bad-datetime");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Invalid zoned datetime format." },
      ]);
    });
  });

  describe("plainDate parser", () => {
    it("should use custom invalidFormat error message", () => {
      const parser = plainDate({
        errors: {
          invalidFormat: message`Date must be in YYYY-MM-DD format.`,
        },
      });

      const result = parser.parse("invalid-date");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Date must be in YYYY-MM-DD format." },
      ]);
    });
  });

  describe("plainTime parser", () => {
    it("should use custom invalidFormat error message", () => {
      const parser = plainTime({
        errors: {
          invalidFormat: message`Time must be in HH:MM:SS format.`,
        },
      });

      const result = parser.parse("bad-time");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Time must be in HH:MM:SS format." },
      ]);
    });
  });

  describe("plainDateTime parser", () => {
    it("should use custom invalidFormat error message", () => {
      const parser = plainDateTime({
        errors: {
          invalidFormat: message`DateTime must be in ISO format.`,
        },
      });

      const result = parser.parse("invalid-datetime");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "DateTime must be in ISO format." },
      ]);
    });
  });

  describe("plainYearMonth parser", () => {
    it("should use custom invalidFormat error message", () => {
      const parser = plainYearMonth({
        errors: {
          invalidFormat: message`Year-month must be in YYYY-MM format.`,
        },
      });

      const result = parser.parse("invalid-ym");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Year-month must be in YYYY-MM format." },
      ]);
    });
  });

  describe("plainMonthDay parser", () => {
    it("should use custom invalidFormat error message", () => {
      const parser = plainMonthDay({
        errors: {
          invalidFormat: message`Month-day must be in --MM-DD format.`,
        },
      });

      const result = parser.parse("invalid-md");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Month-day must be in --MM-DD format." },
      ]);
    });
  });

  describe("timeZone parser", () => {
    it("should use custom invalidFormat error message", () => {
      const parser = timeZone({
        errors: {
          invalidFormat: message`Invalid timezone identifier.`,
        },
      });

      const result = parser.parse("Invalid/Timezone");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "text", text: "Invalid timezone identifier." },
      ]);
    });

    it("should use function-based invalidFormat error message", () => {
      const parser = timeZone({
        errors: {
          invalidFormat: (input) =>
            message`${input} is not a valid IANA timezone identifier.`,
        },
      });

      const result = parser.parse("Bad/Zone");
      assert.ok(!result.success);
      assert.deepEqual(result.error, [
        { type: "value", value: "Bad/Zone" },
        { type: "text", text: " is not a valid IANA timezone identifier." },
      ]);
    });
  });

  describe("error fallback behavior", () => {
    it("should fall back to default error when custom error is not provided", () => {
      const parser = instant(); // No errors customization

      const result = parser.parse("invalid-instant");
      assert.ok(!result.success);
      // Should use default error message
      assert.ok(
        result.error.some((term) =>
          term.type === "text" && term.text.includes("Invalid instant")
        ),
      );
    });

    it("should work correctly when errors option is provided but specific error is not", () => {
      const parser = instant({
        errors: {
          // No invalidFormat specified, should use default
        },
      });

      const result = parser.parse("bad-instant");
      assert.ok(!result.success);
      // Should use default error message
      assert.ok(
        result.error.some((term) =>
          term.type === "text" && term.text.includes("Invalid instant")
        ),
      );
    });
  });
});

describe("metavar validation", () => {
  it("should throw TypeError when instant() receives empty metavar", () => {
    assert.throws(
      () => instant({ metavar: "" as unknown as NonEmptyString }),
      {
        name: "TypeError",
        message: "Expected a non-empty string.",
      },
    );
  });

  it("should throw TypeError when duration() receives empty metavar", () => {
    assert.throws(
      () => duration({ metavar: "" as unknown as NonEmptyString }),
      {
        name: "TypeError",
        message: "Expected a non-empty string.",
      },
    );
  });

  it("should throw TypeError when zonedDateTime() receives empty metavar", () => {
    assert.throws(
      () => zonedDateTime({ metavar: "" as unknown as NonEmptyString }),
      {
        name: "TypeError",
        message: "Expected a non-empty string.",
      },
    );
  });

  it("should throw TypeError when plainDate() receives empty metavar", () => {
    assert.throws(
      () => plainDate({ metavar: "" as unknown as NonEmptyString }),
      {
        name: "TypeError",
        message: "Expected a non-empty string.",
      },
    );
  });

  it("should throw TypeError when plainTime() receives empty metavar", () => {
    assert.throws(
      () => plainTime({ metavar: "" as unknown as NonEmptyString }),
      {
        name: "TypeError",
        message: "Expected a non-empty string.",
      },
    );
  });

  it("should throw TypeError when plainDateTime() receives empty metavar", () => {
    assert.throws(
      () => plainDateTime({ metavar: "" as unknown as NonEmptyString }),
      {
        name: "TypeError",
        message: "Expected a non-empty string.",
      },
    );
  });

  it("should throw TypeError when plainYearMonth() receives empty metavar", () => {
    assert.throws(
      () => plainYearMonth({ metavar: "" as unknown as NonEmptyString }),
      {
        name: "TypeError",
        message: "Expected a non-empty string.",
      },
    );
  });

  it("should throw TypeError when plainMonthDay() receives empty metavar", () => {
    assert.throws(
      () => plainMonthDay({ metavar: "" as unknown as NonEmptyString }),
      {
        name: "TypeError",
        message: "Expected a non-empty string.",
      },
    );
  });

  it("should throw TypeError when timeZone() receives empty metavar", () => {
    assert.throws(
      () => timeZone({ metavar: "" as unknown as NonEmptyString }),
      {
        name: "TypeError",
        message: "Expected a non-empty string.",
      },
    );
  });
});

describe("ValueParser suggest() methods", () => {
  describe("timeZone parser", () => {
    it("should suggest common timezones with matching prefix", () => {
      const parser = timeZone();

      const suggestions = Array.from(parser.suggest!("Asia/"));
      const texts = suggestions.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      );

      assert.ok(texts.includes("Asia/Tokyo"));
      assert.ok(texts.includes("Asia/Seoul"));
      assert.ok(texts.includes("Asia/Shanghai"));
      assert.ok(!texts.includes("Europe/London"));
    });

    it("should suggest UTC and GMT", () => {
      const parser = timeZone();

      const utcSuggestions = Array.from(parser.suggest!("UTC"));
      const utcTexts = utcSuggestions.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      );
      assert.ok(utcTexts.includes("UTC"));

      const gmtSuggestions = Array.from(parser.suggest!("GMT"));
      const gmtTexts = gmtSuggestions.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      );
      assert.ok(gmtTexts.includes("GMT"));
    });

    it("should handle case insensitive matching", () => {
      const parser = timeZone();

      const suggestions = Array.from(parser.suggest!("america/"));
      const texts = suggestions.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      );

      assert.ok(texts.length > 0);
      assert.ok(texts.some((t) => t.startsWith("America/")));
    });

    it("should suggest European timezones", () => {
      const parser = timeZone();

      const suggestions = Array.from(parser.suggest!("Europe/"));
      const texts = suggestions.map((s) =>
        s.kind === "literal" ? s.text : s.pattern || ""
      );

      assert.ok(texts.includes("Europe/London"));
      assert.ok(texts.includes("Europe/Paris"));
      assert.ok(texts.includes("Europe/Berlin"));
    });

    it("should return empty for non-matching prefix", () => {
      const parser = timeZone();

      const suggestions = Array.from(parser.suggest!("Invalid/"));
      assert.equal(suggestions.length, 0);
    });
  });
});

// =============================================================================
// Async Mode Integration Tests
// =============================================================================

describe("async mode integration", () => {
  // Helper: Create an async value parser for testing
  function asyncString(): ValueParser<"async", string> {
    return {
      $mode: "async",
      metavar: "ASYNC_STRING" as NonEmptyString,
      async parse(input: string): Promise<ValueParserResult<string>> {
        // Simulate async operation
        await new Promise((resolve) => setTimeout(resolve, 1));
        return { success: true, value: input.toUpperCase() };
      },
      format(value: string): string {
        return value;
      },
    };
  }

  describe("temporal parsers with async parsers", () => {
    it("should have sync $mode on all temporal parsers", () => {
      assert.equal(instant().$mode, "sync");
      assert.equal(duration().$mode, "sync");
      assert.equal(zonedDateTime().$mode, "sync");
      assert.equal(plainDate().$mode, "sync");
      assert.equal(plainTime().$mode, "sync");
      assert.equal(plainDateTime().$mode, "sync");
      assert.equal(plainYearMonth().$mode, "sync");
      assert.equal(plainMonthDay().$mode, "sync");
      assert.equal(timeZone().$mode, "sync");
    });

    it("should propagate async mode when combined with async parser", () => {
      const parser = object({
        date: option("--date", plainDate()),
        name: argument(asyncString()),
      });

      assert.equal(parser.$mode, "async");
    });

    it("should remain sync when all parsers are temporal", () => {
      const parser = object({
        date: option("--date", plainDate()),
        time: option("--time", plainTime()),
        timezone: option("--tz", timeZone()),
      });

      assert.equal(parser.$mode, "sync");
    });

    it("should parse temporal with sync when no async parsers", () => {
      const parser = object({
        start: option("--start", plainDate()),
        end: option("--end", plainDate()),
      });

      const result = parseSync(parser, [
        "--start",
        "2024-01-15",
        "--end",
        "2024-12-31",
      ]);

      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
      if (result.success) {
        assert.ok(result.value.start instanceof Temporal.PlainDate);
        assert.ok(result.value.end instanceof Temporal.PlainDate);
        assert.equal(result.value.start.toString(), "2024-01-15");
        assert.equal(result.value.end.toString(), "2024-12-31");
      }
    });

    it("should parse mixed temporal/async with parseAsync", async () => {
      const parser = object({
        date: option("--date", plainDate()),
        name: argument(asyncString()),
      });

      const result = await parseAsync(parser, [
        "--date",
        "2024-06-15",
        "test-user",
      ]);

      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
      if (result.success) {
        assert.ok(result.value.date instanceof Temporal.PlainDate);
        assert.equal(result.value.date.toString(), "2024-06-15");
        assert.equal(result.value.name, "TEST-USER"); // Uppercased by asyncString
      }
    });

    it("should parse multiple temporal types with async", async () => {
      const parser = object({
        date: option("--date", plainDate()),
        time: option("--time", plainTime()),
        timezone: option("--tz", timeZone()),
        label: argument(asyncString()),
      });

      const result = await parseAsync(parser, [
        "--date",
        "2024-06-15",
        "--time",
        "14:30:00",
        "--tz",
        "America/New_York",
        "event-label",
      ]);

      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
      if (result.success) {
        assert.ok(result.value.date instanceof Temporal.PlainDate);
        assert.ok(result.value.time instanceof Temporal.PlainTime);
        assert.equal(result.value.timezone, "America/New_York");
        assert.equal(result.value.label, "EVENT-LABEL");
      }
    });

    it("should handle temporal parsing errors with async", async () => {
      const parser = object({
        date: option("--date", plainDate()),
        name: argument(asyncString()),
      });

      const result = await parseAsync(parser, [
        "--date",
        "invalid-date",
        "test-user",
      ]);

      assert.ok(!result.success, "Expected failure for invalid date");
    });

    it("should work with instant and duration", async () => {
      const parser = object({
        timestamp: option("--at", instant()),
        timeout: option("--timeout", duration()),
        name: argument(asyncString()),
      });

      const result = await parseAsync(parser, [
        "--at",
        "2024-06-15T12:00:00Z",
        "--timeout",
        "PT1H30M",
        "task-name",
      ]);

      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
      if (result.success) {
        assert.ok(result.value.timestamp instanceof Temporal.Instant);
        assert.ok(result.value.timeout instanceof Temporal.Duration);
        assert.equal(result.value.name, "TASK-NAME");
      }
    });

    it("should work with zonedDateTime", async () => {
      const parser = object({
        event: option("--event", zonedDateTime()),
        organizer: argument(asyncString()),
      });

      const result = await parseAsync(parser, [
        "--event",
        "2024-06-15T12:00:00[America/New_York]",
        "john-doe",
      ]);

      assert.ok(result.success, `Expected success: ${JSON.stringify(result)}`);
      if (result.success) {
        assert.ok(result.value.event instanceof Temporal.ZonedDateTime);
        assert.equal(result.value.organizer, "JOHN-DOE");
      }
    });
  });
});
