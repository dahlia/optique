---
description: >-
  Parse ISO 8601 dates, times, durations, and time zones into Temporal API
  objects with full type safety and validation.
---

Temporal integration
====================

*This API is available since Optique 0.4.0.*

The *@optique/temporal* package provides value parsers for the [Temporal API],
a modern JavaScript proposal for working with dates and times. These parsers
offer type-safe parsing of various temporal values including instants,
durations, dates, times, and time zones.

::: code-group

~~~~ bash [Deno]
deno add --jsr @optique/temporal
~~~~

~~~~ bash [npm]
npm add @optique/temporal
~~~~

~~~~ bash [pnpm]
pnpm add @optique/temporal
~~~~

~~~~ bash [Yarn]
yarn add @optique/temporal
~~~~

~~~~ bash [Bun]
bun add @optique/temporal
~~~~

:::

[Temporal API]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal


`instant()` parser
------------------

The `instant()` parser validates ISO 8601 timestamp strings and returns
[`Temporal.Instant`] objects representing precise moments in time:

~~~~ typescript twoslash
import { instant } from "@optique/temporal";

// Basic instant parser
const timestamp = instant();

// Instant with custom metavar
const createdAt = instant({ metavar: "TIMESTAMP" });
~~~~

The parser accepts ISO 8601 strings with timezone information:

~~~~ typescript
// Valid instant formats
"2023-12-25T10:30:00Z"                    // UTC
"2023-12-25T10:30:00+09:00"              // With timezone offset
"2023-12-25T10:30:00.123456789Z"         // With nanosecond precision
"2023-12-25T10:30:00-05:00"              // Negative timezone offset
~~~~

