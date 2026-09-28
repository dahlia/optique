import assert from "node:assert/strict";
import { it } from "node:test";
import { constant, fail, option } from "@optique/core/primitives";
import { getDocPageAsync } from "@optique/core/parser";
import { string } from "@optique/core/valueparser";
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

it("preserves the source-only capability on root-only programs", () => {
  for (const source of [fail<string>(), constant("unused")]) {
    const parser = createProgramParser([
      { path: [], command: defineCommand({ parser: source, handler() {} }) },
    ]);
    for (
      const state of [
        { kind: "unavailable" as const },
        { kind: "available" as const, state: parser.initialState },
      ]
    ) {
      assert.ok(parser.getDocFragments(state).sourceOnly);
    }
  }
});

it("does not infer source-only capability from empty or unknown root documentation", () => {
  const unknown = {
    ...constant("unused"),
    getDocFragments: () => ({ fragments: [] }),
  };
  for (const source of [unknown, option("--name", string())]) {
    const parser = createProgramParser([
      { path: [], command: defineCommand({ parser: source, handler() {} }) },
    ]);
    assert.ok(!parser.getDocFragments({ kind: "unavailable" }).sourceOnly);
  }
  const rootless = createProgramParser([
    {
      path: ["build"],
      command: defineCommand({ parser: constant("child"), handler() {} }),
    },
  ]);
  assert.ok(!rootless.getDocFragments({ kind: "unavailable" }).sourceOnly);
});

it("revokes root source-only capability when commands are listed", () => {
  for (const commandList of ["recursive", "top-level"] as const) {
    for (const hidden of [false, true]) {
      const parser = createProgramParser([
        {
          path: [],
          command: defineCommand({ parser: constant("unused"), handler() {} }),
        },
        {
          path: ["build"],
          command: defineCommand({
            parser: constant("child"),
            metadata: { hidden },
            handler() {},
          }),
        },
      ], { commandList });
      assert.ok(!parser.getDocFragments({ kind: "unavailable" }).sourceOnly);
    }
  }
});
