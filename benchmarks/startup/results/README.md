Recorded baseline
=================

These three captures use the same measured inputs, built archives, isolated
consumer inventories, lockfiles and runtime versions. Each of the 32 cases has
100 measured fresh processes and five warmups per run. All 9,600 measured
processes and 480 warmups matched their exact output and exit-status goldens.
The separate three-sample smoke run does not report p95.

The setup and commands are described in [the harness guide]. The raw
*run-1.json*, *run-2.json* and *run-3.json* retain samples, command arguments,
allowlisted environments, exact output tables, quantiles, case order, host
load, input hashes and installation inventories. *spread.json* retains
unrounded median spreads; *validation.json* records the separate loading
checks. Timing runs do not load the tracing hook.

[the harness guide]: ../README.md


Host and interpretation
-----------------------

Captured from 2026-10-19T00:19:24.291Z through
2026-10-19T00:30:08.933Z on linux 7.2.9-200.fc44.x86\_64
(x64), AMD Ryzen 7 7700X 8-Core Processor, 16 logical CPUs.
The library revision was `f5248215f64f3879f19fedf577bffbb8e52f2ec3`; the
uncommitted harness and build-input contents are identified by the complete
input-selection list and SHA-256
`faea27718c1986389962dcd2f30f5227a0c5fdd584de4bb19e46a81247cfb076`. The commit
that contains these artifacts can therefore differ from that library revision;
the input-selection list and hash still identify exactly which bytes were
measured.

Tool versions were Node v26.12.0, Bun 1.3.14, pnpm 11.28.6, and
Deno 2.9.7 (stable, release, x86\_64-unknown-linux-gnu).
Node ESM/CJS and Bun use installed plain JavaScript. Deno loads checkout
TypeScript with cached dependencies and disabled V8 code cache; these are
distinct deployment modes, not directly comparable parser measurements.

Both shared advisory locks were held exclusively throughout this capture,
which kept out cooperating builds, tests and reviews that honor those locks.
Unrelated machine activity was not controlled. *host-context.json* records
the CPU governor/driver and power preference before and after; per-run load
averages are retained in the raw reports. Fresh processes do not imply cold
filesystem caches.

| Run | Start                    | Load before (1/5/15 min) | Load after (1/5/15 min) |
| --- | ------------------------ | ------------------------ | ----------------------- |
| 1   | 2026-10-19T00:19:24.291Z | 6.50, 9.22, 11.02        | 5.60, 6.88, 9.64        |
| 2   | 2026-10-19T00:23:05.084Z | 5.60, 6.88, 9.64         | 3.94, 5.31, 8.44        |
| 3   | 2026-10-19T00:26:37.265Z | 3.94, 5.31, 8.44         | 3.45, 4.54, 7.50        |

