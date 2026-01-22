---
description: >-
  Learn how to generate Unix man pages from your CLI application using
  Optique's man page generator. Covers man page format, customization
  options, and integration patterns.
---

Man pages
=========

*This API is available since Optique 0.10.0.*

Man pages are the traditional Unix documentation format, providing offline
help that users can access with the `man` command. Optique can generate
man pages directly from your parser definitions, ensuring documentation
stays synchronized with your CLI's actual behavior.

The *@optique/man* package generates man pages in the standard man(7) roff
format, compatible with `groff`, `mandoc`, and other man page processors.


Installation
------------

::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/man
~~~~

~~~~ bash [npm]
npm add @optique/man
~~~~

~~~~ bash [pnpm]
pnpm add @optique/man
~~~~

~~~~ bash [Yarn]
yarn add @optique/man
~~~~

~~~~ bash [Bun]
bun add @optique/man
~~~~

:::


Basic usage
-----------

The `generateManPage()` function creates a man page from a parser:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { option, argument } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { generateManPage } from "@optique/man";

const parser = object({
  output: option("-o", "--output", string(), {
    description: message`Output file path.`,
  }),
  verbose: option("-v", "--verbose", {
    description: message`Enable verbose output.`,
  }),
  input: argument(string({ metavar: "FILE" }), {
    description: message`Input file to process.`,
  }),
});

const manPage = generateManPage(parser, {
  name: "myapp",
  section: 1,
  date: "January 2026",
});

console.log(manPage);
~~~~

This generates a complete man page with NAME, SYNOPSIS, DESCRIPTION,
and OPTIONS sections.


Man page options
----------------

The `generateManPage()` function accepts several options to customize
the generated man page:

`name`
:   The program name displayed in the header and NAME section.
    This is required.

`section`
:   The manual section number (1-8). Section 1 is for user commands,
    which is typically what CLI applications use.

`date`
:   The date shown in the footer. Can be a string (e.g., `"January 2026"`)
    or a `Date` object. If omitted, no date is shown.

`version`
:   The version string shown in the footer (e.g., `"1.0.0"`).

`manual`
:   The manual title shown centered in the header. Defaults to
    `"User Commands"` for section 1.

`author`
:   Author information as a `Message` for the AUTHOR section.

`seeAlso`
:   An array of related manual page references for the SEE ALSO section.
    Each entry is an object with `name` and `section` properties.

`bugs`
:   A `Message` describing how to report bugs, shown in the BUGS section.

`examples`
:   A `Message` with usage examples, shown in the EXAMPLES section.


Complete example
----------------

Here's a more complete example showing all available options:

~~~~ typescript twoslash
import { object, or, merge } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { option, command, constant } from "@optique/core/primitives";
import { string, choice } from "@optique/core/valueparser";
import { generateManPage } from "@optique/man";

const globalOptions = object({
  config: option("-c", "--config", string(), {
    description: message`Path to configuration file.`,
  }),
  verbose: option("-v", "--verbose", {
    description: message`Enable verbose output.`,
  }),
});

const buildCmd = command(
  "build",
  object({
    mode: constant("build" as const),
    target: option("--target", choice(["dev", "prod"]), {
      description: message`Build target environment.`,
    }),
  }),
  {
    description: message`Build the project.`,
  }
);

const testCmd = command(
  "test",
  object({
    mode: constant("test" as const),
    watch: option("-w", "--watch", {
      description: message`Watch mode for continuous testing.`,
    }),
  }),
  {
    description: message`Run tests.`,
  }
);

const parser = merge(globalOptions, or(buildCmd, testCmd));

const manPage = generateManPage(parser, {
  name: "myapp",
  section: 1,
  date: new Date(2026, 0, 22),
  version: "2.0.0",
  manual: "MyApp Manual",
  author: message`Jane Developer <jane@example.com>`,
  seeAlso: [
    { name: "git", section: 1 },
    { name: "npm", section: 1 },
  ],
  bugs: message`Report bugs at https://github.com/example/myapp/issues`,
});
~~~~


Generated man page structure
----------------------------

The generated man page follows the standard structure:

### Header

The header line contains the program name, section number, date, source,
and manual title:

