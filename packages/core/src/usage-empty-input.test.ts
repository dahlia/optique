import {
  group,
  longestMatch,
  object,
  or,
  tuple,
} from "@optique/core/constructs";
import {
  map,
  multiple,
  nonEmpty,
  optional,
  withDefault,
} from "@optique/core/modifiers";
import { getDocPage, parse, type Parser } from "@optique/core/parser";
import {
  argument,
  command,
  constant,
  fail,
  flag,
  option,
} from "@optique/core/primitives";
import {
  cloneUsage,
  formatUsage,
  isUsageHidden,
  normalizeUsage,
  type Usage,
  type UsageTerm,
} from "@optique/core/usage";
import { string } from "@optique/core/valueparser";
import { resolveUsageForDisplay } from "@optique/core/internal/usage";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";

type AnyParser = Parser<"sync", unknown, unknown>;

const FILE = () => argument(string({ metavar: "FILE" }));
const DIR = () => argument(string({ metavar: "DIR" }));

/**
 * Whether a usage admits the empty invocation under plain synopsis
 * notation, ignoring `acceptsEmpty` records and hidden terms.
 */
function notationAdmitsEmpty(usage: Usage): boolean {
  return usage.every(termAdmitsEmpty);
}

function termAdmitsEmpty(term: UsageTerm): boolean {
  switch (term.type) {
    case "argument":
    case "option":
    case "command":
      return isUsageHidden(term.hidden);
    case "literal":
      return term.value === "";
    case "optional":
    case "passthrough":
    case "ellipsis":
      return true;
    case "sequence":
      return notationAdmitsEmpty(term.terms);
    case "multiple":
      return term.min < 1 || notationAdmitsEmpty(term.terms);
    case "exclusive": {
      // Display drops alternatives without visible terms.
      const visible = term.terms.filter((branch) => hasVisibleTerm(branch));
      return visible.length < 1 || visible.some(notationAdmitsEmpty);
    }
  }
}

function hasVisibleTerm(usage: Usage): boolean {
  return usage.some((term) => {
    switch (term.type) {
      case "argument":
      case "option":
      case "command":
      case "passthrough":
        return !isUsageHidden(term.hidden);
      case "literal":
        return term.value !== "";
      case "ellipsis":
        return true;
      case "optional":
      case "multiple":
      case "sequence":
        return hasVisibleTerm(term.terms);
      case "exclusive":
        return term.terms.some(hasVisibleTerm);
    }
  });
}

/** Removes `acceptsEmpty` by formatting through the public formatter. */
function render(parser: { readonly usage: Usage }): string {
  return formatUsage("app", parser.usage);
}

