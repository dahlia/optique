import { getDocPage, getDocPageSync, parse } from "./parser.ts";
import { command, constant, option } from "./primitives.ts";
import {
  cloneUsage,
  formatUsage,
  type Usage,
  type UsageTerm,
} from "./usage.ts";
import { string, type ValueParser } from "./valueparser.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

// These custom usage trees exercise the 1.0 backport's conservative traversal.
// Parsing still selects real commands and records their execution path.
function docUsage(usage: Usage): Usage {
  const parser = {
    ...command("alpha", constant("alpha")),
    usage,
  };
  const page = getDocPageSync(parser, ["alpha"]);
  assert.ok(page);
  assert.ok(page.usage);
  return page.usage;
}

function synopsis(usage: Usage): string {
  return formatUsage("app", docUsage(usage), { expandCommands: true });
}

const alpha: UsageTerm = { type: "command", name: "alpha", hidden: "usage" };
const other: UsageTerm = { type: "command", name: "other", hidden: "usage" };

function wrap(type: "optional" | "multiple", terms: Usage): UsageTerm {
  return type === "optional" ? { type, terms } : { type, terms, min: 0 };
}

describe("1.0 matched command usage traversal", () => {
  it("does not reveal a descendant of an unmatched branch", () => {
    const usage = docUsage([{
      type: "optional",
      terms: [{
        type: "exclusive",
        terms: [[other, alpha], [alpha]],
      }],
    }]);
    const container = usage[0];
    assert.equal(container.type, "optional");
    const alternatives = container.terms[0];
    assert.equal(alternatives.type, "exclusive");
    const unmatchedChild = alternatives.terms[0][1];
    const matched = alternatives.terms[1][0];
    assert.equal(unmatchedChild.type, "command");
    assert.equal(matched.type, "command");
    assert.equal(unmatchedChild.hidden, "usage");
    assert.equal(matched.hidden, undefined);
  });

  for (const type of ["optional", "multiple"] as const) {
    it(`continues outside an unmatched ${type} container`, () => {
      const result = synopsis([wrap(type, [other]), wrap("multiple", [alpha])]);
      assert.equal(result.match(/alpha/g)?.length, 1);
      assert.ok(!result.includes("other"));
    });

    it(`consumes the exclusive path inside ${type} only once`, () => {
      const result = synopsis([
        wrap(type, [{ type: "exclusive", terms: [[alpha], [other]] }]),
        wrap("multiple", [alpha]),
      ]);
      assert.equal(result.match(/alpha/g)?.length, 1);
      assert.ok(!result.includes("other"));
    });
  }
});

describe("identified commands after an untracked mismatch", () => {
  for (const mode of ["sync", "async"] as const) {
    for (const nested of [false, true]) {
      it(`${mode}: scans identified commands in a ${nested ? "nested" : "flat"} list`, async () => {
        let valueParsed = false;
        const value: ValueParser<typeof mode, string> = mode === "sync"
          ? string()
          : {
            mode: "async",
            metavar: "STRING",
            placeholder: "",
            parse(input) {
              valueParsed = true;
              return Promise.resolve({ success: true, value: input });
            },
            format: (value) => value,
          };
        const selected = command(
          "alpha",
          command("beta", option("--value", value), {
            hidden: "usage",
          }),
          { hidden: "usage" },
        );
        const following: Usage = [alpha, ...selected.usage];
        const usage: Usage = [
          other,
          ...(nested
            ? [{ type: "optional" as const, terms: following }]
            : following),
        ];
        const parser = { ...selected, usage };
        const before = cloneUsage(parser.usage);
        const args = ["alpha", "beta", "--value", "selected"];
        assert.equal(parser.mode, mode);
        assert.deepEqual(await parse(parser, args), {
          success: true,
          value: "selected",
        });
        const root = await getDocPage(parser);
        assert.ok(root?.usage);
        const rootText = formatUsage("app", root.usage, {
          expandCommands: true,
        });
        const page = await getDocPage(parser, args);
        assert.ok(page?.usage);
        const text = formatUsage("app", page.usage, { expandCommands: true });
        assert.equal(text.match(/\balpha\b/g)?.length, 1);
        assert.equal(text.match(/\bbeta\b/g)?.length, 1);
        assert.ok(!text.includes("other"));
        assert.deepEqual(parser.usage, before);
        const laterRoot = await getDocPage(parser);
        assert.ok(laterRoot?.usage);
        assert.equal(
          formatUsage("app", laterRoot.usage, { expandCommands: true }),
          rootText,
        );
        if (mode === "async") assert.ok(valueParsed);
      });
    }
  }
});
