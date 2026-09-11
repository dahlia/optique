import { type DocPage, formatDocPage } from "#src/doc.ts";
import { type RunOptions, runParser } from "#src/facade.ts";
import { formatMessage, message, valueSet } from "#src/message.ts";
import { option } from "#src/primitives.ts";
import { withAutomaticWidth } from "#src/terminal-width.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("automatic runner width", () => {
  const page: DocPage = {
    usage: [{ type: "option", names: ["--value"], metavar: "VALUE" }],
    brief:
      message`A description long enough to wrap at a normal terminal width.`,
    sections: [{
      entries: [{
        term: { type: "option", names: ["--value"], metavar: "VALUE" },
        description: message`Select a value.`,
        choices: valueSet(["first", "second"], { type: "unit", fallback: "" }),
      }],
    }],
  };

  it("should keep direct core API width constraints strict", () => {
    assert.throws(
      () => formatDocPage("test", page, { maxWidth: 1 }),
      RangeError,
    );
    const options: RunOptions<void, void> = {
      maxWidth: 1,
      help: { option: true },
      stdout: () => assert.fail("Invalid explicit width must not emit output."),
    };
    assert.throws(
      () => runParser(option("--value"), "test", ["--help"], options),
      RangeError,
    );
  });

  it("should drop insufficient widths before calling message formatters", () => {
    for (const termWidth of [1, 26, "auto"] as const) {
      for (const maxWidth of [1, 10, 30]) {
        const formatting = {
          termWidth,
          showChoices: { prefix: " (available choices: " },
        };
        let calls = 0;
        let resolved = 0;
        let effectiveWidth: number | undefined = maxWidth;
        const original = {
          ...formatting,
          maxWidth,
          messageFormatter: (
            msg: Parameters<typeof formatMessage>[0],
            opts?: Parameters<typeof formatMessage>[1],
          ) => {
            calls++;
            return formatMessage(msg, opts);
          },
        };
        // These widths cannot fit the choices prefix in the description column.
        assert.throws(() => formatDocPage("test", page, original), RangeError);
        assert.equal(calls, 0);
        const actual = formatDocPage(
          "test",
          page,
          withAutomaticWidth(original, (width) => {
            resolved++;
            effectiveWidth = width;
            assert.equal(calls, 0);
          }),
        );
        assert.equal(actual, formatDocPage("test", page, formatting));
        assert.equal(effectiveWidth, undefined);
        assert.equal(resolved, 1);
        assert.equal(original.maxWidth, maxWidth);
        assert.ok(calls > 0);
      }
    }
  });

  it("should share themed usage measurements with rendering", () => {
    let calls = 0;
    let exits = 0;
    const output: string[] = [];
    runParser(
      option("--value"),
      "test",
      ["--invalid"],
      withAutomaticWidth({
        maxWidth: 1,
        theme: {
          programName: () => ({
            type: "text" as const,
            text: `name${++calls}`,
          }),
        },
        stderr: (text: string) => output.push(text),
        onError: () => {
          exits++;
        },
      }),
    );
    assert.equal(calls, 1);
    assert.equal(exits, 1);
    assert.ok(output[0].startsWith("Usage: name1"));
  });

  it("should retain feasible widths and leave caller options reusable", () => {
    const options = { maxWidth: 40 };
    const expected = formatDocPage("test", page, options);
    assert.equal(
      formatDocPage("test", page, withAutomaticWidth(options)),
      expected,
    );
    assert.equal(formatDocPage("test", page, options), expected);
    assert.equal(options.maxWidth, 40);
  });

  it("should not suppress unrelated validation or formatter errors", () => {
    assert.throws(() =>
      formatDocPage(
        "test",
        page,
        withAutomaticWidth({
          maxWidth: 1,
          showChoices: { maxItems: 0 },
        }),
      ), /showChoices.maxItems/);
    const error = new RangeError("Custom formatter failed.");
    let calls = 0;
    assert.throws(() =>
      formatDocPage(
        "test",
        page,
        withAutomaticWidth({
          maxWidth: 1,
          messageFormatter: () => {
            calls++;
            throw error;
          },
        }),
      ), (actual) => actual === error);
    assert.equal(calls, 1);
  });
});
