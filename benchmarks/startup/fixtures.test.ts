import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync, readFileSync } from "node:fs";

const fixtures = new URL("./fixtures/", import.meta.url);
const manifest = JSON.parse(
  readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);

describe("startup fixture manifest", () => {
  it("should enumerate roots and every Optique subpath supplying fixture symbols", () => {
    const imports = new Set<string>([
      "@optique/core",
      "@optique/run",
      "@optique/discover",
    ]);
    const visit = (directory: URL) => {
      for (const file of readdirSync(directory, { withFileTypes: true })) {
        if (file.isDirectory()) visit(new URL(`${file.name}/`, directory));
        else if (file.name.endsWith(".js")) {
          const source = readFileSync(new URL(file.name, directory), "utf8");
          for (const match of source.matchAll(/from "(@optique\/[^"]+)"/g)) {
            imports.add(match[1]);
          }
        }
      }
    };
    visit(fixtures);
    assert.deepEqual([...manifest.imports].sort(), [...imports].sort());
  });
  it("should keep the standalone CJS graph equivalent to the ESM templates", () => {
    for (const name of ["grammar", "three"]) {
      let generated = readFileSync(new URL(`${name}.js`, fixtures), "utf8")
        .replace(
          /import \{([^}]+)\} from "([^"]+)";/gs,
          (_, symbols: string, path: string) =>
            `const {${symbols}} = require("${
              path.replace("./grammar.js", "./grammar.cjs")
            }");`,
        )
        .replace(
          'import process from "node:process";',
          'const process = require("node:process");',
        )
        .replaceAll("export function ", "function ").replaceAll(
          "export const ",
          "const ",
        );
      if (name === "grammar") {
        generated += "module.exports = { options, set, start, status };";
      }
      const actual = readFileSync(new URL(`${name}.cjs`, fixtures), "utf8");
      // Formatting is independent; exact output goldens exercise both graphs.
      assert.equal(actual.replace(/\s/g, ""), generated.replace(/\s/g, ""));
      assert.ok(!/\bimport\s|require\(".*\.js"\)/.test(actual));
    }
  });
  it("should scan only default-exported command modules", () => {
    assert.deepEqual(readdirSync(new URL("commands/", fixtures)).sort(), [
      "config",
      "start.js",
      "status.js",
    ]);
    assert.deepEqual(readdirSync(new URL("commands/config/", fixtures)), [
      "set.js",
    ]);
    assert.deepEqual([...manifest.discoveryImports].sort(), [
      "commands/config/set.js",
      "commands/start.js",
      "commands/status.js",
      "handlers/set.js",
      "handlers/start.js",
      "handlers/status.js",
    ]);
  });
});
