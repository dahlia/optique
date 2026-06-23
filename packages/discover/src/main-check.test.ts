import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isMainModule } from "#src/main-check.ts";

describe("isMainModule()", () => {
  it("should use import.meta.main when the runtime provides it", () => {
    assert.ok(
      isMainModule({
        importMetaMain: true,
        modulePath: "/real/cli.js",
        argvEntry: "/other/cli.js",
      }),
    );
    assert.ok(
      !isMainModule({
        importMetaMain: false,
        modulePath: "/real/cli.js",
        argvEntry: "/real/cli.js",
      }),
    );
  });

  it("should compare real paths for Node versions without import.meta.main", () => {
    const realpaths = new Map([
      ["/project/node_modules/.bin/optique-discover", "/project/dist/cli.js"],
      [
        "/project/node_modules/@optique/discover/dist/cli.js",
        "/project/dist/cli.js",
      ],
    ]);

    assert.ok(
      isMainModule({
        modulePath: "/project/node_modules/@optique/discover/dist/cli.js",
        argvEntry: "/project/node_modules/.bin/optique-discover",
        realpath(path) {
          return realpaths.get(path) ?? path;
        },
      }),
    );
  });

  it("should return false when no entry-point path exists", () => {
    assert.ok(
      !isMainModule({
        modulePath: "/real/cli.js",
      }),
    );
  });
});
