import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { createCliRunner } from "@optique/testing/cli";
import { parseArgsSync } from "@optique/testing/parser";
import { formatCommandReference } from "#src/markdown.ts";
import { parser } from "../test/fixtures/markdown-reference/definitions.ts";
import {
  referenceEntries,
  referenceOptions,
} from "../test/fixtures/markdown-reference/pages.ts";

const fixture = fileURLToPath(
  new URL("../test/fixtures/markdown-reference/", import.meta.url),
);
const runtimeArgs = "Deno" in globalThis
  ? ["--allow-read", "--allow-write", "--allow-env"]
  : [];
const cli = createCliRunner({
  entrypoint: join(fixture, "cli.ts"),
  runtimeArgs,
});

describe("Markdown reference application example", () => {
  it("keeps maintained command examples valid", () => {
    for (
      const args of [
        ["serve", "--port", "9000", "--tag", "local", "--tag", "demo"],
        ["config", "get", "theme", "color"],
        ["config", "g", "theme"],
        ["config", "set", "theme", "--format", "text"],
        ["docs"],
      ]
    ) assert.ok(parseArgsSync(parser, args).success);
    assert.ok(
      !parseArgsSync(parser, ["config", "set", "theme", "--format", "invalid"])
        .success,
    );
  });

  it("emits the same complete reference at build time and runtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "optique-markdown-"));
    try {
      const expected = formatCommandReference(
        referenceEntries,
        referenceOptions,
      );
      const runtime = await cli.invoke("docs");
      assert.equal(runtime.exitCode, 0, runtime.stderr);
      assert.equal(runtime.stdout, expected);
      assert.equal(runtime.stderr, "");
      const output = join(directory, "REFERENCE.md");
      const build = await createCliRunner({
        entrypoint: join(fixture, "build.ts"),
        runtimeArgs,
      }).invoke(output);
      assert.equal(build.exitCode, 0, build.stderr);
      assert.equal(await readFile(output, "utf8"), expected);
      const normal = await cli.invoke("serve", "--tag", "demo");
      assert.equal(normal.exitCode, 0, normal.stderr);
      assert.deepEqual(JSON.parse(normal.stdout), {
        verbose: false,
        action: { type: "serve", port: 8080, tags: ["demo"] },
      });
      const version = await cli.invoke("--version");
      assert.equal(version.exitCode, 0, version.stderr);
      assert.match(version.stdout, /1\.0\.0/);
      const completion = await cli.invoke("completion", "bash");
      assert.equal(completion.exitCode, 0, completion.stderr);
      assert.match(completion.stdout, /ref-tool/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
