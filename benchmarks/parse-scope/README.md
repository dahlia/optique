Option-scope parse benchmark
============================

This reproduces the Git-shaped parser and 1,000-path workload from
[issue 1120]. It measures `parseSync()` throughput, with and without `--`
before the paths. Imports, parser construction, result assertions and hashing
run outside the timer. It does not measure process startup or installation.

[issue 1120]: https://github.com/dahlia/optique/issues/1120


Preparing the comparison
------------------------

Run the following from the checkout root *before* changing the parser. Save the
original build so the same working tree can compare it with the fix:

~~~~ bash
mise run build
mkdir -p tmp/parse-scope/packages/before
cp -R packages/core/dist tmp/parse-scope/packages/before/dist
cp packages/core/package.json tmp/parse-scope/packages/before/package.json
mkdir -p tmp/parse-scope/packages/1.3.6
curl -fsSL https://registry.npmjs.org/@optique/core/-/core-1.3.6.tgz \
  -o tmp/parse-scope/packages/1.3.6/core.tgz
tar -xzf tmp/parse-scope/packages/1.3.6/core.tgz \
  -C tmp/parse-scope/packages/1.3.6
~~~~

The *before* directory must be new; keep it intact when rebuilding the fixed
parser. After making the change:

~~~~ bash
mise run build
node benchmarks/parse-scope/option-scope.mjs
~~~~

The driver runs seven rounds for each input shape, rotating the order of
`stable` (the published 1.3.6 release), `before` and `fixed` between rounds.
Each observation uses a fresh Node.js process, two warmup parses and seven
timed parses. Full returned paths are asserted, and the full-result SHA-256
must match across every version and input shape. A fingerprint of each built
JavaScript tree identifies the actual input, including uncommitted builds. Raw
samples, host information, build fingerprints and summaries are written to
*tmp/parse-scope/runs.json*.

Each summary row reports the median of the process medians and the median,
minimum and maximum ratios against `stable` in the same round. Use a quiet host
for timing; results from shared hosts are informational. There is no timing
threshold in the correctness tests. `ROUNDS`, `WARMUPS`, `SAMPLES` and `PATHS`
can shorten a behavior check:

~~~~ bash
ROUNDS=1 WARMUPS=0 SAMPLES=1 PATHS=10 \
  node benchmarks/parse-scope/option-scope.mjs
~~~~


Single-version runs and profiling
---------------------------------

Pass a package root and `separator` or `plain` to measure one version. Package
paths are relative to the checkout root; absolute paths work too. An optional
third argument overrides the path count:

~~~~ bash
node benchmarks/parse-scope/option-scope.mjs packages/core separator
node benchmarks/parse-scope/option-scope.mjs packages/core plain 1000
WARMUPS=5 SAMPLES=40 node --cpu-prof --cpu-prof-dir=tmp \
  --cpu-prof-name=fixed.cpuprofile \
  benchmarks/parse-scope/option-scope.mjs packages/core separator
~~~~

Collect profiles separately from timing comparisons. Recording parsed inputs
still copies a `Map` on each trace update. That pre-existing cost is outside
this change.
