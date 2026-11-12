import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { createCliRunner } from "@optique/testing/cli";
import manifest from "../package.json" with { type: "json" };

const entrypoint = new URL("./cli.ts", import.meta.url);
const runtimeArgs = "Deno" in globalThis
  ? ["--allow-read", "--allow-write", "--allow-env"]
  : [];
const env = {
  FORCE_COLOR: undefined,
  CLICOLOR_FORCE: undefined,
  NO_COLOR: undefined,
  NODE_DISABLE_COLORS: undefined,
  NODE_OPTIONS: undefined,
  NODE_PATH: undefined,
  COLUMNS: "80",
  TERM: "dumb",
};

const TSV = "name\tnote\nAda\tfirst, programmer\n";
const CSV = 'name,note\nAda,"first, programmer"\n';
const OLD = "old contents\n";

/**
 * Runs a test in a temporary working directory that contains data.tsv,
 * and checks afterward that the input was never modified.
 */
async function fixture(
  test: (cwd: string, cli: ReturnType<typeof createCliRunner>) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "tsv-to-csv-cli-"));
  try {
    await writeFile(join(cwd, "data.tsv"), TSV);
    await test(cwd, createCliRunner({ entrypoint, runtimeArgs, env, cwd }));
    assert.equal(await readFile(join(cwd, "data.tsv"), "utf8"), TSV);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function files(cwd: string): Promise<string[]> {
  return (await readdir(cwd)).sort();
}

describe("tsv-to-csv", () => {
  it("writes the derived destination by default", () =>
    fixture(async (cwd, cli) => {
      assert.deepEqual(await cli.invoke("data.tsv"), {
        stdout: "data.csv\n",
        stderr: "",
        exitCode: 0,
        signal: null,
      });
      assert.equal(await readFile(join(cwd, "data.csv"), "utf8"), CSV);
    }));

  it("writes an explicit destination", () =>
    fixture(async (cwd, cli) => {
      const result = await cli.invoke("data.tsv", "--output", "report.csv");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "report.csv\n");
      assert.equal(result.stderr, "");
      assert.equal(await readFile(join(cwd, "report.csv"), "utf8"), CSV);
      assert.deepEqual(await files(cwd), ["data.tsv", "report.csv"]);
    }));

  it("refuses to replace an existing destination", () =>
    fixture(async (cwd, cli) => {
      await writeFile(join(cwd, "data.csv"), OLD);
      const result = await cli.invoke("data.tsv");
      assert.equal(result.exitCode, 1);
      assert.equal(result.stdout, "");
      assert.equal(
        result.stderr,
        "tsv-to-csv: data.csv already exists; use --force to replace it.\n",
      );
      assert.equal(await readFile(join(cwd, "data.csv"), "utf8"), OLD);
    }));

  it("replaces an existing destination with --force", () =>
    fixture(async (cwd, cli) => {
      await writeFile(join(cwd, "data.csv"), OLD);
      const result = await cli.invoke("-f", "data.tsv");
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "data.csv\n");
      assert.equal(result.stderr, "");
      assert.equal(await readFile(join(cwd, "data.csv"), "utf8"), CSV);
    }));

  it("rejects the input as its own destination", () =>
    fixture(async (cwd, cli) => {
      for (const output of ["data.tsv", "./data.tsv"]) {
        const result = await cli.invoke("--force", "data.tsv", "-o", output);
        assert.equal(result.exitCode, 1);
        assert.equal(result.stdout, "");
        assert.match(result.stderr, /is the input file/);
      }
      assert.deepEqual(await files(cwd), ["data.tsv"]);
    }));

  it("handles help, version, and parse errors without touching files", () =>
    fixture(async (cwd, cli) => {
      await writeFile(join(cwd, "data.csv"), OLD);
      const help = await cli.invoke("data.tsv", "--help");
      assert.equal(help.exitCode, 0);
      assert.match(help.stdout, /^Usage: tsv-to-csv /m);
      assert.ok(!help.stdout.includes("\x1b["));
      assert.equal(help.stderr, "");

      const version = await cli.invoke("--version");
      assert.equal(version.exitCode, 0);
      assert.equal(version.stdout, `${manifest.version}\n`);

      for (
        const args of [
          [],
          ["missing.tsv"],
          ["data.tsv", "--output"],
          ["data.tsv", "extra.tsv"],
          ["data.tsv", "-o", "missing-dir/out.csv"],
          ["--unknown", "data.tsv"],
        ]
      ) {
        const result = await cli.invoke(...args);
        assert.equal(result.exitCode, 1, args.join(" "));
        assert.equal(result.stdout, "", args.join(" "));
        assert.match(result.stderr, /Usage: tsv-to-csv/, args.join(" "));
        assert.ok(!result.stderr.includes("Overwrite"), args.join(" "));
      }
      assert.deepEqual(await files(cwd), ["data.csv", "data.tsv"]);
      assert.equal(await readFile(join(cwd, "data.csv"), "utf8"), OLD);
    }));
});
