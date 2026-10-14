import { deepStrictEqual, ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative } from "node:path";
import { homedir } from "node:os";
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
  readonly argv: readonly string[];
  readonly exists: boolean;
}

interface Result {
  readonly input: string;
  readonly args: readonly string[];
  readonly matches: readonly Match[];
  readonly navigation?: Result | null;
}

// Drive PowerShell's native completion API and parse its actual replacement.
// The fixture logs argv and filters literal suggestions by the received prefix,
// so PowerShell's fallback completions cannot mask an incorrect parser context.
function complete(
  inputs: readonly string[],
  values: readonly string[],
  files: readonly string[] = [],
  options: {
    readonly joined?: boolean;
    readonly pattern?: string;
    readonly suffix?: string;
    readonly navigate?: boolean;
    readonly rootHome?: boolean;
    readonly records?: string;
  } = {},
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
    // Keep the home-pattern fixture inside the checkout's temporary directory.
    const pattern = options.pattern?.startsWith("~/")
      ? `~/${relative(homedir(), dir).replaceAll("\\", "/")}/${
        options.pattern.slice(2)
      }`
      : options.pattern ?? "";
    const transport = options.records != null
      ? `printf '%s' ${shellQuote(options.records)}`
      : files.length > 0
      ? `printf '%s\\n' ${shellQuote(`__FILE__:file:toml:${pattern}:0`)}
${options.rootHome ? "printf 'root-safe-literal\\n'" : ""}`
      : `for value in ${values.map(shellQuote).join(" ")}; do
  case "$value" in "$prefix"*) printf '%s\\n' "$joined$value" ;; esac
done`;
    writeFileSync(
      join(dir, "quotecli"),
      `#!/bin/bash
if [ "$1" = --verify-file ]; then
  test -e "$2"
  exit $?
fi
printf '%s\\n' "$@" > args.log
for prefix do :; done
joined=''
${
        options.joined
          ? 'case "$prefix" in --pick=*) joined=--pick=; prefix=${prefix#--pick=} ;; esac'
          : ""
      }
${transport}
`,
      { mode: 0o755 },
    );
    writeFileSync(
      join(dir, "completion.ps1"),
      // Inject the edge-case comparison value without changing host HOME.
      // The file provider still uses the real home; a following literal checks
      // that path normalization does not abort the completion output stream.
      options.rootHome
        ? "$fixtureHomePath = '/'\n" +
          pwsh.generateScript("quotecli", ["completion", "pwsh"]).replaceAll(
            /\$HOME\b/g,
            "$fixtureHomePath",
          )
        : pwsh.generateScript("quotecli", ["completion", "pwsh"]),
    );
    writeFileSync(
      join(dir, "inputs.json"),
      JSON.stringify(
        inputs.map((input) => ({
          line: input + (options.suffix ?? ""),
          cursor: input.length,
        })),
      ),
    );
    writeFileSync(
      join(dir, "test.ps1"),
      `$ErrorActionPreference = 'Stop'
$env:PATH = $PWD.Path + [IO.Path]::PathSeparator + $env:PATH
. ./completion.ps1
function Read-QuoteMatches($inputLine, $result) {
    foreach ($match in $result.CompletionMatches) {
        $replacement = $inputLine.Substring(0, $result.ReplacementIndex) + $match.CompletionText + $inputLine.Substring($result.ReplacementIndex + $result.ReplacementLength)
        $tokens = $null; $errors = $null
        $ast = [System.Management.Automation.Language.Parser]::ParseInput($replacement, [ref]$tokens, [ref]$errors)
        $command = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.CommandAst] }, $true)
        & ./quotecli '--verify-file' "$($command.CommandElements[-1].Value)" > $null
        $exists = $LASTEXITCODE -eq 0
        [PSCustomObject]@{
            exists = $exists
            text = $match.CompletionText; display = $match.ListItemText; tooltip = $match.ToolTip
            value = $command.CommandElements[-1].Value; errors = $errors.Count; elements = $command.CommandElements.Count
            constant = $command.CommandElements[-1] -is [System.Management.Automation.Language.StringConstantExpressionAst]
            argv = @($command.CommandElements | ForEach-Object { $_.Value })
        }
    }
}
$results = @(foreach ($inputCase in (Get-Content -Raw inputs.json | ConvertFrom-Json)) {
    $inputLine = $inputCase.line
    $result = [System.Management.Automation.CommandCompletion]::CompleteInput($inputLine, $inputCase.cursor, $null)
    $receivedArgs = @(Get-Content args.log)
    $matches = @(Read-QuoteMatches $inputLine $result)
    $navigation = $null
    if (${options.navigate ? "$true" : "$false"}) {
        $directory = @($result.CompletionMatches | Where-Object { $_.ToolTip -eq 'Directory' })[0]
        $nextLine = $inputLine.Substring(0, $result.ReplacementIndex) + $directory.CompletionText + $inputLine.Substring($result.ReplacementIndex + $result.ReplacementLength)
        $nextResult = [System.Management.Automation.CommandCompletion]::CompleteInput($nextLine, $nextLine.Length, $null)
        $navigation = [PSCustomObject]@{
            input = $nextLine; args = @(Get-Content args.log); matches = @(Read-QuoteMatches $nextLine $nextResult)
        }
    }
    [PSCustomObject]@{ input = $inputLine; args = $receivedArgs; matches = $matches; navigation = $navigation }
})
ConvertTo-Json -InputObject $results -Depth 7 -Compress
`,
    );
    const results: readonly Result[] = JSON.parse(execFileSync(
      "pwsh",
      ["-NoProfile", "-NonInteractive", "-File", "test.ps1"],
      {
        cwd: dir,
        encoding: "utf8",
        timeout: 30_000,
      },
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

  it("keeps quoted joined option suggestions in one literal argument", {
    skip: !shellAvailable,
  }, () => {
    if (!shellAvailable) return;
    const values = ["a b", "a'b", 'a"b', "a$b", "a`b", "a$(touch marker)"];
    const inputs = ["'", '"', "‘", "“"].flatMap((quote) => [
      `quotecli --pick=${quote}a`,
      `quotecli --pick=${quote}a${quote}`,
    ]);
    for (const result of complete(inputs, values, [], { joined: true })) {
      deepStrictEqual(result.args, ["completion", "pwsh", "--pick=a"]);
      deepStrictEqual(
        result.matches.map((m) => m.value),
        values.map((v) => `--pick=${v}`),
      );
      for (const match of result.matches) {
        deepStrictEqual(match.errors, 0);
        deepStrictEqual(match.elements, 2);
        ok(match.constant);
      }
    }
  });

  it("keeps later arguments outside quoted completion context", {
    skip: !shellAvailable,
  }, () => {
    if (!shellAvailable) return;
    for (const joined of [false, true]) {
      const separator = joined ? "=" : " ";
      for (
        const result of complete(
          [`quotecli --pick${separator}'a'`, `quotecli --pick${separator}"a"`],
          ["a b"],
          [],
          { joined, suffix: " --other xyz" },
        )
      ) {
        deepStrictEqual(result.args, [
          "completion",
          "pwsh",
          ...(joined ? ["--pick=a"] : ["--pick", "a"]),
        ]);
        deepStrictEqual(result.matches.length, 1);
        deepStrictEqual(result.matches[0].argv, [
          "quotecli",
          ...(joined ? ["--pick=a b"] : ["--pick", "a b"]),
          "--other",
          "xyz",
        ]);
        deepStrictEqual(result.matches[0].errors, 0);
        deepStrictEqual(result.matches[0].elements, joined ? 4 : 5);
      }
    }
  });

  it("preserves leading and whitespace-only literal suggestions", {
    skip: !shellAvailable,
  }, () => {
    if (!shellAvailable) return;
    const values = [" alpha", "  ", " alpha "];
    for (
      const result of complete(
        ["quotecli --pick ''", 'quotecli --pick ""'],
        values,
      )
    ) {
      deepStrictEqual(result.args, ["completion", "pwsh", "--pick", ""]);
      deepStrictEqual(result.matches.map((m) => m.value), values);
      for (const match of result.matches) {
        deepStrictEqual(match.errors, 0);
        deepStrictEqual(match.elements, 3);
        deepStrictEqual(match.display, match.value);
        deepStrictEqual(match.tooltip, match.value);
      }
    }
  });

  it("skips empty transported literals without losing following candidates", {
    skip: !shellAvailable,
  }, () => {
    if (!shellAvailable) return;
    const records = Array.from(pwsh.encodeSuggestions([
      { kind: "literal", text: "" },
      { kind: "literal", text: "alpha" },
    ])).join("");
    for (
      const result of complete(
        ["quotecli --pick ", "quotecli --pick ''", 'quotecli --pick ""'],
        [],
        [],
        { records },
      )
    ) {
      deepStrictEqual(result.args, ["completion", "pwsh", "--pick", ""]);
      deepStrictEqual(result.matches.map((m) => m.value), ["alpha"]);
      deepStrictEqual(result.matches[0].errors, 0);
      deepStrictEqual(result.matches[0].elements, 3);
    }
  });

  it("quotes literal values that resemble file transport directives", {
    skip: !shellAvailable,
  }, () => {
    if (!shellAvailable) return;
    const values = [
      "__FILE__:file:toml::0",
      "__LITERAL__:__FILE__:file:toml::0",
      "__file__:file:toml::0",
      " __FILE__:file:toml::0 ",
      "__LITERAL__:",
    ];
    const records = Array.from(pwsh.encodeSuggestions(
      values.map((text) => ({ kind: "literal", text })),
    )).join("");
    for (
      const result of complete(
        ["quotecli --pick ''", 'quotecli --pick ""'],
        [],
        [],
        { records },
      )
    ) {
      deepStrictEqual(result.args, ["completion", "pwsh", "--pick", ""]);
      deepStrictEqual(result.matches.map((m) => m.value), values);
      for (const match of result.matches) {
        ok(match.constant);
        deepStrictEqual(match.errors, 0);
        deepStrictEqual(match.elements, 3);
        deepStrictEqual(match.display, match.value);
      }
    }
  });

  it("retains legacy trimming for unquoted literal candidates", {
    skip: !shellAvailable,
  }, () => {
    if (!shellAvailable) return;
    const records = Array.from(pwsh.encodeSuggestions([
      { kind: "literal", text: " __FILE__:directory:::0" },
    ])).join("");
    const result = complete(["quotecli --pick "], [], [], { records })[0];
    deepStrictEqual(result.args, ["completion", "pwsh", "--pick", ""]);
    deepStrictEqual(result.matches.map((m) => m.text), [
      "__FILE__:directory:::0",
    ]);
    deepStrictEqual(result.matches[0].value, "__FILE__:directory:::0");
    deepStrictEqual(result.matches[0].errors, 0);
    deepStrictEqual(result.matches[0].elements, 3);
  });

  it("expands a parser-provided home pattern for empty quoted prefixes", {
    skip: !shellAvailable,
  }, () => {
    if (!shellAvailable) return;
    for (const pattern of ["~/cfg/", "~/cfg/../cfg/"]) {
      for (
        const result of complete(
          ["quotecli --file ''", 'quotecli --file ""'],
          [],
          ["cfg/alpha.toml", "cfg/nested/inside.toml"],
          { pattern, navigate: true },
        )
      ) {
        deepStrictEqual(result.args, ["completion", "pwsh", "--file", ""]);
        deepStrictEqual(result.matches.length, 2);
        deepStrictEqual(
          result.matches.map((m) =>
            m.value.endsWith("/") ? "nested/" : "alpha.toml"
          ).sort(),
          ["alpha.toml", "nested/"],
        );
        for (const match of result.matches) {
          ok(match.exists);
          ok(isAbsolute(match.value));
          ok(
            match.value.endsWith("/cfg/alpha.toml") ||
              match.value.endsWith("/cfg/nested/"),
          );
          deepStrictEqual(match.errors, 0);
          deepStrictEqual(match.elements, 3);
        }
        const navigation = result.navigation;
        ok(navigation);
        const directory = result.matches.find((m) => m.value.endsWith("/"));
        ok(directory);
        deepStrictEqual(navigation.args, [
          "completion",
          "pwsh",
          "--file",
          directory.value,
        ]);
        deepStrictEqual(navigation.matches.length, 1);
        ok(navigation.matches[0].value.endsWith("/cfg/nested/inside.toml"));
        ok(navigation.matches[0].exists);
        deepStrictEqual(navigation.matches[0].errors, 0);
        deepStrictEqual(navigation.matches[0].elements, 3);
      }
    }
  });

  it("keeps parser-provided literal tilde directory patterns relative", {
    skip: !shellAvailable,
  }, () => {
    if (!shellAvailable) return;
    for (const pattern of ["~cfg/", "./~/cfg/"]) {
      const directory = pattern.startsWith("./") ? "~/cfg" : "~cfg";
      for (
        const result of complete(
          ["quotecli --file ''", 'quotecli --file ""'],
          [],
          [`${directory}/alpha.toml`, `${directory}/nested/inside.toml`],
          { pattern, navigate: true },
        )
      ) {
        deepStrictEqual(result.matches.length, 2);
        for (const match of result.matches) {
          ok(match.value.startsWith(pattern));
          ok(match.exists);
          deepStrictEqual(match.errors, 0);
        }
        const navigation = result.navigation;
        ok(navigation);
        deepStrictEqual(navigation.args, [
          "completion",
          "pwsh",
          "--file",
          `${pattern}nested/`,
        ]);
        deepStrictEqual(navigation.matches.map((m) => m.value), [
          `${pattern}nested/inside.toml`,
        ]);
        ok(navigation.matches[0].exists);
        deepStrictEqual(navigation.matches[0].errors, 0);
      }
    }
  });

  it("keeps completion output when the home comparison uses filesystem root", {
    skip: !shellAvailable,
  }, () => {
    if (!shellAvailable) return;
    for (
      const result of complete(
        ["quotecli --file ", "quotecli --file ''", 'quotecli --file ""'],
        [],
        ["unused.toml"],
        { pattern: "~", rootHome: true },
      )
    ) {
      deepStrictEqual(result.args, ["completion", "pwsh", "--file", ""]);
      const literal = result.matches.find((m) =>
        m.value === "root-safe-literal"
      );
      ok(literal);
      deepStrictEqual(literal.errors, 0);
      deepStrictEqual(literal.elements, 3);
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
