import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isBuiltin } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import manifest from "../package.json" with { type: "json" };
import { isPathWithin } from "./paths.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stage = resolve(root, "dist/package");
await mkdir(stage, { recursive: true });
const command = [
  "build",
  "src/cli.ts",
  "--target=node",
  "--packages=bundle",
  "--format=esm",
  "--outfile=dist/package/cli.js",
  "--metafile=dist/bundle-meta.json",
];
execFileSync("bun", command, { cwd: root, stdio: "inherit" });
const bin = resolve(stage, "cli.js");
let code = await readFile(bin, "utf8");
if (!code.startsWith("#!")) code = `#!/usr/bin/env node\n${code}`;
assert.equal(
  code.split("\n").filter((line) => line.startsWith("#!")).length,
  1,
);
assert.ok(code.startsWith("#!/usr/bin/env node\n"));
await writeFile(bin, code);
await chmod(bin, 0o755);

const meta: {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly outputs: Readonly<
    Record<string, {
      readonly imports: readonly {
        readonly path: string;
        readonly external?: boolean;
      }[];
    }>
  >;
} = JSON.parse(await readFile(resolve(root, "dist/bundle-meta.json"), "utf8"));
const inputs = Object.keys(meta.inputs);
const inputRoots = [
  root,
  ...["core", "run", "discover"].map((name) =>
    resolve(root, `../../packages/${name}`)
  ),
];
for (const input of inputs) {
  const actual = await realpath(resolve(root, input));
  assert.ok(
    inputRoots.some((directory) => isPathWithin(directory, actual)),
    `Unexpected bundle input: ${actual}`,
  );
}
for (const name of ["core", "run", "discover"]) {
  assert.ok(
    inputs.some((path) => path.includes(`packages/${name}/dist/`)),
    `Missing local ${name} bundle inputs.`,
  );
}
for (const output of Object.values(meta.outputs)) {
  for (const imported of output.imports) {
    if (imported.external) {
      assert.ok(isBuiltin(imported.path), `External package: ${imported.path}`);
    }
  }
}

// Verify actual emitted imports too. discover's computed file-module import
// remains in its unused discovery branch; this app always supplies commands.
const source = ts.createSourceFile(
  "cli.js",
  code,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.JS,
);
const computedImports: string[] = [];
function inspect(node: ts.Node): void {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    const specifier = node.moduleSpecifier;
    if (specifier != null && ts.isStringLiteral(specifier)) {
      assert.ok(
        isBuiltin(specifier.text),
        `Unbundled import: ${specifier.text}`,
      );
    }
  }
  if (
    ts.isCallExpression(node) &&
    node.expression.kind === ts.SyntaxKind.ImportKeyword
  ) {
    const argument = node.arguments[0];
    if (ts.isStringLiteral(argument)) {
      assert.ok(
        isBuiltin(argument.text),
        `Unbundled dynamic import: ${argument.text}`,
      );
    } else {
      let parent: ts.Node | undefined = node.parent;
      while (parent != null && !ts.isFunctionDeclaration(parent)) {
        parent = parent.parent;
      }
      assert.ok(
        parent != null && ts.isFunctionDeclaration(parent) &&
          parent.name?.text === "discoverCommands",
      );
      assert.match(
        argument.getText(source),
        /^pathToFileURL\d*\(filePath\)\.href$/,
      );
      computedImports.push(argument.getText(source));
    }
  }
  ts.forEachChild(node, inspect);
}
inspect(source);
assert.equal(computedImports.length, 1);
await writeFile(
  resolve(stage, "package.json"),
  JSON.stringify(
    {
      name: manifest.name,
      version: manifest.version,
      private: true,
      type: "module",
      bin: { "file-inspect": "./cli.js" },
      files: ["cli.js"],
      engines: { node: manifest.engines.node },
    },
    null,
    2,
  ) + "\n",
);
await writeFile(
  resolve(root, "dist/build-evidence.json"),
  JSON.stringify(
    {
      command: ["bun", ...command],
      bun: execFileSync("bun", ["--version"], { encoding: "utf8" }).trim(),
      inputs,
      computedImports,
      computedImportBoundary:
        "Unused discoverCommands file discovery; application statically supplies commands.",
      bundleSha256: createHash("sha256").update(code).digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
