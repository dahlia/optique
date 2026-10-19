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

Captured from 2026-10-19T10:10:15.312Z through
2026-10-19T10:21:37.164Z on linux 7.2.9-200.fc44.x86\_64
(x64), AMD Ryzen 7 7700X 8-Core Processor, 16 logical CPUs.
The library revision was `5aa2b1d8e8136ccd16a48ec238df84806e62a001`; the
uncommitted harness and build-input contents are identified by the complete
input-selection list and SHA-256
`a4640a3dbf3ce4da85cac1fa80433926a7c0664e10c43066761e1405ced1e7de`. The commit
containing these artifacts can therefore differ from that library revision
while still identifying exactly which bytes were measured.

Runtime versions were Node v26.12.0, Bun 1.3.14, pnpm 11.28.6, and
Deno 2.9.7 (stable, release, x86\_64-unknown-linux-gnu).
Node ESM/CJS and Bun use installed plain JavaScript. Deno loads checkout
TypeScript with cached dependencies and disabled V8 code cache; these are
distinct deployment modes, not directly interchangeable parser measurements.

Both shared advisory locks were held exclusively throughout this capture,
excluding cooperating builds, tests and reviews that honor those locks.
Unrelated machine activity was not controlled. *host-context.json* records
the CPU governor/driver and power preference before and after; per-run load
averages are retained in the raw reports. Fresh processes do not imply cold
filesystem caches.

| Run | Start                    | Load before (1/5/15 min) | Load after (1/5/15 min) |
| --- | ------------------------ | ------------------------ | ----------------------- |
| 1   | 2026-10-19T10:10:15.312Z | 15.09, 12.25, 12.90      | 5.21, 9.21, 11.59       |
| 2   | 2026-10-19T10:14:15.744Z | 5.21, 9.21, 11.59        | 4.48, 6.70, 10.07       |
| 3   | 2026-10-19T10:17:51.259Z | 4.48, 6.70, 10.07        | 4.89, 5.96, 9.03        |

| Case                                  | Median 1 ms | Median 2 ms | Median 3 ms |    p95 range ms | Median spread % |
| ------------------------------------- | ----------: | ----------: | ----------: | --------------: | --------------: |
| node-empty                            |      18.650 |      17.462 |      18.037 |   20.236–28.636 |            6.59 |
| node-import:@optique/core             |      58.308 |      55.794 |      56.888 |   62.524–84.062 |            4.42 |
| node-import:@optique/run              |      63.166 |      60.035 |      62.412 |   69.205–98.536 |            5.02 |
| node-import:@optique/discover         |      66.757 |      64.000 |      66.312 |   69.175–99.658 |            4.16 |
| node-import:@optique/core/constructs  |      48.919 |      46.719 |      47.992 |   50.590–73.143 |            4.58 |
| node-import:@optique/core/primitives  |      48.834 |      46.664 |      48.385 |   52.181–76.092 |            4.48 |
| node-import:@optique/core/modifiers   |      43.567 |      40.840 |      42.595 |   46.374–69.432 |            6.40 |
| node-import:@optique/core/valueparser |      37.118 |      35.109 |      36.589 |   41.084–54.851 |            5.49 |
| node-import:@optique/run/run          |      63.018 |      59.476 |      61.726 |   70.836–98.943 |            5.74 |
| node-minimal-help                     |      72.869 |      68.791 |      72.038 |  75.194–113.646 |            5.66 |
| node-minimal-dispatch                 |      68.686 |      64.957 |      67.974 |  70.537–101.387 |            5.49 |
| node-three-root-help                  |      78.421 |      73.840 |      77.550 |  82.729–116.438 |            5.91 |
| node-three-nested-help                |      81.432 |      77.354 |      80.503 |  84.908–124.326 |            5.07 |
| node-three-version                    |      71.615 |      67.848 |      70.767 |  73.385–112.604 |            5.32 |
| node-three-dispatch                   |      75.532 |      71.690 |      74.326 |  79.069–126.592 |            5.17 |
| node-three-invalid                    |      76.422 |      72.724 |      75.456 |  78.927–121.378 |            4.90 |
| node-three-completion                 |      70.852 |      68.538 |      70.925 |  73.996–114.969 |            3.37 |
| node-discovery-root-help              |      84.103 |      79.447 |      83.276 |  90.482–128.242 |            5.59 |
| node-discovery-nested-help            |      86.606 |      83.985 |      86.597 |  91.409–137.395 |            3.03 |
| node-discovery-version                |      75.365 |      72.149 |      74.202 |  80.795–128.549 |            4.33 |
| node-discovery-dispatch               |      80.884 |      77.690 |      79.445 |  86.983–124.054 |            4.02 |
| node-discovery-invalid                |      80.913 |      77.789 |      80.206 |  84.467–129.036 |            3.89 |
| node-discovery-completion             |      75.763 |      72.463 |      74.782 |  83.020–120.564 |            4.41 |
| cjs-three-root-help                   |      67.050 |      64.747 |      67.091 |  73.341–107.436 |            3.50 |
| bun-three-root-help                   |      53.152 |      50.882 |      52.557 |   56.505–85.754 |            4.32 |
| deno-three-root-help                  |      93.743 |      90.467 |      94.188 | 100.978–139.819 |            3.97 |
| node-cache-three-root-help            |      66.982 |      64.900 |      67.444 |  74.796–106.282 |            3.80 |
| cjs-three-dispatch                    |      64.139 |      61.395 |      63.272 |   67.818–89.779 |            4.34 |
| bun-three-dispatch                    |      46.144 |      44.900 |      46.383 |   50.611–72.453 |            3.21 |
| deno-three-dispatch                   |      92.238 |      87.498 |      90.846 |  96.294–141.295 |            5.22 |
| node-cache-three-dispatch             |      64.625 |      62.036 |      63.780 |   69.585–97.442 |            4.06 |
| cjs-import:@optique/core              |      47.922 |      46.700 |      47.492 |   50.396–71.795 |            2.57 |

Median spread, defined as the range of the three run medians divided by
their middle value,
ranged from 2.57% (cjs-import:@optique/core) to
6.59% (node-empty).
These are whole-process wall times. Within each run, cases were interleaved
rather than executed in blocks. Interleaving reduces systematic case-order
effects but does not remove scheduler noise, frequency changes or shared-host
activity. Load and power context describe the conditions; three runs cannot
establish a causal explanation for individual differences. Across the three
runs, 0 case medians strictly increased, 0 strictly decreased, and 32 were
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
| discover |               3 |           865361 |                4312914 |                  4322054 |         4907008 |

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
regular files, classifying declaration files before testing ESM/CJS extensions.
They exclude installed shims and do not estimate network download volume.
Loading traces, installed size and archive size remain separate measurements.