[`Temporal.Instant`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Instant


`duration()` parser
-------------------

The `duration()` parser validates ISO 8601 duration strings and returns
[`Temporal.Duration`] objects for representing spans of time:

~~~~ typescript twoslash
import { duration } from "@optique/temporal";

// Basic duration parser
const timeout = duration();

// Duration with custom metavar
const interval = duration({ metavar: "INTERVAL" });
~~~~

The parser accepts ISO 8601 duration format:

~~~~ typescript
// Valid duration formats
"PT30M"           // 30 minutes
"P1D"             // 1 day
"PT1H30M"         // 1 hour 30 minutes
"P1Y2M3DT4H5M6S"  // 1 year, 2 months, 3 days, 4 hours, 5 minutes, 6 seconds
"PT0.123S"        // 123 milliseconds
~~~~

[`Temporal.Duration`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Duration


`zonedDateTime()` parser
------------------------

The `zonedDateTime()` parser validates ISO 8601 datetime strings with timezone
information and returns [`Temporal.ZonedDateTime`] objects:

~~~~ typescript twoslash
import { zonedDateTime } from "@optique/temporal";

// Basic zoned datetime parser
const appointment = zonedDateTime();

// Zoned datetime with custom metavar
const meetingTime = zonedDateTime({ metavar: "MEETING_TIME" });
~~~~

The parser accepts ISO 8601 strings with timezone identifiers or offsets:

~~~~ typescript
// Valid zoned datetime formats
"2023-12-25T10:30:00[Asia/Seoul]"         // With IANA timezone
"2023-12-25T10:30:00+09:00[Asia/Seoul]"   // With offset and timezone
"2023-12-25T10:30:00-05:00[America/New_York]" // Different timezone
~~~~

[`Temporal.ZonedDateTime`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/ZonedDateTime


`plainDate()` parser
--------------------

The `plainDate()` parser validates ISO 8601 date strings and returns
[`Temporal.PlainDate`] objects representing calendar dates without time
information:

~~~~ typescript twoslash
import { plainDate } from "@optique/temporal";

// Basic date parser
const birthDate = plainDate();

// Date with custom metavar
const deadline = plainDate({ metavar: "DEADLINE" });
~~~~

The parser accepts ISO 8601 date format:

~~~~ typescript
// Valid date formats
"2023-12-25"      // Basic date format
"2023-01-01"      // New Year's Day
"1999-12-31"      // Y2K eve
~~~~

[`Temporal.PlainDate`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainDate


`plainTime()` parser
--------------------

The `plainTime()` parser validates ISO 8601 time strings and returns
[`Temporal.PlainTime`] objects representing wall-clock time without date or
timezone:

~~~~ typescript twoslash
import { plainTime } from "@optique/temporal";

// Basic time parser
const startTime = plainTime();

// Time with custom metavar
const alarmTime = plainTime({ metavar: "ALARM_TIME" });
~~~~

The parser accepts ISO 8601 time format:

~~~~ typescript
// Valid time formats
"10:30:00"           // Hour, minute, second
"14:15"              // Hour, minute (seconds default to 00)
"09:30:00.123"       // With milliseconds
"23:59:59.999999999" // With nanosecond precision
~~~~

[`Temporal.PlainTime`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainTime


`plainDateTime()` parser
------------------------

The `plainDateTime()` parser validates ISO 8601 datetime strings without
timezone information and returns [`Temporal.PlainDateTime`] objects:

~~~~ typescript twoslash
import { plainDateTime } from "@optique/temporal";

// Basic datetime parser
const localTime = plainDateTime();

// Datetime with custom metavar
const eventTime = plainDateTime({ metavar: "EVENT_TIME" });
~~~~

The parser accepts ISO 8601 datetime format:

~~~~ typescript
// Valid datetime formats
"2023-12-25T10:30:00"       // Basic datetime
"2023-12-25T14:15"          // Without seconds
"2023-12-25T09:30:00.123"   // With milliseconds
"2023-12-25 10:30:00"       // Space separator (also valid)
~~~~

[`Temporal.PlainDateTime`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainDateTime


`plainYearMonth()` parser
-------------------------

The `plainYearMonth()` parser validates year-month strings and returns
[`Temporal.PlainYearMonth`] objects for representing specific months:

~~~~ typescript twoslash
import { plainYearMonth } from "@optique/temporal";

// Basic year-month parser
const reportMonth = plainYearMonth();

// Year-month with custom metavar
const billingPeriod = plainYearMonth({ metavar: "BILLING_PERIOD" });
~~~~

The parser accepts year-month format:

~~~~ typescript
// Valid year-month formats
"2023-12"         // December 2023
"2024-01"         // January 2024
"1999-06"         // June 1999
~~~~

[`Temporal.PlainYearMonth`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainYearMonth


`plainMonthDay()` parser
------------------------

The `plainMonthDay()` parser validates month-day strings and returns
[`Temporal.PlainMonthDay`] objects for representing recurring dates:

~~~~ typescript twoslash
import { plainMonthDay } from "@optique/temporal";

// Basic month-day parser
const birthday = plainMonthDay();

// Month-day with custom metavar
const holiday = plainMonthDay({ metavar: "HOLIDAY_DATE" });
~~~~

The parser accepts month-day format:

~~~~ typescript
// Valid month-day formats
"--12-25"         // Christmas (December 25)
"--01-01"         // New Year's Day (January 1)
"--07-04"         // Independence Day (July 4)
"--02-29"         // Leap day (February 29)
~~~~

[`Temporal.PlainMonthDay`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainMonthDay


`timeZone()` parser
-------------------

The `timeZone()` parser validates IANA Time Zone Database identifiers and returns
a branded `TimeZone` string type for type safety:

~~~~ typescript twoslash
import { timeZone } from "@optique/temporal";

// Basic timezone parser
const userTimezone = timeZone();

// Timezone with custom metavar
const displayTimezone = timeZone({ metavar: "DISPLAY_TZ" });
~~~~

The parser accepts valid IANA timezone identifiers:

~~~~ typescript
// Valid timezone identifiers
"UTC"                 // Coordinated Universal Time
"Asia/Seoul"          // South Korea
"America/New_York"    // Eastern Time (US)
"Europe/London"       // Greenwich Mean Time
"Australia/Sydney"    // Australian Eastern Time
"America/Los_Angeles" // Pacific Time (US)
"Asia/Tokyo"          // Japan Standard Time
~~~~


Error messages
--------------

All temporal parsers provide clear, specific error messages for different
validation failures:

~~~~ bash
$ myapp --timestamp "not-a-timestamp"
Error: Invalid instant format: not-a-timestamp. Expected ISO 8601 format like 2023-12-25T10:30:00Z.

$ myapp --duration "invalid-duration"
Error: Invalid duration format: invalid-duration. Expected ISO 8601 duration like PT30M or P1DT2H.

$ myapp --timezone "Invalid/Timezone"
Error: Invalid timezone identifier: Invalid/Timezone. Must be a valid IANA timezone like Asia/Seoul or UTC.
~~~~


Integration with Temporal API
-----------------------------

The temporal parsers return native Temporal objects with rich functionality:

~~~~ typescript twoslash
import { parse } from "@optique/core/parser";
import { argument } from "@optique/core/primitives";
import { instant, duration } from "@optique/temporal";
// ---cut-before---
const timestampArg = argument(instant());
const result = parse(timestampArg, ["2023-12-25T10:30:00Z"]);
if (result.success) {
  const instant = result.value;
  console.log(`Epoch milliseconds: ${instant.epochMilliseconds}`);
  console.log(`UTC string: ${instant.toString()}`);
  console.log(`In timezone: ${instant.toZonedDateTimeISO("Asia/Seoul")}`);
}

const timeoutArg = argument(duration());
const durationResult = parse(timeoutArg, ["PT1H30M"]);
if (durationResult.success) {
  const duration = durationResult.value;
  console.log(`Total seconds: ${duration.total("seconds")}`);
  console.log(`Hours: ${duration.hours}, Minutes: ${duration.minutes}`);
}
~~~~

The temporal parsers provide comprehensive date and time handling capabilities
with full type safety and integration with the modern Temporal API.

<!-- cSpell: ignore myapp -->
