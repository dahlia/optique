import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { formatDocPage } from "@optique/core/doc";
import { formatMessage, message, optionName } from "@optique/core/message";
import { object } from "@optique/core/constructs";
import { withDefault } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { getDocPage, parse, type Parser } from "@optique/core/parser";
import {
  integer,
  string,
  type ValueParser,
  type ValueParserResult,
} from "@optique/core/valueparser";
import { bindEnv, bool, createEnvContext } from "@optique/env";
import { bindConfig, createConfigContext } from "@optique/config";
import {
  extractPhase2SeedKey,
  injectAnnotations,
} from "@optique/core/extension";
import { run, runAsync, runSync } from "@optique/run";
import { bindDerivedDefault, createDerivedDefaults } from "./index.ts";

function asyncString(): ValueParser<"async", string> {
  return {
    mode: "async",
    metavar: "STRING",
    placeholder: "",
    parse(input) {
      return Promise.resolve({ success: true, value: input });
    },
    format(value) {
      return value;
    },
  };
}

function dependencySourceParser(options: {
  readonly validateValue?: () =>
    | ValueParserResult<string>
    | Promise<ValueParserResult<string>>;
  readonly extractSourceValue?: (
    state: unknown,
  ) => ValueParserResult<unknown> | Promise<ValueParserResult<unknown>>;
} = {}): Parser<"sync", string, unknown> {
  const sourceId = Symbol("@optique/derived-defaults/test-source");
  const parser: Parser<"sync", string, unknown> = {
    mode: "sync",
    $valueType: [] as readonly string[],
    $stateType: [] as readonly unknown[],
    priority: 0,
    usage: [],
    leadingNames: new Set<string>(),
    acceptingAnyToken: false,
    initialState: undefined,
    parse(context) {
      return {
        success: true as const,
        next: context,
        consumed: [],
      };
    },
    complete() {
      return { success: false as const, error: message`Missing value.` };
    },
    suggest() {
      return [];
    },
    getDocFragments() {
      return { fragments: [] };
    },
    dependencyMetadata: {
      source: {
        kind: "source",
        sourceId,
        preservesSourceValue: true,
        extractSourceValue: options.extractSourceValue ??
          (() => ({ success: true as const, value: "source" })),
      },
    },
  };
  if (options.validateValue != null) {
    Object.defineProperty(parser, "validateValue", {
      value: options.validateValue,
      configurable: true,
    });
  }
  return parser;
}

async function captureRunFailure(
  callback: (options: {
    readonly stderr: (message: string) => void;
    readonly onExit: (code: number) => never;
  }) => Promise<unknown> | unknown,
): Promise<{ readonly code: number; readonly stderr: string }> {
  let stderr = "";
  let exitCode: number | undefined;
  await assert.rejects(
    async () =>
      await callback({
        stderr: (message) => {
          stderr += message;
        },
        onExit: (code) => {
          exitCode = code;
          throw new Error(`exit ${code}`);
        },
      }),
    /exit /u,
  );
  assert.equal(exitCode, 1);
  return { code: exitCode, stderr };
}

