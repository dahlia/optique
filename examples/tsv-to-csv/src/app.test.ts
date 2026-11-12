import assert from "node:assert/strict";
import {
  link,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { captureRun } from "@optique/testing/run";
import { convertFile, type ConvertOptions, program } from "./app.ts";

const TSV = "name\tage\nAda\t36\n";
const CSV = "name,age\nAda,36\n";
const OLD = "old contents\n";

async function inTemporaryDirectory(
  test: (directory: string) => Promise<void>,
): Promise<void> {
  const directory = await mkdtemp(join(tmpdir(), "tsv-to-csv-"));
  try {
    await test(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

interface Recorded {
  readonly code: number;
  readonly stdout: readonly string[];
  readonly stderr: readonly string[];
  readonly prompts: readonly string[];
}

async function convert(
  options: ConvertOptions,
  answer?: boolean,
): Promise<Recorded> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const prompts: string[] = [];
  const code = await convertFile(options, {
    stdout: (line) => stdout.push(line),
    stderr: (line) => stderr.push(line),
    confirm: answer == null ? undefined : (output) => {
      prompts.push(output);
      return Promise.resolve(answer);
    },
  });
  return { code, stdout, stderr, prompts };
}

describe("convertFile()", () => {
  it("writes next to the input when no output is given", () =>
    inTemporaryDirectory(async (directory) => {
      const input = join(directory, "data.tsv");
      await writeFile(input, TSV);
      const result = await convert({ input, force: false }, true);
      const output = join(directory, "data.csv");
      assert.deepEqual(result, {
        code: 0,
        stdout: [output],
        stderr: [],
        prompts: [],
      });
      assert.equal(await readFile(output, "utf8"), CSV);
      assert.equal(await readFile(input, "utf8"), TSV);
    }));

  it("writes to an explicit output", () =>
    inTemporaryDirectory(async (directory) => {
      const input = join(directory, "data.tsv");
      const output = join(directory, "report.csv");
      await writeFile(input, TSV);
      const result = await convert({ input, output, force: false });
      assert.equal(result.code, 0);
      assert.deepEqual(result.stdout, [output]);
      assert.equal(await readFile(output, "utf8"), CSV);
      assert.deepEqual((await readdir(directory)).sort(), [
        "data.tsv",
        "report.csv",
      ]);
    }));

  it("refuses an existing output without a prompt", () =>
    inTemporaryDirectory(async (directory) => {
      const input = join(directory, "data.tsv");
      const output = join(directory, "data.csv");
      await writeFile(input, TSV);
      await writeFile(output, OLD);
      const result = await convert({ input, force: false });
      assert.equal(result.code, 1);
      assert.deepEqual(result.stdout, []);
      assert.match(result.stderr.join("\n"), /already exists.*--force/);
      assert.equal(await readFile(output, "utf8"), OLD);
    }));

  it("replaces an existing output with force, without asking", () =>
    inTemporaryDirectory(async (directory) => {
      const input = join(directory, "data.tsv");
      const output = join(directory, "data.csv");
      await writeFile(input, TSV);
      await writeFile(output, OLD);
      const result = await convert({ input, force: true }, false);
      assert.equal(result.code, 0);
      assert.deepEqual(result.prompts, []);
      assert.equal(await readFile(output, "utf8"), CSV);
    }));

  it("asks before replacing and respects the answer", () =>
    inTemporaryDirectory(async (directory) => {
      const input = join(directory, "data.tsv");
      const output = join(directory, "data.csv");
      await writeFile(input, TSV);
      await writeFile(output, OLD);

      const declined = await convert({ input, force: false }, false);
      assert.equal(declined.code, 1);
      assert.deepEqual(declined.prompts, [output]);
      assert.deepEqual(declined.stdout, []);
      assert.match(declined.stderr.join("\n"), /Kept the existing/);
      assert.equal(await readFile(output, "utf8"), OLD);

      const accepted = await convert({ input, force: false }, true);
      assert.equal(accepted.code, 0);
      assert.deepEqual(accepted.prompts, [output]);
      assert.equal(await readFile(output, "utf8"), CSV);
    }));

  it("does not ask when the input cannot be read", () =>
    inTemporaryDirectory(async (directory) => {
      const output = join(directory, "data.csv");
      await writeFile(output, OLD);
      const result = await convert(
        { input: join(directory, "missing.tsv"), output, force: false },
        true,
      );
      assert.equal(result.code, 1);
      assert.deepEqual(result.prompts, []);
      assert.match(result.stderr.join("\n"), /^tsv-to-csv: /);
      assert.equal(await readFile(output, "utf8"), OLD);
    }));

  describe("same-file protection", () => {
    async function assertRejected(
      directory: string,
      input: string,
      output: string,
    ): Promise<void> {
      for (const force of [false, true]) {
        const result = await convert({ input, output, force }, true);
        assert.equal(result.code, 1);
        assert.deepEqual(result.stdout, []);
        assert.deepEqual(result.prompts, []);
        assert.match(result.stderr.join("\n"), /is the input file/);
      }
      assert.equal(await readFile(join(directory, "data.tsv"), "utf8"), TSV);
    }

    it("rejects the same path spelled differently", () =>
      inTemporaryDirectory(async (directory) => {
        const input = join(directory, "data.tsv");
        await writeFile(input, TSV);
        await assertRejected(directory, input, input);
        // path.join() would normalize "./" away, so build the spelling
        // by hand:
        await assertRejected(directory, input, `${directory}/./data.tsv`);
      }));

    it("rejects a hard link to the input", () =>
      inTemporaryDirectory(async (directory) => {
        const input = join(directory, "data.tsv");
        const output = join(directory, "data.csv");
        await writeFile(input, TSV);
        await link(input, output);
        await assertRejected(directory, input, output);
      }));

    it("rejects a symbolic link to the input", {
      skip: process.platform === "win32",
    }, () => {
      // Bun ignores the skip option, so we need an early return as well:
      if (process.platform === "win32") return;
      return inTemporaryDirectory(async (directory) => {
        const input = join(directory, "data.tsv");
        const output = join(directory, "data.csv");
        await writeFile(input, TSV);
        await symlink(input, output);
        await assertRejected(directory, input, output);
      });
    });
  });
});

describe("program", () => {
  const formatting = { colors: false, maxWidth: 80 } as const;

  it("validates the input path while parsing", () =>
    inTemporaryDirectory(async (directory) => {
      const result = await captureRun(program, {
        ...formatting,
        args: [join(directory, "missing.tsv")],
      });
      assert.equal(result.kind, "exited");
      assert.equal(result.exitCode, 1);
      assert.match(result.stderr, /does not exist/);
    }));

  it("returns the parsed options", () =>
    inTemporaryDirectory(async (directory) => {
      const input = join(directory, "data.tsv");
      await writeFile(input, TSV);
      const result = await captureRun(program, {
        ...formatting,
        args: ["--force", input, "-o", join(directory, "out.csv")],
      });
      assert.equal(result.kind, "returned");
      if (result.kind !== "returned") return;
      assert.deepEqual(result.value, {
        input,
        output: join(directory, "out.csv"),
        force: true,
      });
    }));
});
