import {
  formatUsage,
  isDocHidden,
  isUsageHidden,
  normalizeUsage,
  type Usage,
  type UsageTerm,
} from "../usage.ts";
import { resolveUsageForDisplay } from "./usage.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const FILE: UsageTerm = { type: "argument", metavar: "FILE" };
const DIR: UsageTerm = { type: "argument", metavar: "DIR" };
const optionalFile: UsageTerm = { type: "optional", terms: [FILE] };
const optionalDir: UsageTerm = { type: "optional", terms: [DIR] };
const hiddenFlag: UsageTerm = {
  type: "option",
  names: ["--secret"],
  hidden: true,
};

function hasAcceptsEmpty(usage: Usage): boolean {
  return usage.some((term) => {
    if (
      (term.type === "exclusive" || term.type === "multiple") &&
      term.acceptsEmpty != null
    ) {
      return true;
    }
    if (term.type === "exclusive") return term.terms.some(hasAcceptsEmpty);
    if (
      term.type === "optional" || term.type === "multiple" ||
      term.type === "sequence"
    ) {
      return hasAcceptsEmpty(term.terms);
    }
    return false;
  });
}

describe("resolveUsageForDisplay()", () => {
  it("requires optional alternatives of a group that rejects empty input", () => {
    assert.deepEqual(
      resolveUsageForDisplay([{
        type: "exclusive",
        terms: [[optionalFile], [optionalDir]],
        acceptsEmpty: false,
      }], isUsageHidden),
      [{ type: "exclusive", terms: [[FILE], [DIR]] }],
    );
  });

  it("makes a group optional when its omission has no visible branch", () => {
    assert.deepEqual(
      resolveUsageForDisplay([{
        type: "exclusive",
        terms: [[], [FILE]],
        acceptsEmpty: true,
      }], isUsageHidden),
      [{ type: "optional", terms: [FILE] }],
    );
    assert.deepEqual(
      resolveUsageForDisplay([{
        type: "exclusive",
        terms: [[{ type: "optional", terms: [hiddenFlag] }], [FILE], [DIR]],
        acceptsEmpty: true,
      }], isUsageHidden),
      [{
        type: "optional",
        terms: [{ type: "exclusive", terms: [[FILE], [DIR]] }],
      }],
    );
  });

  it("requires optional repeated items when repetition rejects empty input", () => {
    assert.deepEqual(
      resolveUsageForDisplay([{
        type: "multiple",
        terms: [optionalFile],
        min: 1,
        acceptsEmpty: false,
      }], isUsageHidden),
      [{ type: "multiple", terms: [FILE], min: 1 }],
    );
  });

  it("looks through nested optional terms", () => {
    const nested: Usage = [{
      type: "multiple",
      terms: [{ type: "optional", terms: [optionalFile] }],
      min: 1,
      acceptsEmpty: false,
    }];
    assert.deepEqual(resolveUsageForDisplay(nested, isUsageHidden), [{
      type: "multiple",
      terms: [FILE],
      min: 1,
    }]);
    assert.equal(formatUsage("app", nested), "app FILE...");
    assert.equal(formatUsage("app", normalizeUsage(nested)), "app FILE...");
  });

  it("makes repetition optional when it accepts empty input", () => {
    assert.deepEqual(
      resolveUsageForDisplay([{
        type: "multiple",
        terms: [FILE],
        min: 1,
        acceptsEmpty: true,
      }], isUsageHidden),
      [{
        type: "optional",
        terms: [{ type: "multiple", terms: [FILE], min: 1 }],
      }],
    );
  });

  it("keeps the declared notation when the requirement cannot be drawn", () => {
    // Two optional terms in one alternative mean "at least one of them",
    // which plain notation cannot express locally.
    const twoOptions: Usage = [{
      type: "exclusive",
      terms: [[optionalFile, optionalDir], [{
        type: "command",
        name: "init",
      }]],
      acceptsEmpty: false,
    }];
    assert.deepEqual(resolveUsageForDisplay(twoOptions, isUsageHidden), [{
      type: "exclusive",
      terms: [[optionalFile, optionalDir], [{ type: "command", name: "init" }]],
    }]);
    // A repetition without a minimum cannot be drawn as required either.
    assert.deepEqual(
      resolveUsageForDisplay([{
        type: "multiple",
        terms: [FILE],
        min: 0,
        acceptsEmpty: false,
      }], isUsageHidden),
      [{ type: "multiple", terms: [FILE], min: 0 }],
    );
  });

  it("does not require a visible term next to a hidden required one", () => {
    // The first alternative accepts --secret alone, so FILE stays optional
    // even though the group rejects empty input.
    const usage: Usage = [{
      type: "exclusive",
      terms: [[hiddenFlag, optionalFile], [DIR]],
      acceptsEmpty: false,
    }];
    const resolved = resolveUsageForDisplay(usage, isUsageHidden);
    assert.deepEqual(resolved, [{
      type: "exclusive",
      terms: [[hiddenFlag, optionalFile], [DIR]],
    }]);
    assert.equal(formatUsage("app", usage), "app ([FILE] | DIR)");
    assert.equal(formatUsage("app", resolved), "app ([FILE] | DIR)");
  });

  it("depends on the visibility context", () => {
    const docHidden: UsageTerm = {
      type: "option",
      names: ["--debug"],
      hidden: "doc",
    };
    const usage: Usage = [{
      type: "exclusive",
      terms: [[{ type: "optional", terms: [docHidden] }], [FILE]],
      acceptsEmpty: true,
    }];
    assert.deepEqual(resolveUsageForDisplay(usage, isUsageHidden), [{
      type: "exclusive",
      terms: [[{ type: "optional", terms: [docHidden] }], [FILE]],
    }]);
    assert.deepEqual(resolveUsageForDisplay(usage, isDocHidden), [{
      type: "optional",
      terms: [FILE],
    }]);
  });

  it("lets an enclosing group take precedence over an inner one", () => {
    // multiple(or(constant("x"), FILE), { min: 2 }): the alternative alone
    // accepts empty input, but two items need at least one FILE.
    const usage: Usage = [{
      type: "multiple",
      terms: [{ type: "exclusive", terms: [[], [FILE]], acceptsEmpty: true }],
      min: 2,
      acceptsEmpty: false,
    }];
    assert.deepEqual(resolveUsageForDisplay(usage, isUsageHidden), [{
      type: "multiple",
      terms: [FILE],
      min: 2,
    }]);
    assert.equal(formatUsage("app", usage), "app FILE FILE...");
  });

  it("removes every record and is idempotent", () => {
    const usages: readonly Usage[] = [
      [{
        type: "exclusive",
        terms: [[hiddenFlag, optionalFile], [DIR]],
        acceptsEmpty: false,
      }],
      [{
        type: "exclusive",
        terms: [[optionalFile, optionalDir], [DIR]],
        acceptsEmpty: false,
      }],
      [{ type: "exclusive", terms: [[], [FILE]], acceptsEmpty: true }],
      [{
        type: "multiple",
        terms: [optionalFile],
        min: 1,
        acceptsEmpty: false,
      }],
      [{ type: "multiple", terms: [], min: 2, acceptsEmpty: false }],
    ];
    for (const usage of usages) {
      const resolved = resolveUsageForDisplay(usage, isUsageHidden);
      assert.ok(!hasAcceptsEmpty(resolved));
      assert.deepEqual(
        resolveUsageForDisplay(resolved, isUsageHidden),
        resolved,
      );
      assert.equal(formatUsage("app", resolved), formatUsage("app", usage));
    }
  });
});
