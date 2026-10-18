Recorded baseline
=================

These three captures use the same measured inputs, built archives, isolated
consumer inventories, locks and runtime versions. Each of the 32 cases has
100 measured fresh processes and five warmups per run. All 9,600 measured
processes and 480 warmups matched their exact output and exit-status goldens.
The separate three-sample smoke run does not report p95.

Reproduce the setup and commands in [the harness guide]. The raw
*run-1.json*, *run-2.json* and *run-3.json* retain samples, command arguments,
allowlisted environments, exact output tables, quantiles, case order, host
load, input hashes and installation inventories. *spread.json* retains
unrounded median spreads; *validation.json* records the separate loading
checks. Timing runs do not load the tracing hook.

[the harness guide]: ../README.md


Host and interpretation
-----------------------

Captured from 2026-10-18T18:52:43.253Z through
2026-10-18T19:08:23.841Z on Linux 7.2.9-200.fc44.x86\_64
(x64), AMD Ryzen 7 7700X 8-Core Processor, 16 logical CPUs.
The library revision was `6ba561db5b61d1d6e76f6d07f825650a6e5a7b00`; the
uncommitted harness and build-input contents are identified by the complete
input-selection list and SHA-256
`22fba717ea2e2cf5254b738273adb8da464efc002652c4e019f150797373cdcd`. The commit
containing these artifacts can therefore differ from that library revision
while still identifying exactly which bytes were measured.

Runtime versions were Node v26.12.0, Bun 1.3.14, pnpm 11.28.6, and
Deno 2.9.7 (stable, release, x86\_64-unknown-linux-gnu).
Node ESM/CJS and Bun use installed plain JavaScript. Deno loads checkout
TypeScript with cached dependencies and disabled V8 code cache; these are
distinct deployment modes, not directly interchangeable parser measurements.

The coordinator reserved this capture window and excluded this issue wave's
builds, tests and reviews that could run tests. The *heavy.lock* and
*measurement.lock* advisory locks were held throughout capture. Unrelated
machine activity was not controlled. *host-context.json* records the CPU
governor/driver and power preference before and after; per-run load averages
are retained in the raw reports. Fresh processes do not imply cold filesystem
caches.

| Run | Start                    | Load before (1/5/15 min) | Load after (1/5/15 min) |
| --- | ------------------------ | ------------------------ | ----------------------- |
| 1   | 2026-10-18T18:52:43.253Z | 5.80, 6.85, 10.45        | 24.21, 16.41, 13.42     |
| 2   | 2026-10-18T18:57:33.303Z | 24.21, 16.41, 13.42      | 22.23, 19.95, 15.88     |
| 3   | 2026-10-18T19:02:57.476Z | 22.23, 19.95, 15.88      | 21.36, 22.48, 18.34     |

