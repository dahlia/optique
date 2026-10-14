import { deepStrictEqual, ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { nu } from "./completion.ts";

function hasNu(): boolean {
  if (process.platform === "win32") return false;
  try {
    execFileSync("nu", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const nuAvailable = hasNu();

interface NuRun {
  readonly stdout: string;
  readonly args: readonly string[] | undefined;
}

// Runs Nushell with a generated completion script for a fake CLI named
// "probe" on PATH.  The fake CLI records its arguments NUL-separated and
// prints $PROBE_OUTPUT, which suggests "alpha" and "beta" by default.  The
// callback receives the path of the completion script and returns the
// arguments for `nu`.  The given files are created in the working directory.
function runNu(
  nuArgs: (scriptPath: string) => readonly string[],
  env: Record<string, string> = {},
  files: readonly string[] = [],
): NuRun {
  const dir = mkdtempSync(join(tmpdir(), "optique-nu-tokens-"));
  try {
    const argsPath = join(dir, "args");
    writeFileSync(
      join(dir, "probe"),
      `#!/bin/sh
printf '%s\\0' "$@" > '${argsPath}'
printf '%s' "$PROBE_OUTPUT"
`,
      { mode: 0o755 },
    );
    const cwd = join(dir, "work");
    mkdirSync(cwd);
    for (const file of files) writeFileSync(join(cwd, file), "");
    const scriptPath = join(dir, "completion.nu");
    writeFileSync(scriptPath, nu.generateScript("probe", ["complete"]));
    const stdout = execFileSync(
      "nu",
      ["--no-config-file", ...nuArgs(scriptPath)],
      {
        cwd,
        encoding: "utf8",
        timeout: 30_000,
        env: {
          ...process.env,
          PROBE_OUTPUT: "alpha\t\nbeta\t\n",
          ...env,
          PATH: `${dir}${delimiter}${process.env.PATH ?? ""}`,
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let args: string[] | undefined;
    try {
      args = readFileSync(argsPath, "utf8").slice(0, -1).split("\0");
    } catch {
      args = undefined;
    }
    return { stdout, args };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

interface Completion {
  readonly values: readonly string[];
  readonly args: readonly string[] | undefined;
}

// Runs Nushell code that prints completion values as JSON after sourcing
// the generated completion script.
function runWithScript(
  code: string,
  env: Record<string, string>,
  files: readonly string[] = [],
): Completion {
  const { stdout, args } = runNu(
    (scriptPath) => [
      "-c",
      `source ${JSON.stringify(scriptPath)}\n${code} | get value | to json -r`,
    ],
    env,
    files,
  );
  return { values: JSON.parse(stdout) as string[], args };
}

// Calls the generated callback directly with a command line context.
function complete(
  context: string,
  env: Record<string, string> = {},
  files: readonly string[] = [],
): Completion {
  return runWithScript(
    "nu-complete-probe $env.OPTIQUE_CONTEXT",
    { ...env, OPTIQUE_CONTEXT: context },
    files,
  );
}

// Executes the command line itself, so Nushell decodes the words and passes
// them to the fake CLI.  This is what the completer has to reproduce.
function execute(line: string): readonly string[] | undefined {
  return runNu(() => ["-c", line]).args;
}

describe("Nushell completion argument decoding", () => {
  const cases: readonly (readonly [string, readonly string[]])[] = [
    ['probe --first "" --second a', ["--first", "", "--second", "a"]],
    ["probe --first '' --second a", ["--first", "", "--second", "a"]],
    ["probe --first `` --second a", ["--first", "", "--second", "a"]],
    ['probe --first "" "" --second a', ["--first", "", "", "--second", "a"]],
    ['probe --first "a\\"b" --second a', ["--first", 'a"b', "--second", "a"]],
    ['probe --first "a\\\\b" --second a', ["--first", "a\\b", "--second", "a"]],
    [
      'probe --first "\\u{41}\\t" --second a',
      ["--first", "A\t", "--second", "a"],
    ],
    ["probe --first `a b` --second a", ["--first", "a b", "--second", "a"]],
    ["probe --first=`a b` --second a", ["--first=a b", "--second", "a"]],
    ["probe --first a`b c`d --second a", ["--first", "ab cd", "--second", "a"]],
    ['probe --first `a"b` --second a', ["--first", 'a"b', "--second", "a"]],
    ["probe --first a\\b --second a", ["--first", "a\\b", "--second", "a"]],
    ["probe --first 'a\\b' --second a", ["--first", "a\\b", "--second", "a"]],
    ['probe --first "a b" --second a', ["--first", "a b", "--second", "a"]],
    ['probe --first a"b c"d --second a', ["--first", "ab cd", "--second", "a"]],
    ["probe --first 'it''s' --second a", ["--first", "its", "--second", "a"]],
    ["probe --first r#'a b'# --second a", ["--first", "a b", "--second", "a"]],
    ["probe --first r#''# --second a", ["--first", "", "--second", "a"]],
    [
      "probe --first r##'a'b'## --second a",
      ["--first", "a'b", "--second", "a"],
    ],
    [
      "probe --first=r##'a'b'## --second a",
      ["--first=r##ab'##", "--second", "a"],
    ],
    [
      "probe --first r#'a'#'b'# --second a",
      ["--first", "a'#'b", "--second", "a"],
    ],
    [
      "probe --first r#'a'#r#'b'# --second a",
      ["--first", "a'#r#'b", "--second", "a"],
    ],
    ["probe --first r#'a\nb'# --second a", [
      "--first",
      "a\nb",
      "--second",
      "a",
    ]],
    ['probe --first "a\nb" --second a', ["--first", "a\nb", "--second", "a"]],
  ];

  for (const [context, expected] of cases) {
    it(`passes ${JSON.stringify(context)} as Nushell decodes it`, {
      skip: !nuAvailable,
    }, () => {
      // Bun ignores the skip option, so we need an early return as well:
      if (!nuAvailable) return;
      const result = complete(context);
      deepStrictEqual(result.args, ["complete", ...expected]);
      deepStrictEqual(result.values, ["alpha", "beta"]);
      // The expectation is what Nushell itself passes when running the line:
      deepStrictEqual(execute(context), expected);
    });
  }

  it("completes an option after an empty quoted argument through the hook", {
    skip: !nuAvailable,
  }, () => {
    if (!nuAvailable) return;
    // These are the spans Nushell passes to the external completer when
    // the user presses Tab after `probe --first "" --second a`.
    const result = runWithScript(
      "do $env.config.completions.external.completer " +
        "($env.OPTIQUE_SPANS | from json)",
      {
        OPTIQUE_SPANS: JSON.stringify([
          "probe",
          "--first",
          '""',
          "--second",
          "a",
        ]),
      },
    );
    deepStrictEqual(result.args, ["complete", "--first", "", "--second", "a"]);
    deepStrictEqual(result.values, ["alpha", "beta"]);
  });

  it("adds an empty word after unquoted trailing whitespace", {
    skip: !nuAvailable,
  }, () => {
    if (!nuAvailable) return;
    for (const whitespace of [" ", "\t", "\r", "\n"]) {
      const result = complete(`probe --first "" --second${whitespace}`);
      deepStrictEqual(result.args, [
        "complete",
        "--first",
        "",
        "--second",
        "",
      ]);
    }
  });

  it("completes the quoted word itself while a quote is still open", {
    skip: !nuAvailable,
  }, () => {
    if (!nuAvailable) return;
    const cases: readonly (readonly [string, string])[] = [
      ['probe --first "a ', "a "],
      ["probe --first 'a ", "a "],
      ["probe --first `a ", "a "],
      ['probe --first "a\\" ', 'a" '],
      ["probe --first r#'a b", "a b"],
      ["probe --first r##'a'# ", "a'# "],
      ['probe --first "a\\', "a\\"],
    ];
    for (const [context, word] of cases) {
      const result = complete(context);
      deepStrictEqual(result.args, ["complete", "--first", word], context);
    }
  });

  it("keeps word boundaries around incomplete raw string prefixes", {
    skip: !nuAvailable,
  }, () => {
    if (!nuAvailable) return;
    const cases: readonly (readonly [string, readonly string[]])[] = [
      ["probe --first r#", ["--first", "r#"]],
      ["probe --first r##", ["--first", "r##"]],
      ["probe --first r# ", ["--first", "r#", ""]],
      ["probe --first r## --second a", ["--first", "r##", "--second", "a"]],
      ["probe --first r#x --second a", ["--first", "r#x", "--second", "a"]],
      ["probe --first r#'a\nb", ["--first", "a\nb"]],
    ];
    for (const [context, expected] of cases) {
      const result = complete(context);
      deepStrictEqual(result.args, ["complete", ...expected], context);
    }
  });

  it("keeps the text of an escape Nushell does not know", {
    skip: !nuAvailable,
  }, () => {
    if (!nuAvailable) return;
    const result = complete('probe --first "a\\qb" --second a');
    deepStrictEqual(result.args, [
      "complete",
      "--first",
      "a\\qb",
      "--second",
      "a",
    ]);
    deepStrictEqual(result.values, ["alpha", "beta"]);
  });

  it("still passes an empty word for a bare program name", {
    skip: !nuAvailable,
  }, () => {
    if (!nuAvailable) return;
    for (const context of ["probe", "probe "]) {
      const result = complete(context);
      deepStrictEqual(result.args, ["complete", ""]);
      ok(result.values.includes("alpha"));
    }
  });

  it("uses the open quoted word as the file completion prefix", {
    skip: !nuAvailable,
  }, () => {
    if (!nuAvailable) return;
    const env = { PROBE_OUTPUT: "__FILE__:file:::0\t\n" };
    const files = ["my file.txt", "other.txt"];
    const open = complete('probe --first "my ', env, files);
    // File names with spaces are inserted quoted:
    deepStrictEqual(open.values, ["'my file.txt'"]);
    const next = complete('probe --first "a b" ', env, files);
    deepStrictEqual([...next.values].sort(), ["'my file.txt'", "other.txt"]);
    deepStrictEqual(next.args, ["complete", "--first", "a b", ""]);
  });
});
