import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { group, object, or } from "@optique/core/constructs";
import { withDefault } from "@optique/core/modifiers";
import { getDocPage, getDocPageAsync } from "@optique/core/parser";
import { runParser } from "@optique/core/facade";
import * as fc from "fast-check";
import { command, fail, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import type { OptionName } from "@optique/core/usage";
import { bindEnv, createEnvContext } from "@optique/env";

describe("bindEnv documentation", () => {
  const context = createEnvContext({
    prefix: "APP_",
    source() {
      throw new Error("Documentation must not read the source.");
    },
  });
  const bound = (name: OptionName, key: string, hidden?: true | "usage") =>
    bindEnv(option(name, string(), { hidden }), {
      context,
      key,
      parser: string(),
    });

  it("adds full names through groups and defaults without reading the source", async () => {
    const parser = object({
      name: group("Settings", withDefault(bound("--name", "NAME"), "guest")),
    });
    const page = getDocPage(parser);
    assert.ok(page);
    assert.deepEqual(page.sections[0].entries[0], {
      term: { type: "option", names: ["--name"], metavar: "STRING" },
      default: [{ type: "value", value: "guest" }],
      envVars: ["APP_NAME"],
    });
    assert.deepEqual(await getDocPageAsync(parser), page);
  });

  it("documents nested names outer-first, without duplicate names", () => {
    const parser = bindEnv(
      bindEnv(bound("--name", "NAME"), {
        context,
        key: "OTHER",
        parser: string(),
      }),
      { context, key: "NAME", parser: string() },
    );
    const page = getDocPage(parser);
    assert.ok(page);
    assert.deepEqual(page.sections[0].entries[0].envVars, [
      "APP_NAME",
      "APP_OTHER",
    ]);
  });

  it("keeps exclusive entry deduplication first-wins", () => {
    const page = getDocPage(
      or(bound("--name", "FIRST"), bound("--name", "SECOND")),
    );
    assert.ok(page);
    assert.deepEqual(page.sections[0].entries[0].envVars, ["APP_FIRST"]);
  });

  it("follows selected command scope and hidden entries", () => {
    const parser = or(
      command(
        "one",
        object({
          visible: bound("--name", "NAME", "usage"),
          secret: bound("--secret", "SECRET", true),
        }),
      ),
      command("two", bound("--other", "OTHER")),
    );
    const page = getDocPage(parser, ["one"]);
    assert.ok(page);
    assert.equal(page.sections.flatMap((s) => s.entries).length, 1);
    assert.deepEqual(page.sections[0].entries[0].envVars, ["APP_NAME"]);
    assert.ok(!JSON.stringify(getDocPage(parser)).includes("APP_"));
  });

  it("records entryless env-only bindings without synthesizing CLI entries", () => {
    const parser = bindEnv(fail<string>(), {
      context,
      key: "NAME",
      parser: string(),
    });
    assert.deepEqual(getDocPage(parser)?.sections, []);
    assert.deepEqual(getDocPage(parser)?.environmentBindings, [{
      name: "APP_NAME",
    }]);
  });

  it("preserves arbitrary declared prefixes and keys without reading values", () => {
    fc.assert(fc.property(fc.string(), fc.string(), (prefix, key) => {
      const context = createEnvContext({
        prefix,
        source() {
          throw new Error("Unexpected source read.");
        },
      });
      const parser = bindEnv(option("--name", string()), {
        context,
        key,
        parser: string(),
      });
      const page = getDocPage(parser);
      assert.ok(page);
      assert.deepEqual(page.sections[0].entries[0].envVars, [
        `${prefix}${key}`,
      ]);
    }));
  });

  it("annotates all documented children of a composite binding", () => {
    const parser = bindEnv(
      object({
        name: option("--name", string()),
        path: option("--path", string()),
      }),
      {
        context,
        key: "SETTINGS",
        parser: {
          mode: "sync",
          metavar: "SETTINGS",
          placeholder: { name: "n", path: "p" },
          parse: () => ({ success: true, value: { name: "n", path: "p" } }),
          format: () => "settings",
        },
      },
    );
    const page = getDocPage(parser);
    assert.ok(page);
    assert.deepEqual(
      page.sections.flatMap((s) => s.entries).map((e) => e.envVars),
      [["APP_SETTINGS"], ["APP_SETTINGS"]],
    );
  });

  it("renders help and full error help while keeping callback sections unchanged", () => {
    const parser = bound("--name", "NAME");
    for (const args of [["--help"], ["help"], ["--bad"]]) {
      const output: string[] = [];
      runParser(parser, "app", args, {
        help: {
          option: true,
          command: true,
          onShow(_code, page) {
            assert.equal(page.sections.length, 1);
            assert.deepEqual(page.sections[0].entries[0].envVars, ["APP_NAME"]);
          },
        },
        aboveError: "help",
        onError() {},
        colors: false,
        showEnvironment: { placement: "both" },
        stdout: (line) => output.push(line),
        stderr: (line) => output.push(line),
      });
      assert.match(output.join("\n"), /\[env: APP_NAME\]/);
      assert.match(output.join("\n"), /Environment:/);
    }
  });
});

it("supplies cloned visible env-only records to help callbacks without adding raw sections", () => {
  const context = createEnvContext({
    source() {
      throw new Error("Unexpected read.");
    },
  });
  const parser = object({
    visible: bindEnv(fail<string>(), {
      context,
      key: "VISIBLE",
      parser: string(),
    }),
    hidden: bindEnv(fail<string>(), {
      context,
      key: "HIDDEN",
      parser: string(),
      documentation: { hidden: true },
    }),
  });
  const output: string[] = [];
  runParser(parser, "app", ["--help"], {
    help: {
      option: true,
      onShow(_code, page) {
        assert.deepEqual(page.environmentBindings, [{ name: "VISIBLE" }]);
        assert.ok(
          page.sections.every((section) => section.title !== "Environment"),
        );
        assert.ok(!("sourceOnly" in page));
      },
    },
    showEnvironment: true,
    colors: false,
    stdout: (line) => output.push(line),
  });
  assert.ok(output.join("\n").includes("VISIBLE"));
  assert.ok(!output.join("\n").includes("HIDDEN"));
});
