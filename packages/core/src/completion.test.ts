import { describe, it } from "node:test";
import { deepStrictEqual, ok, throws } from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";
import {
  bash,
  fish,
  nu,
  pwsh,
  type ShellCompletion,
  zsh,
} from "./completion.ts";
import type { Suggestion } from "./parser.ts";
import { lineBreak, message, text } from "./message.ts";

// Helper functions for shell availability and testing
function getStdoutFromExecError(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;

  const maybeExecError = error as {
    readonly code?: unknown;
    readonly status?: unknown;
    readonly stdout?: unknown;
  };

  // In some environments, successful subprocess execution is reported as
  // EPERM while still returning status 0 and valid stdout.
  if (maybeExecError.code !== "EPERM" || maybeExecError.status !== 0) {
    return undefined;
  }

  if (typeof maybeExecError.stdout === "string") {
    return maybeExecError.stdout;
  }
  if (maybeExecError.stdout instanceof Uint8Array) {
    return new TextDecoder().decode(maybeExecError.stdout);
  }
  return "";
}

function runCommand(
  command: string,
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly input?: string;
    readonly stdio?: "pipe" | "ignore";
    readonly env?: Readonly<Record<string, string>>;
    readonly timeout?: number;
  } = {},
): string {
  try {
    return execFileSync(command, [...args], {
      encoding: "utf8",
      cwd: options.cwd,
      input: options.input,
      stdio: options.stdio,
      env: options.env == null ? undefined : { ...process.env, ...options.env },
      timeout: options.timeout,
    }) ?? "";
  } catch (error) {
    const stdout = getStdoutFromExecError(error);
    if (stdout !== undefined) return stdout;
    throw error;
  }
}

