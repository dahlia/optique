import type { ShellCompletion } from "@optique/core/completion";
import type { SourceContext } from "@optique/core/context";
import { object } from "@optique/core/constructs";
import { argument, constant } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import {
  commandsFromModules,
  defineCommand,
  type ProgramHookContext,
  type RunProgramOptions,
} from "@optique/discover";
import {
  captureProgramRun,
  type CaptureProgramRunOptions,
  type ProgramRunResult,
} from "@optique/testing/discover";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

const formatting = { colors: false, maxWidth: 80 } as const;

describe("captureProgramRun()", () => {
  it("should execute asynchronous parsers and forward context options", async () => {
    const values: string[] = [];
    const contextOptions = { label: "test context" };
    const context: SourceContext = {
      id: Symbol("forwarded-options"),
      phase: "single-pass",
      getAnnotations(_request, options) {
        assert.deepEqual(options, contextOptions);
        values.push("context");
        return {};
      },
    };
    const parser = argument({
      mode: "async" as const,
      metavar: string().metavar,
      placeholder: "",
      format: (value: string) => value,
      parse: (value: string) =>
        Promise.resolve({ success: true as const, value: value.toUpperCase() }),
    });
    const result = await captureProgramRun({
      commands: [defineCommand({
        path: [],
        parser,
        handler(value) {
          values.push(value);
        },
      })],
      metadata: { name: "tool" },
      args: ["Ada"],
      contexts: [context],
      contextOptions,
      ...formatting,
    });
    assert.deepEqual(result, { exitCode: 0, stdout: "", stderr: "" });
    assert.deepEqual(values, ["context", "ADA"]);
  });

  it("should dispatch nested command entries and await handlers and hooks", async () => {
    const events: string[] = [];
    const commands = commandsFromModules<string>({
      "./tasks/show.mjs": {
        default: defineCommand({
          parser: argument(string()),
          hooks: {
            beforeEach() {
              events.push("command before");
              return { resource: "command resource" };
            },
            async afterEach(context) {
              await Promise.resolve();
              events.push(`command after:${context.resource}`);
            },
          },
          async handler(value, context) {
            await Promise.resolve();
            events.push(`handler:${value}:${context?.resource}`);
          },
        }),
      },
    }, { extensions: [".mjs"] });
    const promise = captureProgramRun({
      commands,
      metadata: { name: "tool" },
      args: ["tasks", "show", "Ada"],
      ...formatting,
      hooks: {
        beforeEach(invocation) {
          events.push(`program before:${invocation.path.join("/")}`);
          return { resource: "program resource" };
        },
        async afterEach(context) {
          await Promise.resolve();
          events.push(`program after:${context.resource}`);
        },
      },
    });
    assert.ok(promise instanceof Promise);
    assert.deepEqual(await promise, { exitCode: 0, stdout: "", stderr: "" });
    assert.deepEqual(events, [
      "program before:tasks/show",
      "command before",
      "handler:Ada:command resource",
      "command after:command resource",
      "program after:program resource",
    ]);
  });

  it("should discover files and forward the entry file name and resource", async () => {
    const events: string[] = [];
    const result = await captureProgramRun({
      dir: new URL("./fixtures/discover/valid/", import.meta.url),
      extensions: [".mjs"],
      entryFileName: "entry",
      metadata: { name: "tool" },
      args: ["tasks", "Ada"],
      ...formatting,
      hooks: { beforeEach: () => ({ resource: events }) },
    });
    assert.deepEqual(result, { exitCode: 0, stdout: "", stderr: "" });
    assert.deepEqual(events, ["Ada"]);
  });

  it("should capture help, version, completion and errors without dispatch", async () => {
    const events: string[] = [];
    const shell: ShellCompletion = {
      name: "custom",
      generateScript: () => "script",
      *encodeSuggestions() {
        yield "";
        yield "first\n";
        yield "second";
      },
    };
    const command = defineCommand({
      path: ["show"],
      parser: constant("unused"),
      hooks: {
        beforeEach() {
          events.push("command before");
        },
        afterEach() {
          events.push("command after");
        },
        onError() {
          events.push("command error");
        },
      },
      handler() {
        events.push("handler");
      },
    });
    const options = {
      commands: [command],
      metadata: { name: "tool", version: "1.2.3" },
      ...formatting,
      completion: { command: true as const, shells: { custom: shell } },
      hooks: {
        beforeEach() {
          events.push("program before");
        },
        afterEach() {
          events.push("program after");
        },
        onError() {
          events.push("program error");
        },
      },
    };
    const help = await captureProgramRun({ ...options, args: ["--help"] });
    assert.equal(help.exitCode, 0);
    assert.match(help.stdout, /^Usage: tool /);
    assert.ok(help.stdout.endsWith("\n\n"));
    assert.equal(help.stderr, "");
    assert.deepEqual(
      await captureProgramRun({ ...options, args: ["--version"] }),
      {
        exitCode: 0,
        stdout: "1.2.3\n",
        stderr: "",
      },
    );
    assert.deepEqual(
      await captureProgramRun({ ...options, args: ["completion", "custom"] }),
      {
        exitCode: 0,
        stdout: "script\n",
        stderr: "",
      },
    );
    assert.deepEqual(
      await captureProgramRun({
        ...options,
        args: ["completion", "custom", "--"],
      }),
      {
        exitCode: 0,
        stdout: "\nfirst\n\nsecond\n",
        stderr: "",
      },
    );
    for (const errorExitCode of [undefined, 7]) {
      const failure = await captureProgramRun({
        ...options,
        args: ["unknown"],
        errorExitCode,
      });
      assert.equal(failure.exitCode, errorExitCode ?? 1);
      assert.equal(failure.stdout, "");
      assert.match(failure.stderr, /Error:/);
      assert.ok(failure.stderr.endsWith("\n"));
    }
    assert.deepEqual(events, []);
  });

  it("should reject discovery and import failures even when requesting help", async () => {
    for (const directory of ["invalid", "throwing"]) {
      await assert.rejects(
        captureProgramRun({
          dir: new URL(`./fixtures/discover/${directory}/`, import.meta.url),
          extensions: [".mjs"],
          metadata: { name: "tool" },
          args: ["--help"],
          ...formatting,
        }),
        directory === "invalid" ? /default export/ : /Module failed\./,
      );
    }
  });

  it("should preserve handler and lifecycle failures including primitive values", async () => {
    for (
      const failure of [
        new RangeError("Handler failed."),
        { exitCode: 0 },
        undefined,
      ]
    ) {
      for (const phase of ["handler", "beforeEach", "afterEach"] as const) {
        const observed: unknown[] = [];
        const options = {
          commands: [defineCommand({
            path: [],
            parser: constant("value"),
            handler: () =>
              phase === "handler" ? Promise.reject(failure) : undefined,
          })],
          metadata: { name: "tool" },
          args: [],
          ...formatting,
          hooks: {
            beforeEach() {
              if (phase === "beforeEach") throw failure;
            },
            afterEach() {
              if (phase === "afterEach") throw failure;
            },
            onError(_context: ProgramHookContext, error: unknown) {
              observed.push(error);
              throw new Error("Observer failed.");
            },
          },
        };
        await assert.rejects(captureProgramRun(options), (error) => {
          assert.equal(error, failure);
          return true;
        });
        assert.deepEqual(observed, [failure]);
      }
    }
  });

  it("should preserve parser, context and formatting callback failures", async () => {
    const failure = new SyntaxError("Expected failure.");
    const failingParser = argument({
      metavar: string().metavar,
      placeholder: "",
      format: (value: string) => value,
      mode: "async" as const,
      parse: () => Promise.reject(failure),
    });
    const command = defineCommand({
      path: [],
      parser: failingParser,
      handler() {},
    });
    const options = {
      commands: [command],
      metadata: { name: "tool" },
      ...formatting,
    };
    const context: SourceContext = {
      id: Symbol("failure"),
      phase: "single-pass",
      getAnnotations() {
        throw failure;
      },
    };
    for (
      const overrides of [
        { args: ["value"] },
        { args: [], contexts: [context] },
        {
          args: ["--help"],
          usageLine() {
            throw failure;
          },
        },
      ]
    ) {
      await assert.rejects(
        captureProgramRun({ ...options, ...overrides }),
        (error) => {
          assert.equal(error, failure);
          return true;
        },
      );
    }
  });

  it("should await disposal and isolate overlapping executions", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const events: string[] = [];
    const context: SourceContext = {
      id: Symbol("disposal"),
      phase: "single-pass",
      getAnnotations: () => ({}),
      async [Symbol.asyncDispose]() {
        started.resolve();
        await release.promise;
        events.push("disposed");
      },
    };
    const options = {
      commands: [
        defineCommand({
          path: [],
          parser: constant("value"),
          handler() {
            events.push("handler");
          },
        }),
      ],
      metadata: { name: "tool", version: "1.2.3" },
      ...formatting,
    };
    const pending = captureProgramRun({
      ...options,
      args: [],
      contexts: [context],
    });
    await started.promise;
    assert.deepEqual(events, []);
    assert.deepEqual(
      await captureProgramRun({ ...options, args: ["--version"] }),
      {
        exitCode: 0,
        stdout: "1.2.3\n",
        stderr: "",
      },
    );
    release.resolve();
    assert.deepEqual(await pending, { exitCode: 0, stdout: "", stderr: "" });
    assert.deepEqual(events, ["disposed", "handler"]);
  });

  it("should not capture an exit sentinel leaked by another invocation", async () => {
    const failure = new Error("Disposal failed.");
    const context: SourceContext = {
      id: Symbol("leaked-exit"),
      phase: "single-pass",
      getAnnotations: () => ({}),
      [Symbol.dispose]() {
        throw failure;
      },
    };
    let leaked: unknown;
    await assert.rejects(
      captureProgramRun({
        commands: [
          defineCommand({ path: [], parser: constant("value"), handler() {} }),
        ],
        metadata: { name: "tool" },
        args: ["--help"],
        contexts: [context],
        ...formatting,
      }),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, "SuppressedError");
        assert.ok("error" in error);
        assert.equal(error.error, failure);
        assert.ok("suppressed" in error);
        leaked = error.suppressed;
        assert.ok(leaked instanceof Error);
        return true;
      },
    );
    await assert.rejects(
      captureProgramRun({
        commands: [
          defineCommand({
            path: [],
            parser: constant("value"),
            handler() {
              throw leaked;
            },
          }),
        ],
        metadata: { name: "tool" },
        args: [],
        ...formatting,
      }),
      (error) => {
        assert.equal(error, leaked);
        return true;
      },
    );
  });

  it("should preserve option unions and resource typing", () => {
    interface Resource {
      readonly label: string;
    }
    const checkTypes = (original: RunProgramOptions<Resource>) => {
      const good = defineCommand({
        path: ["show"],
        parser: object({}),
        handler(_v, _c?: ProgramHookContext<Resource>) {},
      });
      const bad = defineCommand({
        path: ["show"],
        parser: object({}),
        handler(_v, _c?: ProgramHookContext<number>) {},
      });
      const own = defineCommand({
        path: ["own"],
        parser: object({}),
        hooks: { beforeEach: () => ({ resource: 1 }) },
        handler(_v, context) {
          const value: number | undefined = context?.resource;
          void value;
        },
      });
      const options: CaptureProgramRunOptions<Resource> = {
        commands: [good, own],
        metadata: { name: "tool" },
      };
      const result: Promise<ProgramRunResult> = captureProgramRun(options);
      void result;
      captureProgramRun({
        commands: [good],
        metadata: { name: "tool" },
        hooks: {
          beforeEach: () => ({ resource: { label: "value" } }),
          afterEach(context) {
            const label: string | undefined = context.resource?.label;
            void label;
            // @ts-expect-error Hook resources retain their inferred type.
            void context.resource?.missing;
          },
        },
      });
      captureProgramRun({
        dir: ".",
        metadata: { name: "tool" },
        hooks: {
          beforeEach: () => ({ resource: { label: "value" } }),
          afterEach(context) {
            const label: string | undefined = context.resource?.label;
            void label;
            // @ts-expect-error Discovery options infer hook resources too.
            void context.resource?.missing;
          },
        },
      });
      // @ts-expect-error Neither command source.
      captureProgramRun({ metadata: { name: "tool" } });
      // @ts-expect-error Both command sources.
      captureProgramRun({ ...options, dir: "." });
      // @ts-expect-error Static commands do not accept discovery settings.
      captureProgramRun({ ...options, extensions: [".mjs"] });
      // @ts-expect-error Static commands do not accept entryFileName.
      captureProgramRun({ ...options, entryFileName: "entry" });
      // @ts-expect-error A wider value may contain captured callbacks.
      captureProgramRun(original);
      // @ts-expect-error stdout is controlled by captureProgramRun.
      captureProgramRun({ ...options, stdout() {} });
      // @ts-expect-error stderr is controlled by captureProgramRun.
      captureProgramRun({ ...options, stderr() {} });
      captureProgramRun({
        ...options,
        // @ts-expect-error onExit is controlled by captureProgramRun.
        onExit(): never {
          throw new Error("Exit.");
        },
      });
      captureProgramRun({
        // @ts-expect-error Command resource is incompatible with program hooks.
        commands: [bad],
        metadata: { name: "tool" },
        hooks: { beforeEach: () => ({ resource: { label: "x" } }) },
      });
      captureProgramRun<Resource>({
        // @ts-expect-error Command entries preserve the resource contract.
        commands: [{ path: ["show"], command: bad }],
        metadata: { name: "tool" },
      });
    };
    void checkTypes;
  });
});
