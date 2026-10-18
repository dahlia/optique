---
description: Generate one Markdown reference from supplied command pages or safe built-in documentation metadata.
---

Markdown command references
===========================

*Available since Optique 1.4.0.*

Import `formatCommandReference()` from *@optique/man/markdown* to produce one
file containing a linked contents list and a section for each command. It
accepts existing [`DocPage`](./runners.md) data with explicit canonical paths.
The renderer is a separate entry point and adds no Markdown dependency to
ordinary parser or runner imports.

~~~~ typescript twoslash
import { message } from "@optique/core/message";
import { formatCommandReference } from "@optique/man/markdown";

const reference = formatCommandReference([
  {
    path: [],
    page: {
      sections: [{
        title: "Commands",
        entries: [{ term: { type: "command", name: "serve" } }],
      }],
    },
  },
  {
    path: ["serve"],
    aliases: ["s"],
    page: {
      usage: [
        { type: "command", name: "serve" },
        { type: "optional", terms: [{
          type: "option", names: ["--port"], metavar: "PORT",
        }] },
      ],
      sections: [{ entries: [{
        term: { type: "option", names: ["--port"], metavar: "PORT" },
        description: message`Port to listen on.`,
        default: message`8080`,
      }] }],
    },
  },
], {
  name: "myapp",
  showAliases: true,
  coverage: {
    commands: "all-visible",
    help: "excluded",
    version: "excluded",
    completion: "excluded",
  },
});
~~~~

`path: []` identifies the root page. Other paths contain canonical command
names, excluding the executable name and positional values. A page's `usage`
already includes its command tokens. The renderer adds the executable name
once; it does not prepend the path again. If a shared option applies to a
descendant command, include it in that command's supplied page.

Supplied entries keep their order. A duplicate path throws `TypeError`, as does
an alias that resolves to two different commands under one parent. Different
parents can each have a child named `get`. Entry-level aliases and visibility
are authoritative when a parent page lists that command. `hiddenAliases` never
appear in the output, but participate in collision checks.

Descriptions, grouped inputs, defaults, choices, examples, and declared
environment names are rendered where present. A formatted default is
*documentation text*, not an evaluated or machine-readable default value.
Environment names do not cause variables to be read.


Declaring coverage
------------------

Every artifact prints its *author-declared* coverage. `commands: "all-visible"`
asserts that all visible commands in the declared scope have pages. The
renderer checks supplied prefixes and visible command-list references, but it
cannot discover commands omitted from every page. Use `"partial"` to retain
output with a visible report of missing referenced pages.

The three runner fields declare whether all configured forms of help, version,
and completion within that scope are documented. `"excluded"` prints “not
documented here (if configured).” The original parser does not include every
runner-added input. To declare `"included"`, supply their option entries and
pages for configured command forms yourself. Match the application's configured
names, aliases, arguments, and visibility; the renderer does not inspect runner
configuration.

The [runnable reference fixture] supplies `--help`, `--version`, and
`completion SHELL [ARG...]` for its runner configuration. It also includes the
application's `docs` command. Its maintained argument examples and build/runtime
outputs are tested on Deno, Node.js, and Bun.

[runnable reference fixture]: https://github.com/dahlia/optique/tree/main/packages/man/test/fixtures/markdown-reference


Collecting supported definitions
--------------------------------

For supported built-in definitions, the optional *@optique/core/doc-pages*
entry point constructs pages from core-owned metadata without parsing arguments:

