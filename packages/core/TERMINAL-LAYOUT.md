Terminal layout boundaries
==========================

This note records the internal layout contract behind the leaf themes in
[issue #907]. It does not introduce the recursive renderer planned in
[issue #908].

[issue #907]: https://github.com/dahlia/optique/issues/907
[issue #908]: https://github.com/dahlia/optique/issues/908


Usage tokens
------------

Program names and usage terms pass through the same token stream in
*src/usage.ts*. Semantic fragments become tokens, generated separators are
normalized, tokens wrap, and the result is serialized once. Layout does not
inspect ANSI strings to find a wrapping boundary.

A generated separator contributes one space between nonempty outputs on the
same physical line. Empty leaves cannot create a separator; hard breaks
supersede it. Wrapping may discard a generated separator, even when empty
styled leaves sit between it and the next visible token. Empty leaves still
carry their style/link transitions.

Custom fragment text survives wrapping, including space-only leaves and
trailing spaces. A leaf's physical line remains an indivisible atom, so an
atom wider than the available width can overflow. Explicit hard breaks are
preserved, including consecutive breaks.

The program separator carries a lookahead flag: when its following atom
cannot fit, it becomes a hard break before that atom is laid out. This keeps
legacy space-only literals and trailing program-name spaces intact. The flag
is consumed by the shared layout pass, not a separate program renderer.

There is one whitespace-trimming compatibility exception. Default formatter
output retains the old one-space trim at an automatic break, including the
colored/plain exception for styled option separators. For example, the default
`", "` separator loses its trailing space when wrapping plain output but
retains it in colored output. Do not generalize that rule to custom fragments.
*src/terminal-internal.ts* records default callback identity at role dispatch
and preserves it through theme caches. A custom callback owns its returned
fragment even when it calls `context.format()` internally.


Error messages and document assembly
------------------------------------

`renderErrorMessage()` in *src/message-renderer.ts* owns the error label,
conditional space, physical-line cursor, and one formatter invocation. It
validates the external offset before calling the theme. The label's final
line determines the message's `initialWidth`; a hard break resets the
external offset. Legacy `resetSuffix` is passed to label serialization as well
as built-in message rendering.

Callers retain their stream, quoting defaults, trailing newline, and exit
handling. The formatter receives the original `Message`; canonical errors
remain unthemed. Custom formatter output is opaque and appended unchanged.
An empty body may therefore leave the label's separator, and a body starting
with a hard break does not cause a second formatter call with a revised
width.

Document assembly still uses *src/text-layout.ts* for physical-line metrics
and annotation placement. Annotation breaks stay outside their ambient style;
that style is restored after opaque formatter output. These document-specific
rules are not usage separators and do not belong in the usage normalizer.


Regression coverage
-------------------

*src/terminal.test.ts* compares program/term and command/term composition over
empty, normal, multiline, and whitespace-only fragments; narrow, exact, and
unbounded widths; and styled/link output with colors on/off. It also checks
custom whitespace preservation and the legacy default separator bytes.
*src/usage.test.ts* and *src/doc.test.ts* retain the default-output goldens.

*src/message-renderer.test.ts* checks message identity, formatter options, and
single invocation across error-label shapes, external offsets, colors, and
opaque bodies. Runner tests cover synchronous/asynchronous failures and
completion errors. The printer tests in *../run/src/print.test.ts* cover stream
output and style restoration after a themed error label.