function isShellAvailable(shell: string): boolean {
  try {
    // Try multiple methods to detect shell availability
    runCommand(shell, ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    try {
      runCommand("which", [shell], { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  }
}

function isInteractiveZshCompletionAvailable(): boolean {
  if (!isShellAvailable("zsh")) return false;

  try {
    // Probe required capabilities without spawning a long-lived child shell.
    runCommand(
      "zsh",
      [
        "-fc",
        "autoload -U compinit && zmodload zsh/complist && zmodload zsh/zpty",
      ],
      { stdio: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

function normalizeTerminalOutput(output: string): string {
  let normalized = output
    .replaceAll("\0", "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll("\u0007", "");

  let withoutAnsi = "";
  for (let index = 0; index < normalized.length; index++) {
    if (normalized[index] !== "\u001b") {
      withoutAnsi += normalized[index];
      continue;
    }

    if (index + 1 >= normalized.length) break;
    if (normalized[index + 1] === "[") {
      index += 2;
      while (index < normalized.length) {
        const code = normalized.charCodeAt(index);
        if (code >= 0x40 && code <= 0x7e) break;
        index++;
      }
      continue;
    }

    const nextCode = normalized.charCodeAt(index + 1);
    if (nextCode >= 0x40 && nextCode <= 0x5f) {
      index++;
      continue;
    }

    withoutAnsi += normalized[index];
  }
  normalized = withoutAnsi;

  while (normalized.includes("\b")) {
    let next = "";
    for (const character of normalized) {
      if (character === "\b") {
        next = next.slice(0, -1);
      } else {
        next += character;
      }
    }
    normalized = next;
  }

  return normalized;
}

function testInteractiveZshCompletion(
  script: string,
  directive: string,
  files: readonly (
    | {
      readonly path: string;
      readonly type?: "file";
    }
    | {
      readonly path: string;
      readonly type: "directory";
    }
    | {
      readonly path: string;
      readonly type: "fifo";
    }
    | {
      readonly path: string;
      readonly type: "symlink";
      readonly target: string;
    }
  )[],
  options: {
    readonly withInsecureFpath?: boolean;
    readonly setup?: string;
    readonly payload?: string;
    readonly cliScript?: string;
    readonly input?: string;
    readonly moveLeft?: number;
    readonly tabCount?: number;
    readonly backend?: string;
    readonly captureBuffer?: boolean;
    readonly programNames?: readonly string[];
    readonly autoload?: boolean;
    readonly tabPresses?: 1 | 2;
    readonly additionalScripts?: readonly {
      readonly programName: string;
      readonly script: string;
    }[];
    readonly currentWord?: string;
    readonly afterCompletion?: string;
    readonly prefix?: string;
    readonly absolutePrefix?: boolean;
    readonly expectedArgs?: readonly string[];
    readonly absentFiles?: readonly string[];
  } = {},
): string {
  const tempDir = mkdtempSync(join(tmpdir(), "zsh-completion-integration-"));

  try {
    const binDir = join(tempDir, "bin");
    const workDir = join(tempDir, "work");
    mkdirSync(binDir, { mode: 0o700 });
    chmodSync(binDir, 0o700);
    mkdirSync(workDir);

    const cliPath = join(binDir, "extapp");
    const payloadPath = join(binDir, ".suggestions");
    if (options.payload != null) writeFileSync(payloadPath, options.payload);
    const argsPath = join(binDir, ".args");
    const bufferPath = join(binDir, ".buffer");
    writeFileSync(
      cliPath,
      options.cliScript ?? `#!/bin/bash
printf '%s\\0' "$@" > '${argsPath}'
${
        options.backend ?? (options.payload == null
          ? `printf '%b' '${directive.replaceAll("'", "'\\''")}'`
          : `cat ${JSON.stringify(payloadPath)}`)
      }
`,
      { mode: 0o755 },
    );

    for (const entry of files) {
      const fullPath = join(workDir, entry.path);
      if (entry.type === "directory") {
        mkdirSync(fullPath, { recursive: true });
      } else if (entry.type === "fifo") {
        runCommand("mkfifo", [fullPath]);
      } else if (entry.type === "symlink") {
        symlinkSync(entry.target, fullPath);
      } else {
        writeFileSync(fullPath, "");
      }
    }

    const scriptPath = join(
      binDir,
      options.autoload
        ? `_${options.programNames?.[0] ?? "extapp"}`
        : ".completion.zsh",
    );
    writeFileSync(scriptPath, script);
    for (const additional of options.additionalScripts ?? []) {
      writeFileSync(
        join(binDir, `_${additional.programName}`),
        additional.script,
      );
    }

    const startMarker = "\x1eOPTIQUE_ZSH_COMPLETION_START\x1e";
    const endMarker = "\x1eOPTIQUE_ZSH_COMPLETION_END\x1e";
    const initReadyMarker = "__OPTIQUE_ZSH_INIT_READY__";
    const afterCompletionMarker = "__OPTIQUE_ZSH_AFTER_COMPLETION_DONE__";
    const initPath = join(binDir, ".session.init");
    const insecureFpathDir = join(tempDir, "insecure-fpath");
    if (options.withInsecureFpath === true) {
      mkdirSync(insecureFpathDir);
      chmodSync(insecureFpathDir, 0o777);
    }
    const init = `PS1='PROMPT> '
bindkey -e
function __optique_capture_completion() {
  zle -I
  print -r -- "__OPTIQUE_ZSH_BUFFER__\${BUFFER}__OPTIQUE_ZSH_BUFFER_END__"
  zle reset-prompt
}
zle -N __optique_capture_completion
bindkey '^X' __optique_capture_completion
${options.autoload ? `fpath=(${JSON.stringify(binDir)} $fpath)` : ""}
unsetopt zle_bracketed_paste 2>/dev/null || true
${
      options.withInsecureFpath === true
        ? `fpath=(${JSON.stringify(insecureFpathDir)} $fpath)`
        : ""
    }
autoload -U compinit && compinit -i -D
zmodload zsh/complist
setopt auto_list list_ambiguous
unsetopt list_beep
LISTMAX=0
${options.setup ?? ""}
${
      options.afterCompletion == null
        ? ""
        : `function __optique_after_completion() {
  zle -I
  ${options.afterCompletion}
  print -r -- ${JSON.stringify(afterCompletionMarker)}
  zle reset-prompt
}
zle -N __optique_after_completion
bindkey '^Y' __optique_after_completion`
    }
export PATH=${JSON.stringify(binDir)}:$PATH
${options.autoload ? "" : `source ${JSON.stringify(scriptPath)}`}
cd ${JSON.stringify(workDir)}
${
      options.captureBuffer === true
        ? `function __optique_capture_buffer() {
  print -rn -- "$BUFFER" > '${bufferPath}'
}
zle -N __optique_capture_buffer
bindkey '^Xb' __optique_capture_buffer`
        : ""
    }
print -r -- ${JSON.stringify(initReadyMarker)}
print -rn -- $'\\x1eOPTIQUE_ZSH_COMPLETION_START\\x1e\\n'
`;
    writeFileSync(initPath, init);
    const quoteInput = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

    const driver = `
zmodload zsh/zpty

function __optique_drain_zpty() {
  local sentinel="$1"
  local max_idle="\${2:-80}"
  local buffer=""
  local chunk=""
  local idle=0

  while (( idle < max_idle )); do
    if zpty -r -t child chunk; then
      buffer+="\${chunk}"$'\\n'
      if [[ -n "\${sentinel}" && "\${buffer}" == *"\${sentinel}"* ]]; then
        break
      fi
      idle=0
    else
      sleep 0.05
      (( idle++ ))
    fi
  done

  print -rn -- "\${buffer}"
}

zpty child env TERM=xterm-256color ZDOTDIR=/nonexistent zsh -fi
zpty -w child ${JSON.stringify(`source ${JSON.stringify(initPath)}`)}
sleep 0.5
local __output="$(__optique_drain_zpty ${JSON.stringify(initReadyMarker)})"
${
      (options.programNames ?? ["extapp"]).map((programName) => `
zpty -w -n child ${
        quoteInput(
          options.input ?? `${programName} ${
            options.absolutePrefix
              ? join(workDir, options.prefix ?? options.currentWord ?? "")
              : options.prefix ?? options.currentWord ?? ""
          }`,
        )
      }
sleep 0.1
for (( i=0; i < ${options.moveLeft ?? 0}; i++ )); do
  zpty -w -n child $'\\x02'
done
for (( i=0; i < ${options.tabCount ?? 1}; i++ )); do
  zpty -w -n child $'\\t'
  sleep 0.1
done
${
        options.captureBuffer === true
          ? ""
          : options.tabCount != null || options.tabPresses === 1
          ? ""
          : "zpty -w -n child $'\\t'\nsleep 0.1\n"
      }
${
        options.captureBuffer === true
          ? 'sleep 0.8\nzpty -w -n child $\'\\x18b\'\nsleep 0.1\n__output+="$(__optique_drain_zpty "" 20)"'
          : 'zpty -w -n child $\'\\x18\'\n__output+="$(__optique_drain_zpty "__OPTIQUE_ZSH_BUFFER_END__")"'
      }
zpty -w -n child $'\\x15'
`).join("\n")
    }
${
      options.afterCompletion == null ? "" : `
zpty -w -n child $'\\x19'
__output+="$(__optique_drain_zpty ${JSON.stringify(afterCompletionMarker)})"
`
    }
__output+=$'\\x1eOPTIQUE_ZSH_COMPLETION_END\\x1e\\n'
print -rn -- "$__output"
zpty -d child 2>/dev/null || true
`;

    const rawOutput = runCommand("zsh", ["-fc", driver], {
      cwd: tempDir,
    });

    const startIndex = rawOutput.indexOf(startMarker);
    const endIndex = rawOutput.indexOf(
      endMarker,
      startIndex + startMarker.length,
    );
    ok(
      startIndex >= 0 && endIndex >= 0,
      `Missing completion markers in output:\n${
        normalizeTerminalOutput(rawOutput)
      }`,
    );

    if (options.expectedArgs != null) {
      deepStrictEqual(
        readFileSync(argsPath, "utf8").split("\0").slice(0, -1),
        options.expectedArgs,
      );
    }
    for (const file of options.absentFiles ?? []) {
      ok(!existsSync(join(workDir, file)), `Completion executed ${file}.`);
    }
    if (options.captureBuffer === true) {
      return readFileSync(bufferPath, "utf8");
    }
    return normalizeTerminalOutput(
      rawOutput.slice(startIndex + startMarker.length, endIndex),
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function createTestCli(tempDir: string): string {
  const cliScript = `#!/bin/bash
case "$1" in
  "completion")
    if [[ "$2" == "bash" ]]; then
      echo "git"
      echo "docker"
    elif [[ "$2" == "zsh" ]]; then
      echo "git\\0Git operations\\0"
      echo "docker\\0Docker container operations\\0"
    elif [[ "$2" == "fish" ]]; then
      echo -e "git\\tGit operations"
      echo -e "docker\\tDocker container operations"
    elif [[ "$2" == "nu" ]]; then
      echo -e "git\\tGit operations"
      echo -e "docker\\tDocker container operations"
    fi
    ;;
  *)
    echo "Unknown command"
    exit 1
    ;;
esac
`;

  const cliPath = join(tempDir, "test-cli");
  writeFileSync(cliPath, cliScript, { mode: 0o755 });
  return cliPath;
}

function testBashCompletion(
  script: string,
  programName: string,
  cliDir: string,
): string[] {
  const tempDir = mkdtempSync(join(tmpdir(), "bash-completion-test-"));

  try {
    const scriptPath = join(tempDir, "completion.bash");
    writeFileSync(scriptPath, script);

    // Extract function name from the script
    const functionMatch = script.match(/function (_[^\s()]+) /);
    const functionName = functionMatch ? functionMatch[1] : "_test_cli";

    // Test completion by sourcing script and calling completion function
    // Add cliDir to PATH so the program can be found
    const testScript = `
export PATH="${cliDir}:$PATH"
source "${scriptPath}"
COMP_WORDS=("${programName}" "")
COMP_CWORD=1
${functionName}
printf "%s\\n" "\${COMPREPLY[@]}"
`;

    const result = runCommand("bash", ["-c", testScript], {
      cwd: tempDir,
    });

    return result.trim().split("\n").filter((line) => line.length > 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function testZshCompletion(
  script: string,
  programName: string,
  cliDir: string,
): string[] {
  const tempDir = mkdtempSync(join(tmpdir(), "zsh-completion-test-"));

  try {
    const scriptPath = join(tempDir, "completion.zsh");
    writeFileSync(scriptPath, script);

    // Create a test script that simulates zsh completion
    // Add cliDir to PATH so the program can be found
    const testScript = `
export PATH="${cliDir}:$PATH"
autoload -U compinit && compinit -D
source "${scriptPath}"

# Mock zsh completion environment
words=("${programName}" "")
CURRENT=2

# Capture completion output
{
  ${/[.-]/.test(programName) ? `_optique:${programName}` : `_${programName}`}
} 2>/dev/null || true
`;

    // For zsh, we'll test if the function runs without error
    // and check that the script generates the expected structure
    runCommand("zsh", ["-c", testScript], {
      cwd: tempDir,
      stdio: "ignore",
    });

    // Return success indicator - actual completion testing in zsh is complex
    // due to the completion system's integration requirements
    return ["success"];
  } catch (error) {
    throw new Error(`Zsh completion test failed: ${error}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function testPwshCompletion(
  script: string,
  _programName: string,
  cliDir: string,
): string[] {
  const tempDir = mkdtempSync(join(tmpdir(), "pwsh-completion-test-"));

  try {
    const scriptPath = join(tempDir, "completion.ps1");
    writeFileSync(scriptPath, script);

    // Test by directly calling the completion command
    // This avoids dependency on Get-ArgumentCompleter (PowerShell 7.4+)
    // Add cliDir to PATH so the program can be found
    const pathSep = process.platform === "win32" ? ";" : ":";
    const testScript = `
$env:PATH = "${cliDir}${pathSep}$env:PATH"
. "${scriptPath}"

# Just verify the script loads without error
Write-Output "loaded"
`;

    const result = runCommand(
      "pwsh",
      ["-NoProfile", "-NonInteractive", "-Command", testScript],
      { cwd: tempDir },
    );

    // Return success indicator - full integration testing requires PowerShell 7.4+
    return result.trim().includes("loaded") ? ["success"] : [];
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function testFishCompletion(
  script: string,
  programName: string,
  cliDir: string,
): string[] {
  const tempDir = mkdtempSync(join(tmpdir(), "fish-completion-test-"));

  try {
    const scriptPath = join(tempDir, "completion.fish");
    writeFileSync(scriptPath, script);

    // Extract function name from the script
    const functionMatch = script.match(/function ([^\s]+)/);
    const functionName = functionMatch
      ? functionMatch[1]
      : "__test_cli_complete";

    // Test completion by sourcing script and calling completion function
    // We simulate fish's completion environment
    // Add cliDir to PATH so the program can be found
    const testScript = `
set -x PATH "${cliDir}" $PATH
source "${scriptPath}"

# Mock fish completion environment
function commandline
    switch $argv[1]
        case '-poc'
            # Return previous tokens (command and empty string for current)
            echo "${programName}"
            echo ""
        case '-ct'
            # Return current token being completed
            echo ""
    end
end

# Call the completion function
${functionName}
`;

    // Write test script to a file to avoid escaping issues
    const testScriptPath = join(tempDir, "test.fish");
    writeFileSync(testScriptPath, testScript);

    const result = runCommand("fish", [testScriptPath], { cwd: tempDir });

    return result.trim().split("\n").filter((line) => line.length > 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function testNuCompletion(
  script: string,
  programName: string,
  cliDir: string,
): string[] {
  const tempDir = mkdtempSync(join(tmpdir(), "nu-completion-test-"));

  try {
    const scriptPath = join(tempDir, "completion.nu");
    writeFileSync(scriptPath, script);

    // Test completion by loading script and calling completion function directly
    // Use the sanitized function name that matches generateScript's naming
    const safeName = programName.replace(/[^a-zA-Z0-9]+/g, "-");
    const functionName = `nu-complete-${safeName}`;
    // Add cliDir to PATH so the program can be found
    const testScript = `
$env.PATH = ($env.PATH | prepend "${cliDir}")
source ${scriptPath}

# Call the completion function with the command context using 'do'
do { ${functionName} "${programName} " }
`;

    // Write test script to a file to avoid escaping issues
    const testScriptPath = join(tempDir, "test.nu");
    writeFileSync(testScriptPath, testScript);

    let result: string;
    try {
      result = runCommand("nu", [testScriptPath], { cwd: tempDir });
    } catch {
      // If execution failed, return empty array
      return [];
    }

    // Parse Nushell table output to extract completion values
    const lines = result.trim().split("\n");
    const completions: string[] = [];

    for (const line of lines) {
      // Match table rows with 3 columns: # | value | description
      // Example: │ 0 │ git    │ Git operations              │
      const match = line.match(/│\s*\d+\s*│\s*([^│]+)\s*│\s*([^│]+)\s*│/);
      if (match) {
        const value = match[1]?.trim();
        if (value) {
          completions.push(value);
        }
      }
    }

    return completions;
  } finally {
    // Clean up temp directory
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

function createNuSymlinkFixtures(workDir: string): void {
  writeFileSync(join(workDir, "target.txt"), "");
  writeFileSync(join(workDir, "target.md"), "");
  mkdirSync(join(workDir, "targetdir"));
  writeFileSync(join(workDir, "targetdir", "inner.txt"), "");
  symlinkSync("target.txt", join(workDir, "link.txt"));
  symlinkSync("target.md", join(workDir, "link.md"));
  // Extensions are judged by the link's own name, not its target's:
  symlinkSync("target.md", join(workDir, "linkmixed.txt"));
  symlinkSync("target.txt", join(workDir, "linkmixed.md"));
  symlinkSync("targetdir", join(workDir, "linkdir"));
  symlinkSync("targetdir", join(workDir, "linkdir2"));
  symlinkSync("linkdir", join(workDir, "linkchain"));
  symlinkSync("missing.txt", join(workDir, "broken.txt"));
  symlinkSync("loopb.txt", join(workDir, "loopa.txt"));
  symlinkSync("loopa.txt", join(workDir, "loopb.txt"));
  const hiddenDir = join(workDir, "hid");
  mkdirSync(hiddenDir);
  writeFileSync(join(hiddenDir, ".secret.txt"), "");
  symlinkSync("../target.txt", join(hiddenDir, ".hidlink.txt"));
  symlinkSync(".secret.txt", join(hiddenDir, "shown.txt"));
}

function runNuFileCompletion(
  directive: string,
  prefix: string,
  workDir: string,
  nuCwd?: string,
): string[] {
  const tempDir = mkdtempSync(join(tmpdir(), "nu-file-completion-"));

  try {
    writeFileSync(
      join(tempDir, "linkapp"),
      `#!/bin/bash\nprintf '%s\\n' '${directive}'\n`,
      { mode: 0o755 },
    );
    const scriptPath = join(tempDir, "completion.nu");
    writeFileSync(scriptPath, nu.generateScript("linkapp"));
    const testScriptPath = join(tempDir, "test.nu");
    writeFileSync(
      testScriptPath,
      `
$env.PATH = ($env.PATH | prepend ${JSON.stringify(tempDir)})
source ${JSON.stringify(scriptPath)}
${nuCwd == null ? "" : `cd ${JSON.stringify(nuCwd)}`}
print (nu-complete-linkapp ${
        JSON.stringify(`linkapp ${prefix}`)
      } | get value | to json -r)
`,
    );
    const output = runCommand("nu", [testScriptPath], { cwd: workDir });
    const values: unknown = JSON.parse(output);
    ok(Array.isArray(values), `Unexpected Nushell output: ${output}`);
    return values.map(String).sort();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

interface NuCompletionRecord {
  readonly value: string;
  readonly display_override?: string;
  readonly description?: string;
}

interface NuQuotingFixture {
  readonly tempDir: string;
  readonly binDir: string;
  readonly workDir: string;
  readonly programName: string;
  readonly scriptPath: string;
}

// A fake CLI for Nushell quoting tests.  When the generated completer calls
// it with the "__complete" prefix, it emits a native file completion
// directive after --file (including hidden files after --any-file), and
// otherwise the lines of suggestions.txt
// (value, optionally followed by a tab and a description) that start with
// the current prefix, and counts the call in completions.log.  When run
// normally, it prints its argv so that tests can see what Nushell passed
// to it.
const nuQuotingCli = `#!/bin/bash
if [[ "$1" == "__complete" ]]; then
  shift
  prefix=""
  previous=""
  if (( $# >= 1 )); then prefix="\${@: -1}"; fi
  if (( $# >= 2 )); then previous="\${@: -2:1}"; fi
  if [[ "$previous" == "--file" ]]; then
    printf '__FILE__:file:::0\\n'
  elif [[ "$previous" == "--any-file" ]]; then
    printf '__FILE__:file:::1\\n'
  else
    while IFS= read -r line; do
      if [[ "$line" == "$prefix"* ]]; then printf '%s\\n' "$line"; fi
    done < "$(dirname "$0")/suggestions.txt"
  fi
  printf 'x' >> "$(dirname "$0")/completions.log"
  exit 0
fi
printf 'ARGV:'
printf '<%s>' "$@"
printf ':END\\n'
`;

// A fake CLI that suggests the arguments it received, so tests can see how
// the generated completer tokenized the command line.
const nuArgsEchoCli = `#!/bin/bash
shift
printf 'ARGS'
printf '<%s>' "$@"
printf '\\n'
`;

function createNuQuotingFixture(
  cli: string,
  suggestions: readonly string[] = [],
): NuQuotingFixture {
  const tempDir = mkdtempSync(join(tmpdir(), "nu-quoting-"));
  const binDir = join(tempDir, "bin");
  const workDir = join(tempDir, "work");
  mkdirSync(binDir);
  mkdirSync(workDir);
  const programName = "quotecli";
  writeFileSync(join(binDir, programName), cli, { mode: 0o755 });
  writeFileSync(
    join(binDir, "suggestions.txt"),
    suggestions.map((suggestion) => `${suggestion}\n`).join(""),
  );
  writeFileSync(join(binDir, "completions.log"), "");
  writeFileSync(
    join(binDir, "argv-printer"),
    `#!/bin/bash\nprintf '%s\\0' "$@"\n`,
    { mode: 0o755 },
  );
  const scriptPath = join(binDir, "completion.nu");
  writeFileSync(scriptPath, nu.generateScript(programName, ["__complete"]));
  return { tempDir, binDir, workDir, programName, scriptPath };
}

function runNuCompleter(
  fixture: NuQuotingFixture,
  context: string,
  env?: Readonly<Record<string, string>>,
): readonly NuCompletionRecord[] {
  // Pass the context through a file to avoid quoting it as Nushell source.
  const contextPath = join(fixture.tempDir, "context.txt");
  writeFileSync(contextPath, context);
  const testScriptPath = join(fixture.tempDir, "test.nu");
  writeFileSync(
    testScriptPath,
    `$env.PATH = ($env.PATH | prepend ${JSON.stringify(fixture.binDir)})
source ${JSON.stringify(fixture.scriptPath)}
nu-complete-${fixture.programName} (open --raw ${
      JSON.stringify(contextPath)
    }) | to json --raw
`,
  );
  const output = runCommand("nu", ["--no-config-file", testScriptPath], {
    cwd: fixture.workDir,
    env,
  });
  return JSON.parse(output.trim());
}

// Parses the given words as arguments to an external command with
// Nushell's own parser and returns the argv the command received.
function parseNuExternalArguments(
  fixture: NuQuotingFixture,
  words: readonly string[],
  env?: Readonly<Record<string, string>>,
): readonly string[] {
  const printer = JSON.stringify(join(fixture.binDir, "argv-printer"));
  const output = runCommand(
    "nu",
    ["--no-config-file", "-c", `^${printer} ${words.join(" ")}`],
    { cwd: fixture.workDir, env },
  );
  return output.split("\0").slice(0, -1);
}

function quoteForZsh(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isInteractiveNuCompletionAvailable(): boolean {
  if (process.platform === "win32") return false;
  return isShellAvailable("nu") && isInteractiveZshCompletionAvailable();
}

// Drives an interactive Nushell session through zsh's zpty.  Each
// interaction is a sequence of keystroke chunks (e.g., a command line
// followed by a Tab); after a Tab, the driver waits until the fake CLI has
// been called for completion and Nushell has redrawn the line.  Enter is
// then pressed and the argv that the fake CLI received is collected.
function testInteractiveNuCompletion(
  fixture: NuQuotingFixture,
  interactions: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  const binDir = JSON.stringify(fixture.binDir);
  const scriptPath = JSON.stringify(fixture.scriptPath);
  // The readiness marker is built by concatenation so that the echoed
  // command line does not contain it:
  const init = `$env.PATH = ($env.PATH | prepend ${binDir}); ` +
    `source ${scriptPath}; print ("OPTIQUE_NU_" + "READY")`;
  const typeInteractions = interactions.map((chunks) =>
    chunks.map((chunk) =>
      chunk === "\t"
        ? `
__optique_before="$(__optique_completion_count)"
zpty -w -n child $'\\t'
__optique_wait_completion "$__optique_before"
`
        : `
zpty -w -n child ${quoteForZsh(chunk)}
__optique_drain_nu "" 20 >/dev/null
`
    ).join("") + `
zpty -w -n child $'\\r'
__output+="$(__optique_drain_nu ':END' 400)"
__optique_drain_nu "" 10 >/dev/null
`
  ).join("");
  const driver = `
zmodload zsh/zpty

# Reads the child's output until the sentinel appears or it stays idle.
# Reedline asks for the cursor position (ESC [ 6 n) and waits for the
# answer, so reply as a terminal would.
function __optique_drain_nu() {
  local sentinel="$1"
  local max_idle="\${2:-80}"
  local buffer=""
  local chunk=""
  local idle=0
  local answered=0
  local requests=0
  local rest=""

  while (( idle < max_idle )); do
    if zpty -r -t child chunk; then
      buffer+="\${chunk}"
      # Count requests in the whole buffer so that one split across reads
      # is still answered, and answer each request only once:
      rest="\${buffer//$'\\e[6n'/}"
      requests=$(( (\${#buffer} - \${#rest}) / 4 ))
      while (( answered < requests )); do
        zpty -w -n child $'\\e[1;1R'
        (( answered++ ))
      done
      if [[ -n "\${sentinel}" && "\${buffer}" == *"\${sentinel}"* ]]; then
        break
      fi
      idle=0
    else
      sleep 0.05
      (( idle++ ))
    fi
  done

  print -rn -- "\${buffer}"
}

function __optique_completion_count() {
  local log="$(<${JSON.stringify(join(fixture.binDir, "completions.log"))})"
  print -rn -- "\${#log}"
}

# Waits until a Tab has had an effect (a completion call or a redraw), and
# then until Nushell stays quiet without calling the fake CLI again.
function __optique_wait_completion() {
  local before="$1"
  local count=0
  local output=""
  local seen=0
  local waited=0
  while (( waited < 60 )); do
    count="$(__optique_completion_count)"
    output="$(__optique_drain_nu "" 40)"
    if [[ -n "\${output}" ]] || (( count > before )); then
      seen=1
    fi
    if (( seen )) && [[ -z "\${output}" ]] &&
        (( $(__optique_completion_count) == count )); then
      break
    fi
    (( waited++ ))
  done
}

zpty child env TERM=xterm-256color \\
  XDG_CONFIG_HOME=${JSON.stringify(join(fixture.tempDir, "config"))} \\
  XDG_DATA_HOME=${JSON.stringify(join(fixture.tempDir, "data"))} \\
  zsh -fc 'stty rows 50 cols 200; exec nu --no-config-file'
__optique_drain_nu $'\\e[6n' 200 >/dev/null
zpty -w child ${quoteForZsh(init)}
__optique_drain_nu "OPTIQUE_NU_READY" 200 >/dev/null
local __output=""
${typeInteractions}
print -rn -- "$__output"
zpty -d child 2>/dev/null || true
`;

  const output = runCommand("zsh", ["-fc", driver], {
    cwd: fixture.workDir,
    timeout: 300_000,
  });
  return [...normalizeTerminalOutput(output).matchAll(/ARGV:(.*?):END/g)]
    .map((match) => [...(match[1] ?? "").matchAll(/<([^<>]*)>/g)])
    .map((args) => args.map((arg) => arg[1] ?? ""));
}

/**
 * Runs the generated Nushell completer against a stub CLI that emits a
 * `.txt` file suggestion with the given pattern, and returns the completion
 * values (sorted) as they would be inserted, quoted where Nushell needs it.  The `argument` is the last token exactly as typed in
 * Nushell, including any quotes, and must not contain single quotes.
 */
function testNuFileCompletion(
  cwd: string,
  pattern: string,
  argument: string,
): string[] {
  const programName = "nu-file-cli";
  const tempDir = mkdtempSync(join(tmpdir(), "nu-file-completion-"));

  try {
    const directive = Array.from(nu.encodeSuggestions([
      {
        kind: "file",
        type: "file",
        extensions: [".txt"],
        pattern,
        includeHidden: false,
        description: message`File`,
      },
    ])).join("");
    const directivePath = join(tempDir, "directive.txt");
    writeFileSync(directivePath, `${directive}\n`);
    writeFileSync(
      join(tempDir, programName),
      `#!/bin/bash\ncat '${directivePath}'\n`,
      { mode: 0o755 },
    );

    const scriptPath = join(tempDir, "completion.nu");
    writeFileSync(scriptPath, nu.generateScript(programName));

    const context = `${programName} ${argument}`;
    const testScriptPath = join(tempDir, "test.nu");
    writeFileSync(
      testScriptPath,
      `
$env.PATH = ($env.PATH | prepend '${tempDir}')
source '${scriptPath}'
print (nu-complete-${programName} '${context}' | to json -r)
`,
    );

    const result = runCommand("nu", [testScriptPath], { cwd });
    const json = result.trim().split("\n").findLast((line) =>
      line.startsWith("[")
    );
    ok(json != null, `Expected JSON output from Nushell, got: ${result}`);
    const items: readonly { readonly value: string }[] = JSON.parse(json);
    return items.map((item) => item.value).sort();
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("completion function name collisions", () => {
  const programs = ["foo-bar", "foo_bar", "foo.bar", "foo-bar.js"];
  const literals = ["first", "second", "third", "fourth"];

  for (const shell of [zsh, fish]) {
    it(`${shell.name} keeps distinct valid program names separate`, () => {
      const names = [
        ...programs,
        "foo__bar",
        "foo--bar",
        "foo..bar",
        "foo_2dbar",
        "_foo-bar",
        "0foo-bar",
        "Foo-bar",
      ];
      const helpers = names.map((name) => {
        const script = shell.generateScript(name);
        const helper = script.match(/^function (\S+)/m)?.[1];
        ok(helper, `${shell.name} omitted the helper for ${name}`);
        if (shell === zsh) {
          ok(script.includes(`compdef ${helper} ${name}`));
        } else {
          ok(script.includes(`complete -c ${name} -f -a '(${helper})'`));
        }
        return helper;
      });
      deepStrictEqual(new Set(helpers).size, names.length);
    });
  }

  it("zsh preserves existing plain-name helpers and avoids autoload names", () => {
    for (const name of ["myapp", "foo_bar", "_foo", "0foo"]) {
      ok(zsh.generateScript(name).includes(`function _${name} ()`));
    }
    for (const name of ["foo-bar", "foo.bar", "path-files", "git-add"]) {
      const script = zsh.generateScript(name);
      const helper = script.match(/^function (\S+)/m)?.[1];
      ok(helper);
      ok(
        helper.includes(":"),
        `Helper can overlap an autoload name: ${helper}`,
      );
    }
  });

  for (const reversed of [false, true]) {
    const order = reversed ? [...programs].reverse() : programs;
    for (const autoload of [false, true]) {
      it(
        `fish retains each command with ${
          autoload ? "lazy loading" : "sourcing"
        }, ${reversed ? "reverse" : "forward"} order`,
        {
          skip: !isShellAvailable("fish"),
        },
        () => {
          if (!isShellAvailable("fish")) return;
          const tempDir = mkdtempSync(join(tmpdir(), "fish-name-collisions-"));
          try {
            for (const name of programs) {
              writeFileSync(
                join(tempDir, `${name}.fish`),
                fish.generateScript(name),
              );
            }
            const definitions = programs.map((name, index) => `
function ${name}
  if test (count $argv) -eq 1
    printf '${literals[index]}\\t${literals[index]}\\n'
  end
end
`).join("\n");
            const loading = autoload
              ? `set fish_complete_path '${tempDir}' $fish_complete_path`
              : order.map((name) => `source '${join(tempDir, `${name}.fish`)}'`)
                .join("\n");
            const requests = [...order, ...order];
            const output = runCommand("fish", [
              "--no-config",
              "-c",
              `${definitions}\n${loading}\n${
                requests.map((name) => `complete -C '${name} '`).join("\n")
              }`,
            ]);
            deepStrictEqual(
              output.trim().split("\n"),
              requests.map((name) => {
                const literal = literals[programs.indexOf(name)];
                return `${literal}\t${literal}`;
              }),
            );
          } finally {
            rmSync(tempDir, { recursive: true, force: true });
          }
        },
      );

      it(
        `zsh retains each command with ${
          autoload ? "autoloading" : "sourcing"
        }, ${reversed ? "reverse" : "forward"} order`,
        {
          skip: !isInteractiveZshCompletionAvailable(),
          timeout: 20_000,
        },
        () => {
          if (!isInteractiveZshCompletionAvailable()) return;
          const setup = programs.map((name, index) => `
function ${name}() {
  if (( $# == 1 )); then
    printf '${literals[index]}\\0${literals[index]}\\0'
  fi
}
`).join("\n");
          const requests = [...order, ...order];
          const output = testInteractiveZshCompletion(
            autoload
              ? zsh.generateScript(order[0])
              : order.map((name) => zsh.generateScript(name)).join("\n"),
            "",
            [],
            {
              setup,
              programNames: requests,
              autoload,
              tabPresses: 1,
              additionalScripts: autoload
                ? order.slice(1).map((programName) => ({
                  programName,
                  script: zsh.generateScript(programName),
                }))
                : [],
            },
          );
          const buffers = Array.from(
            output.matchAll(
              /__OPTIQUE_ZSH_BUFFER__(.*?)__OPTIQUE_ZSH_BUFFER_END__/g,
            ),
            (match) => match[1].trim(),
          );
          deepStrictEqual(
            buffers,
            requests.map((name) =>
              `${name} ${literals[programs.indexOf(name)]}`
            ),
            output,
          );
        },
      );
    }
  }
});

describe("compound extensions", () => {
  for (const shell of [pwsh, nu]) {
    for (const type of ["file", "any"] as const) {
      it(
        `should filter compound extensions in actual ${shell.name} ${type} completion`,
        {
          skip: process.platform === "win32" || !isShellAvailable(shell.name),
          timeout: 30000,
        },
        () => {
          // Bun ignores the skip option, so it also needs an early return.
          if (
            process.platform === "win32" || !isShellAvailable(shell.name)
          ) return;

          const scratchRoot = fileURLToPath(
            new URL("../../../tmp/", import.meta.url),
          );
          mkdirSync(scratchRoot, { recursive: true });
          const tempDir = mkdtempSync(
            join(scratchRoot, "compound-completion-"),
          );
          try {
            const files = [
              "bundle.tar.gz",
              "bundle.TAR.GZ",
              "bundle.txt",
              "bundle.gz",
              "bundle.tarXgz",
              "bundle.tar.gz.bak",
              "bundletar.gz",
              "bundle.json",
              "bundle.tar[1].gz",
              "bundle.tar1.gz",
              "alpha.tar.gz",
            ];
            for (const file of files) writeFileSync(join(tempDir, file), "");
            mkdirSync(join(tempDir, "bdir"));
            mkdirSync(join(tempDir, "adir"));

            const programName = "compound-extapp";
            const scriptPath = join(
              tempDir,
              `completion.${shell === pwsh ? "ps1" : "nu"}`,
            );
            writeFileSync(scriptPath, shell.generateScript(programName));
            const testPath = join(
              tempDir,
              `test.${shell === pwsh ? "ps1" : "nu"}`,
            );
            const testScript = shell === pwsh
              ? `$env:PATH = '${tempDir}' + [IO.Path]::PathSeparator + $env:PATH
. '${scriptPath}'
$line = '${programName} --archive __PREFIX__'
$result = [System.Management.Automation.CommandCompletion]::CompleteInput($line, $line.Length, $null)
ConvertTo-Json -Compress -InputObject @($result.CompletionMatches | ForEach-Object { $_.CompletionText })
`
              : `$env.PATH = ($env.PATH | prepend '${tempDir}')
source '${scriptPath}'
nu-complete-${programName} '${programName} --archive __PREFIX__' | get value | to json --raw
`;
            writeFileSync(testPath, testScript);

            const complete = (
              extensions: readonly string[],
              rawDots = false,
              prefix = "b",
            ): string[] => {
              writeFileSync(
                testPath,
                testScript.replaceAll("__PREFIX__", prefix),
              );
              let directive = Array.from(shell.encodeSuggestions([{
                kind: "file",
                type,
                extensions,
                pattern: prefix,
              }])).join("");
              if (rawDots) {
                directive = directive.replace(
                  `:${
                    extensions.map((ext) => ext.replace(/^\./, "")).join(",")
                  }:`,
                  `:${extensions.join(",")}:`,
                );
              }
              writeFileSync(
                join(tempDir, programName),
                `#!/bin/sh\nprintf '%s\\n' '${directive}'\n`,
                { mode: 0o755 },
              );
              const output = runCommand(
                shell.name,
                shell === pwsh
                  ? ["-NoProfile", "-NonInteractive", "-File", testPath]
                  : ["--no-config-file", testPath],
                { cwd: tempDir },
              );
              const values: unknown = JSON.parse(output);
              ok(Array.isArray(values));
              ok(values.every((value: unknown) => typeof value === "string"));
              return values.sort();
            };

            const archives = ["bundle.tar.gz"];
            for (const rawDots of [false, true]) {
              deepStrictEqual(
                complete([".tar.gz"], rawDots),
                ["bdir/", ...archives].sort(),
              );
              deepStrictEqual(
                complete([".TAR.GZ"], rawDots),
                ["bdir/", "bundle.TAR.GZ"].sort(),
              );
              deepStrictEqual(
                complete([".tar.gz", ".json"], rawDots),
                ["bdir/", "bundle.json", ...archives].sort(),
              );
              deepStrictEqual(
                complete([".tar[1].gz"], rawDots),
                [
                  "bdir/",
                  "'bundle.tar[1].gz'",
                ].sort(),
              );
            }
            for (
              const file of [
                "inner.tar.gz",
                "inner.txt",
                "inner.gz",
                "x.tar.gz",
              ]
            ) {
              writeFileSync(join(tempDir, "bdir", file), "");
            }
            mkdirSync(join(tempDir, "bdir", "sub"));
            deepStrictEqual(
              complete([".tar.gz"], false, "bdir/"),
              ["bdir/inner.tar.gz", "bdir/sub/", "bdir/x.tar.gz"],
            );
            deepStrictEqual(
              complete([".tar.gz"], false, "bdir/i"),
              ["bdir/inner.tar.gz"],
            );
            // With no matching directory, exercise PowerShell's fallback path.
            rmSync(join(tempDir, "bdir"), { recursive: true });
            deepStrictEqual(complete(["tar.gz"]), archives.sort());
          } finally {
            rmSync(tempDir, { recursive: true, force: true });
          }
        },
      );
    }
  }
});

describe("completion module", () => {
  describe("bash shell completion", () => {
    it("should have correct name", () => {
      deepStrictEqual(bash.name, "bash");
    });

    it("should generate proper completion script", () => {
      const script = bash.generateScript("myapp");

      // Check for essential bash completion components
      ok(script.includes("function _myapp ()"));
      ok(script.includes("COMPREPLY=()"));
      ok(script.includes("COMP_WORDS"));
      ok(script.includes("complete -F _myapp -- myapp"));
    });

    it("should work with actual bash shell", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "bash-completion-"));

      try {
        const cliPath = createTestCli(tempDir);
        const programName = "test-cli";
        const script = bash.generateScript(programName, ["completion", "bash"]);

        const completions = testBashCompletion(
          script,
          programName,
          dirname(cliPath),
        );

        deepStrictEqual(completions.includes("git"), true);
        deepStrictEqual(completions.includes("docker"), true);
        deepStrictEqual(completions.length, 2);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should generate script with completion command args", () => {
      const script = bash.generateScript("myapp", ["completion", "bash"]);

      deepStrictEqual(script.includes("myapp 'completion' 'bash'"), true);
    });

    it("should escape single quotes in arguments", () => {
      const script = bash.generateScript("myapp", ["it's", "test"]);

      deepStrictEqual(script.includes("'it'\\''s'"), true);
    });

    it("should encode suggestions without descriptions", () => {
      const suggestions: Suggestion[] = [
        { kind: "literal", text: "--verbose" },
        { kind: "literal", text: "--quiet" },
        { kind: "literal", text: "--help" },
      ];

      const encoded = Array.from(bash.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["--verbose", "\n", "--quiet", "\n", "--help"]);
    });

    it("should encode single suggestion without newline", () => {
      const suggestions: Suggestion[] = [
        { kind: "literal", text: "--verbose" },
      ];

      const encoded = Array.from(bash.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["--verbose"]);
    });

    it("should encode empty suggestions list", () => {
      const suggestions: Suggestion[] = [];

      const encoded = Array.from(bash.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, []);
    });

    it("should ignore descriptions in bash", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "literal",
          text: "--verbose",
          description: message`Enable verbose output`,
        },
        {
          kind: "literal",
          text: "--quiet",
          description: message`Suppress output`,
        },
      ];

      const encoded = Array.from(bash.encodeSuggestions(suggestions));

      // Bash doesn't use descriptions
      deepStrictEqual(encoded, ["--verbose", "\n", "--quiet"]);
    });

    it("should encode file suggestions with marker", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "directory",
          includeHidden: true,
        },
      ];

      const encoded = Array.from(bash.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["__FILE__:directory:::1"]);
    });

    it("should encode file suggestion extensions in bash", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          extensions: ["json", "yaml"],
          includeHidden: false,
        },
      ];

      const encoded = Array.from(bash.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["__FILE__:file:json,yaml::0"]);
    });

    it("should strip leading dots from extensions in bash", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          extensions: [".json", ".yaml"],
          includeHidden: false,
        },
      ];

      const encoded = Array.from(bash.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["__FILE__:file:json,yaml::0"]);
    });

    it("should encode file suggestions with colon in pattern", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          pattern: "C:/Users/test/",
          includeHidden: false,
        },
      ];

      const encoded = Array.from(bash.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["__FILE__:file::C%3A/Users/test/:0"]);
    });

    it("should encode file suggestions with percent in pattern", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          pattern: "100%done",
          includeHidden: false,
        },
      ];

      const encoded = Array.from(bash.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["__FILE__:file::100%25done:0"]);
    });

    it("should sanitize tabs and newlines in literal text", () => {
      const suggestions: Suggestion[] = [
        { kind: "literal", text: "alpha\tbeta" },
        { kind: "literal", text: "line1\nline2" },
        { kind: "literal", text: "car\rriage" },
        { kind: "literal", text: "nul\0byte" },
      ];

      const encoded = Array.from(bash.encodeSuggestions(suggestions));
      deepStrictEqual(encoded, [
        "alpha beta",
        "\n",
        "line1 line2",
        "\n",
        "car riage",
        "\n",
        "nul byte",
      ]);
    });

    it("should not use compgen -z flag", () => {
      const script = bash.generateScript("myapp");

      // compgen -z is not supported on macOS default Bash 3.2
      ok(!script.includes("compgen -z"));
      ok(!script.includes("-z --"));
    });

    it("should complete files with native file completion in bash", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "bash-file-completion-"));

      try {
        // Create a CLI that emits a __FILE__ directive for file completion
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::0\\n'
`;
        const cliPath = join(tempDir, "file-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create some test files
        const srcDir = join(tempDir, "src");
        mkdirSync(srcDir);
        writeFileSync(join(srcDir, "main.ts"), "");
        writeFileSync(join(srcDir, "util.ts"), "");
        writeFileSync(join(tempDir, "README.md"), "");

        const script = bash.generateScript("file-cli");

        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
COMP_WORDS=("file-cli" "src/")
COMP_CWORD=1
_file-cli 2>&1
if [ \${#COMPREPLY[@]} -gt 0 ]; then
  printf "%s\\n" "\${COMPREPLY[@]}"
else
  echo "__NO_COMPLETIONS__"
fi
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        // Should not contain error messages about -z flag
        ok(!result.includes("invalid option"));
        ok(!result.includes("compgen"));
        // Should have found files in src/
        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        ok(completions.length > 0);
        ok(completions.some((c) => c.includes("main.ts")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should use pattern for file globbing instead of current word in bash", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "bash-pattern-completion-"),
      );

      try {
        // CLI emits __FILE__ with pattern=src/ so completions should
        // enumerate files under src/, not the current directory
        const cliScript = `#!/bin/bash
printf '__FILE__:file::src/:0\\n'
`;
        const cliPath = join(tempDir, "patapp");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create directory structure
        const srcDir = join(tempDir, "src");
        mkdirSync(srcDir);
        writeFileSync(join(srcDir, "main.ts"), "");
        writeFileSync(join(srcDir, "util.ts"), "");
        writeFileSync(join(tempDir, "README.md"), "");

        const script = bash.generateScript("patapp");

        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
COMP_WORDS=("patapp" "")
COMP_CWORD=1
_patapp 2>&1
if [ \${#COMPREPLY[@]} -gt 0 ]; then
  printf "%s\\n" "\${COMPREPLY[@]}"
else
  echo "__NO_COMPLETIONS__"
fi
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        // Should find files under src/ (from pattern), not root-level files
        ok(completions.some((c) => c.includes("main.ts")));
        ok(completions.some((c) => c.includes("util.ts")));
        ok(!completions.some((c) => c.includes("README.md")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should expand tilde in pattern for file globbing in bash", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const home = process.env.HOME;
      if (!home) {
        t.skip("HOME not set");
        return;
      }

      const tempDir = mkdtempSync(join(home, ".optique-tilde-pattern-"));

      try {
        // Compute the tilde-relative path for the pattern
        const tildeDir = tempDir.replace(home, "~") + "/";
        // CLI emits __FILE__ with a tilde-prefixed pattern
        const cliScript = `#!/bin/bash
printf '__FILE__:file::${tildeDir}:0\\n'
`;
        const cliPath = join(tempDir, "tilde-pat-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });
        writeFileSync(join(tempDir, "testfile.txt"), "");

        const script = bash.generateScript("tilde-pat-cli");

        // Current word is empty — the pattern should drive the glob
        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
COMP_WORDS=("tilde-pat-cli" "")
COMP_CWORD=1
_tilde-pat-cli 2>&1
printf "%s\\n" "\${COMPREPLY[@]}"
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        // Should find the file via tilde-expanded pattern
        ok(completions.some((c) => c.includes("testfile.txt")));
        // Results should use tilde prefix, not expanded home
        ok(completions.some((c) => c.startsWith("~/")));
        ok(!completions.some((c) => c.startsWith(home)));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should not apply stale tilde rewrite to absolute pattern in bash", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const home = process.env.HOME;
      if (!home) {
        t.skip("HOME not set");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "bash-tilde-stale-"));

      try {
        // CLI emits __FILE__ with an absolute (non-tilde) pattern
        const absSrcDir = join(tempDir, "src");
        mkdirSync(absSrcDir);
        writeFileSync(join(absSrcDir, "app.ts"), "");

        const cliScript = `#!/bin/bash
printf '__FILE__:file::${absSrcDir}/:0\\n'
`;
        const cliPath = join(tempDir, "abs-pat-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        const script = bash.generateScript("abs-pat-cli");

        // Current word starts with ~ so tilde state is set,
        // but the pattern is absolute — results must not be tilde-rewritten
        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
COMP_WORDS=("abs-pat-cli" "~/bogus")
COMP_CWORD=1
_abs-pat-cli 2>&1
printf "%s\\n" "\${COMPREPLY[@]}"
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        // Should find file via absolute pattern
        ok(completions.some((c) => c.includes("app.ts")));
        // Results must NOT be rewritten to tilde prefix
        ok(!completions.some((c) => c.startsWith("~/")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should preserve user suffix for incremental filtering in bash", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "bash-incremental-"),
      );

      try {
        // CLI emits __FILE__ with pattern=src/
        const srcDir = join(tempDir, "src");
        mkdirSync(srcDir);
        writeFileSync(join(srcDir, "main.ts"), "");
        writeFileSync(join(srcDir, "util.ts"), "");
        writeFileSync(join(srcDir, "model.ts"), "");

        const cliScript = `#!/bin/bash
printf '__FILE__:file::src/:0\\n'
`;
        const cliPath = join(tempDir, "incr-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        const script = bash.generateScript("incr-cli");

        // User has typed "src/ma" — should narrow to main.ts only
        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
COMP_WORDS=("incr-cli" "src/ma")
COMP_CWORD=1
_incr-cli 2>&1
if [ \${#COMPREPLY[@]} -gt 0 ]; then
  printf "%s\\n" "\${COMPREPLY[@]}"
else
  echo "__NO_COMPLETIONS__"
fi
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        ok(completions.some((c) => c.includes("main.ts")));
        // util.ts and model.ts should NOT appear
        ok(!completions.some((c) => c.includes("util.ts")));
        ok(!completions.some((c) => c.includes("model.ts")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should narrow with ./ prefix when pattern omits it in bash", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "bash-dotslash-"),
      );

      try {
        const srcDir = join(tempDir, "src");
        mkdirSync(srcDir);
        writeFileSync(join(srcDir, "main.ts"), "");
        writeFileSync(join(srcDir, "util.ts"), "");

        // pattern is "src/" without ./
        const cliScript = `#!/bin/bash
printf '__FILE__:file::src/:0\\n'
`;
        const cliPath = join(tempDir, "dot-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        const script = bash.generateScript("dot-cli");

        // User typed "./src/ma" — should still narrow to main.ts
        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
COMP_WORDS=("dot-cli" "./src/ma")
COMP_CWORD=1
_dot-cli 2>&1
if [ \${#COMPREPLY[@]} -gt 0 ]; then
  printf "%s\\n" "\${COMPREPLY[@]}"
else
  echo "__NO_COMPLETIONS__"
fi
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        ok(completions.some((c) => c.includes("main.ts")));
        ok(!completions.some((c) => c.includes("util.ts")));
        // Should preserve the user's ./ prefix
        ok(completions.some((c) => c.startsWith("./")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should include hidden files when includeHidden is true", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "bash-hidden-completion-"));

      try {
        // CLI that emits __FILE__ with hidden=1
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::1\\n'
`;
        const cliPath = join(tempDir, "hidden-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create visible and hidden files
        writeFileSync(join(tempDir, "visible.txt"), "");
        writeFileSync(join(tempDir, ".hidden"), "");
        writeFileSync(join(tempDir, ".env"), "");

        const script = bash.generateScript("hidden-cli");

        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
COMP_WORDS=("hidden-cli" "")
COMP_CWORD=1
_hidden-cli 2>&1
printf "%s\\n" "\${COMPREPLY[@]}"
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        ok(completions.some((c) => c.includes(".hidden")));
        ok(completions.some((c) => c.includes(".env")));
        ok(completions.some((c) => c.includes("visible.txt")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should filter hidden directories when includeHidden is false and dotglob is on", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "bash-hidden-dir-filter-"),
      );

      try {
        // CLI that emits __FILE__:directory with includeHidden=0
        const cliScript = `#!/bin/bash
printf '__FILE__:directory:::0\\n'
`;
        const cliPath = join(tempDir, "dir-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create visible and hidden directories
        mkdirSync(join(tempDir, "visible"));
        mkdirSync(join(tempDir, ".hidden-dir"));

        const script = bash.generateScript("dir-cli");

        // Enable dotglob in the caller's shell before completion
        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
shopt -s dotglob
COMP_WORDS=("dir-cli" "")
COMP_CWORD=1
_dir-cli 2>/dev/null
printf "%s\\n" "\${COMPREPLY[@]}"
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        ok(completions.some((c) => c.includes("visible")));
        ok(!completions.some((c) => c.includes(".hidden-dir")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should preserve completions inside a hidden directory", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "bash-inside-hidden-dir-"));

      try {
        // CLI that emits __FILE__:file without includeHidden
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::0\\n'
`;
        const cliPath = join(tempDir, "inner-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create a hidden directory with files inside
        const hiddenDir = join(tempDir, ".config");
        mkdirSync(hiddenDir);
        writeFileSync(join(hiddenDir, "settings.json"), "");
        writeFileSync(join(hiddenDir, ".secret"), "");

        const script = bash.generateScript("inner-cli");

        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
COMP_WORDS=("inner-cli" ".config/")
COMP_CWORD=1
_inner-cli 2>&1
printf "%s\\n" "\${COMPREPLY[@]}"
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        // Should find visible files inside the hidden directory
        ok(completions.some((c) => c.includes("settings.json")));
        // Hidden files inside a hidden directory should also appear
        // since user explicitly navigated into .config/
        ok(completions.some((c) => c.includes(".secret")));
        // Should have exactly 2 completions
        deepStrictEqual(completions.length, 2);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should complete inside nested hidden directory paths", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "bash-nested-hidden-dir-"),
      );

      try {
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::0\\n'
`;
        const cliPath = join(tempDir, "nested-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create .config/nvim/ with a hidden file inside
        const nestedDir = join(tempDir, ".config", "nvim");
        mkdirSync(nestedDir, { recursive: true });
        writeFileSync(join(nestedDir, "init.lua"), "");
        writeFileSync(join(nestedDir, ".hidden-plugin"), "");

        const script = bash.generateScript("nested-cli");

        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
COMP_WORDS=("nested-cli" ".config/nvim/")
COMP_CWORD=1
_nested-cli 2>&1
printf "%s\\n" "\${COMPREPLY[@]}"
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        ok(completions.some((c) => c.includes("init.lua")));
        ok(completions.some((c) => c.includes(".hidden-plugin")));
        deepStrictEqual(completions.length, 2);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should complete hidden files when prefix starts with dot", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "bash-dot-prefix-"),
      );

      try {
        // CLI that emits __FILE__:file without includeHidden
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::0\\n'
`;
        const cliPath = join(tempDir, "dot-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        writeFileSync(join(tempDir, ".env"), "");
        writeFileSync(join(tempDir, ".gitignore"), "");
        writeFileSync(join(tempDir, "visible.txt"), "");

        const script = bash.generateScript("dot-cli");

        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
COMP_WORDS=("dot-cli" ".")
COMP_CWORD=1
_dot-cli 2>&1
printf "%s\\n" "\${COMPREPLY[@]}"
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        ok(completions.some((c) => c.includes(".env")));
        ok(completions.some((c) => c.includes(".gitignore")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should preserve caller's dotglob setting after completion", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "bash-dotglob-restore-"));

      try {
        // CLI that emits __FILE__ with hidden=1
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::1\\n'
`;
        const cliPath = join(tempDir, "dotglob-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });
        writeFileSync(join(tempDir, "a.txt"), "");

        const script = bash.generateScript("dotglob-cli");

        // Enable dotglob before running completion, verify it's still on after
        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
shopt -s dotglob
COMP_WORDS=("dotglob-cli" "")
COMP_CWORD=1
_dotglob-cli 2>/dev/null
shopt -q dotglob && echo "dotglob_preserved" || echo "dotglob_lost"
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        ok(result.includes("dotglob_preserved"));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should not error when failglob is enabled and prefix has no matches", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "bash-failglob-"));

      try {
        // CLI that emits __FILE__ directive
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::0\\n'
`;
        const cliPath = join(tempDir, "failglob-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        const script = bash.generateScript("failglob-cli");

        // Enable failglob, then complete with a prefix that matches nothing
        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
shopt -s failglob
COMP_WORDS=("failglob-cli" "nonexistent_prefix")
COMP_CWORD=1
_failglob-cli 2>&1
echo "exit_status=\$?"
shopt -q failglob && echo "failglob_preserved" || echo "failglob_lost"
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        ok(!result.includes("no match"));
        ok(result.includes("exit_status=0"));
        ok(result.includes("failglob_preserved"));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should complete files even when noglob is set", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "bash-noglob-"));

      try {
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::0\\n'
`;
        const cliPath = join(tempDir, "noglob-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });
        writeFileSync(join(tempDir, "hello.txt"), "");

        const script = bash.generateScript("noglob-cli");

        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
set -f
COMP_WORDS=("noglob-cli" "")
COMP_CWORD=1
_noglob-cli 2>/dev/null
printf "%s\\n" "\${COMPREPLY[@]}"
[[ $- == *f* ]] && echo "noglob_preserved" || echo "noglob_lost"
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        ok(result.includes("hello.txt"));
        ok(result.includes("noglob_preserved"));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should preserve caller's GLOBIGNORE after completion", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "bash-globignore-"));

      try {
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::0\\n'
`;
        const cliPath = join(tempDir, "globignore-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });
        writeFileSync(join(tempDir, "keep.txt"), "");

        const script = bash.generateScript("globignore-cli");

        // Set GLOBIGNORE before running completion, verify it's preserved after
        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
GLOBIGNORE='*.tmp'
COMP_WORDS=("globignore-cli" "")
COMP_CWORD=1
_globignore-cli 2>/dev/null
[[ "$GLOBIGNORE" == "*.tmp" ]] && echo "globignore_preserved" || echo "globignore_lost:$GLOBIGNORE"
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        ok(result.includes("globignore_preserved"));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should preserve caller's set-but-empty GLOBIGNORE after completion", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "bash-globignore-empty-"),
      );

      try {
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::0\\n'
`;
        const cliPath = join(tempDir, "globignore-empty-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });
        writeFileSync(join(tempDir, "a.txt"), "");

        const script = bash.generateScript("globignore-empty-cli");

        // Set GLOBIGNORE to empty string (distinct from unset)
        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
GLOBIGNORE=''
COMP_WORDS=("globignore-empty-cli" "")
COMP_CWORD=1
_globignore-empty-cli 2>/dev/null
if [[ \${GLOBIGNORE+x} == x && -z "$GLOBIGNORE" ]]; then
  echo "globignore_empty_preserved"
else
  echo "globignore_empty_lost"
fi
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        ok(result.includes("globignore_empty_preserved"));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should complete non-regular files in any mode", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      // Skip on platforms without mkfifo
      try {
        runCommand("which", ["mkfifo"], { stdio: "pipe" });
      } catch {
        t.skip("mkfifo not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "bash-any-fifo-"));

      try {
        // CLI that emits __FILE__:any (complete all filesystem entries)
        const cliScript = `#!/bin/bash
printf '__FILE__:any:::0\\n'
`;
        const cliPath = join(tempDir, "any-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });
        writeFileSync(join(tempDir, "regular.txt"), "");
        runCommand("mkfifo", [join(tempDir, "myfifo")]);

        const script = bash.generateScript("any-cli");

        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
COMP_WORDS=("any-cli" "")
COMP_CWORD=1
_any-cli 2>/dev/null
printf "%s\\n" "\${COMPREPLY[@]}"
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        ok(completions.some((c) => c.includes("regular.txt")));
        ok(completions.some((c) => c.includes("myfifo")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should expand tilde prefix in file completion", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const home = process.env.HOME;
      if (!home) {
        t.skip("HOME not set");
        return;
      }

      const tempDir = mkdtempSync(join(home, ".optique-tilde-test-"));

      try {
        // CLI that emits __FILE__:file directive
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::0\\n'
`;
        const cliPath = join(tempDir, "tilde-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });
        writeFileSync(join(tempDir, "testfile.txt"), "");

        const script = bash.generateScript("tilde-cli");

        // Compute the tilde-relative path prefix
        const relDir = tempDir.replace(home, "~");
        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
COMP_WORDS=("tilde-cli" "${relDir}/")
COMP_CWORD=1
_tilde-cli 2>&1
printf "%s\\n" "\${COMPREPLY[@]}"
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        // Should find the file
        ok(completions.some((c) => c.includes("testfile.txt")));
        // Results should use tilde prefix, not expanded home
        ok(completions.some((c) => c.startsWith("~/")));
        ok(!completions.some((c) => c.startsWith(home)));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should complete hidden files under tilde-relative dot prefix", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const home = process.env.HOME;
      if (!home) {
        t.skip("HOME not set");
        return;
      }

      // Create a unique hidden directory under $HOME
      const hiddenDir = mkdtempSync(join(home, ".optique-tilde-dot-test-"));

      try {
        // CLI that emits __FILE__:file without includeHidden
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::0\\n'
`;
        writeFileSync(join(hiddenDir, "tilde-dot-cli"), cliScript, {
          mode: 0o755,
        });
        writeFileSync(join(hiddenDir, "target.txt"), "");

        const script = bash.generateScript("tilde-dot-cli");

        // Complete with ~/.optique-tilde-dot-test/ prefix
        const relDir = hiddenDir.replace(home, "~");
        const testScript = `
export PATH="${hiddenDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
COMP_WORDS=("tilde-dot-cli" "${relDir}/")
COMP_CWORD=1
_tilde-dot-cli 2>&1
printf "%s\\n" "\${COMPREPLY[@]}"
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: hiddenDir,
        });

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        // Should find files inside the hidden directory
        ok(completions.some((c) => c.includes("target.txt")));
      } finally {
        rmSync(hiddenDir, { recursive: true, force: true });
      }
    });

    it("should include directories for navigation in file type completion", () => {
      const script = bash.generateScript("filedir-cli");

      // The bash file case should include a directory check (-d) alongside
      // the file check (-f), so users can navigate into subdirectories
      // when completing file paths
      ok(
        script.includes('[[ -d "$item" ]]') ||
          script.includes('[[ -d "$file" ]]'),
        "bash file case should include directory check for navigation.",
      );

      // Verify directories get trailing slash in file mode
      const typeCaseStart = script.indexOf('case "$type" in');
      const typeCaseEnd = script.indexOf("esac", typeCaseStart);
      const typeCase = script.substring(typeCaseStart, typeCaseEnd);
      const fileCaseBlock = typeCase.substring(
        typeCase.indexOf("file)"),
        typeCase.indexOf("directory)"),
      );
      ok(
        fileCaseBlock.includes("-d"),
        "file) case should check for directories.",
      );
    });

    it("should filter files by dot-prefixed extensions in bash", (t) => {
      if (!isShellAvailable("bash")) {
        t.skip("bash not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "bash-ext-dot-filter-"),
      );

      try {
        // CLI emits __FILE__ with dot-prefixed extensions (.json,.yaml)
        const cliScript = `#!/bin/bash
printf '__FILE__:file:.json,.yaml::0\\n'
`;
        const cliPath = join(tempDir, "extapp");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create test files
        writeFileSync(join(tempDir, "data.json"), "");
        writeFileSync(join(tempDir, "config.yaml"), "");
        writeFileSync(join(tempDir, "readme.txt"), "");
        const subDir = join(tempDir, "subdir");
        mkdirSync(subDir);

        const script = bash.generateScript("extapp");

        const testScript = `
export PATH="${tempDir}:$PATH"
source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT
cd "${tempDir}"
COMP_WORDS=("extapp" "")
COMP_CWORD=1
_extapp 2>&1
if [ \${#COMPREPLY[@]} -gt 0 ]; then
  printf "%s\\n" "\${COMPREPLY[@]}"
else
  echo "__NO_COMPLETIONS__"
fi
`;

        const result = runCommand("bash", ["-c", testScript], {
          cwd: tempDir,
        });
        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );

        ok(
          completions.some((c) => c.includes("data.json")),
          `Expected data.json in completions, got: ${
            JSON.stringify(completions)
          }`,
        );
        ok(
          completions.some((c) => c.includes("config.yaml")),
          `Expected config.yaml in completions, got: ${
            JSON.stringify(completions)
          }`,
        );
        ok(
          !completions.some((c) => c.includes("readme.txt")),
          `Should not include readme.txt in completions, got: ${
            JSON.stringify(completions)
          }`,
        );
        ok(
          completions.some((c) => c.includes("subdir")),
          `Expected subdir/ in completions for navigation, got: ${
            JSON.stringify(completions)
          }`,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should include directories for navigation in file type completion with extensions", () => {
      const script = bash.generateScript("fileext-cli");

      // Extract the file case block
      const typeCaseStart2 = script.indexOf('case "$type" in');
      const typeCaseEnd2 = script.indexOf("esac", typeCaseStart2);
      const typeCase2 = script.substring(typeCaseStart2, typeCaseEnd2);
      const fileCaseBlock2 = typeCase2.substring(
        typeCase2.indexOf("file)"),
        typeCase2.indexOf("directory)"),
      );
      // Narrow to the extensions branch (the if block with ext_pattern)
      const extBranch = fileCaseBlock2.substring(
        fileCaseBlock2.indexOf("ext_pattern"),
        fileCaseBlock2.indexOf("else"),
      );
      // Should check for directories even in extension-filtered mode
      ok(
        extBranch.includes("-d"),
        "file) extensions branch should still check for directories.",
      );
    });
  });

  describe("zsh shell completion", () => {
    for (
      const testCase of [
        {
          name: "complete a literal in the middle of a word",
          input: "extapp --format jn",
          moveLeft: 1,
          enabled: true,
          expected: "extapp --format json ",
        },
        {
          name: "complete an ordinary literal prefix",
          input: "extapp --format j",
          moveLeft: 0,
          enabled: true,
          expected: "extapp --format json ",
        },
        {
          name: "reject an incompatible literal suffix",
          input: "extapp --format jx",
          moveLeft: 1,
          enabled: true,
          expected: "extapp --format jx",
        },
        {
          name: "complete a literal with an empty prefix",
          input: "extapp --format son",
          moveLeft: 3,
          enabled: true,
          expected: "extapp --format json ",
        },
        {
          name: "complete an opening-quoted literal",
          input: "extapp --format 'jn",
          moveLeft: 1,
          enabled: true,
          expected: "extapp --format 'json' ",
        },
        {
          name: "preserve whole-word matching when disabled",
          input: "extapp --format jn",
          moveLeft: 1,
          enabled: false,
          expected: "extapp --format jn",
        },
        {
          name: "complete quoted literals when disabled",
          input: "extapp --format 'j",
          moveLeft: 0,
          enabled: false,
          expected: "extapp --format 'json' ",
        },
      ]
    ) {
      it(`should ${testCase.name} with COMPLETE_IN_WORD`, {
        skip: !isInteractiveZshCompletionAvailable(),
      }, (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }

        const buffer = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          "",
          [],
          {
            setup: `${
              testCase.enabled ? "setopt" : "unsetopt"
            } complete_in_word`,
            // Like choice(["json"]), the backend filters by the supplied
            // prefix. Also require the previous option argument to survive.
            cliScript: `#!/bin/bash
if [[ $# == 2 && "$1" == --format && json == "$2"* ]]; then
  printf 'json\\0\\0\\n'
fi
`,
            input: testCase.input,
            moveLeft: testCase.moveLeft,
            tabCount: 1,
            captureBuffer: true,
          },
        );
        deepStrictEqual(buffer, testCase.expected);
      });
    }

    for (const quote of ["'", '"']) {
      for (const closed of [false, true]) {
        it(`should retain joined Zsh quote prefix ${quote} closed=${closed}`, {
          skip: !isInteractiveZshCompletionAvailable(),
        }, () => {
          if (!isInteractiveZshCompletionAvailable()) return;
          const output = testInteractiveZshCompletion(
            zsh.generateScript("extapp"),
            "",
            [],
            {
              setup: "setopt complete_in_word",
              input: `extapp --format=${quote}j${closed ? quote : ""}`,
              backend:
                `[[ "$1" == --format=j ]] && printf '%s\\0\\0\\n' --format=json`,
              expectedArgs: ["--format=j"],
              captureBuffer: true,
            },
          );
          deepStrictEqual(output, "extapp --format=json ");
        });
      }
      it(`should retain mixed Zsh quote prefix ${quote}`, {
        skip: !isInteractiveZshCompletionAvailable(),
      }, () => {
        if (!isInteractiveZshCompletionAvailable()) return;
        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          "",
          [],
          {
            input: `extapp --format j${quote}s`,
            backend:
              `[[ "$1" == --format && "$2" == js ]] && printf '%s\\0\\0\\n' json`,
            expectedArgs: ["--format", "js"],
            captureBuffer: true,
          },
        );
        deepStrictEqual(output, "extapp --format json ");
      });
    }

    for (
      const [pattern, file, completed] of [
        ["src/*[$]x", "src/a$x", "src/a\\$x "],
        ["src/*[`]x", "src/a`x", "src/a\\`x "],
        ["src/*[q$]x", "src/a$x", "src/a\\$x "],
        ["src/*[q`]x", "src/a`x", "src/a\\`x "],
      ]
    ) {
      it(`should preserve protected Zsh marker classes ${pattern}`, {
        skip: !isInteractiveZshCompletionAvailable(),
      }, () => {
        if (!isInteractiveZshCompletionAvailable()) return;
        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          "",
          [
            { path: "src", type: "directory" },
            { path: file },
          ],
          {
            input: "extapp --format ",
            backend: `printf '%s\\0\\0\\n' '__FILE__:file::${pattern}:0'`,
            captureBuffer: true,
          },
        );
        deepStrictEqual(output, `extapp --format ${completed}`);
      });
    }

    const fileCompletionBackend = `pattern="\${2#@}"
pattern="\${pattern//%/%25}"
pattern="\${pattern//:/%3A}"
printf '__FILE__:file:txt:%s:0\\0\\0\\n' "$pattern"`;
    for (
      const [typed, value, completed] of [
        ["j", "j", "json "],
        ['"', "", '"json" '],
        ["'", "", "'json' "],
        ['"j', "j", '"json" '],
        ["'j", "j", "'json' "],
        ['"j"', "j", '"json"'],
        ['j"s', "js", "json "],
        ["j\\s", "js", "json "],
        ["'a\\b", "a\\b", "'a\\bc' "],
        ['"a\\b', "a\\b", '"a\\\\bc" '],
        ['"a\\b"', "a\\b", '"a\\\\bc"'],
        ['"a\\$b', "a$b", '"a\\$bc" '],
        ['"a\\\\b', "a\\b", '"a\\\\bc" '],
        ['"a\\"b', 'a"b', '"a\\"bc" '],
        ["'a:b", "a:b", "'a:bc' "],
        ['\'a"b"', 'a"b"', "'a\"b\"c' "],
      ]
    ) {
      it(`should complete quoted Zsh literal ${typed}`, {
        skip: !isInteractiveZshCompletionAvailable(),
      }, (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }
        const candidate = value.startsWith("a") ? `${value}c` : "json";
        const quotedCandidate = `'${candidate.replaceAll("'", "'\\''")}'`;
        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          "",
          [],
          {
            input: `extapp --format ${typed}`,
            backend:
              `[[ "$1" == --format && ${quotedCandidate} == "$2"* ]] && printf '%s\\0\\0\\n' ${quotedCandidate}`,
            expectedArgs: ["--format", value],
            captureBuffer: true,
          },
        );
        deepStrictEqual(output, `extapp --format ${completed}`);
      });
    }

    it("should match double-quoted Zsh file input in the completion backend", {
      skip: !isInteractiveZshCompletionAvailable(),
    }, (t) => {
      if (!isInteractiveZshCompletionAvailable()) {
        t.skip("interactive zsh completion not available");
        return;
      }
      const output = testInteractiveZshCompletion(
        zsh.generateScript("extapp"),
        "",
        [{ path: "a\\bc.txt" }],
        {
          input: 'extapp --format "a\\b',
          backend:
            `compgen -f -- "$2" | while IFS= read -r file; do printf '%s\\0\\0\\n' "$file"; done`,
          expectedArgs: ["--format", "a\\b"],
          captureBuffer: true,
        },
      );
      deepStrictEqual(output, 'extapp --format "a\\\\bc.txt" ');
    });

    it(
      "should dequote previous Zsh arguments and preserve quoted empty values",
      {
        skip: !isInteractiveZshCompletionAvailable(),
      },
      (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }
        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          "",
          [],
          {
            input: 'extapp "--name" "a b" --empty \'\' "--format" "j',
            backend:
              '[[ "$5" == --format && json == "$6"* ]] && printf "json\\0\\0\\n"',
            expectedArgs: ["--name", "a b", "--empty", "", "--format", "j"],
            captureBuffer: true,
          },
        );
        deepStrictEqual(
          output,
          'extapp "--name" "a b" --empty \'\' "--format" "json" ',
        );
      },
    );

    for (const quote of ['"', "'"]) {
      it(`should complete quoted Zsh file values with ${quote}`, {
        skip: !isInteractiveZshCompletionAvailable(),
      }, (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }
        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          "",
          [
            { path: "a file.txt" },
            { path: "a file.md" },
          ],
          {
            input: `extapp --format ${quote}a f`,
            backend: fileCompletionBackend,
            expectedArgs: ["--format", "a f"],
            captureBuffer: true,
          },
        );
        deepStrictEqual(output, `extapp --format ${quote}a file.txt${quote} `);
      });
    }

    for (
      const [typed, prefix, completed] of [
        ["\\~li", "~li", "\\~literal.txt "],
        [
          "\\$(touch\\ MARK)/f",
          "$(touch MARK)/f",
          "\\$\\(touch\\ MARK\\)/file.txt ",
        ],
        [
          '"\\$(touch MARK)/f',
          "$(touch MARK)/f",
          '"\\$(touch MARK)/file.txt" ',
        ],
      ]
    ) {
      it(`should preserve literal Zsh file prefix ${typed}`, {
        skip: !isInteractiveZshCompletionAvailable(),
      }, (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }
        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          "",
          [
            { path: "~literal.txt" },
            { path: "$(touch MARK)", type: "directory" },
            { path: "$(touch MARK)/file.txt" },
          ],
          {
            input: `extapp --format ${typed}`,
            backend: fileCompletionBackend,
            expectedArgs: ["--format", prefix],
            captureBuffer: true,
            absentFiles: ["MARK"],
          },
        );
        deepStrictEqual(output, `extapp --format ${completed}`);
      });
    }

    for (
      const [typed, pattern, completed] of [
        ["@my\\ dir/f", "my dir/f", "my\\ dir/file.txt "],
        [
          "@\\$(touch\\ MARK)/f",
          "$(touch MARK)/f",
          "\\$\\(touch\\ MARK\\)/file.txt ",
        ],
        [
          "@\\`touch\\ MARK\\`/f",
          "`touch MARK`/f",
          "\\`touch\\ MARK\\`/file.txt ",
        ],
        [
          "@~+\\;touch\\ MARK\\;/f",
          "~+;touch MARK;/f",
          "\\~+\\;touch\\ MARK\\;/file.txt ",
        ],
        [
          "@~+\\;touch\\ MARK\\;\\$x/f",
          "~+;touch MARK;$x/f",
          "\\~+\\;touch\\ MARK\\;\\$x/file.txt ",
        ],
      ]
    ) {
      it(`should keep transformed Zsh file pattern literal ${typed}`, {
        skip: !isInteractiveZshCompletionAvailable(),
      }, (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }
        const directory = pattern.slice(0, pattern.lastIndexOf("/"));
        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          "",
          [
            { path: directory, type: "directory" },
            { path: `${directory}/file.txt` },
          ],
          {
            input: `extapp --format ${typed}`,
            backend: fileCompletionBackend,
            captureBuffer: true,
            absentFiles: ["MARK"],
          },
        );
        deepStrictEqual(output, `extapp --format ${completed}`);
      });
    }

    for (
      const qualifier of [
        "e!touch MARK!",
        "#qe!touch MARK!",
        "oe!touch MARK!",
        "+mark",
      ]
    ) {
      it(`should keep transformed Zsh qualifier ${qualifier} literal`, {
        skip: !isInteractiveZshCompletionAvailable(),
      }, (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }
        const filename = `a(${qualifier})`;
        const typed = filename.replaceAll("(", "\\(").replaceAll(")", "\\)")
          .replaceAll(" ", "\\ ").replaceAll("!", "\\!").replaceAll("#", "\\#");
        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          "",
          [{ path: filename }, { path: "a" }],
          {
            setup: "setopt globcomplete extendedglob; mark() { touch MARK; }",
            input: `extapp --format @${typed}`,
            backend: fileCompletionBackend.replace(":file:txt:", ":file::"),
            captureBuffer: true,
            absentFiles: ["MARK"],
          },
        );
        deepStrictEqual(output, `extapp --format ${typed} `);
      });
    }

    for (const qualifier of ["+mark", "e!touch MARK!", "#qe!touch MARK!"]) {
      it(
        `should sanitize single-quoted transformed Zsh qualifier ${qualifier}`,
        {
          skip: !isInteractiveZshCompletionAvailable(),
        },
        (t) => {
          if (!isInteractiveZshCompletionAvailable()) {
            t.skip("interactive zsh completion not available");
            return;
          }
          const filename = `a(${qualifier})`;
          const output = testInteractiveZshCompletion(
            zsh.generateScript("extapp"),
            "",
            [{ path: "src", type: "directory" }, { path: `src/x${filename}` }, {
              path: "src/xa",
            }],
            {
              setup: "setopt globcomplete extendedglob; mark() { touch MARK; }",
              input: `extapp --format '@${filename}`,
              backend: fileCompletionBackend.replace(
                'pattern="${2#@}"',
                'pattern="src/*${2#@}"',
              ).replace(":file:txt:", ":file::"),
              captureBuffer: true,
              expectedArgs: ["--format", `@${filename}`],
              absentFiles: ["MARK"],
            },
          );
          deepStrictEqual(output, `extapp --format 'src/x${filename}' `);
        },
      );
    }

    for (
      const [typed, completed] of [
        ["@a\\\\b", "src/xa\\\\b.txt "],
        ['"@a\\b', '"src/xa\\\\b.txt" '],
      ]
    ) {
      it(
        `should retain backslashes in transformed Zsh file patterns ${typed}`,
        {
          skip: !isInteractiveZshCompletionAvailable(),
        },
        (t) => {
          if (!isInteractiveZshCompletionAvailable()) {
            t.skip("interactive zsh completion not available");
            return;
          }
          const output = testInteractiveZshCompletion(
            zsh.generateScript("extapp"),
            "",
            [{ path: "src", type: "directory" }, { path: "src/xa\\b.txt" }, {
              path: "src/xab.txt",
            }],
            {
              setup:
                'setopt globcomplete extendedglob; autoload -Uz +X _files; functions[_optique_native_files]=$functions[_files]; _files() { [[ "$PREFIX" == \'src/*a\\\\b*\' ]] || touch MARK; _optique_native_files "$@"; }',
              input: `extapp --format ${typed}`,
              backend: fileCompletionBackend.replace(
                'pattern="${2#@}"',
                'pattern="src/*${2#@}*"',
              ).replace(":file:txt:", ":file::"),
              captureBuffer: true,
              expectedArgs: ["--format", "@a\\b"],
              absentFiles: ["MARK"],
            },
          );
          deepStrictEqual(output, `extapp --format ${completed}`);
        },
      );
    }

    for (
      const [typed, setup] of [["@x\\(b", ""], [
        "@x\\(b\\)",
        "setopt globcomplete",
      ]]
    ) {
      it(`should keep transformed Zsh parentheses literal ${typed}`, {
        skip: !isInteractiveZshCompletionAvailable(),
      }, (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }
        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          "",
          [{ path: "x(b)" }],
          {
            setup,
            input: `extapp --format ${typed}`,
            backend: fileCompletionBackend.replace(":file:txt:", ":file::"),
            captureBuffer: true,
          },
        );
        deepStrictEqual(output, "extapp --format x\\(b\\) ");
      });
    }

    for (
      const [prefix, suffix, setup] of [
        ["src/", "", ""],
        ["src/*", "", "setopt globcomplete extendedglob"],
        ["src/", "*", "setopt globcomplete extendedglob"],
      ]
    ) {
      it(
        `should separate literal Zsh text from backend pattern ${prefix}${suffix}`,
        {
          skip: !isInteractiveZshCompletionAvailable(),
        },
        (t) => {
          if (!isInteractiveZshCompletionAvailable()) {
            t.skip("interactive zsh completion not available");
            return;
          }
          const output = testInteractiveZshCompletion(
            zsh.generateScript("extapp"),
            "",
            [
              { path: "src", type: "directory" },
              { path: "src/x(b)" },
            ],
            {
              setup,
              input: "extapp --format @x\\(b",
              backend: fileCompletionBackend.replace(
                'pattern="${2#@}"',
                `pattern="${prefix}\${2#@}${suffix}"`,
              ).replace(":file:txt:", ":file::"),
              captureBuffer: true,
            },
          );
          deepStrictEqual(output, "extapp --format src/x\\(b\\) ");
        },
      );
    }

    it("should keep a typed Zsh qualifier literal inside a backend path", {
      skip: !isInteractiveZshCompletionAvailable(),
    }, (t) => {
      if (!isInteractiveZshCompletionAvailable()) {
        t.skip("interactive zsh completion not available");
        return;
      }
      const output = testInteractiveZshCompletion(
        zsh.generateScript("extapp"),
        "",
        [
          { path: "src", type: "directory" },
          { path: "src/a(e!touch MARK!)", type: "directory" },
          { path: "src/a(e!touch MARK!)/file" },
        ],
        {
          setup: "setopt globcomplete extendedglob",
          input: "extapp --format @a\\(e\\!touch\\ MARK\\!\\)",
          backend: fileCompletionBackend.replace(
            'pattern="${2#@}"',
            'pattern="src/${2#@}/file"',
          ).replace(":file:txt:", ":file::"),
          captureBuffer: true,
          absentFiles: ["MARK"],
        },
      );
      deepStrictEqual(
        output,
        "extapp --format src/a\\(e\\!touch\\ MARK\\!\\)/file ",
      );
    });

    for (
      const [typed, filename, completed] of [
        ["@a\\#", "a#b", "a\\#b "],
        ["@a\\|", "a|b", "a\\|b "],
        ["@a\\^", "a^b", "a\\^b "],
        ["@k\\[1\\]", "k[1]", "k\\[1\\] "],
      ]
    ) {
      it(`should keep transformed Zsh glob character literal ${typed}`, {
        skip: !isInteractiveZshCompletionAvailable(),
      }, (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }
        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          "",
          [{ path: filename }, { path: "a" }],
          {
            setup: "setopt globcomplete",
            input: `extapp --format ${typed}`,
            backend: fileCompletionBackend.replace(":file:txt:", ":file::"),
            captureBuffer: true,
          },
        );
        deepStrictEqual(output, `extapp --format ${completed}`);
      });
    }

    for (
      const [typed, filename, completed] of [
        ["@\\#a", "#abc", "\\#abc "],
        ["@\\[a", "[abc", "\\[abc "],
        ["@\\(a", "(abc", "\\(abc "],
      ]
    ) {
      it(`should quote leading Zsh literal text after a wildcard ${typed}`, {
        skip: !isInteractiveZshCompletionAvailable(),
      }, (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }
        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          "",
          [{ path: "src", type: "directory" }, { path: `src/${filename}` }],
          {
            setup: "setopt globcomplete extendedglob",
            input: `extapp --format ${typed}`,
            backend: fileCompletionBackend.replace(
              'pattern="${2#@}"',
              'pattern="src/*${2#@}"',
            ).replace(":file:txt:", ":file::"),
            captureBuffer: true,
          },
        );
        deepStrictEqual(output, `extapp --format src/${completed}`);
      });
    }

    for (
      const [typed, filename, completed] of [
        ["@\\$x", "a$x", "a\\$x "],
        ["@\\`x\\`", "a`x`", "a\\`x\\` "],
        ["@\\`touch\\ MARK\\`", "a`touch MARK`", "a\\`touch\\ MARK\\` "],
        [
          "@\\$(touch\\ MARK)",
          "a$(touch MARK)",
          "a\\$\\(touch\\ MARK\\) ",
        ],
        [
          "@a\\(e\\!touch\\ MARK\\!\\)",
          "za(e!touch MARK!)b",
          "za\\(e\\!touch\\ MARK\\!\\)b ",
        ],
        ["@\\#", "a#b", "a\\#b "],
        ["@\\[", "a[b", "a\\[b "],
        ["@\\?", "a?b", "a\\?b "],
        ["@\\*", "a*b", "a\\*b "],
      ]
    ) {
      it(
        `should preserve backend wildcards around literal Zsh input ${typed}`,
        {
          skip: !isInteractiveZshCompletionAvailable(),
        },
        (t) => {
          if (!isInteractiveZshCompletionAvailable()) {
            t.skip("interactive zsh completion not available");
            return;
          }
          const output = testInteractiveZshCompletion(
            zsh.generateScript("extapp"),
            "",
            [{ path: "src", type: "directory" }, { path: `src/${filename}` }],
            {
              setup: "setopt globcomplete extendedglob",
              input: `extapp --format ${typed}`,
              backend: fileCompletionBackend.replace(
                'pattern="${2#@}"',
                'pattern="src/*${2#@}*"',
              ).replace(":file:txt:", ":file::"),
              captureBuffer: true,
              absentFiles: ["MARK"],
            },
          );
          deepStrictEqual(output, `extapp --format src/${completed}`);
        },
      );
    }

    for (
      const [typed, pattern, filename, completed, setup] of [
        ["", "src/*$x", "a$x", "a\\$x", "setopt globcomplete"],
        ["@unrelated", "src/*$x", "a$x", "a\\$x", "setopt globcomplete"],
        ["@x", "src/*$x", "a$x", "a\\$x", "setopt globcomplete"],
        ["", "src/*$x", "a$x", "a\\$x", ""],
        ["", "src/[ab]*$x", "ab$x", "ab\\$x", "setopt globcomplete"],
        ["", "src/*.(txt|md)$x", "a.txt$x", "a.txt\\$x", "setopt globcomplete"],
        [
          "",
          "src/*`touch MARK`",
          "a`touch MARK`",
          "a\\`touch\\ MARK\\`",
          "setopt globcomplete",
        ],
        [
          "",
          "src/*$x(m+1)",
          "a$x",
          "a\\$x",
          "setopt globcomplete; touch -t 202001010000 work/src/a\\$x",
        ],
      ]
    ) {
      it(
        `should preserve fixed Zsh globs without retained input ${typed}/${pattern}/${setup}`,
        {
          skip: !isInteractiveZshCompletionAvailable(),
        },
        (t) => {
          if (!isInteractiveZshCompletionAvailable()) {
            t.skip("interactive zsh completion not available");
            return;
          }
          const output = testInteractiveZshCompletion(
            zsh.generateScript("extapp"),
            "",
            [{ path: "src", type: "directory" }, { path: `src/${filename}` }],
            {
              setup,
              input: `extapp --format ${typed}`,
              backend: `printf '__FILE__:file::${pattern}:0\\0\\0\\n'`,
              captureBuffer: true,
              absentFiles: ["MARK"],
            },
          );
          deepStrictEqual(output, `extapp --format src/${completed} `);
        },
      );
    }

    it("should preserve backend Zsh qualifiers around literal dollar input", {
      skip: !isInteractiveZshCompletionAvailable(),
    }, (t) => {
      if (!isInteractiveZshCompletionAvailable()) {
        t.skip("interactive zsh completion not available");
        return;
      }
      const output = testInteractiveZshCompletion(
        zsh.generateScript("extapp"),
        "",
        [{ path: "src", type: "directory" }, { path: "src/a$x" }],
        {
          setup: "setopt globcomplete; touch -t 202001010000 work/src/a\\$x",
          input: "extapp --format @\\$x",
          backend: fileCompletionBackend.replace(
            'pattern="${2#@}"',
            'pattern="src/*${2#@}*(m+1)"',
          ).replace(":file:txt:", ":file::"),
          captureBuffer: true,
        },
      );
      deepStrictEqual(output, "extapp --format src/a\\$x ");
    });

    it("should preserve safe Zsh qualifiers with EXTENDED_GLOB unset", {
      skip: !isInteractiveZshCompletionAvailable(),
    }, (t) => {
      if (!isInteractiveZshCompletionAvailable()) {
        t.skip("interactive zsh completion not available");
        return;
      }
      const output = testInteractiveZshCompletion(
        zsh.generateScript("extapp"),
        "",
        [{ path: "file.txt" }],
        {
          setup:
            "setopt globcomplete; unsetopt extendedglob; touch -t 202001010000 work/file.txt",
          input: "extapp --format ",
          backend: "printf '__FILE__:file::*(m+1):0\\0\\0\\n'",
          captureBuffer: true,
        },
      );
      deepStrictEqual(output, "extapp --format file.txt ");
    });

    for (const pattern of ["*.txt", "*.(txt|md)", "~+/", "*(-.)", "*(m+1)"]) {
      it(`should preserve fixed Zsh pattern ${pattern}`, {
        skip: !isInteractiveZshCompletionAvailable(),
      }, (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }
        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          "",
          [{ path: "file.txt" }],
          {
            setup:
              "setopt globcomplete extendedglob; touch -t 202001010000 work/file.txt",
            input: "extapp --format ",
            backend: `printf '__FILE__:file::${pattern}:0\\0\\0\\n'`,
            captureBuffer: true,
          },
        );
        deepStrictEqual(
          output,
          `extapp --format ${pattern === "~+/" ? "~+/" : ""}file.txt `,
        );
      });
    }

    it("should preserve a fixed Zsh qualifier with partial input overlap", {
      skip: !isInteractiveZshCompletionAvailable(),
    }, (t) => {
      if (!isInteractiveZshCompletionAvailable()) {
        t.skip("interactive zsh completion not available");
        return;
      }
      const output = testInteractiveZshCompletion(
        zsh.generateScript("extapp"),
        "",
        [{ path: "src", type: "directory" }, { path: "src/file.txt" }],
        {
          setup:
            "setopt globcomplete extendedglob; touch -t 202001010000 work/src/file.txt",
          input: "extapp --format x\\(m",
          backend: "printf '__FILE__:file::src/*(m+1):0\\0\\0\\n'",
          captureBuffer: true,
        },
      );
      deepStrictEqual(output, "extapp --format src/file.txt ");
    });

    it(
      "should quote Zsh literal text between backend wildcards and a qualifier",
      {
        skip: !isInteractiveZshCompletionAvailable(),
      },
      (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }
        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          "",
          [{ path: "src", type: "directory" }, { path: "src/x(m-file.txt" }],
          {
            setup:
              "setopt globcomplete extendedglob; touch -t 202001010000 work/src/x\\(m-file.txt",
            input: "extapp --format @x\\(m",
            backend: fileCompletionBackend.replace(
              'pattern="${2#@}"',
              'pattern="src/*${2#@}*(m+1)"',
            ).replace(":file:txt:", ":file::"),
            captureBuffer: true,
          },
        );
        deepStrictEqual(output, "extapp --format src/x\\(m-file.txt ");
      },
    );

    it("should have correct name", () => {
      deepStrictEqual(zsh.name, "zsh");
    });

    it("should generate proper completion script", () => {
      const script = zsh.generateScript("myapp");

      // Check for essential zsh completion components
      deepStrictEqual(script.includes("function _myapp ()"), true);
      deepStrictEqual(
        script.includes("local -a completions descriptions"),
        true,
      );
      ok(script.includes('local current="$IPREFIX$PREFIX$SUFFIX$ISUFFIX"'));
      deepStrictEqual(
        script.includes("_describe 'commands' matches"),
        true,
      );
      deepStrictEqual(script.includes("compdef _myapp myapp"), true);
    });

    it("should start autoloaded scripts with a compdef header", () => {
      const script = zsh.generateScript("myapp");

      ok(script.startsWith("#compdef myapp\n"));
    });

    it("should guard compdef registration when compinit is not loaded", () => {
      const script = zsh.generateScript("myapp");

      ok(script.includes("if (( $+functions[compdef] )); then"));
      ok(script.includes("compdef _myapp myapp"));
    });

    for (
      const testCase of [
        {
          name: "directory-only relative glob",
          type: "directory" as const,
          pattern: "tmp/foo*",
          files: [
            { path: "tmp/foobar", type: "directory" as const },
            { path: "tmp/other", type: "directory" as const },
            { path: "tmp/foofile" },
          ],
          expected: "extapp --file tmp/foobar/",
        },
        {
          name: "directory-only root glob",
          type: "directory" as const,
          pattern: "foo?",
          files: [
            { path: "foo1", type: "directory" as const },
            { path: "other", type: "directory" as const },
            { path: "foo2" },
          ],
          expected: "extapp --file foo1/",
        },
        {
          name: "directory-only unmatched glob",
          type: "directory" as const,
          pattern: "tmp/foo*",
          files: [
            { path: "tmp/other", type: "directory" as const },
            { path: "tmp/foofile" },
          ],
          expected: "extapp --file ",
        },
        {
          name: "directory-only glob ignores file extensions",
          type: "directory" as const,
          pattern: "tmp/foo*",
          extensions: [".txt"],
          files: [
            { path: "tmp/foobar", type: "directory" as const },
            { path: "tmp/other", type: "directory" as const },
          ],
          expected: "extapp --file tmp/foobar/",
        },
        {
          name: "directory-only directories-tag ignored pattern",
          type: "directory" as const,
          pattern: "foo*",
          files: [
            { path: "foobar", type: "directory" as const },
            { path: "foobaz", type: "directory" as const },
            { path: "other", type: "directory" as const },
          ],
          setup: "zstyle ':completion:*:directories' ignored-patterns 'foobaz'",
          expected: "extapp --file foobar/",
        },
        {
          name: "directory-only glob in a directory with spaces",
          type: "directory" as const,
          pattern: "my docs/foo*",
          files: [
            { path: "my docs/foobar", type: "directory" as const },
            { path: "my docs/other", type: "directory" as const },
          ],
          expected: "extapp --file my\\ docs/foobar/",
        },
        {
          name: "any entry directory glob",
          type: "any" as const,
          pattern: "tmp/fixtures/*.txt",
          files: [
            { path: "tmp/fixtures", type: "directory" as const },
            { path: "tmp/fixtures/a.txt" },
            { path: "tmp/fixtures/b.json" },
          ],
          expected: "extapp --file tmp/fixtures/a.txt ",
        },
        {
          name: "any entry with a punctuated program name",
          programName: "audit-cli",
          type: "any" as const,
          pattern: "tmp/fixtures/*.txt",
          input: "audit-cli --file ",
          setup: 'audit-cli() { extapp "$@"; }',
          files: [
            { path: "tmp/fixtures", type: "directory" as const },
            { path: "tmp/fixtures/a.txt" },
            { path: "tmp/fixtures/b.json" },
          ],
          expected: "audit-cli --file tmp/fixtures/a.txt ",
        },
        {
          name: "any entry FIFO glob",
          type: "any" as const,
          pattern: "*.txt",
          files: [
            { path: "a.txt", type: "fifo" as const },
            { path: "b.json" },
          ],
          expected: "extapp --file a.txt ",
        },
        {
          name: "any entry FIFO glob with extensions",
          type: "any" as const,
          pattern: "*",
          extensions: [".txt"],
          files: [
            { path: "a.txt", type: "fifo" as const },
            { path: "b.json" },
          ],
          expected: "extapp --file a.txt ",
        },
        {
          name: "any entry disjoint glob and extensions",
          type: "any" as const,
          pattern: "*.json",
          extensions: [".txt"],
          files: [{ path: "a.txt" }, { path: "b.json" }],
          expected: "extapp --file ",
        },
        {
          name: "any entry directory navigation",
          type: "any" as const,
          pattern: "*.txt",
          files: [
            { path: "b.json" },
            { path: "sub", type: "directory" as const },
          ],
          expected: "extapp --file sub/",
        },
        {
          name: "directory glob",
          pattern: "tmp/fixtures/*.txt",
          files: [
            { path: "tmp/fixtures", type: "directory" as const },
            { path: "tmp/fixtures/a.txt" },
            { path: "tmp/fixtures/b.json" },
            { path: "tmp/fixtures/sub", type: "directory" as const },
          ],
          expected: "extapp --file tmp/fixtures/",
        },
        {
          name: "directory navigation without matching files",
          pattern: "tmp/fixtures/*.txt",
          files: [
            { path: "tmp/fixtures", type: "directory" as const },
            { path: "tmp/fixtures/b.json" },
            { path: "tmp/fixtures/sub", type: "directory" as const },
          ],
          expected: "extapp --file tmp/fixtures/sub/",
        },
        {
          name: "directory navigation with disjoint extensions",
          pattern: "tmp/fixtures/*.json",
          extensions: [".txt"],
          files: [
            { path: "tmp/fixtures", type: "directory" as const },
            { path: "tmp/fixtures/a.txt" },
            { path: "tmp/fixtures/b.json" },
            { path: "tmp/fixtures/sub", type: "directory" as const },
          ],
          expected: "extapp --file tmp/fixtures/sub/",
        },
        {
          name: "root directory navigation",
          pattern: "*.txt",
          files: [
            { path: "b.json" },
            { path: "sub", type: "directory" as const },
          ],
          expected: "extapp --file sub/",
        },
        {
          name: "directories-tag ignored pattern",
          pattern: "*.txt",
          files: [
            { path: "a.txt" },
            { path: "sub", type: "directory" as const },
          ],
          setup: "zstyle ':completion:*:directories' ignored-patterns 'sub'",
          expected: "extapp --file a.txt ",
        },
        {
          name: "root glob",
          pattern: "*.txt",
          files: [{ path: "a.txt" }, { path: "b.json" }],
          expected: "extapp --file a.txt ",
        },
        {
          name: "unmatched glob",
          pattern: "*.txt",
          files: [{ path: "b.json" }],
          expected: "extapp --file ",
        },
        {
          name: "glob with extensions",
          pattern: "tmp/fixtures/*",
          extensions: [".txt"],
          files: [
            { path: "tmp/fixtures", type: "directory" as const },
            { path: "tmp/fixtures/a.txt" },
            { path: "tmp/fixtures/b.json" },
          ],
          expected: "extapp --file tmp/fixtures/a.txt ",
        },
        {
          name: "disjoint glob and extensions",
          pattern: "*.json",
          extensions: [".txt"],
          files: [{ path: "a.txt" }, { path: "b.json" }],
          expected: "extapp --file ",
        },
        {
          name: "multiple extensions",
          pattern: "*",
          extensions: [".txt", ".md"],
          files: [{ path: "a.txt" }, { path: "b.json" }],
          expected: "extapp --file a.txt ",
        },
        {
          name: "globcomplete enabled",
          pattern: "tmp/fixtures/*.txt",
          setup: "setopt glob_complete",
          files: [
            { path: "tmp/fixtures", type: "directory" as const },
            { path: "tmp/fixtures/a.txt" },
            { path: "tmp/fixtures/b.json" },
          ],
          expected: "extapp --file tmp/fixtures/a.txt ",
        },
        {
          name: "typed matching prefix",
          pattern: "tmp/fixtures/*.txt",
          input: "extapp --file tmp/fixtures/a",
          files: [
            { path: "tmp/fixtures", type: "directory" as const },
            { path: "tmp/fixtures/a.txt" },
            { path: "tmp/fixtures/b.json" },
          ],
          expected: "extapp --file tmp/fixtures/a.txt ",
        },
        {
          name: "multiple matches",
          pattern: "tmp/fixtures/*.txt",
          files: [
            { path: "tmp/fixtures", type: "directory" as const },
            { path: "tmp/fixtures/a.txt" },
            { path: "tmp/fixtures/c.txt" },
            { path: "tmp/fixtures/b.json" },
          ],
          expected: "extapp --file tmp/fixtures/",
        },
        {
          name: "directory with spaces",
          pattern: "my docs/*.txt",
          files: [
            { path: "my docs", type: "directory" as const },
            { path: "my docs/a.txt" },
          ],
          expected: "extapp --file my\\ docs/a.txt ",
        },
        {
          name: "directory with a glob operator",
          pattern: "C#/*.txt",
          files: [
            { path: "C#", type: "directory" as const },
            { path: "C#/a.txt" },
          ],
          expected: "extapp --file C\\#/a.txt ",
        },
        {
          name: "directory with a quote",
          pattern: "it's/*.txt",
          files: [
            { path: "it's", type: "directory" as const },
            { path: "it's/a.txt" },
          ],
          expected: "extapp --file it\\'s/a.txt ",
        },
        {
          name: "dot relative directory",
          pattern: "./tmp/fixtures/*.txt",
          files: [
            { path: "tmp/fixtures", type: "directory" as const },
            { path: "tmp/fixtures/a.txt" },
          ],
          expected: "extapp --file ./tmp/fixtures/a.txt ",
        },
        {
          name: "files-tag ignored pattern",
          pattern: "*.txt",
          files: [{ path: "a.txt" }, { path: "b.json" }],
          setup: "zstyle ':completion:*:files' ignored-patterns 'a.txt'",
          expected: "extapp --file ",
        },
        {
          name: "excluded filename brackets (file)",
          type: "file" as const,
          pattern: "foo[1]*.txt",
          files: [
            { path: "foo[1]-a.txt" },
            { path: "foo1-b.txt" },
          ],
          expected: "extapp --file ",
        },
        {
          name: "excluded filename backslash (file)",
          type: "file" as const,
          pattern: "foo\\name*.txt",
          files: [
            { path: "foo\\name-a.txt" },
            { path: "fooname-b.txt" },
          ],
          expected: "extapp --file ",
        },
        {
          name: "excluded filename brackets (any)",
          type: "any" as const,
          pattern: "foo[1]*.txt",
          files: [
            { path: "foo[1]-a.txt" },
            { path: "foo1-b.txt" },
          ],
          expected: "extapp --file ",
        },
        {
          name: "excluded filename backslash (any)",
          type: "any" as const,
          pattern: "foo\\name*.txt",
          files: [
            { path: "foo\\name-a.txt" },
            { path: "fooname-b.txt" },
          ],
          expected: "extapp --file ",
        },
        {
          name: "excluded filename brackets (directory)",
          type: "directory" as const,
          pattern: "foo[1]*.txt",
          files: [
            { path: "foo[1]-a.txt", type: "directory" as const },
            { path: "foo1-b.txt", type: "directory" as const },
          ],
          expected: "extapp --file ",
        },
        {
          name: "excluded filename backslash (directory)",
          type: "directory" as const,
          pattern: "foo\\name*.txt",
          files: [
            { path: "foo\\name-a.txt", type: "directory" as const },
            { path: "fooname-b.txt", type: "directory" as const },
          ],
          expected: "extapp --file ",
        },
        {
          name: "excluded filename glob operator",
          pattern: "report(1)*.txt",
          files: [{ path: "report1b.txt" }],
          expected: "extapp --file ",
        },
        {
          name: "excluded filename token separator",
          pattern: "a;*.txt",
          files: [{ path: "zzz.txt" }],
          expected: "extapp --file ",
        },
        {
          name: "excluded filename whitespace",
          pattern: "my *.txt",
          files: [{ path: "my a.txt" }, { path: "other.txt" }],
          expected: "extapp --file ",
        },
        {
          name: "excluded directory wildcard",
          pattern: "tmp/fix*/*.txt",
          files: [
            { path: "tmp/fixtures", type: "directory" as const },
            { path: "tmp/fixtures/a.txt" },
          ],
          expected: "extapp --file ",
        },
        {
          name: "bracket directory globcomplete",
          pattern: "tmp/[ab]/*.txt",
          setup: "setopt glob_complete",
          files: [
            { path: "tmp/a", type: "directory" as const },
            { path: "tmp/a/foo.txt" },
          ],
          expected: "extapp --file tmp/a/foo.txt ",
        },
        {
          name: "grouped directory globcomplete",
          pattern: "tmp/(a|b)/*.txt",
          setup: "setopt glob_complete",
          files: [
            { path: "tmp/a", type: "directory" as const },
            { path: "tmp/a/foo.txt" },
          ],
          expected: "extapp --file tmp/a/foo.txt ",
        },
        {
          name: "no pattern",
          files: [{ path: "a.txt" }],
          expected: "extapp --file a.txt ",
        },
      ]
    ) {
      it(`should complete initial zsh file values: ${testCase.name}`, {
        skip: !isInteractiveZshCompletionAvailable() ||
          (testCase.files.some((file) =>
            "type" in file && file.type === "fifo"
          ) &&
            !isShellAvailable("mkfifo")),
        timeout: 10000,
      }, () => {
        if (!isInteractiveZshCompletionAvailable()) return;
        if (
          testCase.files.some((file) =>
            "type" in file && file.type === "fifo"
          ) &&
          !isShellAvailable("mkfifo")
        ) return;
        const directive = Array.from(zsh.encodeSuggestions([{
          kind: "file",
          type: testCase.type ?? "file",
          pattern: testCase.pattern,
          extensions: testCase.extensions,
        }]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");
        const output = testInteractiveZshCompletion(
          zsh.generateScript(testCase.programName ?? "extapp"),
          directive,
          testCase.files,
          {
            input: testCase.input ?? "extapp --file ",
            captureBuffer: true,
            setup: `unsetopt glob_complete
zstyle ':completion:*' completer _complete
${testCase.setup ?? ""}`,
          },
        );
        ok(
          !output.includes("b.json"),
          `Nonmatching JSON file should not appear, got:\n${output}`,
        );
        deepStrictEqual(output, testCase.expected);
      });
    }

    it("should build #q-qualified extension globs in zsh", () => {
      const script = zsh.generateScript("myapp");
      const fileCase = script.substring(
        script.indexOf('case "$type" in'),
        script.indexOf("esac"),
      );
      const fileCaseBlock = fileCase.substring(
        fileCase.indexOf("file|any)"),
        fileCase.indexOf("directory)"),
      );
      const anyCaseBlock = fileCaseBlock;

      // A single extension must avoid grouped-glob syntax because *.(json)
      // does not work in zsh completion, while multiple extensions still
      // need grouped globbing.  The resulting qualifier must also avoid bare
      // glob-qualifier syntax so it still works when bareglobqual is unset.
      // https://github.com/dahlia/optique/issues/799
      ok(script.includes('if [[ "$extensions" == *,* ]]; then'));
      ok(script.includes('ext_pattern="*.(${extensions//,/|})"'));
      ok(script.includes('ext_pattern="*.$extensions"'));
      ok(
        fileCaseBlock.includes('local file_pattern="${ext_pattern:-*}(#q-.)"'),
      );
      ok(
        fileCaseBlock.includes(
          '_path_files -g "${file_pattern}" "${expl[@]}" "${file_ignore_args[@]}"',
        ),
      );
      ok(
        anyCaseBlock.includes('local file_pattern="${ext_pattern}(#q^-/)"'),
      );
      ok(
        anyCaseBlock.includes(
          '_wanted files expl file _path_files -g "${file_pattern}"',
        ),
      );
      ok(!script.includes('_path_files -g "${ext_pattern}(-.)"'));
    });

    it(
      "should not forward stale expl arguments between zsh completion tags",
      (t) => {
        if (!isShellAvailable("zsh")) {
          t.skip("zsh not available");
          return;
        }

        const tempDir = mkdtempSync(join(tmpdir(), "zsh-wanted-expl-"));

        try {
          const directive = Array.from(zsh.encodeSuggestions([
            {
              kind: "file",
              type: "file",
              extensions: [".json"],
              includeHidden: false,
            },
          ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");

          const cliPath = join(tempDir, "extapp");
          writeFileSync(
            cliPath,
            `#!/bin/bash
printf '${directive}'
`,
            { mode: 0o755 },
          );

          const script = zsh.generateScript("extapp");
          const testScript = `
export PATH="${tempDir}:$PATH"
autoload -U compinit && compinit -D 2>/dev/null

function _tags() {
  if (( $# )); then
    __tag_round=0
    __file_label_round=0
    __directory_label_round=0
    return 0
  fi
  (( __tag_round++ == 0 ))
}
function _next_label() {
  if [[ "$1" == files ]]; then
    (( __file_label_round++ == 0 )) || return 1
  else
    (( __directory_label_round++ == 0 )) || return 1
  fi
  __current_tag="$1"
  eval "$2=(--tag $1)"
  _comp_ignore=()
}

function _path_files() {
  print -r -- "$__current_tag:$#:_path_files $*"
  return 0
}

source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT

words=("extapp" "")
CURRENT=2
_extapp 2>/dev/null
`;

          const output = runCommand("zsh", ["-c", testScript], {
            cwd: tempDir,
          });
          const calls = output.trim().split("\n").filter((line) =>
            line.length > 0
          );
          const fileCall = calls.find((line) => line.startsWith("files:"));
          const directoryCall = calls.find((line) =>
            line.startsWith("directories:")
          );

          ok(
            fileCall?.includes("_path_files -g *.json(#q-.)"),
            `Expected files completion call to include filtered _path_files args, got: ${
              JSON.stringify(calls)
            }`,
          );
          ok(
            directoryCall?.includes("_path_files -/"),
            `Expected directories completion call to include directory navigation args, got: ${
              JSON.stringify(calls)
            }`,
          );
          ok(
            directoryCall?.startsWith("directories:3:"),
            `directories completion call should receive only its own tag arguments, got: ${
              JSON.stringify(calls)
            }`,
          );
          ok(
            !directoryCall?.includes("--tag files"),
            `directories completion call should not inherit the files tag's expl array, got: ${
              JSON.stringify(calls)
            }`,
          );
        } finally {
          rmSync(tempDir, { recursive: true, force: true });
        }
      },
    );

    it("should disable sh_glob around native file completion", () => {
      const script = zsh.generateScript("myapp");

      ok(script.includes("local __was_sh_glob=0"));
      ok(script.includes("[[ -o sh_glob ]] && __was_sh_glob=1"));
      ok(script.includes("unsetopt sh_glob"));
      ok(
        script.includes(
          'if [[ "$__was_sh_glob" == "1" ]]; then setopt sh_glob; else unsetopt sh_glob; fi',
        ),
      );
    });

    it("should filter files by dot-prefixed extensions in zsh", (t) => {
      if (!isShellAvailable("zsh")) {
        t.skip("zsh not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "zsh-ext-dot-filter-"),
      );

      try {
        const directive = Array.from(zsh.encodeSuggestions([
          {
            kind: "file",
            type: "file",
            extensions: [".json", ".yaml"],
            includeHidden: false,
          },
        ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");

        // Emit the encoded zsh transport so the test exercises both
        // dot-prefix normalization and the native file completion branch.
        const cliScript = `#!/bin/bash
printf '${directive}'
`;
        const cliPath = join(tempDir, "extapp");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        writeFileSync(join(tempDir, "data.json"), "");
        writeFileSync(join(tempDir, "config.yaml"), "");
        writeFileSync(join(tempDir, "readme.txt"), "");
        const subDir = join(tempDir, "subdir");
        mkdirSync(subDir);

        const script = zsh.generateScript("extapp");

        const testScript = `
export PATH="${tempDir}:$PATH"
autoload -U compinit && compinit -D 2>/dev/null

# Completion functions should use zsh's native glob syntax regardless of
# the caller's option state.  SH_GLOB disables bare grouping, which would
# otherwise break patterns like *.(json|yaml).
setopt sh_glob

function _tags() {
  if (( $# )); then
    __tag_round=0
    __file_label_round=0
    __directory_label_round=0
    return 0
  fi
  (( __tag_round++ == 0 ))
}
function _next_label() {
  if [[ "$1" == files ]]; then
    (( __file_label_round++ == 0 )) || return 1
  else
    (( __directory_label_round++ == 0 )) || return 1
  fi
  eval "$2=()"
  _comp_ignore=()
}

function _wanted() {
  shift 3
  "$@"
}

function _description() {
  eval "$2=()"
}

function _alternative() {
  local spec action
  for spec in "$@"; do
    action="\${spec#*:*:}"
    eval "$action"
  done
}

function _path_files() {
  local pattern="*"
  local want_dirs=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      -g)
        pattern="$2"
        shift 2
        ;;
      -/)
        want_dirs=1
        shift
        ;;
      *)
        shift
        ;;
    esac
  done

  setopt localoptions null_glob
  local item
  if [[ "$want_dirs" == "1" ]]; then
    for item in */; do
      if [[ -d "$item" ]]; then
        print -r -- "\${item%/}/"
      fi
    done
  else
    # The generated script uses a #q-qualified suffix so filtered globbing
    # works even when bareglobqual is unset.  This lightweight test double
    # only needs the raw glob because it already filters candidates with -f.
    pattern="\${pattern%\\(#q^-/\\)}"
    pattern="\${pattern%\\(#q-.\\)}"
    for item in \${~pattern}; do
      if [[ -f "$item" ]]; then
        print -r -- "$item"
      fi
    done
  fi
}

source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT

cd "${tempDir}"
words=("extapp" "")
CURRENT=2
_extapp 2>/dev/null
`;

        const result = runCommand("zsh", ["-c", testScript], {
          cwd: tempDir,
        });
        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );

        ok(
          completions.some((c) => c.includes("data.json")),
          `Expected data.json in completions, got: ${
            JSON.stringify(completions)
          }`,
        );
        ok(
          completions.some((c) => c.includes("config.yaml")),
          `Expected config.yaml in completions, got: ${
            JSON.stringify(completions)
          }`,
        );
        ok(
          !completions.some((c) => c.includes("readme.txt")),
          `Should not include readme.txt in completions, got: ${
            JSON.stringify(completions)
          }`,
        );
        ok(
          completions.some((c) => c.includes("subdir/")),
          `Expected subdir/ in completions for navigation, got: ${
            JSON.stringify(completions)
          }`,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should work with actual zsh shell", {
      timeout: 10000,
    }, (t) => {
      if (!isShellAvailable("zsh")) {
        t.skip("zsh not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "zsh-completion-"));

      try {
        const cliPath = createTestCli(tempDir);
        const programName = "test-cli";
        const script = zsh.generateScript(programName, ["completion", "zsh"]);

        const result = testZshCompletion(
          script,
          programName,
          dirname(cliPath),
        );

        // For zsh, we verify that the completion function can be loaded
        // and executed without errors
        deepStrictEqual(result.includes("success"), true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should not fail when sourced before compinit in zsh", (t) => {
      if (!isShellAvailable("zsh")) {
        t.skip("zsh not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "zsh-source-without-compinit-"),
      );

      try {
        const scriptPath = join(tempDir, "completion.zsh");
        writeFileSync(scriptPath, zsh.generateScript("myapp"));

        runCommand(
          "zsh",
          ["-fc", 'source "$1"', "zsh", scriptPath],
          { cwd: tempDir, stdio: "ignore" },
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    const literalCases: readonly {
      readonly name: string;
      readonly value: string;
      readonly prefix: string;
      readonly expected: string;
      readonly description?: string;
    }[] = [
      {
        name: "colon without description",
        value: "foo:bar",
        prefix: "f",
        expected: "extapp foo:bar ",
      },
      {
        name: "colon with description",
        value: "foo:bar",
        prefix: "f",
        description: "1: real description",
        expected: "extapp foo:bar ",
      },
      {
        name: "backslash before colon",
        value: "foo\\:bar",
        prefix: "f",
        expected: "extapp foo\\\\:bar ",
      },
      {
        name: "trailing backslash with description",
        value: "C:\\",
        prefix: "C",
        description: "drive",
        expected: "extapp C:\\\\ ",
      },
      {
        name: "URL with multiple colons and percent encoding",
        value: "https://example.test:8443/a%20b",
        prefix: "https://exa",
        expected: "extapp https://example.test:8443/a%20b ",
      },
      {
        name: "prefix past a colon",
        value: "foo:bar",
        prefix: "foo:b",
        expected: "extapp foo:bar ",
      },
      {
        name: "leading colon",
        value: ":foo",
        prefix: ":",
        expected: "extapp :foo ",
      },
      {
        name: "trailing colon",
        value: "foo:",
        prefix: "f",
        expected: "extapp foo: ",
      },
      {
        name: "adjacent colons",
        value: "foo::bar",
        prefix: "f",
        expected: "extapp foo::bar ",
      },
      {
        name: "reserved file marker with colons",
        value: "__FILE__:directory:::0",
        prefix: "__FI",
        description: "literal file marker",
        expected: "extapp __FILE__:directory:::0 ",
      },
      {
        name: "backslash without colon",
        value: "foo\\bar",
        prefix: "f",
        expected: "extapp foo\\\\bar ",
      },
      {
        name: "single quote",
        value: "foo'bar",
        prefix: "f",
        expected: "extapp foo\\'bar ",
      },
      {
        name: "plain value control",
        value: "plain",
        prefix: "p",
        expected: "extapp plain ",
      },
      {
        name: "space value control",
        value: "foo bar",
        prefix: "f",
        expected: "extapp foo\\ bar ",
      },
    ];

    for (
      const style of [
        { name: "default", setup: "" },
        {
          name: "ungrouped",
          setup: "zstyle ':completion:*' list-grouped no",
        },
        {
          name: "nonverbose",
          setup: "zstyle ':completion:*' verbose no",
        },
      ]
    ) {
      const cases = style.name === "default"
        ? literalCases
        : literalCases.slice(0, 4);
      for (const scenario of cases) {
        it(
          `should insert literal ${scenario.name} in actual zsh (${style.name})`,
          {
            skip: !isInteractiveZshCompletionAvailable(),
            timeout: 10000,
          },
          (t) => {
            if (!isInteractiveZshCompletionAvailable()) {
              t.skip("interactive zsh completion not available");
              return;
            }
            const payload = Array.from(zsh.encodeSuggestions([{
              kind: "literal",
              text: scenario.value,
              description: scenario.description == null
                ? undefined
                : [text(scenario.description)],
            }])).map((record) => `${record}\n`).join("");
            const buffer = testInteractiveZshCompletion(
              zsh.generateScript("extapp"),
              "",
              [],
              {
                payload,
                input: `extapp ${scenario.prefix}`,
                captureBuffer: true,
                setup: `COLUMNS=120\n${style.setup}`,
              },
            );
            deepStrictEqual(buffer, scenario.expected);
          },
        );
      }

      it(
        `should list full colon values with descriptions in actual zsh (${style.name})`,
        {
          skip: !isInteractiveZshCompletionAvailable(),
          timeout: 10000,
        },
        (t) => {
          if (!isInteractiveZshCompletionAvailable()) {
            t.skip("interactive zsh completion not available");
            return;
          }
          const payload = Array.from(zsh.encodeSuggestions([
            { kind: "literal", text: "foo:bar" },
            {
              kind: "literal",
              text: "foo:baz",
              description: message`real description`,
            },
            {
              kind: "literal",
              text: "foo:bat",
              description: message`real description`,
            },
          ])).map((record) => `${record}\n`).join("");
          const output = testInteractiveZshCompletion(
            zsh.generateScript("extapp"),
            "",
            [],
            { payload, setup: `COLUMNS=120\n${style.setup}` },
          );
          ok(output.includes("foo:bar"), output);
          ok(output.includes("foo:baz"), output);
          ok(output.includes("foo:bat"), output);
          ok(!output.includes("-- bar"), output);
          if (style.name === "nonverbose") {
            ok(!output.includes("real description"), output);
          } else {
            ok(output.includes("real description"), output);
          }
        },
      );
    }

    it("should keep colons and backslashes unchanged in zsh transport", () => {
      deepStrictEqual(
        Array.from(zsh.encodeSuggestions([{
          kind: "literal",
          text: "foo\\:bar",
          description: message`1: real description`,
        }])),
        ["foo\\:bar\0" + "1: real description\0"],
      );
    });

    for (
      const scenario of [
        { name: "default options", extensions: undefined, setup: "" },
        {
          name: "empty extensions and bareglobqual unset",
          extensions: [],
          setup: "unsetopt bareglobqual",
        },
        {
          name: "file-patterns forcing all-files",
          extensions: undefined,
          setup: "zstyle ':completion:*' file-patterns '*:all-files'",
        },
        {
          name: "fignore",
          extensions: undefined,
          setup: "fignore=(.o)",
          ignoresObject: true,
        },
        {
          name: "ignored-patterns overriding fignore",
          extensions: undefined,
          setup:
            "fignore=(.o)\nzstyle ':completion:*:files' ignored-patterns '*.skip'",
          ignoresStyle: true,
        },
        {
          name: "described tag labels overriding fignore",
          extensions: undefined,
          setup:
            "fignore=(.o)\nzstyle ':completion:*' ignored-patterns '*.skip'\nzstyle ':completion:*' tag-order '*:custom:custom'",
          ignoresStyle: true,
        },
        {
          name: "hidden files requested",
          extensions: undefined,
          setup: "",
          includeHidden: true,
        },
      ]
    ) {
      it(
        `should restrict unfiltered file suggestions in actual zsh with ${scenario.name}`,
        {
          skip: !isInteractiveZshCompletionAvailable() ||
            !isShellAvailable("mkfifo"),
          timeout: 10000,
        },
        () => {
          if (
            !isInteractiveZshCompletionAvailable() ||
            !isShellAvailable("mkfifo")
          ) return;

          const directive = Array.from(zsh.encodeSuggestions([
            {
              kind: "file",
              type: "file",
              extensions: scenario.extensions,
              includeHidden: scenario.includeHidden ?? false,
            },
          ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");
          const output = testInteractiveZshCompletion(
            zsh.generateScript("extapp"),
            directive,
            [
              { path: "plain" },
              { path: "file-alias", type: "symlink", target: "plain" },
              { path: "named-pipe", type: "fifo" },
              { path: "pipe-link", type: "symlink", target: "named-pipe" },
              { path: "dangling", type: "symlink", target: "missing" },
              { path: "subdir", type: "directory" },
              { path: "alias-dir", type: "symlink", target: "subdir" },
              { path: "obj.o" },
              { path: "style.skip" },
              { path: ".hidden" },
              { path: ".hidden-pipe", type: "fifo" },
            ],
            { setup: scenario.setup },
          );
          for (
            const candidate of ["plain", "file-alias", "subdir/", "alias-dir"]
          ) {
            ok(
              output.includes(candidate),
              `Expected ${candidate}, got:\n${output}`,
            );
          }
          for (
            const candidate of [
              "named-pipe",
              "pipe-link",
              "dangling",
              ".hidden-pipe",
            ]
          ) {
            ok(
              !output.includes(candidate),
              `Unexpected ${candidate}, got:\n${output}`,
            );
          }
          if (scenario.ignoresObject) {
            ok(
              !output.includes("obj.o"),
              `fignore should hide obj.o, got:\n${output}`,
            );
          } else {
            ok(output.includes("obj.o"), `Expected obj.o, got:\n${output}`);
          }
          if (scenario.ignoresStyle) {
            ok(
              !output.includes("style.skip"),
              `ignored-patterns should hide style.skip, got:\n${output}`,
            );
          } else {
            ok(
              output.includes("style.skip"),
              `Expected style.skip, got:\n${output}`,
            );
          }
          if (scenario.includeHidden) {
            ok(
              output.includes(".hidden"),
              `Expected hidden regular file, got:\n${output}`,
            );
          } else {
            ok(
              !output.includes(".hidden"),
              `Hidden files should be omitted, got:\n${output}`,
            );
          }
        },
      );
    }

    for (const type of ["file", "any", "directory"] as const) {
      for (
        const global of [
          { setup: "unset expl", expected: ":unset" },
          {
            setup: "typeset -g expl=user-sentinel",
            expected: "user-sentinel:scalar",
          },
          {
            setup: "typeset -ga expl=(user-alpha user-beta)",
            expected: "user-alpha,user-beta:array",
          },
        ]
      ) {
        it(
          `should preserve globals in initial zsh native ${type} completion: ${global.expected}`,
          {
            skip: !isInteractiveZshCompletionAvailable(),
            timeout: 10000,
          },
          () => {
            if (!isInteractiveZshCompletionAvailable()) return;
            const directive = Array.from(zsh.encodeSuggestions([
              { kind: "file", type, pattern: "*.txt" },
            ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");
            const output = testInteractiveZshCompletion(
              zsh.generateScript("extapp"),
              directive,
              [{
                path: "first.txt",
                type: type === "directory" ? "directory" : "file",
              }, {
                path: "second.txt",
                type: type === "directory" ? "directory" : "file",
              }],
              {
                setup: global.setup,
                afterCompletion:
                  'print -r -- "__GLOBAL_EXPL:${(j:,:)expl}:${parameters[expl]-unset}"',
              },
            );
            ok(
              output.includes("first.txt") && output.includes("second.txt"),
              output,
            );
            ok(output.includes(`__GLOBAL_EXPL:${global.expected}`), output);
          },
        );
      }
    }

    for (const type of ["file", "any"] as const) {
      for (
        const scenario of [
          { first: "directories", second: "files", withDirectory: true },
          { first: "directories", second: "files", withDirectory: false },
          { first: "files", second: "directories", withDirectory: true },
        ]
      ) {
        it(
          `should honor ordered tags in initial zsh native ${type} completion: ${scenario.first}, directories ${scenario.withDirectory}`,
          {
            skip: !isInteractiveZshCompletionAvailable(),
            timeout: 10000,
          },
          () => {
            if (!isInteractiveZshCompletionAvailable()) return;
            const directive = Array.from(zsh.encodeSuggestions([
              { kind: "file", type, pattern: "*.txt", extensions: ["txt"] },
            ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");
            const output = testInteractiveZshCompletion(
              zsh.generateScript("extapp"),
              directive,
              [
                { path: "regular.txt" },
                ...(scenario.withDirectory
                  ? [{ path: "navigation", type: "directory" as const }]
                  : []),
              ],
              {
                setup:
                  `zstyle ':completion:*' tag-order '${scenario.first}' '${scenario.second}'`,
              },
            );
            if (scenario.first === "directories" && scenario.withDirectory) {
              ok(output.includes("navigation/"), output);
              ok(!output.includes("regular.txt"), output);
            } else {
              ok(output.includes("regular.txt"), output);
              ok(!output.includes("navigation"), output);
            }
          },
        );
      }
      for (const extensions of [undefined, ["txt"]]) {
        it(
          `should list directories first in initial zsh native ${type} completion with extensions ${extensions}`,
          {
            skip: !isInteractiveZshCompletionAvailable(),
            timeout: 10000,
          },
          () => {
            if (!isInteractiveZshCompletionAvailable()) return;
            const directive = Array.from(zsh.encodeSuggestions([
              { kind: "file", type, pattern: "*.txt", extensions },
            ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");
            const output = testInteractiveZshCompletion(
              zsh.generateScript("extapp"),
              directive,
              [{ path: "aaa.txt" }, { path: "zzz", type: "directory" }],
              {
                setup:
                  "zstyle ':completion:*' group-name ''; zstyle ':completion:*' list-dirs-first true",
              },
            );
            const directoryIndex = output.indexOf("zzz/");
            const fileIndex = output.indexOf("aaa.txt");
            ok(directoryIndex >= 0 && fileIndex >= 0, output);
            ok(directoryIndex < fileIndex, output);
          },
        );
      }
    }

    for (
      const scenario of [
        {
          name: "enabled",
          pattern: "target*.txt",
          recursive: "*",
          expected: true,
        },
        {
          name: "extension filter",
          pattern: "target*",
          extensions: ["txt"],
          recursive: "*",
          expected: true,
        },
        {
          name: "disjoint extension filter",
          pattern: "target*.json",
          extensions: ["txt"],
          recursive: "*",
          expected: false,
        },
        {
          name: "disabled",
          pattern: "target*.txt",
          recursive: "",
          expected: false,
        },
        {
          name: "ineligible directory",
          pattern: "target*.txt",
          recursive: "/not-current/",
          expected: false,
        },
        {
          name: "explicit directory",
          pattern: "nested/target*.txt",
          recursive: "*",
          expected: true,
        },
      ]
    ) {
      it(
        `should preserve recursive-files in initial zsh native completion: ${scenario.name}`,
        {
          skip: !isInteractiveZshCompletionAvailable() ||
            !isShellAvailable("mkfifo"),
          timeout: 10000,
        },
        () => {
          if (
            !isInteractiveZshCompletionAvailable() ||
            !isShellAvailable("mkfifo")
          ) return;
          const directive = Array.from(zsh.encodeSuggestions([
            {
              kind: "file",
              type: "file",
              pattern: scenario.pattern,
              extensions: scenario.extensions,
            },
          ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");
          const output = testInteractiveZshCompletion(
            zsh.generateScript("extapp"),
            directive,
            [
              { path: "nested", type: "directory" },
              { path: "nested/target.txt" },
              { path: "nested/target.json" },
              { path: "nested/other.txt" },
              { path: "nested/target-pipe.txt", type: "fifo" },
            ],
            {
              captureBuffer: true,
              setup: `zstyle ':completion:*' tag-order 'files' 'directories'\n${
                scenario.recursive === ""
                  ? ""
                  : `zstyle ':completion:*:files' recursive-files '${scenario.recursive}'`
              }`,
            },
          );
          if (scenario.expected) {
            ok(output.includes("extapp nested/target.txt"), output);
          } else {
            ok(!output.includes("target.txt"), output);
          }
          ok(!output.includes("target.json"), output);
          ok(!output.includes("other.txt"), output);
          ok(!output.includes("target-pipe.txt"), output);
        },
      );
    }

    for (const extensions of [undefined, ["txt"]]) {
      for (
        const global of [
          {
            setup: "typeset -g expl=user-sentinel",
            expected: "user-sentinel:scalar",
          },
          {
            setup: "typeset -ga expl=(user-alpha user-beta)",
            expected: "user-alpha,user-beta:array",
          },
        ]
      ) {
        it(
          `should preserve global expl ${global.expected} in zsh with extensions ${extensions}`,
          {
            skip: !isInteractiveZshCompletionAvailable(),
            timeout: 10000,
          },
          () => {
            if (!isInteractiveZshCompletionAvailable()) return;
            const directive = Array.from(zsh.encodeSuggestions([
              { kind: "file", type: "file", extensions },
            ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");
            const output = testInteractiveZshCompletion(
              zsh.generateScript("extapp"),
              directive,
              [{ path: "first.txt" }, { path: "second.txt" }],
              {
                setup: global.setup,
                afterCompletion:
                  'print -r -- "__GLOBAL_EXPL:${(j:,:)expl}:${parameters[expl]}"',
              },
            );
            ok(output.includes(`__GLOBAL_EXPL:${global.expected}`), output);
          },
        );
      }
    }

    for (const extensions of [undefined, []]) {
      it(
        `should list directories first for unfiltered zsh paths with extensions ${extensions}`,
        {
          skip: !isInteractiveZshCompletionAvailable() ||
            !isShellAvailable("mkfifo"),
          timeout: 10000,
        },
        () => {
          if (
            !isInteractiveZshCompletionAvailable() ||
            !isShellAvailable("mkfifo")
          ) return;
          const directive = Array.from(zsh.encodeSuggestions([
            { kind: "file", type: "file", extensions },
          ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");
          const output = testInteractiveZshCompletion(
            zsh.generateScript("extapp"),
            directive,
            [{ path: "aaa.txt" }, { path: "zzz", type: "directory" }, {
              path: "pipe",
              type: "fifo",
            }],
            {
              setup:
                "zstyle ':completion:*' group-name ''; zstyle ':completion:*' list-dirs-first true",
            },
          );
          const directoryIndex = output.indexOf("zzz/");
          const fileIndex = output.indexOf("aaa.txt");
          ok(directoryIndex >= 0 && fileIndex >= 0, output);
          ok(directoryIndex < fileIndex, output);
          ok(!output.includes("pipe"), output);
        },
      );
    }

    for (const extensions of [undefined, ["txt"]]) {
      for (
        const scenario of [
          { first: "directories", second: "files", withDirectory: true },
          { first: "directories", second: "files", withDirectory: false },
          { first: "files", second: "directories", withDirectory: true },
        ]
      ) {
        it(
          `should honor ordered zsh tag fallback with ${scenario.first} first, directories ${scenario.withDirectory}, extensions ${extensions}`,
          { skip: !isInteractiveZshCompletionAvailable(), timeout: 10000 },
          () => {
            if (!isInteractiveZshCompletionAvailable()) return;
            const directive = Array.from(zsh.encodeSuggestions([
              { kind: "file", type: "file", extensions },
            ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");
            const output = testInteractiveZshCompletion(
              zsh.generateScript("extapp"),
              directive,
              [
                { path: "regular.txt" },
                ...(scenario.withDirectory
                  ? [{ path: "navigation", type: "directory" as const }]
                  : []),
              ],
              {
                setup:
                  `zstyle ':completion:*' tag-order '${scenario.first}' '${scenario.second}'`,
              },
            );
            if (scenario.first === "directories" && scenario.withDirectory) {
              ok(output.includes("navigation/"), output);
              ok(!output.includes("regular.txt"), output);
            } else {
              ok(output.includes("regular.txt"), output);
              ok(!output.includes("navigation"), output);
            }
          },
        );
      }
    }

    for (
      const scenario of [
        { name: "unfiltered", extensions: undefined, recursive: "*" },
        { name: "empty extensions", extensions: [], recursive: "*" },
        {
          name: "ineligible current directory",
          extensions: undefined,
          recursive: "/not-the-current-directory/",
        },
      ]
    ) {
      it(
        `should preserve recursive-files for ${scenario.name} zsh paths`,
        {
          skip: !isInteractiveZshCompletionAvailable() ||
            !isShellAvailable("mkfifo"),
          timeout: 10000,
        },
        () => {
          if (
            !isInteractiveZshCompletionAvailable() ||
            !isShellAvailable("mkfifo")
          ) return;
          const directive = Array.from(zsh.encodeSuggestions([
            { kind: "file", type: "file", extensions: scenario.extensions },
          ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");
          const output = testInteractiveZshCompletion(
            zsh.generateScript("extapp"),
            directive,
            [
              { path: "nested", type: "directory" },
              { path: "nested/target.txt" },
              {
                path: "nested/target-link",
                type: "symlink",
                target: "target.txt",
              },
              { path: "nested/target-pipe", type: "fifo" },
              {
                path: "nested/target-pipe-link",
                type: "symlink",
                target: "target-pipe",
              },
            ],
            {
              currentWord: "target",
              setup:
                `zstyle ':completion:*:files' recursive-files '${scenario.recursive}'`,
            },
          );
          if (scenario.recursive === "*") {
            ok(output.includes("extapp nested/target"), output);
            ok(output.includes("target.txt"), output);
            ok(output.includes("target-link"), output);
          } else {
            ok(!output.includes("target.txt"), output);
            ok(!output.includes("target-link"), output);
          }
          ok(!output.includes("target-pipe"), output);
        },
      );
    }

    it("should retain FIFOs in unrestricted file suggestions in actual zsh", {
      skip: !isInteractiveZshCompletionAvailable() ||
        !isShellAvailable("mkfifo"),
      timeout: 10000,
    }, () => {
      if (
        !isInteractiveZshCompletionAvailable() || !isShellAvailable("mkfifo")
      ) return;
      const directive = Array.from(zsh.encodeSuggestions([
        { kind: "file", type: "any" },
      ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");
      const output = testInteractiveZshCompletion(
        zsh.generateScript("extapp"),
        directive,
        [{ path: "plain" }, { path: "named-pipe", type: "fifo" }, {
          path: "subdir",
          type: "directory",
        }],
      );
      for (const candidate of ["plain", "named-pipe", "subdir/"]) {
        ok(
          output.includes(candidate),
          `Expected ${candidate}, got:\n${output}`,
        );
      }
    });

    it(
      "should apply fignore only to unfiltered zsh file suggestions when enabled",
      {
        skip: !isShellAvailable("zsh"),
      },
      () => {
        if (!isShellAvailable("zsh")) return;
        const tempDir = mkdtempSync(join(tmpdir(), "zsh-file-ignore-"));
        try {
          const cliPath = join(tempDir, "extapp");
          for (
            const scenario of [
              { directive: "__FILE__:file:::0", noIgnore: "", expected: 1 },
              {
                directive: "__FILE__:file:::0",
                noIgnore: "yes",
                expected: 0,
              },
              {
                directive: "__FILE__:file:txt::0",
                noIgnore: "",
                expected: 0,
              },
              {
                directive: "__FILE__:file:::0\n__FILE__:file:txt::0",
                noIgnore: "",
                expected: 1,
              },
            ]
          ) {
            writeFileSync(
              cliPath,
              `#!/bin/sh\nprintf '%s\\n' '${scenario.directive}'\n`,
              { mode: 0o755 },
            );
            const output = runCommand("zsh", [
              "-fc",
              `
export PATH="${tempDir}:$PATH"
autoload -U compinit && compinit -D
fignore=(.o)
_comp_no_ignore=${scenario.noIgnore}
function _tags() {
  if (( $# )); then
    __tag_round=0
    __file_label_round=0
    __directory_label_round=0
    return 0
  fi
  (( __tag_round++ == 0 ))
}
function _next_label() {
  if [[ "$1" == files ]]; then
    (( __file_label_round++ == 0 )) || return 1
  else
    (( __directory_label_round++ == 0 )) || return 1
  fi
  eval "$2=()"
  _comp_ignore=()
}

function _wanted() { shift 3; print -r -- "$*"; }
function _path_files() { print -r -- "$*"; }
source /dev/stdin <<'COMPLETION_SCRIPT'
${zsh.generateScript("extapp")}
COMPLETION_SCRIPT
words=(extapp "")
CURRENT=2
_extapp
`,
            ], { cwd: tempDir });
            deepStrictEqual(
              output.split("\n").filter((line) =>
                line.includes("-F file_ignore")
              ).length,
              scenario.expected,
              output,
            );
          }
        } finally {
          rmSync(tempDir, { recursive: true, force: true });
        }
      },
    );

    it("should complete single-extension file suggestions in actual zsh", {
      skip: !isInteractiveZshCompletionAvailable(),
      timeout: 10000,
    }, (t) => {
      if (!isInteractiveZshCompletionAvailable()) {
        t.skip("interactive zsh completion not available");
        return;
      }

      const directive = Array.from(zsh.encodeSuggestions([
        {
          kind: "file",
          type: "file",
          extensions: [".json"],
          includeHidden: false,
        },
      ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");

      const output = testInteractiveZshCompletion(
        zsh.generateScript("extapp"),
        directive,
        [
          { path: "data.json" },
          { path: "readme.txt" },
          { path: "subdir", type: "directory" },
        ],
      );

      ok(
        output.includes("data.json"),
        `Expected data.json in actual zsh completions, got:\n${output}`,
      );
      ok(
        output.includes("subdir/"),
        `Expected subdir/ in actual zsh completions, got:\n${output}`,
      );
      ok(
        !output.includes("readme.txt"),
        `readme.txt should not appear in single-extension zsh completions, got:\n${output}`,
      );
    });

    it(
      "should preserve extension filtering while keeping directories in actual zsh",
      {
        skip: !isInteractiveZshCompletionAvailable(),
        timeout: 10000,
      },
      (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }

        const directive = Array.from(zsh.encodeSuggestions([
          {
            kind: "file",
            type: "file",
            extensions: [".json", ".yaml"],
            includeHidden: false,
          },
        ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");

        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          directive,
          [
            { path: "data.json" },
            { path: "config.yaml" },
            { path: "readme.txt" },
            { path: "subdir", type: "directory" },
          ],
        );

        ok(
          output.includes("data.json"),
          `Expected data.json in actual zsh completions, got:\n${output}`,
        );
        ok(
          output.includes("config.yaml"),
          `Expected config.yaml in actual zsh completions, got:\n${output}`,
        );
        ok(
          output.includes("subdir/"),
          `Expected subdir/ in actual zsh completions, got:\n${output}`,
        );
        ok(
          !output.includes("readme.txt"),
          `readme.txt should not appear in filtered zsh completions, got:\n${output}`,
        );
      },
    );

    it(
      "should preserve extension filtering when file-patterns force all-files in actual zsh",
      {
        skip: !isInteractiveZshCompletionAvailable(),
        timeout: 10000,
      },
      (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }

        const directive = Array.from(zsh.encodeSuggestions([
          {
            kind: "file",
            type: "file",
            extensions: [".json"],
            includeHidden: false,
          },
        ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");

        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          directive,
          [
            { path: "data.json" },
            { path: "readme.txt" },
            { path: "subdir", type: "directory" },
          ],
          {
            setup: "zstyle ':completion:*' file-patterns '*:all-files'",
          },
        );

        ok(
          output.includes("data.json"),
          `Expected data.json in actual zsh completions, got:\n${output}`,
        );
        ok(
          output.includes("subdir/"),
          `Expected subdir/ in actual zsh completions when file-patterns force all-files, got:\n${output}`,
        );
        ok(
          !output.includes("readme.txt"),
          `readme.txt should not appear in zsh completions when file-patterns force all-files, got:\n${output}`,
        );
      },
    );

    it(
      "should keep filtered actual zsh completion working when compinit ignores insecure fpath entries",
      {
        skip: !isInteractiveZshCompletionAvailable(),
        timeout: 10000,
      },
      (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }

        const directive = Array.from(zsh.encodeSuggestions([
          {
            kind: "file",
            type: "file",
            extensions: [".json"],
            includeHidden: false,
          },
        ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");

        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          directive,
          [
            { path: "data.json" },
            { path: "readme.txt" },
            { path: "subdir", type: "directory" },
          ],
          {
            withInsecureFpath: true,
          },
        );

        ok(
          output.includes("data.json"),
          `Expected data.json in actual zsh completions when compinit ignores insecure fpath entries, got:\n${output}`,
        );
        ok(
          output.includes("subdir/"),
          `Expected subdir/ in actual zsh completions when compinit ignores insecure fpath entries, got:\n${output}`,
        );
        ok(
          !output.includes("readme.txt"),
          `readme.txt should not appear when compinit ignores insecure fpath entries, got:\n${output}`,
        );
      },
    );

    it(
      "should respect files-tag ignored-patterns in filtered actual zsh completion",
      {
        skip: !isInteractiveZshCompletionAvailable(),
        timeout: 10000,
      },
      (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }

        const directive = Array.from(zsh.encodeSuggestions([
          {
            kind: "file",
            type: "file",
            extensions: [".json"],
            includeHidden: false,
          },
        ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");

        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          directive,
          [
            { path: "data.json" },
            { path: "config.json" },
            { path: "subdir", type: "directory" },
          ],
          {
            setup: "zstyle ':completion:*:files' ignored-patterns 'data.json'",
          },
        );

        ok(
          output.includes("config.json"),
          `Expected config.json in actual zsh completions with files-tag ignored-patterns, got:\n${output}`,
        );
        ok(
          output.includes("subdir/"),
          `Expected subdir/ in actual zsh completions with files-tag ignored-patterns, got:\n${output}`,
        );
        ok(
          !output.includes("data.json"),
          `data.json should respect files-tag ignored-patterns in actual zsh completions, got:\n${output}`,
        );
      },
    );

    it(
      "should respect tag-order when filtered actual zsh completion prefers directories",
      {
        skip: !isInteractiveZshCompletionAvailable(),
        timeout: 10000,
      },
      (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }

        const directive = Array.from(zsh.encodeSuggestions([
          {
            kind: "file",
            type: "file",
            extensions: [".json"],
            includeHidden: false,
          },
        ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");

        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          directive,
          [
            { path: "data.json" },
            { path: "config.json" },
            { path: "subdir", type: "directory" },
          ],
          {
            setup: "zstyle ':completion:*' tag-order 'directories' -",
          },
        );

        ok(
          output.includes("subdir/") || output.includes("extapp subdir"),
          `Expected directory-only actual zsh completions when tag-order prefers directories, got:\n${output}`,
        );
        ok(
          !output.includes("data.json"),
          `data.json should be suppressed when tag-order prefers directories in actual zsh completions, got:\n${output}`,
        );
        ok(
          !output.includes("config.json"),
          `config.json should be suppressed when tag-order prefers directories in actual zsh completions, got:\n${output}`,
        );
      },
    );

    it(
      "should preserve extension filtering when bareglobqual is unset in actual zsh",
      {
        skip: !isInteractiveZshCompletionAvailable(),
        timeout: 10000,
      },
      (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }

        const directive = Array.from(zsh.encodeSuggestions([
          {
            kind: "file",
            type: "file",
            extensions: [".json"],
            includeHidden: false,
          },
        ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");

        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          directive,
          [
            { path: "data.json" },
            { path: "readme.txt" },
            { path: "subdir", type: "directory" },
          ],
          {
            setup: "unsetopt bareglobqual",
          },
        );

        ok(
          output.includes("data.json"),
          `Expected data.json in actual zsh completions when bareglobqual is unset, got:\n${output}`,
        );
        ok(
          output.includes("subdir/"),
          `Expected subdir/ in actual zsh completions when bareglobqual is unset, got:\n${output}`,
        );
        ok(
          !output.includes("readme.txt"),
          `readme.txt should not appear in zsh completions when bareglobqual is unset, got:\n${output}`,
        );
      },
    );

    it(
      "should exclude FIFOs from file completion when bareglobqual is unset in actual zsh",
      {
        skip: !isInteractiveZshCompletionAvailable(),
        timeout: 10000,
      },
      (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }

        try {
          runCommand("which", ["mkfifo"], { stdio: "pipe" });
        } catch {
          t.skip("mkfifo not available");
          return;
        }

        const directive = Array.from(zsh.encodeSuggestions([
          {
            kind: "file",
            type: "file",
            extensions: [".json"],
            includeHidden: false,
          },
        ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");

        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          directive,
          [
            { path: "data.json" },
            { path: "pipe.json", type: "fifo" },
            { path: "subdir", type: "directory" },
          ],
          {
            setup: "unsetopt bareglobqual",
          },
        );

        ok(
          output.includes("data.json"),
          `Expected data.json in actual zsh completions when bareglobqual is unset, got:\n${output}`,
        );
        ok(
          output.includes("subdir/"),
          `Expected subdir/ in actual zsh completions when bareglobqual is unset, got:\n${output}`,
        );
        ok(
          !output.includes("pipe.json"),
          `pipe.json should not appear in zsh file completions when bareglobqual is unset, got:\n${output}`,
        );
      },
    );

    it(
      "should include symlinked regular files when bareglobqual is unset in actual zsh",
      {
        skip: !isInteractiveZshCompletionAvailable(),
        timeout: 10000,
      },
      (t) => {
        if (!isInteractiveZshCompletionAvailable()) {
          t.skip("interactive zsh completion not available");
          return;
        }

        const directive = Array.from(zsh.encodeSuggestions([
          {
            kind: "file",
            type: "file",
            extensions: [".json"],
            includeHidden: false,
          },
        ]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");

        const output = testInteractiveZshCompletion(
          zsh.generateScript("extapp"),
          directive,
          [
            { path: "data.json" },
            { path: "config.json", type: "symlink", target: "data.json" },
            { path: "subdir", type: "directory" },
          ],
          {
            setup: "unsetopt bareglobqual",
          },
        );

        ok(
          output.includes("data.json"),
          `Expected data.json in actual zsh completions when bareglobqual is unset, got:\n${output}`,
        );
        ok(
          output.includes("config.json"),
          `Expected config.json symlink in actual zsh completions when bareglobqual is unset, got:\n${output}`,
        );
        ok(
          output.includes("subdir/"),
          `Expected subdir/ in actual zsh completions when bareglobqual is unset, got:\n${output}`,
        );
      },
    );

    it("should generate script with completion command args", () => {
      const script = zsh.generateScript("myapp", ["completion", "zsh"]);

      deepStrictEqual(script.includes("myapp 'completion' 'zsh'"), true);
    });

    it("should escape single quotes in arguments", () => {
      const script = zsh.generateScript("myapp", ["it's", "test"]);

      deepStrictEqual(script.includes("'it'\\''s'"), true);
    });

    it("should encode suggestions with null-terminated format", () => {
      const suggestions: Suggestion[] = [
        { kind: "literal", text: "--verbose" },
        { kind: "literal", text: "--quiet" },
      ];

      const encoded = Array.from(zsh.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, [
        "--verbose\0\0",
        "--quiet\0\0",
      ]);
    });

    it("should encode suggestions with descriptions", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "literal",
          text: "--verbose",
          description: message`Enable verbose output`,
        },
        {
          kind: "literal",
          text: "--quiet",
          description: message`Suppress output`,
        },
      ];

      const encoded = Array.from(zsh.encodeSuggestions(suggestions));

      // Zsh uses descriptions (without colors for testing)
      deepStrictEqual(encoded[0], "--verbose\0Enable verbose output\0");
      deepStrictEqual(encoded[1], "--quiet\0Suppress output\0");
    });

    it("should handle empty suggestions list", () => {
      const suggestions: Suggestion[] = [];

      const encoded = Array.from(zsh.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, []);
    });

    it("should format descriptions with colors when available", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "literal",
          text: "--verbose",
          description: message`Enable verbose mode`,
        },
      ];

      const encoded = Array.from(zsh.encodeSuggestions(suggestions));

      // Should contain formatted message (exact format may vary with colors)
      deepStrictEqual(encoded[0].startsWith("--verbose\0"), true);
      deepStrictEqual(encoded[0].endsWith("\0"), true);
      deepStrictEqual(encoded[0].includes("Enable verbose mode"), true);
    });

    it("should encode file suggestions with null-terminated format", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          extensions: ["json", "yaml"],
          includeHidden: false,
          description: message`Configuration file`,
        },
      ];

      const encoded = Array.from(zsh.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, [
        "__FILE__:file:json,yaml::0\0Configuration file\0",
      ]);
    });

    it("should encode file suggestions without metadata in zsh", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "directory",
          includeHidden: true,
        },
      ];

      const encoded = Array.from(zsh.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["__FILE__:directory:::1\0\0"]);
    });

    it("should strip leading dots from extensions in zsh", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          extensions: [".json", ".yaml"],
          includeHidden: false,
        },
      ];

      const encoded = Array.from(zsh.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["__FILE__:file:json,yaml::0\0\0"]);
    });

    it("should encode file suggestions with colon in pattern", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          pattern: "C:/Users/test/",
          includeHidden: false,
          description: message`Config file`,
        },
      ];

      const encoded = Array.from(zsh.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, [
        "__FILE__:file::C%3A/Users/test/:0\0Config file\0",
      ]);
    });

    it("should encode file suggestions with percent in pattern", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          pattern: "100%done",
          includeHidden: false,
        },
      ];

      const encoded = Array.from(zsh.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["__FILE__:file::100%25done:0\0\0"]);
    });

    it("should enable glob_dots when hidden is true", () => {
      const script = zsh.generateScript("myapp");

      // The generated script must enable glob_dots when hidden == "1"
      // so that _files and _directories include dotfiles
      ok(script.includes("glob_dots"));
    });

    it("should include hidden files when includeHidden is true", (t) => {
      if (!isShellAvailable("zsh")) {
        t.skip("zsh not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "zsh-hidden-completion-"));

      try {
        // CLI that emits __FILE__ with hidden=1 using null-terminated format
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::1\\0\\0\\n'
`;
        const cliPath = join(tempDir, "hidden-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create visible and hidden files
        writeFileSync(join(tempDir, "visible.txt"), "");
        writeFileSync(join(tempDir, ".hidden"), "");
        writeFileSync(join(tempDir, ".env"), "");

        const script = zsh.generateScript("hidden-cli");

        // Native completion helpers require an interactive completion context,
        // so extract and test the glob_dots logic directly.  The generated
        // function body contains a while-read loop that parses __FILE__
        // directives.  We override _wanted/_path_files with functions that
        // glob the current directory to verify glob_dots is active.
        const testScript = `
export PATH="${tempDir}:$PATH"
autoload -U compinit && compinit -D 2>/dev/null
unsetopt glob_dots

# List regular files using the current glob settings
function _tags() {
  if (( $# )); then
    __tag_round=0
    __file_label_round=0
    __directory_label_round=0
    return 0
  fi
  (( __tag_round++ == 0 ))
}
function _next_label() {
  if [[ "$1" == files ]]; then
    (( __file_label_round++ == 0 )) || return 1
  else
    (( __directory_label_round++ == 0 )) || return 1
  fi
  eval "$2=()"
  _comp_ignore=()
}

function _wanted() { shift 3; "$@"; }
function _path_files() {
  [[ "$1" == "-/" ]] && return 0
  setopt localoptions extendedglob
  local f
  for f in ${tempDir}/*(#q-.); do
    [[ -f "$f" ]] && echo "$f"
  done
}

source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT

cd "${tempDir}"
words=("hidden-cli" "")
CURRENT=2
_optique:hidden-cli 2>/dev/null
print -r -- "__GLOB_DOTS_AFTER:$options[globdots]"
`;

        const result = runCommand("zsh", ["-c", testScript], {
          cwd: tempDir,
        });

        ok(result.includes("__GLOB_DOTS_AFTER:off"), result);
        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        ok(completions.some((c) => c.includes(".hidden")));
        ok(completions.some((c) => c.includes(".env")));
        ok(completions.some((c) => c.includes("visible.txt")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should not include hidden files when includeHidden is false", (t) => {
      if (!isShellAvailable("zsh")) {
        t.skip("zsh not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "zsh-no-hidden-completion-"),
      );

      try {
        // CLI that emits __FILE__ with hidden=0
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::0\\0\\0\\n'
`;
        const cliPath = join(tempDir, "nohidden-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create visible and hidden files
        writeFileSync(join(tempDir, "visible.txt"), "");
        writeFileSync(join(tempDir, ".hidden"), "");

        const script = zsh.generateScript("nohidden-cli");

        const testScript = `
export PATH="${tempDir}:$PATH"
autoload -U compinit && compinit -D 2>/dev/null
unsetopt glob_dots

function _tags() {
  if (( $# )); then
    __tag_round=0
    __file_label_round=0
    __directory_label_round=0
    return 0
  fi
  (( __tag_round++ == 0 ))
}
function _next_label() {
  if [[ "$1" == files ]]; then
    (( __file_label_round++ == 0 )) || return 1
  else
    (( __directory_label_round++ == 0 )) || return 1
  fi
  eval "$2=()"
  _comp_ignore=()
}

function _wanted() { shift 3; "$@"; }
function _path_files() {
  [[ "$1" == "-/" ]] && return 0
  setopt localoptions extendedglob
  local f
  for f in ${tempDir}/*(#q-.); do
    [[ -f "$f" ]] && echo "$f"
  done
}

source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT

cd "${tempDir}"
words=("nohidden-cli" "")
CURRENT=2
_optique:nohidden-cli 2>/dev/null
print -r -- "__GLOB_DOTS_AFTER:$options[globdots]"
`;

        const result = runCommand("zsh", ["-c", testScript], {
          cwd: tempDir,
        });

        ok(result.includes("__GLOB_DOTS_AFTER:off"), result);
        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        ok(!completions.some((c) => c.includes(".hidden")));
        ok(completions.some((c) => c.includes("visible.txt")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should sanitize tabs and newlines in descriptions", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "literal",
          text: "--opt",
          description: [text("Line 1"), lineBreak(), text("Line\t2")],
        },
      ];

      const encoded = Array.from(zsh.encodeSuggestions(suggestions));
      deepStrictEqual(encoded, ["--opt\0Line 1 Line 2\0"]);
    });

    it("should sanitize tabs and newlines in literal text", () => {
      const suggestions: Suggestion[] = [
        { kind: "literal", text: "alpha\tbeta" },
        { kind: "literal", text: "line1\nline2" },
        { kind: "literal", text: "car\rriage" },
        { kind: "literal", text: "nul\0byte" },
      ];

      const encoded = Array.from(zsh.encodeSuggestions(suggestions));
      deepStrictEqual(encoded, [
        "alpha beta\0\0",
        "line1 line2\0\0",
        "car riage\0\0",
        "nul byte\0\0",
      ]);
    });

    it(
      "should use _path_files for regular-file zsh completion",
      () => {
        const script = zsh.generateScript("filedir-cli");

        // Extract the file case block from the zsh script
        const fileCase = script.substring(
          script.indexOf('case "$type" in'),
          script.indexOf("esac"),
        );
        const fileCaseBlock = fileCase.substring(
          fileCase.indexOf("file|any)"),
          fileCase.indexOf("directory)"),
        );
        ok(
          fileCaseBlock.includes(
            'local file_pattern="${ext_pattern:-*}(#q-.)"',
          ),
          "zsh file) case should derive a #q-qualified regular-file pattern that preserves symlinked files.",
        );
        ok(
          fileCaseBlock.includes(
            '_path_files -g "${file_pattern}" "${expl[@]}" "${file_ignore_args[@]}"',
          ),
          "zsh file) case should route filtered file completions through the standard files tag.",
        );
        ok(
          fileCaseBlock.includes(
            "_next_label directories expl directory",
          ),
          "zsh file) case should add directory navigation via the directories tag.",
        );
        ok(
          !fileCaseBlock.includes('_files -g "$ext_pattern"'),
          "zsh file) case should not rely on _files -g for extension-filtered navigation.",
        );
        ok(
          fileCaseBlock.includes("_next_label files expl file"),
          "zsh file) case should use zsh's standard tag selection for filtered file completion.",
        );
      },
    );
  });

  describe("pwsh shell completion", () => {
    it("should have correct name", () => {
      deepStrictEqual(pwsh.name, "pwsh");
    });

    it("should generate proper completion script", () => {
      const script = pwsh.generateScript("myapp");

      // Check for essential PowerShell completion components
      deepStrictEqual(script.includes("Register-ArgumentCompleter"), true);
      deepStrictEqual(script.includes("-Native"), true);
      deepStrictEqual(script.includes("-CommandName myapp"), true);
      deepStrictEqual(script.includes("$wordToComplete"), true);
      deepStrictEqual(script.includes("$commandAst"), true);
      deepStrictEqual(
        script.includes("System.Management.Automation.CompletionResult"),
        true,
      );
    });

    it("should work with actual pwsh shell", (t) => {
      if (!isShellAvailable("pwsh")) {
        t.skip("pwsh not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "pwsh-completion-"));

      try {
        const cliPath = createTestCli(tempDir);
        const programName = "test-cli";
        const script = pwsh.generateScript(programName, ["completion", "pwsh"]);

        const result = testPwshCompletion(
          script,
          programName,
          dirname(cliPath),
        );

        // For pwsh, we verify that the completion script can be loaded
        // and executed without errors (similar to zsh test approach)
        deepStrictEqual(result.includes("success"), true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should use only arguments before the PowerShell cursor", {
      skip: process.platform === "win32" || !isShellAvailable("pwsh") ||
        !isShellAvailable("bash"),
      timeout: 10000,
    }, () => {
      // Bun ignores skip, so check the prerequisites here as well.
      if (process.platform === "win32") return;
      if (!isShellAvailable("pwsh") || !isShellAvailable("bash")) return;

      const cases = [
        {
          before: "cursor-cli --pick al",
          after: "",
          args: ["--pick", "al"],
          replacementLength: 2,
        },
        {
          before: "cursor-cli --pick al",
          after: " --other xyz",
          args: ["--pick", "al"],
          replacementLength: 2,
        },
        {
          before: "cursor-cli --pick al",
          after: "pha --other xyz",
          args: ["--pick", "alpha"],
          replacementLength: 5,
        },
        {
          before: "cursor-cli --pick ",
          after: " --other xyz",
          args: ["--pick", ""],
          replacementLength: 0,
        },
        {
          before: "cursor-cli --pick ",
          after: "alpha --other xyz",
          args: ["--pick", ""],
          replacementLength: 0,
        },
        {
          before: "cursor-cli --other 'some value' --pick al",
          after: "",
          args: ["--other", "some value", "--pick", "al"],
          replacementLength: 2,
        },
        {
          before: "cursor-cli --pick al",
          after: " --other al",
          args: ["--pick", "al"],
          replacementLength: 2,
        },
        {
          before: "cursor-cli --other '' ",
          after: "",
          args: ["--other", "", ""],
          replacementLength: 0,
        },
        {
          before: "cursor-cli --pick ",
          after: "",
          args: ["--pick", ""],
          replacementLength: 0,
        },
        {
          before: "Write-Output done; cursor-cli --pick al",
          after: " --other xyz",
          args: ["--pick", "al"],
          replacementLength: 2,
        },
        {
          before: "Write-Output done\ncursor-cli --pick al",
          after: " --other xyz",
          args: ["--pick", "al"],
          replacementLength: 2,
        },
      ];

      // Keep executable fixtures in the checkout's ignored tmp/ directory.
      const scratchRoot = fileURLToPath(
        new URL("../../../tmp/", import.meta.url),
      );
      mkdirSync(scratchRoot, { recursive: true });
      const tempDir = mkdtempSync(join(scratchRoot, "pwsh-cursor-"));
      try {
        writeFileSync(
          join(tempDir, "cursor-cli"),
          `#!/usr/bin/env bash
printf '%s\\0' "$@" > "$OPTIQUE_CURSOR_CAPTURE"
printf 'alpha\\nalpine\\n'
`,
          { mode: 0o755 },
        );
        writeFileSync(
          join(tempDir, "completion.ps1"),
          pwsh.generateScript("cursor-cli", ["completion", "pwsh"]),
        );
        writeFileSync(join(tempDir, "cases.json"), JSON.stringify(cases));
        const testScriptPath = join(tempDir, "test.ps1");
        writeFileSync(
          testScriptPath,
          `$ErrorActionPreference = 'Stop'
$PSNativeCommandArgumentPassing = 'Standard'
$env:PATH = $PSScriptRoot + [IO.Path]::PathSeparator + $env:PATH
$env:OPTIQUE_CURSOR_CAPTURE = Join-Path $PSScriptRoot 'argv.bin'
. (Join-Path $PSScriptRoot 'completion.ps1')
$cases = Get-Content -Raw (Join-Path $PSScriptRoot 'cases.json') | ConvertFrom-Json
$records = @()
foreach ($case in $cases) {
    Remove-Item $env:OPTIQUE_CURSOR_CAPTURE -Force -ErrorAction SilentlyContinue
    $line = $case.before + $case.after
    $result = [System.Management.Automation.CommandCompletion]::CompleteInput($line, $case.before.Length, $null)
    if (-not (Test-Path $env:OPTIQUE_CURSOR_CAPTURE)) { throw 'Completer did not invoke the CLI.' }
    $records += [pscustomobject]@{
        Captured = Get-Content -Raw $env:OPTIQUE_CURSOR_CAPTURE
        Matches = @($result.CompletionMatches | ForEach-Object CompletionText)
        Index = $result.ReplacementIndex
        Length = $result.ReplacementLength
        Lines = @($result.CompletionMatches | ForEach-Object {
            $line.Substring(0, $result.ReplacementIndex) + $_.CompletionText + $line.Substring($result.ReplacementIndex + $result.ReplacementLength)
        })
    }
}
ConvertTo-Json -InputObject $records -Depth 5 -Compress
`,
        );
        const results: readonly {
          readonly Captured: string;
          readonly Matches: readonly string[];
          readonly Index: number;
          readonly Length: number;
          readonly Lines: readonly string[];
        }[] = JSON.parse(runCommand(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-File", testScriptPath],
          { cwd: tempDir },
        ));

        deepStrictEqual(
          results.map((result) => result.Captured.split("\0").slice(0, -1)),
          cases.map((testCase) => ["completion", "pwsh", ...testCase.args]),
        );
        deepStrictEqual(results.length, cases.length);
        for (let i = 0; i < cases.length; i++) {
          const testCase = cases[i];
          const result = results[i];
          deepStrictEqual(result.Matches, ["alpha", "alpine"]);
          deepStrictEqual(result.Length, testCase.replacementLength);
          deepStrictEqual(
            result.Index,
            testCase.before.length - (testCase.replacementLength === 0 ? 0 : 2),
          );
        }
        deepStrictEqual(results[1].Lines, [
          "cursor-cli --pick alpha --other xyz",
          "cursor-cli --pick alpine --other xyz",
        ]);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should generate script with completion command args", () => {
      const script = pwsh.generateScript("myapp", ["completion", "pwsh"]);

      deepStrictEqual(script.includes("'completion', 'pwsh'"), true);
    });

    it("should escape single quotes in arguments", () => {
      const script = pwsh.generateScript("myapp", ["it's", "test"]);

      // PowerShell uses doubled single quotes for escaping
      deepStrictEqual(script.includes("'it''s'"), true);
    });

    function createInsertionTempDir(prefix: string): string {
      const scratchRoot = fileURLToPath(
        new URL("../../../tmp/", import.meta.url),
      );
      mkdirSync(scratchRoot, { recursive: true });
      return mkdtempSync(join(scratchRoot, prefix));
    }

    function completeAndExecute(
      tempDir: string,
      suggestions: readonly Suggestion[],
      lines: readonly string[],
      cursors?: readonly number[],
      directorySeparator?: "/" | "\\",
    ): readonly {
      readonly label: string;
      readonly prefix: string;
      readonly resultType: string;
      readonly tooltip: string;
      readonly insertion: string;
      readonly line: string;
      readonly parseErrors: number;
      readonly commands: number;
      readonly elements: number;
      readonly argv: readonly string[];
    }[] {
      writeFileSync(
        join(tempDir, "quoted-cli"),
        `#!/bin/sh
if [ "$1" = completion ]; then
  printf '%s\\0' "$@" > "\${0%/*}/completion-argv.bin"
  cat "\${0%/*}/suggestions.txt"
else
  printf '%s\\n' "$#" "$@"
fi
`,
        { mode: 0o755 },
      );
      writeFileSync(
        join(tempDir, "suggestions.txt"),
        Array.from(pwsh.encodeSuggestions(suggestions)).join(""),
      );
      writeFileSync(
        join(tempDir, "completion.ps1"),
        directorySeparator == null
          ? pwsh.generateScript("quoted-cli", ["completion"])
          : pwsh.generateScript("quoted-cli", ["completion"]).replaceAll(
            "[IO.Path]::DirectorySeparatorChar",
            `[char]${directorySeparator.charCodeAt(0)}`,
          ),
      );
      writeFileSync(
        join(tempDir, "lines.json"),
        JSON.stringify(lines.map((line, index) => ({
          line,
          cursor: cursors?.[index] ?? line.length,
        }))),
      );
      const testScript = join(tempDir, "test.ps1");
      writeFileSync(
        testScript,
        `$ErrorActionPreference = 'Stop'
$PSNativeCommandArgumentPassing = 'Standard'
$provider = Get-PSProvider FileSystem
$provider.Home = Join-Path $PSScriptRoot 'home'
$env:PATH = $PSScriptRoot + [IO.Path]::PathSeparator + $env:PATH
. (Join-Path $PSScriptRoot 'completion.ps1')
$lines = Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'lines.json') | ConvertFrom-Json
$results = @(foreach ($entry in $lines) {
  $line = $entry.line
  $r = [System.Management.Automation.CommandCompletion]::CompleteInput($line, $entry.cursor, $null)
  $captured = (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'completion-argv.bin')).Split([char]0)
  $prefix = $captured[$captured.Length - 2]
  foreach ($m in $r.CompletionMatches) {
    $completed = $line.Substring(0, $r.ReplacementIndex) + $m.CompletionText + $line.Substring($r.ReplacementIndex + $r.ReplacementLength)
    $tokens = $null; $errors = $null
    $ast = [System.Management.Automation.Language.Parser]::ParseInput($completed, [ref]$tokens, [ref]$errors)
    $commands = @($ast.FindAll({param($n) $n -is [System.Management.Automation.Language.CommandAst]}, $true))
    $elements = if ($commands.Count -eq 1) { $commands[0].CommandElements.Count } else { 0 }
    $argv = @()
    if ($errors.Count -eq 0 -and $commands.Count -eq 1 -and $elements -eq 3) {
      try { $argv = @(Invoke-Expression $completed) } catch { $argv = @('execution failed') }
    }
    [pscustomobject]@{
      label = $m.ListItemText; prefix = $prefix; resultType = $m.ResultType.ToString(); tooltip = $m.ToolTip; insertion = $m.CompletionText; line = $line
      parseErrors = $errors.Count; commands = $commands.Count; elements = $elements; argv = $argv
    }
  }
})
ConvertTo-Json -InputObject $results -Depth 5 -Compress
`,
      );
      return JSON.parse(runCommand(
        "pwsh",
        ["-NoProfile", "-NonInteractive", "-File", testScript],
        { cwd: tempDir },
      ));
    }

    it("should insert literal completions as single native arguments", {
      skip: process.platform === "win32" || !isShellAvailable("pwsh"),
      timeout: 20000,
    }, () => {
      if (process.platform === "win32" || !isShellAvailable("pwsh")) return;
      const tempDir = createInsertionTempDir("pwsh-literal-insertion-");
      try {
        const values = [
          "3.141592653589793",
          "0.30000000000000004",
          "1700000000.123456",
          "-1e20",
          ".30000000000000004",
          "hello fallback",
          "hello world",
          "hello'world",
          'hello"world',
          "hello;world",
          "hello‘world",
          "hello’world",
          "hello‚world",
          "hello‛world",
          "hello$HOME",
          "hello$(1+1)",
          "hello`world",
          "hello&world",
          "hello|world",
          "hello>world",
          "hello<world",
          "hello(world)",
          "hello{world}",
          "hello[world]",
          "@hello",
          "#hello",
          "hello,world",
          "hello=world",
          "hello*world",
          "hello?world",
          "~",
          "~/hello",
          "-hello.world",
          "-a:",
          "--hello.world",
          "Khello",
          "–hello.world",
          "hello“world",
          "hello”world",
          "hello‶world",
          "--verbose",
          "sub-command",
          "nested/plain.txt",
          "C:\\plain\\file.txt",
        ];
        const results = completeAndExecute(
          tempDir,
          values.map((value) => ({
            kind: "literal",
            text: value,
            description: value === "hello fallback"
              ? undefined
              : message`Readable hint`,
          })),
          ["quoted-cli --pick "],
        );
        deepStrictEqual(results.length, values.length);
        for (const value of values) {
          const result = results.find((r) => r.label === value);
          ok(result, `Missing completion for ${JSON.stringify(value)}.`);
          deepStrictEqual(result.parseErrors, 0, value);
          deepStrictEqual(result.commands, 1, value);
          deepStrictEqual(result.elements, 3, value);
          deepStrictEqual(result.argv, ["2", "--pick", value], value);
          deepStrictEqual(
            result.tooltip,
            value === "hello fallback" ? value : "Readable hint",
          );
          if (
            [
              "--hello.world",
              "--verbose",
              "sub-command",
              "nested/plain.txt",
              "C:\\plain\\file.txt",
            ].includes(value)
          ) {
            deepStrictEqual(result.insertion, value);
          }
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it(
      "should insert file and directory completions as single native arguments",
      {
        skip: process.platform === "win32" || !isShellAvailable("pwsh"),
        timeout: 20000,
      },
      () => {
        if (process.platform === "win32" || !isShellAvailable("pwsh")) return;
        const tempDir = createInsertionTempDir("pwsh-file-insertion-");
        try {
          const files = [
            "a space.txt",
            "a'quote.txt",
            'a"quote.txt',
            "a;semi.txt",
            "a’quote.txt",
            "a$(1+1).txt",
            "a`tick.txt",
            "a&pipe.txt",
            "a[bracket].txt",
            "a_plain.txt",
          ];
          const names = [...files, "a dir/"];
          for (const parent of [tempDir, join(tempDir, "home")]) {
            mkdirSync(parent, { recursive: true });
            for (const file of files) writeFileSync(join(parent, file), "");
            mkdirSync(join(parent, "a dir"));
          }
          writeFileSync(join(tempDir, "3.141592653589793"), "");
          const prefixes = ["", "home/", "~/", "~\\"];
          const lines = prefixes.map((prefix) =>
            `quoted-cli --file ${prefix}a`
          );
          const results = completeAndExecute(
            tempDir,
            [{ kind: "file", type: "file" }],
            lines,
          );
          for (const [index, prefix] of prefixes.entries()) {
            const matches = results.filter((r) => r.line === lines[index]);
            deepStrictEqual(matches.length, names.length, prefix);
            for (const name of names) {
              const result = matches.find((r) => r.label === prefix + name);
              ok(result, `Missing completion for ${prefix + name}.`);
              const expected = prefix.startsWith("~")
                ? join(tempDir, "home", name.replace(/\/$/, "")) +
                  (name.endsWith("/") ? "/" : "")
                : prefix + name;
              deepStrictEqual(result.parseErrors, 0, result.label);
              deepStrictEqual(result.commands, 1, result.label);
              deepStrictEqual(result.elements, 3, result.label);
              deepStrictEqual(
                result.argv,
                ["2", "--file", expected],
                result.label,
              );
              deepStrictEqual(
                result.tooltip,
                name.endsWith("/") ? "Directory" : "File",
              );
              if (name === "a_plain.txt" && prefix !== "~\\") {
                deepStrictEqual(result.insertion, prefix + name);
              }
              if (name.endsWith("/")) ok(result.insertion.endsWith("/'"));
            }
          }
          const numeric = completeAndExecute(
            tempDir,
            [{ kind: "file", type: "file" }],
            ["quoted-cli --file 3"],
          );
          deepStrictEqual(numeric.length, 1);
          deepStrictEqual(numeric[0].label, "3.141592653589793");
          deepStrictEqual(numeric[0].argv, [
            "2",
            "--file",
            "3.141592653589793",
          ]);
        } finally {
          rmSync(tempDir, { recursive: true, force: true });
        }
      },
    );

    for (
      const { directory, input, separator } of [
        { directory: "a dir", input: "a" },
        { directory: "a' dir", input: "a" },
        { directory: "a$ dir", input: "a" },
        { directory: "a dir", input: '"a' },
      ].flatMap((entry) =>
        (["/", "\\"] as const).map((separator) => ({ ...entry, separator }))
      )
    ) {
      it(
        "should continue into " + JSON.stringify(directory) +
          " after completing " + JSON.stringify(input) + " with " +
          JSON.stringify(separator) + " separators",
        {
          skip: process.platform === "win32" || !isShellAvailable("pwsh"),
          timeout: 20000,
        },
        () => {
          if (process.platform === "win32" || !isShellAvailable("pwsh")) return;
          const tempDir = createInsertionTempDir("pwsh-directory-navigation-");
          try {
            const child = directory + "/child one.txt";
            mkdirSync(join(tempDir, directory));
            writeFileSync(join(tempDir, child), "");
            const suggestions: readonly Suggestion[] = [{
              kind: "file",
              type: "any",
            }];
            const first = completeAndExecute(
              tempDir,
              suggestions,
              ["quoted-cli --file " + input],
              undefined,
              separator,
            );
            const parent = first.find((result) =>
              result.label === directory + "/"
            );
            ok(parent, "Missing directory completion.");
            deepStrictEqual(parent.argv, [
              "2",
              "--file",
              directory + separator,
            ]);
            deepStrictEqual(parent.resultType, "ProviderContainer");

            // PSReadLine places the cursor before a directory's closing quote.
            const line = "quoted-cli --file " +
              parent.insertion.slice(0, -1) + "ch" +
              parent.insertion.slice(-1);

            const continued = completeAndExecute(
              tempDir,
              suggestions,
              [line],
              [line.length - 1],
              separator,
            );
            deepStrictEqual(continued.length, 1);
            const insertedChild = directory + separator + "child one.txt";
            deepStrictEqual(continued[0].prefix, directory + separator + "ch");
            deepStrictEqual(continued[0].label, insertedChild);
            deepStrictEqual(continued[0].parseErrors, 0);
            deepStrictEqual(continued[0].commands, 1);
            deepStrictEqual(continued[0].elements, 3);
            deepStrictEqual(continued[0].argv, ["2", "--file", insertedChild]);
            ok(continued[0].insertion.startsWith(
              input.startsWith('"') ? '"' : "'",
            ));
          } finally {
            rmSync(tempDir, { recursive: true, force: true });
          }
        },
      );
    }

    for (const separator of ["/", "\\"] as const) {
      // Backslash cases simulate Windows formatting on Linux, not Windows execution.
      it(
        "should complete a quoted directory and its child through PSReadLine with " +
          JSON.stringify(separator) + " separators",
        {
          skip: process.platform === "win32" || !isShellAvailable("pwsh") ||
            !isShellAvailable("python3"),
          timeout: 30000,
        },
        () => {
          if (
            process.platform === "win32" || !isShellAvailable("pwsh") ||
            !isShellAvailable("python3")
          ) return;
          const tempDir = createInsertionTempDir("pwsh-directory-pty-");
          try {
            mkdirSync(join(tempDir, "a dir"));
            writeFileSync(join(tempDir, "a dir", "child one.txt"), "");
            completeAndExecute(
              tempDir,
              [{ kind: "file", type: "any" }],
              [
                "quoted-cli --file a",
              ],
              undefined,
              separator,
            );
            const init = join(tempDir, "interactive.ps1");
            writeFileSync(
              init,
              `$ErrorActionPreference = 'Stop'
$env:PATH = $PSScriptRoot + [IO.Path]::PathSeparator + $env:PATH
. (Join-Path $PSScriptRoot 'completion.ps1')
Import-Module PSReadLine
Set-PSReadLineOption -HistorySaveStyle SaveNothing -PredictionSource None
${
                separator === "\\"
                  ? `
Set-PSReadLineKeyHandler -Key Tab -ScriptBlock {
  param($key, $arg)
  $type = [Microsoft.PowerShell.PSConsoleReadLine]
  $flags = [Reflection.BindingFlags]'NonPublic,Static,Instance'
  $instance = $type.GetField('_singleton', $flags).GetValue($null)
  $type.GetField('_directorySeparator', $flags).SetValue($instance, [string][char]92)
  [Microsoft.PowerShell.PSConsoleReadLine]::TabCompleteNext($key, $arg)
}
`
                  : "Set-PSReadLineKeyHandler -Key Tab -Function TabCompleteNext"
              }
$global:capturePath = Join-Path $PSScriptRoot 'buffer.jsonl'
Set-PSReadLineKeyHandler -Chord Ctrl+g -ScriptBlock {
  $line = $null; $cursor = 0
  [Microsoft.PowerShell.PSConsoleReadLine]::GetBufferState([ref]$line, [ref]$cursor)
  [pscustomobject]@{ line = $line; cursor = $cursor } |
    ConvertTo-Json -Compress | Add-Content -LiteralPath $global:capturePath
}
function global:prompt { '__READY__> ' }
`,
            );
            // Drive the real line editor, including its directory cursor adjustment.
            const driver = String.raw`
import json, os, pty, select, signal, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.environ['TERM'] = 'xterm-256color'
    os.execvp('pwsh', ['pwsh', '-NoLogo', '-NoProfile', '-NoExit', '-File', sys.argv[1]])
output = b''
def pump():
    global output
    if select.select([fd], [], [], 0.1)[0]:
        try:
            chunk = os.read(fd, 65536)
        except OSError:
            return
        output += chunk
        for _ in range(chunk.count(b'\x1b[6n')):
            os.write(fd, b'\x1b[1;1R')
def until(check):
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        pump()
        if check():
            return
    raise RuntimeError('PowerShell PTY did not reach expected state: ' + repr(output))
def captured(count):
    try:
        with open(sys.argv[2]) as stream:
            return len(stream.readlines()) >= count
    except FileNotFoundError:
        return False
try:
    until(lambda: b'__READY__>' in output)
    os.write(fd, b'quoted-cli --file a\t\x07')
    until(lambda: captured(1))
    os.write(fd, b'ch\t\x07')
    until(lambda: captured(2))
    with open(sys.argv[2]) as stream:
        print(json.dumps([json.loads(line) for line in stream]))
finally:
    os.kill(pid, signal.SIGKILL)
    os.close(fd)
    os.waitpid(pid, 0)
`;
            const buffers: readonly {
              readonly line: string;
              readonly cursor: number;
            }[] = JSON.parse(runCommand("python3", [
              "-c",
              driver,
              init,
              join(tempDir, "buffer.jsonl"),
            ], { cwd: tempDir, timeout: 25000 }));
            deepStrictEqual(buffers.length, 2);
            deepStrictEqual(
              buffers[0].line,
              "quoted-cli --file 'a dir" + separator + "'",
            );
            deepStrictEqual(buffers[0].cursor, buffers[0].line.length - 1);
            deepStrictEqual(
              buffers[1].line,
              "quoted-cli --file 'a dir" + separator + "child one.txt'",
            );
            const prefix = readFileSync(
              join(tempDir, "completion-argv.bin"),
              "utf8",
            )
              .split("\0").at(-2);
            deepStrictEqual(prefix, "a dir" + separator + "ch");
            const executed = runCommand("pwsh", [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              "$env:PATH = $PWD.Path + [IO.Path]::PathSeparator + $env:PATH; " +
              buffers[1].line,
            ], { cwd: tempDir });
            deepStrictEqual(executed.trimEnd().split(/\r?\n/), [
              "2",
              "--file",
              "a dir" + separator + "child one.txt",
            ]);
          } finally {
            rmSync(tempDir, { recursive: true, force: true });
          }
        },
      );
    }

    it("should encode suggestions with tab-separated format", () => {
      const suggestions: Suggestion[] = [
        { kind: "literal", text: "--verbose" },
        { kind: "literal", text: "--quiet" },
      ];

      const encoded = Array.from(pwsh.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, [
        "--verbose\t--verbose\t",
        "\n",
        "--quiet\t--quiet\t",
      ]);
    });

    it("should encode suggestions with descriptions", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "literal",
          text: "--verbose",
          description: message`Enable verbose output`,
        },
        {
          kind: "literal",
          text: "--quiet",
          description: message`Suppress output`,
        },
      ];

      const encoded = Array.from(pwsh.encodeSuggestions(suggestions));

      // Check format: text\tlistItemText\tdescription
      deepStrictEqual(
        encoded[0],
        "--verbose\t--verbose\tEnable verbose output",
      );
      deepStrictEqual(encoded[1], "\n");
      deepStrictEqual(encoded[2], "--quiet\t--quiet\tSuppress output");
    });

    it("should handle empty suggestions list", () => {
      const suggestions: Suggestion[] = [];

      const encoded = Array.from(pwsh.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, []);
    });

    it("should encode file suggestions with marker", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          extensions: ["json", "yaml"],
          includeHidden: false,
          description: message`Configuration file`,
        },
      ];

      const encoded = Array.from(pwsh.encodeSuggestions(suggestions));

      deepStrictEqual(
        encoded[0],
        "__FILE__:file:json,yaml::0\t[file]\tConfiguration file",
      );
    });

    it("should encode file suggestion defaults in pwsh", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "directory",
          includeHidden: true,
        },
      ];

      const encoded = Array.from(pwsh.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["__FILE__:directory:::1\t[file]\t"]);
    });

    it("should strip leading dots from extensions in pwsh", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          extensions: [".json", ".yaml"],
          includeHidden: false,
        },
      ];

      const encoded = Array.from(pwsh.encodeSuggestions(suggestions));

      deepStrictEqual(
        encoded[0],
        "__FILE__:file:json,yaml::0\t[file]\t",
      );
    });

    it("should encode file suggestions with colon in pattern", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          pattern: "C:/Users/test/",
          includeHidden: false,
          description: message`Config file`,
        },
      ];

      const encoded = Array.from(pwsh.encodeSuggestions(suggestions));

      deepStrictEqual(
        encoded[0],
        "__FILE__:file::C%3A/Users/test/:0\t[file]\tConfig file",
      );
    });

    it("should encode file suggestions with percent in pattern", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          pattern: "100%done",
          includeHidden: false,
        },
      ];

      const encoded = Array.from(pwsh.encodeSuggestions(suggestions));

      deepStrictEqual(
        encoded[0],
        "__FILE__:file::100%25done:0\t[file]\t",
      );
    });

    it("should format descriptions without colors", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "literal",
          text: "--verbose",
          description: message`Enable verbose mode`,
        },
      ];

      const encoded = Array.from(pwsh.encodeSuggestions(suggestions));

      // Should contain tab-separated format
      deepStrictEqual(encoded[0].startsWith("--verbose\t"), true);
      deepStrictEqual(encoded[0].includes("Enable verbose mode"), true);
      // Should not contain ANSI color codes
      deepStrictEqual(encoded[0].includes("\x1b["), false);
    });

    it("should sanitize tabs and newlines in descriptions", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "literal",
          text: "--opt",
          description: [text("Line 1"), lineBreak(), text("Line\t2")],
        },
      ];

      const encoded = Array.from(pwsh.encodeSuggestions(suggestions));
      deepStrictEqual(encoded, ["--opt\t--opt\tLine 1 Line 2"]);
    });

    it("should sanitize tabs and newlines in literal text", () => {
      const suggestions: Suggestion[] = [
        { kind: "literal", text: "alpha\tbeta" },
        { kind: "literal", text: "line1\nline2" },
        { kind: "literal", text: "car\rriage" },
        { kind: "literal", text: "nul\0byte" },
      ];

      const encoded = Array.from(pwsh.encodeSuggestions(suggestions));
      deepStrictEqual(encoded, [
        "alpha beta\talpha beta\t",
        "\n",
        "line1 line2\tline1 line2\t",
        "\n",
        "car riage\tcar riage\t",
        "\n",
        "nul byte\tnul byte\t",
      ]);
    });

    it("should strip tab-delimited metadata before parsing __FILE__ directive", () => {
      const script = pwsh.generateScript("myapp");

      // In the __FILE__ block, the script must split by tab first to
      // isolate the directive before splitting by colon.  Verify that
      // a tab-stripping split appears between the __FILE__ match and
      // the colon split.
      const fileBlock = script.substring(
        script.indexOf("__FILE__:"),
        script.indexOf("$type = $parts[1]"),
      );
      ok(fileBlock.includes('-split "`t"'));
    });

    it("should parse hidden field correctly with tab-delimited metadata", (t) => {
      if (!isShellAvailable("pwsh")) {
        t.skip("pwsh not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "pwsh-hidden-completion-"),
      );

      try {
        // CLI that emits __FILE__ with hidden=1 and tab-delimited metadata
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::1\\t[file]\\tConfiguration file\\n'
`;
        const cliPath = join(tempDir, "hidden-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        const script = pwsh.generateScript("hidden-cli");
        const completions = testPwshCompletion(script, "hidden-cli", tempDir);

        // Verify the script loads without error (pwsh helper is limited)
        ok(completions.includes("success"));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should use -Force on Get-ChildItem when hidden is true", () => {
      const script = pwsh.generateScript("myapp");

      // Extract the __FILE__ handling block from the generated script
      const fileBlock = script.substring(
        script.indexOf("__FILE__:"),
        script.indexOf("# Create completion results for files"),
      );

      // The script should use -Force with Get-ChildItem when $hidden is true:
      // $forceParam is set from $hidden, then splatted into Get-ChildItem
      ok(
        /\$hidden\b[\s\S]*Force/.test(fileBlock),
        "Expected Force parameter derived from $hidden.",
      );
      ok(
        /Get-ChildItem\s+@forceParam/.test(fileBlock),
        "Expected Get-ChildItem to use @forceParam splatting.",
      );
    });

    it("should preserve directory prefix in nested file completions", {
      skip: process.platform === "win32" || !isShellAvailable("pwsh"),
      timeout: 10000,
    }, () => {
      // Bun ignores the skip option, so we need an early return as well:
      if (process.platform === "win32") return;
      if (!isShellAvailable("pwsh")) return;

      const tempDir = mkdtempSync(
        join(tmpdir(), "pwsh-nested-dir-"),
      );

      try {
        // CLI that emits __FILE__:file with src/ prefix already typed
        const cliScript = `#!/bin/bash
printf '__FILE__:file::src/:0\\n'
`;
        const cliPath = join(tempDir, "nested-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create src/ directory with a file inside
        const srcDir = join(tempDir, "src");
        mkdirSync(srcDir, { recursive: true });
        writeFileSync(join(srcDir, "alpha.txt"), "");

        const script = pwsh.generateScript("nested-cli");

        const scriptPath = join(tempDir, "completion.ps1");
        writeFileSync(scriptPath, script);

        const testScriptPath = join(tempDir, "test.ps1");
        writeFileSync(
          testScriptPath,
          `$env:PATH = "${tempDir}:" + $env:PATH\n` +
            `. "${scriptPath}"\n` +
            `$result = TabExpansion2 -inputScript 'nested-cli src/' ` +
            `-cursorColumn 15\n` +
            `$result.CompletionMatches | ` +
            `ForEach-Object { $_.CompletionText }\n`,
        );

        const result = runCommand(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-File", testScriptPath],
          { cwd: tempDir },
        );

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        ok(
          completions.some((c) => c.trim() === "src/alpha.txt"),
          `Expected "src/alpha.txt" in completions, got: ${
            JSON.stringify(completions)
          }`,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should preserve backslash directory prefix on Windows", {
      skip: process.platform !== "win32" || !isShellAvailable("pwsh"),
    }, () => {
      // Bun ignores the skip option, so we need an early return as well:
      if (process.platform !== "win32") return;
      if (!isShellAvailable("pwsh")) return;

      const tempDir = mkdtempSync(
        join(tmpdir(), "pwsh-nested-backslash-"),
      );

      try {
        // CLI that emits __FILE__:file with src\ prefix (Windows-style)
        const cliScript = `@echo off\r\necho __FILE__:file::src\\:0\r\n`;
        const cliPath = join(tempDir, "nested-cli.cmd");
        writeFileSync(cliPath, cliScript);

        // Create src\ directory with a file inside
        const srcDir = join(tempDir, "src");
        mkdirSync(srcDir, { recursive: true });
        writeFileSync(join(srcDir, "alpha.txt"), "");

        const script = pwsh.generateScript("nested-cli");

        const scriptPath = join(tempDir, "completion.ps1");
        writeFileSync(scriptPath, script);

        const testScriptPath = join(tempDir, "test.ps1");
        writeFileSync(
          testScriptPath,
          `$env:PATH = "${tempDir};" + $env:PATH\n` +
            `. "${scriptPath}"\n` +
            `$result = TabExpansion2 -inputScript 'nested-cli src\\' ` +
            `-cursorColumn 16\n` +
            `$result.CompletionMatches | ` +
            `ForEach-Object { $_.CompletionText }\n`,
        );

        const result = runCommand(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-File", testScriptPath],
          { cwd: tempDir },
        );

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );
        ok(
          completions.some((c) => c.trim() === "src\\alpha.txt"),
          `Expected "src\\alpha.txt" in completions, got: ${
            JSON.stringify(completions)
          }`,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should filter files by dot-prefixed extensions in pwsh", {
      skip: process.platform === "win32" || !isShellAvailable("pwsh"),
      timeout: 10000,
    }, () => {
      // Bun ignores the skip option, so we need an early return as well:
      if (process.platform === "win32") return;
      if (!isShellAvailable("pwsh")) return;

      const tempDir = mkdtempSync(
        join(tmpdir(), "pwsh-ext-dot-filter-"),
      );

      try {
        // CLI emits __FILE__ with dot-prefixed extensions (.json,.yaml)
        const cliScript = `#!/bin/bash
printf '__FILE__:file:.json,.yaml::0\\n'
`;
        const cliPath = join(tempDir, "extapp");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create test files
        writeFileSync(join(tempDir, "data.json"), "");
        writeFileSync(join(tempDir, "config.yaml"), "");
        writeFileSync(join(tempDir, "readme.txt"), "");
        const subDir = join(tempDir, "subdir");
        mkdirSync(subDir);

        const script = pwsh.generateScript("extapp");

        const scriptPath = join(tempDir, "completion.ps1");
        writeFileSync(scriptPath, script);

        const testScriptPath = join(tempDir, "test.ps1");
        writeFileSync(
          testScriptPath,
          `$env:PATH = "${tempDir}:" + $env:PATH\n` +
            `. "${scriptPath}"\n` +
            `$result = TabExpansion2 -inputScript 'extapp ' ` +
            `-cursorColumn 7\n` +
            `$result.CompletionMatches | ` +
            `ForEach-Object { $_.CompletionText }\n`,
        );

        const result = runCommand(
          "pwsh",
          ["-NoProfile", "-NonInteractive", "-File", testScriptPath],
          { cwd: tempDir },
        );

        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );

        ok(
          completions.some((c) => c.includes("data.json")),
          `Expected data.json in completions, got: ${
            JSON.stringify(completions)
          }`,
        );
        ok(
          completions.some((c) => c.includes("config.yaml")),
          `Expected config.yaml in completions, got: ${
            JSON.stringify(completions)
          }`,
        );
        ok(
          !completions.some((c) => c.includes("readme.txt")),
          `Should not include readme.txt in completions, got: ${
            JSON.stringify(completions)
          }`,
        );
        ok(
          completions.some((c) => c.includes("subdir")),
          `Expected subdir/ in completions for navigation, got: ${
            JSON.stringify(completions)
          }`,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    for (const type of ["file", "any"] as const) {
      for (const extension of ["txt", "TXT"]) {
        for (const dotPrefix of [false, true]) {
          it(
            `should respect extension case in pwsh ${type} completions (${
              dotPrefix ? "." : ""
            }${extension})`,
            {
              skip: process.platform === "win32" || !isShellAvailable("pwsh"),
              timeout: 10000,
            },
            () => {
              // Bun ignores the skip option, so guard the POSIX fixture as well.
              if (
                process.platform === "win32" || !isShellAvailable("pwsh")
              ) return;

              const tempDir = mkdtempSync(
                join(tmpdir(), "pwsh-extension-case-"),
              );
              try {
                const directive = dotPrefix
                  // Compatibility transport also accepts dot-prefixed extensions.
                  ? `__FILE__:${type}:.${extension},.json:case:0`
                  : Array.from(pwsh.encodeSuggestions([{
                    kind: "file",
                    type,
                    extensions: [`.${extension}`, ".json"],
                    pattern: "case",
                    includeHidden: false,
                  }])).join("");
                writeFileSync(
                  join(tempDir, "casecli"),
                  `#!/bin/bash\nprintf '%s\\n' '${directive}'\n`,
                  { mode: 0o755 },
                );
                const fixtureDir = join(tempDir, "files");
                mkdirSync(fixtureDir);
                // Distinct stems also work on case-insensitive filesystems.
                for (
                  const file of [
                    "case-lower.txt",
                    "case-upper.TXT",
                    "case-mixed.Txt",
                    "case-data.json",
                    "case-shout.JSON",
                    "case-notes.md",
                  ]
                ) {
                  writeFileSync(join(fixtureDir, file), "");
                }
                mkdirSync(join(fixtureDir, "case-dir"));
                const scriptPath = join(tempDir, "completion.ps1");
                writeFileSync(scriptPath, pwsh.generateScript("casecli"));
                const quote = (value: string) =>
                  `'${value.replaceAll("'", "''")}'`;
                const result = runCommand("pwsh", [
                  "-NoProfile",
                  "-NonInteractive",
                  "-Command",
                  `$env:PATH = ${
                    quote(tempDir)
                  } + [IO.Path]::PathSeparator + $env:PATH; ` +
                  `. ${quote(scriptPath)}; ` +
                  `$line = 'casecli case'; ` +
                  `$result = [System.Management.Automation.CommandCompletion]::CompleteInput($line, $line.Length, $null); ` +
                  `$result.CompletionMatches | ForEach-Object { $_.CompletionText }`,
                ], { cwd: fixtureDir, timeout: 10000 });
                const completions = result.split(/\r?\n/).map((line) =>
                  line.trim()
                ).filter(Boolean);
                deepStrictEqual(
                  completions.sort(),
                  [
                    "case-dir/",
                    "case-data.json",
                    extension === "txt" ? "case-lower.txt" : "case-upper.TXT",
                  ].sort(),
                );
              } finally {
                rmSync(tempDir, { recursive: true, force: true });
              }
            },
          );
        }
      }
    }

    it("should include directories for navigation in file type completion", () => {
      const script = pwsh.generateScript("filedir-cli");

      // Extract the file case block from the PowerShell script
      const fileCase = script.substring(
        script.indexOf("switch ($type)"),
        script.lastIndexOf("}"),
      );
      const fileCaseBlock = fileCase.substring(
        fileCase.indexOf("'file'"),
        fileCase.indexOf("'directory'"),
      );
      // Should include explicit directory handling for navigation
      ok(
        fileCaseBlock.includes("PSIsContainer"),
        "pwsh file case should include directories for navigation.",
      );
      // Extension-filtered path must also keep directories
      const extBranch = fileCaseBlock.substring(
        fileCaseBlock.indexOf("if ($extensions)"),
        fileCaseBlock.indexOf("} else {"),
      );
      ok(
        extBranch.includes("PSIsContainer"),
        "pwsh file extensions branch should include directories for navigation.",
      );
    });
  });

  describe("fish shell completion", () => {
    it("should have correct name", () => {
      deepStrictEqual(fish.name, "fish");
    });

    it("should generate proper completion script", () => {
      const script = fish.generateScript("myapp");

      // Check for essential fish completion components
      deepStrictEqual(script.includes("function __myapp_complete"), true);
      deepStrictEqual(script.includes("commandline -poc"), true);
      deepStrictEqual(script.includes("commandline -ct"), true);
      deepStrictEqual(script.includes("string match"), true);
      deepStrictEqual(
        script.includes("complete -c myapp -f -a '(__myapp_complete)'"),
        true,
      );
    });

    it("should work with actual fish shell", (t) => {
      if (!isShellAvailable("fish")) {
        t.skip("fish not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "fish-completion-"));

      try {
        const cliPath = createTestCli(tempDir);
        const programName = "test-cli";
        const script = fish.generateScript(programName, ["completion", "fish"]);

        const completions = testFishCompletion(
          script,
          programName,
          dirname(cliPath),
        );

        // Check that we got git and docker (may have descriptions appended)
        const hasGit = completions.some((line) =>
          line.startsWith("git") || line === "git"
        );
        const hasDocker = completions.some((line) =>
          line.startsWith("docker") || line === "docker"
        );

        deepStrictEqual(hasGit, true);
        deepStrictEqual(hasDocker, true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should generate script with completion command args", () => {
      const script = fish.generateScript("myapp", ["completion", "fish"]);

      deepStrictEqual(script.includes("myapp 'completion' 'fish'"), true);
    });

    it("should escape single quotes in arguments", () => {
      const script = fish.generateScript("myapp", ["it's", "test"]);

      deepStrictEqual(script.includes("'it\\'s'"), true);
    });

    it("should encode suggestions with tab-separated format", () => {
      const suggestions: Suggestion[] = [
        { kind: "literal", text: "--verbose" },
        { kind: "literal", text: "--quiet" },
      ];

      const encoded = Array.from(fish.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, [
        "--verbose\t",
        "\n",
        "--quiet\t",
      ]);
    });

    it("should encode suggestions with descriptions", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "literal",
          text: "--verbose",
          description: message`Enable verbose output`,
        },
        {
          kind: "literal",
          text: "--quiet",
          description: message`Suppress output`,
        },
      ];

      const encoded = Array.from(fish.encodeSuggestions(suggestions));

      // Check format: value\tdescription
      deepStrictEqual(encoded[0], "--verbose\tEnable verbose output");
      deepStrictEqual(encoded[1], "\n");
      deepStrictEqual(encoded[2], "--quiet\tSuppress output");
    });

    it("should handle empty suggestions list", () => {
      const suggestions: Suggestion[] = [];

      const encoded = Array.from(fish.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, []);
    });

    it("should encode single suggestion without newline", () => {
      const suggestions: Suggestion[] = [
        { kind: "literal", text: "--verbose" },
      ];

      const encoded = Array.from(fish.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["--verbose\t"]);
    });

    it("should encode file suggestions with marker", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          extensions: ["json", "yaml"],
          includeHidden: false,
          description: message`Configuration file`,
        },
      ];

      const encoded = Array.from(fish.encodeSuggestions(suggestions));

      deepStrictEqual(
        encoded[0],
        "__FILE__:file:json,yaml::0\tConfiguration file",
      );
    });

    it("should encode file suggestion defaults in fish", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "directory",
          includeHidden: true,
        },
      ];

      const encoded = Array.from(fish.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["__FILE__:directory:::1\t"]);
    });

    it("should strip leading dots from extensions in fish", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          extensions: [".json", ".yaml"],
          includeHidden: false,
        },
      ];

      const encoded = Array.from(fish.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["__FILE__:file:json,yaml::0\t"]);
    });

    it("should encode file suggestions with colon in pattern", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          pattern: "C:/Users/test/",
          includeHidden: false,
          description: message`Config file`,
        },
      ];

      const encoded = Array.from(fish.encodeSuggestions(suggestions));

      deepStrictEqual(
        encoded[0],
        "__FILE__:file::C%3A/Users/test/:0\tConfig file",
      );
    });

    it("should encode file suggestions with percent in pattern", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          pattern: "100%done",
          includeHidden: false,
        },
      ];

      const encoded = Array.from(fish.encodeSuggestions(suggestions));

      deepStrictEqual(
        encoded[0],
        "__FILE__:file::100%25done:0\t",
      );
    });

    it("should format descriptions without colors", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "literal",
          text: "--verbose",
          description: message`Enable verbose mode`,
        },
      ];

      const encoded = Array.from(fish.encodeSuggestions(suggestions));

      // Should contain tab-separated format
      deepStrictEqual(encoded[0].startsWith("--verbose\t"), true);
      deepStrictEqual(encoded[0].includes("Enable verbose mode"), true);
      // Should not contain ANSI color codes
      deepStrictEqual(encoded[0].includes("\x1b["), false);
    });

    it("should sanitize tabs and newlines in descriptions", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "literal",
          text: "--opt",
          description: [text("Line 1"), lineBreak(), text("Line\t2")],
        },
      ];

      const encoded = Array.from(fish.encodeSuggestions(suggestions));
      deepStrictEqual(encoded, ["--opt\tLine 1 Line 2"]);
    });

    it("should sanitize tabs and newlines in literal text", () => {
      const suggestions: Suggestion[] = [
        { kind: "literal", text: "alpha\tbeta" },
        { kind: "literal", text: "line1\nline2" },
        { kind: "literal", text: "car\rriage" },
        { kind: "literal", text: "nul\0byte" },
      ];

      const encoded = Array.from(fish.encodeSuggestions(suggestions));
      deepStrictEqual(encoded, [
        "alpha beta\t",
        "\n",
        "line1 line2\t",
        "\n",
        "car riage\t",
        "\n",
        "nul byte\t",
      ]);
    });

    it("should preserve punctuation in program names", () => {
      const script = fish.generateScript("my-app.js");

      // Keep distinct program names from sharing the same helper.
      ok(script.includes("function __my-app.js_complete"));
    });

    it("should strip tab-delimited metadata before parsing __FILE__ directive", () => {
      const script = fish.generateScript("myapp");

      // In the __FILE__ block, the script must split by tab first to
      // isolate the directive before splitting by colon.  Verify that
      // a tab-stripping split appears between the __FILE__ match and
      // the colon split on parts.
      const fileBlock = script.substring(
        script.indexOf("__FILE__:"),
        script.indexOf("set -l type $parts[2]"),
      );
      ok(fileBlock.includes("string split \\t"));
    });

    it("should use pattern for file globbing instead of current word in fish", (t) => {
      if (!isShellAvailable("fish")) {
        t.skip("fish not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "fish-pattern-completion-"),
      );

      try {
        // CLI emits __FILE__ with pattern=src/
        const cliScript = `#!/bin/bash
printf '__FILE__:file::src/:0\\tFile\\n'
`;
        const cliPath = join(tempDir, "patapp");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create directory structure
        const srcDir = join(tempDir, "src");
        mkdirSync(srcDir);
        writeFileSync(join(srcDir, "main.ts"), "");
        writeFileSync(join(srcDir, "util.ts"), "");
        writeFileSync(join(tempDir, "README.md"), "");

        const script = fish.generateScript("patapp");
        const scriptPath = join(tempDir, "completion.fish");
        writeFileSync(scriptPath, script);

        const functionMatch = script.match(/function ([^\s]+)/);
        const functionName = functionMatch
          ? functionMatch[1]
          : "__patapp_complete";
        const testScript = `
set -x PATH "${tempDir}" $PATH
source "${scriptPath}"
cd "${tempDir}"

function commandline
    switch $argv[1]
        case '-poc'
            echo "patapp"
        case '-ct'
            echo ""
    end
end

${functionName}
`;
        const testScriptPath = join(tempDir, "test.fish");
        writeFileSync(testScriptPath, testScript);
        const result = runCommand("fish", [testScriptPath], { cwd: tempDir });
        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );

        // Should find files under src/ (from pattern), not root-level files
        ok(completions.some((c) => c.includes("main.ts")));
        ok(completions.some((c) => c.includes("util.ts")));
        ok(!completions.some((c) => c.includes("README.md")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should expand tilde in pattern for file globbing in fish", (t) => {
      if (!isShellAvailable("fish")) {
        t.skip("fish not available");
        return;
      }

      const home = process.env.HOME;
      if (!home) {
        t.skip("HOME not set");
        return;
      }

      const tempDir = mkdtempSync(join(home, ".optique-fish-tilde-"));

      try {
        const tildeDir = tempDir.replace(home, "~") + "/";
        const cliScript = `#!/bin/bash
printf '__FILE__:file::${tildeDir}:0\\tFile\\n'
`;
        const cliPath = join(tempDir, "tilde-fish-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });
        writeFileSync(join(tempDir, "testfile.txt"), "");

        const script = fish.generateScript("tilde-fish-cli");
        const scriptPath = join(tempDir, "completion.fish");
        writeFileSync(scriptPath, script);

        const functionMatch = script.match(/function ([^\s]+)/);
        const functionName = functionMatch
          ? functionMatch[1]
          : "__tilde_fish_cli_complete";
        const testScript = `
set -x PATH "${tempDir}" $PATH
source "${scriptPath}"

function commandline
    switch $argv[1]
        case '-poc'
            echo "tilde-fish-cli"
        case '-ct'
            echo ""
    end
end

${functionName}
`;
        const testScriptPath = join(tempDir, "test.fish");
        writeFileSync(testScriptPath, testScript);
        const result = runCommand("fish", [testScriptPath], {
          cwd: tempDir,
        });
        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );

        // Should find the file via tilde-expanded pattern
        ok(completions.some((c) => c.includes("testfile.txt")));
        // Results should use tilde prefix, not expanded home
        ok(completions.some((c) => c.startsWith("~/")));
        ok(!completions.some((c) => c.startsWith(home)));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should preserve hidden-basename matches in pattern for fish", (t) => {
      if (!isShellAvailable("fish")) {
        t.skip("fish not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "fish-hidden-pattern-"),
      );

      try {
        // CLI emits __FILE__ with pattern=src/.e (hidden basename under
        // a non-hidden parent) and hidden=0
        const srcDir = join(tempDir, "src");
        mkdirSync(srcDir);
        writeFileSync(join(srcDir, ".env"), "");
        writeFileSync(join(srcDir, ".eslintrc"), "");
        writeFileSync(join(srcDir, "main.ts"), "");

        const cliScript = `#!/bin/bash
printf '__FILE__:file::src/.e:0\\tFile\\n'
`;
        const cliPath = join(tempDir, "dotpat");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        const script = fish.generateScript("dotpat");
        const scriptPath = join(tempDir, "completion.fish");
        writeFileSync(scriptPath, script);

        const functionMatch = script.match(/function ([^\s]+)/);
        const functionName = functionMatch
          ? functionMatch[1]
          : "__dotpat_complete";
        const testScript = `
set -x PATH "${tempDir}" $PATH
source "${scriptPath}"
cd "${tempDir}"

function commandline
    switch $argv[1]
        case '-poc'
            echo "dotpat"
        case '-ct'
            echo ""
    end
end

${functionName}
`;
        const testScriptPath = join(tempDir, "test.fish");
        writeFileSync(testScriptPath, testScript);
        const result = runCommand("fish", [testScriptPath], { cwd: tempDir });
        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );

        // Pattern "src/.e" targets hidden files — they must not be filtered out
        ok(completions.some((c) => c.includes(".env")));
        ok(completions.some((c) => c.includes(".eslintrc")));
        // Non-matching files should not appear
        ok(!completions.some((c) => c.includes("main.ts")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should preserve user suffix for incremental filtering in fish", (t) => {
      if (!isShellAvailable("fish")) {
        t.skip("fish not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "fish-incremental-"),
      );

      try {
        // CLI emits __FILE__ with pattern=src/
        const srcDir = join(tempDir, "src");
        mkdirSync(srcDir);
        writeFileSync(join(srcDir, "main.ts"), "");
        writeFileSync(join(srcDir, "util.ts"), "");
        writeFileSync(join(srcDir, "model.ts"), "");

        const cliScript = `#!/bin/bash
printf '__FILE__:file::src/:0\\tFile\\n'
`;
        const cliPath = join(tempDir, "incr-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        const script = fish.generateScript("incr-cli");
        const scriptPath = join(tempDir, "completion.fish");
        writeFileSync(scriptPath, script);

        const functionMatch = script.match(/function ([^\s]+)/);
        const functionName = functionMatch
          ? functionMatch[1]
          : "__incr_cli_complete";

        // User has typed "src/ma" — should narrow to main.ts only
        const testScript = `
set -x PATH "${tempDir}" $PATH
source "${scriptPath}"
cd "${tempDir}"

function commandline
    switch $argv[1]
        case '-poc'
            echo "incr-cli"
            echo "src/ma"
        case '-ct'
            echo "src/ma"
    end
end

${functionName}
`;
        const testScriptPath = join(tempDir, "test.fish");
        writeFileSync(testScriptPath, testScript);
        const result = runCommand("fish", [testScriptPath], { cwd: tempDir });
        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );

        ok(completions.some((c) => c.includes("main.ts")));
        ok(!completions.some((c) => c.includes("util.ts")));
        ok(!completions.some((c) => c.includes("model.ts")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should include hidden files when includeHidden is true", (t) => {
      if (!isShellAvailable("fish")) {
        t.skip("fish not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "fish-hidden-completion-"),
      );

      try {
        // CLI that emits __FILE__ with hidden=1 and tab-delimited description,
        // matching the format produced by fish.encodeSuggestions()
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::1\\tConfiguration file\\n'
`;
        const cliPath = join(tempDir, "hidden-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create visible and hidden files
        writeFileSync(join(tempDir, "visible.txt"), "");
        writeFileSync(join(tempDir, ".hidden"), "");

        const script = fish.generateScript("hidden-cli");
        const scriptPath = join(tempDir, "completion.fish");
        writeFileSync(scriptPath, script);

        // Override commandline mock to complete with dot prefix so fish
        // globs hidden files (fish's * does not match dotfiles by default)
        const functionMatch = script.match(/function ([^\s]+)/);
        const functionName = functionMatch
          ? functionMatch[1]
          : "__hidden_cli_complete";
        const testScript = `
set -x PATH "${tempDir}" $PATH
source "${scriptPath}"
cd "${tempDir}"

# Mock commandline to return dot prefix so glob picks up hidden files
function commandline
    switch $argv[1]
        case '-poc'
            echo "hidden-cli"
            echo "."
        case '-ct'
            echo "."
    end
end

${functionName}
`;
        const testScriptPath = join(tempDir, "test.fish");
        writeFileSync(testScriptPath, testScript);
        const result = runCommand("fish", [testScriptPath], { cwd: tempDir });
        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );

        // With hidden=1 and dot prefix, hidden files must be included
        ok(completions.some((c) => c.includes(".hidden")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should enumerate hidden files without dot prefix when includeHidden is true", (t) => {
      if (!isShellAvailable("fish")) {
        t.skip("fish not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "fish-hidden-no-dot-"),
      );

      try {
        // CLI that emits __FILE__ with hidden=1
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::1\\tConfiguration file\\n'
`;
        const cliPath = join(tempDir, "hidden-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        writeFileSync(join(tempDir, "visible.txt"), "");
        writeFileSync(join(tempDir, ".hidden"), "");

        const script = fish.generateScript("hidden-cli");
        const scriptPath = join(tempDir, "completion.fish");
        writeFileSync(scriptPath, script);

        const functionMatch = script.match(/function ([^\s]+)/);
        const functionName = functionMatch
          ? functionMatch[1]
          : "__hidden_cli_complete";
        // Mock commandline with empty current token (no dot prefix)
        const testScript = `
set -x PATH "${tempDir}" $PATH
source "${scriptPath}"
cd "${tempDir}"

function commandline
    switch $argv[1]
        case '-poc'
            echo "hidden-cli"
        case '-ct'
            echo ""
    end
end

${functionName}
`;
        const testScriptPath = join(tempDir, "test.fish");
        writeFileSync(testScriptPath, testScript);
        const result = runCommand("fish", [testScriptPath], { cwd: tempDir });
        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );

        // With hidden=1 and no dot prefix, hidden files must still be included
        ok(completions.some((c) => c.includes(".hidden")));
        ok(completions.some((c) => c.includes("visible.txt")));
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should filter files by dot-prefixed extensions in fish", (t) => {
      if (!isShellAvailable("fish")) {
        t.skip("fish not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "fish-ext-dot-filter-"),
      );

      try {
        // CLI emits __FILE__ with dot-prefixed extensions (.json,.yaml)
        const cliScript = `#!/bin/bash
printf '__FILE__:file:.json,.yaml::0\\tFile\\n'
`;
        const cliPath = join(tempDir, "extapp");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create test files
        writeFileSync(join(tempDir, "data.json"), "");
        writeFileSync(join(tempDir, "config.yaml"), "");
        writeFileSync(join(tempDir, "readme.txt"), "");
        const subDir = join(tempDir, "subdir");
        mkdirSync(subDir);

        const script = fish.generateScript("extapp");
        const scriptPath = join(tempDir, "completion.fish");
        writeFileSync(scriptPath, script);

        const functionMatch = script.match(/function ([^\s]+)/);
        const functionName = functionMatch
          ? functionMatch[1]
          : "__extapp_complete";
        const testScript = `
set -x PATH "${tempDir}" $PATH
source "${scriptPath}"
cd "${tempDir}"

function commandline
    switch $argv[1]
        case '-poc'
            echo "extapp"
        case '-ct'
            echo ""
    end
end

${functionName}
`;
        const testScriptPath = join(tempDir, "test.fish");
        writeFileSync(testScriptPath, testScript);
        const result = runCommand("fish", [testScriptPath], { cwd: tempDir });
        const completions = result.trim().split("\n").filter((l) =>
          l.length > 0
        );

        ok(
          completions.some((c) => c.includes("data.json")),
          `Expected data.json in completions, got: ${
            JSON.stringify(completions)
          }`,
        );
        ok(
          completions.some((c) => c.includes("config.yaml")),
          `Expected config.yaml in completions, got: ${
            JSON.stringify(completions)
          }`,
        );
        ok(
          !completions.some((c) => c.includes("readme.txt")),
          `Should not include readme.txt in completions, got: ${
            JSON.stringify(completions)
          }`,
        );
        ok(
          completions.some((c) => c.includes("subdir")),
          `Expected subdir/ in completions for navigation, got: ${
            JSON.stringify(completions)
          }`,
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should include directories for navigation in file type completion", () => {
      const script = fish.generateScript("filedir-cli");

      // Extract the file case block between "case file" and "case directory"
      const caseFileIdx = script.indexOf("case file");
      const caseDirIdx = script.indexOf("case directory");
      const fileCaseBlock = script.substring(caseFileIdx, caseDirIdx);
      // Should check for directories (-d) to allow navigation
      ok(
        fileCaseBlock.includes("test -d"),
        "fish file case should include directory check for navigation.",
      );
    });

    describe("wildcard file patterns", () => {
      const fishUnavailable = !isShellAvailable("fish");

      interface FishGlobFixture {
        readonly root: string;
        readonly fixture: string;
      }

      function createFixture(prefix: string): FishGlobFixture {
        const root = mkdtempSync(join(tmpdir(), prefix));
        const fixture = join(root, "fixture");
        mkdirSync(join(root, "bin"));
        mkdirSync(fixture);
        return { root, fixture };
      }

      function touch(dir: string, ...names: readonly string[]): void {
        for (const name of names) {
          if (name.endsWith("/")) {
            mkdirSync(join(dir, name), { recursive: true });
          } else {
            mkdirSync(dirname(join(dir, name)), { recursive: true });
            writeFileSync(join(dir, name), "");
          }
        }
      }

      // Runs the generated fish completion function for a CLI stub that
      // emits a single file directive.  The stub and scripts live outside
      // the fixture directory so they never appear among the candidates.
      function completeWithFish(
        { root, fixture }: FishGlobFixture,
        directive: string,
        current = "",
      ): readonly string[] {
        const bin = join(root, "bin");
        writeFileSync(
          join(bin, "globapp"),
          `#!/bin/sh\nprintf '%s\\t\\n' '${directive}'\n`,
          { mode: 0o755 },
        );
        const scriptPath = join(bin, "completion.fish");
        writeFileSync(scriptPath, fish.generateScript("globapp"));
        const testScriptPath = join(bin, "test.fish");
        writeFileSync(
          testScriptPath,
          `
set -x PATH "${bin}" $PATH
source "${scriptPath}"
cd "${fixture}"

function commandline
    switch $argv[1]
        case '-poc'
            echo "globapp"
        case '-ct'
            echo '${current}'
    end
end

__globapp_complete
`,
        );
        const result = spawnSync("fish", ["--no-config", testScriptPath], {
          cwd: fixture,
          encoding: "utf8",
        });
        deepStrictEqual(result.stderr, "");
        deepStrictEqual(result.status, 0);
        return result.stdout.split("\n").filter((l) => l.length > 0).sort();
      }

      it("should match files against a basename wildcard", {
        skip: fishUnavailable,
      }, () => {
        // Bun ignores the skip option, so we need an early return as well:
        if (fishUnavailable) return;
        const f = createFixture("fish-glob-star-");
        try {
          touch(
            f.fixture,
            "hello.txt",
            "notes.txt",
            "other.json",
            ".secret.txt",
            "src/",
          );
          deepStrictEqual(completeWithFish(f, "__FILE__:file::*.txt:0"), [
            "hello.txt",
            "notes.txt",
            "src/",
          ]);
        } finally {
          rmSync(f.root, { recursive: true, force: true });
        }
      });

      it("should match a single character for ? in a wildcard", {
        skip: fishUnavailable,
      }, () => {
        if (fishUnavailable) return;
        const f = createFixture("fish-glob-qmark-");
        try {
          touch(
            f.fixture,
            "file1.txt",
            "file12.txt",
            "fileAB.txt",
            "file?.txt.bak",
            "dir/",
          );
          deepStrictEqual(completeWithFish(f, "__FILE__:file::file?.txt:0"), [
            "dir/",
            "file1.txt",
          ]);
        } finally {
          rmSync(f.root, { recursive: true, force: true });
        }
      });

      it("should keep the directory prefix of a wildcard pattern", {
        skip: fishUnavailable,
      }, () => {
        if (fishUnavailable) return;
        const f = createFixture("fish-glob-dir-");
        try {
          touch(f.fixture, "top.txt", "src/a.txt", "src/b.json", "src/sub/");
          deepStrictEqual(completeWithFish(f, "__FILE__:file::src/*.txt:0"), [
            "src/a.txt",
            "src/sub/",
          ]);
          deepStrictEqual(
            completeWithFish(f, "__FILE__:file::./src/*.txt:0"),
            ["./src/a.txt", "./src/sub/"],
          );
        } finally {
          rmSync(f.root, { recursive: true, force: true });
        }
      });

      it("should treat other characters in a wildcard literally", {
        skip: fishUnavailable,
      }, () => {
        if (fishUnavailable) return;
        const f = createFixture("fish-glob-literal-");
        try {
          touch(
            f.fixture,
            "[draft] notes.txt",
            "d notes.txt",
            "a+(b)1.txt",
            "aa(b)1.txt",
            "a+b1.txt",
            "back\\slash.txt",
            "backxslash.txt",
          );
          deepStrictEqual(
            completeWithFish(f, "__FILE__:file::[draft] *.txt:0"),
            ["[draft] notes.txt"],
          );
          deepStrictEqual(completeWithFish(f, "__FILE__:file::a+(b)*.txt:0"), [
            "a+(b)1.txt",
          ]);
          deepStrictEqual(
            completeWithFish(f, "__FILE__:file::back\\sl*.txt:0"),
            ["back\\slash.txt"],
          );
        } finally {
          rmSync(f.root, { recursive: true, force: true });
        }
      });

      it("should include hidden entries for a wildcard when requested", {
        skip: fishUnavailable,
      }, () => {
        if (fishUnavailable) return;
        const f = createFixture("fish-glob-hidden-");
        try {
          touch(
            f.fixture,
            "hello.txt",
            ".secret.txt",
            ".env",
            ".eslintrc",
            ".cache/",
            "src/",
          );
          deepStrictEqual(completeWithFish(f, "__FILE__:file::*.txt:1"), [
            ".cache/",
            ".secret.txt",
            "hello.txt",
            "src/",
          ]);
          deepStrictEqual(completeWithFish(f, "__FILE__:file::*.txt:0"), [
            "hello.txt",
            "src/",
          ]);
          deepStrictEqual(completeWithFish(f, "__FILE__:file::.e*:0"), [
            ".env",
            ".eslintrc",
            "src/",
          ]);
          deepStrictEqual(completeWithFish(f, "__FILE__:file::.e?v:0"), [
            ".env",
            "src/",
          ]);
        } finally {
          rmSync(f.root, { recursive: true, force: true });
        }
      });

      it("should apply extension filters and directory type to wildcards", {
        skip: fishUnavailable,
      }, () => {
        if (fishUnavailable) return;
        const f = createFixture("fish-glob-filter-");
        try {
          touch(f.fixture, "a.json", "b.txt", "src/", "share/", "lib/");
          deepStrictEqual(completeWithFish(f, "__FILE__:file:json:*:0"), [
            "a.json",
            "lib/",
            "share/",
            "src/",
          ]);
          deepStrictEqual(completeWithFish(f, "__FILE__:directory::s*:0"), [
            "share/",
            "src/",
          ]);
        } finally {
          rmSync(f.root, { recursive: true, force: true });
        }
      });

      it("should list each matching directory once", {
        skip: fishUnavailable,
      }, () => {
        if (fishUnavailable) return;
        const f = createFixture("fish-glob-dedupe-");
        try {
          touch(f.fixture, "a.txt", "src/", ".cache/");
          deepStrictEqual(completeWithFish(f, "__FILE__:file::*:1"), [
            ".cache/",
            "a.txt",
            "src/",
          ]);
          deepStrictEqual(completeWithFish(f, "__FILE__:any::*:0"), [
            "a.txt",
            "src/",
          ]);
        } finally {
          rmSync(f.root, { recursive: true, force: true });
        }
      });

      it("should not treat ? in a directory name as a wildcard", {
        skip: fishUnavailable,
      }, () => {
        if (fishUnavailable) return;
        const f = createFixture("fish-glob-dirname-");
        try {
          touch(f.fixture, "What?/f1", "Whatx/f2");
          deepStrictEqual(completeWithFish(f, "__FILE__:file::What?/:0"), [
            "What?/f1",
          ]);
          // An unrelated typed word must not replace the fixed directory,
          // just as it does not for a pattern such as src/.
          deepStrictEqual(
            completeWithFish(f, "__FILE__:file::What?/:0", "zz"),
            ["What?/f1"],
          );
        } finally {
          rmSync(f.root, { recursive: true, force: true });
        }
      });

      it("should treat ? and * in the typed word as literal prefixes", {
        skip: fishUnavailable,
      }, () => {
        if (fishUnavailable) return;
        const f = createFixture("fish-glob-typed-");
        try {
          // path() echoes the typed word as its pattern, so a pattern equal
          // to the current word is a literal prefix, not a wildcard.
          touch(
            f.fixture,
            "What?.txt",
            "Whatx",
            "src/a?b.txt",
            "src/axb.txt",
            "star*x.txt",
            "starzz.txt",
          );
          deepStrictEqual(
            completeWithFish(f, "__FILE__:file::What?:0", "What?"),
            ["What?.txt"],
          );
          deepStrictEqual(
            completeWithFish(f, "__FILE__:file::src/a?:0", "src/a?"),
            ["src/a?b.txt"],
          );
          deepStrictEqual(
            completeWithFish(f, "__FILE__:file::star*:0", "star*"),
            ["star*x.txt"],
          );
        } finally {
          rmSync(f.root, { recursive: true, force: true });
        }
      });

      it("should return nothing when a wildcard matches nothing", {
        skip: fishUnavailable,
      }, () => {
        if (fishUnavailable) return;
        const f = createFixture("fish-glob-none-");
        try {
          touch(f.fixture, "a.txt", "b.json");
          deepStrictEqual(completeWithFish(f, "__FILE__:file::*.none:0"), []);
        } finally {
          rmSync(f.root, { recursive: true, force: true });
        }
      });

      it("should keep the typed word for non-wildcard and ./ prefixes", {
        skip: fishUnavailable,
      }, () => {
        if (fishUnavailable) return;
        const f = createFixture("fish-glob-control-");
        try {
          touch(f.fixture, "src/main.ts", "src/model.ts", "src/util.ts");
          deepStrictEqual(completeWithFish(f, "__FILE__:file::src/:0"), [
            "src/main.ts",
            "src/model.ts",
            "src/util.ts",
          ]);
          deepStrictEqual(
            completeWithFish(f, "__FILE__:file::src/:0", "./src/m"),
            ["./src/main.ts", "./src/model.ts"],
          );
        } finally {
          rmSync(f.root, { recursive: true, force: true });
        }
      });

      it("should enumerate the root directory for a /-rooted wildcard", {
        skip: fishUnavailable,
      }, () => {
        if (fishUnavailable) return;
        const f = createFixture("fish-glob-root-");
        try {
          const completions = completeWithFish(
            f,
            "__FILE__:directory::/*:0",
          );
          ok(completions.length > 0);
          ok(completions.every((c) => c.startsWith("/") && c.endsWith("/")));
        } finally {
          rmSync(f.root, { recursive: true, force: true });
        }
      });

      it("should restore the tilde prefix for a wildcard", {
        skip: fishUnavailable || process.env.HOME == null,
      }, () => {
        const home = process.env.HOME;
        if (fishUnavailable || home == null) return;
        const f = createFixture("fish-glob-tilde-");
        const homeDir = mkdtempSync(join(home, ".optique-fish-glob-"));
        try {
          touch(homeDir, "x.txt", "y.json");
          const tildeDir = "~" + homeDir.slice(home.length);
          deepStrictEqual(
            completeWithFish(f, `__FILE__:file::${tildeDir}/*.txt:0`),
            [`${tildeDir}/x.txt`],
          );
        } finally {
          rmSync(homeDir, { recursive: true, force: true });
          rmSync(f.root, { recursive: true, force: true });
        }
      });
    });
  });

  describe("nu shell completion", () => {
    it("should have correct name", () => {
      deepStrictEqual(nu.name, "nu");
    });

    it("should generate proper completion script", () => {
      const script = nu.generateScript("myapp");

      // Check for essential Nushell completion components
      deepStrictEqual(script.includes('def "nu-complete-myapp"'), true);
      deepStrictEqual(script.includes("args-split"), true);
      deepStrictEqual(script.includes("str ends-with"), true);
      deepStrictEqual(script.includes("flatten"), true);
      deepStrictEqual(
        script.includes("$env.config.completions.external.completer"),
        true,
      );
      deepStrictEqual(script.includes('if ($spans.0 == "myapp")'), true);
      deepStrictEqual(script.includes("nu-complete-myapp-external"), true);
    });

    it("should work with actual nu shell", (t) => {
      const nuAvailable = isShellAvailable("nu");

      if (!nuAvailable) {
        t.skip("nu not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "nu-completion-"));

      try {
        const cliPath = createTestCli(tempDir);
        const programName = "test-cli";
        const script = nu.generateScript(programName, ["completion", "nu"]);
        const completions = testNuCompletion(
          script,
          programName,
          dirname(cliPath),
        );

        // Check that we got git and docker completions
        const hasGit = completions.some((c) =>
          c === "git" || c.includes("git")
        );
        const hasDocker = completions.some((c) =>
          c === "docker" || c.includes("docker")
        );

        deepStrictEqual(hasGit, true);
        deepStrictEqual(hasDocker, true);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should generate script with completion command args", () => {
      const script = nu.generateScript("myapp", ["completion", "nu"]);

      deepStrictEqual(script.includes("'completion' 'nu'"), true);
    });

    it("should escape single quotes in arguments", () => {
      const script = nu.generateScript("myapp", ["it's", "test"]);

      // Nushell single-quoted strings have no escapes, so an argument with
      // an apostrophe has to be written as a double-quoted string instead:
      ok(script.includes(`^myapp "it's" 'test' ...$final_args`));
      ok(!script.includes("'it''s'"));
    });

    it("should escape double quotes and backslashes in arguments", () => {
      const script = nu.generateScript("myapp", ['it\'s "quoted" C:\\path\\']);

      ok(script.includes(`^myapp "it's \\"quoted\\" C:\\\\path\\\\"`));
    });

    it("should pass fixed arguments intact to the CLI with actual nu shell", {
      skip: process.platform === "win32",
    }, (t) => {
      // Bun ignores the skip option, so we need an early return as well:
      if (process.platform === "win32") return;
      if (!isShellAvailable("nu")) {
        t.skip("nu not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "nu-fixed-args-"));
      try {
        const argsPath = join(tempDir, "callback-args");
        const cliPath = join(tempDir, "fixed-args-cli");
        writeFileSync(
          cliPath,
          `#!/bin/sh
printf '%s\\0' "$@" > '${argsPath}'
printf 'alpha\\t\\n'
`,
          { mode: 0o755 },
        );

        const fixedArgs = [
          "it's",
          `say "hi" it's`,
          "back\\slash's\\",
          "$(not) it's ~ *",
          "line\nbreak's",
          "caf\u00e9's \u{1F600}",
          "",
          "plain",
        ];
        const scriptPath = join(tempDir, "completion.nu");
        writeFileSync(
          scriptPath,
          nu.generateScript("fixed-args-cli", fixedArgs),
        );
        const testScriptPath = join(tempDir, "test.nu");
        writeFileSync(
          testScriptPath,
          `
$env.PATH = ($env.PATH | prepend "${tempDir}")
source ${scriptPath}
nu-complete-fixed-args-cli "fixed-args-cli a" | ignore
`,
        );
        runCommand("nu", [testScriptPath], { cwd: tempDir });

        const output = readFileSync(argsPath, "utf8");
        ok(output.endsWith("\0"));
        deepStrictEqual(output.slice(0, -1).split("\0"), [...fixedArgs, "a"]);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should encode suggestions with tab-separated format", () => {
      const suggestions: Suggestion[] = [
        { kind: "literal", text: "--verbose" },
        { kind: "literal", text: "--quiet" },
      ];

      const encoded = Array.from(nu.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, [
        "--verbose\t",
        "\n",
        "--quiet\t",
      ]);
    });

    it("should encode suggestions with descriptions", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "literal",
          text: "--verbose",
          description: message`Enable verbose output`,
        },
        {
          kind: "literal",
          text: "--quiet",
          description: message`Suppress output`,
        },
      ];

      const encoded = Array.from(nu.encodeSuggestions(suggestions));

      // Check format: value\tdescription
      deepStrictEqual(encoded[0], "--verbose\tEnable verbose output");
      deepStrictEqual(encoded[1], "\n");
      deepStrictEqual(encoded[2], "--quiet\tSuppress output");
    });

    it("should handle empty suggestions list", () => {
      const suggestions: Suggestion[] = [];

      const encoded = Array.from(nu.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, []);
    });

    it("should encode single suggestion without newline", () => {
      const suggestions: Suggestion[] = [
        { kind: "literal", text: "--verbose" },
      ];

      const encoded = Array.from(nu.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["--verbose\t"]);
    });

    it("should encode file suggestions with marker", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          extensions: ["json", "yaml"],
          includeHidden: false,
          description: message`Configuration file`,
        },
      ];

      const encoded = Array.from(nu.encodeSuggestions(suggestions));

      deepStrictEqual(
        encoded[0],
        "__FILE__:file:json,yaml::0\tConfiguration file",
      );
    });

    it("should encode file suggestion defaults in nu", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "directory",
          includeHidden: true,
        },
      ];

      const encoded = Array.from(nu.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["__FILE__:directory:::1\t"]);
    });

    it("should strip leading dots from extensions in nu", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          extensions: [".json", ".yaml"],
          includeHidden: false,
        },
      ];

      const encoded = Array.from(nu.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, ["__FILE__:file:json,yaml::0\t"]);
    });

    it("should encode file suggestions with colon in pattern", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          pattern: "C:/Users/test/",
          includeHidden: false,
          description: message`Config file`,
        },
      ];

      const encoded = Array.from(nu.encodeSuggestions(suggestions));

      deepStrictEqual(
        encoded[0],
        "__FILE__:file::C%3A/Users/test/:0\tConfig file",
      );
    });

    it("should encode file suggestions with percent in pattern", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          pattern: "100%done",
          includeHidden: false,
        },
      ];

      const encoded = Array.from(nu.encodeSuggestions(suggestions));

      deepStrictEqual(
        encoded[0],
        "__FILE__:file::100%25done:0\t",
      );
    });

    it("should format descriptions without colors", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "literal",
          text: "--verbose",
          description: message`Enable verbose mode`,
        },
      ];

      const encoded = Array.from(nu.encodeSuggestions(suggestions));

      // Should contain tab-separated format
      deepStrictEqual(encoded[0].startsWith("--verbose\t"), true);
      deepStrictEqual(encoded[0].includes("Enable verbose mode"), true);
      // Should not contain ANSI color codes
      deepStrictEqual(encoded[0].includes("\x1b["), false);
    });

    it("should sanitize tabs and newlines in descriptions", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "literal",
          text: "--opt",
          description: [text("Line 1"), lineBreak(), text("Line\t2")],
        },
      ];

      const encoded = Array.from(nu.encodeSuggestions(suggestions));
      deepStrictEqual(encoded, ["--opt\tLine 1 Line 2"]);
    });

    it("should sanitize tabs and newlines in literal text", () => {
      const suggestions: Suggestion[] = [
        { kind: "literal", text: "alpha\tbeta" },
        { kind: "literal", text: "line1\nline2" },
        { kind: "literal", text: "car\rriage" },
        { kind: "literal", text: "nul\0byte" },
      ];

      const encoded = Array.from(nu.encodeSuggestions(suggestions));
      deepStrictEqual(encoded, [
        "alpha beta\t",
        "\n",
        "line1 line2\t",
        "\n",
        "car riage\t",
        "\n",
        "nul byte\t",
      ]);
    });

    it("should use 2-space indentation in generated script", () => {
      const script = nu.generateScript("myapp");

      // Check that the script uses 2-space indentation
      const lines = script.split("\n");
      const indentedLines = lines.filter((line) =>
        line.startsWith("  ") && !line.startsWith("    ")
      );

      // Should have some lines with 2-space indentation
      deepStrictEqual(indentedLines.length > 0, true);
    });

    it("should handle file completion directive parsing", () => {
      const script = nu.generateScript("myapp");

      // Check that file completion parsing is included
      deepStrictEqual(script.includes("__FILE__:"), true);
      deepStrictEqual(script.includes("split row ':'"), true);
      deepStrictEqual(script.includes("do $list_entries $ls_pattern"), true);
      deepStrictEqual(script.includes("if ($glob_base | is-empty)"), true);
    });

    it("should support context-aware completion", () => {
      const script = nu.generateScript("myapp");

      // Check that context is properly parsed
      deepStrictEqual(script.includes("[context: string]"), true);
      deepStrictEqual(script.includes("$context | args-split"), true);
      // args-split itself marks a trailing unquoted space as a new argument:
      ok(script.includes("$trailing_space"));
    });

    it("should strip tab-delimited metadata before parsing __FILE__ directive", () => {
      const script = nu.generateScript("myapp");

      // In the __FILE__ block, the script must split by tab first to
      // isolate the directive before splitting by colon.  Verify that
      // a tab-stripping split appears between the __FILE__ match and
      // the colon split.
      const fileBlock = script.substring(
        script.indexOf("__FILE__:"),
        script.indexOf("$parts | get 1"),
      );
      ok(fileBlock.includes('split row "\t"'));
    });

    it("should parse hidden field correctly with tab-delimited metadata", (t) => {
      if (!isShellAvailable("nu")) {
        t.skip("nu not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "nu-hidden-completion-"),
      );

      try {
        // CLI that emits __FILE__ with hidden=1 and tab-delimited description,
        // matching the format produced by nu.encodeSuggestions()
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::1\\tConfiguration file\\n'
`;
        const cliPath = join(tempDir, "hidden-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create visible and hidden files
        writeFileSync(join(tempDir, "visible.txt"), "");
        writeFileSync(join(tempDir, ".hidden"), "");

        const script = nu.generateScript("hidden-cli");
        const completions = testNuCompletion(script, "hidden-cli", tempDir);

        // Verify that completions were returned (nu helper may return empty
        // on some environments, so only assert when results are available)
        if (completions.length > 0) {
          ok(completions.some((c) => c.includes("visible.txt")));
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should preserve directory prefix in nested file completions", {
      skip: process.platform === "win32",
    }, (t) => {
      // Bun ignores the skip option, so we need an early return as well:
      if (process.platform === "win32") return;
      if (!isShellAvailable("nu")) {
        t.skip("nu not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "nu-nested-dir-"),
      );

      try {
        // CLI that emits __FILE__:file:::0
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::0\\n'
`;
        const cliPath = join(tempDir, "nested-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create src/ directory with a file inside
        const srcDir = join(tempDir, "src");
        mkdirSync(srcDir, { recursive: true });
        writeFileSync(join(srcDir, "alpha.txt"), "");

        const script = nu.generateScript("nested-cli");

        // Write and run test script with "nested-cli src/" context
        const nuTempDir = mkdtempSync(
          join(tmpdir(), "nu-nested-test-"),
        );
        try {
          const scriptPath = join(nuTempDir, "completion.nu");
          writeFileSync(scriptPath, script);

          const safeName = "nested-cli".replace(/[^a-zA-Z0-9]+/g, "-");
          const functionName = `nu-complete-${safeName}`;
          const testScript = `
$env.PATH = ($env.PATH | prepend "${tempDir}")
source ${scriptPath}

do { ${functionName} "nested-cli src/" }
`;
          const testScriptPath = join(nuTempDir, "test.nu");
          writeFileSync(testScriptPath, testScript);

          const result = runCommand("nu", [testScriptPath], {
            cwd: tempDir,
          });

          const lines = result.trim().split("\n");
          const completions: string[] = [];
          for (const line of lines) {
            const match = line.match(
              /│\s*\d+\s*│\s*([^│]+)\s*│/,
            );
            if (match) {
              const value = match[1]?.trim();
              if (value) completions.push(value);
            }
          }

          ok(
            completions.some((c) => c === "src/alpha.txt"),
            `Expected "src/alpha.txt" in completions, got: ${
              JSON.stringify(completions)
            }`,
          );
        } finally {
          rmSync(nuTempDir, { recursive: true, force: true });
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should not double slash for root-level absolute path prefix", {
      skip: process.platform === "win32",
    }, (t) => {
      // Bun ignores the skip option, so we need an early return as well:
      if (process.platform === "win32") return;
      if (!isShellAvailable("nu")) {
        t.skip("nu not available");
        return;
      }

      const script = nu.generateScript("root-cli");

      // Verify the generated script does not produce "//" for root paths
      // by checking the dir_prefix logic handles parent == "/" correctly
      const nuTempDir = mkdtempSync(
        join(tmpdir(), "nu-root-prefix-"),
      );

      try {
        // CLI that emits __FILE__:any:::0
        const cliScript = `#!/bin/bash
printf '__FILE__:any:::0\\n'
`;
        const cliPath = join(nuTempDir, "root-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        const scriptPath = join(nuTempDir, "completion.nu");
        writeFileSync(scriptPath, script);

        const functionName = "nu-complete-root-cli";
        const testScript = `
$env.PATH = ($env.PATH | prepend "${nuTempDir}")
source ${scriptPath}

do { ${functionName} "root-cli /u" }
`;
        const testScriptPath = join(nuTempDir, "test.nu");
        writeFileSync(testScriptPath, testScript);

        const result = runCommand("nu", [testScriptPath], {
          cwd: nuTempDir,
        });

        const lines = result.trim().split("\n");
        for (const line of lines) {
          const match = line.match(
            /│\s*\d+\s*│\s*([^│]+)\s*│/,
          );
          if (match) {
            const value = match[1]?.trim();
            if (value) {
              ok(
                !value.startsWith("//"),
                `Completion "${value}" has double-slash prefix`,
              );
            }
          }
        }
      } finally {
        rmSync(nuTempDir, { recursive: true, force: true });
      }
    });

    it("should not prefix bare relative path completions with slash", {
      skip: process.platform === "win32",
    }, (t) => {
      // Bun ignores the skip option, so we need an early return as well:
      if (process.platform === "win32") return;
      if (!isShellAvailable("nu")) {
        t.skip("nu not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "nu-bare-prefix-"),
      );

      try {
        // CLI that emits __FILE__:file:::0
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::0\\n'
`;
        const cliPath = join(tempDir, "bare-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create a file that starts with "re"
        writeFileSync(join(tempDir, "readme.txt"), "");

        const script = nu.generateScript("bare-cli");

        const nuTempDir = mkdtempSync(
          join(tmpdir(), "nu-bare-test-"),
        );
        try {
          const scriptPath = join(nuTempDir, "completion.nu");
          writeFileSync(scriptPath, script);

          const functionName = "nu-complete-bare-cli";
          const testScript = `
$env.PATH = ($env.PATH | prepend "${tempDir}")
source ${scriptPath}

do { ${functionName} "bare-cli re" }
`;
          const testScriptPath = join(nuTempDir, "test.nu");
          writeFileSync(testScriptPath, testScript);

          const result = runCommand("nu", [testScriptPath], {
            cwd: tempDir,
          });

          const lines = result.trim().split("\n");
          for (const line of lines) {
            const match = line.match(
              /│\s*\d+\s*│\s*([^│]+)\s*│/,
            );
            if (match) {
              const value = match[1]?.trim();
              if (value) {
                ok(
                  !value.startsWith("/"),
                  `Completion "${value}" should not start with "/"`,
                );
              }
            }
          }
        } finally {
          rmSync(nuTempDir, { recursive: true, force: true });
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should enumerate hidden files without dot prefix when includeHidden is true", (t) => {
      if (!isShellAvailable("nu")) {
        t.skip("nu not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "nu-hidden-no-dot-"),
      );

      try {
        // CLI that emits __FILE__ with hidden=1
        const cliScript = `#!/bin/bash
printf '__FILE__:file:::1\\tConfiguration file\\n'
`;
        const cliPath = join(tempDir, "hidden-cli");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        writeFileSync(join(tempDir, "visible.txt"), "");
        writeFileSync(join(tempDir, ".hidden"), "");

        const script = nu.generateScript("hidden-cli");
        const completions = testNuCompletion(script, "hidden-cli", tempDir);

        if (completions.length === 0) {
          // Fallback: verify the generated script uses ls -a for hidden files
          ok(
            script.includes("ls -a"),
            "Generated Nushell script must enumerate hidden entries with ls -a.",
          );
        } else {
          // With hidden=1, hidden files must be included even without dot prefix
          ok(completions.some((c) => c.includes(".hidden")));
          ok(completions.some((c) => c.includes("visible.txt")));
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should filter files by dot-prefixed extensions in nu", {
      skip: process.platform === "win32",
    }, (t) => {
      // Bun ignores the skip option, so we need an early return as well:
      if (process.platform === "win32") return;
      if (!isShellAvailable("nu")) {
        t.skip("nu not available");
        return;
      }

      const tempDir = mkdtempSync(
        join(tmpdir(), "nu-ext-dot-filter-"),
      );

      try {
        // CLI emits __FILE__ with dot-prefixed extensions (.json,.yaml)
        const cliScript = `#!/bin/bash
printf '__FILE__:file:.json,.yaml::0\\n'
`;
        const cliPath = join(tempDir, "extapp");
        writeFileSync(cliPath, cliScript, { mode: 0o755 });

        // Create test files
        writeFileSync(join(tempDir, "data.json"), "");
        writeFileSync(join(tempDir, "config.yaml"), "");
        writeFileSync(join(tempDir, "readme.txt"), "");
        const subDir = join(tempDir, "subdir");
        mkdirSync(subDir);

        const script = nu.generateScript("extapp");

        const nuTempDir = mkdtempSync(
          join(tmpdir(), "nu-ext-dot-test-"),
        );
        try {
          const scriptPath = join(nuTempDir, "completion.nu");
          writeFileSync(scriptPath, script);

          const safeName = "extapp".replace(/[^a-zA-Z0-9]+/g, "-");
          const functionName = `nu-complete-${safeName}`;
          const testScript = `
$env.PATH = ($env.PATH | prepend "${tempDir}")
source ${scriptPath}

do { ${functionName} "extapp " }
`;
          const testScriptPath = join(nuTempDir, "test.nu");
          writeFileSync(testScriptPath, testScript);

          const result = runCommand("nu", [testScriptPath], {
            cwd: tempDir,
          });

          const lines = result.trim().split("\n");
          const completions: string[] = [];
          for (const line of lines) {
            const match = line.match(
              /│\s*\d+\s*│\s*([^│]+)\s*│/,
            );
            if (match) {
              const value = match[1]?.trim();
              if (value) completions.push(value);
            }
          }

          ok(
            completions.some((c) => c.includes("data.json")),
            `Expected data.json in completions, got: ${
              JSON.stringify(completions)
            }`,
          );
          ok(
            completions.some((c) => c.includes("config.yaml")),
            `Expected config.yaml in completions, got: ${
              JSON.stringify(completions)
            }`,
          );
          ok(
            !completions.some((c) => c.includes("readme.txt")),
            `Should not include readme.txt in completions, got: ${
              JSON.stringify(completions)
            }`,
          );
          ok(
            completions.some((c) => c.includes("subdir")),
            `Expected subdir/ in completions for navigation, got: ${
              JSON.stringify(completions)
            }`,
          );
        } finally {
          rmSync(nuTempDir, { recursive: true, force: true });
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should treat brackets in a typed path literally in nu", {
      skip: process.platform === "win32" || !isShellAvailable("nu"),
    }, (t) => {
      // Bun ignores the skip option, so we need an early return as well:
      if (process.platform === "win32") return;
      if (!isShellAvailable("nu")) {
        t.skip("nu not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "nu-literal-brackets-"));

      try {
        writeFileSync(join(tempDir, "report[1].txt"), "");
        writeFileSync(join(tempDir, "report1.txt"), "");
        writeFileSync(join(tempDir, "a[b.txt"), "");

        deepStrictEqual(
          testNuFileCompletion(tempDir, "report[1]", '"report[1]"'),
          ["'report[1].txt'"],
        );
        // An unclosed bracket must not make the glob invalid:
        deepStrictEqual(
          testNuFileCompletion(tempDir, "a[", '"a["'),
          ["'a[b.txt'"],
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should treat brackets in a directory name literally in nu", {
      skip: process.platform === "win32" || !isShellAvailable("nu"),
    }, (t) => {
      // Bun ignores the skip option, so we need an early return as well:
      if (process.platform === "win32") return;
      if (!isShellAvailable("nu")) {
        t.skip("nu not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "nu-literal-bracket-dir-"));

      try {
        mkdirSync(join(tempDir, "[draft]", "sub"), { recursive: true });
        writeFileSync(join(tempDir, "[draft]", "notes.txt"), "");
        // The completer keeps the typed directory prefix and appends only
        // the matched basename, so the decoy needs a distinct basename to
        // reveal a match inside "d/" via the [draft] character class:
        mkdirSync(join(tempDir, "d"));
        writeFileSync(join(tempDir, "d", "decoy.txt"), "");

        deepStrictEqual(
          testNuFileCompletion(tempDir, "[draft]", '"[draft]"'),
          ["'[draft]/notes.txt'", "'[draft]/sub/'"],
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should keep bracket classes in supplied wildcard patterns in nu", {
      skip: process.platform === "win32" || !isShellAvailable("nu"),
    }, (t) => {
      // Bun ignores the skip option, so we need an early return as well:
      if (process.platform === "win32") return;
      if (!isShellAvailable("nu")) {
        t.skip("nu not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "nu-bracket-class-"));

      try {
        writeFileSync(join(tempDir, "a1.txt"), "");
        writeFileSync(join(tempDir, "b1.txt"), "");
        writeFileSync(join(tempDir, "c1.txt"), "");
        writeFileSync(join(tempDir, "[ab]1.txt"), "");

        // A pattern with * or ? is a glob, as in the other shells, so its
        // [ab] stays a character class:
        deepStrictEqual(
          testNuFileCompletion(tempDir, "[ab]*.txt", ""),
          ["a1.txt", "b1.txt"],
        );
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("should include directories for navigation in file type completion", () => {
      const script = nu.generateScript("filedir-cli");

      // Extract the file case block from the nushell script
      const matchIdx = script.indexOf("match $type");
      const catchIdx = script.indexOf("} catch", matchIdx);
      const fileCase = script.substring(matchIdx, catchIdx);
      const fileCaseBlock = fileCase.substring(
        fileCase.indexOf('"file"'),
        fileCase.indexOf('"directory"'),
      );
      // Should include dir type in both branches
      ok(
        fileCaseBlock.includes("type == dir"),
        "nushell file case should include dir type for navigation.",
      );
      // Narrow to extensions branch specifically
      const extBranch = fileCaseBlock.substring(
        fileCaseBlock.indexOf("ext_list"),
      );
      ok(
        extBranch.includes("type == dir"),
        "nushell file extensions branch should include dir type for navigation.",
      );
    });

    describe("symlinks in actual nu", () => {
      const skip = process.platform === "win32" || !isShellAvailable("nu");

      function withFixtures(test: (workDir: string) => void): void {
        const workDir = mkdtempSync(join(tmpdir(), "nu-symlink-work-"));
        try {
          createNuSymlinkFixtures(workDir);
          test(workDir);
        } finally {
          rmSync(workDir, { recursive: true, force: true });
        }
      }

      it("should complete symlinks by target type in file mode", {
        skip,
      }, () => {
        // Bun ignores the skip option, so we need an early return as well:
        if (skip) return;
        withFixtures((workDir) => {
          deepStrictEqual(
            runNuFileCompletion("__FILE__:file:.txt::0", "link", workDir),
            [
              "link.txt",
              "linkchain/",
              "linkdir/",
              "linkdir2/",
              "linkmixed.txt",
            ],
          );
          deepStrictEqual(
            runNuFileCompletion("__FILE__:file:::0", "link", workDir),
            [
              "link.md",
              "link.txt",
              "linkchain/",
              "linkdir/",
              "linkdir2/",
              "linkmixed.md",
              "linkmixed.txt",
            ],
          );
        });
      });

      it("should complete directory symlinks in directory mode", {
        skip,
      }, () => {
        // Bun ignores the skip option, so we need an early return as well:
        if (skip) return;
        withFixtures((workDir) => {
          deepStrictEqual(
            runNuFileCompletion("__FILE__:directory:::0", "link", workDir),
            ["linkchain/", "linkdir/", "linkdir2/"],
          );
        });
      });

      it("should complete symlinks by target type in any mode", {
        skip,
      }, () => {
        // Bun ignores the skip option, so we need an early return as well:
        if (skip) return;
        withFixtures((workDir) => {
          deepStrictEqual(
            runNuFileCompletion("__FILE__:any:::0", "link", workDir),
            [
              "link.md",
              "link.txt",
              "linkchain/",
              "linkdir/",
              "linkdir2/",
              "linkmixed.md",
              "linkmixed.txt",
            ],
          );
          deepStrictEqual(
            runNuFileCompletion("__FILE__:any:.txt::0", "link", workDir),
            [
              "link.txt",
              "linkchain/",
              "linkdir/",
              "linkdir2/",
              "linkmixed.txt",
            ],
          );
        });
      });

      it("should exclude broken and looping symlinks when filtering", {
        skip,
      }, () => {
        // Bun ignores the skip option, so we need an early return as well:
        if (skip) return;
        withFixtures((workDir) => {
          for (
            const directive of [
              "__FILE__:file:.txt::0",
              "__FILE__:file:::0",
              "__FILE__:directory:::0",
              "__FILE__:any:.txt::0",
            ]
          ) {
            for (const prefix of ["bro", "loop"]) {
              deepStrictEqual(
                runNuFileCompletion(directive, prefix, workDir),
                [],
                `${directive} with prefix ${prefix}`,
              );
            }
          }
          // Unfiltered any mode keeps listing every entry as before:
          deepStrictEqual(
            runNuFileCompletion("__FILE__:any:::0", "bro", workDir),
            ["broken.txt"],
          );
        });
      });

      it("should list a directory symlink's contents for its exact name", {
        skip,
      }, () => {
        // Bun ignores the skip option, so we need an early return as well:
        if (skip) return;
        withFixtures((workDir) => {
          deepStrictEqual(
            runNuFileCompletion("__FILE__:file:.txt::0", "linkdir", workDir),
            ["linkdir/inner.txt"],
          );
        });
      });

      it("should include symlinks in glob pattern completion", {
        skip,
      }, () => {
        // Bun ignores the skip option, so we need an early return as well:
        if (skip) return;
        withFixtures((workDir) => {
          const completions = runNuFileCompletion(
            "__FILE__:file:.txt:*.txt:0",
            "",
            workDir,
          );
          for (const expected of ["link.txt", "linkmixed.txt", "linkdir/"]) {
            ok(
              completions.includes(expected),
              `Expected ${expected} in ${JSON.stringify(completions)}.`,
            );
          }
          ok(
            !completions.includes("broken.txt"),
            `Unexpected broken.txt in ${JSON.stringify(completions)}.`,
          );
        });
      });

      it("should not expand a tilde at the start of a symlink name", {
        skip,
      }, () => {
        // Bun ignores the skip option, so we need an early return as well:
        if (skip) return;
        withFixtures((workDir) => {
          symlinkSync("target.txt", join(workDir, "~draft.txt"));
          // A broken link whose name would expand to the root user's home:
          symlinkSync("missing", join(workDir, "~root"));
          const files = runNuFileCompletion(
            "__FILE__:file:.txt::0",
            "",
            workDir,
          );
          // The name is inserted as ./~draft.txt so that Nushell does not
          // expand the tilde when running the command either:
          ok(
            files.includes("./~draft.txt"),
            `Expected ./~draft.txt in ${JSON.stringify(files)}.`,
          );
          const dirs = runNuFileCompletion(
            "__FILE__:directory:::0",
            "",
            workDir,
          );
          ok(
            !dirs.includes("~root/") && !dirs.includes("./~root/"),
            `Unexpected ~root/ in ${JSON.stringify(dirs)}.`,
          );
        });
      });

      it("should resolve symlinks via .. from a symlinked directory", {
        skip,
      }, () => {
        // Bun ignores the skip option, so we need an early return as well:
        if (skip) return;
        withFixtures((workDir) => {
          // Nushell's cd keeps the logical path, so .. leads back to workDir
          // even though the physical parent of the link's target differs:
          mkdirSync(join(workDir, "physical", "project"), { recursive: true });
          symlinkSync(
            join("physical", "project"),
            join(workDir, "project"),
          );
          const nuCwd = join(workDir, "project");
          deepStrictEqual(
            runNuFileCompletion(
              "__FILE__:directory:::0",
              "../link",
              workDir,
              nuCwd,
            ),
            ["../linkchain/", "../linkdir/", "../linkdir2/"],
          );
          deepStrictEqual(
            runNuFileCompletion(
              "__FILE__:file:.txt::0",
              "../link.",
              workDir,
              nuCwd,
            ),
            ["../link.txt"],
          );
          deepStrictEqual(
            runNuFileCompletion(
              "__FILE__:file:.txt::0",
              "../linkdir",
              workDir,
              nuCwd,
            ),
            ["../linkdir/inner.txt"],
          );
        });
      });

      it("should judge symlink visibility by the link name", {
        skip,
      }, () => {
        // Bun ignores the skip option, so we need an early return as well:
        if (skip) return;
        withFixtures((workDir) => {
          deepStrictEqual(
            runNuFileCompletion("__FILE__:file:.txt::0", "hid/", workDir),
            ["hid/shown.txt"],
          );
          deepStrictEqual(
            runNuFileCompletion("__FILE__:file:.txt::1", "hid/", workDir),
            ["hid/.hidlink.txt", "hid/.secret.txt", "hid/shown.txt"],
          );
        });
      });
    });

    it(
      "should quote literal suggestions that need quoting",
      {
        skip: process.platform === "win32",
      },
      (t) => {
        // Bun ignores the skip option, so we need an early return as well:
        if (process.platform === "win32") return;
        if (!isShellAvailable("nu")) {
          t.skip("nu not available");
          return;
        }

        const quoted: readonly (readonly [string, string])[] = [
          ["a b", "'a b'"],
          ["it's", `"it's"`],
          ['say "hi"', `'say "hi"'`],
          [`it's \\ "q"`, `"it's \\\\ \\"q\\""`],
          ["$HOME", "'$HOME'"],
          ["~tilde", "'~tilde'"],
          ["*.md", "'*.md'"],
          ["...", "'...'"],
          ["=", "'='"],
          ["&&", "'&&'"],
          ["#hash", "'#hash'"],
          ["e>", "'e>'"],
          ["x)y", "'x)y'"],
          ["a|b", "'a|b'"],
          ["[x]", "'[x]'"],
          // The line editor expands history (!!) at a word-initial ! and at
          // a ! after whitespace, even inside quotes:
          ["!!x", "'!!x'"],
          ["m !!", "'m '!'!'"],
          ["it's !b", `"it's "!"b"`],
        ];
        const unquoted = [
          "--verbose",
          "plain",
          "a=b",
          "back\\slash",
          "C:\\foo",
          "-x",
          "1.5",
          "한글",
        ];
        const fixture = createNuQuotingFixture(nuQuotingCli, [
          "a b\tSpaced value",
          ...quoted.slice(1).map(([raw]) => raw),
          "plain\tPlain value",
          ...unquoted.filter((raw) => raw !== "plain"),
        ]);
        try {
          // A file that an unquoted *.md would expand to:
          writeFileSync(join(fixture.workDir, "x.md"), "");
          const records = runNuCompleter(
            fixture,
            `${fixture.programName} --value `,
          );

          deepStrictEqual(
            records.map((record) => [record.value, record.display_override]),
            [
              ...quoted.map(([raw, value]) => [value, raw]),
              ["plain", undefined],
              ...unquoted
                .filter((raw) => raw !== "plain")
                .map((raw) => [raw, undefined]),
            ],
          );
          deepStrictEqual(records[0]?.description, "Spaced value");
          deepStrictEqual(records[quoted.length]?.description, "Plain value");
          // Nushell's own parser must read every inserted value back as
          // exactly one argument with the original text:
          deepStrictEqual(
            parseNuExternalArguments(
              fixture,
              records.map((record) => record.value),
            ),
            records.map((record) => record.display_override ?? record.value),
          );
        } finally {
          rmSync(fixture.tempDir, { recursive: true, force: true });
        }
      },
    );

    it(
      "should quote file suggestions that need quoting",
      {
        skip: process.platform === "win32",
      },
      (t) => {
        // Bun ignores the skip option, so we need an early return as well:
        if (process.platform === "win32") return;
        if (!isShellAvailable("nu")) {
          t.skip("nu not available");
          return;
        }

        const fixture = createNuQuotingFixture(nuQuotingCli);
        try {
          writeFileSync(join(fixture.workDir, "sp ace.txt"), "");
          writeFileSync(join(fixture.workDir, "it's.txt"), "");
          writeFileSync(join(fixture.workDir, "~foo.txt"), "");
          writeFileSync(join(fixture.workDir, "plain.txt"), "");
          mkdirSync(join(fixture.workDir, "my dir"));
          writeFileSync(join(fixture.workDir, "my dir", "inner.txt"), "");
          mkdirSync(join(fixture.workDir, "~dir"));
          writeFileSync(join(fixture.workDir, "~dir", "inner.txt"), "");

          const records = runNuCompleter(
            fixture,
            `${fixture.programName} --file `,
          );
          const byDisplay = new Map(
            records.map((record) => [
              record.display_override ?? record.value,
              record,
            ]),
          );
          deepStrictEqual(byDisplay.get("sp ace.txt")?.value, "'sp ace.txt'");
          deepStrictEqual(byDisplay.get("it's.txt")?.value, `"it's.txt"`);
          // Nushell would expand a leading tilde even in a file name, so
          // the name is spelled relative to the current directory:
          deepStrictEqual(byDisplay.get("~foo.txt")?.value, "./~foo.txt");
          deepStrictEqual(byDisplay.get("~dir/")?.value, "./~dir/");
          deepStrictEqual(byDisplay.get("my dir/")?.value, "'my dir/'");
          deepStrictEqual(byDisplay.get("plain.txt"), { value: "plain.txt" });
          deepStrictEqual(
            [
              ...parseNuExternalArguments(
                fixture,
                records.map((record) => record.value),
              ),
            ].sort(),
            [
              "./~dir/",
              "./~foo.txt",
              "it's.txt",
              "my dir/",
              "plain.txt",
              "sp ace.txt",
            ],
          );

          // Completing inside a quoted directory keeps the result quoted:
          deepStrictEqual(
            runNuCompleter(fixture, `${fixture.programName} --file 'my dir/'`),
            [{
              value: "'my dir/inner.txt'",
              display_override: "my dir/inner.txt",
            }],
          );
          // Completing inside ./~dir/ lists that directory, not a home
          // directory:
          deepStrictEqual(
            runNuCompleter(fixture, `${fixture.programName} --file ./~dir/`),
            [{ value: "./~dir/inner.txt" }],
          );

          // A name made only of dots would be expanded (... is ../..):
          mkdirSync(join(fixture.workDir, "..."));
          deepStrictEqual(
            runNuCompleter(fixture, `${fixture.programName} --any-file `)
              .filter((record) => record.display_override === ".../"),
            [{ value: "'.../'", display_override: ".../" }],
          );
          deepStrictEqual(
            parseNuExternalArguments(fixture, ["'.../'"]),
            [".../"],
          );
        } finally {
          rmSync(fixture.tempDir, { recursive: true, force: true });
        }
      },
    );

    it(
      "should quote home and n-dot paths without losing expansion",
      {
        skip: process.platform === "win32",
      },
      (t) => {
        // Bun ignores the skip option, so we need an early return as well:
        if (process.platform === "win32") return;
        if (!isShellAvailable("nu")) {
          t.skip("nu not available");
          return;
        }

        const fixture = createNuQuotingFixture(nuQuotingCli);
        try {
          const home = join(fixture.tempDir, "home");
          mkdirSync(join(home, "My Docs"), { recursive: true });
          mkdirSync(join(home, "plain"));
          const env = { HOME: home };

          // Quoting would suppress tilde expansion, so the quoted value
          // carries the expanded home directory instead:
          deepStrictEqual(
            runNuCompleter(fixture, `${fixture.programName} --file ~/My`, env),
            [{ value: `'${home}/My Docs/'`, display_override: "~/My Docs/" }],
          );
          // A value that needs no quoting keeps the tilde as typed:
          deepStrictEqual(
            runNuCompleter(fixture, `${fixture.programName} --file ~/pl`, env),
            [{ value: "~/plain/" }],
          );
          deepStrictEqual(
            parseNuExternalArguments(fixture, ["~/plain/"], env),
            [`${home}/plain/`],
          );
          // The decision is made on the text that is inserted, so a typed
          // prefix containing a space is never inserted unquoted:
          deepStrictEqual(
            runNuCompleter(
              fixture,
              `${fixture.programName} --file '~/My Docs/../pl'`,
              env,
            ),
            [{
              value: `${home}/plain/`,
              display_override: "~/My Docs/../plain/",
            }],
          );

          // The same applies to Nushell's n-dot expansion (... is ../..):
          const nested = join(fixture.workDir, "a", "b");
          mkdirSync(nested, { recursive: true });
          mkdirSync(join(fixture.workDir, "My Docs"));
          const contextPath = join(fixture.tempDir, "nested-context.txt");
          writeFileSync(contextPath, `${fixture.programName} --file .../My`);
          const output = runCommand("nu", [
            "--no-config-file",
            "-c",
            `$env.PATH = ($env.PATH | prepend ${
              JSON.stringify(fixture.binDir)
            }); source ${JSON.stringify(fixture.scriptPath)}; ` +
            `nu-complete-${fixture.programName} (open --raw ${
              JSON.stringify(contextPath)
            }) | to json --raw`,
          ], { cwd: nested });
          deepStrictEqual(JSON.parse(output.trim()), [{
            value: `'${fixture.workDir}/My Docs/'`,
            display_override: ".../My Docs/",
          }]);
        } finally {
          rmSync(fixture.tempDir, { recursive: true, force: true });
        }
      },
    );

    it("should not start a new argument at a space inside an open quote", {
      skip: process.platform === "win32",
    }, (t) => {
      // Bun ignores the skip option, so we need an early return as well:
      if (process.platform === "win32") return;
      if (!isShellAvailable("nu")) {
        t.skip("nu not available");
        return;
      }

      const fixture = createNuQuotingFixture(nuArgsEchoCli);
      try {
        const cases: readonly (readonly [string, string])[] = [
          // A space inside an unterminated quote does not start a new
          // argument (e.g., after Nushell inserted the common prefix 'a ):
          [" --value 'a ", "ARGS<--value><a >"],
          [` --value "it's `, "ARGS<--value><it's >"],
          // When the quoted values share no character but the quote, the
          // inserted common prefix is a bare quote, which still starts the
          // value being completed:
          [" --value '", "ARGS<--value><>"],
          [` --value "`, "ARGS<--value><>"],
        ];
        for (const [rest, expected] of cases) {
          const context = `${fixture.programName}${rest}`;
          deepStrictEqual(
            runNuCompleter(fixture, context).map((record) =>
              record.display_override ?? record.value
            ),
            [expected],
            `Context: ${JSON.stringify(context)}`,
          );
        }
      } finally {
        rmSync(fixture.tempDir, { recursive: true, force: true });
      }
    });

    it("should keep tokenizing plain arguments as before", {
      skip: process.platform === "win32",
    }, (t) => {
      // Bun ignores the skip option, so we need an early return as well:
      if (process.platform === "win32") return;
      if (!isShellAvailable("nu")) {
        t.skip("nu not available");
        return;
      }

      const fixture = createNuQuotingFixture(nuArgsEchoCli);
      try {
        const cases: readonly (readonly [string, string])[] = [
          ["", "ARGS<>"],
          [" ", "ARGS<>"],
          [" --value ", "ARGS<--value><>"],
          [" --value a", "ARGS<--value><a>"],
          [" --value 'a b' ", "ARGS<--value><a b><>"],
          [" --value a\\b ", "ARGS<--value><a\\b><>"],
          [" --value 'C:\\foo\\", "ARGS<--value><C:\\foo\\>"],
        ];
        for (const [rest, expected] of cases) {
          const context = `${fixture.programName}${rest}`;
          deepStrictEqual(
            runNuCompleter(fixture, context).map((record) =>
              record.display_override ?? record.value
            ),
            [expected],
            `Context: ${JSON.stringify(context)}`,
          );
        }
      } finally {
        rmSync(fixture.tempDir, { recursive: true, force: true });
      }
    });

    it("should insert quoted suggestions in an interactive Nushell session", {
      skip: !isInteractiveNuCompletionAvailable(),
      timeout: 300_000,
    }, (t) => {
      // Bun ignores the skip option, so we need an early return as well:
      if (!isInteractiveNuCompletionAvailable()) {
        t.skip("interactive nu completion testing not available");
        return;
      }

      const fixture = createNuQuotingFixture(nuQuotingCli, [
        "a b",
        "it's",
        "q'r\\s",
        "!!x",
        "m !!",
        "zz",
      ]);
      try {
        writeFileSync(join(fixture.workDir, "sp ace.txt"), "");
        // The earlier commands also give !! a history entry to expand to:
        const argvs = testInteractiveNuCompletion(fixture, [
          [`${fixture.programName} --value a`, "\t"],
          [`${fixture.programName} --value it`, "\t"],
          [`${fixture.programName} --value q`, "\t"],
          [`${fixture.programName} --file sp`, "\t"],
          [`${fixture.programName} --value !`, "\t"],
          [`${fixture.programName} --value m`, "\t"],
        ]);
        deepStrictEqual(argvs, [
          ["--value", "a b"],
          ["--value", "it's"],
          ["--value", "q'r\\s"],
          ["--file", "sp ace.txt"],
          ["--value", "!!x"],
          ["--value", "m !!"],
        ]);
      } finally {
        rmSync(fixture.tempDir, { recursive: true, force: true });
      }
    });

    it(
      "should complete again after a quoted common prefix",
      {
        skip: !isInteractiveNuCompletionAvailable(),
        timeout: 300_000,
      },
      (t) => {
        // Bun ignores the skip option, so we need an early return as well:
        if (!isInteractiveNuCompletionAvailable()) {
          t.skip("interactive nu completion testing not available");
          return;
        }

        const fixture = createNuQuotingFixture(nuQuotingCli, [
          "a b",
          "a c",
          "q !a",
          "q !b",
        ]);
        try {
          writeFileSync(join(fixture.workDir, "x a"), "");
          writeFileSync(join(fixture.workDir, "x b"), "");
          // The first Tab inserts the common prefix of the quoted values
          // (e.g., 'a followed by a space, 'q '!, or just '); the second Tab must
          // offer the candidates again, and Enter accepts the selected one:
          const cases: readonly (readonly [string, readonly string[]])[] = [
            ["--value a", ["a b", "a c"]],
            ["--file x", ["x a", "x b"]],
            ["--value q", ["q !a", "q !b"]],
            // Only the opening quote is common to all quoted values here:
            ["--value ", ["a b", "a c", "q !a", "q !b"]],
          ];
          const argvs = testInteractiveNuCompletion(
            fixture,
            cases.map(([input]) => [
              `${fixture.programName} ${input}`,
              "\t",
              "\t",
              "\r",
            ]),
          );
          deepStrictEqual(argvs.length, cases.length, JSON.stringify(argvs));
          cases.forEach(([input, candidates], index) => {
            const argv = argvs[index] ?? [];
            deepStrictEqual(argv.length, 2, JSON.stringify(argvs));
            deepStrictEqual(argv[0], input.split(" ")[0]);
            ok(candidates.includes(argv[1] ?? ""), JSON.stringify(argvs));
          });
        } finally {
          rmSync(fixture.tempDir, { recursive: true, force: true });
        }
      },
    );
  });

  describe("ShellCompletion interface", () => {
    it("should implement required methods", () => {
      const shells: ShellCompletion[] = [bash, zsh, fish, nu, pwsh];

      for (const shell of shells) {
        // Check that all required properties exist
        deepStrictEqual(typeof shell.name, "string");
        deepStrictEqual(typeof shell.generateScript, "function");
        deepStrictEqual(typeof shell.encodeSuggestions, "function");

        // Check that methods return expected types
        const script = shell.generateScript("test");
        deepStrictEqual(typeof script, "string");

        const encoded = shell.encodeSuggestions([]);
        deepStrictEqual(Symbol.iterator in encoded, true);
      }
    });
  });

  describe("security: program name validation", () => {
    const shells: ShellCompletion[] = [bash, zsh, fish, nu, pwsh];

    it("should accept valid program names", () => {
      const validNames = [
        "myapp",
        "my-app",
        "my_app",
        "my.app",
        "MyApp123",
        "app_v2.0.1",
        "CLI-tool_v1",
      ];

      for (const shell of shells) {
        for (const name of validNames) {
          // Should not throw
          const script = shell.generateScript(name);
          deepStrictEqual(typeof script, "string");
        }
      }
    });

    it("should reject program names with shell metacharacters", () => {
      const dangerousNames = [
        "app; rm -rf /",
        "$(whoami)",
        "`id`",
        "app|cat /etc/passwd",
        "app && malicious",
        "app || malicious",
        "app > /tmp/file",
        "app < /etc/passwd",
        "app\nmalicious",
        "app\tmalicious",
        "app$HOME",
        "app`id`",
        'app"test',
        "app'test",
        "app\\test",
        "app{a,b}",
        "app[abc]",
        "app*",
        "app?",
        "app!test",
        "app#comment",
        "app%s",
        "app^test",
        "app~test",
        "app:test",
        "app;test",
        "app@test",
        "app=test",
        "app+test",
        "app(test)",
        "app test",
        "app/path",
      ];

      for (const shell of shells) {
        for (const name of dangerousNames) {
          let threw = false;
          try {
            shell.generateScript(name);
          } catch (e) {
            threw = true;
            deepStrictEqual(e instanceof Error, true);
            deepStrictEqual(
              (e as Error).message.includes("Invalid program name"),
              true,
            );
          }
          deepStrictEqual(
            threw,
            true,
            `${shell.name} should reject dangerous program name: ${name}`,
          );
        }
      }
    });

    it("should reject empty program names", () => {
      for (const shell of shells) {
        let threw = false;
        try {
          shell.generateScript("");
        } catch (e) {
          threw = true;
          deepStrictEqual(e instanceof Error, true);
        }
        deepStrictEqual(
          threw,
          true,
          `${shell.name} should reject empty program name`,
        );
      }
    });

    it("should reject program names starting with a hyphen or dot", () => {
      const invalidNames = ["-", ".", "..", "-flag", ".hidden"];

      for (const shell of shells) {
        for (const name of invalidNames) {
          throws(
            () => shell.generateScript(name),
            (e: unknown) =>
              e instanceof Error &&
              e.message.includes(
                "must start with an alphanumeric character or",
              ),
            `${shell.name} should reject program name: ${name}`,
          );
        }
      }
    });
  });
});

// cSpell: ignore CWORD COMPREPLY esac compinit

describe("reserved literal transport markers", () => {
  const shells = [bash, zsh, fish, pwsh, nu];
  const values = [
    "__FILE__:directory:::0",
    "__FILE__:x",
    "__FILE__:",
    "__LITERAL__:",
    "__LITERAL__:__FILE__:directory:::0",
    "__LITERAL__:__LITERAL__:x",
    "__file__:directory:::0",
    "__joined_file__:x:directory:::0",
    "__literal__:x",
    " __FILE__:directory:::0",
    "__FILE__",
    "ordinary",
  ];

  for (const shell of shells) {
    it(`should escape reserved literal markers for ${shell.name}`, () => {
      for (const value of [...values, "__FILE__:\t\n\r\0"]) {
        const sanitized = value.replace(/[\t\n\r\0]/g, " ");
        const escaped = sanitized.startsWith("__FILE__:") ||
            sanitized.startsWith("__LITERAL__:")
          ? `__LITERAL__:${sanitized}`
          : sanitized;
        const encoded = Array.from(shell.encodeSuggestions([{
          kind: "literal",
          text: value,
          description: message`Literal description`,
        }])).join("");
        const expected = shell === bash
          ? escaped
          : shell === zsh
          ? `${escaped}\0Literal description\0`
          : shell === pwsh
          ? `${escaped}\t${sanitized}\tLiteral description`
          : `${escaped}\tLiteral description`;
        deepStrictEqual(encoded, expected);
      }
      // Genuine directives keep their wire representation.
      const encoded = Array.from(shell.encodeSuggestions([{
        kind: "file",
        type: "directory",
      }])).join("");
      const directive = "__FILE__:directory:::0";
      deepStrictEqual(
        encoded,
        shell === bash
          ? directive
          : shell === zsh
          ? `${directive}\0\0`
          : shell === pwsh
          ? `${directive}\t[file]\t`
          : `${directive}\t`,
      );
    });

    const available = process.platform !== "win32" &&
      isShellAvailable(shell.name);
    it(`should round-trip reserved literal markers in ${shell.name}`, {
      skip: !available,
      timeout: 15000,
    }, () => {
      if (!available) return;
      const dir = mkdtempSync(join(tmpdir(), "optique-literal-markers-"));
      try {
        const bin = join(dir, "bin");
        const work = join(dir, "work");
        mkdirSync(bin);
        mkdirSync(work);
        mkdirSync(join(work, "child"));
        const suggestions: Suggestion[] = [
          ...values.slice(0, 6).map((value): Suggestion => ({
            kind: "literal",
            text: value,
            description: message`Literal description`,
          })),
          // Check that the escaped flag is reset for a following directive.
          { kind: "file", type: "directory" },
          ...values.slice(6).map((value): Suggestion => ({
            kind: "literal",
            text: value,
            description: message`Literal description`,
          })),
        ];
        const records = join(bin, "records");
        writeFileSync(
          records,
          // zsh's default stdout writer adds a newline after each chunk.
          Array.from(shell.encodeSuggestions(suggestions)).join(
            shell === zsh ? "\n" : "",
          ) + "\n",
        );
        const prefixRecords = join(bin, "prefix-records");
        writeFileSync(
          prefixRecords,
          Array.from(shell.encodeSuggestions([suggestions[0]])).join("") + "\n",
        );
        writeFileSync(
          join(bin, "markercli"),
          `#!/bin/sh
current=''
for current do :; done
if [ -n "$current" ]; then cat '${prefixRecords}'; else cat '${records}'; fi
`,
          { mode: 0o755 },
        );
        const scriptPath = join(
          bin,
          shell === pwsh ? "completion.ps1" : "completion",
        );
        writeFileSync(scriptPath, shell.generateScript("markercli"));
        for (const prefix of ["", "__"]) {
          let output: string;
          if (shell === bash) {
            output = runCommand("bash", [
              "-c",
              `
export PATH='${bin}':$PATH
source '${scriptPath}'
shopt -s nocasematch
COMP_WORDS=(markercli '${prefix}')
COMP_CWORD=1
_markercli
printf '%s\\n' "\${COMPREPLY[@]}"
`,
            ], { cwd: work });
          } else if (shell === zsh) {
            // _describe receives escaped, colon-delimited fields.  Decode the
            // values in its mock so this test checks literal/file dispatch.
            output = runCommand("zsh", [
              "-fc",
              `
export PATH='${bin}':$PATH
source '${scriptPath}'
_describe() {
  setopt localoptions extendedglob
  local -a match mbegin mend
  local item value
  for item in "\${(@P)2}"; do
    value="\${(M)item##([^:\\\\]|\\\\?)##}"
    print -r -- "\${value//\\\\(#b)(?)/\$match[1]}"
  done
}
_directories() { print -r -- child/; }
words=(markercli '${prefix}')
CURRENT=2
PREFIX='${prefix}'
_markercli
`,
            ], { cwd: work });
          } else if (shell === fish) {
            output = runCommand("fish", [
              "-c",
              `
set -x PATH '${bin}' $PATH
source '${scriptPath}'
complete -C 'markercli ${prefix}'
`,
            ], { cwd: work });
          } else if (shell === pwsh) {
            output = runCommand("pwsh", [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              `$env:PATH = '${bin}:' + $env:PATH
. '${scriptPath}'
[System.Management.Automation.CommandCompletion]::CompleteInput('markercli ${prefix}', ${
                10 + prefix.length
              }, $null).CompletionMatches | ForEach-Object { $_.CompletionText }
`,
            ], { cwd: work });
          } else {
            output = runCommand("nu", [
              "-c",
              `
$env.PATH = ($env.PATH | prepend '${bin}')
source '${scriptPath}'
do $env.config.completions.external.completer ['markercli' '${prefix}'] | get value | str join (char newline)
`,
            ], { cwd: work });
          }
          const actual = output.trimEnd().split(/\r?\n/).map((line) => {
            if (shell === zsh) {
              const value = line.endsWith(":Literal description")
                ? line.slice(0, -":Literal description".length)
                : line;
              return value.replace(/\\([\\:])/g, "$1");
            }
            return line.split("\t")[0];
          });
          const expected = (prefix === "" ? [...values, "child/"] : [values[0]])
            .map((value) =>
              shell === pwsh
                ? value.trim()
                : shell === nu && value.startsWith(" ")
                ? `'${value}'`
                : value
            );
          deepStrictEqual(actual.sort(), expected.sort());
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }

  const bashAvailable = process.platform !== "win32" &&
    isShellAvailable("bash");
  it("should insert a reserved literal marker through Bash Readline", {
    skip: !bashAvailable,
    timeout: 15000,
  }, () => {
    if (!bashAvailable) return;
    const dir = mkdtempSync(join(tmpdir(), "optique-marker-readline-"));
    try {
      const script = join(dir, "completion.bash");
      const literal = "__FILE__:directory:::0";
      writeFileSync(script, bash.generateScript("markercli", ["complete"]));
      const encoded = Array.from(bash.encodeSuggestions([{
        kind: "literal",
        text: literal,
      }])).join("");
      for (const prefix of ["", "__FI"]) {
        const output = runCommand("bash", [
          "--noprofile",
          "--norc",
          "-i",
        ], {
          cwd: dir,
          input: `PS1= PS2=
set +o history
bind 'set enable-bracketed-paste off' 2>/dev/null
bind '"\\C-i": complete'
markercli() { if [ "$1" = complete ]; then printf '%s\\n' '${encoded}'; else printf '%s\\0' "$@"; fi; }
source '${script}'
markercli --value ${prefix}\t
exit
`,
        });
        deepStrictEqual(output.split("\0"), ["--value", literal, ""]);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

const fixedGlobFixtures: Parameters<typeof testInteractiveZshCompletion>[2] = [
  { path: "P (1)", type: "directory" },
  { path: "P (1)/a.cs" },
  { path: "P (1)/a.txt" },
  { path: "~", type: "directory" },
  { path: "~/report.txt" },
  { path: "~/report.json" },
  { path: "~/reports", type: "directory" },
  { path: "C#", type: "directory" },
  { path: "C#/Program.cs" },
  { path: "C#/Program.txt" },
  { path: "fixtures", type: "directory" },
  { path: "fixtures/reports", type: "directory" },
  { path: "fixtures/reports/inside", type: "directory" },
  { path: "fixtures/results", type: "directory" },
  { path: "fixtures/other", type: "directory" },
  { path: "fixtures/.reports", type: "directory" },
  { path: "fixtures/.reports/inner.txt" },
  { path: "fixtures/.reports/inner.json" },
  { path: "fixtures/.reports/.secret.txt" },
  { path: "fixtures/report.txt" },
  { path: "fixtures/report.json" },
  { path: "fixtures/report.text" },
  { path: "fixtures/other.txt" },
  { path: "fixtures/.report.txt" },
  { path: "fixtures/.report.json" },
  { path: "fixtures/reports/inner.txt" },
  { path: "fixtures/reports/inner.json" },
  { path: "fixtures/reports/.secret.txt" },
  { path: "fixtures/relink", type: "symlink", target: "reports" },
  { path: "~report.txt" },
  { path: "report.txt" },
  { path: "report.json" },
  { path: "other.txt" },
  { path: "a(.txt" },
  { path: "a).txt" },
  { path: "a\\.txt" },
  { path: "a#.txt" },
  { path: "a~.txt" },
  { path: "a].txt" },
  { path: "a!(1).txt" },
  { path: "a.(1).txt" },
  { path: "a[(1).txt" },
  { path: "a.1.txt" },
  { path: "a=(1).txt" },
  { path: "a=1.txt" },
  { path: "reports", type: "directory" },
];

function testFixedGlobPrefix(
  shellName: "nu" | "pwsh" | "zsh",
  suggestion: Extract<Suggestion, { readonly kind: "file" }>,
  prefix: string,
  absolutePrefix = false,
): string {
  const shell = { nu, pwsh, zsh }[shellName];
  const directive = Array.from(shell.encodeSuggestions([suggestion])).join("");
  if (shellName === "zsh") {
    return testInteractiveZshCompletion(
      shell.generateScript("extapp"),
      directive.replaceAll("\\", "\\\\").replaceAll("\0", "\\0"),
      fixedGlobFixtures,
      { prefix, absolutePrefix },
    );
  }

  const tempDir = mkdtempSync(join(tmpdir(), "fixed-glob-prefix-"));
  try {
    for (const entry of fixedGlobFixtures) {
      const path = join(tempDir, entry.path);
      if (entry.type === "directory") {
        mkdirSync(path, { recursive: true });
      } else if (entry.type === "symlink") {
        symlinkSync(entry.target, path);
      } else {
        writeFileSync(path, "");
      }
    }
    writeFileSync(
      join(tempDir, "extapp"),
      `#!/bin/bash\nprintf '%s\\n' '${directive.replaceAll("'", "'\\''")}'\n`,
      { mode: 0o755 },
    );
    const current = absolutePrefix ? join(tempDir, prefix) : prefix;
    const completionPath = join(
      tempDir,
      shellName === "nu" ? "completion.nu" : "completion.ps1",
    );
    writeFileSync(completionPath, shell.generateScript("extapp"));
    const scriptPath = join(
      tempDir,
      shellName === "nu" ? "test.nu" : "test.ps1",
    );
    if (shellName === "nu") {
      writeFileSync(
        scriptPath,
        `$env.PATH = ($env.PATH | prepend '${tempDir}')\n` +
          `source '${completionPath}'\n` +
          `nu-complete-extapp 'extapp ${current}' | each {|c| $c.value} | to json\n`,
      );
    } else {
      writeFileSync(
        scriptPath,
        `$env:PATH = '${tempDir}:' + $env:PATH\n` +
          `. '${completionPath}'\n` +
          `$line = 'extapp ${current.replaceAll("'", "''")}'\n` +
          `$result = [System.Management.Automation.CommandCompletion]::CompleteInput($line, $line.Length, $null)\n` +
          `$values = @($result.CompletionMatches | ForEach-Object { $_.CompletionText })\n` +
          `ConvertTo-Json -Compress -InputObject $values\n`,
      );
    }
    const output = runCommand(
      shellName,
      shellName === "nu"
        ? [scriptPath]
        : ["-NoProfile", "-NonInteractive", "-File", scriptPath],
      { cwd: tempDir },
    );
    const values: unknown = JSON.parse(output);
    ok(Array.isArray(values), `Expected completion array: ${output}`);
    return values.map((value: unknown) => {
      ok(typeof value === "string", `Expected completion text: ${output}`);
      return value;
    }).join("\n");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

describe("fixed glob prefix completion", () => {
  const cases: readonly {
    readonly name: string;
    readonly pattern: string;
    readonly prefix: string;
    readonly type?: "file" | "any" | "directory";
    readonly extensions?: readonly string[];
    readonly absolutePrefix?: boolean;
    readonly include: readonly string[];
    readonly exclude: readonly string[];
  }[] = [
    {
      name: "narrowed file glob",
      pattern: "fixtures/*.txt",
      prefix: "fixtures/re",
      include: ["report.txt", "reports/", "results/"],
      exclude: ["report.json", "report.text", "other.txt", "other/"],
    },
    {
      name: "any-mode navigation including directory links",
      pattern: "fixtures/*.txt",
      prefix: "fixtures/re",
      type: "any",
      include: ["report.txt", "reports/", "relink"],
      exclude: ["report.json", "report.text", "other.txt"],
    },
    {
      name: "directory-equal prefix",
      pattern: "fixtures/*.txt",
      prefix: "fixtures/",
      include: ["report.txt", "other.txt", "reports/"],
      exclude: ["report.json", "report.text", ".report.txt"],
    },
    {
      name: "bare glob",
      pattern: "*.txt",
      prefix: "re",
      include: ["report.txt", "reports/"],
      exclude: ["report.json", "other.txt"],
    },
    {
      name: "absolute prefix for bare glob",
      pattern: "*.txt",
      prefix: "re",
      absolutePrefix: true,
      include: ["report.txt", "reports/"],
      exclude: ["report.json", "other.txt"],
    },
    {
      name: "leading ./ prefix",
      pattern: "fixtures/*.txt",
      prefix: "./fixtures/re",
      include: ["report.txt", "reports/"],
      exclude: ["report.json", "other.txt"],
    },
    {
      name: "question-mark glob",
      pattern: "fixtures/r?port.txt",
      prefix: "fixtures/re",
      include: ["report.txt", "reports/"],
      exclude: ["report.json", "report.text"],
    },
    {
      name: "extension intersection",
      pattern: "fixtures/*.t*",
      prefix: "fixtures/re",
      extensions: ["text"],
      include: ["report.text", "reports/"],
      exclude: ["report.txt", "report.json"],
    },
    {
      name: "glob in a directory segment",
      pattern: "fixtures/*/inner.txt",
      prefix: "fixtures/reports/in",
      include: ["inner.txt", "inside/"],
      exclude: ["inner.json"],
    },
    {
      name: "descendant navigation without matching files",
      pattern: "fixtures/*.txt",
      prefix: "fixtures/reports/in",
      include: ["inside/"],
      exclude: ["inner.txt", "inner.json"],
    },
    {
      name: "dot-prefixed input",
      pattern: "fixtures/*.txt",
      prefix: "fixtures/.re",
      include: [".report.txt", ".reports/"],
      exclude: [".report.json"],
    },
    {
      name: "literal directory pattern control",
      pattern: "fixtures/",
      prefix: "fixtures/re",
      include: ["report.txt", "report.json", "reports/"],
      exclude: ["other.txt"],
    },
    {
      name: "echoed prefix control",
      pattern: "fixtures/re",
      prefix: "fixtures/re",
      include: ["report.txt", "report.json", "reports/"],
      exclude: ["other.txt"],
    },
    {
      name: "directory-only behavior control",
      pattern: "fixtures/reports*",
      prefix: "fixtures/re",
      type: "directory",
      include: ["reports/", "results/"],
      exclude: ["report.txt", "report.json"],
    },
  ];
  for (const shell of ["nu", "pwsh", "zsh"] as const) {
    const available = process.platform !== "win32" &&
      (shell === "zsh"
        ? isInteractiveZshCompletionAvailable()
        : isShellAvailable(shell));
    for (const scenario of cases) {
      it(`${shell}: ${scenario.name}`, { skip: !available }, () => {
        // Bun ignores skip, so keep the early return as well.
        if (!available) return;
        const output = testFixedGlobPrefix(
          shell,
          {
            kind: "file",
            type: scenario.type ?? "file",
            pattern: scenario.pattern,
            extensions: scenario.extensions,
          },
          scenario.prefix,
          scenario.absolutePrefix,
        );
        for (const value of scenario.include) {
          ok(output.includes(value), `Expected ${value}:\n${output}`);
        }
        for (const value of scenario.exclude) {
          ok(!output.includes(value), `Unexpected ${value}:\n${output}`);
        }
      });
    }
  }
});

it("PowerShell fixed glob after directory normalization", {
  skip: process.platform === "win32" || !isShellAvailable("pwsh"),
}, () => {
  if (process.platform === "win32" || !isShellAvailable("pwsh")) return;
  const output = testFixedGlobPrefix("pwsh", {
    kind: "file",
    type: "file",
    pattern: "fixtures/*.txt",
  }, "fixtures/reports");
  ok(output.includes("inside/"), `Expected navigation directory:\n${output}`);
  ok(!output.includes("inner.txt"), `Unexpected descendant file:\n${output}`);
  ok(!output.includes("inner.json"), `Unexpected descendant file:\n${output}`);
});

it("zsh fixed glob retains literal hash in directories", {
  skip: process.platform === "win32" || !isInteractiveZshCompletionAvailable(),
}, () => {
  if (process.platform === "win32" || !isInteractiveZshCompletionAvailable()) {
    return;
  }
  const output = testFixedGlobPrefix("zsh", {
    kind: "file",
    type: "file",
    pattern: "C#/*.cs",
  }, "C#/P");
  ok(output.includes("Program.cs"), `Expected fixed-glob match:\n${output}`);
  ok(
    !output.includes("Program.txt"),
    `Unexpected nonmatching file:\n${output}`,
  );
});

it("Nu fixed glob preserves literal tilde filenames", {
  skip: process.platform === "win32" || !isShellAvailable("nu"),
}, () => {
  if (process.platform === "win32" || !isShellAvailable("nu")) return;
  const output = testFixedGlobPrefix("nu", {
    kind: "file",
    type: "file",
    pattern: "*.txt",
  }, "re");
  ok(output.includes("report.txt"), `Expected fixed match:\n${output}`);
  ok(!output.includes("report.json"), `Unexpected nonmatch:\n${output}`);
});

it("Nu fixed glob preserves literal tilde directories", {
  skip: process.platform === "win32" || !isShellAvailable("nu"),
}, () => {
  if (process.platform === "win32" || !isShellAvailable("nu")) return;
  const output = testFixedGlobPrefix(
    "nu",
    {
      kind: "file",
      type: "file",
      pattern: "*/*.txt",
    },
    "~/re",
    true,
  );
  ok(output.includes("report.txt"), `Expected fixed match:\n${output}`);
  ok(output.includes("reports/"), `Expected navigation directory:\n${output}`);
  ok(!output.includes("report.json"), `Unexpected nonmatch:\n${output}`);
});

it("zsh fixed glob preserves negated character classes", {
  skip: process.platform === "win32" || !isInteractiveZshCompletionAvailable(),
}, () => {
  if (process.platform === "win32" || !isInteractiveZshCompletionAvailable()) {
    return;
  }
  const output = testFixedGlobPrefix("zsh", {
    kind: "file",
    type: "file",
    pattern: "fixtures/[^o]*.txt",
  }, "fixtures/re");
  ok(output.includes("report.txt"), `Expected negated-class match:\n${output}`);
  ok(
    !output.includes("other.txt"),
    `Unexpected negated-class match:\n${output}`,
  );
  ok(!output.includes("report.json"), `Unexpected extension:\n${output}`);
});

it("zsh fixed glob preserves quoted parenthesized directories", {
  skip: process.platform === "win32" || !isInteractiveZshCompletionAvailable(),
}, () => {
  if (process.platform === "win32" || !isInteractiveZshCompletionAvailable()) {
    return;
  }
  const output = testFixedGlobPrefix("zsh", {
    kind: "file",
    type: "file",
    pattern: "P (1)/*.cs",
  }, "'P (1)/a");
  ok(output.includes("a.cs"), `Expected quoted match:\n${output}`);
  ok(!output.includes("a.txt"), `Unexpected nonmatch:\n${output}`);
});

it("zsh fixed glob preserves whitespace with SH_WORD_SPLIT", {
  skip: process.platform === "win32" || !isShellAvailable("zsh"),
}, () => {
  if (process.platform === "win32" || !isShellAvailable("zsh")) return;
  const tempDir = mkdtempSync(join(tmpdir(), "zsh-fixed-glob-word-split-"));
  try {
    mkdirSync(join(tempDir, "P (1)"));
    writeFileSync(join(tempDir, "P (1)/a.cs"), "");
    writeFileSync(join(tempDir, "P (1)/a.txt"), "");
    const directive = Array.from(zsh.encodeSuggestions([{
      kind: "file",
      type: "file",
      pattern: "P (1)/*.cs",
    }])).join("").replaceAll("\\", "\\\\").replaceAll("\0", "\\0");
    writeFileSync(
      join(tempDir, "extapp"),
      `#!/bin/bash\nprintf '${directive}'\n`,
      { mode: 0o755 },
    );
    const scriptPath = join(tempDir, "completion.zsh");
    writeFileSync(scriptPath, zsh.generateScript("extapp"));
    // _main_complete normally disables SH_WORD_SPLIT.  Call the generated
    // function directly to exercise callers that retain this option, while
    // the native expansion still runs in zsh rather than a string assertion.
    const output = runCommand("zsh", [
      "-fc",
      `
export PATH="${tempDir}:$PATH"
compdef() { :; }
source "${scriptPath}"
_tags() { print -rl -- "\${__fixed_matches[@]}"; return 1; }
words=(extapp 'P (1)/a')
CURRENT=2
PREFIX='P (1)/a'
setopt extended_glob sh_word_split sh_glob
_extapp
[[ -o sh_word_split && -o sh_glob ]] || exit 1
`,
    ], { cwd: tempDir });
    ok(output.includes("a.cs"), `Expected quoted match:\n${output}`);
    ok(!output.includes("a.txt"), `Unexpected nonmatch:\n${output}`);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

for (const pattern of ["*[()#~].txt", "*[]()#~].txt"]) {
  it(`zsh fixed glob preserves literal metacharacters in classes: ${pattern}`, {
    skip: process.platform === "win32" ||
      !isInteractiveZshCompletionAvailable(),
  }, () => {
    if (
      process.platform === "win32" || !isInteractiveZshCompletionAvailable()
    ) {
      return;
    }
    const output = testFixedGlobPrefix("zsh", {
      kind: "file",
      type: "file",
      pattern,
    }, "a");
    for (const name of ["a(.txt", "a).txt", "a#.txt", "a~.txt"]) {
      const escapedName = name.replace(/([()#~])/g, "\\$1");
      ok(
        output.includes(escapedName),
        `Expected class match ${name}:\n${output}`,
      );
    }
    if (pattern.includes("[]")) {
      ok(
        output.includes("a\\].txt"),
        `Expected leading closing bracket:\n${output}`,
      );
    }
    ok(!output.includes("a\\\\.txt"), `Unexpected backslash match:\n${output}`);
  });
}

it("zsh fixed glob matches explicitly typed hidden parents", {
  skip: process.platform === "win32" || !isInteractiveZshCompletionAvailable(),
}, () => {
  if (process.platform === "win32" || !isInteractiveZshCompletionAvailable()) {
    return;
  }
  const output = testFixedGlobPrefix("zsh", {
    kind: "file",
    type: "file",
    pattern: "fixtures/*/*.txt",
  }, "fixtures/.reports/in");
  ok(output.includes("inner.txt"), `Expected hidden-parent match:\n${output}`);
  ok(!output.includes("inner.json"), `Unexpected extension:\n${output}`);
});

it("zsh fixed glob preserves a lone class negation character", {
  skip: process.platform === "win32" || !isInteractiveZshCompletionAvailable(),
}, () => {
  if (process.platform === "win32" || !isInteractiveZshCompletionAvailable()) {
    return;
  }
  const output = testFixedGlobPrefix("zsh", {
    kind: "file",
    type: "file",
    pattern: "*[!](1).txt",
  }, "a!");
  ok(
    output.includes("a\\!\\(1\\).txt"),
    `Expected literal-class match:\n${output}`,
  );
  ok(!output.includes("a\\\\.txt"), `Unexpected backslash match:\n${output}`);
});

for (
  const scenario of [
    {
      pattern: "fixtures/*.txt",
      prefix: "./fixtures/",
      label: "relative parent",
      include: "report.txt",
      exclude: ".report.txt",
      includeHidden: false,
    },
    {
      pattern: "fixtures/.reports/*.txt",
      prefix: "fixtures/.reports/",
      label: "hidden parent",
      include: "inner.txt",
      exclude: ".secret.txt",
      includeHidden: false,
    },
    {
      pattern: "fixtures/.reports/*.txt",
      prefix: "fixtures/.reports/",
      label: "explicit hidden children",
      include: ".secret.txt",
      exclude: "inner.json",
      includeHidden: true,
    },
  ]
) {
  it(`zsh fixed glob keeps hidden-child policy: ${scenario.label}`, {
    skip: process.platform === "win32" ||
      !isInteractiveZshCompletionAvailable(),
  }, () => {
    if (
      process.platform === "win32" || !isInteractiveZshCompletionAvailable()
    ) {
      return;
    }
    const output = testFixedGlobPrefix("zsh", {
      kind: "file",
      type: "file",
      pattern: scenario.pattern,
      includeHidden: scenario.includeHidden,
    }, scenario.prefix);
    ok(output.includes(scenario.include), `Expected visible match:\n${output}`);
    ok(
      !output.includes(scenario.exclude),
      `Unexpected hidden child:\n${output}`,
    );
  });
}

for (const member of [".", "="]) {
  it(`zsh fixed glob preserves literal bracket members: ${member}`, {
    skip: process.platform === "win32" ||
      !isInteractiveZshCompletionAvailable(),
  }, () => {
    if (
      process.platform === "win32" || !isInteractiveZshCompletionAvailable()
    ) {
      return;
    }
    const output = testFixedGlobPrefix("zsh", {
      kind: "file",
      type: "file",
      pattern: `*[[${member}](1).txt`,
    }, "a");
    ok(
      output.includes(`a${member}\\(1\\).txt`),
      `Expected literal parentheses:\n${output}`,
    );
    ok(
      output.includes("a\\[\\(1\\).txt"),
      `Expected bracket member:\n${output}`,
    );
    ok(
      !output.includes(`a${member}1.txt`),
      `Unexpected glob group match:\n${output}`,
    );
  });
}

for (
  const scenario of [
    {
      name: "typed hidden parent",
      prefix: "fixtures/.reports/in",
      hidden: false,
      include: ["inner.txt"],
      exclude: ["inner.json", ".secret.txt"],
    },
    {
      name: "relative typed hidden parent",
      prefix: "./fixtures/.reports/in",
      hidden: false,
      include: ["inner.txt"],
      exclude: ["inner.json"],
    },
    {
      name: "hidden parent without hidden children",
      prefix: "fixtures/.reports/",
      hidden: false,
      include: ["inner.txt"],
      exclude: ["inner.json", ".secret.txt"],
    },
    {
      name: "explicit hidden child",
      prefix: "fixtures/.reports/.s",
      hidden: false,
      include: [".secret.txt"],
      exclude: ["inner.txt"],
    },
    {
      name: "included hidden children",
      prefix: "fixtures/.reports/",
      hidden: true,
      include: ["inner.txt", ".secret.txt"],
      exclude: ["inner.json"],
    },
  ]
) {
  it(`Nu fixed glob ${scenario.name}`, {
    skip: process.platform === "win32" || !isShellAvailable("nu"),
  }, () => {
    if (process.platform === "win32" || !isShellAvailable("nu")) return;
    const output = testFixedGlobPrefix("nu", {
      kind: "file",
      type: "file",
      pattern: "fixtures/*/*.txt",
      includeHidden: scenario.hidden,
    }, scenario.prefix);
    for (const value of scenario.include) {
      ok(output.includes(value), `Expected ${value}:\n${output}`);
    }
    for (const value of scenario.exclude) {
      ok(!output.includes(value), `Unexpected ${value}:\n${output}`);
    }
  });
}

for (
  const prefix of [
    "'fixtures/re",
    '"fixtures/re',
    "'fixtures/re'",
    '"fixtures/re"',
  ]
) {
  it(`PowerShell fixed glob with quoted prefix ${prefix}`, {
    skip: process.platform === "win32" || !isShellAvailable("pwsh"),
  }, () => {
    if (process.platform === "win32" || !isShellAvailable("pwsh")) return;
    const output = testFixedGlobPrefix("pwsh", {
      kind: "file",
      type: "file",
      pattern: "fixtures/*.txt",
    }, prefix);
    ok(output.includes("report.txt"), `Expected fixed match:\n${output}`);
    ok(!output.includes("report.json"), `Unexpected nonmatch:\n${output}`);
  });
}

for (const includeHidden of [false, true]) {
  it(
    `PowerShell fixed glob in a hidden parent (includeHidden: ${includeHidden})`,
    {
      skip: process.platform === "win32" || !isShellAvailable("pwsh"),
    },
    () => {
      if (process.platform === "win32" || !isShellAvailable("pwsh")) return;
      for (const prefix of ["fixtures/.reports/in", "fixtures/reports/"]) {
        const output = testFixedGlobPrefix("pwsh", {
          kind: "file",
          type: "file",
          pattern: "fixtures/*/*.txt",
          extensions: ["txt"],
          includeHidden,
        }, prefix);
        ok(output.includes("inner.txt"), `Expected fixed match:\n${output}`);
        ok(!output.includes("inner.json"), `Unexpected nonmatch:\n${output}`);
        if (prefix.endsWith("/")) {
          if (includeHidden) {
            ok(
              output.includes(".secret.txt"),
              `Expected hidden child:\n${output}`,
            );
          } else {ok(
              !output.includes(".secret.txt"),
              `Unexpected hidden child:\n${output}`,
            );}
        }
      }
    },
  );
}

it("zsh fixed glob retains regular files and ordered tag fallback", {
  skip: !isInteractiveZshCompletionAvailable() || !isShellAvailable("mkfifo"),
  timeout: 10000,
}, () => {
  if (!isInteractiveZshCompletionAvailable() || !isShellAvailable("mkfifo")) {
    return;
  }
  const directive = Array.from(zsh.encodeSuggestions([{
    kind: "file",
    type: "file",
    pattern: "*.txt",
  }]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");
  for (const firstTag of [undefined, "files", "directories"]) {
    const output = testInteractiveZshCompletion(
      zsh.generateScript("extapp"),
      directive,
      [
        { path: "report.txt" },
        { path: "report.json" },
        { path: "report-link.txt", type: "symlink", target: "report.txt" },
        { path: "report-pipe.txt", type: "fifo" },
        { path: "reports", type: "directory" },
      ],
      {
        prefix: "re",
        setup: firstTag == null
          ? ""
          : `zstyle ':completion:*' tag-order '${firstTag}' '${
            firstTag === "files" ? "directories" : "files"
          }'`,
      },
    );
    ok(!output.includes("report.json"), output);
    ok(!output.includes("report-pipe.txt"), output);
    if (firstTag === "directories") {
      ok(output.includes("reports/"), output);
      ok(!output.includes("report.txt"), output);
    } else {
      ok(output.includes("report.txt"), output);
      ok(output.includes("report-link.txt"), output);
      if (firstTag == null) ok(output.includes("reports/"), output);
      else ok(!output.includes("reports/"), output);
    }
  }
});

describe("zsh fixed glob fignore", () => {
  for (
    const scenario of [
      {
        name: "fixed glob bypasses automatic suffix ignores",
        pattern: "*.txt",
        extensions: undefined,
        setup: "fignore=(.txt)",
        include: ["report.txt", "result.skip.txt", "reports/"],
        exclude: ["report.json"],
      },
      {
        name: "extension filtering bypasses automatic suffix ignores",
        pattern: "*.txt",
        extensions: ["txt"],
        setup: "fignore=(.txt)",
        include: ["report.txt", "result.skip.txt", "reports/"],
        exclude: ["report.json"],
      },
      {
        name: "fixed glob retains explicit tag ignore patterns",
        pattern: "*.txt",
        extensions: undefined,
        setup:
          "fignore=(.txt)\nzstyle ':completion:*:files' ignored-patterns '*skip*'",
        include: ["report.txt", "reports/"],
        exclude: ["report.json", "result.skip.txt"],
      },
      {
        name: "bare star retains automatic suffix ignores",
        pattern: "*",
        extensions: undefined,
        setup: "fignore=(.txt)",
        include: ["report.json", "reports/"],
        exclude: ["report.txt", "result.skip.txt"],
      },
      {
        name: "unfiltered prefix retains automatic suffix ignores",
        pattern: "re",
        extensions: undefined,
        setup: "fignore=(.txt)",
        include: ["report.json", "reports/"],
        exclude: ["report.txt", "result.skip.txt"],
      },
    ]
  ) {
    it(scenario.name, {
      skip: !isInteractiveZshCompletionAvailable(),
      timeout: 10000,
    }, () => {
      if (!isInteractiveZshCompletionAvailable()) return;
      const directive = Array.from(zsh.encodeSuggestions([{
        kind: "file",
        type: "file",
        pattern: scenario.pattern,
        extensions: scenario.extensions,
      }]))[0].replaceAll("\\", "\\\\").replaceAll("\0", "\\0");
      const output = testInteractiveZshCompletion(
        zsh.generateScript("extapp"),
        directive,
        [
          { path: "report.txt" },
          { path: "result.skip.txt" },
          { path: "report.json" },
          { path: "reports", type: "directory" },
        ],
        { prefix: "re", setup: scenario.setup },
      );
      for (const candidate of scenario.include) {
        ok(output.includes(candidate), `Expected ${candidate}:\n${output}`);
      }
      for (const candidate of scenario.exclude) {
        ok(!output.includes(candidate), `Unexpected ${candidate}:\n${output}`);
      }
    });
  }
});
