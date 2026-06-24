import { object } from "@optique/core/constructs";
import {
  concat,
  group,
  longestMatch,
  merge,
  or,
  seq,
  tuple,
} from "@optique/core/constructs";
import { nonEmpty as nonEmptyModifier } from "@optique/core/modifiers";
import { fluent, type FluentParser } from "@optique/core/fluent";
import { parse, type Parser } from "@optique/core/parser";
import { argument, constant, option } from "@optique/core/primitives";
import {
  integer,
  string,
  type ValueParser,
  type ValueParserResult,
} from "@optique/core/valueparser";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("fluent", () => {
  it("should decorate custom parsers without changing parser identity", () => {
    const parser = constant("value");

    const decorated = fluent(parser);

    assert.equal(decorated, parser);
    assert.equal(typeof decorated.map, "function");
    assert.ok(!Object.keys(decorated).includes("map"));
  });

  it("should replace unrelated parser methods with fluent helpers", () => {
    const rawParser: Parser<"sync", string, string> = {
      mode: "sync",
      $valueType: [],
      $stateType: [],
      priority: 0,
      usage: [],
      leadingNames: new Set(),
      acceptingAnyToken: false,
      initialState: "value",
      parse: (context) => ({
        success: true,
        next: context,
        consumed: [],
      }),
      complete: (state) => ({ success: true, value: state }),
      suggest: () => [],
      getDocFragments: () => ({ fragments: [] }),
    };
    const parser = Object.assign(rawParser, {
      map: () => constant("wrong"),
      optional: () => constant("wrong"),
      withDefault: () => constant("wrong"),
      multiple: () => constant("wrong"),
      nonEmpty: () => constant("wrong"),
    });

    const decorated = fluent(parser);
    const result = parse(decorated.map((value) => value.toUpperCase()), []);

    assert.deepEqual(result, { success: true, value: "VALUE" });
  });

  it("should chain modifier methods on decorated custom parsers", () => {
    const parser = fluent(constant("value"))
      .map((value) => value.toUpperCase())
      .optional()
      .withDefault("fallback");

    const result = parse(parser, []);

    assert.deepEqual(result, { success: true, value: "VALUE" });
  });

  it("should expose fluent methods from built-in primitive factories", () => {
    const parser = option("--port", integer())
      .map((port) => port + 1)
      .withDefault(3001);

    assert.deepEqual(parse(parser, ["--port", "3000"]), {
      success: true,
      value: 3001,
    });
    assert.deepEqual(parse(parser, []), { success: true, value: 3001 });
  });

  it("should expose fluent methods from built-in structural parsers", () => {
    const parser = object({
      name: argument(string()),
    }).map((value) => value.name);

    assert.deepEqual(parse(parser, ["Optique"]), {
      success: true,
      value: "Optique",
    });
  });

  it("should type structural combinators as fluent parsers", () => {
    const parsers = [
      or(option("--name", string()), option("--fallback", string())).map((
        value,
      ) => value),
      longestMatch(option("--name", string()), option("--fallback", string()))
        .map((value) => value),
      tuple([argument(string())]).map((value) => value[0]),
      seq(argument(string())).map((value) => value[0]),
      merge(
        object({ name: option("--name", string()) }),
        object({ count: option("--count", integer()) }),
      ).map((value) => value.name),
      concat(
        tuple([argument(string())]),
        tuple([argument(integer())]),
      ).map((value) => value[0]),
      group("group", option("--name", string())).map((value) => value),
      nonEmptyModifier(option("--name", string())).map((value) => value),
    ];

    assert.ok(parsers.every((parser) => typeof parser.map === "function"));
  });

  it("should preserve async mode through fluent modifier chains", async () => {
    const parser = option("--name", asyncString())
      .map((name) => name.toUpperCase())
      .optional();

    const result = await parse(parser, ["--name", "optique"]);

    assert.deepEqual(result, { success: true, value: "OPTIQUE" });
  });

  it("should type built-in factories as fluent parsers", () => {
    const parser: FluentParser<
      "sync",
      number,
      ValueParserResult<number> | undefined
    > = option("--count", integer());

    assert.equal(typeof parser.map, "function");
  });
});

// Helpers

function asyncString(): ValueParser<"async", string> {
  return {
    mode: "async",
    metavar: "TEXT",
    placeholder: "",
    parse(input: string): Promise<ValueParserResult<string>> {
      return Promise.resolve({ success: true, value: input });
    },
    format(value: string): string {
      return value;
    },
  };
}
