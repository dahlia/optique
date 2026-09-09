import assert from "node:assert/strict";
import test from "node:test";
import type { ParserValuePlaceholder, SourceContext } from "#src/context.ts";
import {
  type ExtractRequiredOptions,
  type RunOptions,
  runParser,
  runParserAsync,
  runParserSync,
  runWith,
  runWithAsync,
  type RunWithOptions,
  runWithSync,
} from "#src/facade.ts";
import { type Message, message } from "#src/message.ts";
import { argument } from "#src/primitives.ts";
import { string } from "#src/valueparser.ts";

interface NoOptionsContext extends SourceContext {}

interface ConfigPathContext extends
  SourceContext<{
    readonly getConfigPath: (
      parsed: ParserValuePlaceholder,
    ) => string | undefined;
  }> {}

interface LocaleContext extends
  SourceContext<{
    readonly locale: string;
  }> {}

test("ExtractRequiredOptions keeps required options with void contexts", () => {
  type Required = ExtractRequiredOptions<
    readonly [NoOptionsContext, ConfigPathContext],
    { config: string }
  >;

  const options: Required = {
    getConfigPath: (parsed) => {
      // @ts-expect-error Parser value should not be any.
      void parsed.nonexistent;
      return parsed.config;
    },
  };

  assert.equal(
    options.getConfigPath({ config: "optique.json" }),
    "optique.json",
  );
});

test("ExtractRequiredOptions intersects required option objects", () => {
  type Required = ExtractRequiredOptions<
    readonly [ConfigPathContext, LocaleContext],
    { config: string }
  >;

  const options: Required = {
    getConfigPath: (parsed) => parsed.config,
    locale: "en-US",
  };

  assert.equal(options.locale, "en-US");
  assert.equal(options.getConfigPath({ config: "app.json" }), "app.json");
});

test("RunOptions preserves handler assignability and types the error argument", () => {
  const legacy: {
    readonly onError?: (() => string) | ((code: number) => string);
  } = {
    onError: (code) => String(code),
  };
  const callbacks: readonly RunOptions<void, string>[] = [
    { onError: () => "handled" },
    { onError: (code) => String(code) },
    { onError: (code?: number) => String(code) },
    legacy,
  ];
  const exits: RunOptions<void, never> = { onError: process.exit };
  const options: RunWithOptions<void, string> = {
    onError(code, error) {
      const exitCode: number = code;
      const structured: Message = error;
      // Keep intentionally invalid code out of Node.js/Bun execution.
      function invalidAssignments() {
        // @ts-expect-error The exit code is not any or a string.
        const text: string = code;
        // @ts-expect-error The error is structured, not any or a string.
        const rendered: string = error;
        void [text, rendered];
      }
      void invalidAssignments;
      return `${exitCode}:${structured.length}`;
    },
  };
  function invalidInvocations() {
    // @ts-expect-error Forwarders must provide the structured message.
    options.onError?.(1);
    // @ts-expect-error Rendered text is not a Message.
    options.onError?.(1, "error");
  }
  void invalidInvocations;
  void exits;
  for (const callback of callbacks) {
    assert.equal(typeof callback.onError?.(1, message`Bad input.`), "string");
  }
  assert.equal(options.onError?.(1, message`Bad input.`), "1:1");
});

test("Structured error callbacks preserve runner return inference", async () => {
  const parser = argument(string());
  const options = {
    args: ["value"],
    onError: (_code: number, _error: Message) => 42,
  };
  const inferred = runParser(parser, "test", ["value"], options);
  const sync = runParserSync(parser, "test", ["value"], options);
  const async = runParserAsync(parser, "test", ["value"], options);
  const withContext = runWith(parser, "test", [], options);
  const withSync = runWithSync(parser, "test", [], options);
  const withAsync = runWithAsync(parser, "test", [], options);
  const program = runParser(
    { parser, metadata: { name: "test" } },
    ["value"],
    options,
  );
  type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends
    (<T>() => T extends B ? 1 : 2) ? true : false;
  const types: [
    Equal<typeof inferred, string>,
    Equal<typeof sync, string>,
    Equal<typeof async, Promise<string>>,
    Equal<typeof withContext, Promise<string>>,
    Equal<typeof withSync, string>,
    Equal<typeof withAsync, Promise<string>>,
    Equal<typeof program, string>,
  ] = [true, true, true, true, true, true, true];
  void types;
  assert.deepEqual(
    await Promise.all([
      inferred,
      sync,
      async,
      withContext,
      withSync,
      withAsync,
      program,
    ]),
    Array.from({ length: 7 }, () => "value"),
  );
});
