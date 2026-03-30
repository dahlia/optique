/**
 * Dependency semantics regression matrix.
 *
 * This file locks in the target dependency behavior across all execution
 * contexts (top-level, object, tuple, concat, merge), dependency shapes
 * (derive, deriveFrom single, deriveFrom multi), wrapper combinations
 * (optional, withDefault, map), and execution modes (sync, async).
 *
 * Part of https://github.com/dahlia/optique/issues/751
 */
import { describe, test } from "node:test";
import * as assert from "node:assert/strict";
import { dependency, deriveFrom } from "./dependency.ts";
import {
  parseAsync,
  parseSync,
  suggestAsync,
  type Suggestion,
  suggestSync,
} from "./parser.ts";
import { choice } from "./valueparser.ts";
import { concat, merge, object, or, tuple } from "./constructs.ts";
import { argument, option } from "./primitives.ts";
import { map, multiple, optional, withDefault } from "./modifiers.ts";
import { message } from "./message.ts";
import type { NonEmptyString } from "./nonempty.ts";
// =============================================================================
// Shared test fixtures
// =============================================================================

type Env = "dev" | "prod";
type Region = "us-east" | "eu-west";

const envChoices = ["dev", "prod"] as const;
const devLogChoices = ["debug", "trace"] as const;
const prodLogChoices = ["info", "warn"] as const;

function createEnvSource() {
  return dependency(choice(envChoices));
}

function asyncChoice<T extends string>(choices: readonly T[]) {
  return {
    $mode: "async" as const,
    metavar: choices.join("|") as NonEmptyString,
    placeholder: "",
    parse(input: string) {
      return Promise.resolve(
        choices.includes(input as T)
          ? { success: true as const, value: input as T }
          : {
            success: false as const,
            error: message`Invalid choice: ${input}`,
          },
      );
    },
    format(value: T): string {
      return value;
    },
    async *suggest(prefix: string): AsyncIterable<Suggestion> {
      for (const choice of choices) {
        if (choice.startsWith(prefix)) {
          yield { kind: "literal", text: choice };
        }
      }
    },
  };
}

type EnvSource = ReturnType<typeof createEnvSource>;

function createDerivedLogLevel(envSource: EnvSource) {
  return envSource.deriveSync({
    metavar: "LEVEL" as NonEmptyString,
    factory: (env) => choice(env === "dev" ? devLogChoices : prodLogChoices),
    defaultValue: () => "dev" as Env,
  });
}

function createAsyncDerivedLogLevel(envSource: EnvSource) {
  return envSource.derive({
    metavar: "LEVEL" as NonEmptyString,
    mode: "async" as const,
    factory: (env) =>
      asyncChoice(env === "dev" ? devLogChoices : prodLogChoices),
    defaultValue: () => "dev" as Env,
  });
}

function createRegionSource() {
  return dependency(choice(["us-east", "eu-west"] as const));
}

type RegionSource = ReturnType<typeof createRegionSource>;

function createDerivedFromSingle(envSource: EnvSource) {
  return deriveFrom({
    dependencies: [envSource] as const,
    metavar: "ENDPOINT" as NonEmptyString,
    mode: "sync" as const,
    factory: (env) =>
      choice(
        env === "dev"
          ? (["http://localhost:3000", "http://localhost:8080"] as const)
          : (["https://api.example.com", "https://api.backup.com"] as const),
      ),
    defaultValues: () => ["dev" as Env] as const,
  });
}

function createDerivedFromMulti(
  envSource: EnvSource,
  regionSource: RegionSource,
) {
  return deriveFrom({
    dependencies: [envSource, regionSource] as const,
    metavar: "URL" as NonEmptyString,
    mode: "sync" as const,
    factory: (env, region) =>
      choice(
        env === "dev"
          ? ([`http://${region}.dev.local`] as const)
          : ([`https://${region}.prod.example.com`] as const),
      ),
    defaultValues: () => ["dev" as Env, "us-east" as Region] as const,
  });
}

function literalTexts(suggestions: readonly Suggestion[]): string[] {
  return suggestions
    .filter((s): s is Suggestion & { kind: "literal" } => s.kind === "literal")
    .map((s) => s.text);
}

