import assert from "node:assert/strict";
import { it } from "node:test";
import { stripAnsi } from "./displaywidth.ts";
import { message } from "./message.ts";
import { renderErrorMessage } from "./message-renderer.ts";

it("assembles error labels with one formatter call and physical-line offsets", () => {
  const error = message`unchanged`;
  for (const colors of [false, true, { resetSuffix: "\x1b[4m" }]) {
    for (const body of ["body", "", "\nbody"]) {
      for (
        const [label, occupied, maxWidth, column, prefix] of [
          ["Error:", 0, undefined, 7, "Error: "],
          ["Error:", 2, 8, 7, "\nError: "],
          ["", 2, 8, 2, ""],
          ["Error\n", 2, 8, 0, "Error\n"],
          ["AB\n한:", 6, 8, 4, "AB\n한: "],
          ["\n", 9, 8, 0, "\n"],
        ] as const
      ) {
        let labels = 0;
        let calls = 0;
        const result = renderErrorMessage(error, {
          colors,
          quotes: true,
          initialWidth: occupied,
          maxWidth,
          theme: {
            errorLabel: () => {
              labels++;
              return {
                type: "style",
                style: { bold: true },
                children: [{ type: "text", text: label }],
              };
            },
          },
          messageFormatter: (received, options) => {
            calls++;
            assert.equal(received, error);
            assert.deepEqual(options, {
              colors: typeof colors === "object" ? true : colors,
              quotes: true,
              maxWidth,
              initialWidth: column,
            });
            return body;
          },
        });
        assert.equal(labels, 1);
        assert.equal(calls, 1);
        assert.equal(stripAnsi(result), prefix + body);
        if (typeof colors === "object" && label.length > 0) {
          assert.ok(result.includes("\x1b[0m\x1b[4m"));
        }
      }
    }
  }
});

it("validates external offsets before rendering or formatting errors", () => {
  for (const initialWidth of [-1, NaN, Infinity, 0.5]) {
    assert.throws(() =>
      renderErrorMessage(message`x`, {
        initialWidth,
        theme: {
          errorLabel: () => {
            throw new Error("Unexpected render.");
          },
        },
        messageFormatter: () => {
          throw new Error("Unexpected format.");
        },
      }), initialWidth < 0 ? RangeError : TypeError);
  }
});
