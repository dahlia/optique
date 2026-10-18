Documentation-only collection experiment
========================================

The fixed oracle in *oracle.json* predates the collection attempt. It requires
nested canonical paths, inherited options, aliases and visibility, repeated
inputs, static defaults and choices, a required positional prefix, explicit
opaque-scope reports, and zero forbidden callback calls. The supported list is
ten parser constructors plus `string()`, `integer()`, and `choice()`.

The executable oracle is now maintained in
*packages/core/src/doc-pages-prototype.test.ts*. It wraps forbidden methods
before enclosing constructors can capture them, then resets counters and
poisons methods and accessors at the collection boundary. Custom async parsing,
formatting, normalization, validation, suggestions, documentation, default
thunks, and usage callbacks must remain uncalled. Construction and application
imports are outside that boundary.

*results.json* records the passing output, pages, reports, and counters from
Deno 2.9.7, Node.js 26.12.0, and Bun 1.3.14. All three produced SHA-256
`e056ce6ba3b508c39a52344fcc649c30a5e28b3034c3ce7db8a2c68b9eec44e4`.
The live implementation is the optional *@optique/core/doc-pages* entry point
and its private *internal/doc-metadata.ts* registry. No public `Parser`
interface or constructor outside the frozen list changed. Separate tests cover
strict failure, partial reports, authored page/subtree replacements,
visibility, section labels, and the ESM/CJS registry boundary.

Reproduce the current experiment from the repository root:

~~~~ bash
mise deps
mkdir -p tmp/issue-1025
OPTIQUE_DOC_PROTOTYPE_OUTPUT=tmp/issue-1025/prototype-results.json mise exec -- deno test --allow-read --allow-env --allow-write packages/core/src/doc-pages-prototype.test.ts
mise build
OPTIQUE_DOC_PROTOTYPE_OUTPUT=tmp/issue-1025/prototype-results.json mise exec -- node --test packages/core/src/doc-pages-prototype.test.ts
OPTIQUE_DOC_PROTOTYPE_OUTPUT=tmp/issue-1025/prototype-results.json mise exec -- bun test packages/core/src/doc-pages-prototype.test.ts
~~~~


Initial diagnostic attempt
--------------------------

*initial-results.json* and *initial-implementation.patch* preserve the first
attempt against base `c7a6d04d94c5c067e02d0a58857a590533528fd3`. It collected
paths and inputs without callbacks, but omitted value-parser registration and
failed static defaults, choices, and expected reports. Its result hash was
`f34ae9eb7357fc9af24a031e2850e37399c4a8607883f4144746b4f2448b4d11`.
The first attempt lacked the necessary value metadata. Adding constructor-owned
identity and immutable static value metadata for the three agreed built-ins
made the same oracle pass. Collection ships with separate tests for strict and
partial reports and authored replacements.

To inspect that historical failure, use a disposable checkout of the recorded
base, copy this directory to the same path, create *tmp/issue-1025/*, apply
*initial-implementation.patch*, and run the three commands for
*doc-pages-prototype.test.ts* above. The historical test writes its report to
*tmp/issue-1025/prototype-results.json* unconditionally; the current test writes
only when `OPTIQUE_DOC_PROTOTYPE_OUTPUT` is set. The patch is research evidence,
not an installation step for the shipped collector.
