import assert from "node:assert/strict";
import { type Commit, createSignature } from "es-git";
import { describe, it } from "node:test";
import process from "node:process";
import {
  colors,
  formatAddedFile,
  formatCommitCreated,
  formatCommitDetailed,
  formatCommitOneline,
  formatDiffNameOnly,
  formatDiffNameStatus,
  formatDiffStat,
  formatDiffStats,
  formatError,
  formatFilePath,
  formatStatusLong,
  formatSuccess,
  formatTimestamp,
  formatWarning,
  stripColors,
  supportsColors,
} from "./formatters.ts";

describe("gitique formatters", () => {
  it("formats commit summaries and detailed commit output", () => {
    const commit = fakeCommit({
      message: "Fix parser\n\nBody text",
      name: "Jane Doe",
      email: "jane@example.com",
      timestamp: 1_704_067_200,
    });

    assert.equal(
      formatCommitOneline("abcdef1234567890", commit),
      `${colors.yellow}abcdef1${colors.reset} Fix parser`,
    );
    assert.equal(
      formatCommitDetailed("abcdef1234567890", commit),
      [
        `${colors.yellow}commit abcdef1234567890${colors.reset}`,
        "Author: Jane Doe <jane@example.com>",
        "Date:   2024-01-01T00:00:00.000Z",
        "",
        "    Fix parser",
        "    ",
        "    Body text",
        "",
      ].join("\n"),
    );
  });

  it("formats basic colored messages and strips color codes", () => {
    assert.equal(
      formatAddedFile("src/main.ts"),
      `${colors.green}add${colors.reset} 'src/main.ts'`,
    );
    assert.equal(
      formatCommitCreated("abcdef1234567890", "Initial commit\n\nBody", "main"),
      `[main ${colors.yellow}abcdef1${colors.reset}] Initial commit`,
    );
    assert.equal(formatError("bad"), `${colors.red}error:${colors.reset} bad`);
    assert.equal(
      formatWarning("careful"),
      `${colors.yellow}warning:${colors.reset} careful`,
    );
    assert.equal(formatSuccess("done"), `${colors.green}done${colors.reset}`);
    assert.equal(
      formatFilePath("src/main.ts"),
      `${colors.cyan}src/main.ts${colors.reset}`,
    );
    assert.equal(
      stripColors(`${colors.red}error:${colors.reset} bad`),
      "error: bad",
    );
  });

  it("formats status and diff entries", () => {
    assert.equal(
      formatStatusLong("src/main.ts", "Modified", true),
      `${colors.green}        modified:   src/main.ts${colors.reset}`,
    );
    assert.equal(
      formatStatusLong("src/new.ts", "Renamed", false, "src/old.ts"),
      `${colors.red}        renamed:   src/old.ts -> src/new.ts${colors.reset}`,
    );
    assert.equal(formatDiffNameOnly("src/main.ts"), "src/main.ts");
    assert.equal(
      formatDiffNameStatus("src/main.ts", "Modified"),
      "M\tsrc/main.ts",
    );
    assert.equal(
      formatDiffNameStatus("src/new.ts", "Renamed", "src/old.ts"),
      "R\tsrc/old.ts\tsrc/new.ts",
    );
    assert.equal(
      formatDiffNameStatus("src/odd.ts", "Unknown"),
      "?\tsrc/odd.ts",
    );
  });

  it("formats diff statistics with singular and plural wording", () => {
    assert.equal(
      stripColors(formatDiffStats(1, 1, 1)),
      "1 file changed, 1 insertion(+), 1 deletion(-)",
    );
    assert.equal(
      stripColors(formatDiffStats(2, 3, 4)),
      "2 files changed, 3 insertions(+), 4 deletions(-)",
    );
    assert.equal(stripColors(formatDiffStats(0, 0, 0)), "");
  });

  it("formats diff stat bars proportionally", () => {
    assert.equal(
      stripColors(formatDiffStat("src/main.ts", 3, 1, 4)),
      " src/main.ts | 4 +++-",
    );
    assert.equal(
      stripColors(formatDiffStat("src/delete.ts", 0, 2, 10)),
      " src/delete.ts | 2 --",
    );
  });

  it("formats timestamps using the runtime locale", () => {
    assert.equal(
      formatTimestamp(new Date("2024-01-01T00:00:00.000Z")),
      new Date("2024-01-01T00:00:00.000Z").toLocaleString(),
    );
  });

  it("detects color support from TTY and environment flags", () => {
    const originalTerm = process.env.TERM;
    const originalNoColor = process.env.NO_COLOR;
    const stdoutDescriptor = Object.getOwnPropertyDescriptor(
      process.stdout,
      "isTTY",
    );

    try {
      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        value: true,
      });
      process.env.TERM = "xterm-256color";
      delete process.env.NO_COLOR;
      assert.ok(supportsColors());

      process.env.NO_COLOR = "1";
      assert.ok(!supportsColors());

      delete process.env.NO_COLOR;
      process.env.TERM = "dumb";
      assert.ok(!supportsColors());

      Object.defineProperty(process.stdout, "isTTY", {
        configurable: true,
        value: false,
      });
      process.env.TERM = "xterm-256color";
      assert.ok(!supportsColors());
    } finally {
      if (stdoutDescriptor == null) {
        delete (process.stdout as { isTTY?: boolean }).isTTY;
      } else {
        Object.defineProperty(process.stdout, "isTTY", stdoutDescriptor);
      }
      if (originalTerm === undefined) {
        delete process.env.TERM;
      } else {
        process.env.TERM = originalTerm;
      }
      if (originalNoColor === undefined) {
        delete process.env.NO_COLOR;
      } else {
        process.env.NO_COLOR = originalNoColor;
      }
    }
  });
});

function fakeCommit(options: {
  readonly message: string;
  readonly name: string;
  readonly email: string;
  readonly timestamp: number;
}): Commit {
  const signature = createSignature(options.name, options.email, {
    timestamp: options.timestamp,
    offset: 0,
  });
  return {
    id: () => "abcdef1234567890",
    message: () => options.message,
    author: () => signature,
    committer: () => signature,
    summary: () => options.message.split("\n")[0],
    body: () => null,
    time: () => new Date(options.timestamp * 1000),
    tree: () => {
      throw new Error("tree not needed.");
    },
    asObject: () => {
      throw new Error("object not needed.");
    },
    authorWithMailmap: (
      _mailmap: Parameters<Commit["authorWithMailmap"]>[0],
    ) => signature,
    committerWithMailmap: (
      _mailmap: Parameters<Commit["committerWithMailmap"]>[0],
    ) => signature,
  };
}
