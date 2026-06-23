import assert from "node:assert/strict";
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPathTs = join(__dirname, "cli.ts");
const cliPathJs = join(__dirname, "..", "dist", "cli.js");

interface RunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

function isSubprocessReliable(): boolean {
  const probe = spawnSync(
    process.execPath,
    ["-e", "process.stdout.write('ok')"],
    {
      encoding: "utf8",
      timeout: 5000,
    },
  );
  return probe.status === 0 && probe.stdout === "ok";
}

const hasReliableSubprocess = isSubprocessReliable();

function runCli(args: readonly string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    let child: ChildProcess;

    if ("Deno" in globalThis) {
      child = spawn("deno", [
        "run",
        "--allow-read",
        "--allow-write",
        "--allow-env",
        cliPathTs,
        ...args,
      ], { cwd: __dirname });
    } else if ("Bun" in globalThis) {
      child = spawn("bun", [cliPathJs, ...args], { cwd: __dirname });
    } else {
      child = spawn("node", ["--no-warnings", cliPathJs, ...args], {
        cwd: __dirname,
      });
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 0 });
    });
  });
}

describe("optique-discover CLI", { skip: !hasReliableSubprocess }, () => {
  it("should show help", async () => {
    if (!hasReliableSubprocess) return;

    const result = await runCli(["--help"]);

    assert.equal(result.exitCode, 0);
    assert.ok(result.stdout.includes("optique-discover"));
    assert.ok(result.stdout.includes("--output"));
  });

  it("should generate a commands module", async () => {
    if (!hasReliableSubprocess) return;

    const dir = await makeTempDir();
    try {
      const commandsDir = join(dir, "src", "commands");
      const outputFile = join(dir, "src", "commands.generated.ts");
      await writeText(join(commandsDir, "build.ts"), "");
      await writeText(join(commandsDir, "user", "add.ts"), "");

      const result = await runCli([
        commandsDir,
        "--output",
        outputFile,
        "--extension",
        ".ts",
      ]);

      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.match(result.stdout, /Generated 2 command modules\./);
      const generated = await readFile(outputFile, "utf-8");
      assert.match(
        generated,
        /import \* as cmd0 from "\.\/commands\/build\.ts"/,
      );
      assert.match(generated, /"\.\/commands\/user\/add\.ts": cmd1/);
      assert.match(generated, /base: "\.\/commands"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("package exports", () => {
  it("should not publish a CommonJS CLI subpath", async () => {
    const packageJson = JSON.parse(
      await readFile(join(__dirname, "..", "package.json"), "utf-8"),
    ) as PackageJson;
    const cliExport = packageJson.exports?.["./cli"];

    assert.ok(isRecord(cliExport));
    assert.ok(!Object.hasOwn(cliExport, "require"));
    if (isRecord(cliExport.types)) {
      assert.ok(!Object.hasOwn(cliExport.types, "require"));
    }
  });
});

interface PackageJson {
  readonly exports?: Record<string, unknown>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

async function makeTempDir(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return await mkdtemp(join(tmpdir(), "optique-discover-cli-"));
}

async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf-8");
}