describe("usage of empty-input behavior", () => {
  const cases: readonly [string, () => AnyParser, string][] = [
    [
      "ambiguous optional alternatives (issue example 1)",
      () => or(optional(FILE()), optional(DIR())) as AnyParser,
      "app (FILE | DIR)",
    ],
    [
      "alternative that produces an item without tokens (issue example 2)",
      () =>
        or(
          multiple(tuple([optional(fail()), constant("x")]), { min: 1 }),
          FILE(),
        ) as AnyParser,
      "app [FILE]",
    ],
    [
      "constant alternative",
      () => or(constant("a"), FILE()) as AnyParser,
      "app [FILE]",
    ],
    [
      "ambiguous constant alternatives",
      () => or(constant("a"), constant("b"), FILE()) as AnyParser,
      "app (FILE)",
    ],
    [
      "failing alternative",
      () => or(fail(), FILE()) as AnyParser,
      "app (FILE)",
    ],
    [
      "optional option alternative",
      () => or(optional(option("--x", string())), FILE()) as AnyParser,
      "app (--x STRING | FILE)",
    ],
    [
      "Boolean option alternatives",
      () => or(option("-v"), option("-q")) as AnyParser,
      "app (-v | -q)",
    ],
    [
      "hidden optional flag alternative",
      () =>
        or(optional(flag("--secret", { hidden: true })), FILE()) as AnyParser,
      "app (FILE)",
    ],
    [
      "repeated optional argument",
      () => multiple(optional(FILE()), { min: 1 }) as AnyParser,
      "app FILE...",
    ],
    [
      "repeated alternative with a constant",
      () => multiple(or(constant("x"), FILE()), { min: 1 }) as AnyParser,
      "app [FILE]...",
    ],
    [
      "two repeated alternatives with a constant",
      () => multiple(or(constant("x"), FILE()), { min: 2 }) as AnyParser,
      "app FILE FILE...",
    ],
    [
      "longestMatch() with optional alternatives",
      () => longestMatch(optional(FILE()), optional(DIR())) as AnyParser,
      "app ([FILE] | [DIR])",
    ],
    [
      "longestMatch() with constant alternatives",
      () => longestMatch(constant("a"), constant("b"), FILE()) as AnyParser,
      "app [FILE]",
    ],
  ];

  for (const [label, create, expected] of cases) {
    it(`draws ${label} as parsing behaves`, () => {
      const parser = create();
      assert.equal(render(parser), expected);
      assert.equal(
        notationAdmitsEmpty(
          resolveUsageForDisplay(parser.usage, isUsageHidden),
        ),
        parse(parser, []).success,
      );
    });
  }

  it("draws the same synopsis from raw, cloned, normalized, and doc usage", () => {
    const parser = object({
      mode: or(optional(FILE()), optional(DIR())),
      items: multiple(or(constant("x"), argument(string())), { min: 1 }),
      verbose: optional(flag("--verbose", { hidden: true })),
    });
    const expected = render(parser);
    assert.equal(formatUsage("app", cloneUsage(parser.usage)), expected);
    assert.equal(formatUsage("app", normalizeUsage(parser.usage)), expected);
    const page = getDocPage(parser);
    assert.ok(page?.usage != null);
    assert.equal(formatUsage("app", page.usage), expected);
  });

  it("keeps the record through group() visibility changes", () => {
    const parser = group(
      "Group",
      or(optional(FILE()), optional(DIR())),
      { hidden: "doc" },
    );
    assert.equal(render(parser), "app (FILE | DIR)");
  });
});

/** Formats a usage to plain notation, as the formatters see it. */
function stripRecords(term: UsageTerm): UsageTerm {
  switch (term.type) {
    case "optional":
      return { type: "optional", terms: term.terms.map(stripRecords) };
    case "sequence":
      return { type: "sequence", terms: term.terms.map(stripRecords) };
    case "multiple":
      return {
        type: "multiple",
        terms: term.terms.map(stripRecords),
        min: term.min,
      };
    case "exclusive":
      return {
        type: "exclusive",
        terms: term.terms.map((branch) => branch.map(stripRecords)),
      };
    default:
      return term;
  }
}

type Spec =
  | { readonly kind: "constant"; readonly value: unknown }
  | {
    readonly kind:
      | "fail"
      | "argument"
      | "option"
      | "booleanOption"
      | "flag"
      | "hiddenFlag"
      | "command";
  }
  | {
    readonly kind: "optional" | "withDefault" | "map" | "nonEmpty";
    readonly child: Spec;
  }
  | { readonly kind: "multiple"; readonly child: Spec; readonly min: number }
  | {
    readonly kind: "or" | "longestMatch" | "tuple" | "object";
    readonly children: readonly Spec[];
  };

