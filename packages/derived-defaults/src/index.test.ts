import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { formatDocPage } from "@optique/core/doc";
import { message, optionName } from "@optique/core/message";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { getDocPage, parse } from "@optique/core/parser";
import { integer, string } from "@optique/core/valueparser";
import { bindEnv, bool, createEnvContext } from "@optique/env";
import { bindConfig, createConfigContext } from "@optique/config";
import { run, runAsync, runSync } from "@optique/run";
import { bindDerivedDefault, createDerivedDefaults } from "./index.ts";

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
});

describe("bindDerivedDefault()", () => {
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

    assert.equal(result.verbose, true);
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
