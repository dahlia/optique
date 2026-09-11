import { detectColorSupport, detectTerminalWidth } from "#src/terminal.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fc from "fast-check";

describe("detectColorSupport", () => {
  it("should preserve each TTY fallback without color preferences", () => {
    for (const isTTY of [true, false, undefined]) {
      assert.equal(detectColorSupport({ isTTY }, () => undefined), isTTY);
      assert.equal(
        detectColorSupport(
          { isTTY },
          envReader({ FORCE_COLOR: "", NO_COLOR: "" }),
        ),
        isTTY,
      );
    }
  });

  it("should enable color for every nonempty FORCE_COLOR value", () => {
    for (
      const FORCE_COLOR of ["0", "1", "2", "3", "true", "false", "bad", " "]
    ) {
      for (const isTTY of [true, false, undefined]) {
        assert.ok(detectColorSupport({ isTTY }, envReader({ FORCE_COLOR })));
      }
    }
  });

  it("should ignore empty NO_COLOR but honor every nonempty value", () => {
    for (const NO_COLOR of ["0", "1", "false", " "]) {
      assert.ok(!detectColorSupport({ isTTY: true }, envReader({ NO_COLOR })));
    }
    assert.ok(detectColorSupport({ isTTY: true }, envReader({ NO_COLOR: "" })));
  });

  it("should honor NODE_DISABLE_COLORS even when empty", () => {
    for (const NODE_DISABLE_COLORS of ["", "0", "1", "false"]) {
      assert.ok(
        !detectColorSupport(
          { isTTY: true },
          envReader({
            FORCE_COLOR: "",
            NO_COLOR: "",
            NODE_DISABLE_COLORS,
          }),
        ),
      );
    }
  });

  it("should stop reading after a decisive preference", () => {
    assert.ok(detectColorSupport({}, (name) => {
      assert.equal(name, "FORCE_COLOR");
      return "0";
    }));
    assert.ok(
      !detectColorSupport({ isTTY: true }, (name) => {
        assert.notEqual(name, "NODE_DISABLE_COLORS");
        return name === "NO_COLOR" ? "1" : "";
      }),
    );
  });

  it("should let nonempty FORCE_COLOR override other preferences", () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1 }),
      fc.option(fc.string(), { nil: undefined }),
      fc.option(fc.string(), { nil: undefined }),
      fc.option(fc.boolean(), { nil: undefined }),
      (FORCE_COLOR, NO_COLOR, NODE_DISABLE_COLORS, isTTY) => {
        assert.ok(detectColorSupport(
          { isTTY },
          envReader({
            FORCE_COLOR,
            NO_COLOR,
            NODE_DISABLE_COLORS,
          }),
        ));
      },
    ));
  });
});

describe("detectTerminalWidth", () => {
  it("should accept positive stream widths without imposing a layout minimum", () => {
    for (const columns of [1, 60, 120, Number.MAX_VALUE]) {
      assert.equal(
        detectTerminalWidth({ columns }, () => {
          assert.fail("A valid stream width must not read COLUMNS.");
        }),
        columns,
      );
    }
  });

  it("should fall back from invalid stream widths to COLUMNS", () => {
    for (const columns of [undefined, 0, -1, 1.5, NaN, Infinity, -Infinity]) {
      assert.equal(
        detectTerminalWidth({ columns }, envReader({ COLUMNS: "060" })),
        60,
      );
      assert.equal(
        detectTerminalWidth({ columns }, () => undefined),
        undefined,
      );
    }
  });

  it("should accept only whole positive decimal widths from the environment", () => {
    for (
      const COLUMNS of [
        "",
        "0",
        "000",
        "-60",
        "+60",
        " 60",
        "60 ",
        "60\n",
        "60\r\n",
        "6\n0",
        "60.0",
        "1e2",
        "0x40",
        "60px",
        "NaN",
        "Infinity",
        "６０",
        "9".repeat(400),
      ]
    ) {
      assert.equal(
        detectTerminalWidth({}, envReader({ COLUMNS })),
        undefined,
        JSON.stringify(COLUMNS),
      );
    }
    for (
      const [COLUMNS, expected] of [["1", 1], ["0080", 80], [
        "120",
        120,
      ]] as const
    ) {
      assert.equal(detectTerminalWidth({}, envReader({ COLUMNS })), expected);
    }
  });

  it("should prefer a positive stream width over arbitrary COLUMNS", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1 }), fc.string(), (columns, COLUMNS) => {
        assert.equal(
          detectTerminalWidth({ columns }, envReader({ COLUMNS })),
          columns,
        );
      }),
    );
  });
});

// Helpers

function envReader(env: Readonly<Record<string, string | undefined>>) {
  return (name: string): string | undefined => env[name];
}
