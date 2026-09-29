import {
  concat,
  conditional,
  group,
  object,
  tuple,
} from "@optique/core/constructs";
import { map, multiple, optional, withDefault } from "@optique/core/modifiers";
import { parseAsync } from "@optique/core/parser";
import {
  command,
  constant,
  option,
  passThrough,
} from "@optique/core/primitives";
import { string, type ValueParser } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { it } from "node:test";

const asyncString: ValueParser<"async", string> = {
  mode: "async",
  metavar: "STRING",
  placeholder: "",
  format: (value) => value,
  parse: (input) => Promise.resolve({ success: true, value: input }),
};
for (const mode of ["sync", "async"] as const) {
  const value = mode === "sync" ? string() : asyncString;
  for (const outer of ["object", "tuple", "concat"] as const) {
    it(`${mode} ${outer} preserves selected command option errors`, async () => {
      const cmd = command("run", optional(option("-m", value)));
      const extra = passThrough({ format: "nextToken" });
      const parser = outer === "object"
        ? object({ cmd, extra })
        : outer === "tuple"
        ? tuple([cmd, extra])
        : concat(tuple([cmd]), tuple([extra]));
      const expected = await parseAsync<unknown>(cmd, ["run", "-m"]);
      assert.ok(!expected.success);
      assert.deepEqual(
        await parseAsync<unknown>(parser, ["run", "-m"]),
        expected,
      );
      assert.ok(
        (await parseAsync<unknown>(parser, ["run", "-m", "hello", "--unknown"]))
          .success,
      );
      for (
        const wrapped of [
          optional(cmd),
          withDefault(cmd, undefined),
          map(cmd, (value) => value),
          group("Command", cmd),
          multiple(cmd),
          object({ cmd }),
          tuple([cmd]),
          concat(tuple([cmd])),
        ]
      ) {
        const rest = passThrough({ format: "greedy" });
        const nested = outer === "object"
          ? object({ cmd: wrapped, rest })
          : outer === "tuple"
          ? tuple([wrapped, rest])
          : concat(tuple([wrapped]), tuple([rest]));
        assert.deepEqual(
          await parseAsync<unknown>(nested, ["run", "-m"]),
          expected,
        );
      }
      const inactive = object({
        cmd: optional(cmd),
        extra: passThrough({ format: "nextToken" }),
      });
      assert.deepEqual(await parseAsync<unknown>(inactive, ["-m"]), {
        success: true,
        value: { cmd: undefined, extra: ["-m"] },
      });
    });

    it(`${mode} ${outer} tries a known option before selected command capture`, async () => {
      const extra = command("run", passThrough({ format: "nextToken" }));
      const known = optional(option("-m", value));
      const parser = outer === "object"
        ? object({ extra, known })
        : outer === "tuple"
        ? tuple([extra, known])
        : concat(tuple([extra]), tuple([known]));
      assert.deepEqual(
        await parseAsync<unknown>(parser, ["run", "-m", "hello"]),
        {
          success: true,
          value: outer === "object"
            ? { extra: [], known: "hello" }
            : [[], "hello"],
        },
      );
      assert.deepEqual(
        await parseAsync<unknown>(parser, ["run", "-m"]),
        await parseAsync<unknown>(known, ["-m"]),
      );
    });

    it(`${mode} ${outer} honors capture priority above the matching nested option lane`, async () => {
      const extra = { ...passThrough({ format: "nextToken" }), priority: 12 };
      const known = object({
        cmd: optional(command("run", constant(undefined))),
        message: optional(option("-m", value)),
      });
      const parser = outer === "object"
        ? object({ extra, known })
        : outer === "tuple"
        ? tuple([extra, known])
        : concat(tuple([extra]), tuple([known]));
      assert.deepEqual(await parseAsync<unknown>(parser, ["-m"]), {
        success: true,
        value: outer === "object"
          ? { extra: ["-m"], known: { cmd: undefined, message: undefined } }
          : [["-m"], { cmd: undefined, message: undefined }],
      });
      const overridden = { ...known, priority: 13 };
      const overrideParser = outer === "object"
        ? object({ extra, known: overridden })
        : outer === "tuple"
        ? tuple([extra, overridden])
        : concat(tuple([extra]), tuple([overridden]));
      assert.deepEqual(
        await parseAsync<unknown>(overrideParser, ["-m"]),
        await parseAsync<unknown>(known, ["-m"]),
      );
    });

    it(`${mode} ${outer} preserves conditional capture priority`, async () => {
      const extra = conditional({ ...constant("run"), priority: 15 }, {
        run: passThrough({ format: "nextToken" }),
      });
      const known = optional(option("-m", value));
      const parser = outer === "object"
        ? object({ extra, known })
        : outer === "tuple"
        ? tuple([extra, known])
        : concat(tuple([extra]), tuple([known]));
      assert.deepEqual(
        await parseAsync<unknown>(parser, ["-m", "hello"]),
        {
          success: true,
          value: outer === "object"
            ? { extra: ["run", []], known: "hello" }
            : [["run", []], "hello"],
        },
      );
      assert.deepEqual(
        await parseAsync<unknown>(parser, ["-m"]),
        await parseAsync<unknown>(known, ["-m"]),
      );
    });
  }
}
