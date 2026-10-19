import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  consumerRoot,
  createConsumerRoot,
  removeConsumerRoot,
  verifyConsumerAncestors,
} from "./isolation.ts";

const testRoot = fileURLToPath(
  new URL("../../tmp/startup-tests/", import.meta.url),
);

describe("consumer isolation", () => {
  it("should prevent Node and Bun from finding an ancestor-only package", () => {
    mkdirSync(testRoot, { recursive: true });
    const work = mkdtempSync(join(testRoot, "consumer-isolation-"));
    const ancestor = join(work, "node_modules/optique-undeclared-fixture");
    mkdirSync(ancestor, { recursive: true });
    writeFileSync(
      join(ancestor, "package.json"),
      JSON.stringify({
        name: "optique-undeclared-fixture",
        type: "module",
        exports: "./index.js",
      }),
    );
    writeFileSync(join(ancestor, "index.js"), "export default 'LEAKED';");
    const nested = join(work, "nested");
    mkdirSync(nested);
    try {
      const root = createConsumerRoot(work);
      assert.equal(consumerRoot(work), root);
      for (const executable of ["node", "bun"]) {
        const args = [
          ...(executable === "bun" ? ["--no-install", "--no-env-file"] : []),
          "-e",
          "import('optique-undeclared-fixture').then(m=>console.log(m.default)).catch(()=>process.exit(42))",
        ];
        const options = {
          env: { PATH: process.env.PATH ?? "" },
          encoding: "utf8" as const,
        };
        const control = spawnSync(executable, args, {
          ...options,
          cwd: nested,
        });
        assert.equal(control.status, 0, control.stderr);
        assert.equal(control.stdout.trim(), "LEAKED");
        const isolated = spawnSync(executable, args, { ...options, cwd: root });
        assert.equal(isolated.status, 42, isolated.stderr);
        assert.equal(isolated.stdout, "");
      }
      removeConsumerRoot(work);
      assert.ok(!existsSync(root));
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
  it("should reject populated package ancestors before preparing or reusing consumers", () => {
    mkdirSync(testRoot, { recursive: true });
    const work = mkdtempSync(join(testRoot, "consumer-ancestor-"));
    try {
      const root = createConsumerRoot(work);
      verifyConsumerAncestors(root);
      mkdirSync(join(root, "node_modules"));
      assert.throws(
        () => verifyConsumerAncestors(root),
        /ancestor.*node_modules/i,
      );
      removeConsumerRoot(work);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
  it("should recover preparation after its external temporary directory disappears", () => {
    mkdirSync(testRoot, { recursive: true });
    const work = mkdtempSync(join(testRoot, "consumer-expired-"));
    const root = createConsumerRoot(work);
    try {
      rmSync(root, { recursive: true });
      assert.throws(() => consumerRoot(work), /prepare/i);
      removeConsumerRoot(work);
      assert.ok(!existsSync(join(work, "consumer-root.json")));
      const replacement = createConsumerRoot(work);
      assert.notEqual(replacement, root);
      assert.equal(consumerRoot(work), replacement);
      removeConsumerRoot(work);
    } finally {
      rmSync(work, { recursive: true, force: true });
    }
  });
  it("should refuse to delete a directory with a changed ownership marker", () => {
    mkdirSync(testRoot, { recursive: true });
    const work = mkdtempSync(join(testRoot, "consumer-owner-"));
    const root = createConsumerRoot(work);
    try {
      writeFileSync(join(root, ".owned"), "different preparation");
      assert.throws(() => removeConsumerRoot(work), /ownership/i);
      assert.ok(existsSync(root));
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(work, { recursive: true, force: true });
    }
  });
});