const specArbitrary: fc.Arbitrary<Spec> = fc.letrec<{ spec: Spec }>((
  tie,
) => ({
  spec: fc.oneof(
    { depthSize: "small", withCrossShrink: true },
    fc.constantFrom<Spec>(
      { kind: "constant", value: "x" },
      { kind: "constant", value: null },
      { kind: "fail" },
      { kind: "argument" },
      { kind: "option" },
      { kind: "booleanOption" },
      { kind: "flag" },
      { kind: "hiddenFlag" },
      { kind: "command" },
    ),
    fc.record({
      kind: fc.constantFrom(
        "optional" as const,
        "withDefault" as const,
        "map" as const,
        "nonEmpty" as const,
      ),
      child: tie("spec"),
    }),
    fc.record({
      kind: fc.constant("multiple" as const),
      child: tie("spec"),
      min: fc.integer({ min: 0, max: 2 }),
    }),
    fc.record({
      kind: fc.constantFrom(
        "or" as const,
        "longestMatch" as const,
        "tuple" as const,
        "object" as const,
      ),
      children: fc.array(tie("spec"), { minLength: 1, maxLength: 3 }),
    }),
  ),
})).spec;

function build(spec: Spec, counter: { n: number }): AnyParser {
  const id = () => `${++counter.n}`;
  switch (spec.kind) {
    case "constant":
      return constant(spec.value) as AnyParser;
    case "fail":
      return fail() as AnyParser;
    case "argument":
      return argument(string({ metavar: `A${id()}` })) as AnyParser;
    case "option":
      return option(`--o${id()}`, string()) as AnyParser;
    case "booleanOption":
      return option(`--b${id()}`) as AnyParser;
    case "flag":
      return flag(`--f${id()}`) as AnyParser;
    case "hiddenFlag":
      return flag(`--h${id()}`, { hidden: true }) as AnyParser;
    case "command":
      return command(`c${id()}`, constant(1)) as AnyParser;
    case "optional":
      return optional(build(spec.child, counter)) as AnyParser;
    case "withDefault":
      return withDefault(build(spec.child, counter), "d") as AnyParser;
    case "map":
      return map(build(spec.child, counter), (v) => v) as AnyParser;
    case "nonEmpty":
      return nonEmpty(build(spec.child, counter)) as AnyParser;
    case "multiple":
      return multiple(build(spec.child, counter), {
        min: spec.min,
      }) as AnyParser;
    case "or": {
      const [first, ...rest] = spec.children.map((c) => build(c, counter));
      return or(first, ...rest) as AnyParser;
    }
    case "longestMatch": {
      const [first, ...rest] = spec.children.map((c) => build(c, counter));
      return longestMatch(first, ...rest) as AnyParser;
    }
    case "tuple":
      return tuple(spec.children.map((c) => build(c, counter))) as AnyParser;
    case "object":
      return object(
        Object.fromEntries(
          spec.children.map((c, i) => [`k${i}`, build(c, counter)]),
        ),
      ) as AnyParser;
  }
}

/** Whether hiding terms removed a term that cannot be omitted. */
function hidesRequired(usage: Usage): boolean {
  return usage.some((term) => {
    switch (term.type) {
      case "argument":
      case "option":
      case "command":
        return isUsageHidden(term.hidden);
      case "sequence":
        return hidesRequired(term.terms);
      case "multiple":
        return term.min > 0 && hidesRequired(term.terms);
      case "exclusive":
        return term.terms.some(hidesRequired);
      default:
        return false;
    }
  });
}

/**
 * Whether a resolved group that rejects empty input still reads omissible
 * because plain notation cannot draw it as required: an omissible
 * alternative or repeated item that is not a single optional term over
 * required terms, content next to or inside which a required term is
 * hidden, or a repetition without a minimum.
 */
function isUnrepresentable(term: UsageTerm): boolean {
  const isSingleOptional = (terms: Usage) => {
    const visible = terms.filter((t) => hasVisibleTerm([t]));
    return !hidesRequired(terms) && visible.length === 1 &&
      visible[0].type === "optional" &&
      !hidesRequired(visible[0].terms) &&
      !notationAdmitsEmpty(visible[0].terms);
  };
  if (term.type === "multiple") {
    return term.min < 1 || !isSingleOptional(term.terms);
  }
  if (term.type === "exclusive") {
    return term.terms.some((branch) =>
      hasVisibleTerm(branch) && notationAdmitsEmpty(branch) &&
      !isSingleOptional(branch)
    );
  }
  return false;
}

