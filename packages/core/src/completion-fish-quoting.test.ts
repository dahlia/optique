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

const fishAvailable = hasFish();

// The stub logs its arguments and answers like choice() or path() would:
// choices are filtered by the current prefix, and file directives echo the
// prefix as their pattern.
const probeScript = `#!/bin/sh
: > "$PROBE_LOG"
for arg do
  printf '%s\\0' "$arg" >> "$PROBE_LOG"
  last=$arg
done
if [ "$PROBE_MODE" = file ]; then
  hidden=0
  case "\${last##*/}" in .*) hidden=1 ;; esac
  printf '__FILE__:file::%s:%s\\tFile\\n' "$last" "$hidden"
else
  for choice in "two words" "two worlds"; do
    case "$choice" in "$last"*) printf '%s\\tChoice\\n' "$choice" ;; esac
  done
fi
`;

// Runs fish's own completion machinery (complete -C) so that the current
// token is tokenized exactly as it is when the user presses Tab.  When
// currentToken is given, the generated function is instead called directly
// with commandline mocked: the previous tokens are the words of commandLine
// and currentToken is returned as typed.
function completeInFish(
  commandLine: string,
  options: {
    readonly mode?: "choice" | "file";
    readonly files?: readonly string[];
    readonly homeFiles?: readonly string[];
    readonly currentToken?: string;
  } = {},
): {
  readonly args: readonly string[];
  readonly completions: readonly string[];
} {
  const dir = mkdtempSync(join(tmpdir(), "optique-fish-quoting-"));
  try {
    const cwd = join(dir, "work");
    const home = join(dir, "home");
    const bin = join(dir, "bin");
    mkdirSync(cwd);
    mkdirSync(home);
    mkdirSync(bin);
    for (
      const [root, files] of [
        [cwd, options.files ?? []],
        [home, options.homeFiles ?? []],
      ] as const
    ) {
      for (const file of files) {
        const path = join(root, file);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "");
      }
    }
    writeFileSync(join(bin, "probecli"), probeScript, { mode: 0o755 });
    const scriptPath = join(dir, "completion.fish");
    writeFileSync(
      scriptPath,
      fish.generateScript("probecli", ["completion", "fish"]),
    );
    const driverPath = join(dir, "driver.fish");
    writeFileSync(
      driverPath,
      options.currentToken == null
        ? "source $argv[1]\ncomplete -C $argv[2]\n"
        : `set -g __probe_line $argv[2]
set -g __probe_token $argv[3]
source $argv[1]
function commandline
    switch $argv[1]
        case -poc
            string split ' ' -- $__probe_line
        case -ct
            printf '%s\\n' $__probe_token
    end
end
__probecli_complete
`,
    );
    const logPath = join(dir, "args.log");
    const stdout = execFileSync(
      "fish",
      [
        driverPath,
        scriptPath,
        commandLine,
        ...(options.currentToken == null ? [] : [options.currentToken]),
      ],
      {
        cwd,
        encoding: "utf8",
        timeout: 10_000,
        env: {
          ...process.env,
          HOME: home,
          XDG_CONFIG_HOME: join(home, ".config"),
          XDG_DATA_HOME: join(home, ".local", "share"),
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          PROBE_LOG: logPath,
          PROBE_MODE: options.mode ?? "choice",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const log = readFileSync(logPath, "utf8");
    ok(log.endsWith("\0"), "The completion command must log its arguments.");
    return {
      args: log.slice(0, -1).split("\0"),
      completions: stdout.split("\n").filter((line) => line.length > 0)
        .map((line) => line.split("\t")[0]),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("fish completion of quoted and escaped current tokens", () => {
  it("passes an unquoted prefix through unchanged", {
    skip: !fishAvailable,
  }, () => {
    if (!fishAvailable) return;
    const result = completeInFish("probecli --format tw");
    deepStrictEqual(result.args, ["completion", "fish", "--format", "tw"]);
    deepStrictEqual(result.completions, ["two words", "two worlds"]);
  });

  for (
    const [input, value] of [
      ['"tw', "tw"],
      ["'tw", "tw"],
      ["two\\ ", "two "],
      ['"two w', "two w"],
    ]
  ) {
    it(`decodes ${input} to ${JSON.stringify(value)}`, {
      skip: !fishAvailable,
    }, () => {
      if (!fishAvailable) return;
      const result = completeInFish(`probecli --format ${input}`);
      deepStrictEqual(result.args, ["completion", "fish", "--format", value]);
      deepStrictEqual([...result.completions].sort(), [
        "two words",
        "two worlds",
      ]);
    });
  }

  it("drops an unfinished trailing backslash", {
    skip: !fishAvailable,
  }, () => {
    if (!fishAvailable) return;
    const result = completeInFish("probecli --format two\\");
    deepStrictEqual(result.args, ["completion", "fish", "--format", "two"]);
  });

  it("keeps a trailing backslash inside single quotes", {
    skip: !fishAvailable,
  }, () => {
    if (!fishAvailable) return;
    const result = completeInFish("probecli --file 'two\\", {
      mode: "file",
      files: ["two/other.txt", "two\\file.txt"],
    });
    deepStrictEqual(result.args.at(-1), "two\\");
    deepStrictEqual(result.completions, ["two\\file.txt"]);
  });

  for (const input of ["", '""', "''"]) {
    it(`passes ${JSON.stringify(input)} as one empty argument`, {
      skip: !fishAvailable,
    }, () => {
      if (!fishAvailable) return;
      const result = completeInFish(`probecli --format ${input}`);
      deepStrictEqual(result.args, ["completion", "fish", "--format", ""]);
      deepStrictEqual(result.completions, ["two words", "two worlds"]);
    });
  }

  // These decode to characters that completion output cannot carry, so the
  // token stays as typed.
  for (const input of ["a\\nb", "two\\n", "a\\tb"]) {
    it(`keeps ${input} as typed`, { skip: !fishAvailable }, () => {
      if (!fishAvailable) return;
      const result = completeInFish(`probecli --format ${input}`);
      deepStrictEqual(result.args, ["completion", "fish", "--format", input]);
    });
  }

  // fish does not run completions for a token it cannot parse, so call the
  // completion function directly to check the fallback.
  it("keeps a malformed escape as typed", { skip: !fishAvailable }, () => {
    if (!fishAvailable) return;
    const result = completeInFish("probecli --format", {
      currentToken: "a\\x",
    });
    deepStrictEqual(result.args, ["completion", "fish", "--format", "a\\x"]);
  });

  for (
    const [input, value] of [
      ['"files/tw', "files/tw"],
      ["'files/tw", "files/tw"],
      ["files/two\\ ", "files/two "],
    ]
  ) {
    it(`completes file names with spaces from ${input}`, {
      skip: !fishAvailable,
    }, () => {
      if (!fishAvailable) return;
      const result = completeInFish(`probecli --file ${input}`, {
        mode: "file",
        files: ["files/two words.txt", "files/two worlds.txt", "other.txt"],
      });
      deepStrictEqual(result.args.at(-1), value);
      deepStrictEqual([...result.completions].sort(), [
        "files/two words.txt",
        "files/two worlds.txt",
      ]);
    });
  }

  it("completes a quoted hidden file prefix", {
    skip: !fishAvailable,
  }, () => {
    if (!fishAvailable) return;
    const result = completeInFish('probecli --file "files/.hid', {
      mode: "file",
      files: ["files/.hidden.txt", "files/visible.txt"],
    });
    deepStrictEqual(result.completions, ["files/.hidden.txt"]);
  });

  it("keeps a quoted tilde literal", { skip: !fishAvailable }, () => {
    if (!fishAvailable) return;
    const result = completeInFish('probecli --file "~/tilde', {
      mode: "file",
      files: ["~/tilde-literal.txt"],
      homeFiles: ["tilde-home.txt"],
    });
    deepStrictEqual(result.completions, ["~/tilde-literal.txt"]);
  });

  it("keeps an escaped tilde literal", { skip: !fishAvailable }, () => {
    if (!fishAvailable) return;
    const result = completeInFish("probecli --file \\~/tilde", {
      mode: "file",
      files: ["~/tilde-literal.txt"],
      homeFiles: ["tilde-home.txt"],
    });
    deepStrictEqual(result.args.at(-1), "~/tilde");
    deepStrictEqual(result.completions, ["~/tilde-literal.txt"]);
  });

  it("still expands an unquoted tilde", { skip: !fishAvailable }, () => {
    if (!fishAvailable) return;
    const result = completeInFish("probecli --file ~/tilde", {
      mode: "file",
      files: ["~/tilde-literal.txt"],
      homeFiles: ["tilde-home.txt"],
    });
    deepStrictEqual(result.completions, ["~/tilde-home.txt"]);
  });

  it("expands a tilde after an unquoted tilde and an escape", {
    skip: !fishAvailable,
  }, () => {
    if (!fishAvailable) return;
    const result = completeInFish("probecli --file ~/two\\ w", {
      mode: "file",
      homeFiles: ["two words.txt"],
    });
    deepStrictEqual(result.args.at(-1), "~/two w");
    deepStrictEqual(result.completions, ["~/two words.txt"]);
  });
});
