import { deepStrictEqual, ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { pwsh } from "./completion.ts";

function available(command: string): boolean {
  try {
    execFileSync(command, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const shellAvailable = process.platform !== "win32" && available("pwsh") &&
  available("bash");

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

interface Match {
  readonly text: string;
  readonly display: string;
  readonly tooltip: string;
  readonly value: string;
  readonly errors: number;
  readonly elements: number;
  readonly constant: boolean;
}

interface Result {
  readonly input: string;
  readonly args: readonly string[];
  readonly matches: readonly Match[];
}

// Drive PowerShell's native completion API and parse its actual replacement.
// The fixture logs argv and filters literal suggestions by the received prefix,
// so PowerShell's fallback completions cannot mask an incorrect parser context.
function complete(
  inputs: readonly string[],
  values: readonly string[],
  files: readonly string[] = [],
): readonly Result[] {
  const outputRoot = fileURLToPath(
    new URL("../../../tmp/review-output/", import.meta.url),
  );
  mkdirSync(outputRoot, { recursive: true });
  const dir = mkdtempSync(join(outputRoot, "pwsh-quoting-"));
  try {
    for (const file of files) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), "");
    }
    const transport = files.length > 0
      ? "printf '__FILE__:file:toml::0\\n'"
      : `for value in ${values.map(shellQuote).join(" ")}; do
  case "$value" in "$prefix"*) printf '%s\\n' "$value" ;; esac
done`;
    writeFileSync(
      join(dir, "quotecli"),
      `#!/bin/bash
printf '%s\\n' "$@" > args.log
for prefix do :; done
${transport}
`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(dir, "completion.ps1"),
      pwsh.generateScript("quotecli", ["completion", "pwsh"]),
    );
    writeFileSync(join(dir, "inputs.json"), JSON.stringify(inputs));
    writeFileSync(
      join(dir, "test.ps1"),
      `$ErrorActionPreference = 'Stop'
$env:PATH = $PWD.Path + [IO.Path]::PathSeparator + $env:PATH
. ./completion.ps1
$results = @(foreach ($inputLine in (Get-Content -Raw inputs.json | ConvertFrom-Json)) {
    $result = [System.Management.Automation.CommandCompletion]::CompleteInput($inputLine, $inputLine.Length, $null)
    $receivedArgs = @(Get-Content args.log)
    $matches = @(foreach ($match in $result.CompletionMatches) {
        $replacement = $inputLine.Substring(0, $result.ReplacementIndex) + $match.CompletionText + $inputLine.Substring($result.ReplacementIndex + $result.ReplacementLength)
        $tokens = $null; $errors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseInput($replacement, [ref]$tokens, [ref]$errors)
        $command = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)
        [PSCustomObject]@{
            text = $match.CompletionText; display = $match.ListItemText; tooltip = $match.ToolTip
            value = $command.CommandElements[-1].Value; errors = $errors.Count; elements = $command.CommandElements.Count
            constant = $command.CommandElements[-1] -is [System.Management.Automation.Language.StringConstantExpressionAst]
        }
    })
    [PSCustomObject]@{ input = $inputLine; args = $receivedArgs; matches = $matches }
})
ConvertTo-Json -InputObject $results -Depth 5 -Compress
`,
    );
    const results: readonly Result[] = JSON.parse(execFileSync(
      "pwsh",
      ["-NoProfile", "-NonInteractive", "-File", "test.ps1"],
      { cwd: dir, encoding: "utf8", timeout: 30_000 },
    ));
    return results;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("PowerShell quoted current value completion", () => {
  it("completes closed, unfinished, empty and smart quoted constants", {
    skip: !shellAvailable,
  }, () => {
    if (!shellAvailable) return;
    const inputs = [
      "quotecli --pick al",
      ...["'", '"', "‘", "“"].flatMap((quote) => [
        `quotecli --pick ${quote}al`,
        `quotecli --pick ${quote}al${quote}`,
        `quotecli --pick ${quote}${quote}`,
      ]),
      "quotecli 'earlier value' --pick 'al",
      "quotecli --pick='al",
    ];
    for (const result of complete(inputs, ["alpha", "alpine"])) {
      const earlier = result.input.includes("earlier value");
      const joined = result.input.includes("--pick=");
      deepStrictEqual(result.args, [
        "completion",
        "pwsh",
        ...(earlier ? ["earlier value"] : []),
        ...(joined ? [] : ["--pick"]),
        joined ? "--pick=al" : /['"‘“]{2}$/.test(result.input) ? "" : "al",
      ], result.input);
      if (joined) {
        // The transport models prefix filtering rather than joined options.
        deepStrictEqual(result.matches, []);
        continue;
      }
      deepStrictEqual(result.matches.map((m) => m.value), ["alpha", "alpine"]);
      for (const match of result.matches) {
        deepStrictEqual(match.errors, 0);
        deepStrictEqual(match.elements, earlier ? 4 : 3);
        deepStrictEqual(match.display, match.value);
        deepStrictEqual(match.tooltip, match.value);
        if (result.input !== inputs[0]) {
          const quote = /['‘]/.test(result.input.split("--pick ")[1])
            ? "'"
            : '"';
          deepStrictEqual(match.text, `${quote}${match.value}${quote}`);
        }
      }
    }
  });

  it("round-trips quote characters, dollars and backticks as literal values", {
    skip: !shellAvailable,
  }, () => {
    if (!shellAvailable) return;
    const values = [
      "a b",
      "a$(touch marker)",
      "a'b",
      'a"b',
      "a$b",
      "a`b",
      ...Array.from(
        { length: 7 },
        (_, i) => `a${String.fromCharCode(0x2018 + i)}b`,
      ),
    ];
    for (
      const result of complete(
        ["quotecli --pick 'a", 'quotecli --pick "a'],
        values,
      )
    ) {
      deepStrictEqual(result.args, ["completion", "pwsh", "--pick", "a"]);
      deepStrictEqual(result.matches.map((m) => m.value), values);
      for (const match of result.matches) {
        deepStrictEqual(match.errors, 0);
        deepStrictEqual(match.elements, 3);
        ok(match.constant);
        deepStrictEqual(match.display, match.value);
        deepStrictEqual(match.tooltip, match.value);
      }
    }
    for (
      const [input, value, prefix] of [
        ["quotecli --pick 'a''", "a'b", "a'"],
        ['quotecli --pick "a`$', "a$b", "a$"],
        ['quotecli --pick "a``', "a`b", "a`"],
        ['quotecli --pick "a`"', 'a"b', 'a"'],
      ]
    ) {
      const [result] = complete([input], [value]);
      deepStrictEqual(result.args, ["completion", "pwsh", "--pick", prefix]);
      deepStrictEqual(result.matches.map((m) => m.value), [value]);
      deepStrictEqual(result.matches[0].errors, 0);
    }
  });

  it("keeps quoted option-name prefixes literal", {
    skip: !shellAvailable,
  }, () => {
    if (!shellAvailable) return;
    for (
      const result of complete(["quotecli '--pi", 'quotecli "--pi'], ["--pick"])
    ) {
      deepStrictEqual(result.args, ["completion", "pwsh", "--pi"]);
      deepStrictEqual(result.matches.map((m) => m.value), ["--pick"]);
      deepStrictEqual(result.matches[0].errors, 0);
      deepStrictEqual(result.matches[0].elements, 2);
      ok(result.matches[0].constant);
    }
  });

  it("quotes filtered file results and keeps quoted tilde paths literal", {
    skip: !shellAvailable,
  }, () => {
    if (!shellAvailable) return;
    for (const prefix of ["dir with spaces/a", "~/a"]) {
      const filename = `${prefix} '$\`’.toml`;
      for (
        const result of complete(
          [`quotecli --file '${prefix}`, `quotecli --file "${prefix}"`],
          [],
          [filename, `${prefix}.txt`],
        )
      ) {
        deepStrictEqual(result.args, ["completion", "pwsh", "--file", prefix]);
        deepStrictEqual(result.matches.map((m) => m.value), [filename]);
        deepStrictEqual(result.matches[0].display, filename);
        deepStrictEqual(result.matches[0].errors, 0);
        deepStrictEqual(result.matches[0].elements, 3);
      }
      const directory = dirname(prefix);
      for (
        const result of complete(
          [`quotecli --file '${directory}'`, `quotecli --file "${directory}"`],
          [],
          [filename, `${prefix}.txt`, `${directory}x.toml`],
        )
      ) {
        deepStrictEqual(result.args, [
          "completion",
          "pwsh",
          "--file",
          directory,
        ]);
        // Listing the directory must not offer its similarly named siblings.
        deepStrictEqual(result.matches.map((m) => m.value), [filename]);
        deepStrictEqual(result.matches[0].display, filename);
        deepStrictEqual(result.matches[0].errors, 0);
        deepStrictEqual(result.matches[0].elements, 3);
      }
    }
    // With no local ~ directory, looking up home would wrongly add a slash.
    for (
      const result of complete(
        ["quotecli --file '~'", 'quotecli --file "~'],
        [],
        ["~x.toml"],
      )
    ) {
      deepStrictEqual(result.args, ["completion", "pwsh", "--file", "~"]);
      deepStrictEqual(result.matches.map((m) => m.value), ["~x.toml"]);
      deepStrictEqual(result.matches[0].errors, 0);
    }
  });

  it("emits regex escapes without embedding smart quote delimiters", () => {
    const script = pwsh.generateScript("quotecli");
    ok(script.includes("\\u2018-\\u201b"));
    ok(script.includes("\\u201c-\\u201e"));
    ok(!/[\u2018-\u201e]/.test(script));
  });
});