~~~~ typescript twoslash
import { or } from "@optique/core/constructs";
import { collectDocPages } from "@optique/core/doc-pages";
import { withDefault } from "@optique/core/modifiers";
import { command, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { formatCommandReference } from "@optique/man/markdown";

const parser = or(
  command("serve", withDefault(option("--port", integer()), 8080)),
  command("inspect", option("--name", string())),
);
const collected = collectDocPages(parser);
const reference = formatCommandReference(collected.entries, {
  name: "myapp",
  coverage: {
    commands: "all-visible",
    help: "excluded",
    version: "excluded",
    completion: "excluded",
  },
});
~~~~

The supported constructor list is `command()`, `or()`, `object()`, `seq()`,
`option()`, `flag()`, `argument()`, `optional()`, `multiple()`, and
`withDefault()`. Static value metadata is available for `string()`, `integer()`,
and `choice()`. Other wrappers and custom parsers are opaque. Custom value
parsers retain only their enclosing primitive's names, description, and
metavariable captured during construction; their methods and getters are not
consulted during collection.

Collection does not call `parse()`, `complete()`, documentation methods,
normalization, validation, suggestion providers, or source resolvers. It does
not invoke handlers, lifecycle hooks, prompts, keyring access, network clients,
or environment/configuration loaders. Definitions may be synchronous or
asynchronous without resolving their runtime values.

Function defaults are omitted unless `withDefault()` supplies a documentation
`message`. This differs from ordinary help, which can evaluate a default thunk.
Static defaults use built-in formatting captured at construction. Defaults
that require normalization or unsupported formatting are omitted and reported.
Supply a documentation message when that omission is unsuitable.

A command after a required positional prefix keeps the prefix in its usage,
while its path contains only command tokens. Use `seq()` for ordered input;
`tuple()` and other unlisted constructors are outside this collector's scope.
Usage overrides affect presentation, not traversal. A functional `usageLine`
requires a supplied static page usage; it is never called by collection.

### Unsupported scopes and authored pages

Strict collection is the default. `DocPageCollectionError.result` contains the
partial pages and explicit unresolved scopes. Set `strict: false` to inspect
those pages and reports without throwing. A functional usage override leaves
that page's synopsis absent in partial output; report that omission when
publishing a partial reference rather than calling it complete. Pass the
result's `unresolved` array to the renderer's `unresolved` option with
`commands: "partial"` to include those omissions in the artifact.

~~~~ typescript twoslash
import type { DocPage } from "@optique/core/doc";
import { collectDocPages } from "@optique/core/doc-pages";
import type { Parser } from "@optique/core/parser";

declare const parser: Parser<"async", unknown, unknown>;
declare const rootPage: DocPage;
declare const childPage: DocPage;
// ---cut-before---
const collected = collectDocPages(parser, {
  entries: [
    { path: [], page: rootPage, coverage: "subtree" },
    { path: ["custom"], page: childPage },
  ],
});
~~~~

A supplied page replaces the automatic page at its exact path. Default
`coverage: "page"` resolves omissions in that page; it does not cover an opaque
subtree. `"subtree"` is the author's assertion that pages for all visible
descendants were supplied too. An opaque node's children cannot be enumerated,
so this assertion is not independently verified. Known incomplete descendant
pages still need authored replacements. Visible child references and
supplied prefixes still need matching pages. If several branches have the same
canonical path, supply authored pages. Positional values do not become command
path segments. A sequence with multiple children that contain commands reports
`ambiguous-command-path`; supply authored pages for that scope.

The collector reports the visible enclosing scope and reason for each
unsupported node. Documentation-hidden branches are skipped before these
checks. A supplied static usage is still required for each known functional
usage override; a broad subtree assertion does not evaluate or replace that
function.

See the [bounded prototype evidence] for the fixed fixture and callback checks.
This collector exports pages, not a versioned grammar schema or a custom
inspection protocol.

[bounded prototype evidence]: https://github.com/dahlia/optique/tree/main/packages/man/test/prototypes/markdown-collection


Build and runtime entry points
------------------------------

Keep definitions and authored pages in modules that start no application work.
A build script can import those pages and write the artifact:

~~~~ typescript twoslash
import { writeFileSync } from "node:fs";
import type { MarkdownCommandEntry } from "@optique/man/markdown";
import { formatCommandReference } from "@optique/man/markdown";

declare const pages: readonly MarkdownCommandEntry[];
// ---cut-before---
writeFileSync("REFERENCE.md", formatCommandReference(pages, {
  name: "myapp",
  coverage: {
    commands: "all-visible",
    help: "excluded",
    version: "excluded",
    completion: "excluded",
  },
}));
~~~~

Applications choose their own `docs` command or `--docs` option. The runnable
fixture parses its own `docs` command, then dynamically imports the renderer
and authored pages in that branch. Its ordinary command path prints parsed
example data; it starts no server and changes no settings. The fixture's
*build.ts* writes a file, while running *cli.ts* with `docs` writes the same
bytes to stdout.

~~~~ bash
mise deps
mise build
mise exec -- node packages/man/test/fixtures/markdown-reference/build.ts REFERENCE.md
mise exec -- node packages/man/test/fixtures/markdown-reference/cli.ts docs > REFERENCE.md
~~~~

Optique does not sandbox module imports or construction of supplied pages.
`getDocPageSync()`/`getDocPageAsync()` can parse navigation arguments, evaluate
defaults, and call custom documentation/formatting methods. If you use them to
construct explicit entries, those effects occur in application code before the
renderer receives the pages. Filesystem discovery also imports command modules,
whose top-level code may have effects. Export dedicated definitions/pages
without executable startup code.


Visibility, formatting, and anchors
-----------------------------------

The `hidden` values `true`, `"doc"`, and `"help"` hide sections and contents
entries, including supplied descendants of hidden parents. `"usage"` hides
synopsis terms only; those commands still have linked sections. A
collected command page keeps its selected command tokens in the synopsis,
matching contextual help. A
`"doc"`-hidden command may remain in a parent's code-formatted synopsis without
a section link. `showUsage` overrides a page's `showUsage`; otherwise the page
setting applies. Alias display uses a command-list `DocEntry.showAliases`
first, then the target entry's `showAliases`, then the renderer option. Hidden
aliases are always omitted.

Messages are escaped documentation text. Untrusted Markdown, HTML, link syntax,
backticks, and fence delimiters cannot add structure. URL message terms render
as inert code. A consumer may linkify bare web or email text according to its
own Markdown settings. Output has no timestamps or locale-dependent ordering.

Each explicit anchor is `optique-command.` followed by the lowercase hexadecimal
UTF-8 bytes of `JSON.stringify(path)`. Distinct valid paths have distinct IDs,
including paths that share a leaf name or contain delimiters. The dot keeps
these IDs separate from GitHub/VitePress heading slugs. Generated internal links
use owned HTML so VitePress preserves their exact destinations. Consumers must
allow raw HTML for these anchors and links; the full canonical headings remain
readable in consumers that strip HTML. Code spans and synopsis fences use
context-sized delimiters.
