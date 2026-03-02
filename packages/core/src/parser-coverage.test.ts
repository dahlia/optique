import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getAnnotations } from "./annotations.ts";
import { message } from "./message.ts";
import {
  getDocPage,
  getDocPageAsync,
  getDocPageSync,
  parse,
  type Parser,
  type ParserContext,
  suggest,
  suggestAsync,
  type Suggestion,
  suggestSync,
} from "./parser.ts";
import { command, constant } from "./primitives.ts";
import { or } from "./constructs.ts";

describe("parser.ts coverage branches", () => {
  it("dispatches parse() and suggest() by parser mode", async () => {
    const syncResult = parse(constant("sync-value"), []);
    assert.ok(syncResult.success);

    const asyncParser: Parser<"async", string, { readonly called: boolean }> = {
      $valueType: [] as readonly string[],
      $stateType: [] as readonly { readonly called: boolean }[],
      $mode: "async",
      priority: 0,
      usage: [],
      initialState: { called: false },
      parse(context) {
        return Promise.resolve({
          success: true,
          next: { ...context, buffer: [], state: { called: true } },
          consumed: [],
        });
      },
      complete(state) {
        return Promise.resolve({
          success: true,
          value: state.called ? "async-value" : "bad",
        });
      },
      async *suggest() {
        yield { kind: "literal", text: "async-suggestion" };
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    const asyncResult = await parse(asyncParser, []);
    assert.deepEqual(asyncResult, { success: true, value: "async-value" });

    const syncSuggestions = suggest(constant("x"), [""]);
    assert.deepEqual(syncSuggestions, []);

    const asyncSuggestions = await suggest(asyncParser, [""]);
    assert.deepEqual(asyncSuggestions, [
      { kind: "literal", text: "async-suggestion" },
    ]);
  });

  it("injects annotations into suggestSync() and suggestAsync() states", async () => {
    const annotation = Symbol("suggest-annotation");
    let syncState: unknown;
    let asyncState: unknown;

    const syncParser = {
      ...constant("ok"),
      suggest(context: ParserContext<unknown>, _prefix: string) {
        syncState = context.state;
        return [] as readonly Suggestion[];
      },
    } satisfies Parser<"sync", "ok", "ok">;

    const asyncParser: Parser<"async", "ok", number> = {
      $valueType: [] as readonly "ok"[],
      $stateType: [] as readonly number[],
      $mode: "async",
      priority: 0,
      usage: [],
      initialState: 1,
      parse(context) {
        return Promise.resolve({
          success: true,
          next: { ...context, buffer: [] },
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve({ success: true, value: "ok" as const });
      },
      suggest(context) {
        asyncState = context.state;
        return {
          async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
            yield* [];
          },
        };
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    suggestSync(syncParser, [""], {
      annotations: { [annotation]: "sync" },
    });
    await suggestAsync(asyncParser, [""], {
      annotations: { [annotation]: "async" },
    });

    assert.equal(getAnnotations(syncState)?.[annotation], "sync");
    assert.equal(getAnnotations(asyncState)?.[annotation], "async");
  });

  it("injects annotations into getDocPageSync() and getDocPageAsync()", async () => {
    const annotation = Symbol("doc-annotation");
    let syncDocState: unknown;
    let asyncDocState: unknown;

    const syncParser: Parser<"sync", "x", null> = {
      $valueType: [] as readonly "x"[],
      $stateType: [] as readonly null[],
      $mode: "sync",
      priority: 0,
      usage: [],
      initialState: null,
      parse() {
        return {
          success: false,
          consumed: 0,
          error: message`stop.`,
        };
      },
      complete() {
        return { success: true, value: "x" as const };
      },
      suggest() {
        return [];
      },
      getDocFragments(state) {
        syncDocState = state.kind === "available" ? state.state : undefined;
        return { fragments: [] };
      },
    };

    const asyncParser: Parser<"async", "x", number> = {
      $valueType: [] as readonly "x"[],
      $stateType: [] as readonly number[],
      $mode: "async",
      priority: 0,
      usage: [],
      initialState: 0,
      parse() {
        return Promise.resolve({
          success: false,
          consumed: 0,
          error: message`stop.`,
        });
      },
      complete() {
        return Promise.resolve({ success: true, value: "x" as const });
      },
      suggest() {
        return {
          async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
            yield* [];
          },
        };
      },
      getDocFragments(state) {
        asyncDocState = state.kind === "available" ? state.state : undefined;
        return { fragments: [] };
      },
    };

    getDocPageSync(syncParser, [], {
      annotations: { [annotation]: "sync-doc" },
    });
    await getDocPageAsync(asyncParser, ["unexpected"], {
      annotations: { [annotation]: "async-doc" },
    });

    assert.equal(getAnnotations(syncDocState)?.[annotation], "sync-doc");
    assert.equal(getAnnotations(asyncDocState)?.[annotation], "async-doc");
  });

  it("handles unresolved nested exclusive terms and extra args in getDocPage", () => {
    const parser = or(
      or(command("alpha", constant("a")), command("beta", constant("b"))),
      command("gamma", constant("c")),
    );

    const doc = getDocPage(parser, ["unknown", "extra"]);
    assert.ok(doc);
    assert.ok(Array.isArray(doc.usage));
  });

  it("parseAsync: parse() returns failure", async () => {
    const failing: Parser<"async", never, null> = {
      $valueType: [] as readonly never[],
      $stateType: [] as readonly null[],
      $mode: "async",
      priority: 0,
      usage: [],
      initialState: null,
      parse() {
        return Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`async parse failed`,
        });
      },
      complete() {
        return Promise.resolve({
          success: true as const,
          value: null as never,
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [], brief: undefined };
      },
    };
    const result = await parse(failing, ["arg"]);
    assert.equal(result.success, false);
  });

  it("parseAsync: complete() returns failure", async () => {
    const failOnComplete: Parser<"async", never, string> = {
      $valueType: [] as readonly never[],
      $stateType: [] as readonly string[],
      $mode: "async",
      priority: 0,
      usage: [],
      initialState: "init",
      parse(context) {
        return Promise.resolve({
          success: true as const,
          next: { ...context, buffer: [], state: "done" },
          consumed: context.buffer.slice(0, 1),
        });
      },
      complete() {
        return Promise.resolve({
          success: false as const,
          error: message`async complete failed`,
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [], brief: undefined };
      },
    };
    const result = await parse(failOnComplete, ["tok"]);
    assert.equal(result.success, false);
  });

  it("parseAsync: infinite loop detection", async () => {
    const stalling: Parser<"async", never, number> = {
      $valueType: [] as readonly never[],
      $stateType: [] as readonly number[],
      $mode: "async",
      priority: 0,
      usage: [],
      initialState: 0,
      parse(context) {
        return Promise.resolve({
          success: true as const,
          next: { ...context, state: (context.state as number) + 1 },
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve({
          success: true as const,
          value: null as never,
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [], brief: undefined };
      },
    };
    const result = await parse(stalling, ["stuck"]);
    assert.equal(result.success, false);
  });

  it("suggestSync: parse failure fallback", () => {
    const failingWithSuggestions: Parser<"sync", never, null> = {
      $valueType: [] as readonly never[],
      $stateType: [] as readonly null[],
      $mode: "sync",
      priority: 0,
      usage: [],
      initialState: null,
      parse() {
        return {
          success: false as const,
          consumed: 0,
          error: message`nope`,
        };
      },
      complete() {
        return { success: true as const, value: null as never };
      },
      *suggest(_context, _prefix): Generator<Suggestion> {
        yield { kind: "literal", text: "--fallback" };
      },
      getDocFragments() {
        return { fragments: [], brief: undefined };
      },
    };
    const result = suggestSync(failingWithSuggestions, ["tok", "pre"]);
    assert.ok(
      result.some((s) => s.kind === "literal" && s.text === "--fallback"),
    );
  });

  it("suggestSync: infinite loop guard returns []", () => {
    const stalling: Parser<"sync", never, number> = {
      $valueType: [] as readonly never[],
      $stateType: [] as readonly number[],
      $mode: "sync",
      priority: 0,
      usage: [],
      initialState: 0,
      parse(context) {
        return {
          success: true as const,
          next: { ...context, state: (context.state as number) + 1 },
          consumed: [],
        };
      },
      complete() {
        return { success: true as const, value: null as never };
      },
      *suggest() {},
      getDocFragments() {
        return { fragments: [], brief: undefined };
      },
    };
    const result = suggestSync(stalling, ["stuck", "pre"]);
    assert.deepEqual(result, []);
  });

  it("suggestAsync: parse failure fallback", async () => {
    const failingAsync: Parser<"async", never, null> = {
      $valueType: [] as readonly never[],
      $stateType: [] as readonly null[],
      $mode: "async",
      priority: 0,
      usage: [],
      initialState: null,
      parse() {
        return Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`nope`,
        });
      },
      complete() {
        return Promise.resolve({
          success: true as const,
          value: null as never,
        });
      },
      async *suggest(_context, _prefix): AsyncGenerator<Suggestion> {
        yield { kind: "literal", text: "--async-fallback" };
      },
      getDocFragments() {
        return { fragments: [], brief: undefined };
      },
    };
    const result = await suggestAsync(failingAsync, ["tok", "pre"]);
    assert.ok(
      result.some((s) => s.kind === "literal" && s.text === "--async-fallback"),
    );
  });

  it("suggestAsync: infinite loop guard returns []", async () => {
    const stalling: Parser<"async", never, number> = {
      $valueType: [] as readonly never[],
      $stateType: [] as readonly number[],
      $mode: "async",
      priority: 0,
      usage: [],
      initialState: 0,
      parse(context) {
        return Promise.resolve({
          success: true as const,
          next: { ...context, state: (context.state as number) + 1 },
          consumed: [],
        });
      },
      complete() {
        return Promise.resolve({
          success: true as const,
          value: null as never,
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [], brief: undefined };
      },
    };
    const result = await suggestAsync(stalling, ["stuck", "pre"]);
    assert.deepEqual(result, []);
  });

  it("getDocPageAsync with sync parser (fast path)", async () => {
    const syncParser = constant("test");
    const doc = await getDocPageAsync(syncParser, []);
    assert.ok(doc);
    assert.ok(Array.isArray(doc.usage));
  });
});
