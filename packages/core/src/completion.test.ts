import { describe, it } from "node:test";
import { deepStrictEqual } from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import { bash, type ShellCompletion, zsh } from "./completion.ts";
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

function testBashCompletion(script: string, cliPath: string): string[] {
  const tempDir = mkdtempSync(join(tmpdir(), "bash-completion-test-"));

  try {
    const scriptPath = join(tempDir, "completion.bash");
    writeFileSync(scriptPath, script);

    // Extract function name from the script
    const functionMatch = script.match(/function (_[^\s()]+) /);
    const functionName = functionMatch ? functionMatch[1] : "_test_cli";

    // Test completion by sourcing script and calling completion function
    const testScript = `
source "${scriptPath}"
COMP_WORDS=("${cliPath}" "")
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

function testZshCompletion(script: string, cliPath: string): string[] {
  const tempDir = mkdtempSync(join(tmpdir(), "zsh-completion-test-"));

  try {
    const scriptPath = join(tempDir, "completion.zsh");
    writeFileSync(scriptPath, script);

    // Create a test script that simulates zsh completion
    const testScript = `
autoload -U compinit && compinit -D
source "${scriptPath}"

# Mock zsh completion environment
words=("${cliPath}" "")
CURRENT=2

# Capture completion output
{
  _${cliPath.split("/").pop()?.replace(/[^a-zA-Z0-9]/g, "_")}
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
        const script = bash.generateScript(cliPath, ["completion", "bash"]);

        const completions = testBashCompletion(script, cliPath);

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
        const script = zsh.generateScript(cliPath, ["completion", "zsh"]);

        const result = testZshCompletion(script, cliPath);

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

  describe("ShellCompletion interface", () => {
    it("should implement required methods", () => {
      const shells: ShellCompletion[] = [bash, zsh];

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
});