describe("createDerivedDefaults()", () => {
  it("derives fallback values from the first-pass parse result", async () => {
    const derived = createDerivedDefaults({
      workspaceRoot: (parsed: { readonly serviceRoot: string }) =>
        `${parsed.serviceRoot}/workspace`,
    });
    const parser = object({
      serviceRoot: option("--service-root", string()),
      workspaceRoot: bindDerivedDefault(option("--workspace-root", string()), {
        context: derived.context,
        key: "workspaceRoot",
      }),
    });

    const result = await runAsync(parser, {
      args: ["--service-root", "/srv/app"],
      contexts: [derived.context],
    });

    assert.deepEqual(result, {
      serviceRoot: "/srv/app",
      workspaceRoot: "/srv/app/workspace",
    });
  });

  it("does not call resolvers during phase 1", async () => {
    const calls: string[] = [];
    const derived = createDerivedDefaults({
      token: (parsed: { readonly service: string }) => {
        calls.push(parsed.service);
        return `${parsed.service}-token`;
      },
    });
    const parser = object({
      service: option("--service", string()),
      token: bindDerivedDefault(option("--token", string()), {
        context: derived.context,
        key: "token",
      }),
    });

    await runAsync(parser, {
      args: ["--service", "api"],
      contexts: [derived.context],
    });

    assert.deepEqual(calls, ["api"]);
  });

  it("does not call resolvers without a phase-two seed", async () => {
    let called = false;
    const derived = createDerivedDefaults({
      workspaceRoot: (parsed: { readonly serviceRoot: string }) => {
        called = true;
        return `${parsed.serviceRoot}/workspace`;
      },
    });
    const parser = object({
      serviceRoot: option("--service-root", string()),
      workspaceRoot: bindDerivedDefault(option("--workspace-root", string()), {
        context: derived.context,
        key: "workspaceRoot",
      }),
    });

    const failure = await captureRunFailure((options) =>
      runAsync(parser, {
        args: [],
        contexts: [derived.context],
        ...options,
      })
    );

    assert.ok(!called);
    assert.match(failure.stderr, /No matching option found\./u);
  });

  it("does not call resolvers with a null phase-two seed", () => {
    let called = false;
    const derived = createDerivedDefaults({
      workspaceRoot: (parsed: { readonly serviceRoot: string }) => {
        called = true;
        return `${parsed.serviceRoot}/workspace`;
      },
    });

    const annotations = derived.context.getAnnotations({
      phase: "phase2",
      parsed: null,
    });

    assert.ok(!called);
    assert.deepEqual(annotations, {});
  });

  it("passes undefined to default-parameter resolvers for null seeds", () => {
    let called = false;
    const derived = createDerivedDefaults({
      workspaceRoot: (
        { serviceRoot }: { readonly serviceRoot?: string } = {},
      ) => {
        called = true;
        return serviceRoot == null ? undefined : `${serviceRoot}/workspace`;
      },
    });

    const annotations = derived.context.getAnnotations({
      phase: "phase2",
      parsed: null,
    });

    assert.ok(called);
    assert.deepEqual(annotations, {});
  });
});

