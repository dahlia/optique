import assert from "node:assert/strict";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { runProgram } from "@optique/discover";
import { captureProgramRun } from "@optique/testing/discover";
import manifest from "../package.json" with { type: "json" };
import { info } from "./commands/info.ts";
import { lines } from "./commands/lines.ts";
import { createInputScope } from "./input.ts";
import { createFileProgram } from "./program.ts";

const formatting = { colors: false, maxWidth: 80 } as const;

it("skips all handlers and resource hooks for metadata and parse failures", async () => {
  let creations = 0;
  const hookEvents: string[] = [];
  const program = createFileProgram({
    createScope() {
      creations++;
      throw new Error("Resource hooks must not run.");
    },
  });
  const observed = {
    ...program,
    hooks: {
      ...program.hooks,
      afterEach(context) {
        hookEvents.push("afterEach");
        return program.hooks.afterEach(context);
      },
      onError(context) {
        hookEvents.push("onError");
        return program.hooks.onError(context);
      },
    } satisfies typeof program.hooks,
  };
  for (
    const args of [
      ["--help"],
      ["file", "--help"],
      ["file", "lines", "--help"],
      ["--version"],
      ["completion", "bash"],
      ["completion", "bash", "file", ""],
    ]
  ) {
    const result = await captureProgramRun({
      ...observed,
      ...formatting,
      args,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.ok(result.stdout.length > 0);
    if (args[0] === "--version") {
      assert.equal(result.stdout, `${manifest.version}\n`);
    }
    if (args[0] === "completion" && args.length > 2) {
      assert.match(result.stdout, /info/);
      assert.match(result.stdout, /lines/);
    }
  }
  for (
    const args of [
      ["--unknown"],
      ["file", "lines"],
      ["file", "info", "-"],
      ["file", "info", "sample", "extra"],
    ]
  ) {
    const result = await captureProgramRun({
      ...observed,
      ...formatting,
      args,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /Error:/);
  }
  assert.equal(creations, 0);
  assert.deepEqual(hookEvents, []);
});

for (const phase of ["success", "handler", "afterEach"] as const) {
  it(`creates and releases one real resource for ${phase}`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "file-inspect-hooks-"));
    const path = join(directory, "sample.txt");
    await writeFile(path, "one\ntwo\n");
    const events: string[] = [];
    const output: string[] = [];
    const failure = new Error("Intentional failure after acquisition.");
    const program = createFileProgram({
      createScope() {
        events.push("create");
        const scope = createInputScope({
          write(line) {
            output.push(line);
            if (phase === "handler") throw failure;
          },
          async openFile(path) {
            events.push("open");
            const handle = await open(path, "r");
            const close = handle.close.bind(handle);
            handle.close = async () => {
              await close();
              events.push("release");
            };
            return handle;
          },
        });
        return {
          ...scope,
          close() {
            events.push("cleanup");
            return scope.close();
          },
        };
      },
    });
    const options = {
      ...program,
      ...formatting,
      args: ["file", "info", path],
      hooks: {
        ...program.hooks,
        async afterEach(context) {
          await program.hooks.afterEach(context);
          if (phase === "afterEach") throw failure;
        },
      } satisfies typeof program.hooks,
    };
    try {
      if (phase === "success") {
        assert.deepEqual(await captureProgramRun(options), {
          exitCode: 0,
          stdout: "",
          stderr: "",
        });
      } else {
        await assert.rejects(
          captureProgramRun(options),
          (error) => error === failure,
        );
      }
      assert.deepEqual(output, [JSON.stringify({ path, bytes: 8 })]);
      assert.deepEqual(events, [
        "create",
        "open",
        "cleanup",
        "release",
        ...(phase === "afterEach" ? ["cleanup"] : []),
      ]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
}

it("preserves beforeEach failure when no resource was returned", async () => {
  const failure = new Error("Scope creation failed.");
  await assert.rejects(
    captureProgramRun({
      ...createFileProgram({
        createScope() {
          throw failure;
        },
      }),
      ...formatting,
      args: ["file", "info", "unused"],
    }),
    (error) => error === failure,
  );
});

it("guards missing handler contexts", async () => {
  await assert.rejects(
    async () => await info.handler({ path: "unused" }),
    /resource/i,
  );
  await assert.rejects(
    async () => await lines.handler({ path: "-" }),
    /resource/i,
  );
});

// Deno type-checks this fixture; Node and Bun only execute the runtime tests.
function checkTypes() {
  const value: Parameters<typeof info.handler>[0] = { path: "sample.txt" };
  const path: string = value.path;
  void path;
  // @ts-expect-error Handler input remains the inferred string path.
  const invalid: Parameters<typeof lines.handler>[0] = { path: 123 };
  void invalid;
  runProgram<number>({
    // @ts-expect-error These commands receive program resources, not numbers.
    commands: [info, lines],
    metadata: { name: "wrong-resource" },
    hooks: { beforeEach: () => ({ resource: 123 }) },
  });
}
void checkTypes;
