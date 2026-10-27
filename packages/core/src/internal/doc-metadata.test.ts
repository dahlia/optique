import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  captureDocParser,
  captureDocValue,
  getDocNode,
  getDocValue,
} from "#src/internal/doc-metadata.ts";
import { choice } from "#src/valueparser.ts";
import { cloneUsage, type Usage, type UsageTerm } from "#src/usage.ts";

describe("constructor documentation snapshots", () => {
  it("should read each captured choice only a bounded number of times", () => {
    const count = 1024;
    let reads = 0;
    const choices = new Proxy(Array.from({ length: count }, (_, i) => i), {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/.test(property)) reads++;
        return Reflect.get(target, property, receiver);
      },
    });

    const parser = captureDocValue({}, { kind: "number", choices });

    assert.deepEqual(
      getDocValue(parser)?.choices,
      Array.from({ length: count }, (_, i) => i),
    );
    assert.ok(
      reads <= count * 2,
      `Read ${reads} elements for ${count} choices.`,
    );
  });

  it("should preserve deduplicated number choices and both zero signs", () => {
    const parser = choice([-0, 0, -0, Infinity, -Infinity, Infinity]);
    const captured = getDocValue(parser)?.choices;

    assert.deepEqual(captured, [-0, 0, Infinity, -Infinity]);
    assert.ok(Object.is(captured?.[0], -0));
    assert.ok(Object.is(captured?.[1], 0));
    assert.ok(Object.isFrozen(captured));
  });

  it("should retain only linear usage nodes across nested snapshots", () => {
    const depth = 128;
    let reads = 0;
    let usage: Usage = [{
      type: "literal",
      get value() {
        reads++;
        return "leaf";
      },
    }];
    const parsers = [captureDocParser({ usage }, { kind: "leaf" })];
    for (let i = 0; i < depth; i++) {
      usage = [{ type: "optional", terms: usage }];
      parsers.push(captureDocParser({ usage }, { kind: "optional" }));
    }
    const seen = new Set<UsageTerm>();
    const pending = parsers.flatMap((parser) =>
      getDocNode(parser)?.usage ?? []
    );
    while (pending.length > 0) {
      const term = pending.pop();
      if (term == null || seen.has(term)) continue;
      seen.add(term);
      if (term.type === "optional") pending.push(...term.terms);
    }

    assert.equal(seen.size, depth + 1);
    assert.equal(reads, 1);
  });

  it("should freeze copied usage without freezing the caller's arrays", () => {
    const names = ["--original" as const];
    const usage: Usage = [{ type: "option", names }];
    const parser = captureDocParser({ usage }, { kind: "leaf" });
    const captured = getDocNode(parser)?.usage;
    assert.ok(captured);
    const term = captured[0];
    assert.ok(term.type === "option");

    Reflect.set(names, 0, "--changed");

    assert.deepEqual(term.names, ["--original"]);
    assert.ok(Object.isFrozen(captured));
    assert.ok(Object.isFrozen(term));
    assert.ok(Object.isFrozen(term.names));
    assert.ok(!Object.isFrozen(names));
  });

  it("should preserve usage fields and callbacks while sharing nested overrides", () => {
    let calls = 0;
    const callback = (usage: Usage): Usage => {
      calls++;
      return usage;
    };
    const override: Usage = [{ type: "literal", value: "override" }];
    const usage: Usage = [{
      type: "exclusive",
      acceptsEmpty: false,
      terms: [[{
        type: "multiple",
        min: 2,
        acceptsEmpty: true,
        terms: [{
          type: "sequence",
          terms: [{
            type: "command",
            name: "serve",
            aliases: ["s"],
            hiddenAliases: ["secret"],
            hidden: "usage",
            usageLine: override,
          }, {
            type: "command",
            name: "other",
            usageLine: callback,
          }],
        }],
      }]],
    }];
    const parser = captureDocParser({ usage }, {
      kind: "command",
      usageLine: override,
    });
    const captured = getDocNode(parser);
    assert.ok(captured);

    assert.deepEqual(captured.usage, cloneUsage(usage));
    const group = captured.usage[0];
    assert.ok(group.type === "exclusive");
    const repeated = group.terms[0][0];
    assert.ok(repeated.type === "multiple");
    const sequence = repeated.terms[0];
    assert.ok(sequence.type === "sequence");
    const selected = sequence.terms[0];
    assert.ok(selected.type === "command");
    assert.equal(selected.usageLine, captured.usageLine);
    assert.ok(Object.isFrozen(selected.aliases));
    assert.ok(Object.isFrozen(selected.hiddenAliases));
    assert.ok(Object.isFrozen(group.terms));
    assert.equal(calls, 0);
  });
});