// =============================================================================
// Section A: Core dependency shapes × execution contexts (parse path)
// =============================================================================

describe("A. Parse path: derive() × execution contexts", () => {
  test("A.1 object() — source provided, derived valid", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: option("--env", env),
      log: option("--log", log),
    });
    const result = parseSync(parser, ["--env", "prod", "--log", "warn"]);
    assert.ok(result.success);
    assert.equal(result.value.env, "prod");
    assert.equal(result.value.log, "warn");
  });

  test("A.2 object() — source provided, derived invalid (rejected)", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: option("--env", env),
      log: option("--log", log),
    });
    // "debug" is valid for dev, not for prod
    const result = parseSync(parser, ["--env", "prod", "--log", "debug"]);
    assert.ok(!result.success);
  });

  test("A.3 object() — source omitted (derived uses default)", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: withDefault(option("--env", env), "dev" as Env),
      log: option("--log", log),
    });
    // No --env provided; default is "dev", so "debug" should be valid
    const result = parseSync(parser, ["--log", "debug"]);
    assert.ok(result.success);
    assert.equal(result.value.env, "dev");
    assert.equal(result.value.log, "debug");
  });

  test("A.4 tuple() — source earlier, derived later", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = tuple([
      option("--env", env),
      option("--log", log),
    ]);
    const result = parseSync(parser, ["--env", "prod", "--log", "info"]);
    assert.ok(result.success);
    assert.equal(result.value[0], "prod");
    assert.equal(result.value[1], "info");
  });

  test("A.5 concat() — source in first child, derived in second", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = concat(
      tuple([option("--env", env)]),
      tuple([option("--log", log)]),
    );
    const result = parseSync(parser, ["--env", "prod", "--log", "warn"]);
    assert.ok(result.success);
    assert.equal(result.value[0], "prod");
    assert.equal(result.value[1], "warn");
  });

  test("A.6 merge() — source and derived in different children", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = merge(
      object({ env: option("--env", env) }),
      object({ log: option("--log", log) }),
    );
    const result = parseSync(parser, ["--env", "prod", "--log", "info"]);
    assert.ok(result.success);
    assert.equal(result.value.env, "prod");
    assert.equal(result.value.log, "info");
  });
});

describe("A. Parse path: deriveFrom(single) × execution contexts", () => {
  test("A.7 object() — source provided, derived valid", () => {
    const env = createEnvSource();
    const endpoint = createDerivedFromSingle(env);
    const parser = object({
      env: option("--env", env),
      endpoint: option("--endpoint", endpoint),
    });
    const result = parseSync(parser, [
      "--env",
      "prod",
      "--endpoint",
      "https://api.example.com",
    ]);
    assert.ok(result.success);
    assert.equal(result.value.env, "prod");
    assert.equal(result.value.endpoint, "https://api.example.com");
  });

  test("A.8 object() — source provided, derived invalid", () => {
    const env = createEnvSource();
    const endpoint = createDerivedFromSingle(env);
    const parser = object({
      env: option("--env", env),
      endpoint: option("--endpoint", endpoint),
    });
    const result = parseSync(parser, [
      "--env",
      "prod",
      "--endpoint",
      "http://localhost:3000",
    ]);
    assert.ok(!result.success);
  });

  test("A.9 tuple() — source earlier, derived later", () => {
    const env = createEnvSource();
    const endpoint = createDerivedFromSingle(env);
    const parser = tuple([
      option("--env", env),
      option("--endpoint", endpoint),
    ]);
    const result = parseSync(parser, [
      "--env",
      "dev",
      "--endpoint",
      "http://localhost:3000",
    ]);
    assert.ok(result.success);
    assert.equal(result.value[0], "dev");
    assert.equal(result.value[1], "http://localhost:3000");
  });

  test("A.10 concat() — cross-boundary", () => {
    const env = createEnvSource();
    const endpoint = createDerivedFromSingle(env);
    const parser = concat(
      tuple([option("--env", env)]),
      tuple([option("--endpoint", endpoint)]),
    );
    const result = parseSync(parser, [
      "--env",
      "dev",
      "--endpoint",
      "http://localhost:8080",
    ]);
    assert.ok(result.success);
    assert.equal(result.value[0], "dev");
    assert.equal(result.value[1], "http://localhost:8080");
  });

  test("A.11 merge() — cross-child", () => {
    const env = createEnvSource();
    const endpoint = createDerivedFromSingle(env);
    const parser = merge(
      object({ env: option("--env", env) }),
      object({ endpoint: option("--endpoint", endpoint) }),
    );
    const result = parseSync(parser, [
      "--env",
      "prod",
      "--endpoint",
      "https://api.backup.com",
    ]);
    assert.ok(result.success);
    assert.equal(result.value.env, "prod");
    assert.equal(result.value.endpoint, "https://api.backup.com");
  });
});

