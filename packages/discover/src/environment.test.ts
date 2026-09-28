import assert from "node:assert/strict";
import { it } from "node:test";
import { constant } from "@optique/core/primitives";
import { getDocPageAsync } from "@optique/core/parser";
import { defineCommand } from "./command.ts";
import { createProgramParser } from "./index.ts";

it("collects root environment records without scanning descendant commands", async () => {
  const source = (name: string) => ({
    ...constant("unused"),
    getDocFragments: () => ({
      fragments: [],
      sourceOnly: true as const,
      environmentBindings: [{ name }],
    }),
  });
  for (const commandList of ["recursive", "top-level"] as const) {
    const parser = createProgramParser([
      {
        path: [],
        command: defineCommand({ parser: source("ROOT"), handler() {} }),
      },
      {
        path: ["build"],
        command: defineCommand({ parser: source("CHILD"), handler() {} }),
      },
      {
        path: ["build", "deep"],
        command: defineCommand({ parser: source("DEEP"), handler() {} }),
      },
    ], { commandList });
    assert.deepEqual(
      (await getDocPageAsync(parser))?.environmentBindings?.map((d) => d.name),
      ["ROOT"],
    );
    assert.deepEqual(
      (await getDocPageAsync(parser, ["build"]))?.environmentBindings?.map((
        d,
      ) => d.name),
      ["CHILD"],
    );
    assert.deepEqual(
      (await getDocPageAsync(parser, ["build", "deep"]))?.environmentBindings
        ?.map((d) => d.name),
      ["DEEP"],
    );
  }
});