~~~~
.TH MYAPP 1 "January 2026" "MyApp 2.0.0" "MyApp Manual"
~~~~

### NAME section

Shows the program name and brief description:

~~~~
.SH NAME
myapp \- A powerful project management tool
~~~~

### SYNOPSIS section

Shows the usage pattern derived from your parser:

~~~~
.SH SYNOPSIS
.B myapp
[\fB\-c\fR \fICONFIG\fR]
[\fB\-v\fR]
.I COMMAND
~~~~

### DESCRIPTION section

If your parser has a description, it appears here. For commands with
subcommands, the available commands are listed.

### OPTIONS section

Lists all options with their descriptions:

~~~~
.SH OPTIONS
.TP
\fB\-c\fR, \fB\-\-config\fR \fICONFIG\fR
Path to configuration file
.TP
\fB\-v\fR, \fB\-\-verbose\fR
Enable verbose output
~~~~

### COMMANDS section

For parsers with subcommands, lists each command:

~~~~
.SH COMMANDS
.TP
\fBbuild\fR
Build the project
.TP
\fBtest\fR
Run tests
~~~~


Async parsers
-------------

For parsers that use async value parsers (like those from *@optique/git*),
use `generateManPageAsync()`:

~~~~ typescript twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { generateManPageAsync } from "@optique/man";

// Example with an async parser
const parser = object({
  name: option("--name", string()),
});

const manPage = await generateManPageAsync(parser, {
  name: "myapp",
  section: 1,
});
~~~~


Integration patterns
--------------------

### Writing to a file

Man pages are typically installed in system directories like
*/usr/local/share/man/man1/*:

~~~~ typescript twoslash
import { writeFileSync } from "node:fs";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { generateManPage } from "@optique/man";

const parser = object({
  name: option("--name", string()),
});

const manPage = generateManPage(parser, {
  name: "myapp",
  section: 1,
});

writeFileSync("myapp.1", manPage);
~~~~

### Build-time generation

You can generate man pages as part of your build process:

~~~~ typescript twoslash
// @filename: scripts/generate-man.ts
import { writeFileSync, mkdirSync } from "node:fs";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { generateManPage } from "@optique/man";

const parser = object({
  name: option("--name", string()),
});

mkdirSync("dist/man", { recursive: true });

const manPage = generateManPage(parser, {
  name: "myapp",
  section: 1,
  date: new Date(),
  version: process.env.npm_package_version,
});

writeFileSync("dist/man/myapp.1", manPage);
~~~~

### Runtime generation via subcommand

You can add a `man` subcommand to generate man pages on demand:

~~~~ typescript twoslash
import { object, or } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { command, constant, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { run } from "@optique/run";
import { generateManPage } from "@optique/man";

const mainCmd = command(
  "main",
  object({
    mode: constant("main" as const),
    name: option("--name", string()),
  }),
  { description: message`Main functionality.` }
);

const manCmd = command(
  "man",
  object({ mode: constant("man" as const) }),
  { description: message`Generate man page.` }
);

const parser = or(mainCmd, manCmd);

const result = run(parser);

if (result.mode === "man") {
  const manPage = generateManPage(parser, {
    name: "myapp",
    section: 1,
  });
  console.log(manPage);
}
~~~~


Roff formatting
---------------

The *@optique/man* package also exports low-level functions for working
with roff format if you need more control:

`escapeRoff(text)`
:   Escapes special roff characters in text (backslashes, line-initial
    `.` and `'`).

`escapeHyphens(text)`
:   Escapes hyphens to `\-` for option names, ensuring they render
    correctly and are copyable.

`formatMessageAsRoff(message)`
:   Converts an Optique `Message` to roff markup, with proper formatting
    for option names (bold), metavars (italic), and other components.

`formatDocPageAsMan(docPage, options)`
:   Converts a `DocPage` object to a complete man page. This is the
    mid-level API used by `generateManPage()`.


Viewing generated man pages
---------------------------

To preview a generated man page:

~~~~ bash
# Generate and view directly
myapp man | man -l -

# Or save and view
myapp man > myapp.1
man ./myapp.1

# View with groff (shows raw output)
groff -man -Tutf8 myapp.1
~~~~

<!-- cSpell: ignore myapp mandoc Tutf -->