| Case                                  | Median 1 ms | Median 2 ms | Median 3 ms |    p95 range ms | Median spread % |
| ------------------------------------- | ----------: | ----------: | ----------: | --------------: | --------------: |
| node-empty                            |      22.840 |      25.694 |      26.912 |   35.573–45.045 |           15.85 |
| node-import:@optique/core             |      76.751 |      84.862 |      80.875 |  95.022–114.875 |           10.03 |
| node-import:@optique/run              |      80.897 |      92.476 |      87.919 | 117.439–130.552 |           13.17 |
| node-import:@optique/discover         |      85.841 |      97.027 |      92.108 | 119.107–133.155 |           12.14 |
| node-import:@optique/core/constructs  |      64.022 |      67.828 |      65.095 |  86.278–100.855 |            5.85 |
| node-import:@optique/core/primitives  |      61.653 |      67.877 |      66.203 |   84.959–93.755 |            9.40 |
| node-import:@optique/core/modifiers   |      54.459 |      59.695 |      57.779 |   71.250–81.644 |            9.06 |
| node-import:@optique/core/valueparser |      45.535 |      50.454 |      50.409 |   62.552–63.972 |            9.76 |
| node-import:@optique/run/run          |      80.655 |      90.103 |      88.584 | 102.783–122.219 |           10.67 |
| node-minimal-help                     |      93.074 |     104.377 |      99.378 | 124.008–145.713 |           11.37 |
| node-minimal-dispatch                 |      87.708 |      96.691 |      99.385 | 116.377–129.294 |           12.08 |
| node-three-root-help                  |     100.423 |     109.661 |     107.484 | 137.065–153.746 |            8.59 |
| node-three-nested-help                |     104.938 |     118.464 |     111.218 | 136.091–160.308 |           12.16 |
| node-three-version                    |      90.924 |     101.089 |     101.070 | 129.559–138.967 |           10.06 |
| node-three-dispatch                   |      93.847 |     105.614 |     102.691 | 122.977–155.925 |           11.46 |
| node-three-invalid                    |      95.818 |     111.472 |     105.904 | 123.970–157.366 |           14.78 |
| node-three-completion                 |      89.607 |     102.746 |      98.604 | 121.516–144.306 |           13.33 |
| node-discovery-root-help              |     109.769 |     121.927 |     122.265 | 146.138–175.719 |           10.25 |
| node-discovery-nested-help            |     111.289 |     123.933 |     124.498 | 148.515–176.897 |           10.66 |
| node-discovery-version                |      99.677 |     111.483 |     111.020 | 134.209–167.033 |           10.63 |
| node-discovery-dispatch               |     103.382 |     116.366 |     113.205 | 135.038–172.563 |           11.47 |
| node-discovery-invalid                |     105.752 |     116.151 |     113.756 | 130.021–160.612 |            9.14 |
| node-discovery-completion             |     101.880 |     111.105 |     109.555 | 133.209–158.088 |            8.42 |
| cjs-three-root-help                   |      83.900 |      93.660 |      92.696 | 119.804–124.018 |           10.53 |
| bun-three-root-help                   |      68.366 |      80.333 |      77.667 | 102.869–120.227 |           15.41 |
| deno-three-root-help                  |     119.450 |     131.069 |     128.422 | 156.092–188.613 |            9.05 |
| node-cache-three-root-help            |      90.139 |      98.919 |      95.336 | 124.847–127.361 |            9.21 |
| cjs-three-dispatch                    |      82.987 |      90.153 |      88.976 | 104.882–122.602 |            8.05 |
| bun-three-dispatch                    |      62.465 |      68.347 |      65.861 |  83.998–106.343 |            8.93 |
| deno-three-dispatch                   |     116.852 |     131.230 |     129.837 | 164.596–247.733 |           11.07 |
| node-cache-three-dispatch             |      85.716 |      92.978 |      93.589 | 116.235–123.935 |            8.47 |
| cjs-import:@optique/core              |      61.877 |      67.646 |      65.912 |   81.851–99.692 |            8.75 |

Median spread, defined as the range of the three run medians divided by
their middle value,
ranged from 5.85% (node-import:@optique/core/constructs) to
15.85% (node-empty).
These are whole-process wall times. Within each run, cases were interleaved
rather than executed in blocks. Interleaving reduces systematic case-order
effects but does not remove scheduler noise, frequency changes or shared-host
activity. Load and power context describe the conditions; three runs cannot
establish a causal explanation for individual differences. Across the three
runs, 5 case medians strictly increased, 0 strictly decreased, and 27 were
mixed or unchanged. The available CPU power settings matched at the window
endpoints. The observed spread is why this initial baseline supplies no hard
regression budget. Subtracting the empty case would not isolate parser cost.


Installation
------------

Both production consumers used pnpm's copy import method and isolated linker.
All Optique dependencies resolved to harness-generated local tarballs, with
lock SHA-512 integrity verified against archive bytes. Installed contents were
rechecked before capture; no package resolves to a workspace link. Files are
deduplicated by real path, with pnpm metadata, lockfiles and external store
excluded. Executable shims are included in apparent and allocated totals.

| Consumer | Unique packages | Compressed bytes | Expanded content bytes | Installed apparent bytes | Allocated bytes |
| -------- | --------------: | ---------------: | ---------------------: | -----------------------: | --------------: |
| core-run |               2 |           817321 |                4099699 |                  4099699 |         4579328 |
| discover |               3 |           865361 |                4312914 |                  4322970 |         4907008 |

| Package           | ESM bytes | CJS bytes | Declaration bytes | Other bytes |
| ----------------- | --------: | --------: | ----------------: | ----------: |
| @optique/core     |   1354191 |   1410666 |           1161253 |       25126 |
| @optique/run      |     24735 |     28301 |             88341 |        7086 |
| @optique/discover |     62569 |     69320 |             71888 |        9438 |

The core/run graph has two packages; the discovery graph adds only
*@optique/discover*. The full resolved dependency graph is in every raw report.
The filesystem type reported by `statfs` was `2435016766` (0x9123683E, Btrfs).
Allocated blocks describe this filesystem, not exclusive physical storage;
hard links or clones can share blocks elsewhere. Archive totals count only
regular files. Classification checks declaration extensions (*.d.ts*, *.d.cts*
and *.d.mts*) before ESM/CJS extensions. These totals exclude installed shims
and do not estimate network download volume.
Loading traces, installed size and archive size remain separate measurements.
