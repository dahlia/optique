Repository tooling
==================

`mise check:type` checks owned TypeScript source, tests, inference fixtures,
scripts and build configurations without reading workspace distribution exports.
Private aliases belong to the importing package. Core also has a separate
program without Node.js ambient types. Documentation keeps its existing Twoslash
build and compiler check.

The routine checker uses `skipLibCheck: true`. This skips declaration internals,
including owned _.d.ts_ files; inventory inclusion does not validate those
internals. Known declaration contracts still constrain source consumers. The
tests separately check the Temporal bridge with `skipLibCheck: false` and verify
negative Temporal and parser-inference contracts. The bridge uses the actual
polyfill types and is excluded from Deno to avoid ambient-global leakage. The
compiler-API tests are Node.js-only: Bun crashed in the prototype's complete
compiler test run. Existing library Deno/Bun compatibility tests remain
required.

_lint-mapping.json_ records all 87 recommended Deno rules and their 72 Oxlint
counterparts. The mapping does not claim semantic equivalence between
counterparts.
`mise check:deno` retains the full recommended Deno lint set and Deno type
check. Unused Oxlint disable directives are errors. Existing inference
signatures and intentional asynchronous contracts use narrow comments rather
than rewrites.

`mise coverage` runs every existing Node.js test script directly under c8. It
requires built artifacts for archive/subprocess assertions, but redirects
workspace imports to source only for owned importers. Temporary consumers and
dependency/distribution imports retain normal resolution. The coverage-only
preload supplies the actual ESM Temporal polyfill without intercepting later
global assignments. Ordinary Node.js/Bun tests still use built artifacts.
Coverage does not repeat the docs script's compiler prefix; `mise test:node`
retains that mandatory check. Source LCOV and per-child JUnit reports are
validated under _coverage/_. `mise coverage:smoke` runs only the Temporal file.

Oxfmt is the active source formatting gate. `mise oxfmt:inventory` lists the
constrained JavaScript/TypeScript and JSON/JSONC file set.
`mise oxfmt:check` and `mise oxfmt:write` use that same inventory; do not use an
unrestricted `oxfmt .`. Original root/member exclusions remain, but Deno-only
Node.js tooling exclusions do not remove Node.js quality ownership. Markdown
stays with Hongdown/Sacho; TOML stays with mise. The measured configuration
preserves existing object wrapping and uses JSON width 1, without
import/package sorting, JSDoc rewriting or embedded-language formatting.
`mise check` and `mise dev` do not require Deno; compatibility checks remain
explicit.
