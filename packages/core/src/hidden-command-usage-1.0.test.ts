import { getDocPageSync } from "./parser.ts";
import { command, constant } from "./primitives.ts";
import { formatUsage, type Usage, type UsageTerm } from "./usage.ts";
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