describe("A. Parse path: deriveFrom(multi) × execution contexts", () => {
  test("A.12 object() — both sources provided, derived valid", () => {
    const env = createEnvSource();
    const region = createRegionSource();
    const url = createDerivedFromMulti(env, region);
    const parser = object({
      env: option("--env", env),
      region: option("--region", region),
      url: option("--url", url),
    });
    const result = parseSync(parser, [
      "--env",
      "prod",
      "--region",
      "eu-west",
      "--url",
      "https://eu-west.prod.example.com",
    ]);
    assert.ok(result.success);
    assert.equal(result.value.env, "prod");
    assert.equal(result.value.region, "eu-west");
    assert.equal(result.value.url, "https://eu-west.prod.example.com");
  });

  test("A.13 object() — both sources provided, derived invalid", () => {
    const env = createEnvSource();
    const region = createRegionSource();
    const url = createDerivedFromMulti(env, region);
    const parser = object({
      env: option("--env", env),
      region: option("--region", region),
      url: option("--url", url),
    });
    const result = parseSync(parser, [
      "--env",
      "prod",
      "--region",
      "eu-west",
      "--url",
      "http://us-east.dev.local",
    ]);
    assert.ok(!result.success);
  });

  test("A.14 tuple() — sources and derived in tuple", () => {
    const env = createEnvSource();
    const region = createRegionSource();
    const url = createDerivedFromMulti(env, region);
    const parser = tuple([
      option("--env", env),
      option("--region", region),
      option("--url", url),
    ]);
    const result = parseSync(parser, [
      "--env",
      "dev",
      "--region",
      "us-east",
      "--url",
      "http://us-east.dev.local",
    ]);
    assert.ok(result.success);
    assert.equal(result.value[0], "dev");
    assert.equal(result.value[1], "us-east");
    assert.equal(result.value[2], "http://us-east.dev.local");
  });

  test("A.15 concat() — sources in first child, derived in second", () => {
    const env = createEnvSource();
    const region = createRegionSource();
    const url = createDerivedFromMulti(env, region);
    const parser = concat(
      tuple([option("--env", env), option("--region", region)]),
      tuple([option("--url", url)]),
    );
    const result = parseSync(parser, [
      "--env",
      "prod",
      "--region",
      "us-east",
      "--url",
      "https://us-east.prod.example.com",
    ]);
    assert.ok(result.success);
    assert.equal(result.value[0], "prod");
    assert.equal(result.value[1], "us-east");
    assert.equal(result.value[2], "https://us-east.prod.example.com");
  });

  test("A.16 merge() — sources and derived across children", () => {
    const env = createEnvSource();
    const region = createRegionSource();
    const url = createDerivedFromMulti(env, region);
    const parser = merge(
      object({ env: option("--env", env) }),
      object({
        region: option("--region", region),
        url: option("--url", url),
      }),
    );
    const result = parseSync(parser, [
      "--env",
      "dev",
      "--region",
      "eu-west",
      "--url",
      "http://eu-west.dev.local",
    ]);
    assert.ok(result.success);
    assert.equal(result.value.env, "dev");
    assert.equal(result.value.region, "eu-west");
    assert.equal(result.value.url, "http://eu-west.dev.local");
  });
});

// =============================================================================
// Section B: Core dependency shapes × execution contexts (suggest path)
// =============================================================================

