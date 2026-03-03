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

  // Branch coverage: null initialState with annotations (typeof === "object"
  // but === null), covering the else-branch of the null guard in parseAsync,
  // suggestSync, suggestAsync, getDocPageSyncImpl, getDocPageAsyncImpl.
  it("parseAsync: null initialState with annotations", async () => {
    const annotation = Symbol("parseAsync-null-init");
    let capturedState: unknown;

    const nullInitParser: Parser<"async", "ok", null> = {
      $valueType: [] as readonly "ok"[],
      $stateType: [] as readonly null[],
      $mode: "async",
      priority: 0,
      usage: [],
      initialState: null,
      parse(context) {
        capturedState = context.state;
        return Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`stop`,
        });
      },
      complete() {
        return Promise.resolve({
          success: true as const,
          value: "ok" as const,
        });
      },
      async *suggest() {},
      getDocFragments() {
        return { fragments: [] };
      },
    };

    await parse(nullInitParser, ["arg"], {
      annotations: { [annotation]: "null-init-async" },
    });
    // The annotation key should be merged on top of {} (not null)
    assert.ok(
      capturedState !== null && typeof capturedState === "object",
      "state should be an object (not null) after annotation injection",
    );
  });

  it("suggestSync: null initialState with annotations", () => {
    const annotation = Symbol("suggestSync-null-init");
    let capturedState: unknown;

    const nullInitParser: Parser<"sync", never, null> = {
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
          error: message`stop`,
        };
      },
      complete() {
        return { success: true as const, value: null as never };
      },
      suggest(context): readonly Suggestion[] {
        capturedState = context.state;
        return [];
      },
      getDocFragments() {
        return { fragments: [] };
      },
    };

    suggestSync(nullInitParser, [""], {
      annotations: { [annotation]: "null-init-sync" },
    });
    assert.ok(
      capturedState !== null && typeof capturedState === "object",
      "state should be an object (not null) after annotation injection",
    );
  });

  it("suggestAsync: null initialState with annotations", async () => {
    const annotation = Symbol("suggestAsync-null-init");
    let capturedState: unknown;

    const nullInitParser: Parser<"async", never, null> = {
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
          error: message`stop`,
        });
      },
      complete() {
        return Promise.resolve({
          success: true as const,
          value: null as never,
        });
      },
      suggest(context) {
        capturedState = context.state;
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

    await suggestAsync(nullInitParser, [""], {
      annotations: { [annotation]: "null-init-async-suggest" },
    });
    assert.ok(
      capturedState !== null && typeof capturedState === "object",
      "state should be an object (not null) after annotation injection",
    );
  });

  it("getDocPageSync: null initialState with annotations", () => {
    const annotation = Symbol("getDocPageSync-null-init");
    let capturedState: unknown;

    const nullInitParser: Parser<"sync", never, null> = {
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
          error: message`stop`,
        };
      },
      complete() {
        return { success: true as const, value: null as never };
      },
      *suggest(): Generator<Suggestion> {},
      getDocFragments(stateArg) {
        capturedState = stateArg.kind === "available"
          ? stateArg.state
          : undefined;
        return { fragments: [] };
      },
    };

    getDocPageSync(nullInitParser, [], {
      annotations: { [annotation]: "null-init-doc-sync" },
    });
    assert.ok(
      capturedState !== null && typeof capturedState === "object",
      "state should be an object (not null) after annotation injection",
    );
  });

  it("getDocPageAsync: null initialState with annotations", async () => {
    const annotation = Symbol("getDocPageAsync-null-init");
    let capturedState: unknown;

    const nullInitParser: Parser<"async", never, null> = {
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
          error: message`stop`,
        });
      },
      complete() {
        return Promise.resolve({
          success: true as const,
          value: null as never,
        });
      },
      suggest() {
        return {
          async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {
            yield* [];
          },
        };
      },
      getDocFragments(stateArg) {
        capturedState = stateArg.kind === "available"
          ? stateArg.state
          : undefined;
        return { fragments: [] };
      },
    };

    await getDocPageAsync(nullInitParser, [], {
      annotations: { [annotation]: "null-init-doc-async" },
    });
    assert.ok(
      capturedState !== null && typeof capturedState === "object",
      "state should be an object (not null) after annotation injection",
    );
  });

  it("annotation injection replaces primitive initial states with objects", async () => {
    const annotation = Symbol("primitive-init-annotation");
    let syncSuggestState: unknown;
    let asyncSuggestState: unknown;
    let docSyncState: unknown;
    let docAsyncState: unknown;

    const syncParser: Parser<"sync", never, number> = {
      $valueType: [] as readonly never[],
      $stateType: [] as readonly number[],
      $mode: "sync",
      priority: 0,
      usage: [],
      initialState: 123,
      parse() {
        return { success: false as const, consumed: 0, error: message`stop` };
      },
      complete() {
        return { success: true as const, value: null as never };
      },
      suggest(context) {
        syncSuggestState = context.state;
        return [] as readonly Suggestion[];
      },
      getDocFragments(stateArg) {
        docSyncState = stateArg.kind === "available"
          ? stateArg.state
          : undefined;
        return { fragments: [] };
      },
    };

    const asyncParser: Parser<"async", never, number> = {
      $valueType: [] as readonly never[],
      $stateType: [] as readonly number[],
      $mode: "async",
      priority: 0,
      usage: [],
      initialState: 456,
      parse() {
        return Promise.resolve({
          success: false as const,
          consumed: 0,
          error: message`stop`,
        });
      },
      complete() {
        return Promise.resolve({
          success: true as const,
          value: null as never,
        });
      },
      suggest(context) {
        asyncSuggestState = context.state;
        return {
          async *[Symbol.asyncIterator](): AsyncIterableIterator<Suggestion> {},
        };
      },
      getDocFragments(stateArg) {
        docAsyncState = stateArg.kind === "available"
          ? stateArg.state
          : undefined;
        return { fragments: [] };
      },
    };

    suggestSync(syncParser, [""], { annotations: { [annotation]: "sync" } });
    await suggestAsync(asyncParser, [""], {
      annotations: { [annotation]: "async" },
    });
    getDocPageSync(syncParser, [], {
      annotations: { [annotation]: "doc-sync" },
    });
    await getDocPageAsync(asyncParser, [], {
      annotations: { [annotation]: "doc-async" },
    });

    assert.ok(
      syncSuggestState !== null && typeof syncSuggestState === "object",
      "sync suggest state should become an object",
    );
    assert.ok(
      asyncSuggestState !== null && typeof asyncSuggestState === "object",
      "async suggest state should become an object",
    );
    assert.ok(
      docSyncState !== null && typeof docSyncState === "object",
      "sync doc state should become an object",
    );
    assert.ok(
      docAsyncState !== null && typeof docAsyncState === "object",
      "async doc state should become an object",
    );
  });

  it("getDocPage handles non-exclusive usage terms", () => {
    const doc = getDocPage(command("plain", constant("ok")), ["unknown"]);
    assert.ok(doc);
    assert.ok(Array.isArray(doc.sections));
  });

  it("getDocPage expands nested exclusive branch with trailing terms", () => {
    const parser = or(
      or(command("inner", constant("i")), command("other", constant("o"))),
      command("outer", constant("x")),
    );
    const doc = getDocPage(parser, ["inner"]);
    assert.ok(doc);
    assert.ok(doc.usage);
    assert.ok(
      doc.usage.some((term) =>
        term.type === "command" && term.name === "inner"
      ),
    );
  });

  // Branch coverage: findCommandInExclusive recursive path (line 759).
  // Requires nested or(or(cmd, cmd), cmd) where the inner command name is
  // passed as the first argument so the recursive exclusive branch is taken.
  it("getDocPage: nested or() resolves inner command via recursive exclusive", () => {
    const parser = or(
      or(command("alpha", constant("a")), command("beta", constant("b"))),
      command("gamma", constant("c")),
    );

    // "alpha" is inside the inner or() — triggers the recursive exclusive path
    const doc = getDocPage(parser, ["alpha"]);
    assert.ok(doc);
    assert.ok(Array.isArray(doc.usage));
    // After resolving "alpha", the usage should no longer show the outer
    // exclusive — it should have been replaced with the inner command's terms
    const hasAlphaCommand = doc.usage.some(
      (term) => term.type === "command" && term.name === "alpha",
    );
    assert.ok(
      hasAlphaCommand,
      "usage should contain the resolved alpha command",
    );
  });
});