| Case                                  | Median 1 ms | Median 2 ms | Median 3 ms |   p95 range ms | Median spread % |
| ------------------------------------- | ----------: | ----------: | ----------: | -------------: | --------------: |
| node-empty                            |      17.030 |      17.101 |      17.044 |  19.058–26.325 |            0.41 |
| node-import:@optique/core             |      54.788 |      55.039 |      55.240 |  59.462–79.157 |            0.82 |
| node-import:@optique/run              |      59.541 |      59.953 |      59.456 |  63.368–87.850 |            0.83 |
| node-import:@optique/discover         |      62.381 |      62.977 |      63.248 |  67.498–89.919 |            1.38 |
| node-import:@optique/core/constructs  |      46.152 |      46.412 |      46.345 |  48.860–64.515 |            0.56 |
| node-import:@optique/core/primitives  |      46.022 |      46.068 |      45.915 |  48.979–66.814 |            0.33 |
| node-import:@optique/core/modifiers   |      40.278 |      40.377 |      40.178 |  43.401–58.571 |            0.50 |
| node-import:@optique/core/valueparser |      33.997 |      34.532 |      34.620 |  37.685–50.444 |            1.80 |
| node-import:@optique/run/run          |      58.393 |      58.487 |      58.528 |  62.320–85.746 |            0.23 |
| node-minimal-help                     |      68.287 |      67.939 |      68.121 |  72.219–99.790 |            0.51 |
| node-minimal-dispatch                 |      64.779 |      64.778 |      65.237 |  69.194–89.406 |            0.71 |
| node-three-root-help                  |      73.165 |      73.416 |      73.662 | 76.825–105.788 |            0.68 |
| node-three-nested-help                |      76.841 |      76.645 |      77.065 | 80.952–116.805 |            0.55 |
| node-three-version                    |      67.022 |      67.094 |      66.903 |  71.609–98.034 |            0.29 |
| node-three-dispatch                   |      70.401 |      70.345 |      70.833 |  74.113–97.982 |            0.69 |
| node-three-invalid                    |      71.795 |      71.533 |      72.055 | 74.691–102.623 |            0.73 |
| node-three-completion                 |      67.643 |      67.621 |      67.965 |  71.429–97.458 |            0.51 |
| node-discovery-root-help              |      79.227 |      78.496 |      79.055 | 83.669–110.452 |            0.93 |
| node-discovery-nested-help            |      82.526 |      82.224 |      82.381 | 86.882–122.647 |            0.37 |
| node-discovery-version                |      70.551 |      70.997 |      71.023 | 75.567–108.960 |            0.67 |
| node-discovery-dispatch               |      75.880 |      76.342 |      75.910 | 80.653–112.743 |            0.61 |
| node-discovery-invalid                |      76.500 |      76.339 |      75.998 | 82.944–113.918 |            0.66 |
| node-discovery-completion             |      71.756 |      71.689 |      71.471 | 77.221–110.818 |            0.40 |
| cjs-three-root-help                   |      63.732 |      64.338 |      63.906 |  68.769–95.363 |            0.95 |
| bun-three-root-help                   |      50.268 |      49.737 |      50.184 |  53.875–73.246 |            1.06 |
| deno-three-root-help                  |      89.294 |      90.414 |      89.427 | 94.882–133.245 |            1.25 |
| node-cache-three-root-help            |      63.644 |      64.287 |      63.982 |  68.404–93.269 |            1.01 |
| cjs-three-dispatch                    |      60.152 |      60.107 |      60.182 |  66.143–89.020 |            0.12 |
| bun-three-dispatch                    |      43.836 |      44.116 |      43.904 |  48.535–65.400 |            0.64 |
| deno-three-dispatch                   |      86.112 |      87.011 |      86.865 | 92.811–128.013 |            1.04 |
| node-cache-three-dispatch             |      60.976 |      60.970 |      61.363 |  65.942–88.708 |            0.64 |
| cjs-import:@optique/core              |      45.298 |      45.462 |      46.033 |  48.602–67.501 |            1.62 |

The p95 range column lists the lowest and highest per-run p95 across the
three runs. The median spread of a case is the range of its three run medians
divided by their middle value. It ranged from 0.12% (cjs-three-dispatch) to
1.80% (node-import:@optique/core/valueparser).
These are whole-process wall times. Within each run, cases were interleaved
rather than executed in blocks. Interleaving reduces systematic case-order
effects but does not remove scheduler noise, frequency changes or shared-host
activity. Load and power context describe the conditions; three runs cannot
establish a causal explanation for individual differences. Across the three
runs, 7 case medians strictly increased, 2 strictly decreased, and 23 were
mixed or unchanged. The recorded CPU governor, driver and power
preference matched before and after the capture window. The observed spread is
why this initial baseline supplies no hard regression budget. Subtracting the
empty case would not isolate parser cost.


Installation
------------

Both production consumers used pnpm's copy import method and isolated linker.
All Optique dependencies resolved to harness-generated local tarballs, with
lockfile SHA-512 integrity verified against archive bytes. Installed contents
were rechecked before capture; no package resolves to a workspace link. Files
are deduplicated by real path, with pnpm metadata, lockfiles and external store
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
regular files. Classification tests for declaration files before testing
ESM/CJS extensions.
They exclude installed shims and do not estimate network download volume.
Loading traces, installed size and archive size remain separate measurements.
