import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
for (const format of ["esm", "cjs"]) {
  const core = format === "esm"
    ? await import("@optique/core")
    : require("@optique/core");
  const docs = format === "esm"
    ? await import("@optique/core/doc-pages")
    : require("@optique/core/doc-pages");
  const markdown = format === "esm"
    ? await import("@optique/man/markdown")
    : require("@optique/man/markdown");
  const ordinary = format === "esm"
    ? await import("@optique/man")
    : require("@optique/man");
  assert.ok(!("collectDocPages" in core));
  assert.ok(!("formatCommandReference" in ordinary));
  const parser = core.command(
    "serve",
    core.withDefault(core.option("--port", core.integer()), 8080),
  );
  const collected = docs.collectDocPages(parser);
  assert.deepEqual(collected.unresolved, []);
  const rendered = markdown.formatCommandReference(collected.entries, {
    name: "app",
    coverage: {
      commands: "all-visible",
      help: "excluded",
      version: "excluded",
      completion: "excluded",
    },
  });
  assert.ok(rendered.includes("8080"));
  assert.ok(rendered.includes("app serve"));
  process.stdout.write(
    `${format}: registry shared, renderer exported, ordinary roots optional\n`,
  );
}
