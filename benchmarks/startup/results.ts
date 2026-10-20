import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  type Command,
  type Expectation,
  type Measurement,
  record,
  sha256,
  summarize,
} from "./contract.ts";

/** A lossless reference to captured streams, shared across samples. */
export interface RawSample {
  readonly wallMs: number;
  readonly status: number;
  readonly signal: null;
  readonly error: null;
  readonly outputHash: string;
}

/** The result for one declared subprocess case. */
export interface CaseResult {
  readonly id: string;
  readonly command: Command;
  readonly loadingMode: string;
  readonly expectedStatus: number;
  readonly expectedOutputHash: string;
  readonly samples: readonly RawSample[];
  readonly warmups: readonly RawSample[];
  readonly summary: ReturnType<typeof summarize>;
}

/** Version one report. Timings are informational, even when internally valid. */
export interface Report {
  readonly schemaVersion: 1;
  readonly mode: "smoke" | "baseline";
  readonly sampleCount: number;
  readonly warmupCount: number;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly order: readonly (readonly string[])[];
  readonly outputs: Readonly<
    Record<string, Pick<Expectation, "stdout" | "stderr">>
  >;
  readonly cases: readonly CaseResult[];
}

/** Enforces bounded structure, process validity, output hashes and quantiles. */
export function validateReport(value: unknown): asserts value is Report {
  const report = record(value);
  const count = report.sampleCount, warmups = report.warmupCount;
  if (
    report.schemaVersion !== 1 ||
    !["smoke", "baseline"].includes(String(report.mode)) ||
    !Number.isSafeInteger(count) || typeof count !== "number" || count < 1 ||
    count > 1000 || !Number.isSafeInteger(warmups) ||
    typeof warmups !== "number" || warmups < 0 || warmups > 20 ||
    (report.mode === "baseline" && count < 100)
  ) throw new TypeError("Malformed report header.");
  const metadata = record(report.metadata);
  for (const key of ["revision", "identity", "manifestHash"]) {
    if (typeof metadata[key] !== "string" || metadata[key] === "") {
      throw new TypeError(`Missing report metadata: ${key}`);
    }
  }
  record(metadata.runtimes);
  if (
    !Array.isArray(report.cases) || report.cases.length < 1 ||
    report.cases.length > 100
  ) throw new TypeError("Missing or excessive report cases.");
  const outputs = record(report.outputs);
  for (const [hash, raw] of Object.entries(outputs)) {
    const output = record(raw);
    if (
      typeof output.stdout !== "string" || typeof output.stderr !== "string" ||
      sha256(
          JSON.stringify({ stdout: output.stdout, stderr: output.stderr }),
        ) !== hash
    ) throw new TypeError("Corrupt output table.");
  }
  const ids: string[] = [];
  for (const raw of report.cases) {
    const item = record(raw);
    if (
      typeof item.id !== "string" || ids.includes(item.id) ||
      typeof item.loadingMode !== "string" ||
      !Number.isInteger(item.expectedStatus) ||
      typeof item.expectedOutputHash !== "string" ||
      outputs[item.expectedOutputHash] == null
    ) throw new TypeError("Invalid or duplicate report case.");
    ids.push(item.id);
    const command = record(item.command);
    if (
      typeof command.executable !== "string" ||
      typeof command.cwd !== "string" || !Array.isArray(command.args) ||
      command.args.some((arg) => typeof arg !== "string") ||
      Object.values(record(command.env)).some((setting) =>
        typeof setting !== "string"
      )
    ) throw new TypeError("Invalid report command.");
    for (
      const [key, length] of [["samples", count], ["warmups", warmups]] as const
    ) {
      const samples = item[key];
      if (!Array.isArray(samples) || samples.length !== length) {
        throw new TypeError("Wrong report sample count.");
      }
      for (const rawSample of samples) {
        const sample = record(rawSample);
        if (
          typeof sample.wallMs !== "number" ||
          !Number.isFinite(sample.wallMs) || sample.wallMs < 0 ||
          sample.status !== item.expectedStatus || sample.signal !== null ||
          sample.error !== null || typeof sample.outputHash !== "string" ||
          outputs[sample.outputHash] == null
        ) throw new TypeError("Invalid report sample.");
        if (sample.outputHash !== item.expectedOutputHash) {
          throw new TypeError(
            "Sample output differs from its case expectation.",
          );
        }
      }
    }
    const times = (item.samples as Record<string, unknown>[]).map((sample) =>
      Number(sample.wallMs)
    );
    const summary = record(item.summary), expected = summarize(times);
    for (const key of ["count", "medianMs", "p95Ms"] as const) {
      if (summary[key] !== expected[key]) {
        throw new TypeError("Report summary does not match raw samples.");
      }
    }
  }
  if (
    !Array.isArray(report.order) || report.order.length !== count ||
    report.order.some((row) =>
      !Array.isArray(row) || row.length !== ids.length ||
      [...row].sort().join("\0") !== [...ids].sort().join("\0")
    )
  ) throw new TypeError("Invalid interleaving order.");
  if (Buffer.byteLength(JSON.stringify(report)) > 5 * 1024 * 1024) {
    throw new RangeError("Report exceeds 5 MiB.");
  }
}

/** Stores each exact output once, preserving a verifiable per-sample reference. */
export function rawSample(
  measurement: Measurement,
  outputs: Record<string, Pick<Expectation, "stdout" | "stderr">>,
): RawSample {
  const output = { stdout: measurement.stdout, stderr: measurement.stderr };
  const outputHash = sha256(JSON.stringify(output));
  outputs[outputHash] = output;
  return {
    wallMs: measurement.wallMs,
    status: measurement.status,
    signal: null,
    error: null,
    outputHash,
  };
}

/** Writes only completely validated reports, atomically replacing the destination. */
export function writeReport(path: string, value: Report): void {
  validateReport(value);
  const temporary = join(dirname(path), `.startup-result-${process.pid}.json`);
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`);
  renameSync(temporary, path);
}

/** Loads and validates an existing JSON artifact. */
export function readReport(path: string): Report {
  const value: unknown = JSON.parse(readFileSync(path, "utf8"));
  validateReport(value);
  return value;
}
