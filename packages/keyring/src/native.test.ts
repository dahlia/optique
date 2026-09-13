import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const packagePath = fileURLToPath(new URL("../", import.meta.url));

describe("native keyring smoke", () => {
  it(
    "should reject an inaccessible Secret Service instead of reporting a missing password",
    {
      skip: process.platform !== "linux",
    },
    () => {
      if (process.platform !== "linux") return;

      runFixture(new URL("./linux-unavailable.fixture.ts", import.meta.url), {
        DBUS_SESSION_BUS_ADDRESS:
          "unix:path=/nonexistent/optique-keyring-secret-service.sock",
      });
    },
  );

  it("should resolve AsyncEntry in a fresh process", () => {
    const fixture = new URL("./native-import.fixture.ts", import.meta.url);

    runFixture(fixture, {});
  });

  it("should defer backend loading failures until fallback demand", () => {
    const fixture = new URL("./native-lazy.fixture.ts", import.meta.url);
    const libraryPath = fileURLToPath(
      new URL("./native-library-does-not-exist.node", import.meta.url),
    );

    runFixture(fixture, {
      NAPI_RS_NATIVE_LIBRARY_PATH: libraryPath,
      DBUS_SESSION_BUS_ADDRESS:
        "unix:path=/nonexistent/optique-keyring-secret-service.sock",
    });
  });
});

function runFixture(
  fixture: URL,
  environment: Readonly<Record<string, string>>,
): void {
  const fixturePath = fileURLToPath(fixture);
  const args = "Deno" in globalThis
    ? [
      "run",
      // Dependencies are installed by mise; auto mode would rewrite the
      // shared node_modules tree while Node.js and Bun tests are running.
      "--node-modules-dir=manual",
      "--allow-env",
      "--allow-sys",
      "--allow-net",
      "--allow-read=../../node_modules,/nonexistent/optique-keyring-secret-service.sock",
      "--allow-write=/nonexistent/optique-keyring-secret-service.sock",
      "--allow-ffi=../../node_modules",
      fixturePath,
    ]
    : [fixturePath];

  const result = spawnSync(process.execPath, args, {
    cwd: packagePath,
    encoding: "utf8",
    env: environment,
  });

  assert.ifError(result.error);

  // Deno can return an empty result for a denied spawn without an error field.
  if ("Deno" in globalThis && result.status === undefined) {
    assert.fail(
      `Deno could not start ${fixturePath}. Check the --allow-run permission.`,
    );
  }

  assert.equal(
    result.signal,
    null,
    `${fixturePath} terminated by ${result.signal}:\n${result.stderr}`,
  );
  assert.equal(result.status, 0, `${fixturePath}:\n${result.stderr}`);
}