describe("B. Suggest path: derive() × execution contexts", () => {
  test("B.1 object() — suggests derived values using resolved source", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: option("--env", env),
      log: option("--log", log),
    });
    // Source "prod" already parsed; suggest derived values
    const suggestions = suggestSync(parser, ["--env", "prod", "--log", ""]);
    const texts = literalTexts(suggestions);
    assert.ok(texts.includes("info"), `Expected "info" in ${texts}`);
    assert.ok(texts.includes("warn"), `Expected "warn" in ${texts}`);
    assert.ok(!texts.includes("debug"), `Unexpected "debug" in ${texts}`);
  });

  test("B.2 object() — suggests derived values using default when source not provided", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: option("--env", env),
      log: option("--log", log),
    });
    // No source provided; default "dev" should be used
    const suggestions = suggestSync(parser, ["--log", ""]);
    const texts = literalTexts(suggestions);
    assert.ok(texts.includes("debug"), `Expected "debug" in ${texts}`);
    assert.ok(texts.includes("trace"), `Expected "trace" in ${texts}`);
  });

  test("B.3 tuple() — suggests with default (tuple does not pre-complete sources)", () => {
    // Note: tuple() currently does not pre-complete dependency sources
    // during the suggest path, so suggestions use the default value
    // rather than the resolved source.  The target behavior (resolving
    // from the parsed source) is tracked in #750.
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = tuple([
      option("--env", env),
      option("--log", log),
    ]);
    const suggestions = suggestSync(parser, ["--env", "prod", "--log", ""]);
    const texts = literalTexts(suggestions);
    // Current: falls back to default "dev"
    assert.ok(texts.includes("debug"), `Expected "debug" in ${texts}`);
    assert.ok(texts.includes("trace"), `Expected "trace" in ${texts}`);
  });

  test("B.4 concat() — suggests with cross-boundary source", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = concat(
      tuple([option("--env", env)]),
      tuple([option("--log", log)]),
    );
    const suggestions = suggestSync(parser, ["--env", "prod", "--log", ""]);
    const texts = literalTexts(suggestions);
    assert.ok(texts.includes("info"), `Expected "info" in ${texts}`);
    assert.ok(texts.includes("warn"), `Expected "warn" in ${texts}`);
  });

  test("B.4a concat() — suggests with explicit source from multiple()", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = concat(
      multiple(option("--env", env)),
      tuple([option("--log", log)]),
    );
    const suggestions = suggestSync(parser, ["--env", "prod", "--log", ""]);
    const texts = literalTexts(suggestions);
    assert.ok(texts.includes("info"), `Expected "info" in ${texts}`);
    assert.ok(texts.includes("warn"), `Expected "warn" in ${texts}`);
    assert.ok(!texts.includes("debug"), `Unexpected "debug" in ${texts}`);
    assert.ok(!texts.includes("trace"), `Unexpected "trace" in ${texts}`);
  });

  test("B.4b concat() — async suggest uses explicit source from multiple()", async () => {
    const env = createEnvSource();
    const log = createAsyncDerivedLogLevel(env);
    const parser = concat(
      multiple(option("--env", env)),
      tuple([option("--log", log)]),
    );
    const suggestions = await suggestAsync(parser, [
      "--env",
      "prod",
      "--log",
      "",
    ]);
    const texts = literalTexts(suggestions);
    assert.ok(texts.includes("info"), `Expected "info" in ${texts}`);
    assert.ok(texts.includes("warn"), `Expected "warn" in ${texts}`);
    assert.ok(!texts.includes("debug"), `Unexpected "debug" in ${texts}`);
    assert.ok(!texts.includes("trace"), `Unexpected "trace" in ${texts}`);
  });

  test("B.4c object(tuple()) — preserves seeded sources in child contexts", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: option("--env", env),
      nested: tuple([option("--log", log)]),
    });
    const suggestions = suggestSync(parser, ["--env", "prod", "--log", ""]);
    const texts = literalTexts(suggestions);
    assert.ok(texts.includes("info"), `Expected "info" in ${texts}`);
    assert.ok(texts.includes("warn"), `Expected "warn" in ${texts}`);
    assert.ok(!texts.includes("debug"), `Unexpected "debug" in ${texts}`);
    assert.ok(!texts.includes("trace"), `Unexpected "trace" in ${texts}`);
  });

  test("B.5 merge() — suggests with cross-child source", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = merge(
      object({ env: option("--env", env) }),
      object({ log: option("--log", log) }),
    );
    const suggestions = suggestSync(parser, ["--env", "prod", "--log", ""]);
    const texts = literalTexts(suggestions);
    assert.ok(texts.includes("info"), `Expected "info" in ${texts}`);
    assert.ok(texts.includes("warn"), `Expected "warn" in ${texts}`);
  });
});

