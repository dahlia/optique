import {
  type Annotations,
  getAnnotations,
  injectAnnotations,
} from "./internal/annotations.ts";
import { message } from "./message.ts";
import {
  defineInheritedAnnotationParser,
  type Parser,
} from "./internal/parser.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  getDelegatedAnnotationState,
  getWrappedChildParseState,
  getWrappedChildState,
  hasDelegatedAnnotationCarrier,
  normalizeDelegatedAnnotationState,
  normalizeInjectedAnnotationState,
  normalizeNestedDelegatedAnnotationState,
} from "./annotation-state.ts";

function createInheritedTestParser(): Parser<"sync", unknown, unknown> {
  const parser: Parser<"sync", unknown, unknown> = {
    mode: "sync",
    $valueType: [] as readonly unknown[],
    $stateType: [] as readonly unknown[],
    priority: 1,
    usage: [],
    leadingNames: new Set(),
    acceptingAnyToken: false,
    initialState: undefined,
    parse(context) {
      return {
        success: false as const,
        consumed: 0,
        error: message`unused parse: ${String(context.state)}`,
      };
    },
    complete() {
      return { success: true as const, value: undefined };
    },
    suggest() {
      return [];
    },
    getDocFragments() {
      return { fragments: [] };
    },
  };
  defineInheritedAnnotationParser(parser);
  return parser;
}

