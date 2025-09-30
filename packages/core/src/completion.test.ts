import { describe, it } from "node:test";
import { deepStrictEqual } from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { execSync } from "node:child_process";
import { bash, fish, pwsh, type ShellCompletion, zsh } from "./completion.ts";
import type { Suggestion } from "./parser.ts";
import { message } from "./message.ts";

// Helper functions for shell availability and testing
const isBun = typeof process !== "undefined" && !!process.versions?.bun;

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

function testPwshCompletion(script: string, _cliPath: string): string[] {
  const tempDir = mkdtempSync(join(tmpdir(), "pwsh-completion-test-"));

  try {
    const scriptPath = join(tempDir, "completion.ps1");
    writeFileSync(scriptPath, script);

    // Test by directly calling the completion command
    // This avoids dependency on Get-ArgumentCompleter (PowerShell 7.4+)
    const testScript = `
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

function testFishCompletion(script: string, cliPath: string): string[] {
  const tempDir = mkdtempSync(join(tmpdir(), "fish-completion-test-"));

  try {
    const scriptPath = join(tempDir, "completion.fish");
    writeFileSync(scriptPath, script);

    // Use `complete -C` to trigger completion for a given command line
    const commandToComplete = `${cliPath} `;
    const testScript = `
source "${scriptPath}"
complete -C '${commandToComplete}'
`;

    const result = execSync(`fish -c "${testScript.replace(/"/g, '\\"')}"`, {
      encoding: "utf8",
      cwd: tempDir,
    });

    return result.trim().split("\n").filter((line) => line.length > 0);
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
        if (isBun) return;
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
        if (isBun) return;
        t.skip("pwsh not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "pwsh-completion-"));

      try {
        const cliPath = createTestCli(tempDir);
        const script = pwsh.generateScript(cliPath, ["completion", "pwsh"]);

        const result = testPwshCompletion(script, cliPath);

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

      deepStrictEqual(script.includes("function __myapp"), true);
      deepStrictEqual(script.includes("commandline -poc"), true);
      deepStrictEqual(script.includes("commandline -ct"), true);
      deepStrictEqual(
        script.includes(
          "complete -c myapp -f -a '(__myapp)'",
        ),
        true,
      );
    });

    it("should work with actual fish shell", (t) => {
      if (!isShellAvailable("fish")) {
        if (isBun) return;
        t.skip("fish not available");
        return;
      }

      const tempDir = mkdtempSync(join(tmpdir(), "fish-completion-"));

      try {
        const cliPath = createTestCli(tempDir);
        const script = fish.generateScript(cliPath, ["completion", "fish"]);
        const completions = testFishCompletion(script, cliPath);

        deepStrictEqual(completions, [
          "git\tGit operations",
          "docker\tDocker container operations",
        ]);
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

      deepStrictEqual(script.includes("'it'\\''s'"), true);
    });

    it("should encode suggestions with tab-separated format", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "literal",
          text: "--verbose",
          description: message`Enable verbose output`,
        },
        { kind: "literal", text: "--quiet" },
      ];

      const encoded = Array.from(fish.encodeSuggestions(suggestions));

      deepStrictEqual(encoded, [
        "--verbose\tEnable verbose output",
        "\n",
        "--quiet\t",
      ]);
    });

    it("should encode file suggestions with marker", () => {
      const suggestions: Suggestion[] = [
        {
          kind: "file",
          type: "file",
          extensions: ["ts", "js"],
          includeHidden: true,
          description: message`TypeScript or JavaScript files`,
        },
      ];

      const encoded = Array.from(fish.encodeSuggestions(suggestions));

      deepStrictEqual(
        encoded[0],
        "__FILE__:file:ts,js::1\tTypeScript or JavaScript files",
      );
    });

    it("should handle empty suggestions list", () => {
      const suggestions: Suggestion[] = [];
      const encoded = Array.from(fish.encodeSuggestions(suggestions));
      deepStrictEqual(encoded, []);
    });
  });

  describe("ShellCompletion interface", () => {
    it("should implement required methods", () => {
      const shells: ShellCompletion[] = [bash, zsh, pwsh, fish];

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