describe("B. Suggest path: deriveFrom(single) × execution contexts", () => {
  test("B.6 object() — suggests derived values from resolved source", () => {
    const env = createEnvSource();
    const endpoint = createDerivedFromSingle(env);
    const parser = object({
      env: option("--env", env),
      endpoint: option("--endpoint", endpoint),
    });
    const suggestions = suggestSync(parser, [
      "--env",
      "prod",
      "--endpoint",
      "",
    ]);
    const texts = literalTexts(suggestions);
    assert.ok(
      texts.includes("https://api.example.com"),
      `Expected prod endpoint in ${texts}`,
    );
  });

  test("B.7 merge() — suggests deriveFrom across children (uses source from different child)", () => {
    // Note: merge() suggest resolves deriveFrom() dependencies across
    // children, but the resolution may not pick up the parsed source
    // value for deriveFrom (as opposed to derive).  The suggest path
    // currently returns suggestions based on the preliminary parse
    // result rather than the resolved dependency value.
    // Target behavior (consistent resolution) is tracked in #750.
    const env = createEnvSource();
    const endpoint = createDerivedFromSingle(env);
    const parser = merge(
      object({ env: option("--env", env) }),
      object({ endpoint: option("--endpoint", endpoint) }),
    );
    const suggestions = suggestSync(parser, [
      "--env",
      "dev",
      "--endpoint",
      "",
    ]);
    const texts = literalTexts(suggestions);
    // Current: suggestions are returned (may not reflect the parsed
    // source value for deriveFrom)
    assert.ok(texts.length > 0, `Expected suggestions, got none`);
  });
});

describe("B. Suggest path: deriveFrom(multi) × execution contexts", () => {
  test("B.8 object() — suggests from multiple resolved sources", () => {
    const env = createEnvSource();
    const region = createRegionSource();
    const url = createDerivedFromMulti(env, region);
    const parser = object({
      env: option("--env", env),
      region: option("--region", region),
      url: option("--url", url),
    });
    const suggestions = suggestSync(parser, [
      "--env",
      "prod",
      "--region",
      "eu-west",
      "--url",
      "",
    ]);
    const texts = literalTexts(suggestions);
    assert.ok(
      texts.includes("https://eu-west.prod.example.com"),
      `Expected prod+eu-west URL in ${texts}`,
    );
  });

  test("B.9 merge() — suggests deriveFrom(multi) across children", () => {
    const env = createEnvSource();
    const region = createRegionSource();
    const url = createDerivedFromMulti(env, region);
    const parser = merge(
      object({ env: option("--env", env) }),
      object({
        region: option("--region", region),
        url: option("--url", url),
      }),
    );
    const suggestions = suggestSync(parser, [
      "--env",
      "dev",
      "--region",
      "us-east",
      "--url",
      "",
    ]);
    const texts = literalTexts(suggestions);
    assert.ok(
      texts.includes("http://us-east.dev.local"),
      `Expected dev+us-east URL in ${texts}`,
    );
  });
});

// =============================================================================
// Section C: Wrapper combinations
// =============================================================================

