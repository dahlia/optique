import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createKeyringContext,
  type KeyringContext,
  type KeyringContextOptions,
  type KeyringSource,
} from "#src/index.ts";

describe("createKeyringContext()", () => {
  it("should expose the public source and context contracts", () => {
    const source: KeyringSource = () => Promise.resolve(undefined);
    const options = { source } satisfies KeyringContextOptions;
    const context: KeyringContext = createKeyringContext(options);

    assert.equal(context.phase, "single-pass");
    assert.equal(context.source, source);
  });

  it("should create a unique context identity", () => {
    const first = createKeyringContext({
      source: () => Promise.resolve(undefined),
    });
    const second = createKeyringContext({
      source: () => Promise.resolve(undefined),
    });

    assert.notEqual(first.id, second.id);
  });

  it("should snapshot the selected source without invoking it", async () => {
    let calls = 0;
    const first: KeyringSource = () => {
      calls++;
      return Promise.resolve(undefined);
    };
    const second: KeyringSource = () => Promise.resolve("unused");
    const options: { source?: KeyringSource } = { source: first };
    const context = createKeyringContext(options);

    options.source = second;
    const annotations = await context.getAnnotations();
    const snapshot = Reflect.get(annotations, context.id);

    assert.equal(calls, 0);
    assert.ok(snapshot != null && typeof snapshot === "object");
    assert.equal(Reflect.get(snapshot, "source"), first);
  });

  it("should keep the default source lazy", async () => {
    const context = createKeyringContext();

    const annotations = await context.getAnnotations();

    assert.equal(context.phase, "single-pass");
    assert.ok(context.id in annotations);
    assert.equal(typeof context.source, "function");
  });

  it("should reject a non-function custom source", () => {
    assert.throws(
      () => Reflect.apply(createKeyringContext, undefined, [{ source: 1 }]),
      {
        name: "TypeError",
        message: "Expected source to be a function, but got: number.",
      },
    );
  });
});
