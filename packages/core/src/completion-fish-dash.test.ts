import { deepStrictEqual } from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { fish } from "./completion.ts";

function hasFish(): boolean {
  try {
    execFileSync("fish", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

// Windows does not allow some of the fixture names (e.g., `x[?]a.txt`).
const skip = process.platform === "win32" || !hasFish();

function fishQuote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
}

// Runs fish's own completion machinery (`complete -C`) against the generated
// script, so that the candidates go through the same builtins and utilities
// as in an interactive session.
function completeWithFish(
  directive: string,
  entries: readonly string[],
  word: string,
): {
  readonly candidates: readonly string[];
  readonly stderr: string;
  readonly status: number | null;
} {
  const dir = mkdtempSync(join(tmpdir(), "optique-fish-dash-"));
  try {
    const cwd = join(dir, "work");
    mkdirSync(cwd);
    for (const entry of entries) {
      const path = join(cwd, entry);
      if (entry.endsWith("/")) mkdirSync(path, { recursive: true });
      else {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "");
      }
    }
    const scriptPath = join(dir, "completion.fish");
    writeFileSync(scriptPath, fish.generateScript("fishdashcli"));
    const testPath = join(dir, "test.fish");
    writeFileSync(
      testPath,
      `function fishdashcli
    printf '%s\\t%s\\n' ${fishQuote(directive)} File
end
source ${fishQuote(scriptPath)}
cd ${fishQuote(cwd)}
complete -C ${fishQuote(`fishdashcli -- ${word}`)}
`,
    );
    const result = spawnSync("fish", ["--no-config", testPath], {
      encoding: "utf8",
    });
    const candidates = result.stdout
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => line.split("\t")[0])
      .sort();
    return { candidates, stderr: result.stderr, status: result.status };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function assertCompletions(
  directive: string,
  entries: readonly string[],
  word: string,
  expected: readonly string[],
): void {
  const result = completeWithFish(directive, entries, word);
  deepStrictEqual(result, {
    candidates: [...expected].sort(),
    stderr: "",
    status: 0,
  });
}

describe("fish completion with dash-prefixed filenames", { skip }, () => {
  const echoOptionNames = ["-n", "-e", "-s", "-E", "-ne", "--"];

  it("completes files whose names look like echo options", () => {
    if (skip) return;
    assertCompletions(
      "__FILE__:file:::0",
      [...echoOptionNames, "normal.txt"],
      "",
      [...echoOptionNames, "normal.txt"],
    );
  });

  it("completes dash-prefixed files after a dash", () => {
    if (skip) return;
    assertCompletions(
      "__FILE__:file:::0",
      [...echoOptionNames, "normal.txt"],
      "-",
      echoOptionNames,
    );
  });

  it("completes dash-prefixed files when hidden files are included", () => {
    if (skip) return;
    assertCompletions(
      "__FILE__:file:::1",
      ["-n", ".hidden", "normal.txt"],
      "",
      ["-n", ".hidden", "normal.txt"],
    );
  });

  it("completes dash-prefixed directories without basename errors", () => {
    if (skip) return;
    assertCompletions(
      "__FILE__:directory:::0",
      ["-n/", "-d/", "plain/", "-e"],
      "",
      ["-n/", "-d/", "plain/"],
    );
  });

  it("completes files inside a dash-prefixed directory", () => {
    if (skip) return;
    assertCompletions(
      "__FILE__:file:::0",
      ["-d/-n", "-d/a.txt"],
      "-d/",
      ["-d/-n", "-d/a.txt"],
    );
  });

  // Patterns containing `[` and `?]` take the wildcard branch of the fish
  // script.  `x[?]a.txt` matches `x[?]*` whether or not fish treats `?` as
  // a wildcard.
  it("filters a wildcard pattern under a dash-prefixed directory", () => {
    if (skip) return;
    assertCompletions(
      "__FILE__:file::-d/x[?]*:0",
      ["-d/x[?]a.txt", "-d/y.txt"],
      "",
      ["-d/x[?]a.txt"],
    );
  });

  it("filters a dash-prefixed wildcard pattern", () => {
    if (skip) return;
    assertCompletions(
      "__FILE__:file::-x[?]*:0",
      ["-x[?]a.txt", "b.txt"],
      "",
      ["-x[?]a.txt"],
    );
  });

  it("filters a hidden wildcard pattern under a dash-prefixed directory", () => {
    if (skip) return;
    assertCompletions(
      "__FILE__:file::-d/.x[?]*:0",
      ["-d/.x[?]a", "-d/b"],
      "",
      ["-d/.x[?]a"],
    );
  });
});