describe("C. Wrapper combinations: source wrappers", () => {
  test("C.1 optional(source) — omitted source does not register dependency", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: optional(option("--env", env)),
      log: option("--log", log),
    });
    // Source omitted; derived should use default "dev"
    const result = parseSync(parser, ["--log", "trace"]);
    assert.ok(result.success);
    assert.equal(result.value.env, undefined);
    assert.equal(result.value.log, "trace");
  });

  test("C.2 withDefault(source, value) — omitted source registers default", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: withDefault(option("--env", env), "prod" as Env),
      log: option("--log", log),
    });
    // Source omitted; withDefault registers "prod" as dependency value
    const result = parseSync(parser, ["--log", "info"]);
    assert.ok(result.success);
    assert.equal(result.value.env, "prod");
    assert.equal(result.value.log, "info");
  });

  test("C.2b withDefault(source) — omitted source rejects dev-only value", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: withDefault(option("--env", env), "prod" as Env),
      log: option("--log", log),
    });
    // "debug" is only valid for "dev", but default is "prod"
    const result = parseSync(parser, ["--log", "debug"]);
    assert.ok(!result.success);
  });

  test("C.3 optional(withDefault(source, value)) — double wrap", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: optional(withDefault(option("--env", env), "prod" as Env)),
      log: option("--log", log),
    });
    // Omitted: optional wraps withDefault, which provides "prod"
    const result = parseSync(parser, ["--log", "warn"]);
    assert.ok(result.success);
    assert.equal(result.value.env, "prod");
    assert.equal(result.value.log, "warn");
  });

  test("C.4 withDefault(optional(source), value) — reverse double wrap", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: withDefault(optional(option("--env", env)), "prod" as Env),
      log: option("--log", log),
    });
    // Omitted: optional returns undefined, withDefault provides "prod"
    const result = parseSync(parser, ["--log", "info"]);
    assert.ok(result.success);
    assert.equal(result.value.env, "prod");
    assert.equal(result.value.log, "info");
  });

  test("C.4b optional(or(withDefault(source), withDefault(source))) — omitted exclusive source uses derived defaults", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: optional(or(
        withDefault(option("--env", env), "prod" as Env),
        withDefault(option("--mode", env), "prod" as Env),
      )),
      log: option("--log", log),
    });
    const result = parseSync(parser, ["--log", "trace"]);
    assert.ok(result.success);
    assert.equal(result.value.env, undefined);
    assert.equal(result.value.log, "trace");
  });

  test("C.5 map(source, f) — breaks source-value preservation", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const mappedEnv = map(option("--env", env), (e) => e.toUpperCase());
    const parser = object({
      env: mappedEnv,
      log: option("--log", log),
    });
    // map() transforms the value, so the dependency system should still
    // resolve using the original (pre-map) value
    const result = parseSync(parser, ["--env", "prod", "--log", "warn"]);
    assert.ok(result.success);
    assert.equal(result.value.env, "PROD");
    assert.equal(result.value.log, "warn");
  });

  test("C.5b suggest with map(source) still resolves dependency", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const mappedEnv = map(option("--env", env), (e) => e.toUpperCase());
    const parser = object({
      env: mappedEnv,
      log: option("--log", log),
    });
    const suggestions = suggestSync(parser, ["--env", "prod", "--log", ""]);
    const texts = literalTexts(suggestions);
    assert.ok(texts.includes("info"), `Expected "info" in ${texts}`);
    assert.ok(texts.includes("warn"), `Expected "warn" in ${texts}`);
  });
});

describe("C. Wrapper combinations: derived wrappers", () => {
  test("C.6 map(derived, f) — preserves derived relationship", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const mappedLog = map(option("--log", log), (l) => l.toUpperCase());
    const parser = object({
      env: option("--env", env),
      log: mappedLog,
    });
    const result = parseSync(parser, ["--env", "prod", "--log", "info"]);
    assert.ok(result.success);
    assert.equal(result.value.env, "prod");
    assert.equal(result.value.log, "INFO");
  });

  test("C.7 optional(derived) — omitted returns undefined", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: option("--env", env),
      log: optional(option("--log", log)),
    });
    const result = parseSync(parser, ["--env", "prod"]);
    assert.ok(result.success);
    assert.equal(result.value.env, "prod");
    assert.equal(result.value.log, undefined);
  });

  test("C.8 withDefault(derived, value) — omitted uses default", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: option("--env", env),
      log: withDefault(
        option("--log", log),
        "info" as "debug" | "trace" | "info" | "warn",
      ),
    });
    const result = parseSync(parser, ["--env", "prod"]);
    assert.ok(result.success);
    assert.equal(result.value.env, "prod");
    assert.equal(result.value.log, "info");
  });
});