describe("usage of empty-input behavior (property)", () => {
  it("draws every recorded group as its parser behaves", () => {
    let agreed = 0;
    fc.assert(
      fc.property(
        fc.record({
          kind: fc.constantFrom(
            "or" as const,
            "longestMatch" as const,
            "multiple" as const,
          ),
          children: fc.array(specArbitrary, { minLength: 1, maxLength: 3 }),
          min: fc.integer({ min: 0, max: 2 }),
        }),
        ({ kind, children, min }) => {
          const spec: Spec = kind === "multiple"
            ? { kind, child: children[0], min }
            : { kind, children };
          let parser: AnyParser;
          try {
            parser = build(spec, { n: 0 });
          } catch {
            fc.pre(false);
            return;
          }
          const [term] = parser.usage;
          assert.ok(term.type === "exclusive" || term.type === "multiple");
          if (term.acceptsEmpty == null) return;
          const accepted = parse(parser, []).success;
          assert.equal(term.acceptsEmpty, accepted);
          if (!hasVisibleTerm([term])) return;
          const resolved = resolveUsageForDisplay([term], isUsageHidden);
          const rendered = formatUsage("app", [term]);
          // The formatter draws exactly the resolved notation.
          assert.equal(formatUsage("app", resolved), rendered);
          const plain = notationAdmitsEmpty(resolved);
          if (plain !== accepted) {
            assert.ok(
              !accepted && isUnrepresentable(resolved[0]),
              `${JSON.stringify(spec)} renders ${rendered}`,
            );
          } else {
            agreed++;
          }
        },
      ),
      { numRuns: 1000 },
    );
    assert.ok(agreed > 100, `only ${agreed} groups were checked`);
  });
});

describe("usage of empty-input behavior with expandCommands", () => {
  it("expands a command group that has a fallback alternative", () => {
    const parser = or(
      command("serve", object({ port: option("--port", string()) })),
      command("build", constant(2)),
      constant(0),
    );
    assert.ok(parse(parser, []).success);
    assert.equal(render(parser), "app [(serve --port STRING | build)]");
    assert.equal(
      formatUsage("app", parser.usage, { expandCommands: true }),
      "app serve --port STRING\napp build",
    );
  });

  it("draws each expanded line as parsing behaves", () => {
    const parser = or(
      command("add", or(optional(FILE()), optional(DIR()))),
      command("remove", FILE()),
    );
    assert.equal(
      formatUsage("app", parser.usage, { expandCommands: true }),
      // Expansion also splits the arguments of "add" into lines, which
      // are required because "add" alone fails.
      "app add FILE\napp add DIR\napp remove FILE",
    );
  });

  it("expands a single command that has a fallback alternative", () => {
    const parser = or(
      command("serve", object({ port: option("--port", string()) })),
      constant(0),
    );
    assert.equal(render(parser), "app [serve --port STRING]");
    assert.equal(
      formatUsage("app", parser.usage, { expandCommands: true }),
      "app serve --port STRING",
    );
  });

  it("expands a nested command group that has a fallback alternative", () => {
    const parser = object({
      cmd: or(
        command(
          "serve",
          object({
            mode: or(
              command("fast", constant(1)),
              command("slow", constant(2)),
              constant(0),
            ),
          }),
        ),
        command("build", constant(2)),
      ),
    });
    assert.equal(
      formatUsage("app", parser.usage, { expandCommands: true }),
      "app serve fast\napp serve slow\napp build",
    );
  });

  it("does not expand an explicitly optional command group", () => {
    const parser = optional(
      or(command("serve", constant(1)), command("build", constant(2))),
    );
    assert.equal(
      formatUsage("app", parser.usage, { expandCommands: true }),
      "app [(serve | build)]",
    );
  });
});
