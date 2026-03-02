import {
  longestMatch,
  merge,
  object,
  or,
  tuple,
} from "@optique/core/constructs";
import { dependency, deriveFrom } from "@optique/core/dependency";
import {
  parse,
  parseAsync,
  type Parser,
  parseSync,
  suggest,
  suggestAsync,
  type Suggestion,
  suggestSync,
} from "@optique/core/parser";
import {
  argument,
  command,
  constant,
  flag,
  option,
  passThrough,
} from "@optique/core/primitives";
import {
  multiple,
  nonEmpty,
  optional,
  withDefault,
} from "@optique/core/modifiers";
import { choice, integer, string } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import * as fc from "fast-check";
import { describe, it } from "node:test";

const propertyParameters = { numRuns: 200 } as const;
const complexPropertyParameters = { numRuns: 120 } as const;

type RandomParserAst =
  | { readonly kind: "flag"; readonly name: string }
  | { readonly kind: "optionInt"; readonly name: string }
  | { readonly kind: "argument" }
  | { readonly kind: "optional"; readonly child: RandomParserAst }
  | {
    readonly kind: "multiple";
    readonly child: RandomParserAst;
    readonly min: 0 | 1;
    readonly max: 1 | 2 | 3;
  }
  | {
    readonly kind: "object";
    readonly left: RandomParserAst;
    readonly right: RandomParserAst;
  }
  | {
    readonly kind: "tuple";
    readonly left: RandomParserAst;
    readonly right: RandomParserAst;
  }
  | {
    readonly kind: "or";
    readonly left: RandomParserAst;
    readonly right: RandomParserAst;
  };

function toIdentifier(raw: string): string {
  const normalized = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
  const withLeadingLetter = /^[a-z]/.test(normalized)
    ? normalized
    : `x${normalized}`;
  const trimmed = withLeadingLetter.slice(0, 12);
  return trimmed.length > 0 ? trimmed : "x";
}

const identifierArbitrary = fc
  .string({ minLength: 0, maxLength: 16 })
  .map(toIdentifier);

const argumentTokenArbitrary = fc
  .string({ minLength: 0, maxLength: 16 })
  .map((raw: string) => `arg${raw}`);

const shortOptionCharacterArbitrary = fc.constantFrom(
  ..."abcdefghijklmnopqrstuvwxyz",
);

const nonOptionTokenArbitrary = fc
  .string({ minLength: 0, maxLength: 16 })
  .map((raw: string) => `value${raw}`);

const optionLikeTokenArbitrary = fc.oneof(
  identifierArbitrary.map((name: string) => `--${name}`),
  shortOptionCharacterArbitrary.map((name: string) => `-${name}`),
);

const equalsOptionTokenArbitrary = fc
  .tuple(identifierArbitrary, fc.string({ minLength: 0, maxLength: 16 }))
  .map(([name, value]: readonly [string, string]) => `--${name}=${value}`);

const unknownEqualsOptionTokenArbitrary = fc
  .tuple(
    identifierArbitrary.filter((name: string) => name !== "debug"),
    fc.string({ minLength: 0, maxLength: 16 }),
  )
  .map(([name, value]: readonly [string, string]) => `--${name}=${value}`);

const adversarialTokenArbitrary = fc.oneof(
  fc.string({ minLength: 0, maxLength: 64 }),
  fc.constantFrom(
    "",
    "-",
    "--",
    "---",
    "--=",
    "=",
    "\\",
    '"',
    "'",
    " ",
    "\t",
    "\n",
    "--help",
    "--version",
    "--unknown",
    "-xyz",
    "--mode=dev",
    "--mode=",
    "\u0000",
  ),
);

function randomParserAstArbitrary(
  depth: number,
): fc.Arbitrary<RandomParserAst> {
  const leaf = fc.oneof(
    identifierArbitrary.map((name: string) =>
      ({ kind: "flag", name }) as const
    ),
    identifierArbitrary.map((name: string) =>
      ({ kind: "optionInt", name }) as const
    ),
    fc.constant({ kind: "argument" } as const),
  );

  if (depth <= 0) {
    return leaf;
  }

  const child = randomParserAstArbitrary(depth - 1);
  return fc.oneof(
    leaf,
    fc.record({ kind: fc.constant("optional"), child }),
    fc
      .record({
        kind: fc.constant("multiple"),
        child,
        min: fc.constantFrom<0 | 1>(0, 1),
        max: fc.constantFrom<1 | 2 | 3>(1, 2, 3),
      })
      .filter((bounds: { readonly min: 0 | 1; readonly max: 1 | 2 | 3 }) =>
        bounds.min <= bounds.max
      ),
    fc.record({ kind: fc.constant("object"), left: child, right: child }),
    fc.record({ kind: fc.constant("tuple"), left: child, right: child }),
    fc.record({ kind: fc.constant("or"), left: child, right: child }),
  );
}

const randomParserAst = randomParserAstArbitrary(3);

function compileRandomParserAst(
  ast: RandomParserAst,
): Parser<"sync", unknown, unknown> {
  switch (ast.kind) {
    case "flag":
      return flag(longOptionName(ast.name));
    case "optionInt":
      return option(longOptionName(ast.name), integer({ min: -9, max: 9 }));
    case "argument":
      return argument(string());
    case "optional":
      return optional(compileRandomParserAst(ast.child));
    case "multiple":
      return multiple(compileRandomParserAst(ast.child), {
        min: ast.min,
        max: ast.max,
      });
    case "object":
      return object({
        left: compileRandomParserAst(ast.left),
        right: compileRandomParserAst(ast.right),
      });
    case "tuple":
      return tuple([
        compileRandomParserAst(ast.left),
        compileRandomParserAst(ast.right),
      ]);
    case "or":
      return or(
        compileRandomParserAst(ast.left),
        compileRandomParserAst(ast.right),
      );
  }
}

function longOptionName(name: string): `--${string}` {
  return `--${name}` as `--${string}`;
}

function shortOptionName(name: string): `-${string}` {
  return `-${name}` as `-${string}`;
}

function permuteTokens<T>(tokens: readonly T[]): readonly (readonly T[])[] {
  if (tokens.length <= 1) {
    return [Array.from(tokens)];
  }

  const permutations: T[][] = [];
  for (let i = 0; i < tokens.length; i++) {
    const head = tokens[i];
    const tail = [...tokens.slice(0, i), ...tokens.slice(i + 1)];
    for (const suffix of permuteTokens(tail)) {
      permutations.push([head, ...suffix]);
    }
  }

  return permutations;
}

