@optique/man
============

Man page generator for [Optique] CLI parsers.  This package generates Unix man
pages from Optique's structured parser metadata, enabling automatic
documentation generation that stays synchronized with your CLI's actual
behavior.

[Optique]: https://optique.dev/


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


Quick start
-----------

~~~~ typescript
import { generateManPage } from "@optique/man";
import { object, option, argument } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

const parser = object({
  port: option("-p", "--port", integer(), { description: "Port to listen on" }),
  host: option("-h", "--host", string(), { description: "Host to bind to" }),
});

const manPage = generateManPage(parser, {
  name: "myapp",
  section: 1,
  version: "1.0.0",
  date: new Date(),
});

console.log(manPage);
~~~~


API
---

### Low-level: Message to roff conversion

~~~~ typescript
import { formatMessageAsRoff, escapeRoff } from "@optique/man/roff";
import { message, optionName } from "@optique/core/message";

// Escape special roff characters
escapeRoff("Use .TH for title");  // "Use \\.TH for title"

// Convert Message to roff
const msg = message`Use ${optionName("--help")} for more info.`;
formatMessageAsRoff(msg);  // "Use \\fB\\-\\-help\\fR for more info."
~~~~

### Mid-level: DocPage to man page

~~~~ typescript
import { formatDocPageAsMan } from "@optique/man/man";
import type { DocPage } from "@optique/core/doc";

const manPage = formatDocPageAsMan(docPage, {
  name: "myapp",
  section: 1,
  version: "1.0.0",
  author: message`Hong Minhee`,
});
~~~~

### High-level: Parser to man page

~~~~ typescript
import { generateManPage } from "@optique/man";

const manPage = generateManPage(parser, {
  name: "myapp",
  section: 1,
  version: "1.0.0",
});
~~~~


Documentation
-------------

See the [Optique documentation] for more information.

[Optique documentation]: https://optique.dev/
