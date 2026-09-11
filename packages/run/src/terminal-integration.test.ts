import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import process from "node:process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

// deno-lint-ignore no-control-regex -- Check the actual ANSI escape prefix.
const ansiSequence = /\x1b\[/u;

describe("runner terminal detection", () => {
  it("should force colored help on a pipe even with FORCE_COLOR=0", async () => {
    const result = await invoke({}, { FORCE_COLOR: "0" });
    assert.match(result.stdout, ansiSequence);
    assert.equal(result.exitCode, 0);
  });

  it("should fall back from zero stream columns to COLUMNS", async () => {
    const result = await invoke({ columns: "0", colors: false }, {
      COLUMNS: "60",
    });
    assert.equal(result.exitCode, 0);
    assert.ok(result.formatting.some((options) => options.maxWidth === 60));
    assert.ok(result.stdout.split("\n").every((line) => line.length <= 60));
  });

  it("should leave output unwrapped when both detected widths are invalid", async () => {
    const result = await invoke({ columns: "NaN", colors: false }, {
      COLUMNS: "bad",
    });
    assert.equal(result.exitCode, 0);
    assert.ok(result.formatting.every((options) => options.maxWidth === null));
    assert.ok(result.stdout.split("\n").some((line) => line.length > 80));
  });

  it("should ignore empty color controls and retain the TTY fallback", async () => {
    const variables = { FORCE_COLOR: "", NO_COLOR: "" };
    assert.match((await invoke({ tty: true }, variables)).stdout, ansiSequence);
    assert.doesNotMatch((await invoke({}, variables)).stdout, ansiSequence);
  });

  it("should disable TTY colors with nonempty NO_COLOR", async () => {
    assert.doesNotMatch(
      (await invoke({ tty: true }, { NO_COLOR: "0" })).stdout,
      ansiSequence,
    );
  });

  it("should honor an empty NODE_DISABLE_COLORS", async () => {
    assert.doesNotMatch(
      (await invoke({ tty: true }, { NODE_DISABLE_COLORS: "" })).stdout,
      ansiSequence,
    );
  });

  it("should let FORCE_COLOR override both disabling variables", async () => {
    const result = await invoke({}, {
      FORCE_COLOR: "false",
      NO_COLOR: "1",
      NODE_DISABLE_COLORS: "1",
      COLUMNS: "60",
    });
    assert.match(result.stdout, ansiSequence);
    assert.ok(
      result.formatting.some(({ colors, maxWidth }) =>
        colors && maxWidth === 60
      ),
    );
  });

  it("should prefer a valid stream width over COLUMNS", async () => {
    const result = await invoke({ columns: "72", colors: false }, {
      COLUMNS: "60",
    });
    assert.ok(result.formatting.some((options) => options.maxWidth === 72));
    assert.ok(result.stdout.split("\n").some((line) => line.length > 60));
  });

  it("should preserve explicit colors and width over automatic values", async () => {
    const plain = await invoke({
      tty: true,
      columns: "60",
      colors: false,
      width: "72",
    }, {
      FORCE_COLOR: "1",
      COLUMNS: "60",
    });
    assert.doesNotMatch(plain.stdout, ansiSequence);
    assert.ok(plain.formatting.some((options) => options.maxWidth === 72));
    const colored = await invoke({ colors: true }, {
      NO_COLOR: "1",
      NODE_DISABLE_COLORS: "1",
    });
    assert.match(colored.stdout, ansiSequence);
  });

  it("should preserve missing TTY values for custom formatters", async () => {
    for (const request of ["help", "error"] as const) {
      const result = await invoke({ request, distinguishColors: true });
      assert.match(result.stdout + result.stderr, /UNSET/u);
      assert.ok(result.formatting.some((options) => options.colors === null));
      const explicit = await invoke({
        request,
        distinguishColors: true,
        colors: false,
      });
      assert.doesNotMatch(explicit.stdout + explicit.stderr, /UNSET/u);
      assert.match(explicit.stdout + explicit.stderr, /FALSE/u);
    }
  });

  it("should use stdout preferences for errors even when stderr disagrees", async () => {
    const result = await invoke({ request: "error", tty: true }, {
      NO_COLOR: "1",
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /Error:/u);
    assert.doesNotMatch(result.stderr, ansiSequence);
    assert.equal(result.stdout, "");
    const forced = await invoke({ request: "error", tty: false }, {
      FORCE_COLOR: "0",
    });
    assert.match(forced.stderr, ansiSequence);
  });

  for (
    const mode of [
      "runSync",
      "runAsync",
      "async-parser",
      "run-context",
      "runSync-context",
      "program",
    ]
  ) {
    it(`should apply shared defaults through ${mode}`, async () => {
      const result = await invoke({ mode, columns: "0" }, {
        FORCE_COLOR: "0",
        COLUMNS: "60",
      });
      assert.equal(result.exitCode, 0);
      assert.match(result.stdout, ansiSequence);
      assert.ok(
        result.formatting.some(({ colors, maxWidth }) =>
          colors && maxWidth === 60
        ),
      );
    });
  }

  it("should preserve explicit invalid-width errors", async () => {
    for (const width of ["0", "-1", "1.5", "NaN", "Infinity"]) {
      const expectedError = width === "0" || width === "-1"
        ? "RangeError"
        : "TypeError";
      const result = await invoke({ width, expectedError }, { COLUMNS: "60" });
      assert.equal(result.failure?.name, expectedError);
      assert.equal(result.exitCode, undefined);
    }
  });

  for (const permissions of [[], ["--deny-env"], ["--allow-env=COLUMNS"]]) {
    it(
      `should tolerate restricted Deno environment access (${
        permissions.join(",") || "no grants"
      })`,
      {
        skip: !process.versions.deno,
      },
      async () => {
        if (!process.versions.deno) return;
        const expectedWidth = permissions.includes("--allow-env=COLUMNS")
          ? 60
          : null;
        const result = await invoke({ tty: true, columns: "0" }, {
          NODE_DISABLE_COLORS: "1",
          COLUMNS: "60",
        }, permissions);
        assert.equal(result.exitCode, 0);
        assert.match(result.stdout, ansiSequence);
        assert.ok(
          result.formatting.some((options) =>
            options.maxWidth === expectedWidth
          ),
        );
        const forced = await invoke({}, { FORCE_COLOR: "0" }, permissions);
        assert.match(forced.stdout, ansiSequence);
        const plain = await invoke(
          { tty: true },
          { NO_COLOR: "1" },
          permissions,
        );
        assert.doesNotMatch(plain.stdout, ansiSequence);
        const success = await invoke({ request: "success" }, {}, permissions);
        assert.equal(success.value, "ok");
        assert.equal(success.exitCode, undefined);
        const explicit = await invoke({ colors: true, width: "72" }, {
          NO_COLOR: "1",
          COLUMNS: "60",
        }, permissions);
        assert.ok(
          explicit.formatting.some(({ colors, maxWidth }) =>
            colors && maxWidth === 72
          ),
        );
      },
    );
  }
});

// Helpers

interface Scenario {
  readonly mode?: string;
  readonly columns?: string;
  readonly tty?: boolean;
  readonly colors?: boolean;
  readonly width?: string;
  readonly request?: "help" | "error" | "success";
  readonly distinguishColors?: boolean;
  readonly expectedError?: "RangeError" | "TypeError";
}

interface Result {
  readonly observed: { readonly columns: string; readonly tty: boolean | null };
  readonly stdout: string;
  readonly stderr: string;
  readonly formatting: readonly {
    readonly colors: boolean | null;
    readonly maxWidth: number | null;
  }[];
  readonly exitCode?: number;
  readonly failure?: { readonly name: string; readonly message: string };
  readonly value?: unknown;
}

async function invoke(
  scenario: Scenario,
  variables: Readonly<Record<string, string>> = {},
  envPermissions: readonly string[] = ["--allow-env"],
): Promise<Result> {
  const env = { ...process.env };
  for (
    const key of ["FORCE_COLOR", "NO_COLOR", "NODE_DISABLE_COLORS", "COLUMNS"]
  ) {
    delete env[key];
  }
  Object.assign(env, variables);
  const fixture = fileURLToPath(
    new URL("./fixtures/terminal-capabilities.ts", import.meta.url),
  );
  const args = [fixture, JSON.stringify(scenario)];
  // Deno spawnSync inherits omitted environment keys; execFile uses the
  // asynchronous spawn path, which respects the complete supplied environment.
  const child = await promisify(execFile)(
    process.execPath,
    process.versions.deno
      ? ["run", "--allow-read", "--no-prompt", ...envPermissions, ...args]
      : args,
    { env, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 },
  );
  const result: Result = JSON.parse(child.stdout);
  assert.deepEqual(result.observed, {
    columns: scenario.columns === undefined
      ? "undefined"
      : String(Number(scenario.columns)),
    tty: scenario.tty ?? null,
  });
  return result;
}