function permuteArgBlocks(
  blocks: readonly (readonly string[])[],
): readonly (readonly string[])[] {
  return permuteTokens(blocks).map((order) => order.flatMap((block) => block));
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function literalSuggestionTexts(
  suggestions: readonly Suggestion[],
): readonly string[] {
  return suggestions
    .filter((
      suggestion,
    ): suggestion is Extract<Suggestion, { kind: "literal" }> =>
      suggestion.kind === "literal"
    )
    .map((suggestion) => suggestion.text);
}

function literalSuggestionSet(
  suggestions: readonly Suggestion[],
): ReadonlySet<string> {
  return new Set(literalSuggestionTexts(suggestions));
}

function toSuggestionArgs(
  before: readonly string[],
  prefix: string,
): [string, ...readonly string[]] {
  return before.length > 0
    ? [before[0]!, ...before.slice(1), prefix]
    : [prefix];
}

describe("property-based tests", () => {
  it("integer parser should round-trip safe integers", () => {
    const parser = integer({});

    fc.assert(
      fc.property(
        fc.integer({
          min: Number.MIN_SAFE_INTEGER,
          max: Number.MAX_SAFE_INTEGER,
        }),
        (value: number) => {
          const parsed = parser.parse(parser.format(value));

          assert.ok(parsed.success);
          if (parsed.success) {
            assert.equal(parsed.value, value);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("choice parser should round-trip string choices", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.string({ minLength: 1, maxLength: 24 }), {
          minLength: 1,
          maxLength: 16,
        }),
        fc.nat(),
        (choices: readonly string[], index: number) => {
          const parser = choice(choices);
          const expected = choices[index % choices.length];
          const parsed = parser.parse(parser.format(expected));

          assert.ok(parsed.success);
          if (parsed.success) {
            assert.equal(parsed.value, expected);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("choice parser should round-trip number choices", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: -1_000_000, max: 1_000_000 }), {
          minLength: 1,
          maxLength: 16,
        }),
        fc.nat(),
        (choices: readonly number[], index: number) => {
          const parser = choice(choices);
          const expected = choices[index % choices.length];
          const parsed = parser.parse(parser.format(expected));

          assert.ok(parsed.success);
          if (parsed.success) {
            assert.equal(parsed.value, expected);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("string parser should be deterministic with stateful RegExp", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 24 }),
        fc.constantFrom("g", "y", "gy", "gi", "iy", "giy"),
        (literal: string, flags: string) => {
          const pattern = new RegExp(escapeRegExp(literal), flags);
          const parser = string({ pattern });

          const first = parser.parse(literal);
          const second = parser.parse(literal);

          assert.deepEqual(second, first);
          assert.equal(pattern.lastIndex, 0);
        },
      ),
      propertyParameters,
    );
  });

  it("parseAsync should agree with parseSync for sync parsers", async () => {
    const parser = option("--port", integer({ min: 1, max: 65535 }));

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constant<undefined>(undefined),
          fc.integer({ min: 1, max: 65535 }),
        ),
        async (port: number | undefined) => {
          const args = port == null ? [] : ["--port", `${port}`];
          const syncResult = parseSync(parser, args);
          const asyncResult = await parseAsync(parser, args);

          assert.deepEqual(asyncResult, syncResult);
        },
      ),
      propertyParameters,
    );
  });

  it("parse() should agree with parseSync for sync parsers", () => {
    const parser = object({
      port: withDefault(
        option("--port", integer({ min: 1, max: 65535 })),
        3000,
      ),
    });

    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant<undefined>(undefined),
          fc.integer({ min: 1, max: 65535 }),
        ),
        (port: number | undefined) => {
          const args = port == null ? [] : ["--port", `${port}`];
          const direct = parseSync(parser, args);
          const generic = parse(parser, args);

          assert.deepEqual(generic, direct);
        },
      ),
      propertyParameters,
    );
  });

  it("suggest() should agree with suggestSync for sync parsers", () => {
    const parser = object({
      mode: option("--mode", choice(["dev", "prod"] as const)),
    });

    fc.assert(
      fc.property(
        fc.constantFrom("", "-", "--", "--m", "--mode=", "d", "x"),
        fc.boolean(),
        fc.constantFrom<"dev" | "prod">("dev", "prod"),
        (prefix: string, alreadySet: boolean, mode: "dev" | "prod") => {
          const args = alreadySet ? ["--mode", mode, prefix] : [prefix];
          const direct = suggestSync(parser, args as [string, ...string[]]);
          const generic = suggest(parser, args as [string, ...string[]]);

          assert.deepEqual(generic, direct);
        },
      ),
      propertyParameters,
    );
  });

  it("suggestAsync should agree with suggestSync for sync parsers", async () => {
    const parser = object({
      mode: option("--mode", choice(["dev", "prod"] as const)),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom("", "-", "--", "--m", "--mode=", "d", "x"),
        fc.boolean(),
        fc.constantFrom<"dev" | "prod">("dev", "prod"),
        async (prefix: string, alreadySet: boolean, mode: "dev" | "prod") => {
          const args = alreadySet ? ["--mode", mode, prefix] : [prefix];
          const syncSuggestions = suggestSync(
            parser,
            args as [string, ...string[]],
          );
          const asyncSuggestions = await suggestAsync(
            parser,
            args as [string, ...string[]],
          );

          assert.deepEqual(asyncSuggestions, syncSuggestions);
        },
      ),
      propertyParameters,
    );
  });

  it("random parser ASTs should preserve parse parity", async () => {
    await fc.assert(
      fc.asyncProperty(
        randomParserAst,
        fc.array(adversarialTokenArbitrary, { minLength: 0, maxLength: 10 }),
        async (ast: RandomParserAst, args: readonly string[]) => {
          const parser = compileRandomParserAst(ast);
          const syncResult = parseSync(parser, args);
          const genericResult = parse(parser, args);
          const asyncResult = await parseAsync(parser, args);

          assert.deepEqual(genericResult, syncResult);
          assert.deepEqual(asyncResult, syncResult);
        },
      ),
      complexPropertyParameters,
    );
  });

  it("random parser ASTs should preserve suggest parity", async () => {
    await fc.assert(
      fc.asyncProperty(
        randomParserAst,
        fc.array(adversarialTokenArbitrary, { minLength: 0, maxLength: 8 }),
        adversarialTokenArbitrary,
        async (
          ast: RandomParserAst,
          before: readonly string[],
          prefix: string,
        ) => {
          const parser = compileRandomParserAst(ast);
          const argv = toSuggestionArgs(before, prefix);
          const syncSuggestions = suggestSync(parser, argv);
          const genericSuggestions = suggest(parser, argv);
          const asyncSuggestions = await suggestAsync(parser, argv);

          assert.deepEqual(genericSuggestions, syncSuggestions);
          assert.deepEqual(asyncSuggestions, syncSuggestions);
        },
      ),
      complexPropertyParameters,
    );
  });

  it("parsers should be reentrant across parse and suggest calls", async () => {
    const pattern = new RegExp("^[a-z0-9-]+$", "gy");
    const parser = object({
      mode: optional(option("--mode", choice(["dev", "prod"] as const))),
      tag: optional(option("--tag", string({ pattern }))),
      target: optional(argument(string())),
      passthrough: passThrough({ format: "nextToken" }),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(adversarialTokenArbitrary, { minLength: 0, maxLength: 8 }),
        adversarialTokenArbitrary,
        async (args: readonly string[], prefix: string) => {
          const first = parseSync(parser, args);
          const second = parseSync(parser, args);
          const argv = toSuggestionArgs(args, prefix);
          const firstSuggestions = suggestSync(parser, argv);
          const third = parseSync(parser, args);
          const secondSuggestions = suggestSync(parser, argv);
          const asyncResult = await parseAsync(parser, args);
          const asyncSuggestions = await suggestAsync(parser, argv);

          assert.deepEqual(second, first);
          assert.deepEqual(third, first);
          assert.deepEqual(secondSuggestions, firstSuggestions);
          assert.deepEqual(asyncResult, first);
          assert.deepEqual(asyncSuggestions, firstSuggestions);
          assert.equal(pattern.lastIndex, 0);
        },
      ),
      complexPropertyParameters,
    );
  });

  it("random parser ASTs should not leak state between calls", async () => {
    await fc.assert(
      fc.property(
        randomParserAst,
        fc.array(adversarialTokenArbitrary, { minLength: 0, maxLength: 8 }),
        adversarialTokenArbitrary,
        (
          ast: RandomParserAst,
          args: readonly string[],
          prefix: string,
        ) => {
          const parser = compileRandomParserAst(ast);
          const first = parseSync(parser, args);
          const argv = toSuggestionArgs(args, prefix);
          const firstSuggestions = suggestSync(parser, argv);
          const second = parseSync(parser, args);
          const secondSuggestions = suggestSync(parser, argv);

          assert.deepEqual(second, first);
          assert.deepEqual(secondSuggestions, firstSuggestions);
        },
      ),
      complexPropertyParameters,
    );
  });

  it("command suggestions should shrink with longer prefixes", () => {
    const parser = or(
      command("build", constant("build")),
      command("bundle", constant("bundle")),
      command("test", constant("test")),
      command("lint", constant("lint")),
    );

    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 4 }),
        fc.string({ minLength: 1, maxLength: 3 }),
        (basePrefix: string, suffix: string) => {
          const extendedPrefix = `${basePrefix}${suffix}`;
          const baseSuggestions = literalSuggestionSet(suggestSync(parser, [
            basePrefix,
          ]));
          const extendedSuggestions = literalSuggestionSet(suggestSync(parser, [
            extendedPrefix,
          ]));

          for (const suggestion of extendedSuggestions) {
            assert.ok(baseSuggestions.has(suggestion));
            assert.ok(suggestion.startsWith(extendedPrefix));
          }
        },
      ),
      propertyParameters,
    );
  });

  it("value suggestions should shrink with longer prefixes", () => {
    const parser = object({
      mode: option("--mode", choice(["dev", "prod", "preview"] as const)),
      target: option("--target", choice(["node", "browser"] as const)),
    });

    fc.assert(
      fc.property(
        fc.constantFrom("--mode", "--target"),
        fc.string({ minLength: 0, maxLength: 4 }),
        fc.string({ minLength: 1, maxLength: 3 }),
        (
          optionName: "--mode" | "--target",
          basePrefix: string,
          suffix: string,
        ) => {
          const extendedPrefix = `${basePrefix}${suffix}`;
          const baseSuggestions = literalSuggestionSet(suggestSync(parser, [
            optionName,
            basePrefix,
          ]));
          const extendedSuggestions = literalSuggestionSet(suggestSync(parser, [
            optionName,
            extendedPrefix,
          ]));

          for (const suggestion of extendedSuggestions) {
            assert.ok(baseSuggestions.has(suggestion));
            assert.ok(suggestion.startsWith(extendedPrefix));
          }
        },
      ),
      propertyParameters,
    );
  });

  it("parseSync should fail for unconsumed input loops", () => {
    const parser = constant("ok");

    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 16 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (args: readonly string[]) => {
          const result = parseSync(parser, args);

          assert.ok(!result.success);
        },
      ),
      propertyParameters,
    );
  });

  it("option parser should agree on separated and joined forms", () => {
    fc.assert(
      fc.property(
        identifierArbitrary,
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        (name: string, value: number) => {
          const optionName: `--${string}` = longOptionName(name);
          const parser = option(optionName, integer());
          const separated = parseSync(parser, [optionName, `${value}`]);
          const joined = parseSync(parser, [`${optionName}=${value}`]);

          assert.deepEqual(joined, separated);
        },
      ),
      propertyParameters,
    );
  });

  it("flag parser should succeed iff the flag appears", () => {
    fc.assert(
      fc.property(
        identifierArbitrary,
        fc.boolean(),
        (name: string, present: boolean) => {
          const optionName: `--${string}` = longOptionName(name);
          const parser = flag(optionName);
          const args = present ? [optionName] : [];
          const result = parseSync(parser, args);

          assert.equal(result.success, present);
          if (result.success) {
            assert.equal(result.value, true);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("flag parser should reject duplicate bundled short flags", () => {
    fc.assert(
      fc.property(shortOptionCharacterArbitrary, (name: string) => {
        const parser = flag(shortOptionName(name));
        const result = parseSync(parser, [`-${name}${name}`]);

        assert.ok(!result.success);
      }),
      propertyParameters,
    );
  });

  it("object of flags should require every flag", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(shortOptionCharacterArbitrary, {
          minLength: 3,
          maxLength: 3,
        }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (
          names: readonly string[],
          firstPresent: boolean,
          secondPresent: boolean,
          thirdPresent: boolean,
        ) => {
          const [firstName, secondName, thirdName] = names;
          const firstFlag = shortOptionName(firstName);
          const secondFlag = shortOptionName(secondName);
          const thirdFlag = shortOptionName(thirdName);

          const parser = object({
            first: flag(firstFlag),
            second: flag(secondFlag),
            third: flag(thirdFlag),
          });

          const selected = [
            ...(firstPresent ? [firstName] : []),
            ...(secondPresent ? [secondName] : []),
            ...(thirdPresent ? [thirdName] : []),
          ];
          const result = parseSync(parser, selected.map(shortOptionName));

          const shouldSucceed = firstPresent && secondPresent && thirdPresent;
          assert.equal(result.success, shouldSucceed);
          if (result.success) {
            assert.deepEqual(result.value, {
              first: true,
              second: true,
              third: true,
            });
          }
        },
      ),
      propertyParameters,
    );
  });

  it("flag parser should match bundled and separated forms", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(shortOptionCharacterArbitrary, {
          minLength: 3,
          maxLength: 3,
        }),
        fc.boolean(),
        (names: readonly string[], reverseOrder: boolean) => {
          const [firstName, secondName, thirdName] = names;
          const firstFlag = shortOptionName(firstName);
          const secondFlag = shortOptionName(secondName);
          const thirdFlag = shortOptionName(thirdName);

          const parser = object({
            first: flag(firstFlag),
            second: flag(secondFlag),
            third: flag(thirdFlag),
          });

          const ordered = reverseOrder
            ? [thirdName, secondName, firstName]
            : [firstName, secondName, thirdName];
          const separated = parseSync(parser, ordered.map(shortOptionName));
          const bundled = parseSync(parser, [`-${ordered.join("")}`]);

          assert.ok(separated.success);
          assert.ok(bundled.success);
          if (separated.success && bundled.success) {
            const expected = {
              first: true,
              second: true,
              third: true,
            };
            assert.deepEqual(separated.value, expected);
            assert.deepEqual(bundled.value, expected);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("argument parser should round-trip positional tokens", () => {
    const parser = argument(string());

    fc.assert(
      fc.property(argumentTokenArbitrary, (token: string) => {
        const result = parseSync(parser, [token]);

        assert.ok(result.success);
        if (result.success) {
          assert.equal(result.value, token);
        }
      }),
      propertyParameters,
    );
  });

  it("argument parser should treat option-like tokens after --", () => {
    const parser = argument(string());

    fc.assert(
      fc.property(
        identifierArbitrary,
        fc.boolean(),
        (name: string, longForm: boolean) => {
          const token = longForm ? `--${name}` : `-${name}`;
          const withoutTerminator = parseSync(parser, [token]);
          const withTerminator = parseSync(parser, ["--", token]);

          assert.ok(!withoutTerminator.success);
          assert.ok(withTerminator.success);
          if (withTerminator.success) {
            assert.equal(withTerminator.value, token);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("tuple should treat option-like tokens as arguments after --", () => {
    const parser = tuple([argument(string()), argument(string())]);

    fc.assert(
      fc.property(
        optionLikeTokenArbitrary,
        optionLikeTokenArbitrary,
        (first: string, second: string) => {
          const withTerminator = parseSync(parser, ["--", first, second]);
          const withoutTerminator = parseSync(parser, [first, second]);

          assert.ok(withTerminator.success);
          if (withTerminator.success) {
            assert.deepEqual(withTerminator.value, [first, second]);
          }
          assert.ok(!withoutTerminator.success);
        },
      ),
      propertyParameters,
    );
  });

  it("merge should propagate options terminator to argument parsers", () => {
    const parser = merge(
      object({
        verbose: optional(option("--verbose")),
      }),
      object({
        target: argument(string()),
      }),
    );

    fc.assert(
      fc.property(optionLikeTokenArbitrary, (token: string) => {
        const withTerminator = parseSync(parser, ["--", token]);
        const withoutTerminator = parseSync(parser, [token]);

        assert.ok(withTerminator.success);
        if (withTerminator.success) {
          assert.equal(withTerminator.value.verbose, undefined);
          assert.equal(withTerminator.value.target, token);
        }
        assert.ok(!withoutTerminator.success);
      }),
      propertyParameters,
    );
  });

  it("options after -- should stay positional in mixed objects", () => {
    const parser = object({
      source: argument(string()),
      rest: multiple(argument(string()), { min: 0, max: 3 }),
    });

    fc.assert(
      fc.property(
        optionLikeTokenArbitrary,
        fc.array(optionLikeTokenArbitrary, { minLength: 0, maxLength: 3 }),
        (head: string, tail: readonly string[]) => {
          const args = ["--", head, ...tail];
          const result = parseSync(parser, args);

          assert.ok(result.success);
          if (result.success) {
            assert.equal(result.value.source, head);
            assert.deepEqual(result.value.rest, tail);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("option parser should reject duplicate occurrences", () => {
    fc.assert(
      fc.property(
        identifierArbitrary,
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.integer({ min: -1_000_000, max: 1_000_000 }),
        fc.boolean(),
        (
          name: string,
          firstValue: number,
          secondValue: number,
          separatedFirst: boolean,
        ) => {
          const optionName = longOptionName(name);
          const parser = option(optionName, integer());
          const first = separatedFirst
            ? [optionName, `${firstValue}`]
            : [`${optionName}=${firstValue}`];
          const second = separatedFirst
            ? [`${optionName}=${secondValue}`]
            : [optionName, `${secondValue}`];
          const result = parseSync(parser, [...first, ...second]);

          assert.ok(!result.success);
        },
      ),
      propertyParameters,
    );
  });

  it("option joined form should preserve full value suffix", () => {
    const parser = option("--data", string());

    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 24 }),
        (value: string) => {
          const result = parseSync(parser, [`--data=${value}`]);

          assert.ok(result.success);
          if (result.success) {
            assert.equal(result.value, value);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("passThrough equalsOnly should preserve equals-style tokens", () => {
    const parser = passThrough();

    fc.assert(
      fc.property(
        fc.array(equalsOptionTokenArbitrary, { minLength: 1, maxLength: 8 }),
        (tokens: readonly string[]) => {
          const result = parseSync(parser, tokens);

          assert.ok(result.success);
          if (result.success) {
            assert.deepEqual(result.value, tokens);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("passThrough nextToken should capture value only when non-option", () => {
    const parser = passThrough({ format: "nextToken" });

    fc.assert(
      fc.property(
        optionLikeTokenArbitrary,
        nonOptionTokenArbitrary,
        optionLikeTokenArbitrary,
        fc.boolean(),
        (
          optionToken: string,
          valueToken: string,
          nextOptionToken: string,
          hasValue: boolean,
        ) => {
          const secondToken = hasValue ? valueToken : nextOptionToken;
          const context = {
            buffer: [optionToken, secondToken] as readonly string[],
            state: parser.initialState,
            optionsTerminated: false,
            usage: parser.usage,
          };
          const result = parser.parse(context);

          assert.ok(result.success);
          if (result.success) {
            if (hasValue) {
              assert.deepEqual(result.consumed, [optionToken, secondToken]);
              assert.deepEqual(result.next.state, [optionToken, secondToken]);
              assert.deepEqual(result.next.buffer, []);
            } else {
              assert.deepEqual(result.consumed, [optionToken]);
              assert.deepEqual(result.next.state, [optionToken]);
              assert.deepEqual(result.next.buffer, [secondToken]);
            }
          }
        },
      ),
      propertyParameters,
    );
  });

  it("passThrough should honor optionsTerminated by format", () => {
    fc.assert(
      fc.property(
        fc.constantFrom<"equalsOnly" | "nextToken" | "greedy">(
          "equalsOnly",
          "nextToken",
          "greedy",
        ),
        equalsOptionTokenArbitrary,
        (format: "equalsOnly" | "nextToken" | "greedy", token: string) => {
          const parser = passThrough({ format });
          const context = {
            buffer: [token] as readonly string[],
            state: parser.initialState,
            optionsTerminated: true,
            usage: parser.usage,
          };
          const result = parser.parse(context);

          assert.equal(result.success, format === "greedy");
          if (result.success) {
            assert.deepEqual(result.next.state, [token]);
            assert.deepEqual(result.next.buffer, []);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("optional should return undefined only when input is absent", () => {
    const parser = optional(option("--port", integer({ min: 1, max: 65535 })));

    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant<undefined>(undefined),
          fc.integer({ min: 1, max: 65535 }),
        ),
        (port: number | undefined) => {
          const args = port == null ? [] : ["--port", `${port}`];
          const result = parseSync(parser, args);

          assert.ok(result.success);
          if (result.success) {
            assert.equal(result.value, port);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("withDefault should evaluate lazy default only when missing", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 65535 }),
        fc.integer({ min: 1, max: 65535 }),
        fc.boolean(),
        (provided: number, fallback: number, present: boolean) => {
          let calls = 0;
          const parser = withDefault(
            option("--port", integer({ min: 1, max: 65535 })),
            () => {
              calls++;
              return fallback;
            },
          );

          const args = present ? ["--port", `${provided}`] : [];
          const result = parseSync(parser, args);

          assert.ok(result.success);
          if (result.success) {
            assert.equal(result.value, present ? provided : fallback);
          }
          assert.equal(calls, present ? 0 : 1);
        },
      ),
      propertyParameters,
    );
  });

  it("multiple should enforce bounds while preserving order", () => {
    fc.assert(
      fc.property(
        fc.array(argumentTokenArbitrary, { minLength: 0, maxLength: 6 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 4 }),
        (values: readonly string[], min: number, max: number) => {
          fc.pre(min <= max);
          const parser = object({
            values: multiple(argument(string()), { min, max }),
          });
          const result = parseSync(parser, values);

          const shouldSucceed = values.length >= min && values.length <= max;
          assert.equal(result.success, shouldSucceed);
          if (result.success) {
            assert.deepEqual(result.value.values, values);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("multiple option parser should preserve occurrence order", () => {
    const parser = object({
      tags: multiple(option("--tag", string()), { min: 0, max: 6 }),
    });

    fc.assert(
      fc.property(
        fc.array(nonOptionTokenArbitrary, { minLength: 0, maxLength: 6 }),
        (tags: readonly string[]) => {
          const args = tags.flatMap((tag: string) => ["--tag", tag]);
          const result = parseSync(parser, args);

          assert.ok(result.success);
          if (result.success) {
            assert.deepEqual(result.value.tags, tags);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("derived option should honor source value across option order", () => {
    const modeSource = dependency(choice(["dev", "prod"] as const));
    const levelValue = modeSource.derive({
      metavar: "LEVEL",
      factory: (mode) =>
        choice(
          mode === "dev"
            ? (["debug", "trace"] as const)
            : (["warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const parser = object({
      mode: withDefault(
        optional(option("--mode", modeSource)),
        "prod" as const,
      ),
      level: option("--level", levelValue),
    });

    fc.assert(
      fc.property(
        fc.boolean(),
        fc.constantFrom<"dev" | "prod">("dev", "prod"),
        fc.boolean(),
        fc.boolean(),
        (
          includeMode: boolean,
          mode: "dev" | "prod",
          pickFirst: boolean,
          levelFirst: boolean,
        ) => {
          const effectiveMode = includeMode ? mode : "prod";
          const level = effectiveMode === "dev"
            ? (pickFirst ? "debug" : "trace")
            : (pickFirst ? "warn" : "error");

          const modeTokens = includeMode ? ["--mode", mode] : [];
          const levelTokens = ["--level", level] as const;
          const args = levelFirst
            ? [...levelTokens, ...modeTokens]
            : [...modeTokens, ...levelTokens];
          const result = parseSync(parser, args);

          assert.ok(result.success);
          if (result.success) {
            assert.equal(result.value.mode, effectiveMode);
            assert.equal(result.value.level, level);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("derived option should reject values invalid for resolved source", () => {
    const modeSource = dependency(choice(["dev", "prod"] as const));
    const levelValue = modeSource.derive({
      metavar: "LEVEL",
      factory: (mode) =>
        choice(
          mode === "dev"
            ? (["debug", "trace"] as const)
            : (["warn", "error"] as const),
        ),
      defaultValue: () => "dev" as const,
    });
    const parser = object({
      mode: option("--mode", modeSource),
      level: option("--level", levelValue),
    });

    fc.assert(
      fc.property(
        fc.constantFrom<"dev" | "prod">("dev", "prod"),
        fc.boolean(),
        (mode: "dev" | "prod", levelFirst: boolean) => {
          const invalidLevel = mode === "dev" ? "warn" : "debug";
          const modeTokens = ["--mode", mode] as const;
          const levelTokens = ["--level", invalidLevel] as const;
          const args = levelFirst
            ? [...levelTokens, ...modeTokens]
            : [...modeTokens, ...levelTokens];
          const result = parseSync(parser, args);

          assert.ok(!result.success);
        },
      ),
      propertyParameters,
    );
  });

  it("deriveFrom should resolve multi-source dependencies consistently", async () => {
    const modeSource = dependency(choice(["dev", "prod"] as const));
    const targetSource = dependency(choice(["node", "browser"] as const));
    const presetValue = deriveFrom({
      metavar: "PRESET",
      dependencies: [modeSource, targetSource] as const,
      factory: (mode, target) =>
        choice(
          mode === "dev" && target === "node"
            ? (["inspect", "watch"] as const)
            : mode === "dev" && target === "browser"
            ? (["hmr", "source-map"] as const)
            : mode === "prod" && target === "node"
            ? (["cluster", "pm2"] as const)
            : (["minify", "sri"] as const),
        ),
      defaultValues: () => ["dev", "node"] as const,
    });
    const parser = object({
      mode: withDefault(optional(option("--mode", modeSource)), "dev" as const),
      target: withDefault(
        optional(option("--target", targetSource)),
        "node" as const,
      ),
      preset: option("--preset", presetValue),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<"dev" | "prod">("dev", "prod"),
        fc.constantFrom<"node" | "browser">("node", "browser"),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        async (
          mode: "dev" | "prod",
          target: "node" | "browser",
          includeMode: boolean,
          includeTarget: boolean,
          pickFirst: boolean,
        ) => {
          const resolvedMode = includeMode ? mode : "dev";
          const resolvedTarget = includeTarget ? target : "node";
          const choices = resolvedMode === "dev" && resolvedTarget === "node"
            ? (["inspect", "watch"] as const)
            : resolvedMode === "dev" && resolvedTarget === "browser"
            ? (["hmr", "source-map"] as const)
            : resolvedMode === "prod" && resolvedTarget === "node"
            ? (["cluster", "pm2"] as const)
            : (["minify", "sri"] as const);
          const preset = pickFirst ? choices[0] : choices[1];

          const blocks = [
            ...(includeMode ? ([["--mode", mode]] as const) : []),
            ...(includeTarget ? ([["--target", target]] as const) : []),
            ["--preset", preset] as const,
          ];

          for (const permutation of permuteArgBlocks(blocks)) {
            const syncResult = parseSync(parser, permutation);
            const asyncResult = await parseAsync(parser, permutation);

            assert.ok(syncResult.success);
            if (syncResult.success) {
              assert.equal(syncResult.value.mode, resolvedMode);
              assert.equal(syncResult.value.target, resolvedTarget);
              assert.equal(syncResult.value.preset, preset);
            }
            assert.deepEqual(asyncResult, syncResult);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("command suggestions should only suggest parseable completions", () => {
    const parser = or(
      command("build", constant("build")),
      command("test", constant("test")),
      command("lint", constant("lint")),
    );

    fc.assert(
      fc.property(
        fc.constantFrom("", "b", "bu", "t", "te", "l", "li", "x"),
        (prefix: string) => {
          const suggestions = suggestSync(parser, [prefix]);
          const texts = literalSuggestionTexts(suggestions);

          assert.equal(new Set(texts).size, texts.length);
          for (const text of texts) {
            assert.ok(text.startsWith(prefix));
            const result = parseSync(parser, [text]);
            assert.ok(result.success);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("choice value suggestions should be parseable completions", () => {
    const parser = object({
      mode: option("--mode", choice(["dev", "prod"] as const)),
    });

    fc.assert(
      fc.property(
        fc.constantFrom("", "d", "de", "p", "pr", "x"),
        (prefix: string) => {
          const suggestions = suggestSync(parser, ["--mode", prefix]);
          const texts = literalSuggestionTexts(suggestions);

          assert.equal(new Set(texts).size, texts.length);
          for (const text of texts) {
            assert.ok(text.startsWith(prefix));
            const result = parseSync(parser, ["--mode", text]);
            assert.ok(result.success);
            if (result.success) {
              assert.equal(result.value.mode, text);
            }
          }
        },
      ),
      propertyParameters,
    );
  });

  it("root option suggestions should always parse when applied", () => {
    const parser = option("--verbose");

    fc.assert(
      fc.property(
        fc.constantFrom("", "-", "--", "--v", "--ve", "--verb", "--x"),
        (prefix: string) => {
          const suggestions = suggestSync(parser, [prefix]);
          const texts = literalSuggestionTexts(suggestions);

          assert.equal(new Set(texts).size, texts.length);
          for (const text of texts) {
            assert.ok(text.startsWith(prefix));
            const result = parseSync(parser, [text]);
            assert.ok(result.success);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("inserting -- before positional tail should preserve semantics", () => {
    const parser = object({
      verbose: optional(option("--verbose")),
      tail: multiple(argument(string()), { min: 0, max: 4 }),
    });

    fc.assert(
      fc.property(
        fc.boolean(),
        fc.array(nonOptionTokenArbitrary, { minLength: 0, maxLength: 4 }),
        (verbose: boolean, tail: readonly string[]) => {
          const withoutTerminator = parseSync(parser, [
            ...(verbose ? ["--verbose"] : []),
            ...tail,
          ]);
          const withTerminator = parseSync(parser, [
            ...(verbose ? ["--verbose"] : []),
            "--",
            ...tail,
          ]);

          assert.deepEqual(withTerminator, withoutTerminator);
        },
      ),
      propertyParameters,
    );
  });

  it("merge of disjoint objects should match flat object parser", () => {
    const merged = merge(
      object({
        count: optional(option("--count", integer({ min: -1000, max: 1000 }))),
      }),
      object({
        name: optional(option("--name", string())),
      }),
    );
    const flat = object({
      count: optional(option("--count", integer({ min: -1000, max: 1000 }))),
      name: optional(option("--name", string())),
    });

    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant<undefined>(undefined),
          fc.integer({ min: -1000, max: 1000 }),
        ),
        fc.oneof(fc.constant<undefined>(undefined), nonOptionTokenArbitrary),
        (count: number | undefined, name: string | undefined) => {
          const blocks = [
            ...(count == null ? [] : [["--count", `${count}`]]),
            ...(name == null ? [] : [["--name", name]]),
          ];

          for (const args of permuteArgBlocks(blocks)) {
            const mergedResult = parseSync(merged, args);
            const flatResult = parseSync(flat, args);

            assert.deepEqual(mergedResult, flatResult);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("trailing -- should be a no-op without positional parsers", () => {
    const parser = object({
      verbose: optional(option("--verbose")),
      mode: optional(option("--mode", choice(["dev", "prod"] as const))),
    });

    fc.assert(
      fc.property(
        fc.boolean(),
        fc.oneof(
          fc.constant<undefined>(undefined),
          fc.constantFrom("dev", "prod"),
        ),
        (verbose: boolean, mode: "dev" | "prod" | undefined) => {
          const blocks = [
            ...(verbose ? ([["--verbose"]] as const) : []),
            ...(mode == null ? [] : ([["--mode", mode]] as const)),
          ];

          for (const args of permuteArgBlocks(blocks)) {
            const base = parseSync(parser, args);
            const transformed = parseSync(parser, [...args, "--"]);
            assert.deepEqual(transformed, base);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("parse should never throw on adversarial token streams", async () => {
    const parser = object({
      mode: optional(option("--mode", choice(["dev", "prod"] as const))),
      verbose: optional(option("--verbose")),
      target: optional(argument(string())),
      extra: passThrough({ format: "nextToken" }),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(adversarialTokenArbitrary, { minLength: 0, maxLength: 12 }),
        async (args: readonly string[]) => {
          assert.doesNotThrow(() => parseSync(parser, args));
          const syncResult = parseSync(parser, args);
          const asyncResult = await parseAsync(parser, args);

          assert.deepEqual(asyncResult, syncResult);
        },
      ),
      propertyParameters,
    );
  });

  it("suggest should remain well-formed on adversarial prefixes", async () => {
    const parser = object({
      mode: optional(option("--mode", choice(["dev", "prod"] as const))),
      verbose: optional(option("--verbose")),
      passthrough: passThrough(),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(adversarialTokenArbitrary, { minLength: 1, maxLength: 8 }),
        async (args: readonly string[]) => {
          const argv = args as [string, ...readonly string[]];
          assert.doesNotThrow(() => suggestSync(parser, argv));

          const syncSuggestions = suggestSync(parser, argv);
          const asyncSuggestions = await suggestAsync(parser, argv);

          assert.deepEqual(asyncSuggestions, syncSuggestions);
          for (const suggestion of syncSuggestions) {
            if (suggestion.kind === "literal") {
              assert.equal(typeof suggestion.text, "string");
            }
          }
        },
      ),
      propertyParameters,
    );
  });

  it("withDefault over optional should apply default on absence", () => {
    const parser = object({
      count: withDefault(
        optional(option("--count", integer({ min: -1000, max: 1000 }))),
        42,
      ),
    });

    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant<undefined>(undefined),
          fc.integer({ min: -1000, max: 1000 }),
        ),
        (count: number | undefined) => {
          const args = count == null ? [] : ["--count", `${count}`];
          const result = parseSync(parser, args);

          assert.ok(result.success);
          if (result.success) {
            assert.equal(result.value.count, count ?? 42);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("nonEmpty should reject zero-consumption default branch", () => {
    const parser = nonEmpty(
      withDefault(option("--port", integer({ min: 1, max: 65535 })), 3000),
    );

    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant<undefined>(undefined),
          fc.integer({ min: 1, max: 65535 }),
        ),
        (port: number | undefined) => {
          const args = port == null ? [] : ["--port", `${port}`];
          const result = parseSync(parser, args);

          assert.equal(result.success, port != null);
          if (result.success) {
            assert.equal(result.value, port);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("passThrough nextToken should preserve option-only streams", () => {
    const parser = passThrough({ format: "nextToken" });

    fc.assert(
      fc.property(
        fc.array(optionLikeTokenArbitrary, { minLength: 1, maxLength: 8 }),
        (tokens: readonly string[]) => {
          const result = parseSync(parser, tokens);

          assert.ok(result.success);
          if (result.success) {
            assert.deepEqual(result.value, tokens);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("passThrough greedy should consume any non-empty stream", () => {
    const parser = passThrough({ format: "greedy" });

    fc.assert(
      fc.property(
        fc.array(fc.string({ minLength: 0, maxLength: 16 }), {
          minLength: 1,
          maxLength: 8,
        }),
        (tokens: readonly string[]) => {
          const result = parseSync(parser, tokens);

          assert.ok(result.success);
          if (result.success) {
            assert.deepEqual(result.value, tokens);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("optional option should fail on unmatched option input", () => {
    const parser = optional(option("--known", integer()));

    fc.assert(
      fc.property(
        identifierArbitrary.filter((name: string) => name !== "known"),
        (name: string) => {
          const result = parseSync(parser, [`--${name}`]);

          assert.ok(!result.success);
        },
      ),
      propertyParameters,
    );
  });

  it("object should keep known options out of passThrough", async () => {
    const parser = object({
      debug: option("--debug"),
      extra: passThrough(),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.array(unknownEqualsOptionTokenArbitrary, {
          minLength: 0,
          maxLength: 6,
        }),
        fc.boolean(),
        fc.nat(),
        async (
          passthroughTokens: readonly string[],
          includeDebug: boolean,
          insertionSeed: number,
        ) => {
          const insertionIndex = passthroughTokens.length < 1
            ? 0
            : insertionSeed % (passthroughTokens.length + 1);
          const args = includeDebug
            ? [
              ...passthroughTokens.slice(0, insertionIndex),
              "--debug",
              ...passthroughTokens.slice(insertionIndex),
            ]
            : [...passthroughTokens];

          const syncResult = parseSync(parser, args);
          const asyncResult = await parseAsync(parser, args);

          assert.ok(syncResult.success);
          if (syncResult.success) {
            assert.equal(syncResult.value.debug, includeDebug);
            assert.deepEqual(syncResult.value.extra, passthroughTokens);
          }
          assert.deepEqual(asyncResult, syncResult);
        },
      ),
      propertyParameters,
    );
  });

  it("command parser should dispatch only for matching command", () => {
    fc.assert(
      fc.property(
        identifierArbitrary,
        identifierArbitrary,
        argumentTokenArbitrary,
        (expectedName: string, actualName: string, value: string) => {
          const parser = command(expectedName, argument(string()));
          const result = parseSync(parser, [actualName, value]);

          if (expectedName === actualName) {
            assert.ok(result.success);
            if (result.success) {
              assert.equal(result.value, value);
            }
          } else {
            assert.ok(!result.success);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("object parser should be stable under option order", () => {
    fc.assert(
      fc.property(
        identifierArbitrary,
        identifierArbitrary,
        fc.boolean(),
        fc.boolean(),
        (
          leftName: string,
          rightName: string,
          leftPresent: boolean,
          rightPresent: boolean,
        ) => {
          fc.pre(leftName !== rightName);

          const leftOption: `--${string}` = longOptionName(leftName);
          const rightOption: `--${string}` = longOptionName(rightName);
          const parser = object({
            left: option(leftOption),
            right: option(rightOption),
          });

          const args = [
            ...(leftPresent ? [leftOption] : []),
            ...(rightPresent ? [rightOption] : []),
          ];
          const forward = parseSync(parser, args);
          const reversed = parseSync(parser, [...args].reverse());

          assert.ok(forward.success);
          assert.ok(reversed.success);
          if (forward.success && reversed.success) {
            assert.deepEqual(reversed.value, forward.value);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("short option bundles should match separated tokens", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(shortOptionCharacterArbitrary, {
          minLength: 3,
          maxLength: 3,
        }),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (
          names: readonly string[],
          firstPresent: boolean,
          secondPresent: boolean,
          thirdPresent: boolean,
          reverseOrder: boolean,
        ) => {
          const [firstName, secondName, thirdName] = names;
          const firstOption = shortOptionName(firstName);
          const secondOption = shortOptionName(secondName);
          const thirdOption = shortOptionName(thirdName);

          const parser = object({
            first: option(firstOption),
            second: option(secondOption),
            third: option(thirdOption),
          });

          const selected = [
            ...(firstPresent ? [firstName] : []),
            ...(secondPresent ? [secondName] : []),
            ...(thirdPresent ? [thirdName] : []),
          ];
          const ordered = reverseOrder ? [...selected].reverse() : selected;
          const separatedArgs = ordered.map(shortOptionName);
          const bundledArgs = ordered.length < 1
            ? []
            : [`-${ordered.join("")}`];

          const separated = parseSync(parser, separatedArgs);
          const bundled = parseSync(parser, bundledArgs);

          assert.ok(separated.success);
          assert.ok(bundled.success);
          if (separated.success && bundled.success) {
            const expected = {
              first: firstPresent,
              second: secondPresent,
              third: thirdPresent,
            };
            assert.deepEqual(separated.value, expected);
            assert.deepEqual(bundled.value, expected);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("mixed object parser should be stable across token permutations", () => {
    const parser = object({
      target: argument(string()),
      verbose: option("--verbose"),
      dryRun: option("--dry-run"),
    });

    fc.assert(
      fc.property(
        argumentTokenArbitrary,
        fc.boolean(),
        fc.boolean(),
        (target: string, verbose: boolean, dryRun: boolean) => {
          const tokens = [
            target,
            ...(verbose ? ["--verbose"] : []),
            ...(dryRun ? ["--dry-run"] : []),
          ];

          for (const permutation of permuteTokens(tokens)) {
            const result = parseSync(parser, permutation);

            assert.ok(result.success);
            if (result.success) {
              assert.deepEqual(result.value, {
                target,
                verbose,
                dryRun,
              });
            }
          }
        },
      ),
      propertyParameters,
    );
  });

  it("tuple parser should preserve positional argument order", () => {
    const parser = tuple([argument(string()), argument(string())]);

    fc.assert(
      fc.property(
        argumentTokenArbitrary,
        argumentTokenArbitrary,
        (first: string, second: string) => {
          const result = parseSync(parser, [first, second]);

          assert.ok(result.success);
          if (result.success) {
            assert.deepEqual(result.value, [first, second]);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("merge parser should be commutative for disjoint flags", () => {
    fc.assert(
      fc.property(
        identifierArbitrary,
        identifierArbitrary,
        fc.boolean(),
        fc.boolean(),
        (
          leftName: string,
          rightName: string,
          leftPresent: boolean,
          rightPresent: boolean,
        ) => {
          fc.pre(leftName !== rightName);

          const leftOption: `--${string}` = longOptionName(leftName);
          const rightOption: `--${string}` = longOptionName(rightName);

          const leftParser = object({ left: option(leftOption) });
          const rightParser = object({ right: option(rightOption) });
          const mergedLeftRight = merge(leftParser, rightParser);
          const mergedRightLeft = merge(rightParser, leftParser);

          const args = [
            ...(leftPresent ? [leftOption] : []),
            ...(rightPresent ? [rightOption] : []),
          ];
          const leftRightResult = parseSync(mergedLeftRight, args);
          const rightLeftResult = parseSync(mergedRightLeft, args);

          assert.ok(leftRightResult.success);
          assert.ok(rightLeftResult.success);
          if (leftRightResult.success && rightLeftResult.success) {
            assert.deepEqual(rightLeftResult.value, leftRightResult.value);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("or parser should pick branch by command token", () => {
    fc.assert(
      fc.property(
        identifierArbitrary,
        identifierArbitrary,
        argumentTokenArbitrary,
        fc.boolean(),
        (
          leftName: string,
          rightName: string,
          value: string,
          chooseLeft: boolean,
        ) => {
          fc.pre(leftName !== rightName);

          const parser = or(
            command(
              leftName,
              object({
                type: constant(leftName),
                value: argument(string()),
              }),
            ),
            command(
              rightName,
              object({
                type: constant(rightName),
                value: argument(string()),
              }),
            ),
          );

          const commandName = chooseLeft ? leftName : rightName;
          const result = parseSync(parser, [commandName, value]);

          assert.ok(result.success);
          if (result.success) {
            assert.equal(result.value.type, commandName);
            assert.equal(result.value.value, value);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("or parser should switch branches after shared prefix", () => {
    const parser = or(
      object({
        shared: option("--shared"),
        payload: command("left", argument(string())),
      }),
      object({
        shared: option("--shared"),
        payload: command("right", argument(string())),
      }),
    );

    fc.assert(
      fc.property(
        argumentTokenArbitrary,
        fc.boolean(),
        (value: string, chooseLeft: boolean) => {
          const commandName = chooseLeft ? "left" : "right";
          const result = parseSync(parser, ["--shared", commandName, value]);

          assert.ok(result.success);
          if (result.success) {
            assert.equal(result.value.shared, true);
            assert.equal(result.value.payload, value);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("or parser should enforce branch exclusivity", () => {
    const parser = or(
      object({
        shared: option("--shared"),
        left: flag("--left"),
      }),
      object({
        shared: option("--shared"),
        right: flag("--right"),
      }),
    );

    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        (left: boolean, right: boolean, shared: boolean) => {
          const args = [
            ...(shared ? ["--shared"] : []),
            ...(left ? ["--left"] : []),
            ...(right ? ["--right"] : []),
          ];
          const shouldSucceed = left !== right;

          for (const permutation of permuteTokens(args)) {
            const result = parseSync(parser, permutation);

            assert.equal(result.success, shouldSucceed);
            if (result.success) {
              assert.equal(result.value.shared, shared);
              assert.equal("left" in result.value, left);
              assert.equal("right" in result.value, right);
            }
          }
        },
      ),
      propertyParameters,
    );
  });

  it("or parser should deterministically pick first ambiguous branch", () => {
    const leftBranch = object({
      branch: constant("left"),
      value: argument(string()),
    });
    const rightBranch = object({
      branch: constant("right"),
      value: argument(string()),
    });
    const leftFirst = or(leftBranch, rightBranch);
    const rightFirst = or(rightBranch, leftBranch);

    fc.assert(
      fc.property(argumentTokenArbitrary, (token: string) => {
        const leftResult = parseSync(leftFirst, [token]);
        const rightResult = parseSync(rightFirst, [token]);

        assert.ok(leftResult.success);
        assert.ok(rightResult.success);
        if (leftResult.success && rightResult.success) {
          assert.equal(leftResult.value.branch, "left");
          assert.equal(leftResult.value.value, token);
          assert.equal(rightResult.value.branch, "right");
          assert.equal(rightResult.value.value, token);
        }
      }),
      propertyParameters,
    );
  });

  it("or parser should handle shared and branch tokens in any order", () => {
    const parser = or(
      object({
        shared: option("--shared"),
        left: flag("--left"),
        value: argument(string()),
      }),
      object({
        shared: option("--shared"),
        right: flag("--right"),
        value: argument(string()),
      }),
    );

    fc.assert(
      fc.property(
        argumentTokenArbitrary,
        fc.boolean(),
        (value: string, left: boolean) => {
          const args = ["--shared", left ? "--left" : "--right", value];

          for (const permutation of permuteTokens(args)) {
            const result = parseSync(parser, permutation);

            assert.ok(result.success);
            if (result.success) {
              assert.equal(result.value.shared, true);
              assert.equal(result.value.value, value);
              assert.equal("left" in result.value, left);
              assert.equal("right" in result.value, !left);
            }
          }
        },
      ),
      propertyParameters,
    );
  });

  it("longestMatch should prefer parser consuming more tokens", () => {
    const parser = longestMatch(
      tuple([argument(string())]),
      tuple([argument(string()), argument(string())]),
    );

    fc.assert(
      fc.property(
        argumentTokenArbitrary,
        argumentTokenArbitrary,
        (first: string, second: string) => {
          const result = parseSync(parser, [first, second]);

          assert.ok(result.success);
          if (result.success) {
            assert.deepEqual(result.value, [first, second]);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("longestMatch should ignore parser order for unique winners", () => {
    const first = tuple([
      argument(string()),
      argument(string()),
      argument(string()),
    ]);
    const second = tuple([argument(string()), argument(string())]);
    const third = tuple([argument(string())]);

    const parserA = longestMatch(first, second, third);
    const parserB = longestMatch(second, third, first);

    fc.assert(
      fc.property(
        argumentTokenArbitrary,
        argumentTokenArbitrary,
        argumentTokenArbitrary,
        (a: string, b: string, c: string) => {
          const args = [a, b, c];
          const resultA = parseSync(parserA, args);
          const resultB = parseSync(parserB, args);

          assert.ok(resultA.success);
          assert.ok(resultB.success);
          if (resultA.success && resultB.success) {
            assert.deepEqual(resultA.value, args);
            assert.deepEqual(resultB.value, args);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("longestMatch should choose branch by available token count", () => {
    const parser = longestMatch(
      tuple([argument(string())]),
      tuple([argument(string()), argument(string())]),
      tuple([argument(string()), argument(string()), argument(string())]),
    );

    fc.assert(
      fc.property(
        fc.array(argumentTokenArbitrary, { minLength: 1, maxLength: 3 }),
        (args: readonly string[]) => {
          const result = parseSync(parser, args);

          assert.ok(result.success);
          if (result.success) {
            assert.deepEqual(result.value, args);
          }
        },
      ),
      propertyParameters,
    );
  });

  it("longestMatch should prefer the first parser on ties", () => {
    const leftFirst = longestMatch(
      tuple([argument(string())]),
      argument(string()),
    );
    const rightFirst = longestMatch(
      argument(string()),
      tuple([argument(string())]),
    );

    fc.assert(
      fc.property(argumentTokenArbitrary, (token: string) => {
        const leftResult = parseSync(leftFirst, [token]);
        const rightResult = parseSync(rightFirst, [token]);

        assert.ok(leftResult.success);
        assert.ok(rightResult.success);
        if (leftResult.success && rightResult.success) {
          assert.deepEqual(leftResult.value, [token]);
          assert.equal(rightResult.value, token);
        }
      }),
      propertyParameters,
    );
  });
});
