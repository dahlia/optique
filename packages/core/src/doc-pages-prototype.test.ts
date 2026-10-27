import assert from "node:assert/strict";
import process from "node:process";
import { readFileSync, writeFileSync } from "node:fs";
import { it } from "node:test";
import { hiddenCommandAliasesKey } from "#src/internal/command-alias.ts";
import { object, or, seq } from "#src/constructs.ts";
import { message } from "#src/message.ts";
import { multiple, optional, withDefault } from "#src/modifiers.ts";
import { argument, command, flag, option } from "#src/primitives.ts";
import { choice, integer, string } from "#src/valueparser.ts";
import { collectDocPages } from "#src/doc-pages.ts";
const collectPrototypePages = <M extends import("#src/parser.ts").Mode, T, S>(
  parser: import("#src/parser.ts").Parser<M, T, S>,
) => collectDocPages(parser, { strict: false });
import { formatMessage } from "#src/message.ts";
import { formatUsage } from "#src/usage.ts";

it("records the frozen documentation-only registry prototype outcome", () => {
  const oracle = JSON.parse(
    readFileSync(
      new URL(
        "../../man/test/prototypes/markdown-collection/oracle.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const counters = new Map<string, number>();
  const objects: object[] = [];
  const count = (name: string) =>
    counters.set(name, (counters.get(name) ?? 0) + 1);
  const watch = <T extends object>(input: T): T => {
    objects.push(input);
    for (
      const name of [
        "parse",
        "complete",
        "suggest",
        "getDocFragments",
        "format",
        "normalizeValue",
        "validateValue",
        "normalize",
        "validate",
      ]
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(input, name);
      if (descriptor == null || typeof descriptor.value !== "function") {
        continue;
      }
      const original = descriptor.value;
      Object.defineProperty(input, name, {
        ...descriptor,
        value(...args: unknown[]) {
          count(name);
          return Reflect.apply(original, input, args);
        },
      });
    }
    return input;
  };
  const numeric = watch(integer({ metavar: "PORT" }));
  const format = watch(choice(["json", "text"], { metavar: "FORMAT" }));
  const text = watch(string({ metavar: "KEY" }));
  const customValue = watch({
    mode: "async" as const,
    placeholder: "",
    metavar: "VALUE" as const,
    // deno-lint-ignore require-await -- Any execution must reject immediately.
    async parse(
      _input: string,
    ): Promise<{ readonly success: true; readonly value: string }> {
      throw new Error("Runtime resolver.");
    },
    format(_value: string): string {
      throw new Error("Custom formatting.");
    },
    normalize(_value: string): string {
      throw new Error("Custom normalization.");
    },
    validate(_value: string): never {
      throw new Error("Custom validation.");
    },
    // deno-lint-ignore require-yield -- Any iteration must throw immediately.
    async *suggest(_prefix: string): AsyncGenerator<never> {
      throw new Error("Custom suggestions.");
    },
  });
  const verbose = watch(
    optional(
      watch(flag("--verbose", { description: message`Detailed output.` })),
    ),
  );
  const servePort = watch(
    withDefault(
      watch(
        option("--port", numeric, { description: message`Listening port.` }),
      ),
      8080,
    ),
  );
  const get = watch(
    command("get", watch(multiple(watch(argument(text)), { min: 1 })), {
      aliases: ["g"],
    }),
  );
  const setAliases = {
    aliases: ["s"] as const,
    [hiddenCommandAliasesKey]: ["old-set"] as const,
  };
  const set = watch(
    command("set", watch(option("--format", format)), setAliases),
  );
  const config = watch(command("config", watch(or(get, set))));
  const customParser = watch({ ...flag("--opaque-input") });
  const hiddenParser = watch({ ...flag("--hidden-input") });
  const root = watch(object({
    verbose,
    action: watch(or(
      watch(command("serve", servePort)),
      config,
      watch(command("async", watch(option("--value", customValue)))),
      watch(command("opaque", customParser)),
      watch(command("secret", hiddenParser, { hidden: "doc" })),
    )),
  }));
  const prefixed = watch(
    seq(
      watch(argument(watch(string({ metavar: "PROFILE" })))),
      watch(command("serve", servePort)),
    ),
  );
  const thunk = () => {
    count("defaultThunk");
    throw new Error("Default thunk.");
  };
  const defaultOmitted = watch(
    withDefault(watch(option("--dynamic", numeric)), thunk),
  );
  const defaultDocumented = watch(
    withDefault(watch(option("--dynamic", numeric)), thunk, {
      message: message`port chosen by the application`,
    }),
  );
  const usageCallback = () => {
    count("usageLine");
    throw new Error("Usage callback.");
  };
  const customFallback = watch(
    withDefault(watch(option("--custom-default", customValue)), "initial"),
  );
  const functional = watch(
    command("dynamic", servePort, { usageLine: usageCallback }),
  );
  Object.defineProperty(customValue, "choices", {
    configurable: true,
    get() {
      count("choices");
      throw new Error("Custom choices.");
    },
  });
  const poison = () => {
    throw new Error("Forbidden collection callback.");
  };
  counters.clear();
  for (const input of objects) {
    for (
      const name of [
        "parse",
        "complete",
        "suggest",
        "getDocFragments",
        "format",
        "normalizeValue",
        "validateValue",
        "normalize",
        "validate",
        "metavar",
        "choices",
        "usage",
        "initialState",
        "mode",
      ]
    ) {
      const descriptor = Object.getOwnPropertyDescriptor(input, name);
      if (descriptor == null || !descriptor.configurable) continue;
      Object.defineProperty(
        input,
        name,
        ["metavar", "choices", "usage", "initialState", "mode"].includes(name)
          ? {
            configurable: true,
            get() {
              count(name);
              return poison();
            },
          }
          : {
            configurable: true,
            value() {
              count(name);
              return poison();
            },
          },
      );
    }
  }
  const result = collectPrototypePages(root);
  const prefixResult = collectPrototypePages(prefixed);
  const omitted = collectPrototypePages(defaultOmitted);
  const documented = collectPrototypePages(defaultDocumented);
  const functionalResult = collectPrototypePages(functional);
  collectPrototypePages(customFallback);
  const paths = result.entries.map((entry) => entry.path);
  assert.deepEqual(paths, oracle.expectedPaths);
  assert.ok(
    result.entries.every((entry) =>
      entry.page.sections.flatMap((section) => section.entries).some((entry) =>
        entry.term.type === "option" && entry.term.names.includes("--verbose")
      )
    ),
  );
  assert.ok(result.entries.every((entry) => !entry.path.includes("secret")));
  assert.ok(
    result.unresolved.every((report) => !report.path.includes("secret")),
  );
  const portEntry = result.entries.find((entry) =>
    entry.path.join("/") === "serve"
  )?.page.sections.flatMap((section) => section.entries).find((entry) =>
    entry.term.type === "option" && entry.term.names.includes("--port")
  );
  const choiceEntry = result.entries.find((entry) =>
    entry.path.join("/") === "config/set"
  )?.page.sections.flatMap((section) => section.entries).find((entry) =>
    entry.term.type === "option" && entry.term.names.includes("--format")
  );
  assert.ok(portEntry != null);
  assert.ok(choiceEntry != null);
  const failures: string[] = [];
  if (
    portEntry.default == null ||
    formatMessage(portEntry.default, { colors: false }) !==
      oracle.requiredStaticDefault.text
  ) failures.push("static-default");
  if (
    choiceEntry.choices == null ||
    !oracle.requiredChoices.values.every((value: string) =>
      formatMessage(choiceEntry.choices ?? [], { colors: false }).includes(
        value,
      )
    )
  ) failures.push("choices");
  if (
    JSON.stringify(
      result.unresolved.map((report) => JSON.stringify(report)).sort(),
    ) !== JSON.stringify(
      oracle.expectedReports.map((report: unknown) => JSON.stringify(report))
        .sort(),
    )
  ) failures.push("unexpected-reports");
  assert.deepEqual(failures, []);
  assert.ok(
    prefixResult.entries.some((entry) => entry.path.join("/") === "serve"),
  );
  assert.ok(
    prefixResult.entries.every((entry) => !entry.path.includes("prod")),
  );
  const prefixPage = prefixResult.entries.find((entry) =>
    entry.path.join("/") === "serve"
  )?.page;
  assert.ok(prefixPage?.usage);
  assert.equal(
    formatUsage("probe", prefixPage.usage, { colors: false }),
    oracle.orderedPrefix.usage,
  );
  assert.ok(
    omitted.entries[0].page.sections.flatMap((section) => section.entries)
      .every((entry) => entry.default == null),
  );
  assert.ok(
    documented.entries[0].page.sections.flatMap((section) => section.entries)
      .some((entry) =>
        entry.default != null &&
        formatMessage(entry.default, { colors: false }) ===
          oracle.documentedFunctionDefault
      ),
  );
  assert.ok(
    functionalResult.unresolved.some((report) =>
      report.reason === "functional-usage"
    ),
  );
  assert.ok(
    functionalResult.entries.find((entry) => entry.path[0] === "dynamic")?.page
      .usage == null,
  );
  assert.equal(
    [...counters.values()].reduce((sum, count) => sum + count, 0),
    oracle.forbiddenCounterDelta,
  );
  const reportPath = process.env.OPTIQUE_DOC_PROTOTYPE_OUTPUT;
  if (reportPath != null) {
    writeFileSync(
      reportPath,
      JSON.stringify(
        {
          status: "passed-fixed-oracle",
          failures,
          entries: result.entries,
          paths,
          unresolved: result.unresolved,
          prefixUsage: formatUsage("probe", prefixPage.usage, {
            colors: false,
          }),
          callbackCounters: Object.fromEntries(
            [
              "parse",
              "complete",
              "suggest",
              "getDocFragments",
              "format",
              "normalizeValue",
              "validateValue",
              "normalize",
              "validate",
              "metavar",
              "choices",
              "usage",
              "initialState",
              "mode",
              "defaultThunk",
              "usageLine",
            ].map((name) => [name, counters.get(name) ?? 0]),
          ),
          forbiddenCounterDelta: 0,
          parserInterfaceChanged: false,
          constructorsOutsideFrozenListChanged: false,
        },
        null,
        2,
      ) + "\n",
    );
  }
});
