import { concat, object, tuple } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { parseAsync } from "@optique/core/parser";
import { command, option, passThrough } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { it } from "node:test";
import { bindConfig, createConfigContext } from "./index.ts";
import { z } from "zod";
for (const outer of ["object", "tuple", "concat"] as const) {
  it(`config ${outer} preserves selected command option errors`, async () => {
    const cmd = command("run", optional(option("-m", string())));
    const bound = bindConfig(cmd, {
      context: createConfigContext({
        schema: z.object({ value: z.string().optional() }),
      }),
      key: "value",
    });
    const rest = passThrough({ format: "nextToken" });
    const parser = outer === "object"
      ? object({ bound, rest })
      : outer === "tuple"
      ? tuple([bound, rest])
      : concat(tuple([bound]), tuple([rest]));
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
  });
  it(`config ${outer} delegates selected command capture priority`, async () => {
    const cmd = command("run", passThrough({ format: "nextToken" }));
    const bound = bindConfig(cmd, {
      context: createConfigContext({
        schema: z.object({ args: z.array(z.string()) }),
      }),
      key: "args",
    });
    const known = optional(option("-m", string()));
    const parser = outer === "object"
      ? object({ bound, known })
      : outer === "tuple"
      ? tuple([bound, known])
      : concat(tuple([bound]), tuple([known]));
    const expected = await parseAsync<unknown>(known, ["-m"]);
    assert.ok(!expected.success);
    assert.deepEqual(
      await parseAsync<unknown>(parser, ["run", "-m"]),
      expected,
    );
  });
}
