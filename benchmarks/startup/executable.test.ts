import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveExecutable } from "./executable.ts";

const testRoot = fileURLToPath(
  new URL("../../tmp/startup-tests/", import.meta.url),
);

describe("resolveExecutable", () => {
  it("should find an executable wrapper outside system directories", {
    skip: process.platform === "win32",
  }, () => {
    if (process.platform === "win32") return;
    mkdirSync(testRoot, { recursive: true });
    const root = mkdtempSync(join(testRoot, "executable-"));
    try {
      const first = join(root, "first"),
        second = join(root, "nonstandard", "bin");
      mkdirSync(first);
      mkdirSync(second, { recursive: true });
      writeFileSync(join(first, "git"), "not executable");
      chmodSync(join(first, "git"), 0o644);
      const executable = join(second, "git");
      writeFileSync(executable, "#!/bin/sh\nexit 0\n");
      chmodSync(executable, 0o755);
      assert.equal(
        resolveExecutable("git", [first, second].join(delimiter)),
        executable,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("should skip directories and preserve an argv[0]-dispatching symlink", {
    skip: process.platform === "win32",
  }, () => {
    if (process.platform === "win32") return;
    mkdirSync(testRoot, { recursive: true });
    const root = mkdtempSync(join(testRoot, "executable-link-"));
    try {
      const first = join(root, "first"), second = join(root, "second");
      mkdirSync(join(first, "git"), { recursive: true });
      mkdirSync(second);
      const target = join(root, "real-git");
      writeFileSync(
        target,
        '#!/bin/sh\ncase "$0" in */git) printf "revision\\n";; *) exit 64;; esac\n',
      );
      chmodSync(target, 0o755);
      symlinkSync(target, join(second, "git"));
      const executable = resolveExecutable(
        "git",
        [first, second].join(delimiter),
      );
      const result = spawnSync(executable, ["rev-parse", "HEAD"], {
        encoding: "utf8",
      });
      assert.equal(result.status, 0);
      assert.equal(result.stdout, "revision\n");
      assert.equal(executable, join(second, "git"));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("should report a missing executable before trying to use it", () => {
    assert.throws(
      () =>
        resolveExecutable(
          "missing-optique-test-command",
          join(testRoot, "absent"),
        ),
      /executable.*PATH/i,
    );
  });
});
