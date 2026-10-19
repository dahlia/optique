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

Captured from 2026-10-19T06:34:43.402Z through
2026-10-19T06:46:02.706Z on linux 7.2.9-200.fc44.x86\_64
(x64), AMD Ryzen 7 7700X 8-Core Processor, 16 logical CPUs.
The library revision was `32cb9c99466a90c5ce42cf3addf025d0f91b933b`; the
uncommitted harness and build-input contents are identified by the complete
input-selection list and SHA-256
`eddcc22d21cb3f179eebbc2445c4da2cc3922daa2991fbd102efedd80dc188c2`. The commit
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
| 1   | 2026-10-19T06:34:43.402Z | 5.89, 3.35, 2.22         | 3.06, 3.16, 2.37        |
| 2   | 2026-10-19T06:38:12.778Z | 3.06, 3.16, 2.37         | 3.92, 4.49, 3.16        |
| 3   | 2026-10-19T06:42:02.118Z | 3.92, 4.49, 3.16         | 9.85, 6.39, 4.19        |

| Case                                  | Median 1 ms | Median 2 ms | Median 3 ms |   p95 range ms | Median spread % |
| ------------------------------------- | ----------: | ----------: | ----------: | -------------: | --------------: |
| node-empty                            |      17.244 |      18.320 |      18.669 |  19.264–28.580 |            7.78 |
| node-import:@optique/core             |      54.378 |      57.348 |      57.212 |  57.648–87.404 |            5.19 |
| node-import:@optique/run              |      59.359 |      62.173 |      62.614 |  62.686–96.652 |            5.24 |
| node-import:@optique/discover         |      62.574 |      65.509 |      66.199 | 66.099–102.633 |            5.53 |
| node-import:@optique/core/constructs  |      46.071 |      47.807 |      48.895 |  49.890–72.120 |            5.91 |
| node-import:@optique/core/primitives  |      46.050 |      47.501 |      48.515 |  49.227–77.007 |            5.19 |
| node-import:@optique/core/modifiers   |      40.609 |      41.826 |      42.774 |  43.040–67.540 |            5.18 |
| node-import:@optique/core/valueparser |      34.335 |      36.514 |      36.693 |  37.609–54.272 |            6.46 |
| node-import:@optique/run/run          |      58.372 |      60.733 |      61.749 |  62.268–99.545 |            5.56 |
| node-minimal-help                     |      67.355 |      69.768 |      72.017 | 70.692–114.083 |            6.68 |
| node-minimal-dispatch                 |      64.268 |      67.095 |      67.378 | 68.113–106.158 |            4.64 |
| node-three-root-help                  |      72.678 |      76.029 |      77.335 | 75.957–116.922 |            6.12 |
| node-three-nested-help                |      76.423 |      79.811 |      80.462 | 79.214–133.347 |            5.06 |
| node-three-version                    |      66.752 |      69.775 |      70.861 | 69.839–109.849 |            5.89 |
| node-three-dispatch                   |      70.277 |      73.547 |      74.051 | 73.810–114.950 |            5.13 |
| node-three-invalid                    |      71.270 |      74.047 |      75.245 | 76.381–118.530 |            5.37 |
| node-three-completion                 |      67.107 |      69.640 |      71.258 | 71.896–112.950 |            5.96 |
| node-discovery-root-help              |      78.011 |      82.547 |      84.274 | 83.735–139.455 |            7.59 |
| node-discovery-nested-help            |      81.767 |      85.426 |      87.376 | 86.226–134.054 |            6.57 |
| node-discovery-version                |      70.319 |      73.794 |      75.299 | 76.331–124.008 |            6.75 |
| node-discovery-dispatch               |      75.066 |      79.206 |      80.706 | 81.582–123.874 |            7.12 |
| node-discovery-invalid                |      75.284 |      79.637 |      81.727 | 80.899–125.202 |            8.09 |
| node-discovery-completion             |      70.955 |      74.446 |      75.950 | 75.790–122.069 |            6.71 |
| cjs-three-root-help                   |      63.451 |      66.315 |      66.804 | 67.603–102.574 |            5.06 |
| bun-three-root-help                   |      49.035 |      51.535 |      52.258 |  51.936–86.153 |            6.25 |
| deno-three-root-help                  |      89.069 |      92.490 |      94.449 | 92.980–141.344 |            5.82 |
| node-cache-three-root-help            |      63.555 |      66.563 |      67.785 | 69.651–101.197 |            6.36 |
| cjs-three-dispatch                    |      60.337 |      62.715 |      62.968 |  63.578–96.940 |            4.19 |
| bun-three-dispatch                    |      42.792 |      45.822 |      46.827 |  46.054–76.238 |            8.81 |
| deno-three-dispatch                   |      85.371 |      90.196 |      90.580 | 89.560–132.324 |            5.78 |
| node-cache-three-dispatch             |      61.028 |      63.462 |      65.070 |  65.380–97.792 |            6.37 |
| cjs-import:@optique/core              |      45.598 |      47.325 |      48.183 |  48.140–69.591 |            5.46 |

Median spread, defined as the range of the three run medians divided by
their middle value,
ranged from 4.19% (cjs-three-dispatch) to
8.81% (bun-three-dispatch).
These are whole-process wall times. Within each run, cases were interleaved
rather than executed in blocks. Interleaving reduces systematic case-order
effects but does not remove scheduler noise, frequency changes or shared-host
activity. Load and power context describe the conditions; three runs cannot
establish a causal explanation for individual differences. Across the three
runs, 31 case medians strictly increased, 0 strictly decreased, and 1 were
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
