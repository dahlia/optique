import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { sha256 } from "./contract.ts";
import { join } from "node:path";
import { validateReport, writeReport } from "./results.ts";

const testRoot = fileURLToPath(
  new URL("../../tmp/startup-tests/", import.meta.url),
);

describe("validateReport", () => {
  const stdout = "ok\n", stderr = "";
  const outputHash = sha256(JSON.stringify({ stdout, stderr }));
  const report = () => ({
    schemaVersion: 1 as const,
    mode: "smoke" as const,
    sampleCount: 1,
    warmupCount: 0,
    metadata: {
      revision: "abc",
      identity: "input-hash",
      runtimes: { node: "v26" },
      manifestHash: "manifest-hash",
    },
    order: [["case"]],
    outputs: { [outputHash]: { stdout, stderr } },
    cases: [{
      id: "case",
      expectedStatus: 0,
      expectedOutputHash: outputHash,
      command: { executable: "node", args: [], cwd: ".", env: {} },
      loadingMode: "packaged-esm",
      warmups: [],
      samples: [{
        wallMs: 12,
        status: 0,
        signal: null,
        error: null,
        outputHash,
      }],
      summary: { count: 1, medianMs: 12, p95Ms: null },
    }],
  });
  it("should accept a self-consistent report", () => validateReport(report()));
  it("should reject malformed results and recomputation mismatches", () => {
    for (
      const change of [
        { schemaVersion: 2 },
        { sampleCount: 100 },
        { order: [[]] },
        { outputs: {} },
        { cases: [] },
        { metadata: {} },
      ]
    ) assert.throws(() => validateReport({ ...report(), ...change }));
    const altered = report();
    altered.cases[0].summary.medianMs = 1;
    assert.throws(() => validateReport(altered), /summary/i);
    const killed = report();
    Object.assign(killed.cases[0].samples[0], { signal: "SIGKILL" });
    assert.throws(() => validateReport(killed));
    const invalid = report();
    invalid.cases[0].samples[0].wallMs = NaN;
    assert.throws(() => validateReport(invalid));
  });
  it("should reject another case's valid output hash and mixed per-case outputs", () => {
    const bad = report();
    const empty = { stdout: "", stderr: "" };
    const emptyHash = sha256(JSON.stringify(empty));
    bad.outputs[emptyHash] = empty;
    bad.cases[0].samples[0].outputHash = emptyHash;
    assert.throws(() => validateReport(bad), /output/i);
    const mixed = report();
    mixed.outputs[emptyHash] = empty;
    mixed.sampleCount = 2;
    mixed.order.push(["case"]);
    mixed.cases[0].summary.count = 2;
    mixed.cases[0].samples.push({
      ...mixed.cases[0].samples[0],
      outputHash: emptyHash,
    });
    assert.throws(() => validateReport(mixed), /output/i);
  });
  it("should leave no destination when validation fails before atomic writing", () => {
    mkdirSync(testRoot, { recursive: true });
    const directory = mkdtempSync(join(testRoot, "report-"));
    try {
      const path = join(directory, "result.json");
      const bad = report();
      bad.cases[0].summary.medianMs = 99;
      assert.throws(() => writeReport(path, bad));
      assert.ok(!existsSync(path));
      writeReport(path, report());
      validateReport(JSON.parse(readFileSync(path, "utf8")));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it("should keep every checked-in artifact portable and avoid unverified lock claims", () => {
    const root = new URL("./results/", import.meta.url);
    if (!existsSync(root)) return;
    const inspect = (value: unknown): void => {
      if (typeof value === "string") {
        assert.ok(
          !/^(?:file:\/\/)?(?:\/(?!usr\/bin(?:[/:]|$)|bin(?:[/:]|$))|[A-Za-z]:[\\/])/
            .test(value),
          value,
        );
      } else if (Array.isArray(value)) value.forEach(inspect);
      else if (value !== null && typeof value === "object") {
        Object.values(value).forEach(inspect);
      }
    };
    for (
      const file of readdirSync(root).filter((file) => file.endsWith(".json"))
    ) {
      const text = readFileSync(new URL(file, root), "utf8");
      assert.ok(!text.includes("/home/") && !text.includes("/Users/"));
      const value = JSON.parse(text);
      inspect(value);
      if (/^(?:run-\d|smoke)\.json$/.test(file)) {
        validateReport(value);
        const lock = value.metadata.lock;
        if (lock !== null && typeof lock === "object") {
          assert.ok(!("advisory" in lock));
        }
      }
    }
  });
});
