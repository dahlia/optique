import { bindEnv, createEnvContext } from "@optique/env";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  concat,
  conditional,
  group,
  longestMatch,
  merge,
  object,
  or,
  seq,
  tuple,
} from "#src/constructs.ts";
import {
  argument,
  command,
  constant,
  flag,
  negatableFlag,
  option,
} from "#src/primitives.ts";
import { map, multiple, optional, withDefault } from "#src/modifiers.ts";
import {
  type ExecutionContext,
  parseAsync,
  parseSync,
  suggestAsync,
  type Suggestion,
  suggestSync,
} from "#src/parser.ts";
import { choice, integer, string, type ValueParser } from "#src/valueparser.ts";
import { dependency } from "#src/dependency.ts";
import { formatMessage } from "#src/message.ts";

function asyncString(): ValueParser<"async", string> {
  const inner = string();
  return {
    ...inner,
    mode: "async",
    parse: (s) => Promise.resolve(inner.parse(s)),
    suggest: async function* (prefix) {
      yield* inner.suggest?.(prefix) ?? [];
    },
  };
}
function texts(suggestions: readonly Suggestion[]): string[] {
  return suggestions.flatMap((s) => s.kind === "literal" ? [s.text] : []);
}

describe("attached short option values", () => {
  for (const args of [["-n5"], ["-xn5"], ["-xyn5"], ["-xn", "5"]]) {
    it(`parses ${args.join(" ")}`, () => {
      const parser = object({
        x: option("-x"),
        y: option("-y"),
        n: option("-n", integer()),
      });
      assert.deepEqual(parseSync(parser, args), {
        success: true,
        value: { x: args[0].includes("x"), y: args[0].includes("y"), n: 5 },
      });
    });
  }
  for (const suffix of ["5", "5x", "-5", "--", "=5", "=", "한글", "🙂"]) {
    it(`preserves literal suffix ${suffix}`, () => {
      assert.deepEqual(parseSync(option("-n", string()), [`-n${suffix}`]), {
        success: true,
        value: suffix,
      });
    });
  }
  it("does not prefer numeric flags or retry a failed value", () => {
    const parser = object({
      n: option("-n", integer()),
      five: option("-5"),
      x: option("-x"),
    });
    assert.deepEqual(parseSync(parser, ["-n5"]), {
      success: true,
      value: { n: 5, five: false, x: false },
    });
    const bad = parseSync(parser, ["-n5x"]);
    assert.ok(!bad.success);
    if (!bad.success) assert.ok(formatMessage(bad.error).includes("-n"));
    assert.deepEqual(
      parseSync(object({ n: option("-n"), five: option("-5", integer()) }), [
        "-n5",
        "9",
      ]),
      { success: true, value: { n: true, five: 9 } },
    );
  });
  it("retains missing, next-token and terminated option semantics", () => {
    assert.ok(!parseSync(option("-n", string()), ["-n"]).success);
    for (const value of ["", "--", "-5"]) {
      assert.deepEqual(parseSync(option("-n", string()), ["-n", value]), {
        success: true,
        value,
      });
    }
    assert.deepEqual(
      parseSync(
        object({
          n: optional(option("-n", integer())),
          arg: argument(string()),
        }),
        ["--", "-n5"],
      ),
      { success: true, value: { n: undefined, arg: "-n5" } },
    );
    assert.ok(
      !parseSync(object({ n: option("-n", string()), x: option("-x") }), [
        "-zn5",
      ]).success,
    );
  });
  it("probes discriminators using their actual child execution path", async () => {
    const inner = constant("a");
    const discriminator = (path: readonly PropertyKey[]) => ({
      ...inner,
      canSkip: (_state: typeof inner.initialState, exec?: ExecutionContext) =>
        exec?.path.length === path.length &&
        path.every((segment, index) => exec.path[index] === segment),
    });
    assert.deepEqual(
      parseSync(
        conditional(discriminator(["_discriminator"]), {
          a: option("-verbose"),
        }),
        ["-verbose"],
      ),
      {
        success: true,
        value: ["a", true],
      },
    );
    const child = discriminator(["c", "_discriminator"]);
    const p = object({
      v: optional(option("-v", string())),
      c: conditional(child, { a: option("-verbose") }),
    });
    assert.deepEqual(parseSync(p, ["-verbose"]), {
      success: true,
      value: { v: undefined, c: ["a", true] },
    });
    const asyncChild = {
      ...child,
      mode: "async" as const,
      parse: (context: Parameters<typeof child.parse>[0]) =>
        Promise.resolve(child.parse(context)),
      complete: (
        state: Parameters<typeof child.complete>[0],
        exec?: ExecutionContext,
      ) => Promise.resolve(child.complete(state, exec)),
      suggest: async function* (
        context: Parameters<typeof child.suggest>[0],
        prefix: string,
      ) {
        yield* child.suggest(context, prefix);
      },
    };
    assert.deepEqual(
      await parseAsync(
        object({
          v: optional(option("-v", string())),
          c: conditional(asyncChild, { a: option("-verbose") }),
        }),
        ["-verbose"],
      ),
      {
        success: true,
        value: { v: undefined, c: ["a", true] },
      },
    );
  });
  it("uses aliases and existing occurrence policy", () => {
    const parser = option("-n", "-c", integer());
    assert.deepEqual(parseSync(parser, ["-c5"]), { success: true, value: 5 });
    const duplicate = parseSync(parser, ["-n5", "-c6"]);
    assert.ok(!duplicate.success);
    if (!duplicate.success) {
      assert.ok(formatMessage(duplicate.error).includes("multiple times"));
    }
    assert.deepEqual(parseSync(multiple(parser), ["-n5", "-c6"]), {
      success: true,
      value: [5, 6],
    });
    assert.deepEqual(parseSync(withDefault(parser, 1), ["-n5"]), {
      success: true,
      value: 5,
    });
  });
  it("handles Unicode short names in values, flag bundles and completion", async () => {
    const p = object({ mark: flag("-🚩"), value: option("-🙂", string()) });
    assert.deepEqual(parseSync(p, ["-🚩🙂hello"]), {
      success: true,
      value: { mark: true, value: "hello" },
    });
    assert.deepEqual(parseSync(option("-🙂", string()), ["-🙂=hello"]), {
      success: true,
      value: "=hello",
    });
    const completion = object({
      mark: negatableFlag({ positive: "-🚩", negative: "--no-mark" }),
      value: option("-🙂", choice(["hello"])),
    });
    assert.deepEqual(texts(suggestSync(completion, ["-🚩🙂he"])), [
      "-🚩🙂hello",
    ]);
    assert.deepEqual(
      await parseAsync(option("-🙂", asyncString()), ["-🙂hello"]),
      {
        success: true,
        value: "hello",
      },
    );
  });
  it("keeps routes of reused conditional occurrences", async () => {
    for (const discriminator of [choice(["a", "b"]), asyncString()]) {
      const shared = conditional(option("--mode", discriminator), {
        a: option("-verbose"),
        b: option("-other"),
      });
      const p = object({
        first: shared,
        second: shared,
        v: optional(option("-v", string())),
      }, { allowDuplicates: true });
      const result = await parseAsync(p, [
        "--mode",
        "a",
        "--mode",
        "b",
        "-verbose",
        "-other",
        "-verbose",
      ]);
      assert.ok(!result.success);
      if (!result.success) {
        assert.ok(formatMessage(result.error).includes("multiple times"));
      }
    }
  });

  it("keeps repeated parser routes while dropping inactive defaults", () => {
    const branch = conditional(option("--mode", choice(["a"])), {
      a: option("-p", string()),
    }, option("-port"));
    assert.deepEqual(parseSync(multiple(branch), ["--mode", "a", "-port"]), {
      success: true,
      value: [["a", "ort"]],
    });
  });
  it("keeps repeated routes through nested constructs", () => {
    const branch = conditional(option("--mode", choice(["a"])), {
      a: option("-p", string()),
    }, option("-port"));
    assert.deepEqual(
      parseSync(multiple(object({ branch })), ["--mode", "a", "-port"]),
      { success: true, value: [{ branch: ["a", "ort"] }] },
    );
  });
  it("recognizes Unicode short names when skipping sequence fields and completing names", async () => {
    assert.deepEqual(
      parseSync(
        seq(
          withDefault(argument(string()), "default"),
          option("-🙂", string()),
        ),
        ["-🙂hello"],
      ),
      { success: true, value: ["default", "hello"] },
    );
    for (
      const p of [
        option("-🙂", string()),
        flag("-🙂"),
        negatableFlag({ positive: "-🙂", negative: "--no-smile" }),
      ]
    ) {
      assert.ok(texts(suggestSync<unknown>(p, ["-"])).includes("-🙂"));
    }
    assert.ok(
      texts(await suggestAsync(option("-🙂", asyncString()), ["-"])).includes(
        "-🙂",
      ),
    );
  });
  it("lets a successful object alternative ignore a failed sequence's routes", async () => {
    for (const value of [string(), asyncString()]) {
      const p = object({
        failed: optional(
          seq(
            command("build", option("-verbose")),
            option("--required", value),
          ),
        ),
        fallback: seq(
          argument(value),
          option("-v", string()),
          argument(string()),
        ),
      });
      assert.deepEqual(await parseAsync(p, ["build", "-verbose", "bad"]), {
        success: true,
        value: { failed: undefined, fallback: ["build", "erbose", "bad"] },
      });
    }
  });
  it("shares committed discriminator routes after isolated parses", async () => {
    for (const value of [choice(["a"]), asyncString()]) {
      const p = object({
        v: optional(option("-v", string())),
        route: conditional(
          map(seq(option("--mode", value)), ([mode]) => mode),
          { a: option("-verbose") },
        ),
        other: option("--other"),
      });
      assert.deepEqual(
        await parseAsync(p, ["--mode", "a", "--other", "-verbose"]),
        {
          success: true,
          value: { v: undefined, route: ["a", true], other: true },
        },
      );
    }
  });
  it("works asynchronously and replays dependent attached values", async () => {
    assert.deepEqual(
      await parseAsync(
        object({ x: option("-x"), n: option("-n", asyncString()) }),
        ["-xnhello"],
      ),
      { success: true, value: { x: true, n: "hello" } },
    );
    const mode = dependency(choice(["dev", "prod"] as const));
    const level = mode.deriveSync({
      metavar: "LEVEL",
      defaultValue: () => "dev" as const,
      factory: (m) => choice(m === "dev" ? ["debug"] : ["quiet"]),
    });
    const parser = object({
      level: option("-l", level),
      mode: option("-m", mode),
    });
    assert.deepEqual(parseSync(parser, ["-lquiet", "-mprod"]), {
      success: true,
      value: { level: "quiet", mode: "prod" },
    });
  });
  for (const reversed of [false, true]) {
    it(`prefers full names in either field order (${reversed})`, () => {
      const short = withDefault(option("-p", string()), "absent");
      const long = optional(option("-port", integer(), { hidden: true }));
      const parser = object(reversed ? { long, short } : { short, long });
      assert.deepEqual(parseSync(parser, ["-port=8080"]), {
        success: true,
        value: { short: "absent", long: 8080 },
      });
      assert.deepEqual(parseSync(parser, ["-port", "8080"]), {
        success: true,
        value: { short: "absent", long: 8080 },
      });
      assert.deepEqual(parseSync(parser, ["-portXYZ"]), {
        success: true,
        value: { short: "ortXYZ", long: undefined },
      });
      const repeated = parseSync(parser, ["-port=1", "-port=2"]);
      assert.ok(!repeated.success);
      if (!repeated.success) {
        assert.ok(formatMessage(repeated.error).includes("multiple times"));
      }
    });
  }
  it("prefers Boolean and negatable full names to prefix flags", () => {
    for (
      const full of [
        option("-verbose"),
        optional(flag("-verbose")),
        negatableFlag({ positive: ["-verbose"], negative: ["--no-verbose"] }),
      ]
    ) {
      const parser = object({ short: option("-v"), full });
      assert.deepEqual(parseSync(parser, ["-verbose"]), {
        success: true,
        value: { short: false, full: true },
      });
      const bad = parseSync(parser, ["-verbose=1"]);
      assert.ok(!bad.success);
      if (!bad.success) assert.ok(formatMessage(bad.error).includes("value"));
    }
  });
  it("scopes merged, nested and tuple options", () => {
    const short = object({
      short: withDefault(option("-p", string()), "absent"),
    });
    const full = object({ full: option("-port", integer()) });
    assert.deepEqual(parseSync(merge(short, full), ["-port=7"]), {
      success: true,
      value: { short: "absent", full: 7 },
    });
    assert.deepEqual(parseSync(tuple([short, full]), ["-port=7"]), {
      success: true,
      value: [{ short: "absent" }, { full: 7 }],
    });
    assert.deepEqual(parseSync(object({ short, full }), ["-port=7"]), {
      success: true,
      value: { short: { short: "absent" }, full: { full: 7 } },
    });
    assert.deepEqual(
      parseSync(concat(tuple([short]), tuple([full])), ["-port=7"]),
      { success: true, value: [{ short: "absent" }, { full: 7 }] },
    );
  });
  it("reserves competing full names but not unentered commands", () => {
    for (
      const parser of [
        or(option("-v"), option("-verbose", string())),
        longestMatch(option("-v"), option("-verbose", string())),
      ]
    ) {
      assert.deepEqual(parseSync(parser, ["-verbose", "yes"]), {
        success: true,
        value: "yes",
      });
    }
    const parser = object({
      short: optional(option("-v", string())),
      cmd: optional(command("build", option("-verbose", string()))),
    });
    assert.deepEqual(parseSync(parser, ["-verbose"]), {
      success: true,
      value: { short: "erbose", cmd: undefined },
    });
    assert.deepEqual(parseSync(parser, ["build", "-verbose", "yes"]), {
      success: true,
      value: { short: undefined, cmd: "yes" },
    });
    assert.deepEqual(
      parseSync(
        conditional(constant("a"), {
          a: object({ s: option("-v"), l: option("-verbose") }),
        }),
        ["-verbose"],
      ),
      { success: true, value: ["a", { s: false, l: true }] },
    );
  });
  it("isolates longest-match candidate routing in either order", () => {
    const cmd = command("build", option("-verbose"));
    const steps = seq(argument(string()), option("-v", string()));
    for (const p of [longestMatch(cmd, steps), longestMatch(steps, cmd)]) {
      assert.deepEqual(parseSync(p, ["build", "-verbose"]), {
        success: true,
        value: ["build", "erbose"],
      });
    }
  });
  it("retains reached seq names in an object", () => {
    assert.ok(
      !parseSync(
        object({
          steps: seq(option("-verbose"), option("--finish")),
          short: optional(option("-v", string())),
        }),
        ["-verbose", "--finish", "-verbose"],
      ).success,
    );
  });
  it("drops speculative competitors after choosing a branch", async () => {
    const p = conditional(withDefault(option("--mode", asyncString()), "a"), {
      a: object({ x: option("-x", string()), p: option("-p", string()) }),
      b: option("-port"),
    });
    assert.deepEqual(await parseAsync(p, ["-xhello", "-port"]), {
      success: true,
      value: ["a", { x: "hello", p: "ort" }],
    });
  });
  it("keeps entered command names reserved for sibling parsers", () => {
    const p = object({
      cmd: command("build", option("-verbose")),
      short: optional(option("-v", string())),
    });
    const result = parseSync(p, ["build", "-verbose", "-verbose"]);
    assert.ok(!result.success);
    if (!result.success) {
      assert.ok(formatMessage(result.error).includes("multiple times"));
    }
  });
  it("drops inactive default names after selecting a conditional branch", async () => {
    const p = conditional(
      option("--mode", choice(["a"])),
      { a: option("-p", string()) },
      option("-port"),
    );
    assert.deepEqual(parseSync(p, ["--mode", "a", "-port"]), {
      success: true,
      value: ["a", "ort"],
    });
    assert.deepEqual(
      parseSync(command("build", p), ["build", "--mode", "a", "-port"]),
      {
        success: true,
        value: ["a", "ort"],
      },
    );
    const asyncP = conditional(option("--mode", asyncString()), {
      a: option("-p", string()),
    }, option("-port"));
    assert.deepEqual(await parseAsync(asyncP, ["--mode", "a", "-port"]), {
      success: true,
      value: ["a", "ort"],
    });
    assert.deepEqual(
      parseSync(object({ branch: p }), ["--mode", "a", "-port"]),
      {
        success: true,
        value: { branch: ["a", "ort"] },
      },
    );
  });
  it("preserves conditional ownership through transparent wrappers", () => {
    const p = conditional(option("--mode", choice(["a"])), {
      a: option("-p", string()),
    }, option("-port"));
    for (
      const wrapped of [
        optional(p),
        withDefault(p, ["fallback", false] as const),
        group("Branch", p),
        map(p, (value) => value),
      ]
    ) {
      assert.deepEqual(
        parseSync(object({ branch: wrapped }), ["--mode", "a", "-port"]),
        {
          success: true,
          value: { branch: ["a", "ort"] },
        },
      );
    }
  });
  it("reserves the next reachable seq child's full name", async () => {
    const p = object({
      v: optional(option("-v", string())),
      steps: seq(option("--start"), option("-verbose")),
    });
    assert.deepEqual(parseSync(p, ["-verbose"]), {
      success: true,
      value: { v: undefined, steps: [false, true] },
    });
    assert.deepEqual(parseSync(p, ["--start", "-verbose"]), {
      success: true,
      value: { v: undefined, steps: [true, true] },
    });
    assert.deepEqual(
      await parseAsync(
        object({
          v: optional(option("-v", string())),
          steps: seq(option("--start", asyncString()), option("-verbose")),
        }),
        ["--start", "yes", "-verbose"],
      ),
      {
        success: true,
        value: { v: undefined, steps: ["yes", true] },
      },
    );
    assert.deepEqual(
      parseSync(
        object({
          v: optional(option("-v", string())),
          steps: seq(option("--start", string()), option("-verbose")),
        }),
        ["-verbose", "--start", "yes"],
      ),
      {
        success: true,
        value: { v: "erbose", steps: ["yes", false] },
      },
    );
  });
  it("reserves skippable discriminator candidates before sibling probes", async () => {
    const p = object({
      v: optional(option("-v", string())),
      c: conditional(withDefault(option("--mode", choice(["a", "b"])), "a"), {
        a: option("-verbose"),
        b: option("-x"),
      }),
    });
    assert.deepEqual(parseSync(p, ["-verbose"]), {
      success: true,
      value: { v: undefined, c: ["a", true] },
    });
    assert.deepEqual(
      await parseAsync(
        object({
          v: optional(option("-v", string())),
          c: conditional(withDefault(option("--mode", asyncString()), "a"), {
            a: option("-verbose"),
            b: option("-x"),
          }),
        }),
        ["-verbose"],
      ),
      {
        success: true,
        value: { v: undefined, c: ["a", true] },
      },
    );
    assert.deepEqual(
      parseSync(
        object({
          v: option("-v", string()),
          c: optional(
            conditional(option("--mode", choice(["a"])), {
              a: option("-verbose"),
            }),
          ),
        }),
        ["-verbose"],
      ),
      {
        success: true,
        value: { v: "erbose", c: undefined },
      },
    );
  });
  it("does not publish unmatched or empty conditional probes", async () => {
    for (const a of [option("-verbose"), constant(null)]) {
      const c = conditional(
        withDefault(option("--mode", choice(["a", "b"])), "a"),
        {
          a,
          b: option("-xtra"),
        },
      );
      const v = optional(option("-x", string()));
      for (const p of [object({ c, v }), object({ v, c })]) {
        assert.ok(!parseSync(p, ["-xtra"]).success);
      }
    }
    const c = conditional(withDefault(option("--mode", asyncString()), "a"), {
      a: option("-verbose"),
      b: option("-xtra"),
    });
    const v = optional(option("-x", string()));
    for (const p of [object({ c, v }), object({ v, c })]) {
      assert.ok(!(await parseAsync(p, ["-xtra"])).success);
      assert.deepEqual(await parseAsync(p, ["--mode", "a", "-xtra"]), {
        success: true,
        value: { c: ["a", false], v: "tra" },
      });
    }
  });
  it("uses registered annotations for conditional candidate eligibility", async () => {
    const env = createEnvContext({
      source: (key) => key === "MODE" ? "a" : undefined,
    });
    const p = object({
      v: optional(option("-v", string())),
      c: conditional(
        bindEnv(option("--mode", choice(["a", "b"])), {
          context: env,
          key: "MODE",
          parser: choice(["a", "b"]),
        }),
        { a: option("-verbose"), b: option("-x") },
      ),
    });
    assert.deepEqual(
      parseSync(p, ["-verbose"], { annotations: await env.getAnnotations() }),
      {
        success: true,
        value: { v: undefined, c: ["a", true] },
      },
    );
  });
  it("does not read conditional env fallbacks for an explicit CLI discriminator", async () => {
    const env = createEnvContext({
      source: () => {
        throw new Error("Unexpected env read.");
      },
    });
    const p = object({
      v: optional(option("-v", string())),
      c: conditional(
        bindEnv(option("--mode", choice(["a"])), {
          context: env,
          key: "MODE",
          parser: choice(["a"]),
        }),
        { a: option("-verbose") },
      ),
    });
    assert.deepEqual(
      parseSync(p, ["--mode", "a", "-verbose"], {
        annotations: await env.getAnnotations(),
      }),
      {
        success: true,
        value: { v: undefined, c: ["a", true] },
      },
    );
  });
  it("honors full numeric-looking names and manual contexts", () => {
    const parser = object({
      short: optional(option("-n", string())),
      full: option("-n5"),
    });
    assert.deepEqual(parseSync(parser, ["-n5"]), {
      success: true,
      value: { short: undefined, full: true },
    });
    const primitive = option("-n", string());
    const r = primitive.parse({
      buffer: ["-nhello"],
      state: undefined,
      usage: primitive.usage,
      optionsTerminated: false,
    });
    assert.ok(r.success);
    if (r.success) {
      assert.deepEqual(r.next.state, { success: true, value: "hello" });
    }
  });
  it("scopes asynchronous speculative conditional branches", async () => {
    const parser = conditional(
      withDefault(option("--mode", asyncString()), "long"),
      { short: option("-v"), long: option("-verbose", string()) },
    );
    assert.deepEqual(await parseAsync(parser, ["-verbose", "yes"]), {
      success: true,
      value: ["long", "yes"],
    });
  });
  it("keeps previously reached seq names reserved", () => {
    assert.ok(
      !parseSync(seq(option("-verbose"), option("-v", string())), [
        "-verbose",
        "-verbose",
      ]).success,
    );
    assert.deepEqual(
      parseSync(seq(option("-n", integer()), option("-verbose")), [
        "-n5",
        "-verbose",
      ]),
      { success: true, value: [5, true] },
    );
  });
});