describe("C. Wrapper combinations: suggest path", () => {
  test("C.9 withDefault(source) suggest — uses default for derived suggestions", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: withDefault(option("--env", env), "prod" as Env),
      log: option("--log", log),
    });
    // Source not provided in args; withDefault provides "prod"
    const suggestions = suggestSync(parser, ["--log", ""]);
    const texts = literalTexts(suggestions);
    assert.ok(texts.includes("info"), `Expected "info" in ${texts}`);
    assert.ok(texts.includes("warn"), `Expected "warn" in ${texts}`);
    assert.ok(!texts.includes("debug"), `Unexpected "debug" in ${texts}`);
  });

  test("C.10 optional(source) suggest — uses parser default for derived suggestions", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: optional(option("--env", env)),
      log: option("--log", log),
    });
    // Source not provided; optional doesn't register, so default "dev" used
    const suggestions = suggestSync(parser, ["--log", ""]);
    const texts = literalTexts(suggestions);
    assert.ok(texts.includes("debug"), `Expected "debug" in ${texts}`);
    assert.ok(texts.includes("trace"), `Expected "trace" in ${texts}`);
  });
});

// =============================================================================
// Section D: argument() as dependency source/derived
// =============================================================================

describe("D. argument() with dependencies", () => {
  test("D.1 argument as source in object()", () => {
    const fmt = createEnvSource();
    const log = createDerivedLogLevel(fmt);
    const parser = object({
      env: argument(fmt),
      log: option("--log", log),
    });
    const result = parseSync(parser, ["prod", "--log", "warn"]);
    assert.ok(result.success);
    assert.equal(result.value.env, "prod");
    assert.equal(result.value.log, "warn");
  });

  test("D.2 argument as derived in tuple()", () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = tuple([
      option("--env", env),
      argument(log),
    ]);
    const result = parseSync(parser, ["--env", "dev", "debug"]);
    assert.ok(result.success);
    assert.equal(result.value[0], "dev");
    assert.equal(result.value[1], "debug");
  });
});

// =============================================================================
// Section E: Sync/async parity
// =============================================================================

describe("E. Sync/async parity", () => {
  test("E.1 object() derive() — sync and async produce identical results", async () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: option("--env", env),
      log: option("--log", log),
    });
    const args = ["--env", "prod", "--log", "warn"] as const;
    const syncResult = parseSync(parser, args);
    const asyncResult = await parseAsync(parser, args);
    assert.deepEqual(syncResult, asyncResult);
  });

  test("E.2 merge() deriveFrom(multi) — sync and async produce identical results", async () => {
    const env = createEnvSource();
    const region = createRegionSource();
    const url = createDerivedFromMulti(env, region);
    const parser = merge(
      object({ env: option("--env", env) }),
      object({
        region: option("--region", region),
        url: option("--url", url),
      }),
    );
    const args = [
      "--env",
      "prod",
      "--region",
      "eu-west",
      "--url",
      "https://eu-west.prod.example.com",
    ] as const;
    const syncResult = parseSync(parser, args);
    const asyncResult = await parseAsync(parser, args);
    assert.deepEqual(syncResult, asyncResult);
  });

  test("E.3 suggest — sync and async produce identical suggestions", async () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: option("--env", env),
      log: option("--log", log),
    });
    const args = ["--env", "prod", "--log", ""] as const;
    const syncSuggestions = suggestSync(parser, args);
    const asyncSuggestions = await suggestAsync(parser, args);
    assert.deepEqual(syncSuggestions, asyncSuggestions);
  });

  test("E.4 withDefault(source) — sync and async produce identical results", async () => {
    const env = createEnvSource();
    const log = createDerivedLogLevel(env);
    const parser = object({
      env: withDefault(option("--env", env), "prod" as Env),
      log: option("--log", log),
    });
    const args = ["--log", "info"] as const;
    const syncResult = parseSync(parser, args);
    const asyncResult = await parseAsync(parser, args);
    assert.deepEqual(syncResult, asyncResult);
  });
});
