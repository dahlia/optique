import {
  longestMatch,
  merge,
  object,
  or,
  tuple,
} from "@optique/core/constructs";
import { parseAsync, parseSync } from "@optique/core/parser";
import {
  argument,
  command,
  constant,
  flag,
  option,
  passThrough,
} from "@optique/core/primitives";
import { multiple, optional, withDefault } from "@optique/core/modifiers";
import { choice, integer, string } from "@optique/core/valueparser";
import assert from "node:assert/strict";
import * as fc from "fast-check";
import { describe, it } from "node:test";

const propertyParameters = { numRuns: 200 } as const;

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

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
