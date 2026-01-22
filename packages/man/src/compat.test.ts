/**
 * Compatibility tests for man/groff rendering.
 *
 * These tests verify that the generated man pages can be rendered by
 * actual man or groff commands. They are skipped on systems where
 * these commands are not available (e.g., Windows).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import process from "node:process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatDocPageAsMan } from "./man.ts";
import { generateManPage } from "./generator.ts";
import { object } from "@optique/core/constructs";
import { argument, flag, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import type { DocPage } from "@optique/core/doc";

/**
 * Check if groff command is available.
 */
function isGroffAvailable(): boolean {
  try {
    const result = spawnSync("groff", ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

/**
 * Check if man command is available.
 */
function isManAvailable(): boolean {
  try {
    const result = spawnSync("man", ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

const hasGroff = isGroffAvailable();
const hasMan = isManAvailable();

describe("man/groff compatibility", () => {
  // Create a comprehensive man page for testing
  const page: DocPage = {
    brief: message`A sample CLI application for testing`,
    usage: [
      { type: "option", names: ["--verbose", "-v"] },
      { type: "option", names: ["--config", "-c"], metavar: "FILE" },
      { type: "argument", metavar: "INPUT" },
    ],
    description:
      message`This is a sample application that demonstrates the man page generation capabilities of @optique/man.

It supports multiple options and arguments, and can be used as a reference for testing the roff output.`,
    sections: [
      {
        title: "Options",
        entries: [
          {
            term: { type: "option", names: ["--verbose", "-v"] },
            description:
              message`Enable verbose output. This will print additional debugging information to stderr.`,
          },
          {
            term: {
              type: "option",
              names: ["--config", "-c"],
              metavar: "FILE",
            },
            description:
              message`Path to the configuration file. If not specified, defaults to ~/.myapprc.`,
            default: message`~/.myapprc`,
          },
          {
            term: {
              type: "option",
              names: ["--output", "-o"],
              metavar: "FILE",
            },
            description: message`Output file path. Use - for stdout.`,
          },
        ],
      },
      {
        title: "Arguments",
        entries: [
          {
            term: { type: "argument", metavar: "INPUT" },
            description: message`Input file to process.`,
          },
        ],
      },
    ],
  };

  const options = {
    name: "myapp",
    section: 1 as const,
    version: "1.0.0",
    date: "January 2026",
    manual: "User Commands",
    author: message`Hong Minhee <hong@minhee.org>`,
    bugs: message`Report bugs at https://github.com/dahlia/optique/issues`,
    seeAlso: [
      { name: "git", section: 1 },
      { name: "make", section: 1 },
    ],
  };

  it("should be parseable by groff", { skip: !hasGroff }, () => {
    // Bun에서는 skip 옵션이 무시되므로 early return 필요
    if (!hasGroff) return;

    const manPage = formatDocPageAsMan(page, options);

    const result = spawnSync("groff", ["-man", "-Tutf8", "-w", "all"], {
      input: manPage,
      encoding: "utf-8",
      timeout: 10000,
    });

    // groff should exit with status 0
    assert.equal(
      result.status,
      0,
      `groff failed with status ${result.status}:\n${result.stderr}`,
    );

    // Output should not be empty
    assert.ok(
      result.stdout.length > 0,
      "groff output should not be empty",
    );

    // Output should contain the program name
    assert.ok(
      result.stdout.includes("myapp") || result.stdout.includes("MYAPP"),
      "groff output should contain program name",
    );
  });

  it("should be renderable by man command", { skip: !hasMan }, () => {
    // Bun에서는 skip 옵션이 무시되므로 early return 필요
    if (!hasMan) return;

    const manPage = formatDocPageAsMan(page, options);

    // Create temporary file
    const tmpDir = mkdtempSync(join(tmpdir(), "optique-man-test-"));
    const tmpFile = join(tmpDir, "myapp.1");

    try {
      writeFileSync(tmpFile, manPage, "utf-8");

      const result = spawnSync("man", ["-l", tmpFile], {
        encoding: "utf-8",
        timeout: 10000,
        env: {
          ...process.env,
          MANPAGER: "cat", // Disable pager for testing
          PAGER: "cat",
        },
      });

      // man should exit with status 0
      assert.equal(
        result.status,
        0,
        `man failed with status ${result.status}:\n${result.stderr}`,
      );

      // Output should contain the program name
      assert.ok(
        result.stdout.includes("myapp") || result.stdout.includes("MYAPP"),
        "man output should contain program name",
      );
    } finally {
      // Clean up
      try {
        unlinkSync(tmpFile);
        rmdirSync(tmpDir);
      } catch {
        // Ignore cleanup errors
      }
    }
  });

  it(
    "should render parser-generated man page with groff",
    { skip: !hasGroff },
    () => {
      // Bun에서는 skip 옵션이 무시되므로 early return 필요
      if (!hasGroff) return;

      const parser = object({
        verbose: flag("-v", "--verbose", {
          description: message`Enable verbose output.`,
        }),
        config: option("-c", "--config", string({ metavar: "FILE" }), {
          description: message`Path to configuration file.`,
        }),
        port: option("-p", "--port", integer(), {
          description: message`Port to listen on.`,
        }),
        input: argument(string({ metavar: "INPUT" }), {
          description: message`Input file to process.`,
        }),
      });

      const manPage = generateManPage(parser, {
        name: "testapp",
        section: 1,
        version: "2.0.0",
        date: new Date(2026, 0, 22),
        author: message`Test Author`,
      });

      const result = spawnSync("groff", ["-man", "-Tutf8"], {
        input: manPage,
        encoding: "utf-8",
        timeout: 10000,
      });

      assert.equal(
        result.status,
        0,
        `groff failed:\n${result.stderr}`,
      );

      assert.ok(result.stdout.length > 0);
    },
  );

  it(
    "should handle special characters correctly in groff",
    { skip: !hasGroff },
    () => {
      // Bun에서는 skip 옵션이 무시되므로 early return 필요
      if (!hasGroff) return;

      // Test page with special characters that need escaping
      const specialPage: DocPage = {
        brief: message`Application with special characters`,
        description: message`This description contains special roff characters:
.period at line start
'quote at line start
And backslash: \\path\\to\\file`,
        sections: [
          {
            title: "Options",
            entries: [
              {
                term: { type: "option", names: ["--file"] },
                description: message`File path like C:\\Users\\name\\file.txt`,
              },
            ],
          },
        ],
      };

      const manPage = formatDocPageAsMan(specialPage, {
        name: "special",
        section: 1,
      });

      const result = spawnSync("groff", ["-man", "-Tutf8", "-w", "all"], {
        input: manPage,
        encoding: "utf-8",
        timeout: 10000,
      });

      // Should not have any groff errors
      assert.equal(
        result.status,
        0,
        `groff failed with special characters:\n${result.stderr}`,
      );
    },
  );

  it(
    "should handle empty sections correctly in groff",
    { skip: !hasGroff },
    () => {
      // Bun에서는 skip 옵션이 무시되므로 early return 필요
      if (!hasGroff) return;

      const minimalPage: DocPage = {
        sections: [],
      };

      const manPage = formatDocPageAsMan(minimalPage, {
        name: "minimal",
        section: 1,
      });

      const result = spawnSync("groff", ["-man", "-Tutf8"], {
        input: manPage,
        encoding: "utf-8",
        timeout: 10000,
      });

      assert.equal(result.status, 0);
    },
  );

  it(
    "should handle all section types correctly in groff",
    { skip: !hasGroff },
    () => {
      // Bun에서는 skip 옵션이 무시되므로 early return 필요
      if (!hasGroff) return;

      const fullPage: DocPage = {
        brief: message`Full featured application`,
        usage: [
          { type: "command", name: "build" },
          { type: "option", names: ["--verbose"] },
        ],
        description: message`A complete application with all features.`,
        sections: [
          {
            title: "Commands",
            entries: [
              {
                term: { type: "command", name: "build" },
                description: message`Build the project.`,
              },
              {
                term: { type: "command", name: "test" },
                description: message`Run tests.`,
              },
            ],
          },
        ],
        footer: message`For more information, visit https://optique.dev/`,
      };

      const manPage = formatDocPageAsMan(fullPage, {
        name: "fullapp",
        section: 1,
        version: "3.0.0",
        date: "February 2026",
        manual: "Developer Tools",
        author: message`The Optique Team`,
        bugs: message`https://github.com/dahlia/optique/issues`,
        examples: message`Build the project:\n\n  fullapp build --verbose`,
        seeAlso: [{ name: "npm", section: 1 }],
        environment: {
          entries: [
            {
              term: { type: "argument", metavar: "FULLAPP_CONFIG" },
              description: message`Path to configuration file.`,
            },
          ],
        },
        exitStatus: {
          entries: [
            {
              term: { type: "literal", value: "0" },
              description: message`Success.`,
            },
            {
              term: { type: "literal", value: "1" },
              description: message`General error.`,
            },
          ],
        },
      });

      const result = spawnSync("groff", ["-man", "-Tutf8"], {
        input: manPage,
        encoding: "utf-8",
        timeout: 10000,
      });

      assert.equal(
        result.status,
        0,
        `groff failed with full page:\n${result.stderr}`,
      );

      // Verify content is present
      assert.ok(result.stdout.includes("FULLAPP"));
      assert.ok(result.stdout.includes("Build the project"));
    },
  );
});
