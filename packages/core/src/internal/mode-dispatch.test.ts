import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { wrapIterableForMode } from "./mode-dispatch.ts";

describe("wrapIterableForMode", () => {
  it("should reject non-object sync values without in-operator errors", () => {
    assert.throws(() => {
      try {
        [...wrapIterableForMode("sync", null as never)];
      } catch (error) {
        assert.ok(error instanceof TypeError);
        assert.ok(!error.message.includes("in' operator"));
        throw error;
      }
    }, TypeError);
  });

  it("should reject non-object async values without in-operator errors", async () => {
    await assert.rejects(async () => {
      try {
        for await (const _ of wrapIterableForMode("async", null as never)) {
          // Iteration triggers the wrapped async generator body.
        }
      } catch (error) {
        assert.ok(error instanceof TypeError);
        assert.ok(!error.message.includes("in' operator"));
        throw error;
      }
    }, TypeError);
  });
});
