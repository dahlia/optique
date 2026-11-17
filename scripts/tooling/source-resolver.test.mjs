import assert from "node:assert/strict";
import { test } from "node:test";
import { createSourceResolver, loadMembers } from "./source-resolver.mjs";
import { pathToFileURL } from "node:url";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve as pathResolve } from "node:path";

const root = process.cwd();
const members = loadMembers(root);
const resolve = createSourceResolver(root, members);
const url = (path) => pathToFileURL(`${root}/${path}`).href;
const from = (pkg) => url(`packages/${pkg}/src/index.test.ts`);

test("private imports belong to each importer, not the first member", () => {
  for (const pkg of ["core", "derived-defaults"]) {
    assert.equal(
      resolve("#src/index.ts", from(pkg)),
      url(`packages/${pkg}/src/index.ts`),
    );
  }
});
test("workspace public exports use Deno source metadata", () => {
  assert.equal(
    resolve("@optique/core/parser", from("derived-defaults")),
    url("packages/core/src/parser.ts"),
  );
});
test("query and hash survive public/private redirection", () => {
  assert.equal(
    resolve("@optique/core/parser?v=1#part", from("core")),
    `${url("packages/core/src/parser.ts")}?v=1#part`,
  );
  assert.equal(
    resolve("#src/index.ts?v=2#part", from("core")),
    `${url("packages/core/src/index.ts")}?v=2#part`,
  );
});
test("unknown dependencies delegate; known unexported paths fail closed", () => {
  assert.equal(resolve("unknown/module", from("core")), undefined);
  assert.throws(() => resolve("@optique/core/not-exported", from("core")), {
    code: "ERR_PACKAGE_PATH_NOT_EXPORTED",
  });
});
test("unknown owned private aliases fail closed instead of using dist mappings", () => {
  mkdirSync("tmp", { recursive: true });
  const project = mkdtempSync(pathResolve("tmp/resolver-private-"));
  const owner = join(project, "packages/a");
  mkdirSync(join(owner, "dist"), { recursive: true });
  writeFileSync(join(project, "deno.json"), '{"workspace":["packages/*"]}');
  writeFileSync(
    join(owner, "deno.json"),
    '{"name":"@fixture/a","imports":{"#src/":"./src/"}}',
  );
  writeFileSync(
    join(owner, "package.json"),
    '{"type":"module","imports":{"#hidden":"./dist/hidden.js"}}',
  );
  writeFileSync(join(owner, "dist/hidden.js"), 'export const value = "built";');
  try {
    const source = createSourceResolver(project, loadMembers(project));
    const importer = pathToFileURL(join(owner, "check.ts")).href;
    assert.throws(() => source("#hidden", importer), {
      code: "ERR_PACKAGE_IMPORT_NOT_DEFINED",
    });
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
});
test("dist/dependencies/tmp/isolated consumers never acquire source mappings", () => {
  for (
    const parent of [
      url("packages/core/dist/index.js"),
      url("packages/core/node_modules/dep/index.js"),
      url("node_modules/dep/index.js"),
      url("tmp/consumer/index.ts"),
      pathToFileURL("/tmp/opencode/consumer/index.ts").href,
    ]
  ) {
    assert.equal(resolve("@optique/core/parser", parent), undefined);
    assert.equal(resolve("#src/index.ts", parent), undefined);
  }
});
test("artifact probe fixtures retain ordinary npm resolution", () => {
  for (
    const parent of [
      url("packages/man/test/fixtures/markdown-reference/trace-imports.mjs"),
      url("packages/core/src/test-fixtures/consumer.mjs"),
    ]
  ) {
    assert.equal(resolve("@optique/core", parent), undefined);
    assert.equal(resolve("#src/index.ts", parent), undefined);
  }
});
test("source-shaped traversal cannot escape an owner's private source", () => {
  assert.throws(() =>
    resolve("#src/../../core/dist/index.js", from("derived-defaults"))
  );
});
test("root tests can resolve workspace exports but have no private owner", () => {
  assert.equal(
    resolve("@optique/core/parser", url("index.test.ts")),
    url("packages/core/src/parser.ts"),
  );
  assert.equal(resolve("#src/index.ts", url("index.test.ts")), undefined);
});

test("directory symlinks preserve checkout identity without acquiring outside ownership", () => {
  mkdirSync("tmp", { recursive: true });
  const base = mkdtempSync(pathResolve("tmp/resolver-links-"));
  const project = join(base, "project");
  const owner = join(project, "packages/a");
  const outside = join(base, "outside");
  mkdirSync(owner, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(project, "deno.json"), '{"workspace":["packages/*"]}');
  writeFileSync(
    join(owner, "deno.json"),
    '{"name":"@fixture/a","exports":"./src/index.ts","imports":{"#src/":"./src/"}}',
  );
  writeFileSync(join(outside, "index.ts"), "export const value = 1;");
  const linkType = process.platform === "win32" ? "junction" : "dir";
  symlinkSync(project, join(base, "checkout"), linkType);
  symlinkSync(outside, join(owner, "src"), linkType);
  try {
    const checkout = join(base, "checkout");
    const source = createSourceResolver(checkout, loadMembers(checkout));
    const importer = pathToFileURL(join(checkout, "packages/a/check.ts")).href;
    // The known package must fail closed, not delegate to a built export.
    assert.throws(() => source("@fixture/a", importer), /Symlink/);
    assert.equal(
      source("@fixture/a", pathToFileURL(join(outside, "index.ts")).href),
      undefined,
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
