@optique/temporal
=================

Value parsers for [`Temporal`] date/time types. This package provides
`ValueParser` functions that can be used with *@optique/core* to parse
command-line arguments into `Temporal` objects like [`Temporal.Instant`],
[`Temporal.Duration`], [`Temporal.ZonedDateTime`], [`Temporal.PlainDate`],
and more.

This package requires that the `Temporal` global object is available. You may
need to use a polyfill like `@js-temporal/polyfill`.

[`Temporal`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal
[`Temporal.Instant`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Instant
[`Temporal.Duration`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/Duration
[`Temporal.ZonedDateTime`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/ZonedDateTime
[`Temporal.PlainDate`]: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Temporal/PlainDate


Installation
------------

~~~~ bash
deno add jsr:@optique/temporal jsr:@optique/run jsr:@optique/core
npm  add     @optique/temporal     @optique/run     @optique/core
pnpm add     @optique/temporal     @optique/run     @optique/core
yarn add     @optique/temporal     @optique/run     @optique/core
~~~~


Quick example
-------------

The following example uses the `plainDate()` value parser to accept a date in
`YYYY-MM-DD` format.

~~~~ typescript
import { run } from "@optique/run";
import { option } from "@optique/core/parser";
import { plainDate } from "@optique/temporal";

const cli = run({
  birthday: option("--birthday", plainDate()),
});

if (cli.birthday) {
  console.log(`Your next birthday is on ${cli.birthday.toLocaleString()}.`);
}
~~~~

Run it:

~~~~ bash
$ node cli.js --birthday 2024-12-25
Your next birthday is on 12/25/2024.
~~~~

For more resources, see the [docs] and the [*examples*](/examples/) directory.

[docs]: https://optique.dev/