describe("annotation-state", () => {
  it(
    "getWrappedChildParseState() preserves nullish sentinels when inheriting annotations",
    () => {
      const marker = Symbol.for(
        "@test/getWrappedChildParseState-nullish-sentinel",
      );
      const annotations = { [marker]: true } satisfies Annotations;
      const parentState = injectAnnotations(undefined, annotations);
      const parser = createInheritedTestParser();

      for (const childState of [undefined, null] as const) {
        const wrapped = getWrappedChildParseState(
          parentState,
          childState,
          parser,
        );

        assert.equal(
          normalizeInjectedAnnotationState(wrapped),
          childState,
          "the wrapped state should normalize back to the original sentinel",
        );
        assert.ok(getAnnotations(wrapped)?.[marker]);
      }
    },
  );

  it(
    "getWrappedChildState() preserves nullish sentinels when inheriting annotations",
    () => {
      const marker = Symbol.for(
        "@test/getWrappedChildState-nullish-sentinel",
      );
      const annotations = { [marker]: true } satisfies Annotations;
      const parentState = injectAnnotations(undefined, annotations);
      const parser = createInheritedTestParser();

      for (const childState of [undefined, null] as const) {
        const wrapped = getWrappedChildState(
          parentState,
          childState,
          parser,
        );

        assert.equal(
          normalizeInjectedAnnotationState(wrapped),
          childState,
          "the wrapped state should normalize back to the original sentinel",
        );
        assert.ok(getAnnotations(wrapped)?.[marker]);
      }
    },
  );

  it("getDelegatedAnnotationState() preserves primitive sentinels", () => {
    const marker = Symbol.for("@test/getDelegatedAnnotationState-primitive");
    const annotations = { [marker]: true } satisfies Annotations;
    const parentState = injectAnnotations(undefined, annotations);
    const delegated = getDelegatedAnnotationState(parentState, "seed");

    assert.ok(hasDelegatedAnnotationCarrier(delegated));
    assert.ok(getAnnotations(delegated)?.[marker]);
    assert.equal(normalizeDelegatedAnnotationState(delegated), "seed");
  });

  it(
    "getDelegatedAnnotationState() creates a fresh wrapper from wrapped primitives",
    () => {
      const parentMarker = Symbol.for(
        "@test/getDelegatedAnnotationState-parent-primitive",
      );
      const childMarker = Symbol.for(
        "@test/getDelegatedAnnotationState-child-primitive",
      );
      const childState = injectAnnotations("seed", {
        [childMarker]: true,
      });
      const parentState = injectAnnotations(undefined, {
        [parentMarker]: true,
      });

      const delegated = getDelegatedAnnotationState(parentState, childState);

      assert.notStrictEqual(delegated, childState);
      assert.ok(getAnnotations(childState)?.[childMarker]);
      assert.ok(getAnnotations(delegated)?.[parentMarker]);
      assert.equal(normalizeDelegatedAnnotationState(delegated), "seed");
    },
  );

  it(
    "getDelegatedAnnotationState() rewraps injected primitives even with identical annotations",
    () => {
      const marker = Symbol.for(
        "@test/getDelegatedAnnotationState-shared-primitive",
      );
      const annotations = { [marker]: true } satisfies Annotations;
      const parentState = injectAnnotations(undefined, annotations);
      const childState = injectAnnotations("seed", annotations);

      const delegated = getDelegatedAnnotationState(parentState, childState);

      assert.notStrictEqual(delegated, childState);
      assert.ok(getAnnotations(delegated)?.[marker]);
      assert.equal(normalizeDelegatedAnnotationState(delegated), "seed");
    },
  );

  it(
    "getDelegatedAnnotationState() preserves class instances via annotation views",
    () => {
      class StatefulObject {
        #secret = "private-value";

        read(): string {
          return this.#secret;
        }
      }

      const marker = Symbol.for("@test/getDelegatedAnnotationState-class");
      const annotations = { [marker]: true } satisfies Annotations;
      const parentState = injectAnnotations(undefined, annotations);
      const state = new StatefulObject();
      const delegated = getDelegatedAnnotationState(parentState, state);

      assert.ok(hasDelegatedAnnotationCarrier(delegated));
      assert.ok(getAnnotations(delegated)?.[marker]);
      assert.equal(delegated.read(), "private-value");
      assert.equal(getAnnotations(state), undefined);
      assert.equal(normalizeDelegatedAnnotationState(delegated), state);
    },
  );

  it(
    "getDelegatedAnnotationState() preserves built-in subclasses via annotation views",
    () => {
      class StatefulMap extends Map<string, string> {
        #secret = "private-value";

        read(): string {
          return this.#secret;
        }
      }

      const marker = Symbol.for(
        "@test/getDelegatedAnnotationState-map-subclass",
      );
      const annotations = { [marker]: true } satisfies Annotations;
      const parentState = injectAnnotations(undefined, annotations);
      const state = new StatefulMap([["key", "value"]]);
      const delegated = getDelegatedAnnotationState(parentState, state);

      assert.ok(hasDelegatedAnnotationCarrier(delegated));
      assert.ok(getAnnotations(delegated)?.[marker]);
      assert.equal(delegated.get("key"), "value");
      assert.equal(delegated.read(), "private-value");
      assert.equal(getAnnotations(state), undefined);
      assert.equal(normalizeDelegatedAnnotationState(delegated), state);
    },
  );

  it(
    "getDelegatedAnnotationState() preserves Array subclasses via annotation views",
    () => {
      class StatefulArray<T> extends Array<T> {
        #secret = "private-value";

        read(): string {
          return this.#secret;
        }
      }

      const marker = Symbol.for(
        "@test/getDelegatedAnnotationState-array-subclass",
      );
      const annotations = { [marker]: true } satisfies Annotations;
      const parentState = injectAnnotations(undefined, annotations);
      const state = new StatefulArray<string>("value");
      const delegated = getDelegatedAnnotationState(parentState, state);

      assert.ok(hasDelegatedAnnotationCarrier(delegated));
      assert.ok(getAnnotations(delegated)?.[marker]);
      assert.ok(delegated instanceof StatefulArray);
      assert.equal(delegated[0], "value");
      assert.equal(delegated.read(), "private-value");
      assert.equal(getAnnotations(state), undefined);
      assert.equal(normalizeDelegatedAnnotationState(delegated), state);
    },
  );

  it(
    "getDelegatedAnnotationState() tracks delegated plain-object clones",
    () => {
      const marker = Symbol.for(
        "@test/getDelegatedAnnotationState-plain-object",
      );
      const annotations = { [marker]: true } satisfies Annotations;
      const parentState = injectAnnotations(undefined, annotations);
      const state = { value: "seed" };

      const delegated = getDelegatedAnnotationState(parentState, state);

      assert.notStrictEqual(delegated, state);
      assert.ok(hasDelegatedAnnotationCarrier(delegated));
      assert.ok(getAnnotations(delegated)?.[marker]);
      assert.equal(delegated.value, "seed");
      assert.equal(getAnnotations(state), undefined);
      assert.equal(normalizeDelegatedAnnotationState(delegated), state);
    },
  );

  it(
    "normalizeNestedDelegatedAnnotationState() unwraps nested carriers in arrays and plain objects",
    () => {
      class StatefulObject {
        #secret = "private-value";

        read(): string {
          return this.#secret;
        }
      }

      const marker = Symbol.for(
        "@test/normalizeNestedDelegatedAnnotationState",
      );
      const parentState = injectAnnotations(undefined, {
        [marker]: true,
      });
      const state = new StatefulObject();
      const nested = {
        primitive: getDelegatedAnnotationState(parentState, "seed"),
        object: {
          inner: getDelegatedAnnotationState(parentState, state),
        },
        array: [
          getDelegatedAnnotationState(parentState, "seed-array"),
          { inner: getDelegatedAnnotationState(parentState, state) },
        ],
      };

      const normalized = normalizeNestedDelegatedAnnotationState(nested);

      assert.notStrictEqual(normalized, nested);
      assert.deepEqual(normalized, {
        primitive: "seed",
        object: { inner: state },
        array: ["seed-array", { inner: state }],
      });
      assert.strictEqual(normalized.object.inner, state);
      const arrayEntry = normalized.array[1];
      assert.ok(
        arrayEntry != null &&
          typeof arrayEntry === "object" &&
          "inner" in arrayEntry,
      );
      assert.strictEqual(arrayEntry.inner, state);
    },
  );

  it(
    "normalizeNestedDelegatedAnnotationState() preserves top-level array annotations",
    () => {
      const arrayMarker = Symbol.for(
        "@test/normalizeNestedDelegatedAnnotationState-array",
      );
      const delegatedParent = injectAnnotations(undefined, {
        [Symbol.for("@test/normalizeNestedDelegatedAnnotationState-delegated")]:
          true,
      });
      const annotatedArray = injectAnnotations([
        getDelegatedAnnotationState(delegatedParent, "seed"),
      ], {
        [arrayMarker]: true,
      });

      const normalized = normalizeNestedDelegatedAnnotationState(
        annotatedArray,
      );

      assert.notStrictEqual(normalized, annotatedArray);
      assert.equal(normalized.length, 1);
      assert.equal(normalized[0], "seed");
      assert.ok(getAnnotations(normalized)?.[arrayMarker]);
    },
  );

  it(
    "normalizeNestedDelegatedAnnotationState() preserves Array subclasses while unwrapping entries",
    () => {
      class StatefulArray<T> extends Array<T> {
        #secret = "private-value";

        read(): string {
          return this.#secret;
        }
      }

      const delegatedParent = injectAnnotations(undefined, {
        [
          Symbol.for(
            "@test/normalizeNestedDelegatedAnnotationState-array-subclass-parent",
          )
        ]: true,
      });
      const state = new StatefulArray<unknown>();
      state.push(
        getDelegatedAnnotationState(delegatedParent, "seed"),
        { inner: getDelegatedAnnotationState(delegatedParent, "value") },
      );

      const normalized = normalizeNestedDelegatedAnnotationState(state);

      assert.notStrictEqual(normalized, state);
      assert.ok(normalized instanceof StatefulArray);
      assert.equal(normalized.read(), "private-value");
      assert.deepEqual([...normalized], [
        "seed",
        { inner: "value" },
      ]);
    },
  );

  it(
    "normalizeNestedDelegatedAnnotationState() preserves array metadata and normalizes nested custom properties",
    () => {
      const arrayMarker = Symbol.for(
        "@test/normalizeNestedDelegatedAnnotationState-array-metadata",
      );
      const extraKey = "extra";
      const symbolKey = Symbol.for(
        "@test/normalizeNestedDelegatedAnnotationState-array-symbol",
      );
      const delegatedParent = injectAnnotations(undefined, {
        [
          Symbol.for(
            "@test/normalizeNestedDelegatedAnnotationState-array-metadata-parent",
          )
        ]: true,
      });
      const array = injectAnnotations([
        getDelegatedAnnotationState(delegatedParent, "seed"),
      ], {
        [arrayMarker]: true,
      });
      Object.defineProperty(array, extraKey, {
        value: {
          inner: getDelegatedAnnotationState(delegatedParent, "extra"),
        },
        enumerable: false,
        writable: false,
        configurable: true,
      });
      Object.defineProperty(array, symbolKey, {
        value: {
          inner: getDelegatedAnnotationState(delegatedParent, "symbol"),
        },
        enumerable: false,
        writable: true,
        configurable: false,
      });

      const normalized = normalizeNestedDelegatedAnnotationState(array);

      assert.notStrictEqual(normalized, array);
      assert.equal(normalized[0], "seed");
      assert.ok(getAnnotations(normalized)?.[arrayMarker]);
      assert.deepEqual(Reflect.get(normalized, extraKey), {
        inner: "extra",
      });
      assert.deepEqual(
        Object.getOwnPropertyDescriptor(normalized, extraKey),
        {
          value: { inner: "extra" },
          enumerable: false,
          writable: false,
          configurable: true,
        },
      );
      assert.deepEqual(Reflect.get(normalized, symbolKey), {
        inner: "symbol",
      });
      assert.deepEqual(
        Object.getOwnPropertyDescriptor(normalized, symbolKey),
        {
          value: { inner: "symbol" },
          enumerable: false,
          writable: true,
          configurable: false,
        },
      );
    },
  );

  it(
    "normalizeNestedDelegatedAnnotationState() unwraps nested carriers in Map entries",
    () => {
      class StatefulObject {
        #secret = "private-value";

        read(): string {
          return this.#secret;
        }
      }

      const mapMarker = Symbol.for(
        "@test/normalizeNestedDelegatedAnnotationState-map",
      );
      const delegatedParent = injectAnnotations(undefined, {
        [
          Symbol.for(
            "@test/normalizeNestedDelegatedAnnotationState-map-parent",
          )
        ]: true,
      });
      const state = new StatefulObject();
      const map = injectAnnotations(
        new Map<
          string,
          string | { inner: StatefulObject }
        >([
          ["plain", getDelegatedAnnotationState(delegatedParent, "value")],
          [
            getDelegatedAnnotationState(delegatedParent, "wrapped-key"),
            { inner: getDelegatedAnnotationState(delegatedParent, state) },
          ],
        ]),
        {
          [mapMarker]: true,
        },
      );

      const normalized = normalizeNestedDelegatedAnnotationState(map);

      assert.notStrictEqual(normalized, map);
      assert.ok(getAnnotations(normalized)?.[mapMarker]);
      assert.equal(normalized.get("plain"), "value");
      const wrappedEntry = normalized.get("wrapped-key");
      assert.deepEqual(wrappedEntry, { inner: state });
      if (
        wrappedEntry == null ||
        typeof wrappedEntry !== "object" ||
        !("inner" in wrappedEntry)
      ) {
        assert.fail(
          "Expected normalized map entry to preserve the class state.",
        );
      }
      assert.strictEqual(wrappedEntry.inner, state);
    },
  );

  it(
    "normalizeNestedDelegatedAnnotationState() preserves Map subclasses while unwrapping entries",
    () => {
      class StatefulMap extends Map<string, unknown> {
        #secret = "private-value";

        read(): string {
          return this.#secret;
        }
      }

      const delegatedParent = injectAnnotations(undefined, {
        [
          Symbol.for(
            "@test/normalizeNestedDelegatedAnnotationState-map-subclass-parent",
          )
        ]: true,
      });
      const state = new StatefulMap([
        ["plain", getDelegatedAnnotationState(delegatedParent, "value")],
        ["self", getDelegatedAnnotationState(delegatedParent, "seed")],
      ]);

      const normalized = normalizeNestedDelegatedAnnotationState(state);

      assert.notStrictEqual(normalized, state);
      assert.ok(normalized instanceof StatefulMap);
      assert.equal(normalized.read(), "private-value");
      assert.equal(normalized.get("plain"), "value");
      assert.equal(normalized.get("self"), "seed");
    },
  );

  it(
    "normalizeNestedDelegatedAnnotationState() skips Map subclass clone construction when nothing changes",
    () => {
      class RequiredArgMap extends Map<string, string> {
        readonly label: string;

        constructor(
          label: string,
          entries?: Iterable<readonly [string, string]>,
        ) {
          if (label.length === 0) {
            throw new TypeError("label must not be empty.");
          }
          super(entries);
          this.label = label;
        }
      }

      const state = new RequiredArgMap("required", [["key", "value"]]);

      const normalized = normalizeNestedDelegatedAnnotationState(state);

      assert.strictEqual(normalized, state);
      assert.equal(normalized.label, "required");
      assert.equal(normalized.get("key"), "value");
    },
  );

  it(
    "normalizeNestedDelegatedAnnotationState() falls back when Map subclass clone construction requires args",
    () => {
      class RequiredArgMap extends Map<string, unknown> {
        readonly label: string;

        constructor(
          label: string,
          entries?: Iterable<readonly [string, unknown]>,
        ) {
          if (label.length === 0) {
            throw new TypeError("label must not be empty.");
          }
          super(entries);
          this.label = label;
        }
      }

      const delegatedParent = injectAnnotations(undefined, {
        [
          Symbol.for(
            "@test/normalizeNestedDelegatedAnnotationState-map-required-arg-parent",
          )
        ]: true,
      });
      const state = new RequiredArgMap("required", [[
        "key",
        getDelegatedAnnotationState(delegatedParent, "value"),
      ]]);

      const normalized: unknown = normalizeNestedDelegatedAnnotationState(
        state,
      );

      assert.notStrictEqual(normalized, state);
      assert.ok(normalized instanceof Map);
      assert.ok(!(normalized instanceof RequiredArgMap));
      assert.equal(Reflect.get(normalized, "label"), "required");
      assert.equal(normalized.get("key"), "value");
    },
  );

  it(
    "normalizeNestedDelegatedAnnotationState() unwraps nested carriers in Set entries",
    () => {
      class StatefulObject {
        #secret = "private-value";

        read(): string {
          return this.#secret;
        }
      }

      const setMarker = Symbol.for(
        "@test/normalizeNestedDelegatedAnnotationState-set",
      );
      const delegatedParent = injectAnnotations(undefined, {
        [
          Symbol.for(
            "@test/normalizeNestedDelegatedAnnotationState-set-parent",
          )
        ]: true,
      });
      const state = new StatefulObject();
      const set = injectAnnotations(
        new Set([
          getDelegatedAnnotationState(delegatedParent, "seed"),
          getDelegatedAnnotationState(delegatedParent, state),
        ]),
        {
          [setMarker]: true,
        },
      );

      const normalized = normalizeNestedDelegatedAnnotationState(set);

      assert.notStrictEqual(normalized, set);
      assert.ok(getAnnotations(normalized)?.[setMarker]);
      assert.ok(normalized.has("seed"));
      const objectEntry = [...normalized].find((value) => value === state);
      assert.strictEqual(objectEntry, state);
    },
  );

  it(
    "normalizeNestedDelegatedAnnotationState() preserves Set subclasses while unwrapping entries",
    () => {
      class StatefulSet extends Set<unknown> {
        #secret = "private-value";

        read(): string {
          return this.#secret;
        }
      }

      const delegatedParent = injectAnnotations(undefined, {
        [
          Symbol.for(
            "@test/normalizeNestedDelegatedAnnotationState-set-subclass-parent",
          )
        ]: true,
      });
      const state = new StatefulSet([
        getDelegatedAnnotationState(delegatedParent, "seed"),
        getDelegatedAnnotationState(delegatedParent, "value"),
      ]);

      const normalized = normalizeNestedDelegatedAnnotationState(state);

      assert.notStrictEqual(normalized, state);
      assert.ok(normalized instanceof StatefulSet);
      assert.equal(normalized.read(), "private-value");
      assert.ok(normalized.has("seed"));
      assert.ok(normalized.has("value"));
    },
  );

  it(
    "normalizeNestedDelegatedAnnotationState() skips Set subclass clone construction when nothing changes",
    () => {
      class RequiredArgSet extends Set<string> {
        readonly label: string;

        constructor(label: string, values?: Iterable<string>) {
          if (label.length === 0) {
            throw new TypeError("label must not be empty.");
          }
          super(values);
          this.label = label;
        }
      }

      const state = new RequiredArgSet("required", ["value"]);

      const normalized = normalizeNestedDelegatedAnnotationState(state);

      assert.strictEqual(normalized, state);
      assert.equal(normalized.label, "required");
      assert.ok(normalized.has("value"));
    },
  );

  it(
    "normalizeNestedDelegatedAnnotationState() clones cyclic back-references when an ancestor changes",
    () => {
      const parentState = injectAnnotations(undefined, {
        [
          Symbol.for(
            "@test/normalizeNestedDelegatedAnnotationState-cyclic-parent",
          )
        ]: true,
      });
      const cyclic: {
        child?: { parent: unknown };
        value?: unknown;
      } = {};
      const child = { parent: cyclic };
      cyclic.child = child;
      cyclic.value = getDelegatedAnnotationState(parentState, "seed");

      const normalized = normalizeNestedDelegatedAnnotationState(cyclic);

      assert.notStrictEqual(normalized, cyclic);
      if (
        normalized.child == null ||
        typeof normalized.child !== "object" ||
        !("parent" in normalized.child)
      ) {
        assert.fail(
          "Expected normalized child to preserve the cyclic parent link.",
        );
      }
      assert.notStrictEqual(normalized.child, child);
      assert.strictEqual(normalized.child.parent, normalized);
      assert.equal(normalized.value, "seed");
    },
  );

  it(
    "normalizeNestedDelegatedAnnotationState() preserves identity for cyclic values without carriers",
    () => {
      const cyclic: { self?: unknown } = {};
      cyclic.self = cyclic;

      const normalized = normalizeNestedDelegatedAnnotationState(cyclic);

      assert.strictEqual(normalized, cyclic);
      assert.strictEqual(normalized.self, cyclic);
    },
  );
});
