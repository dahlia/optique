import { describe, it } from "node:test";
import { deepStrictEqual } from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
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
function isShellAvailable(shell: string): boolean {
  try {
    // Try multiple methods to detect shell availability
    execSync(`${shell} --version`, { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    try {
      execSync(`which ${shell}`, { stdio: "ignore", timeout: 5000 });
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

    const result = execSync(`bash -c '${testScript}'`, {
      encoding: "utf8",
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
    execSync(`zsh -c '${testScript}'`, {
      encoding: "utf8",
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

    const result = execSync(
      `pwsh -NoProfile -NonInteractive -Command "${
        testScript.replace(/"/g, '\\"').replace(/\$/g, "\\$")
      }"`,
      {
        encoding: "utf8",
        cwd: tempDir,
      },
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

    const result = execSync(
      `fish "${testScriptPath}" 2>/dev/null || true`,
      {
        encoding: "utf8",
        cwd: tempDir,
      },
    );

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
      result = execSync(
        `nu "${testScriptPath}"`,
        {
          encoding: "utf8",
          cwd: tempDir,
        },
      );
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
  });
});

// cSpell: ignore CWORD COMPREPLY esac compinit
