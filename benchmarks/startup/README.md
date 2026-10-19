Startup and installation baselines
==================================

This harness measures a fresh process from spawn to exit, including module
loading, parsing, rendering, output through pipes, and process exit. It does
not measure parser throughput. Subtracting the empty-process result does not
isolate parser cost. The operating system's filesystem cache is not cleared.

The maintained baseline and CI smoke are verified on Linux.
The fixtures have no business I/O or network dependency. Node loads plain
JavaScript from release-shaped local npm tarballs; it does not strip TypeScript.
Bun reuses that installation. Deno loads checkout TypeScript through an explicit
import map. These deployment modes are recorded and should be compared
separately. Bundles and loading API changes belong to [issue #1084].

[issue #1084]: https://github.com/dahlia/optique/issues/1084


Run the measurements
--------------------

From a clean checkout, install the tools and development dependencies:

~~~~ bash
mise install
mise deps
mise run benchmark:test
mise run --jobs 1 benchmark:prepare
mise run benchmark:validate
mise run benchmark:smoke
mise run benchmark:baseline
~~~~

Use a quiet host for the full baseline. The last command runs the complete
matrix three times with 100 measured processes per case and five warmups. The
smoke uses three samples and one warmup. CI checks behavior and report structure
and uploads the bounded smoke report. It does not compare timing with a budget.

Preparation runs normal `pnpm pack` lifecycle scripts and production-only
installs into two isolated consumers. Every Optique dependency is overridden
with its local tarball. Lock entries must identify the correct archive and
SHA-512 integrity; installed files must match archive contents and remain inside
the consumer. The harness uses pnpm 11.28.6 with `packageImportMethod=copy`, an
owned store, an isolated linker, ignored install scripts and offline
installation. Harness tools, including its YAML parser, stay outside measured
installations.

Archives, store, caches, preparation commands, validation traces, *smoke.json*,
three *run-N.json* files and *spread.json* live under *tmp/startup-baseline/*.
Consumers live in a separate owned temporary directory, recorded in
*tmp/startup-baseline/consumer-root.json*. Preparation uses the system temporary
directory, falling back to */var/tmp*, and accepts a candidate only if neither
it nor any ancestor contains *node\_modules*. If both candidates fail that
check, preparation stops. Node and Bun therefore cannot find undeclared
dependencies in the checkout. Reusing a preparation checks those ancestors
again. Preparation recreates its local directory and its recorded external
consumer directory after checking their ownership markers. Inspect failures
before preparing again. No network acquisition happens during timing; Deno's
cached-only execution has no network permission and Bun auto-install is
disabled.

Reusing a preparation verifies a fingerprint of package/build inputs and
selected benchmark sources, including preparation logic, the manifest, fixtures
and goldens. After changing those inputs, rerun `benchmark:prepare` before
measuring. Generated reports, benchmark documentation and regression tests are
excluded, so updating them does not require preparing again.

The current baseline is under *results/*. Raw samples refer to exact captured
stdout/stderr in each report's output table. Commands preserve argument
boundaries and use `${REPO_ROOT}`, `${NODE_BIN}`, `${DENO_BIN}`, `${BUN_BIN}`,
`${PNPM_BIN}`, `${CONSUMERS_ROOT}` and corresponding `*_DIR` tokens. Set the
checkout root and the consumer root recorded in *consumer-root.json*. Resolve
each binary with `mise which`, and use its directory for the matching `*_DIR`
token.
`expandCommand()` in *contract.ts* performs this substitution without a shell.
Actual runtime versions, source revision and selected input hashes are recorded.
Historical source drift is informational; internal report inconsistency fails.

During a coordinated issue wave, reserve an exclusive measurement window before
running the full baseline, then hold both shared locks for its duration:

~~~~ bash
flock /path/to/issue-wave/heavy.lock \
  flock /path/to/issue-wave/measurement.lock \
  mise run benchmark:baseline
~~~~

Those machine-local locks coordinate this development wave, not benchmark
semantics. The harness does not detect or claim lock ownership; record the
actual coordination window separately. Other hosts should use their own process
coordination and record concurrent workload. Do not claim a quiet baseline from
a shared CI runner.


What is measured
----------------

*manifest.json* lists the package roots/subpaths, production consumers, request
arguments, statuses and expected discovery imports. The matrix includes:

 -  Node ESM empty and import-only processes; minimal help and dispatch;
    three-command and filesystem-discovery root/nested help, version, no-op
    dispatch, invalid option and Bash runtime completion for `st`.
 -  Node CJS three-command help and dispatch, plus root-package `require()`.
    CJS fixtures form an independent `require()` graph, checked against the ESM
    definitions and the same output goldens.
 -  Bun and Deno three-command help and dispatch.
 -  A separate Node prepopulated compile-cache series for three-command root
    help and dispatch. All other Node cases disable compile cache.

Measured order rotates the case list once per sampling round, with the complete
order retained. Median averages the middle pair for an even count; p95 uses
nearest rank, `ceil(0.95 * n)`. Reports with fewer than 100 samples withhold
p95. Every process, including warmups, must match exact checked-in output and
status. Signals, timeouts, excess output and malformed results fail validation.

Locale, time zone, color and width are fixed. Only explicit environment settings
reach children; user startup configuration and inherited Node options are
excluded. The Node cache probe verifies disabled and enabled modes before
sampling. Each run clears and repopulates only its owned Node cache. Deno's
transpile cache is prepared ahead of time; its V8 code cache is disabled. Bun's
owned transpiler cache applies only where Bun uses it, including sufficiently
large source files. None of these policies clears the kernel's filesystem cache.

Separate instrumented validation records module loads. It asserts today's eager
imports of all discovered command definitions and handler implementations for
every request, with dispatch output only on successful dispatch. Timing
processes never load the trace hook. Node checks loaded *node\_modules* paths
against the consumer and verifies packaged ESM/CJS resolution. Bun checks its
installed entry. Deno checks its source graph, including recognized builtins.
Module traces, downloaded bytes and installed bytes describe different things.


Installation accounting
-----------------------

The report inventories core/run and core/run/discover independently. Each
records the resolved production graph, unique package count, compressed archive
bytes, expanded regular-file archive bytes, installed apparent bytes and
allocated filesystem blocks. The package graph is exactly the listed Optique
packages; a new runtime dependency requires an explicit fixture/archiving
update.

Installed accounting follows *node\_modules* symlinks and deduplicates regular
files by resolved path. Links escaping that tree fail. It excludes pnpm's
*.modules.yaml*, *.pnpm/lock.yaml*, and
*.pnpm-workspace-state-v1.json*, and includes executable *.bin* shims.
The external store, development tools, consumer lockfiles and runtime caches
are separate trees. Allocated blocks are reported separately and do not prove
exclusive physical storage: hard links or filesystem clones may share blocks.
The filesystem type and link policy accompany every inventory.

Optique archive files are classified as ESM (*.js*/*.mjs*), CJS (*.cjs*),
declarations (*.d.ts*/*.d.cts*/*.d.mts*), or other. Declaration matching takes
precedence. These package-content totals exclude installed infrastructure
shims, which still contribute to installed bytes. Archive hashes prove the
contents measured; they are not download-volume estimates.


Update fixtures or baselines
----------------------------

Edit command definitions and *manifest.json* together. To review changed help
or errors, prepare, run `mise exec -- node benchmarks/startup/harness.ts audit`,
and inspect every changed golden. This explicit authoring command writes
candidate goldens; ordinary validation and measurement never update them.
Run unit tests and live validation before capturing another full baseline.

Preserve all three raw reports, the spread artifact and the interpretation in
*results/README.md*. Reports must share fixture/source/archive/lock/runtime
identities before their medians are compared. Explain observed variation using
the recorded host and load data, without inventing a performance guarantee.
Include any change to the measured library, build inputs, fixtures, goldens or
harness in a fresh capture. Input selection includes untracked selected files,
executable mode bits, inherited root license and package-local license
overrides; it excludes docs and the result artifacts themselves.

Hard performance budgets require a separately agreed host and repeatability
evidence. This baseline supplies evidence for that decision and for
[issue #1083].

[issue #1083]: https://github.com/dahlia/optique/issues/1083
