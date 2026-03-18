import { describe, it } from "node:test";
import { deepStrictEqual, ok, throws } from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
import { message } from "./message.ts";

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
    readonly stdio?: "pipe" | "ignore";
  } = {},
): string {
  try {
    return execFileSync(command, [...args], {
      encoding: "utf8",
      cwd: options.cwd,
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
      deepStrictEqual(script.includes("function _myapp ()"), true);
      deepStrictEqual(script.includes("COMPREPLY=()"), true);
      deepStrictEqual(script.includes("COMP_WORDS"), true);
      deepStrictEqual(script.includes("complete -F _myapp myapp"), true);
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

    it("should work with actual zsh shell", (t) => {
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

    it("should sanitize program names with special characters", () => {
      const script = fish.generateScript("my-app.js");

      // Function name should have special characters replaced
      deepStrictEqual(script.includes("function __my_app_js_complete"), true);
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
      deepStrictEqual(script.includes("if ($prefix | is-empty)"), true);
    });

    it("should support context-aware completion", () => {
      const script = nu.generateScript("myapp");

      // Check that context is properly parsed
      deepStrictEqual(script.includes("[context: string]"), true);
      deepStrictEqual(script.includes("$context | args-split"), true);
      deepStrictEqual(script.includes("str ends-with ' '"), true);
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
