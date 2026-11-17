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
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("check_versions", () => {
  it("should check matching versions and preserve bytes on a no-op fix", async () => {
    await fixture(async (dir) => {
      const path = join(dir, "packages/core/deno.json");
      const before = await readFile(path);
      const npmPath = join(dir, "packages/core/package.json");
      const npmBefore = '{ "version": "1.2.3", "private": false }\n\n';
      await writeFile(npmPath, npmBefore);
      assert.equal(run(dir).status, 0);
      assert.equal(run(dir, "--fix").status, 0);
      assert.deepEqual(await readFile(path), before);
      assert.equal(await readFile(npmPath, "utf8"), npmBefore);
    });
  });

  it("should show help under Node", async () => {
    await fixture((dir) => {
      for (const flag of ["--help", "-h"]) {
        const result = run(dir, flag);
        assert.equal(result.status, 0, result.stderr);
        assert.match(result.stdout, /Usage:/);
      }
    });
  });

  it("should report and fix both npm and JSR mismatches", async () => {
    await fixture(async (dir) => {
      await metadata(dir, "packages/other/deno.json", { version: "0.9.0" });
      await metadata(dir, "packages/other/package.json", { version: "0.8.0" });
      const check = run(dir);
      assert.equal(check.status, 1);
      assert.match(check.stderr, /Version mismatch/);
      assert.equal(run(dir, "-f").status, 0);
      for (const name of ["deno.json", "package.json"]) {
        const data = JSON.parse(
          await readFile(join(dir, "packages/other", name), "utf8"),
        );
        assert.equal(data.version, "1.2.3");
      }
      assert.equal(run(dir).status, 0);
    });
  });

  it("should retain workspace selection and versionless member behavior", async () => {
    await fixture(async (dir) => {
      await metadata(dir, "examples/demo/deno.json", { name: "demo" });
      await metadata(dir, "examples/demo/package.json", { private: true });
      await metadata(dir, "selected/deno.json", { version: "1.2.3" });
      await metadata(dir, "outside/deno.json", { version: "0.1.0" });
      // A member without deno.json is skipped, including its npm manifest.
      await metadata(dir, "packages/npm-only/package.json", {
        version: "0.1.0",
      });
      // A missing npm manifest is allowed.
      await metadata(dir, "packages/jsr-only/deno.json", { version: "1.2.3" });
      const before = await readFile(join(dir, "examples/demo/deno.json"));
      const result = run(dir, "--fix");
      assert.equal(result.status, 0, result.stderr);
      assert.deepEqual(
        await readFile(join(dir, "examples/demo/deno.json")),
        before,
      );
      assert.equal(result.stderr, "");
    });
  });

  it("should fail on malformed metadata rather than silently skipping it", async () => {
    await fixture(async (dir) => {
      await metadata(dir, "packages/other/deno.json", {});
      await writeFile(join(dir, "packages/other/deno.json"), "{broken");
      assert.notEqual(run(dir, "--fix").status, 0);
    });
  });

  it("should check exact members and npm versions in versionless JSR members", async () => {
    await fixture(async (dir) => {
      await metadata(dir, "selected/deno.json", { version: "0.1.0" });
      await metadata(dir, "examples/demo/deno.json", { name: "demo" });
      await metadata(dir, "examples/demo/package.json", { version: "0.1.0" });
      await metadata(dir, "outside/deno.json", { version: "0.1.0" });
      const check = run(dir);
      assert.equal(check.status, 1);
      assert.match(check.stderr, /selected/);
      assert.match(check.stderr, /demo/);
      assert.equal(run(dir, "--fix").status, 0);
      assert.equal(run(dir).status, 0);
      const outside = JSON.parse(
        await readFile(join(dir, "outside/deno.json"), "utf8"),
      );
      assert.equal(outside.version, "0.1.0");
    });
  });

  it("should fail on filesystem errors other than missing manifests", async () => {
    await fixture(async (dir) => {
      await mkdir(join(dir, "packages/other/deno.json"), { recursive: true });
      assert.notEqual(run(dir).status, 0);
    });
  });

  it("should bump all selected npm and JSR versions under Node", async () => {
    await fixture(async (dir) => {
      await copyFile(
        join(root, "scripts/bump_version.ts"),
        join(dir, "scripts/bump_version.ts"),
      );
      const result = spawnSync(
        "node",
        [join(dir, "scripts/bump_version.ts"), "2.0.0"],
        { encoding: "utf8", timeout: 10_000 },
      );
      assert.ifError(result.error);
      assert.equal(result.status, 0, result.stderr);
      for (const name of ["deno.json", "package.json"]) {
        const value = JSON.parse(
          await readFile(join(dir, "packages/core", name), "utf8"),
        );
        assert.equal(value.version, "2.0.0");
      }
      assert.equal(run(dir).status, 0);
    });
  });
});

// Helpers

async function fixture(body: (dir: string) => void | Promise<void>) {
  await mkdir(join(root, "tmp"), { recursive: true });
  const dir = await mkdtemp(join(root, "tmp/version-script-"));
  try {
    await mkdir(join(dir, "scripts"));
    await copyFile(
      join(root, "scripts/check_versions.ts"),
      join(dir, "scripts/check_versions.ts"),
    );
    await metadata(dir, "package.json", { private: true, type: "module" });
    await metadata(dir, "deno.json", {
      workspace: ["packages/*", "examples/*", "selected"],
    });
    await metadata(dir, "packages/core/deno.json", { version: "1.2.3" });
    await metadata(dir, "packages/core/package.json", { version: "1.2.3" });
    await body(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function metadata(dir: string, path: string, value: object) {
  const target = join(dir, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, JSON.stringify(value, null, 2) + "\n");
}

function run(dir: string, ...args: string[]) {
  // Explicit Node binary lookup also works when Deno discovers this test.
  const result = spawnSync(
    "node",
    [join(dir, "scripts/check_versions.ts"), ...args],
    {
      cwd: root,
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.ifError(result.error);
  return result;
}
