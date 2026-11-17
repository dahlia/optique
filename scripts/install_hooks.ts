import { spawnSync } from "node:child_process";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

const preCommit = command("mise", [
  "generate",
  "git-pre-commit",
  "--task=check",
]);
const hooks = {
  "pre-commit": preCommit,
  "commit-msg": '#!/bin/sh\nsacho hook-commit-msg "$1"\n',
  "reference-transaction": `#!/bin/sh
if test "$1" = prepared; then
  sacho_state=$(git rev-parse --git-path sacho-commit-state) || exit $?
  if test -f "$sacho_state"; then
    sacho hook-reference-transaction "$1"
  fi
fi
`,
};

for (const [name, content] of Object.entries(hooks)) {
  // Git resolves linked worktrees and core.hooksPath; .git need not be a directory.
  const path = command("git", ["rev-parse", "--git-path", `hooks/${name}`])
    .trim();
  await mkdir(dirname(path), { recursive: true });
  try {
    // Never replace user hooks (or follow an existing hook symlink).
    await writeFile(path, content, { flag: "wx", mode: 0o755 });
    if (process.platform !== "win32") await chmod(path, 0o755);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "EEXIST") {
      console.error(`Kept existing Git hook: ${path}`);
    } else {
      throw error;
    }
  }
}

// Sacho init rewrites its merge-driver configuration.  Leave an existing
// local or inherited driver alone, including a contributor's custom driver.
const sachoConfig = spawnSync("git", [
  "config",
  "--get",
  "merge.sacho.driver",
], { encoding: "utf8", timeout: 10_000 });
if (sachoConfig.error) throw sachoConfig.error;
if (sachoConfig.status === 1) {
  command("sacho", ["init", "--no-interactive"]);
} else if (sachoConfig.status !== 0) {
  throw new Error(
    `Failed to read Sacho Git configuration: ${sachoConfig.stderr}`,
  );
}

function command(binary: string, args: readonly string[]): string {
  const result = spawnSync(binary, args, { encoding: "utf8", timeout: 10_000 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Failed to run ${binary}: ${result.stderr}`);
  }
  return result.stdout;
}