describe("bindDerivedDefault()", () => {
  it("rejects derived values that do not match the parser value type", () => {
    const derived = createDerivedDefaults({
      port: () => "5432",
    });

    void bindDerivedDefault(option("--port", integer()), {
      context: derived.context,
      // @ts-expect-error: derived strings cannot default an integer parser.
      key: "port",
    });
  });

  it("prefers CLI input over a derived fallback", async () => {
    const derived = createDerivedDefaults({
      workspaceRoot: () => "/derived",
    });
    const parser = object({
      workspaceRoot: bindDerivedDefault(option("--workspace-root", string()), {
        context: derived.context,
        key: "workspaceRoot",
      }),
    });

    const result = await runAsync(parser, {
      args: ["--workspace-root", "/cli"],
      contexts: [derived.context],
    });

    assert.equal(result.workspaceRoot, "/cli");
  });

  it("preserves invalid explicit CLI input over derived fallback", async () => {
    const derived = createDerivedDefaults({
      port: () => 5432,
    });
    const parser = object({
      port: bindDerivedDefault(option("--port", integer()), {
        context: derived.context,
        key: "port",
      }),
    });

    const failure = await captureRunFailure((options) =>
      runAsync(parser, {
        args: ["--port", "invalid"],
        contexts: [derived.context],
        ...options,
      })
    );

    assert.match(failure.stderr, /Expected a valid integer/u);
  });

  it("falls through from undefined to a static default", async () => {
    const derived = createDerivedDefaults({
      workspaceRoot: () => undefined,
    });
    const parser = object({
      workspaceRoot: bindDerivedDefault(option("--workspace-root", string()), {
        context: derived.context,
        key: "workspaceRoot",
        default: "/static",
      }),
    });

    const result = await runAsync(parser, {
      args: [],
      contexts: [derived.context],
    });

    assert.equal(result.workspaceRoot, "/static");
  });

  it("falls through from undefined to an inner parser fallback", async () => {
    const derived = createDerivedDefaults({
      workspaceRoot: () => undefined,
    });
    const parser = object({
      workspaceRoot: bindDerivedDefault(
        withDefault(option("--workspace-root", string()), "/inner"),
        {
          context: derived.context,
          key: "workspaceRoot",
        },
      ),
    });

    const result = await runAsync(parser, {
      args: [],
      contexts: [derived.context],
    });

    assert.equal(result.workspaceRoot, "/inner");
  });

  it("preserves inner fallback errors after derived fallback misses", () => {
    const env = createEnvContext({
      prefix: "APP_",
      source: (key) => key === "APP_PORT" ? "invalid" : undefined,
    });
    const derived = createDerivedDefaults({
      port: () => undefined,
      token: () => "secret",
    });
    const parser = bindDerivedDefault(
      bindEnv(option("--port", integer()), {
        context: env,
        key: "PORT",
        parser: integer(),
      }),
      {
        context: derived.context,
        key: "port",
      },
    );

    const envAnnotations = env.getAnnotations();
    if (envAnnotations instanceof Promise) {
      throw new TypeError("Expected synchronous env annotations.");
    }
    const derivedAnnotations = derived.context.getAnnotations({
      phase: "phase2",
      parsed: {},
    });
    if (derivedAnnotations instanceof Promise) {
      throw new TypeError("Expected synchronous derived annotations.");
    }
    const annotations = {
      ...envAnnotations,
      ...derivedAnnotations,
    };
    const result = parse(parser, [], { annotations });

    assert.ok(!result.success);
    const error = formatMessage(result.error);
    assert.match(error, /Expected a valid integer/u);
    assert.doesNotMatch(
      error,
      /Missing required derived default value/u,
    );
  });

  it("fails when no CLI, derived, or static default value exists", async () => {
    const derived = createDerivedDefaults({
      workspaceRoot: () => undefined,
    });
    const parser = object({
      workspaceRoot: bindDerivedDefault(option("--workspace-root", string()), {
        context: derived.context,
        key: "workspaceRoot",
      }),
    });

    const failure = await captureRunFailure((options) =>
      runAsync(parser, {
        args: [],
        contexts: [derived.context],
        ...options,
      })
    );

    assert.match(failure.stderr, /No matching option found\./u);
  });

  it("derives all fields when no CLI input seeds phase two", async () => {
    const derived = createDerivedDefaults({
      token: () => "secret",
    });
    const parser = object({
      token: bindDerivedDefault(option("--token", string()), {
        context: derived.context,
        key: "token",
      }),
    });

    const result = await runAsync(parser, {
      args: [],
      contexts: [derived.context],
    });

    assert.deepEqual(result, { token: "secret" });
  });

  it("supports async resolvers with async runners", async () => {
    const derived = createDerivedDefaults({
      token: (parsed: { readonly service: string }) =>
        Promise.resolve(`${parsed.service}-token`),
    });
    const parser = object({
      service: option("--service", string()),
      token: bindDerivedDefault(option("--token", string()), {
        context: derived.context,
        key: "token",
      }),
    });

    const result = await runAsync(parser, {
      args: ["--service", "api"],
      contexts: [derived.context],
    });

    assert.equal(result.token, "api-token");
  });

  it("rejects async resolvers in sync runners", () => {
    const derived = createDerivedDefaults({
      token: (parsed: { readonly service: string }) =>
        Promise.resolve(`${parsed.service}-token`),
    });
    const parser = object({
      service: option("--service", string()),
      token: bindDerivedDefault(option("--token", string()), {
        context: derived.context,
        key: "token",
      }),
    });

    assert.throws(
      () =>
        runSync(parser, {
          args: ["--service", "api"],
          contexts: [derived.context],
          stderr: () => {},
        }),
      /returned a Promise in sync mode/u,
    );
  });

  it("reports when its context was not registered", async () => {
    const derived = createDerivedDefaults({
      token: () => "secret",
    });
    const other = createEnvContext({
      source: () => undefined,
    });
    const parser = object({
      token: bindDerivedDefault(option("--token", string()), {
        context: derived.context,
        key: "token",
      }),
    });

    const failure = await captureRunFailure((options) =>
      runAsync(parser, {
        args: [],
        contexts: [other],
        ...options,
      })
    );

    assert.match(failure.stderr, /No matching option found\./u);
  });

  it("revalidates derived values through the wrapped parser", async () => {
    const derived = createDerivedDefaults({
      port: (parsed: { readonly service: string }) =>
        parsed.service === "api" ? 70_000 : 80,
    });
    const parser = object({
      service: option("--service", string()),
      port: bindDerivedDefault(option("--port", integer({ max: 65_535 })), {
        context: derived.context,
        key: "port",
      }),
    });

    const failure = await captureRunFailure((options) =>
      runAsync(parser, {
        args: ["--service", "api"],
        contexts: [derived.context],
        ...options,
      })
    );

    assert.match(failure.stderr, /Expected a value less than or equal to/u);
  });

  it("rejects async fallback validation in sync mode", () => {
    const derived = createDerivedDefaults({
      token: () => "secret",
    });
    const annotations = derived.context.getAnnotations({
      phase: "phase2",
      parsed: {},
    });
    assert.ok(!(annotations instanceof Promise));
    const innerParser = { ...option("--token", string()) };
    Object.defineProperty(innerParser, "validateValue", {
      value: () => Promise.resolve({ success: true, value: "secret" }),
      configurable: true,
    });
    const parser = bindDerivedDefault(innerParser, {
      context: derived.context,
      key: "token",
    });

    assert.throws(
      () => parse(parser, [], { annotations }),
      /Synchronous mode cannot wrap Promise value/u,
    );
  });

  it("rejects async CLI completion in sync mode", () => {
    const derived = createDerivedDefaults({
      token: () => "fallback",
    });
    const innerParser = { ...option("--token", string()) };
    Object.defineProperty(innerParser, "complete", {
      value: () => Promise.resolve({ success: true, value: "cli" }),
      configurable: true,
    });
    const parser = bindDerivedDefault(innerParser, {
      context: derived.context,
      key: "token",
    });
    const annotations = derived.context.getAnnotations({
      phase: "phase2",
      parsed: {},
    });
    assert.ok(!(annotations instanceof Promise));

    assert.throws(
      () => parse(parser, ["--token", "cli"], { annotations }),
      /Synchronous mode cannot wrap Promise value/u,
    );
  });

  it("rejects async missing source defaults in sync mode", () => {
    const derived = createDerivedDefaults({
      token: () => undefined,
    });
    const parser = bindDerivedDefault(
      dependencySourceParser({
        validateValue: () =>
          Promise.resolve({ success: true as const, value: "default" }),
      }),
      {
        context: derived.context,
        key: "token",
        default: "default",
      },
    );
    const getMissingSourceValue = parser.dependencyMetadata?.source
      ?.getMissingSourceValue;
    assert.ok(getMissingSourceValue != null);

    assert.throws(
      () => getMissingSourceValue(),
      /Synchronous mode cannot wrap Promise value/u,
    );
  });

  it("rejects async derived source validation in sync mode", () => {
    const derived = createDerivedDefaults({
      token: () => "derived",
    });
    const annotations = derived.context.getAnnotations({
      phase: "phase2",
      parsed: {},
    });
    assert.ok(!(annotations instanceof Promise));
    const parser = bindDerivedDefault(
      dependencySourceParser({
        validateValue: () =>
          Promise.resolve({ success: true as const, value: "derived" }),
      }),
      {
        context: derived.context,
        key: "token",
      },
    );
    const extractSourceValue = parser.dependencyMetadata?.source
      ?.extractSourceValue;
    assert.ok(extractSourceValue != null);

    assert.throws(
      () => extractSourceValue(injectAnnotations({}, annotations)),
      /Synchronous mode cannot wrap Promise value/u,
    );
  });

  it("rejects async delegated source extraction in sync mode", () => {
    const derived = createDerivedDefaults({
      token: () => undefined,
    });
    const annotations = derived.context.getAnnotations({
      phase: "phase2",
      parsed: {},
    });
    assert.ok(!(annotations instanceof Promise));
    const parser = bindDerivedDefault(
      dependencySourceParser({
        extractSourceValue: () =>
          Promise.resolve({ success: true as const, value: "source" }),
      }),
      {
        context: derived.context,
        key: "token",
      },
    );
    const extractSourceValue = parser.dependencyMetadata?.source
      ?.extractSourceValue;
    assert.ok(extractSourceValue != null);

    assert.throws(
      () => extractSourceValue(injectAnnotations({}, annotations)),
      /Synchronous mode cannot wrap Promise value/u,
    );
  });

  it("delegates phase-two seeds to wrapped parsers", () => {
    const derived = createDerivedDefaults({
      token: () => "fallback",
    });
    const innerParser = { ...option("--token", string()) };
    Object.defineProperty(innerParser, extractPhase2SeedKey, {
      value: () => ({ value: "inner" }),
      configurable: true,
    });
    const parser = bindDerivedDefault(innerParser, {
      context: derived.context,
      key: "token",
    });
    const extractor = (parser as typeof parser & {
      readonly [extractPhase2SeedKey]: (state: unknown) => unknown;
    })[extractPhase2SeedKey];

    assert.deepEqual(extractor(parser.initialState), { value: "inner" });
  });

  it("rejects async inner phase-two seeds in sync mode", () => {
    const derived = createDerivedDefaults({
      token: () => "fallback",
    });
    const innerParser = { ...option("--token", string()) };
    Object.defineProperty(innerParser, extractPhase2SeedKey, {
      value: () => Promise.resolve({ value: "inner" }),
      configurable: true,
    });
    const parser = bindDerivedDefault(innerParser, {
      context: derived.context,
      key: "token",
    });
    const extractor = (parser as typeof parser & {
      readonly [extractPhase2SeedKey]: (state: unknown) => unknown;
    })[extractPhase2SeedKey];

    assert.throws(
      () => extractor(parser.initialState),
      /Synchronous mode cannot wrap Promise value/u,
    );
  });

  it("wraps phase-two seed fallbacks in async mode", async () => {
    const derived = createDerivedDefaults({
      token: () => "fallback",
    });
    const parser = bindDerivedDefault(option("--token", asyncString()), {
      context: derived.context,
      key: "token",
    });
    const extractor = (parser as typeof parser & {
      readonly [extractPhase2SeedKey]: (state: unknown) => unknown;
    })[extractPhase2SeedKey];

    const emptySeed = extractor(parser.initialState);
    assert.ok(emptySeed instanceof Promise);
    assert.equal(await emptySeed, null);

    const phase1Annotations = derived.context.getInternalAnnotations?.(
      { phase: "phase1" },
      {},
    );
    assert.ok(phase1Annotations != null);
    const deferredSeed = extractor(injectAnnotations({}, phase1Annotations));
    assert.ok(deferredSeed instanceof Promise);
    assert.deepEqual(await deferredSeed, {
      value: undefined,
      deferred: true,
    });
  });

  it("uses defaultDescription for help without resolving fallback", () => {
    let called = false;
    const derived = createDerivedDefaults({
      workspaceRoot: () => {
        called = true;
        return "/derived";
      },
    });
    const parser = object({
      workspaceRoot: bindDerivedDefault(option("--workspace-root", string()), {
        context: derived.context,
        key: "workspaceRoot",
        defaultDescription: message`derived from ${
          optionName("--service-root")
        }`,
      }),
    });

    const page = getDocPage(parser);
    assert.ok(page != null);
    const help = formatDocPage("tool", page, {
      showDefault: true,
    });

    assert.match(help, /derived from `--service-root`/u);
    assert.ok(!called);
  });

  it("lets wrapper nesting define source priority", async () => {
    const env = createEnvContext({
      prefix: "APP_",
      source: (key) => key === "APP_VERBOSE" ? "true" : undefined,
    });
    const config = createConfigContext({
      schema: {
        "~standard": {
          version: 1,
          vendor: "test",
          validate: (input) => ({
            value: input as { readonly verbose: boolean },
          }),
        },
      },
    });
    const derived = createDerivedDefaults({
      verbose: () => false,
    });
    const parser = object({
      verbose: bindEnv(
        bindConfig(
          bindDerivedDefault(option("--verbose"), {
            context: derived.context,
            key: "verbose",
            default: false,
          }),
          {
            context: config,
            key: "verbose",
          },
        ),
        {
          context: env,
          key: "VERBOSE",
          parser: bool(),
        },
      ),
    });

    const result = await run(parser, {
      args: [],
      contexts: [env, config, derived.context],
      contextOptions: {
        load: () => ({ config: { verbose: false }, meta: undefined }),
      },
    });

    assert.ok(result.verbose);
  });

  it("works with low-level parse annotations", () => {
    const derived = createDerivedDefaults({
      token: () => "from-derived",
    });
    const annotations = derived.context.getAnnotations({
      phase: "phase2",
      parsed: {},
    });
    assert.ok(!(annotations instanceof Promise));
    const parser = bindDerivedDefault(option("--token", string()), {
      context: derived.context,
      key: "token",
    });

    const result = parse(parser, [], { annotations });

    assert.deepEqual(result, { success: true, value: "from-derived" });
  });
});
