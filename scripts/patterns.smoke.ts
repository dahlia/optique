import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("Node pattern examples", () => {
  for (
    const name of [
      "async-completion",
      "async-validation",
      "command-discovery",
      "grouping-mutually-exclusive-options",
      "ordered-sequence",
      "pass-through-options",
      "program-hooks",
      "shared-options",
      "subcommands",
    ]
  ) {
    it(`should show ${name} help without interactive or network input`, () => {
      const result = run(name, ["--help"]);
      assert.match(result, /Usage:/);
    });
  }

  it("should use CLI arguments in environment and interactive compositions", () => {
    assert.match(
      run("env-variables", ["--host", "node.example"]),
      /node.example/,
    );
    const result = run("interactive-env-config-composition", [
      "--host",
      "node.example",
      "--port",
      "4321",
      "--api-key",
      "smoke-key",
    ]);
    assert.match(result, /node.example/);
    assert.match(result, /4321/);
    assert.match(result, /API key length: "9"/);
  });

  for (
    const [name, args, output] of [
      ["conditional-defaults", [], /help mode/],
      ["conditional-options", ["--reporter", "console"], /Console output/],
      ["deferred-values", ["--service-name", "api"], /Service: "api"/],
      ["dependent-options", [], /normalFlag/],
      [
        "inter-option-dependencies",
        ["--mode", "dev", "--log-level", "debug"],
        /debug/,
      ],
      ["key-value-options", ["--env", "HOST=node.example"], /node.example/],
      ["mutually-exclusive-flags", [], /Mode selected/],
      ["mutually-exclusive-options", ["--port", "4321"], /4321/],
      ["negatable-boolean-options", [], /Code fences/],
      ["verbosity-levels", [], /Verbosity level/],
    ] as const
  ) {
    it(`should run ${name} with bounded noninteractive input`, () => {
      assert.match(run(name, args), output);
    });
  }

  it("should load configuration files through portable filesystem APIs", async () => {
    await mkdir(join(root, "tmp"), { recursive: true });
    const dir = await mkdtemp(join(root, "tmp/pattern-smoke-"));
    try {
      const config = join(dir, "config.json");
      await writeFile(
        config,
        JSON.stringify({ host: "file.example", port: 4321 }),
      );
      for (const name of ["config-file-context", "env-config-composition"]) {
        const result = run(name, ["--config", config]);
        assert.match(result, /file.example/);
        assert.match(result, /4321/);
      }
      // The custom context illustrates annotations; its parser keeps defaults.
      const result = run("custom-source-context", [
        "--config",
        config,
        "--host",
        "cli.example",
      ]);
      assert.match(result, /cli.example/);
      await writeFile(config, JSON.stringify({ port: 70000 }));
      assert.match(
        run("custom-source-context", ["--config", config], 1),
        /Port must be between 1 and 65535/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// Helpers

function run(name: string, args: readonly string[], status = 0): string {
  const env: Record<string, string | undefined> = {
    ...process.env,
    NO_COLOR: "1",
  };
  for (
    const key of ["MYAPP_HOST", "MYAPP_PORT", "MYAPP_DEBUG", "MYAPP_API_KEY"]
  ) {
    delete env[key];
  }
  const result = spawnSync("node", [
    join(root, "examples/patterns", `${name}.ts`),
    ...args,
  ], {
    cwd: root,
    env,
    input: "",
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, status, result.stderr);
  return result.stdout + result.stderr;
}
