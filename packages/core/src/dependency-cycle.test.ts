import { test } from "node:test";
import * as assert from "node:assert/strict";
import { dependency } from "./dependency.ts";
import { parseSync } from "./parser.ts";
import {
  choice,
  type ValueParser,
  type ValueParserResult,
} from "./valueparser.ts";
import { object } from "./constructs.ts";
import { option } from "./primitives.ts";
import type { NonEmptyString } from "./nonempty.ts";

test("dependency resolution handles cyclic plain objects", () => {
  type CyclicValue = {
    id: string;
    self?: CyclicValue;
  };

  const modeParser = dependency(choice(["dev", "prod"] as const));
  const derivedParser = modeParser.derive({
    metavar: "VALUE",
    defaultValue: () => "dev" as const,
    factory: (mode: "dev" | "prod") =>
      choice(mode === "dev" ? (["a"] as const) : (["b"] as const)),
  });

  const cyclicValue: CyclicValue = { id: "meta" };
  cyclicValue.self = cyclicValue;

  const cyclicParser: ValueParser<"sync", CyclicValue> = {
    $mode: "sync",
    metavar: "META" as NonEmptyString,
    parse(): ValueParserResult<CyclicValue> {
      return { success: true, value: cyclicValue };
    },
    format(): string {
      return "meta";
    },
    *suggest() {},
  };

  const parser = object({
    mode: option("--mode", modeParser),
    value: option("--value", derivedParser),
    meta: option("--meta", cyclicParser),
  });

  const result = parseSync(parser, [
    "--mode",
    "dev",
    "--value",
    "a",
    "--meta",
    "meta",
  ]);

  assert.ok(result.success);
  if (result.success) {
    assert.equal(result.value.mode, "dev");
    assert.equal(result.value.value, "a");
    assert.equal(result.value.meta.id, "meta");
    assert.equal(result.value.meta.self?.id, "meta");
  }
});
