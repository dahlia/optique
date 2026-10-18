import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  classifyFile,
  inventoryTree,
  readTar,
  verifyInventory,
  verifyLock,
  verifyPackList,
} from "./inventory.ts";

const testRoot = fileURLToPath(
  new URL("../../tmp/startup-tests/", import.meta.url),
);

describe("classifyFile", () => {
  it("should classify declarations before JavaScript suffixes", () => {
    for (const file of ["x.d.ts", "x.d.cts", "x.d.mts"]) {
      assert.equal(classifyFile(file), "declarations");
    }
    for (const file of ["x.js", "x.mjs"]) {
      assert.equal(classifyFile(file), "esm");
    }
    assert.equal(classifyFile("x.cjs"), "cjs");
    assert.equal(classifyFile("LICENSE"), "other");
  });
});

describe("inventoryTree", () => {
  it("should follow links, deduplicate real paths and tolerate cycles", () => {
    mkdirSync(testRoot, { recursive: true });
    const root = mkdtempSync(join(testRoot, "tree-"));
    try {
      mkdirSync(join(root, "package"));
      writeFileSync(join(root, "package/file"), "12345");
      symlinkSync("package", join(root, "alias"));
      symlinkSync("..", join(root, "package/cycle"));
      const result = inventoryTree(root);
      assert.equal(result.apparentBytes, 5);
      assert.equal(result.files.length, 1);
      assert.ok(result.allocatedBytes >= 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("should reject symlinks escaping the measured tree", () => {
    mkdirSync(testRoot, { recursive: true });
    const root = mkdtempSync(join(testRoot, "escape-"));
    try {
      symlinkSync(
        fileURLToPath(new URL("../../LICENSE", import.meta.url)),
        join(root, "outside"),
      );
      assert.throws(() => inventoryTree(root), /escape/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("readTar", () => {
  it("should reject malformed or truncated archives instead of undercounting", () => {
    assert.throws(() => readTar(Buffer.from("garbage")), /archive|tar/i);
    assert.throws(() => readTar(Buffer.alloc(513, 1)), /archive|tar/i);
  });
});

describe("verifyLock", () => {
  const archive = {
    name: "@optique/core",
    specifier: "file:../tarballs/core.tgz",
    integrity: "sha512-correct",
  };
  const lock = (resolution: object) => ({
    lockfileVersion: "9.0",
    overrides: { "@optique/core": archive.specifier },
    packages: { "@optique/core@file:../tarballs/core.tgz": { resolution } },
  });
  it("should verify local tarball resolution and integrity", () => {
    verifyLock(
      lock({ tarball: archive.specifier, integrity: archive.integrity }),
      [archive],
    );
  });
  it("should reject registry, wrong hashes, missing and unexpected packages", () => {
    assert.throws(() =>
      verifyLock(
        lock({ integrity: "sha512-wrong", tarball: archive.specifier }),
        [archive],
      )
    );
    assert.throws(() =>
      verifyLock(
        lock({
          integrity: archive.integrity,
          tarball: "https://registry.npmjs.org/core.tgz",
        }),
        [archive],
      )
    );
    assert.throws(() => verifyLock({ packages: {} }, [archive]));
    assert.throws(() =>
      verifyLock({
        ...lock({ integrity: archive.integrity, tarball: archive.specifier }),
        packages: { "evil@1": {} },
      }, [archive])
    );
  });
});

describe("release archive content", () => {
  it("should count regular files and ustar prefix paths exactly", () => {
    const archive = tarFixture([{ path: "package/a.js", content: "abc" }, {
      path: "file.d.cts",
      prefix: "package/nested",
      content: "types",
    }]);
    const files = readTar(archive);
    assert.deepEqual(files.map(({ path, size }) => ({ path, size })), [{
      path: "a.js",
      size: 3,
    }, { path: "nested/file.d.cts", size: 5 }]);
  });
  it("should honor PAX path and reject unsupported links and path traversal", () => {
    const item = "path=package/long-name.js\n";
    let length = item.length + 3;
    while (`${length} ${item}`.length !== length) {
      length = `${length} ${item}`.length;
    }
    const files = readTar(
      tarFixture([{
        path: "PaxHeader",
        type: "x",
        content: `${length} ${item}`,
      }, { path: "package/short", content: "js" }]),
    );
    assert.equal(files[0].path, "long-name.js");
    assert.throws(
      () =>
        readTar(tarFixture([{ path: "package/link", type: "2", content: "" }])),
      /type/,
    );
    assert.throws(
      () => readTar(tarFixture([{ path: "package/../escape", content: "" }])),
      /path/,
    );
  });
});

// Helpers
function tarFixture(
  entries: readonly {
    path: string;
    content: string;
    prefix?: string;
    type?: string;
  }[],
): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    const bytes = Buffer.from(entry.content);
    const header = Buffer.alloc(512);
    header.write(entry.path, 0, 100);
    header.write(`${bytes.length.toString(8).padStart(11, "0")}\0`, 124);
    header.write(entry.type ?? "0", 156);
    header.write(entry.prefix ?? "", 345, 155);
    header.fill(32, 148, 156);
    const checksum = header.reduce((sum, byte) => sum + byte, 0);
    header.write(`${checksum.toString(8).padStart(6, "0")}\0 `, 148);
    chunks.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

describe("prepared installation identity", () => {
  it("should reject output-preserving byte changes and added files", () => {
    mkdirSync(testRoot, { recursive: true });
    const root = mkdtempSync(join(testRoot, "installed-"));
    try {
      writeFileSync(join(root, "entry.js"), "console.log('ok');");
      const prepared = inventoryTree(root);
      verifyInventory(inventoryTree(root), prepared);
      writeFileSync(
        join(root, "entry.js"),
        "for(let i=0;i<1000;i++);console.log('ok');",
      );
      assert.throws(
        () => verifyInventory(inventoryTree(root), prepared),
        /installation/i,
      );
      writeFileSync(join(root, "entry.js"), "console.log('ok');");
      writeFileSync(join(root, "extra.js"), "extra");
      assert.throws(
        () => verifyInventory(inventoryTree(root), prepared),
        /installation/i,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("should cross-check the archive against pnpm's reported package files", () => {
    verifyPackList({ files: [{ path: "a.js" }] }, ["a.js"]);
    assert.throws(() =>
      verifyPackList({ files: [{ path: "a.js" }] }, ["b.js"])
    );
  });
});
