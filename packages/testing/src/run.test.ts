import type { ShellCompletion } from "@optique/core/completion";
import type {
  ParserValuePlaceholder,
  SourceContext,
} from "@optique/core/context";
import { object } from "@optique/core/constructs";
import type { Parser } from "@optique/core/parser";
import type { Program } from "@optique/core/program";
import { argument, constant, option } from "@optique/core/primitives";
import type { ValueParser } from "@optique/core/valueparser";
import { string } from "@optique/core/valueparser";
import type { RunOptions } from "@optique/run";
import {
  type CapturedRunResult,
  captureRun,
  type CaptureRunOptions,
} from "@optique/testing/run";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("captureRun()", () => {
  it("should capture a normal return with its inferred value", async () => {
    // Arrange
    const parser = constant("ready" as const);

    // Act
    const promise = captureRun(parser, { args: [] });
    const result = await promise;

    // Assert
    assert.ok(promise instanceof Promise);
    assert.equal(result.kind, "returned");
    if (result.kind === "returned") {
      const value: "ready" = result.value;
      assert.equal(value, "ready");
      assert.equal(result.exitCode, 0);
    }
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, "");
  });

  it("should accept a Program and preserve its inferred value", async () => {
    // Arrange
    const program: Program<"sync", { readonly name: string }> = {
      parser: object({ name: argument(string()) }),
      metadata: { name: "greeter" },
    };

    // Act
    const result = await captureRun(program, { args: ["Ada"] });

    // Assert
    assert.deepEqual(result, {
      kind: "returned",
      value: { name: "Ada" },
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  });

  it("should run asynchronous parsers", async () => {
    // Arrange
    const parser = argument(asyncUppercase());

    // Act
    const result = await captureRun(parser, { args: ["hello"] });

    // Assert
    assert.equal(result.kind, "returned");
    if (result.kind === "returned") {
      const value: string = result.value;
      assert.equal(value, "HELLO");
    }
  });

  it("should capture help with the default writer newline", async () => {
    // Arrange
    const parser = constant("unused");

    // Act
    const result = await captureRun(parser, {
      args: ["--help"],
      programName: "tool",
      help: "option",
      colors: false,
      maxWidth: 80,
    });

    // Assert
    assert.deepEqual(result, {
      kind: "exited",
      exitCode: 0,
      stdout: "Usage: tool --help\n\n" +
        "  --help                      Show help information.\n\n",
      stderr: "",
    });
  });

  it("should capture version output exactly", async () => {
    // Arrange
    const parser = constant("unused");

    // Act
    const result = await captureRun(parser, {
      args: ["--version"],
      programName: "tool",
      version: "vβ 2+build",
      colors: false,
      maxWidth: 80,
    });

    // Assert
    assert.deepEqual(result, {
      kind: "exited",
      exitCode: 0,
      stdout: "vβ 2+build\n",
      stderr: "",
    });
  });

  it("should capture completion scripts and each suggestion chunk", async () => {
    // Arrange
    const shell: ShellCompletion = {
      name: "custom",
      generateScript(programName, args = []) {
        return `script:${programName}:${args.join(",")}`;
      },
      *encodeSuggestions() {
        yield "first";
        yield "second";
      },
    };
    const completion = {
      command: true as const,
      shells: { custom: shell },
    };

    // Act
    const script = await captureRun(constant("unused"), {
      args: ["completion", "custom"],
      programName: "tool",
      completion,
      colors: false,
      maxWidth: 80,
    });
    const suggestions = await captureRun(option("--verbose"), {
      args: ["completion", "custom", "--"],
      programName: "tool",
      completion,
      colors: false,
      maxWidth: 80,
    });

    // Assert
    assert.deepEqual(script, {
      kind: "exited",
      exitCode: 0,
      stdout: "script:tool:completion,custom\n",
      stderr: "",
    });
    assert.deepEqual(suggestions, {
      kind: "exited",
      exitCode: 0,
      stdout: "first\nsecond\n",
      stderr: "",
    });
  });

  it("should capture parse errors and custom exit codes", async () => {
    // Arrange
    const parser = argument(string());

    // Act
    const result = await captureRun(parser, {
      args: [],
      programName: "tool",
      help: "option",
      colors: false,
      maxWidth: 80,
      errorExitCode: 7,
    });

    // Assert
    assert.deepEqual(result, {
      kind: "exited",
      exitCode: 7,
      stdout: "",
      stderr: "Usage: tool --help\n" +
        "       tool STRING\n" +
        "Error: Expected an argument, but got end of input.\n",
    });
  });

  it("should rethrow parser errors by identity", async () => {
    // Arrange
    const failure = new RangeError("Parser failed.");
    const base = constant("unused");
    const parser: Parser<"sync", string, typeof base.initialState> = {
      ...base,
      complete() {
        throw failure;
      },
    };

    // Act and assert
    await assert.rejects(
      captureRun(parser, { args: [] }),
      (error) => {
        assert.equal(error, failure);
        return true;
      },
    );
  });

  it("should rethrow asynchronous parser rejections by identity", async () => {
    // Arrange
    const failure = new SyntaxError("Value parsing failed.");
    const parser = argument(rejectingString(failure));

    // Act and assert
    await assert.rejects(
      captureRun(parser, { args: ["value"] }),
      (error) => {
        assert.equal(error, failure);
        return true;
      },
    );
  });

  it("should rethrow option callback errors by identity", async () => {
    // Arrange
    const failure = new Error("Usage rendering failed.");

    // Act and assert
    await assert.rejects(
      captureRun(constant("unused"), {
        args: ["--help"],
        help: "option",
        usageLine() {
          throw failure;
        },
      }),
      (error) => {
        assert.equal(error, failure);
        return true;
      },
    );
  });

  it("should rethrow context errors by identity", async () => {
    // Arrange
    const failure = new Error("Context failed.");
    const context: SourceContext = {
      id: Symbol("failing-context"),
      phase: "single-pass",
      getAnnotations() {
        throw failure;
      },
    };

    // Act and assert
    await assert.rejects(
      captureRun(constant("unused"), { args: [], contexts: [context] }),
      (error) => {
        assert.equal(error, failure);
        return true;
      },
    );
  });

  it("should forward context options", async () => {
    // Arrange
    let receivedOptions: unknown;
    const context: SourceContext<{ readonly profile: string }> = {
      id: Symbol("context-options"),
      phase: "single-pass",
      getAnnotations(_request, options) {
        receivedOptions = options;
        return {};
      },
    };

    // Act
    await captureRun(constant("unused"), {
      args: [],
      contexts: [context],
      contextOptions: { profile: "test" },
    });

    // Assert
    assert.deepEqual(receivedOptions, { profile: "test" });
  });

  it("should not mistake structurally similar thrown values for exits", async () => {
    // Arrange
    const failure = { exitCode: 17 };

    // Act and assert
    await assert.rejects(
      captureRun(constant("unused"), {
        args: ["--help"],
        help: "option",
        usageLine() {
          throw failure;
        },
      }),
      (error) => {
        assert.equal(error, failure);
        return true;
      },
    );
  });

  it("should wait for asynchronous context disposal", async () => {
    // Arrange
    const disposalStarted = createDeferred();
    const releaseDisposal = createDeferred();
    const context: SourceContext = {
      id: Symbol("async-disposal"),
      phase: "single-pass",
      getAnnotations() {
        return {};
      },
      async [Symbol.asyncDispose]() {
        disposalStarted.resolve();
        await releaseDisposal.promise;
      },
    };

    // Act
    const promise = captureRun(constant("done"), {
      args: [],
      contexts: [context],
    });
    await disposalStarted.promise;
    let settled = false;
    void promise.finally(() => {
      settled = true;
    });
    await Promise.resolve();

    // Assert
    assert.ok(!settled);
    releaseDisposal.resolve();
    assert.deepEqual(await promise, {
      kind: "returned",
      value: "done",
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  });

  it("should preserve SuppressedError when exit and disposal both fail", async () => {
    // Arrange
    const disposalFailure = new Error("Disposal failed.");
    const context: SourceContext = {
      id: Symbol("failing-disposal"),
      phase: "single-pass",
      getAnnotations() {
        return {};
      },
      [Symbol.dispose]() {
        throw disposalFailure;
      },
    };

    // Act and assert
    await assert.rejects(
      captureRun(constant("unused"), {
        args: ["--help"],
        help: "option",
        contexts: [context],
      }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "SuppressedError");
        assert.ok("error" in error);
        assert.equal(error.error, disposalFailure);
        assert.ok("suppressed" in error);
        assert.ok(error.suppressed instanceof Error);
        return true;
      },
    );
  });

  it("should isolate overlapping calls", async () => {
    // Arrange
    const returnStarted = createDeferred();
    const exitStarted = createDeferred();
    const releaseReturn = createDeferred();
    const releaseExit = createDeferred();
    const returnContext = createBlockingContext(
      "return-context",
      returnStarted,
      releaseReturn,
    );
    const exitContext = createBlockingContext(
      "exit-context",
      exitStarted,
      releaseExit,
    );

    // Act
    const returnedPromise = captureRun(constant("returned"), {
      args: [],
      contexts: [returnContext],
    });
    const exitedPromise = captureRun(constant("unused"), {
      args: ["--version"],
      version: "overlap",
      contexts: [exitContext],
    });
    await Promise.all([returnStarted.promise, exitStarted.promise]);
    releaseExit.resolve();
    const exited = await exitedPromise;
    releaseReturn.resolve();
    const returned = await returnedPromise;

    // Assert
    assert.deepEqual(exited, {
      kind: "exited",
      exitCode: 0,
      stdout: "overlap\n",
      stderr: "",
    });
    assert.deepEqual(returned, {
      kind: "returned",
      value: "returned",
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
  });

  it("should preserve runAsync option and context typing", () => {
    interface RequiredContext extends
      SourceContext<{
        readonly resolvePath: (parsed: ParserValuePlaceholder) => string;
      }> {}

    const context: RequiredContext = {
      id: Symbol("required-context"),
      phase: "single-pass",
      getAnnotations() {
        return {};
      },
    };
    const parser = object({ name: argument(string()) });
    const program: Program<"sync", { readonly name: string }> = {
      parser,
      metadata: { name: "typed-program" },
    };

    const assertTypes = (): void => {
      const parserResult: Promise<
        CapturedRunResult<{ readonly name: string }>
      > = captureRun(parser, {
        args: ["Ada"],
        contexts: [context],
        contextOptions: {
          resolvePath(parsed) {
            // @ts-expect-error The substituted parser value has no `missing`.
            void parsed.missing;
            return parsed.name;
          },
        },
      });
      void parserResult;

      // @ts-expect-error The Program context requires `resolvePath`.
      captureRun(program, { args: ["Ada"], contexts: [context] });

      const dynamicContexts: readonly SourceContext<unknown>[] = [context];
      const dynamic: Promise<
        CapturedRunResult<{ readonly name: string }>
      > = captureRun(program, {
        args: ["Ada"],
        contexts: dynamicContexts,
      });
      void dynamic;

      const options: CaptureRunOptions = { args: ["Ada"] };
      const exact: Promise<
        CapturedRunResult<{ readonly name: string }>
      > = captureRun(program, options);
      void exact;

      const wrap = (forwarded?: CaptureRunOptions) =>
        captureRun(program, forwarded);
      const optional: Promise<
        CapturedRunResult<{ readonly name: string }>
      > = wrap(options);
      void optional;

      const extra: CaptureRunOptions & {
        readonly argz: readonly string[];
      } = { args: ["Ada"], argz: ["Ada"] };
      // @ts-expect-error Wider option values must not bypass key checks.
      captureRun(program, extra);

      // @ts-expect-error Output callbacks are controlled by captureRun().
      captureRun(parser, { stdout() {} });
      // @ts-expect-error Error callbacks are controlled by captureRun().
      captureRun(parser, { stderr() {} });
      captureRun(parser, {
        // @ts-expect-error Exit callbacks are controlled by captureRun().
        onExit() {
          throw new Error("Exit.");
        },
      });

      const union: CapturedRunResult<string> = Math.random() > 0.5
        ? {
          kind: "returned",
          value: "value",
          exitCode: 0,
          stdout: "",
          stderr: "",
        }
        : { kind: "exited", exitCode: 2, stdout: "", stderr: "" };
      if (union.kind === "returned") {
        const value: string = union.value;
        void value;
      } else {
        // @ts-expect-error Exited results do not have a parsed value.
        void union.value;
      }
    };
    void assertTypes;
  });

  it("should accept exact RunOptions-compatible values only after omission", () => {
    const options: RunOptions = { args: [] };
    const assertTypes = (): void => {
      // @ts-expect-error RunOptions may contain captured callbacks.
      captureRun(constant("unused"), options);
    };
    void assertTypes;
  });
});

// Helpers

function asyncUppercase(): ValueParser<"async", string> {
  return {
    mode: "async",
    metavar: "STRING",
    placeholder: "",
    parse(input) {
      return Promise.resolve({ success: true, value: input.toUpperCase() });
    },
    format(value) {
      return value;
    },
  };
}

function rejectingString(error: unknown): ValueParser<"async", string> {
  return {
    mode: "async",
    metavar: "STRING",
    placeholder: "",
    parse() {
      return Promise.reject(error);
    },
    format(value) {
      return value;
    },
  };
}

interface Deferred {
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}

function createDeferred(): Deferred {
  let resolve!: () => void;
  const promise = new Promise<void>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function createBlockingContext(
  description: string,
  started: Deferred,
  release: Deferred,
): SourceContext {
  return {
    id: Symbol(description),
    phase: "single-pass",
    async getAnnotations() {
      started.resolve();
      await release.promise;
      return {};
    },
  };
}
