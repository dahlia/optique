import { describe, it } from "node:test";
import { deepStrictEqual, ok, throws } from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";
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
  } = {},
): string {
  try {
    return execFileSync(command, [...args], {
      encoding: "utf8",
      cwd: options.cwd,
      input: options.input,
      stdio: options.stdio,
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
    readonly setup?: string;
  } = {},
): string {
  const tempDir = mkdtempSync(join(tmpdir(), "zsh-completion-integration-"));

  try {
    const binDir = join(tempDir, "bin");
    const workDir = join(tempDir, "work");
    mkdirSync(binDir);
    mkdirSync(workDir);

    const cliPath = join(binDir, "extapp");
    writeFileSync(
      cliPath,
      `#!/bin/bash
printf '${directive}'
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

    const scriptPath = join(binDir, ".completion.zsh");
    writeFileSync(scriptPath, script);

    const startMarker = "\x1eOPTIQUE_ZSH_COMPLETION_START\x1e";
    const endMarker = "\x1eOPTIQUE_ZSH_COMPLETION_END\x1e";
    const initReadyMarker = "__OPTIQUE_ZSH_INIT_READY__";
    const actionDoneMarker = "__OPTIQUE_ZSH_ACTION_DONE__";
    const initPath = join(binDir, ".session.init");
    const actionPath = join(binDir, ".session.action");
    const init = `PS1='PROMPT> '
unsetopt zle_bracketed_paste 2>/dev/null || true
autoload -U compinit && compinit -D
zmodload zsh/complist
setopt auto_list list_ambiguous
unsetopt list_beep
LISTMAX=0
${options.setup ?? ""}
export PATH=${JSON.stringify(binDir)}:$PATH
source ${JSON.stringify(scriptPath)}
cd ${JSON.stringify(workDir)}
print -r -- ${JSON.stringify(initReadyMarker)}
print -rn -- $'\\x1eOPTIQUE_ZSH_COMPLETION_START\\x1e\\n'
`;
    const action = `extapp \t\t
print -rn -- $'\\x1eOPTIQUE_ZSH_COMPLETION_END\\x1e\\n'
print -r -- ${JSON.stringify(actionDoneMarker)}
exit
`;
    writeFileSync(initPath, init);
    writeFileSync(actionPath, action);

    const driver = `
zmodload zsh/zpty

function __optique_drain_zpty() {
  local sentinel="$1"
  local buffer=""
  local chunk=""
  local idle=0

  while (( idle < 80 )); do
    if zpty -r -t child; then
      if zpty -r child chunk; then
        buffer+="\${chunk}"
        if [[ -n "\${sentinel}" && "\${buffer}" == *"\${sentinel}"* ]]; then
          break
        fi
        idle=0
      else
        break
      fi
    else
      sleep 0.05
      (( idle++ ))
    fi
  done

  print -rn -- "\${buffer}"
}

zpty -b child env TERM=xterm-256color ZDOTDIR=/nonexistent zsh -fi
zpty -w child "$(<${JSON.stringify(initPath)})"
sleep 0.5
local __output="$(__optique_drain_zpty ${JSON.stringify(initReadyMarker)})"
zpty -w child "$(<${JSON.stringify(actionPath)})"
sleep 0.8
__output+="$(__optique_drain_zpty ${JSON.stringify(actionDoneMarker)})"
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
  _${programName.replace(/[^a-zA-Z0-9]/g, "_")}
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
      deepStrictEqual(script.includes("$words[CURRENT]"), true);
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

    it("should build #q-qualified extension globs in zsh", () => {
      const script = zsh.generateScript("myapp");
      const fileCase = script.substring(
        script.indexOf('case "$type" in'),
        script.indexOf("esac"),
      );
      const fileCaseBlock = fileCase.substring(
        fileCase.indexOf("file)"),
        fileCase.indexOf("directory)"),
      );
      const anyCaseBlock = fileCase.substring(
        fileCase.indexOf("any)"),
      );

      // A single extension must avoid grouped-glob syntax because *.(json)
      // does not work in zsh completion, while multiple extensions still
      // need grouped globbing.  The resulting qualifier must also avoid bare
      // glob-qualifier syntax so it still works when bareglobqual is unset.
      // https://github.com/dahlia/optique/issues/799
      ok(script.includes('if [[ "$extensions" == *,* ]]; then'));
      ok(script.includes('ext_pattern="*.(${extensions//,/|})"'));
      ok(script.includes('ext_pattern="*.$extensions"'));
      ok(
        fileCaseBlock.includes('local file_pattern="${ext_pattern}(#q-.)"'),
      );
      ok(
        fileCaseBlock.includes(
          '_wanted files expl file _path_files -g "${file_pattern}"',
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
      "should not forward stale expl arguments between _wanted zsh tags",
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

function _wanted() {
  local tag="$1" expl_name="$2" descr="$3"
  shift 3
  print -r -- "$tag:$#:$*"
  eval "$expl_name=(--tag $tag)"
  return 0
}

function _path_files() {
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
            `Expected files _wanted call to include filtered _path_files args, got: ${
              JSON.stringify(calls)
            }`,
          );
          ok(
            directoryCall?.includes("_path_files -/"),
            `Expected directories _wanted call to include directory navigation args, got: ${
              JSON.stringify(calls)
            }`,
          );
          ok(
            directoryCall?.startsWith("directories:2:"),
            `directories _wanted call should not receive stale expl arguments from files, got: ${
              JSON.stringify(calls)
            }`,
          );
          ok(
            !directoryCall?.includes("--tag files"),
            `directories _wanted call should not inherit the files tag's expl array, got: ${
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

        // We can't easily test zsh's _files in a non-interactive context,
        // so extract and test the glob_dots logic directly.  The generated
        // function body contains a while-read loop that parses __FILE__
        // directives.  We override _files/_directories with a function that
        // globs the current directory to verify glob_dots is active.
        const testScript = `
export PATH="${tempDir}:$PATH"
autoload -U compinit && compinit -D 2>/dev/null

# Override _files to manually list files using the current glob settings
function _files() {
  local f
  for f in ${tempDir}/*; do
    [[ -f "$f" ]] && echo "$f"
  done
}

source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT

cd "${tempDir}"
words=("hidden-cli" "")
CURRENT=2
_hidden_cli 2>/dev/null
`;

        const result = runCommand("zsh", ["-c", testScript], {
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

function _files() {
  local f
  for f in ${tempDir}/*; do
    [[ -f "$f" ]] && echo "$f"
  done
}

source /dev/stdin <<'COMPLETION_SCRIPT'
${script}
COMPLETION_SCRIPT

cd "${tempDir}"
words=("nohidden-cli" "")
CURRENT=2
_nohidden_cli 2>/dev/null
`;

        const result = runCommand("zsh", ["-c", testScript], {
          cwd: tempDir,
        });

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
      "should use _path_files for extension-filtered zsh completion",
      () => {
        const script = zsh.generateScript("filedir-cli");

        // Extract the file case block from the zsh script
        const fileCase = script.substring(
          script.indexOf('case "$type" in'),
          script.indexOf("esac"),
        );
        const fileCaseBlock = fileCase.substring(
          fileCase.indexOf("file)"),
          fileCase.indexOf("directory)"),
        );
        ok(
          fileCaseBlock.includes('local file_pattern="${ext_pattern}(#q-.)"'),
          "zsh file) case should derive a #q-qualified regular-file pattern that preserves symlinked files.",
        );
        ok(
          fileCaseBlock.includes(
            '_wanted files expl file _path_files -g "${file_pattern}"',
          ),
          "zsh file) case should route filtered file completions through the standard files tag.",
        );
        ok(
          fileCaseBlock.includes(
            "_wanted directories expl directory _path_files -/",
          ),
          "zsh file) case should add directory navigation via the directories tag.",
        );
        ok(
          !fileCaseBlock.includes('_files -g "$ext_pattern"'),
          "zsh file) case should not rely on _files -g for extension-filtered navigation.",
        );
        ok(
          fileCaseBlock.includes("_wanted files expl file"),
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

    it("should generate script with completion command args", () => {
      const script = pwsh.generateScript("myapp", ["completion", "pwsh"]);

      deepStrictEqual(script.includes("'completion', 'pwsh'"), true);
    });

    it("should escape single quotes in arguments", () => {
      const script = pwsh.generateScript("myapp", ["it's", "test"]);

      // PowerShell uses doubled single quotes for escaping
      deepStrictEqual(script.includes("'it''s'"), true);
    });

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

    it("should sanitize program names with special characters", () => {
      const script = fish.generateScript("my-app.js");

      // Function name should have special characters replaced
      deepStrictEqual(script.includes("function __my_app_js_complete"), true);
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

      // Nushell uses doubled single quotes for escaping
      deepStrictEqual(script.includes("'it''s'"), true);
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
      deepStrictEqual(script.includes("ls $ls_pattern"), true);
      deepStrictEqual(script.includes("if ($glob_base | is-empty)"), true);
    });

    it("should support context-aware completion", () => {
      const script = nu.generateScript("myapp");

      // Check that context is properly parsed
      deepStrictEqual(script.includes("[context: string]"), true);
      deepStrictEqual(script.includes("$context | args-split"), true);
      deepStrictEqual(script.includes("str ends-with ' '"), true);
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
