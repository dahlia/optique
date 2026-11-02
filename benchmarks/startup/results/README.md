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

Captured from 2026-10-19T12:44:02.419Z through
2026-10-19T12:57:34.998Z on linux 7.2.9-200.fc44.x86\_64
(x64), AMD Ryzen 7 7700X 8-Core Processor, 16 logical CPUs.
The library revision was `6dc63e1bbb7908290575546e0ec564a89f568d0d`; the
uncommitted harness and build-input contents are identified by the complete
input-selection list and SHA-256
`1e2bccdd4bbee736a1120bc79ea77aa6957a37ff30a4aa6e973d7831f6107e18`. The commit
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
| 1   | 2026-10-19T12:44:02.419Z | 17.43, 15.76, 13.63      | 14.91, 15.01, 13.83     |
| 2   | 2026-10-19T12:48:39.028Z | 14.91, 15.01, 13.83      | 9.27, 12.06, 12.91      |
| 3   | 2026-10-19T12:53:19.332Z | 9.27, 12.06, 12.91       | 10.75, 11.76, 12.59     |

| Case                                  | Median 1 ms | Median 2 ms | Median 3 ms |    p95 range ms | Median spread % |
| ------------------------------------- | ----------: | ----------: | ----------: | --------------: | --------------: |
| node-empty                            |      23.519 |      23.517 |      20.380 |   27.904–30.383 |           13.35 |
| node-import:@optique/core             |      71.388 |      74.253 |      63.545 |   81.940–87.630 |           15.00 |
| node-import:@optique/run              |      76.436 |      81.937 |      70.547 |  88.709–102.122 |           14.90 |
| node-import:@optique/discover         |      80.291 |      86.743 |      74.506 |  94.929–101.862 |           15.24 |
| node-import:@optique/core/constructs  |      60.209 |      61.604 |      53.419 |   69.164–73.738 |           13.59 |
| node-import:@optique/core/primitives  |      58.632 |      62.529 |      52.981 |   69.530–74.469 |           16.28 |
| node-import:@optique/core/modifiers   |      52.126 |      54.824 |      46.346 |   58.261–65.562 |           16.26 |
| node-import:@optique/core/valueparser |      45.251 |      47.817 |      39.956 |   52.032–55.278 |           17.37 |
| node-import:@optique/run/run          |      77.243 |      79.326 |      68.362 |   86.304–93.120 |           14.19 |
| node-minimal-help                     |      85.608 |      92.097 |      79.359 | 102.390–109.333 |           14.88 |
| node-minimal-dispatch                 |      80.673 |      87.710 |      75.457 |  96.053–103.266 |           15.19 |
| node-three-root-help                  |      93.458 |     101.852 |      88.207 | 109.422–120.901 |           14.60 |
| node-three-nested-help                |      99.458 |     104.574 |      93.313 | 112.660–122.889 |           11.32 |
| node-three-version                    |      85.936 |      91.970 |      79.723 |  98.928–107.081 |           14.25 |
| node-three-dispatch                   |      90.321 |      97.427 |      82.885 | 104.682–114.766 |           16.10 |
| node-three-invalid                    |      92.010 |      98.692 |      83.917 | 101.265–112.916 |           16.06 |
| node-three-completion                 |      85.979 |      91.627 |      79.598 | 100.657–114.117 |           13.99 |
| node-discovery-root-help              |     103.010 |     110.579 |      95.522 | 118.820–125.432 |           14.62 |
| node-discovery-nested-help            |     104.481 |     114.728 |      96.772 | 119.951–129.643 |           17.19 |
| node-discovery-version                |      92.593 |      98.636 |      83.164 | 109.569–121.920 |           16.71 |
| node-discovery-dispatch               |      99.858 |     104.946 |      89.581 | 113.031–125.559 |           15.39 |
| node-discovery-invalid                |      99.038 |     105.734 |      91.011 | 114.371–120.410 |           14.87 |
| node-discovery-completion             |      94.591 |     102.394 |      89.927 | 113.138–114.228 |           13.18 |
| cjs-three-root-help                   |      79.291 |      85.026 |      74.515 |  90.950–107.636 |           13.26 |
| bun-three-root-help                   |      65.409 |      70.247 |      58.044 |   74.693–86.670 |           18.66 |
| deno-three-root-help                  |     113.255 |     116.204 |     104.818 | 136.645–150.978 |           10.05 |
| node-cache-three-root-help            |      81.791 |      89.318 |      76.786 |  97.828–107.847 |           15.32 |
| cjs-three-dispatch                    |      76.204 |      81.585 |      70.536 |   89.220–93.380 |           14.50 |
| bun-three-dispatch                    |      57.178 |      63.012 |      52.706 |   69.018–77.499 |           18.02 |
| deno-three-dispatch                   |     113.932 |     125.084 |     104.298 | 130.057–140.588 |           18.24 |
| node-cache-three-dispatch             |      78.303 |      85.210 |      71.828 |  91.940–108.526 |           17.09 |
| cjs-import:@optique/core              |      58.791 |      60.062 |      51.890 |   64.964–72.842 |           13.90 |

Median spread, defined as the range of the three run medians divided by
their middle value,
ranged from 10.05% (deno-three-root-help) to
18.66% (bun-three-root-help).
These are whole-process wall times. Within each run, cases were interleaved
rather than executed in blocks. Interleaving reduces systematic case-order
effects but does not remove scheduler noise, frequency changes or shared-host
activity. Load and power context describe the conditions; three runs cannot
establish a causal explanation for individual differences. Across the three
runs, 0 case medians strictly increased, 1 strictly decreased, and 31 were
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
