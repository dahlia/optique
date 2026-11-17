import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("hook installation", () => {
  it("should initialize the driver when only its display name is configured", async () => {
    await mkdir(join(root, "tmp"), { recursive: true });
    const dir = await mkdtemp(join(root, "tmp/hook-name-only-"));
    try {
      const globalConfig = join(dir, "global-git-config");
      await writeFile(globalConfig, "");
      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: globalConfig,
        GIT_CONFIG_NOSYSTEM: "1",
      };
      command("git", ["init"], dir, env);
      command(
        "git",
        ["config", "core.hooksPath", join(dir, ".git/hooks")],
        dir,
        env,
      );
      command("git", ["config", "merge.sacho.name", "Sacho"], dir, env);
      await copyFile(join(root, "sacho.toml"), join(dir, "sacho.toml"));

      command("node", [join(root, "scripts/install_hooks.ts")], dir, env);

      const driver = command(
        "git",
        ["config", "--get", "merge.sacho.driver"],
        dir,
        env,
      );
      assert.match(driver, /merge-driver/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should install hooks in a worktree without replacing existing hooks", async () => {
    await mkdir(join(root, "tmp"), { recursive: true });
    const dir = await mkdtemp(join(root, "tmp/hook-install-"));
    try {
      command("git", ["init", dir], root);
      const hooks = join(dir, ".git/hooks");
      // Isolate this fixture from any user-level core.hooksPath configuration.
      command("git", ["config", "core.hooksPath", hooks], dir);
      command("git", [
        "config",
        "merge.sacho.driver",
        "custom-driver %O %A %B",
      ], dir);
      command("git", [
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.com",
        "commit",
        "--allow-empty",
        "-m",
        "Fixture",
      ], dir);
      const worktree = join(dir, "worktree");
      command("git", ["worktree", "add", "-b", "fixture", worktree], dir);
      const existing = "#!/bin/sh\n# User-owned hook\n";
      await writeFile(join(hooks, "commit-msg"), existing);
      command("node", [join(root, "scripts/install_hooks.ts")], worktree);
      assert.equal(await readFile(join(hooks, "commit-msg"), "utf8"), existing);
      const preCommit = await readFile(join(hooks, "pre-commit"), "utf8");
      assert.match(preCommit, /mise run check/);
      assert.match(
        await readFile(join(hooks, "reference-transaction"), "utf8"),
        /sacho hook-reference-transaction/,
      );
      command("node", [join(root, "scripts/install_hooks.ts")], worktree);
      assert.equal(
        await readFile(join(hooks, "pre-commit"), "utf8"),
        preCommit,
      );
      assert.equal(
        command("git", ["config", "--get", "merge.sacho.driver"], worktree),
        "custom-driver %O %A %B",
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Helpers

function command(
  binary: string,
  args: readonly string[],
  cwd: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const result = spawnSync(binary, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}
