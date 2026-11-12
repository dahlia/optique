import { or, tuple } from "./constructs.ts";
import { multiple, optional } from "./modifiers.ts";
import { getDocPage, type Mode, parse } from "./parser.ts";
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

function values(mode: Mode, parsed: string[]): ValueParser<Mode, string> {
  if (mode === "sync") return string({ metavar: "VALUE" });
  return {
    mode: "async",
    metavar: "VALUE",
    placeholder: "",
    parse(input) {
      parsed.push(input);
      return Promise.resolve({ success: true, value: input });
    },
    format: (value) => value,
  };
}

function findLiteral(
  usage: Usage,
): Extract<UsageTerm, { type: "literal" }> | undefined {
  for (const term of usage) {
    if (term.type === "literal") return term;
    if (term.type === "optional" || term.type === "multiple") {
      const found = findLiteral(term.terms);
      if (found != null) return found;
    } else if (term.type === "exclusive") {
      for (const branch of term.terms) {
        const found = findLiteral(branch);
        if (found != null) return found;
      }
    }
  }
  return undefined;
}

describe("wrapped command usageLine", () => {
  for (const mode of ["sync", "async"] as const) {
    for (
      const wrapper of ["optional", "multiple", "nested", "exclusive"] as const
    ) {
      for (const kind of ["static", "callback"] as const) {
        it(`${mode}: applies the ${kind} override inside ${wrapper}`, async () => {
          const parsed: string[] = [];
          const value = values(mode, parsed);
          const override: Usage = [{ type: "literal", value: "CUSTOM" }];
          let calls = 0;
          let wrongCalls = 0;
          const selected = command("alpha", option("--inside", value), {
            hidden: "usage",
            usageLine: kind === "static" ? override : (tail) => {
              calls++;
              assert.equal(formatUsage("tail", tail), "tail --inside VALUE");
              assert.ok(tail[0]);
              // The callback may mutate its input without changing parser usage.
              Reflect.set(tail[0], "metavar", "MUTATED");
              return override;
            },
          });
          const wrapped = wrapper === "optional"
            ? optional(selected)
            : wrapper === "multiple"
            ? multiple(selected, { min: 1, max: 1 })
            : wrapper === "nested"
            ? optional(multiple(optional(selected), { min: 1, max: 1 }))
            : optional(
              or(
                selected,
                command("other", constant("other"), { hidden: true }),
              ),
            );
          const parser = or(
            tuple([wrapped, optional(option("--global"))]),
            command("alpha", option("--wrong", value), {
              usageLine() {
                wrongCalls++;
                return [{ type: "literal", value: "WRONG" }];
              },
            }),
          );
          const before = cloneUsage(parser.usage);
          assert.equal(parser.mode, mode);
          assert.deepEqual(
            await parse(parser, ["alpha", "--inside", "selected", "--global"]),
            {
              success: true,
              value: [
                wrapper === "multiple" || wrapper === "nested"
                  ? ["selected"]
                  : "selected",
                true,
              ],
            },
          );
          if (mode === "async") assert.ok(parsed.includes("selected"));
          const root = await getDocPage(parser);
          assert.ok(root?.usage);
          const rootText = formatUsage("app", root.usage, {
            expandCommands: true,
          });
          await getDocPage(parser, [
            "alpha",
            "--inside",
            "selected",
            "--global",
          ]);
          assert.equal(calls, 0);
          assert.equal(wrongCalls, 0);
          const page = await getDocPage(parser, ["alpha"]);
          assert.ok(page?.usage);
          const text = formatUsage("app", page.usage, { expandCommands: true });
          assert.match(text, /alpha CUSTOM/);
          assert.match(text, /--global/);
          assert.doesNotMatch(text, /--inside|--wrong|WRONG|other/);
          assert.equal(calls, kind === "callback" ? 1 : 0);
          assert.equal(wrongCalls, 0);
          assert.notEqual(page.usage[0].type, "command");
          const literal = findLiteral(page.usage);
          assert.ok(literal);
          Reflect.set(literal, "value", "CORRUPTED");
          assert.deepEqual(override, [{ type: "literal", value: "CUSTOM" }]);
          assert.deepEqual(parser.usage, before);
          const again = await getDocPage(parser, ["alpha"]);
          assert.ok(again?.usage);
          assert.match(
            formatUsage("app", again.usage, { expandCommands: true }),
            /alpha CUSTOM/,
          );
          assert.equal(calls, kind === "callback" ? 2 : 0);
          const laterRoot = await getDocPage(parser);
          assert.ok(laterRoot?.usage);
          assert.equal(
            formatUsage("app", laterRoot.usage, { expandCommands: true }),
            rootText,
          );
          assert.deepEqual(parser.usage, before);
        });
      }
    }

    it(`${mode}: applies only the current same-named command's override`, async () => {
      const parsed: string[] = [];
      let parentCalls = 0;
      let childCalls = 0;
      let wrongCalls = 0;
      const value = values(mode, parsed);
      const parser = or(
        command(
          "alpha",
          optional(command("alpha", option("--inside", value), {
            hidden: "usage",
            usageLine() {
              childCalls++;
              return [{ type: "literal", value: "CHILD" }];
            },
          })),
          {
            hidden: "usage",
            usageLine() {
              parentCalls++;
              return [{ type: "literal", value: "PARENT" }];
            },
          },
        ),
        command("alpha", option("--wrong", value), {
          usageLine() {
            wrongCalls++;
            return [{ type: "literal", value: "WRONG" }];
          },
        }),
      );
      assert.equal(parser.mode, mode);
      assert.deepEqual(
        await parse(parser, ["alpha", "alpha", "--inside", "selected"]),
        {
          success: true,
          value: "selected",
        },
      );
      const child = await getDocPage(parser, ["alpha", "alpha"]);
      assert.ok(child?.usage);
      const text = formatUsage("app", child.usage, { expandCommands: true });
      assert.match(text, /alpha.*alpha CHILD/);
      assert.equal(parentCalls, 0);
      assert.equal(childCalls, 1);
      assert.equal(wrongCalls, 0);
      const parent = await getDocPage(parser, ["alpha"]);
      assert.ok(parent?.usage);
      assert.equal(
        formatUsage("app", parent.usage, { expandCommands: true }),
        "app alpha PARENT",
      );
      assert.equal(parentCalls, 1);
      assert.equal(childCalls, 1);
      assert.equal(wrongCalls, 0);
    });
  }
});