describe("attached short option completion", () => {
  const parser = object({
    x: option("-x"),
    n: option("-n", choice(["json", "yaml"])),
  });
  for (
    const [prefix, expected] of [["-nj", ["-njson"]], ["-xnj", ["-xnjson"]], [
      "-n",
      ["-n", "-njson", "-nyaml"],
    ], ["-n=j", []]] as const
  ) {
    it(`completes ${prefix}`, () =>
      assert.deepEqual(texts(suggestSync(parser, [prefix])), expected));
  }
  it("honors long-name prefixes, scope, and terminators", () => {
    const full = object({
      n: optional(option("-n", choice(["json", "yaml"]))),
      longer: option("-njobs"),
    });
    assert.deepEqual(texts(suggestSync(full, ["-nj"])), ["-njobs"]);
    assert.deepEqual(texts(suggestSync(parser, ["--", "-nj"])), []);
    assert.deepEqual(texts(suggestSync(parser, ["-n", "json", "-ny"])), []);
    assert.deepEqual(texts(suggestSync(parser, ["-n", "j"])), ["json"]);
    assert.deepEqual(
      texts(suggestSync(command("build", parser), ["build", "-xnj"])),
      ["-xnjson"],
    );
  });
  it("finds sibling root flags past a command", () => {
    const p = object({
      cmd: command("build", constant(null)),
      x: option("-x"),
      n: option("-n", choice(["json"])),
    });
    assert.deepEqual(texts(suggestSync(p, ["-xnj"])), ["-xnjson"]);
  });
  it("excludes arities of unentered command alternatives", () => {
    const p = or(parser, command("other", option("-x", string())));
    assert.deepEqual(texts(suggestSync(p, ["-xnj"])), ["-xnjson"]);
  });
  it("resolves conditional scope during completion", async () => {
    assert.deepEqual(
      texts(suggestSync(
        conditional(constant("a"), {
          a: option("-p", choice(["ort"])),
        }, option("-port")),
        ["-po"],
      )),
      ["-port"],
    );
    const inner = choice(["ort"]);
    const value: ValueParser<"async", string> = {
      ...inner,
      mode: "async",
      parse: (s) => Promise.resolve(inner.parse(s)),
      suggest: async function* (prefix) {
        yield* inner.suggest!(prefix);
      },
    };
    assert.deepEqual(
      texts(
        await suggestAsync(
          conditional(constant("a"), {
            a: option("-p", value),
          }, option("-port")),
          ["-po"],
        ),
      ),
      ["-port"],
    );
  });
  it("uses the entered command's flag arity", () => {
    const p = or(
      command("build", parser),
      command("other", option("-x", string())),
    );
    assert.deepEqual(texts(suggestSync(p, ["build", "-xnj"])), ["-xnjson"]);
  });
  it("preserves async and file-pattern suggestions", async () => {
    const inner = choice(["json", "yaml"]);
    const value: ValueParser<"async", string> = {
      ...inner,
      mode: "async",
      parse: (s) => Promise.resolve(inner.parse(s)),
      suggest: async function* (prefix) {
        yield* inner.suggest!(prefix);
      },
    };
    assert.deepEqual(
      texts(
        await suggestAsync(
          object({ x: option("-x"), n: option("-n", value) }),
          ["-xnj"],
        ),
      ),
      ["-xnjson"],
    );
    const file: ValueParser<"sync", string> = {
      ...string(),
      suggest: function* () {
        yield { kind: "file", type: "any", pattern: "*.txt" };
      },
    };
    assert.deepEqual(texts(suggestSync(option("-f", file), ["-fa"])), [
      "-f*.txt",
    ]);
  });
});
