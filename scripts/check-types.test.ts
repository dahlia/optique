import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import { it } from "node:test";
import ts from "typescript";
import {
  createCheckProgram,
  inventoryOwnedFiles,
  loadWorkspace,
  verifyInventory,
} from "./check-types.ts";

function fixture(files: Readonly<Record<string, string>>): string {
  mkdirSync("tmp", { recursive: true });
  const root = mkdtempSync(resolve("tmp/check-types-"));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(root, name, ".."), { recursive: true });
    writeFileSync(join(root, name), text);
  }
  return root;
}

const options: ts.CompilerOptions = {
  strict: true,
  noEmit: true,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  target: ts.ScriptTarget.ESNext,
  types: [],
  allowImportingTsExtensions: true,
  skipLibCheck: true,
};

function diagnostics(program: ts.Program): readonly string[] {
  return ts
    .getPreEmitDiagnostics(program)
    .map(
      (diagnostic) =>
        `${diagnostic.code}: ${ts.flattenDiagnosticMessageText(
          diagnostic.messageText,
          "\n",
        )}`,
    );
}

it("private aliases belong to the importer and workspace exports use source", () => {
  const root = fixture({
    "package.json": '{"type":"module"}',
    "deno.json": '{"workspace":["packages/*"]}',
    "packages/a/deno.json": JSON.stringify({
      name: "@fixture/a",
      exports: { ".": "./src/index.ts" },
      imports: { "#src/": "./src/" },
    }),
    "packages/b/deno.json": JSON.stringify({
      name: "@fixture/b",
      exports: "./src/index.ts",
      imports: { "#src/": "./src/" },
    }),
    "packages/a/src/index.ts": 'export const value: "a" = "a";',
    "packages/b/src/index.ts": 'export const value: "b" = "b";',
    "packages/a/test.ts": `
      import {value as local} from "#src/index.ts?local#hash";
      import {value as relative} from "./src/index.ts?local#hash";
      import {value as remote} from "@fixture/b?remote#hash";
      const a: "a" = local;
      const same: "a" = relative;
      const b: "b" = remote;
      // @ts-expect-error Distinct packages must retain distinct types.
      const bad: "a" = remote;
    `,
    "packages/b/test.ts": `
      import {value} from "#src/index.ts";
      const b: "b" = value;
    `,
  });
  try {
    const program = createCheckProgram(
      [join(root, "packages/a/test.ts"), join(root, "packages/b/test.ts")],
      options,
      loadWorkspace(root),
    );
    assert.deepEqual(diagnostics(program), []);
    assert.ok(
      program.getSourceFiles().every((f) => !f.fileName.includes("/dist/")),
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

it("private aliases choose the longest prefix regardless of metadata order", () => {
  const root = fixture({
    "package.json": '{"type":"module"}',
    "deno.json": '{"workspace":["packages/*"]}',
    "packages/a/deno.json": JSON.stringify({
      name: "@fixture/a",
      imports: { "#src/": "./broad/", "#src/special/": "./specific/" },
    }),
    "packages/a/broad/special/value.ts": 'export const value = "broad";',
    "packages/a/specific/value.ts": 'export const value = "specific";',
    "packages/a/check.ts": `
      import {value} from "#src/special/value.ts";
      const result: "specific" = value;
      // @ts-expect-error The broad mapping must not be selected.
      const wrong: "broad" = value;
    `,
  });
  try {
    const program = createCheckProgram(
      [join(root, "packages/a/check.ts")],
      options,
      loadWorkspace(root),
    );
    assert.deepEqual(diagnostics(program), []);
  } finally {
    rmSync(root, { recursive: true });
  }
});

it("normal conditional exports respect ESM and CJS usage modes", () => {
  const root = fixture({
    "package.json": '{"type":"module"}',
    "deno.json": '{"workspace":[]}',
    "node_modules/conditional/package.json": JSON.stringify({
      name: "conditional",
      exports: { import: "./esm.d.mts", require: "./cjs.d.cts" },
    }),
    "node_modules/conditional/esm.d.mts": 'export const mode: "esm";',
    "node_modules/conditional/cjs.d.cts": 'export const mode: "cjs";',
    "check.mts": `
      import {mode} from "conditional?test#hash";
      const x: "esm" = mode;
      type Cjs = typeof import("conditional?type#hash", { with: {"resolution-mode": "require"} }).mode;
      const cjs: Cjs = "cjs";
    `,
    "check.cts": `
      import m = require("conditional");
      const x: "cjs" = m.mode;
      type Esm = typeof import("conditional", { with: {"resolution-mode": "import"} }).mode;
      const esm: Esm = "esm";
    `,
  });
  try {
    const program = createCheckProgram(
      [join(root, "check.mts"), join(root, "check.cts")],
      options,
      loadWorkspace(root),
    );
    assert.deepEqual(diagnostics(program), []);
  } finally {
    rmSync(root, { recursive: true });
  }
});

it("unknown private aliases cannot fall back to package distribution mappings", () => {
  const root = fixture({
    "package.json": '{"type":"module"}',
    "deno.json": '{"workspace":["packages/*"]}',
    "packages/a/deno.json":
      '{"name":"@fixture/a","exports":"./src/index.ts","imports":{"#src/":"./src/"}}',
    "packages/a/package.json":
      '{"type":"module","imports":{"#hidden":"./dist/hidden.js"}}',
    "packages/a/dist/hidden.d.ts": 'export declare const value: "built";',
    "packages/a/check.ts":
      'import { value } from "#hidden"; export const result = value;',
  });
  try {
    const program = createCheckProgram(
      [join(root, "packages/a/check.ts")],
      options,
      loadWorkspace(root),
    );
    assert.ok(
      ts
        .getPreEmitDiagnostics(program)
        .some((diagnostic) => diagnostic.code === 2307),
    );
    assert.ok(
      program
        .getSourceFiles()
        .every((file) => !file.fileName.includes("/dist/")),
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

it("strict inference contracts catch wrong types and stale expect-error comments", () => {
  const root = fixture({
    "deno.json": '{"workspace":[]}',
    "negative.ts": "const value: string = 123;",
    "unused.ts":
      '// @ts-expect-error Must fail if the error disappears.\nconst value: string = "ok";',
    "owned.d.ts": "export declare const broken: MissingOwnedDeclarationType;",
    "contract.d.ts": "export declare const count: number;",
    "consumer.ts":
      'import {count} from "./contract.js"; const value: string = count;',
  });
  try {
    for (const [file, code] of [
      ["negative.ts", 2322],
      ["unused.ts", 2578],
    ] as const) {
      const diagnostics = ts.getPreEmitDiagnostics(
        createCheckProgram([join(root, file)], options, loadWorkspace(root)),
      );
      assert.ok(diagnostics.some((d) => d.code === code));
    }
    // Declaration internals are skipped even for owned explicit roots.
    const declaration = [join(root, "owned.d.ts")];
    assert.deepEqual(
      diagnostics(createCheckProgram(declaration, options, [])),
      [],
    );
    assert.ok(
      ts
        .getPreEmitDiagnostics(
          createCheckProgram(
            declaration,
            { ...options, skipLibCheck: false },
            [],
          ),
        )
        .some((d) => d.code === 2304),
    );
    // Known declaration contracts still constrain checked source consumers.
    assert.deepEqual(
      ts
        .getPreEmitDiagnostics(
          createCheckProgram([join(root, "consumer.ts")], options, []),
        )
        .map((d) => d.code),
      [2322],
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

it("inventory includes build configs, inference tests, runtime fixtures and all TS extensions", () => {
  const root = fixture({
    "packages/a/tsdown.config.ts": "",
    "packages/a/src/inference.test.ts": "",
    "packages/a/fixtures/malformed.ts": "",
    "scripts/check.mts": "",
    "root.cts": "",
    "examples/component.tsx": "",
    "examples/component.ts": "",
    "docs/example.ts": "",
    "packages/a/dist/index.d.ts": "",
    "node_modules/external/index.ts": "",
    "tmp/generated.ts": "",
  });
  try {
    const files = inventoryOwnedFiles(root);
    assert.equal(files.length, 7);
    assert.ok(files.includes(join(root, "packages/a/fixtures/malformed.ts")));
    const program = createCheckProgram(
      files,
      {
        ...options,
        jsx: ts.JsxEmit.Preserve,
      },
      [],
    );
    assert.doesNotThrow(() =>
      verifyInventory(files, program.getRootFileNames()),
    );
    assert.doesNotThrow(() =>
      verifyInventory(
        files,
        program.getSourceFiles().map((file) => file.fileName),
      ),
    );
    assert.throws(() => verifyInventory(files, files.slice(1)), /not checked/);
    assert.doesNotThrow(() => verifyInventory(files, files));
  } finally {
    rmSync(root, { recursive: true });
  }
});

it("neutral browser program has DOM APIs but no implicit Node globals", () => {
  const root = fixture({
    "deno.json": '{"workspace":[]}',
    "check.ts": "new AbortController(); process.cwd();",
  });
  try {
    const diagnostics = ts.getPreEmitDiagnostics(
      createCheckProgram(
        [join(root, "check.ts")],
        { ...options, lib: ["lib.esnext.d.ts", "lib.dom.d.ts"] },
        [],
      ),
    );
    assert.equal(diagnostics.length, 1);
    assert.ok(
      ts
        .flattenDiagnosticMessageText(diagnostics[0].messageText, "\n")
        .includes("process"),
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});

it("Temporal bridge preserves namespace, constructors and negative contracts", () => {
  const root = fixture({
    "deno.json": '{"workspace":[]}',
    "check.ts": `
      const instant: Temporal.Instant = globalThis.Temporal.Instant.from("2026-01-01T00:00Z");
      const next: Temporal.Instant = instant.add({seconds: 1});
      // @ts-expect-error Instant.from does not accept a number.
      Temporal.Instant.from(123);
      // @ts-expect-error add does not accept arbitrary fields.
      instant.add({notADurationField: 1});
    `,
  });
  try {
    const program = createCheckProgram(
      [join(root, "check.ts"), resolve("scripts/types/temporal.d.ts")],
      options,
      loadWorkspace(root),
    );
    assert.deepEqual(diagnostics(program), []);
    // Validate our actual checker-only declaration without skipping internals.
    assert.deepEqual(
      diagnostics(
        createCheckProgram(
          [resolve("scripts/types/temporal.d.ts")],
          { ...options, skipLibCheck: false },
          loadWorkspace(root),
        ),
      ),
      [],
    );
    const source = readFileSync(join(root, "check.ts"), "utf8");
    writeFileSync(
      join(root, "removed.ts"),
      source.replaceAll("@ts-expect-error", "expect-error disabled"),
    );
    writeFileSync(
      join(root, "stale.ts"),
      source.replace(
        "Temporal.Instant.from(123);",
        'Temporal.Instant.from("2026-01-01T00:00Z");',
      ),
    );
    const check = (file: string) =>
      ts.getPreEmitDiagnostics(
        createCheckProgram(
          [join(root, file), resolve("scripts/types/temporal.d.ts")],
          options,
          loadWorkspace(root),
        ),
      );
    assert.ok(check("removed.ts").some((d) => d.code === 2345));
    assert.ok(check("stale.ts").some((d) => d.code === 2578));
  } finally {
    rmSync(root, { recursive: true });
  }
});

it("real parser inference rejects removed and stale negative annotations", () => {
  const source = `
    import { option } from "@optique/core/primitives";
    import { integer } from "@optique/core/valueparser";
    import { parse } from "@optique/core/parser";
    const result = parse(option("--count", integer()), ["--count", "3"]);
    if (result.success) {
      const value: number = result.value;
      // @ts-expect-error The inferred value must not be a string.
      const wrong: string = result.value;
    }
  `;
  const root = fixture({
    "correct.ts": source,
    "removed.ts": source.replace("@ts-expect-error", "expect-error disabled"),
    "stale.ts": source.replace("wrong: string", "wrong: number"),
  });
  try {
    const members = loadWorkspace(process.cwd());
    const settings = {
      ...options,
      lib: ["lib.esnext.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
    };
    const diagnostics = (file: string) =>
      ts.getPreEmitDiagnostics(
        createCheckProgram([join(root, file)], settings, members),
      );
    assert.deepEqual(diagnostics("correct.ts"), []);
    assert.ok(diagnostics("removed.ts").some((d) => d.code === 2322));
    assert.ok(diagnostics("stale.ts").some((d) => d.code === 2578));
  } finally {
    rmSync(root, { recursive: true });
  }
});

function fileSymlinkUnavailable(): string | false {
  if (process.platform !== "win32") return false;
  const root = fixture({ "target.ts": "" });
  try {
    symlinkSync(join(root, "target.ts"), join(root, "entry.ts"), "file");
    return false;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error.code === "EPERM" || error.code === "EACCES")
    ) {
      return `Windows file symlink permission unavailable (${error.code}).`;
    }
    throw error;
  } finally {
    rmSync(root, { recursive: true });
  }
}

const symlinkSkip = fileSymlinkUnavailable();

it(
  "symlinked entry points still reject invalid owned source",
  {
    skip: symlinkSkip,
  },
  () => {
    // Bun may ignore skip, so keep the early return and report its reason too.
    if (symlinkSkip) {
      console.warn(symlinkSkip);
      return;
    }
    const root = fixture({
      "project/package.json": '{"type":"module"}',
      "project/deno.json": '{"workspace":[]}',
      "project/tsconfig.check.json": JSON.stringify({
        compilerOptions: {
          target: "ESNext",
          module: "NodeNext",
          moduleResolution: "NodeNext",
          strict: true,
          noEmit: true,
          allowImportingTsExtensions: true,
          skipLibCheck: true,
          types: ["node"],
        },
      }),
      "project/bad.ts": "const value: string = 123;",
      "project/scripts/check-types.ts": readFileSync(
        resolve("scripts/check-types.ts"),
        "utf8",
      ),
    });
    try {
      const directoryLink = process.platform === "win32" ? "junction" : "dir";
      symlinkSync(
        resolve("node_modules"),
        join(root, "project/node_modules"),
        directoryLink,
      );
      symlinkSync(
        join(root, "project"),
        join(root, "checkout-link"),
        directoryLink,
      );
      symlinkSync(
        join(root, "project/scripts/check-types.ts"),
        join(root, "entry.ts"),
        "file",
      );
      for (const entry of [
        join(root, "checkout-link/scripts/check-types.ts"),
        join(root, "entry.ts"),
      ]) {
        const result = spawnSync("node", [entry], {
          encoding: "utf8",
          timeout: 30_000,
        });
        assert.equal(result.status, 1, result.stdout + result.stderr);
        assert.match(result.stderr, /TS2322/);
      }
      const entry = pathToFileURL(
        join(root, "project/scripts/check-types.ts"),
      ).href;
      for (const prelude of [
        "",
        'process.argv[1] = "nonexistent-checker-entry.ts";',
        `process.argv[1] = ${JSON.stringify(join(root, "project/bad.ts"))};`,
      ]) {
        const result = spawnSync(
          "node",
          [
            "--input-type=module",
            "--eval",
            `${prelude} await import(${JSON.stringify(
              entry,
            )}); console.log("import-only");`,
          ],
          { encoding: "utf8", timeout: 30_000 },
        );
        assert.equal(result.status, 0, result.stdout + result.stderr);
        assert.equal(result.stdout.trim(), "import-only");
      }
    } finally {
      rmSync(root, { recursive: true });
    }
  },
);
