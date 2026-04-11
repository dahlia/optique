import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fc from "fast-check";
import {
  annotationKey,
  annotationStateValueKey,
  annotationWrapperKey,
  getAnnotations,
  inheritAnnotations,
  injectAnnotations,
  injectFreshRunAnnotations,
  isInjectedAnnotationWrapper,
  unwrapInjectedAnnotationWrapper,
} from "./annotations.ts";

describe("getAnnotations", () => {
  it("should not expose internal wrapper key set", async () => {
    const annotationsModule = await import("./annotations.ts");

    assert.ok(!Object.hasOwn(annotationsModule, "annotationWrapperKeys"));
  });

  it("should return undefined for non-object states", () => {
    assert.equal(getAnnotations(undefined), undefined);
    assert.equal(getAnnotations(null), undefined);
    assert.equal(getAnnotations("state"), undefined);
    assert.equal(getAnnotations(123), undefined);
    assert.equal(getAnnotations(true), undefined);
  });

  describe("property-based tests", () => {
    const propertyParameters = { numRuns: 200 } as const;

    it("should never throw for arbitrary unknown input", () => {
      fc.assert(
        fc.property(fc.anything(), (state: unknown) => {
          assert.doesNotThrow(() => getAnnotations(state));
        }),
        propertyParameters,
      );
    });

    it("should return undefined when annotationKey is absent", () => {
      fc.assert(
        fc.property(
          fc.dictionary(fc.string(), fc.anything()),
          (state: Record<string, unknown>) => {
            assert.equal(getAnnotations(state), undefined);
          },
        ),
        propertyParameters,
      );
    });

    it("should return annotation object iff annotationKey holds an object", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(undefined),
            fc.constant(null),
            fc.boolean(),
            fc.integer(),
            fc.string(),
            fc.array(fc.anything()),
            fc.object(),
          ),
          (annotationValue: unknown) => {
            const state: Record<PropertyKey, unknown> = {
              [annotationKey]: annotationValue,
            };

            const result = getAnnotations(state);
            if (
              annotationValue != null && typeof annotationValue === "object"
            ) {
              assert.ok(result !== undefined);
              assert.equal(typeof result, "object");
            } else {
              assert.equal(result, undefined);
            }
          },
        ),
        propertyParameters,
      );
    });
  });

  describe("protected views (issue #491)", () => {
    it("should return a stable protected view instead of the caller object", () => {
      const marker = Symbol.for("@test/issue-491/stable-view");
      const rawAnnotations = { [marker]: { value: 1 } };
      const state = injectAnnotations(undefined, rawAnnotations);

      const first = getAnnotations(state);
      const second = getAnnotations(state);

      assert.ok(first !== undefined);
      assert.ok(second !== undefined);
      assert.equal(first, second);
      assert.notEqual(first, rawAnnotations);
      assert.equal(first[marker], second[marker]);
      assert.notEqual(first[marker], rawAnnotations[marker]);
    });

    it("should throw when mutating nested plain objects", () => {
      const marker = Symbol.for("@test/issue-491/nested-object");
      const rawValue = { value: 1 };
      const state = injectAnnotations(undefined, { [marker]: rawValue });

      const annotations = getAnnotations(state);
      assert.ok(annotations !== undefined);
      const nested = annotations[marker] as Record<PropertyKey, unknown>;

      assert.throws(
        () => Reflect.set(nested, "value", 2),
        { name: "TypeError" },
      );
      assert.equal(rawValue.value, 1);
    });

    it("should throw when mutating Map annotations", () => {
      const marker = Symbol.for("@test/issue-491/map");
      const rawEntry = { value: 1 };
      const rawMap = new Map<string, { value: number }>([["a", rawEntry]]);
      const state = injectAnnotations(undefined, { [marker]: rawMap });

      const annotations = getAnnotations(state);
      assert.ok(annotations !== undefined);
      const received = annotations[marker] as Map<string, { value: number }>;

      assert.throws(
        () => received.set("b", { value: 2 }),
        { name: "TypeError" },
      );
      assert.throws(
        () => Reflect.set(received.get("a") as object, "value", 2),
        { name: "TypeError" },
      );
      assert.equal(rawMap.size, 1);
      assert.equal(rawEntry.value, 1);
    });

    it("should throw when mutating Set annotations", () => {
      const marker = Symbol.for("@test/issue-491/set");
      const rawSet = new Set(["a"]);
      const state = injectAnnotations(undefined, { [marker]: rawSet });

      const annotations = getAnnotations(state);
      assert.ok(annotations !== undefined);
      const received = annotations[marker] as Set<string>;

      assert.throws(
        () => received.add("b"),
        { name: "TypeError" },
      );
      assert.deepEqual([...rawSet], ["a"]);
    });

    it("should throw when mutating Date and RegExp annotations", () => {
      const dateMarker = Symbol.for("@test/issue-491/date");
      const regexMarker = Symbol.for("@test/issue-491/regexp");
      const rawDate = new Date("2026-03-08T00:00:00.000Z");
      const rawRegExp = /ab+/g;
      const state = injectAnnotations(undefined, {
        [dateMarker]: rawDate,
        [regexMarker]: rawRegExp,
      });

      const annotations = getAnnotations(state);
      assert.ok(annotations !== undefined);

      const receivedDate = annotations[dateMarker] as Date;
      const receivedRegExp = annotations[regexMarker] as RegExp;

      assert.throws(
        () => receivedDate.setUTCFullYear(2030),
        { name: "TypeError" },
      );
      assert.throws(
        () => Reflect.set(receivedRegExp, "lastIndex", 3),
        { name: "TypeError" },
      );
      assert.equal(rawDate.toISOString(), "2026-03-08T00:00:00.000Z");
      assert.equal(rawRegExp.lastIndex, 0);
    });

    it("should not leak RegExp lastIndex mutations back to the caller object", () => {
      const marker = Symbol.for("@test/issue-491/regexp-last-index");
      const rawRegExp = /ab+/g;
      const state = injectAnnotations(undefined, { [marker]: rawRegExp });

      const annotations = getAnnotations(state);
      assert.ok(annotations !== undefined);
      const protectedRegExp = annotations[marker] as RegExp;

      assert.ok(protectedRegExp.test("ab ab"));
      assert.equal(protectedRegExp.lastIndex, 2);
      assert.equal(rawRegExp.lastIndex, 0);

      assert.equal(protectedRegExp.exec("ab ab")?.[0], "ab");
      assert.equal(rawRegExp.lastIndex, 0);
    });

    it("should preserve RegExp metadata on protected views", () => {
      const marker = Symbol.for("@test/issue-491/regexp-metadata");
      const extraKey = Symbol.for("@test/issue-491/regexp-extra");

      class TaggedRegExp extends RegExp {
        readonly label = "tagged";

        matches(input: string): boolean {
          return this.test(input);
        }
      }

      const rawRegExp = new TaggedRegExp("ab+", "gi") as TaggedRegExp & {
        [extraKey]: { value: number };
      };
      rawRegExp.lastIndex = 2;
      rawRegExp[extraKey] = { value: 1 };

      const state = injectAnnotations(undefined, { [marker]: rawRegExp });
      const annotations = getAnnotations(state);
      assert.ok(annotations !== undefined);

      const protectedRegExp = annotations[marker] as TaggedRegExp & {
        [extraKey]: { value: number };
      };

      assert.ok(protectedRegExp instanceof TaggedRegExp);
      assert.equal(protectedRegExp.label, "tagged");
      assert.equal(protectedRegExp.lastIndex, 2);
      assert.ok(protectedRegExp.matches("zzabbb"));
      assert.notEqual(protectedRegExp[extraKey], rawRegExp[extraKey]);
      assert.equal(protectedRegExp[extraKey].value, 1);
      assert.throws(
        () => {
          protectedRegExp[extraKey].value = 2;
        },
        { name: "TypeError" },
      );
      assert.equal(rawRegExp[extraKey].value, 1);
    });

    it("should not reuse protected views across separate injectAnnotations() calls", () => {
      const marker = Symbol.for("@test/issue-491/per-run-cache");
      const sharedAnnotations = { [marker]: /ab+/g };

      const firstState = injectAnnotations(undefined, sharedAnnotations);
      const secondState = injectAnnotations(undefined, sharedAnnotations);

      const firstAnnotations = getAnnotations(firstState);
      const secondAnnotations = getAnnotations(secondState);

      assert.ok(firstAnnotations !== undefined);
      assert.ok(secondAnnotations !== undefined);

      const firstRegExp = firstAnnotations[marker] as RegExp;
      const secondRegExp = secondAnnotations[marker] as RegExp;

      assert.notEqual(firstRegExp, secondRegExp);
      assert.ok(firstRegExp.test("ab ab"));
      assert.equal(firstRegExp.lastIndex, 2);
      assert.equal(secondRegExp.lastIndex, 0);
      assert.equal((sharedAnnotations[marker] as RegExp).lastIndex, 0);
    });

    it("should normalize protected annotation inputs for a fresh run", () => {
      const marker = Symbol.for("@test/issue-491/protected-input-rerun");
      const seedState = injectAnnotations(undefined, { [marker]: /ab+/g });
      const protectedAnnotations = getAnnotations(seedState);

      assert.ok(protectedAnnotations !== undefined);

      const firstState = injectFreshRunAnnotations(
        undefined,
        protectedAnnotations,
      );
      const secondState = injectFreshRunAnnotations(
        undefined,
        protectedAnnotations,
      );
      const firstAnnotations = getAnnotations(firstState);
      const secondAnnotations = getAnnotations(secondState);

      assert.ok(firstAnnotations !== undefined);
      assert.ok(secondAnnotations !== undefined);

      const firstRegExp = firstAnnotations[marker] as RegExp;
      const secondRegExp = secondAnnotations[marker] as RegExp;

      assert.notEqual(firstAnnotations, secondAnnotations);
      assert.notEqual(firstRegExp, secondRegExp);
      assert.ok(firstRegExp.test("ab ab"));
      assert.equal(firstRegExp.lastIndex, 2);
      assert.equal(secondRegExp.lastIndex, 0);
    });

    it("should normalize nested protected annotation values for a fresh run", () => {
      const innerMarker = Symbol.for("@test/issue-491/nested-protected-input");
      const outerMarker = Symbol.for(
        "@test/issue-491/nested-protected-input-wrapper",
      );
      const seedState = injectAnnotations(undefined, { [innerMarker]: /ab+/g });
      const protectedAnnotations = getAnnotations(seedState);

      assert.ok(protectedAnnotations !== undefined);

      const rebuiltAnnotations = {
        [outerMarker]: {
          regex: protectedAnnotations[innerMarker],
        },
      };

      const firstState = injectFreshRunAnnotations(
        undefined,
        rebuiltAnnotations,
      );
      const secondState = injectFreshRunAnnotations(
        undefined,
        rebuiltAnnotations,
      );
      const firstAnnotations = getAnnotations(firstState);
      const secondAnnotations = getAnnotations(secondState);

      assert.ok(firstAnnotations !== undefined);
      assert.ok(secondAnnotations !== undefined);

      const firstRegExp = (
        firstAnnotations[outerMarker] as { regex: RegExp }
      ).regex;
      const secondRegExp = (
        secondAnnotations[outerMarker] as { regex: RegExp }
      ).regex;

      assert.notEqual(firstRegExp, secondRegExp);
      assert.ok(firstRegExp.test("ab ab"));
      assert.equal(firstRegExp.lastIndex, 2);
      assert.equal(secondRegExp.lastIndex, 0);
    });

    it("should preserve array subclass prototypes on protected views", () => {
      const marker = Symbol.for("@test/issue-491/array-subclass");

      class TaggedArray<T> extends Array<T> {
        first(): T | undefined {
          return this[0];
        }
      }

      const rawArray = TaggedArray.from([{ value: 1 }]) as TaggedArray<
        { value: number }
      >;
      const state = injectAnnotations(undefined, { [marker]: rawArray });
      const annotations = getAnnotations(state);

      assert.ok(annotations !== undefined);

      const received = annotations[marker] as TaggedArray<{ value: number }>;

      assert.ok(received instanceof TaggedArray);
      assert.equal(received.first()?.value, 1);
      assert.throws(
        () => {
          const first = received.first();
          assert.ok(first !== undefined);
          first.value = 2;
        },
        { name: "TypeError" },
      );
      assert.equal(rawArray.first()?.value, 1);
    });

    it("should protect custom properties on built-in annotation views", () => {
      const marker = Symbol.for("@test/issue-491/builtin-custom-property");

      const cases = [
        new Map<string, string>(),
        new Set(["a"]),
        new Date("2026-03-08T00:00:00.000Z"),
        new URL("https://example.com/a?x=1"),
        new URLSearchParams("x=1"),
      ] as const;

      for (const rawValue of cases) {
        const withCustomProperty = rawValue as (typeof rawValue) & {
          extra: { value: number };
        };
        withCustomProperty.extra = { value: 1 };

        const state = injectAnnotations(undefined, {
          [marker]: withCustomProperty,
        });
        const annotations = getAnnotations(state);

        assert.ok(annotations !== undefined);

        const received = annotations[marker] as (typeof rawValue) & {
          extra: { value: number };
        };
        const descriptor = Object.getOwnPropertyDescriptor(received, "extra");

        assert.notEqual(received.extra, withCustomProperty.extra);
        assert.equal(received.extra.value, 1);
        assert.ok(descriptor != null && "value" in descriptor);
        assert.notEqual(descriptor.value, withCustomProperty.extra);
        assert.throws(
          () => {
            received.extra.value = 2;
          },
          { name: "TypeError" },
        );
        assert.equal(withCustomProperty.extra.value, 1);
      }
    });

    it("should preserve built-in subclass methods with private fields", () => {
      const marker = Symbol.for("@test/issue-491/map-subclass-private-field");

      class TaggedMap<K, V> extends Map<K, V> {
        readonly #label = "tagged";

        label(): string {
          return this.#label;
        }
      }

      const rawMap = new TaggedMap<string, string>([["a", "b"]]);
      const state = injectAnnotations(undefined, { [marker]: rawMap });
      const annotations = getAnnotations(state);

      assert.ok(annotations !== undefined);

      const received = annotations[marker] as TaggedMap<string, string>;

      assert.ok(received instanceof TaggedMap);
      assert.equal(received.get("a"), "b");
      assert.equal(received.label(), "tagged");
    });

    it("should preserve URL subclass methods with private fields", () => {
      const marker = Symbol.for("@test/issue-491/url-subclass-private-field");

      class TaggedUrl extends URL {
        readonly #label = "tagged";

        label(): string {
          return this.#label;
        }
      }

      const rawUrl = new TaggedUrl("https://example.com/hello?name=world");
      const state = injectAnnotations(undefined, { [marker]: rawUrl });
      const annotations = getAnnotations(state);

      assert.ok(annotations !== undefined);

      const received = annotations[marker] as TaggedUrl;

      assert.ok(received instanceof TaggedUrl);
      assert.equal(received.href, "https://example.com/hello?name=world");
      assert.equal(received.label(), "tagged");
    });

    it("should preserve Map key identity for fresh-run protected inputs", () => {
      const keyMarker = Symbol.for("@test/issue-491/map-protected-key");
      const mapMarker = Symbol.for("@test/issue-491/map-protected-key-wrapper");
      const seedState = injectAnnotations(undefined, {
        [keyMarker]: { value: 1 },
      });
      const protectedAnnotations = getAnnotations(seedState);

      assert.ok(protectedAnnotations !== undefined);

      const rebuiltAnnotations = {
        [mapMarker]: new Map([[protectedAnnotations[keyMarker], "ok"]]),
      };

      const state = injectFreshRunAnnotations(undefined, rebuiltAnnotations);
      const annotations = getAnnotations(state);

      assert.ok(annotations !== undefined);

      const map = annotations[mapMarker] as Map<object, string>;
      const iteratedKey = [...map.keys()][0];

      assert.ok(iteratedKey !== undefined);
      assert.ok(map.has(iteratedKey));
      assert.equal(map.get(iteratedKey), "ok");
    });

    it("should preserve Map key identity for directly injected protected inputs", () => {
      const keyMarker = Symbol.for("@test/issue-491/map-protected-key-direct");
      const mapMarker = Symbol.for(
        "@test/issue-491/map-protected-key-direct-wrapper",
      );
      const seedState = injectAnnotations(undefined, {
        [keyMarker]: { value: 1 },
      });
      const protectedAnnotations = getAnnotations(seedState);

      assert.ok(protectedAnnotations !== undefined);

      const directAnnotations = {
        [mapMarker]: new Map([[protectedAnnotations[keyMarker], "ok"]]),
      };

      const state = injectAnnotations(undefined, directAnnotations);
      const annotations = getAnnotations(state);

      assert.ok(annotations !== undefined);

      const map = annotations[mapMarker] as Map<object, string>;
      const iteratedKey = [...map.keys()][0];

      assert.ok(iteratedKey !== undefined);
      assert.ok(map.has(iteratedKey));
      assert.equal(map.get(iteratedKey), "ok");
    });

    it("should preserve Set membership for fresh-run protected inputs", () => {
      const valueMarker = Symbol.for("@test/issue-491/set-protected-value");
      const setMarker = Symbol.for(
        "@test/issue-491/set-protected-value-wrapper",
      );
      const seedState = injectAnnotations(undefined, {
        [valueMarker]: { value: 1 },
      });
      const protectedAnnotations = getAnnotations(seedState);

      assert.ok(protectedAnnotations !== undefined);

      const rebuiltAnnotations = {
        [setMarker]: new Set([protectedAnnotations[valueMarker]]),
      };

      const state = injectFreshRunAnnotations(undefined, rebuiltAnnotations);
      const annotations = getAnnotations(state);

      assert.ok(annotations !== undefined);

      const set = annotations[setMarker] as Set<object>;
      const iteratedValue = [...set.values()][0];

      assert.ok(iteratedValue !== undefined);
      assert.ok(set.has(iteratedValue));
    });

    it("should preserve Set membership for directly injected protected inputs", () => {
      const valueMarker = Symbol.for(
        "@test/issue-491/set-protected-value-direct",
      );
      const setMarker = Symbol.for(
        "@test/issue-491/set-protected-value-direct-wrapper",
      );
      const seedState = injectAnnotations(undefined, {
        [valueMarker]: { value: 1 },
      });
      const protectedAnnotations = getAnnotations(seedState);

      assert.ok(protectedAnnotations !== undefined);

      const directAnnotations = {
        [setMarker]: new Set([protectedAnnotations[valueMarker]]),
      };

      const state = injectAnnotations(undefined, directAnnotations);
      const annotations = getAnnotations(state);

      assert.ok(annotations !== undefined);

      const set = annotations[setMarker] as Set<object>;
      const iteratedValue = [...set.values()][0];

      assert.ok(iteratedValue !== undefined);
      assert.ok(set.has(iteratedValue));
    });

    it("should not expose mutable clone-backed built-ins through valueOf", () => {
      const marker = Symbol.for("@test/issue-491/value-of");
      const map = new Map<string, { value: number }>([["k", { value: 1 }]]);
      const set = new Set([{ value: 1 }]);
      const regex = /ab+/g;
      const url = new URL("https://example.com/a?x=1");
      const params = new URLSearchParams("x=1");

      const state = injectAnnotations(undefined, {
        [marker]: { map, set, regex, url, params },
      });
      const annotations = getAnnotations(state);

      assert.ok(annotations !== undefined);

      const value = annotations[marker] as {
        map: Map<string, { value: number }>;
        set: Set<{ value: number }>;
        regex: RegExp;
        url: URL;
        params: URLSearchParams;
      };

      assert.equal(value.map.valueOf(), value.map);
      assert.equal(value.set.valueOf(), value.set);
      assert.equal(value.regex.valueOf(), value.regex);
      assert.equal(value.url.valueOf(), value.url);
      assert.equal(value.params.valueOf(), value.params);

      assert.throws(() =>
        (value.map.valueOf() as typeof value.map).set("x", {
          value: 2,
        }), {
        name: "TypeError",
      });
      assert.throws(() =>
        (value.set.valueOf() as typeof value.set).add({
          value: 2,
        }), {
        name: "TypeError",
      });
      assert.throws(() => Reflect.set(value.regex.valueOf(), "lastIndex", 3), {
        name: "TypeError",
      });
      assert.throws(() => Reflect.set(value.url.valueOf(), "pathname", "/b"), {
        name: "TypeError",
      });
      assert.throws(
        () => (value.params.valueOf() as typeof value.params).set("x", "2"),
        {
          name: "TypeError",
        },
      );
    });

    it("should throw when mutating URL-like annotations", () => {
      const marker = Symbol.for("@test/issue-491/url");
      const rawUrl = new URL("https://example.com/a?x=1");
      const state = injectAnnotations(undefined, { [marker]: rawUrl });

      const annotations = getAnnotations(state);
      assert.ok(annotations !== undefined);
      const received = annotations[marker] as URL;

      assert.throws(
        () => Reflect.set(received, "pathname", "/b"),
        { name: "TypeError" },
      );
      assert.throws(
        () => received.searchParams.set("x", "2"),
        { name: "TypeError" },
      );
      assert.equal(rawUrl.pathname, "/a");
      assert.equal(rawUrl.searchParams.get("x"), "1");
    });

    it("should keep frozen annotation inputs readable without proxy invariant violations", () => {
      const marker = Symbol.for("@test/issue-491/frozen");
      const rawValue = { value: 1 };
      const rawAnnotations = Object.freeze({ [marker]: rawValue });
      const state = injectAnnotations(undefined, rawAnnotations);

      const annotations = getAnnotations(state);
      assert.ok(annotations !== undefined);
      assert.doesNotThrow(() => Object.getOwnPropertySymbols(annotations));
      const protectedValue = annotations[marker] as { value: number };
      assert.equal(protectedValue.value, 1);
      assert.throws(
        () => Reflect.set(protectedValue, "value", 2),
        { name: "TypeError" },
      );
      assert.equal(rawValue.value, 1);
    });

    it("should preserve self-referential plain annotation objects", () => {
      const marker = Symbol.for("@test/issue-491/cycle");
      const rawValue: { self?: unknown; readonly value: number } = { value: 1 };
      rawValue.self = rawValue;

      const state = injectAnnotations(undefined, { [marker]: rawValue });
      const annotations = getAnnotations(state);

      assert.ok(annotations !== undefined);
      const protectedValue = annotations[marker] as {
        readonly self?: unknown;
        readonly value: number;
      };
      assert.equal(protectedValue.value, 1);
      assert.equal(protectedValue.self, protectedValue);
    });

    it("should keep URLSearchParams callbacks on the protected view", () => {
      const marker = Symbol.for("@test/issue-491/url-search-params");
      const raw = new URLSearchParams("alpha=1&beta=2");
      const state = injectAnnotations(undefined, { [marker]: raw });

      const annotations = getAnnotations(state);
      assert.ok(annotations !== undefined);
      const params = annotations[marker] as URLSearchParams;
      let owner: URLSearchParams | undefined;

      params.forEach((_value, _key, searchParams) => {
        owner = searchParams;
      });

      assert.equal(owner, params);
      assert.deepEqual([...params.entries()], [
        ["alpha", "1"],
        ["beta", "2"],
      ]);
      assert.throws(
        () => owner?.set("alpha", "3"),
        { name: "TypeError" },
      );
      assert.equal(raw.get("alpha"), "1");
    });
  });
});

describe("injectAnnotations", () => {
  it("should preserve wrapper markers when reinjecting injected wrappers", () => {
    const first = injectAnnotations(undefined, { [Symbol.for("@test/a")]: 1 });
    assert.ok(isInjectedAnnotationWrapper(first));

    const second = injectAnnotations(first, { [Symbol.for("@test/b")]: 2 });
    assert.equal(second, first);
    assert.ok(isInjectedAnnotationWrapper(second));

    const wrapper = second as unknown as Record<PropertyKey, unknown>;
    assert.ok(Object.hasOwn(wrapper, annotationStateValueKey));
    assert.ok(Object.hasOwn(wrapper, annotationWrapperKey));
    assert.equal(wrapper[annotationWrapperKey], true);
    assert.equal(wrapper[annotationStateValueKey], undefined);
  });

  it("should preserve Date state shape", () => {
    const marker = Symbol.for("@test/inject-date");
    const source = new Date("2026-03-08T00:00:00.000Z");
    const result = injectAnnotations(source, { [marker]: "ok" });

    assert.ok(result instanceof Date);
    assert.notEqual(result, source);
    assert.equal(result.toISOString(), "2026-03-08T00:00:00.000Z");
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should preserve Map state shape", () => {
    const marker = Symbol.for("@test/inject-map");
    const source = new Map<string, number>([["a", 1]]);
    const result = injectAnnotations(source, { [marker]: "ok" });

    assert.ok(result instanceof Map);
    assert.notEqual(result, source);
    assert.equal(result.get("a"), 1);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should preserve Set state shape", () => {
    const marker = Symbol.for("@test/inject-set");
    const source = new Set(["a", "b"]);
    const result = injectAnnotations(source, { [marker]: "ok" });

    assert.ok(result instanceof Set);
    assert.notEqual(result, source);
    assert.deepEqual([...result], ["a", "b"]);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should preserve RegExp state shape", () => {
    const marker = Symbol.for("@test/inject-regexp");
    class TaggedRegExp extends RegExp {
      readonly label = "tagged";
    }
    const extraKey = Symbol.for("@test/inject-regexp-extra");
    const source = new TaggedRegExp("ab+", "gi") as TaggedRegExp & {
      [extraKey]: { value: number };
    };
    source[extraKey] = { value: 1 };
    source.lastIndex = 3;
    const result = injectAnnotations(source, { [marker]: "ok" });

    assert.ok(result instanceof TaggedRegExp);
    assert.notEqual(result, source);
    assert.equal(result.source, "ab+");
    assert.equal(result.flags, "gi");
    assert.equal(result.lastIndex, 3);
    assert.equal(result.label, "tagged");
    assert.equal(result[extraKey], source[extraKey]);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should clone non-plain object states without mutation", () => {
    const marker = Symbol.for("@test/inject-nonplain");
    class CustomState {
      value = 1;
    }
    const source = new CustomState();
    const result = injectAnnotations(source, {
      [marker]: "ok",
    });

    assert.notEqual(result, source);
    assert.ok(result instanceof CustomState);
    assert.equal(result.value, 1);
    assert.equal(getAnnotations(source), undefined);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  describe("with empty annotations object", () => {
    it("should return primitive state unchanged", () => {
      assert.equal(injectAnnotations(undefined, {}), undefined);
      assert.equal(injectAnnotations(null, {}), null);
      assert.equal(injectAnnotations(42, {}), 42);
      assert.equal(injectAnnotations("state", {}), "state");
      assert.equal(injectAnnotations(true, {}), true);
    });

    it("should not wrap primitive state", () => {
      const result = injectAnnotations(undefined, {});
      assert.ok(!isInjectedAnnotationWrapper(result));
    });

    it("should return identical array state", () => {
      const source = [1, 2, 3];
      const result = injectAnnotations(source, {});
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });

    it("should return identical Date state", () => {
      const source = new Date("2026-03-08T00:00:00.000Z");
      const result = injectAnnotations(source, {});
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });

    it("should return identical Map state", () => {
      const source = new Map<string, number>([["a", 1]]);
      const result = injectAnnotations(source, {});
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });

    it("should return identical Set state", () => {
      const source = new Set(["a", "b"]);
      const result = injectAnnotations(source, {});
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });

    it("should return identical RegExp state", () => {
      const source = /ab+/gi;
      const result = injectAnnotations(source, {});
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });

    it("should return identical plain object state", () => {
      const source = { value: 1 };
      const result = injectAnnotations(source, {});
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });

    it("should return identical class instance state", () => {
      class CustomState {
        value = 1;
      }
      const source = new CustomState();
      const result = injectAnnotations(source, {});
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });

    it("should ignore string-keyed entries and still no-op", () => {
      const source = { value: 1 };
      const annotationsWithStringKey = { foo: "bar" } as unknown as Record<
        symbol,
        unknown
      >;
      const result = injectAnnotations(source, annotationsWithStringKey);
      assert.equal(result, source);
      assert.equal(getAnnotations(result), undefined);
    });
  });
});

describe("inheritAnnotations", () => {
  it("should not mutate extensible targets", () => {
    const marker = Symbol.for("@test/inherit-extensible");
    const source = { [annotationKey]: { [marker]: "ok" } };
    const target = { value: 1 };
    const result = inheritAnnotations(source, target);

    assert.notEqual(result, target);
    assert.equal(target.value, 1);
    assert.equal(getAnnotations(target), undefined);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should not mutate frozen targets", () => {
    const marker = Symbol.for("@test/inherit-frozen");
    const source = { [annotationKey]: { [marker]: "ok" } };
    const frozenTarget = Object.freeze({ value: 1 });
    const result = inheritAnnotations(source, frozenTarget);

    assert.notEqual(result, frozenTarget);
    assert.equal((result as { value: number }).value, 1);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should not mutate frozen array targets", () => {
    const marker = Symbol.for("@test/inherit-frozen-array");
    const source = { [annotationKey]: { [marker]: "ok" } };
    const frozenTarget = Object.freeze(["a", "b"] as const);
    const result = inheritAnnotations(source, frozenTarget);

    assert.notEqual(result, frozenTarget);
    assert.ok(Array.isArray(result));
    assert.deepEqual([...result], ["a", "b"]);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should preserve Date state shape", () => {
    const marker = Symbol.for("@test/inherit-date");
    const source = { [annotationKey]: { [marker]: "ok" } };
    const target = new Date("2026-03-08T00:00:00.000Z");
    const result = inheritAnnotations(source, target);

    assert.ok(result instanceof Date);
    assert.notEqual(result, target);
    assert.equal(result.toISOString(), "2026-03-08T00:00:00.000Z");
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should preserve Map state shape", () => {
    const marker = Symbol.for("@test/inherit-map");
    const source = { [annotationKey]: { [marker]: "ok" } };
    const target = new Map<string, number>([["a", 1]]);
    const result = inheritAnnotations(source, target);

    assert.ok(result instanceof Map);
    assert.notEqual(result, target);
    assert.equal(result.get("a"), 1);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should preserve Set state shape", () => {
    const marker = Symbol.for("@test/inherit-set");
    const source = { [annotationKey]: { [marker]: "ok" } };
    const target = new Set(["a", "b"]);
    const result = inheritAnnotations(source, target);

    assert.ok(result instanceof Set);
    assert.notEqual(result, target);
    assert.deepEqual([...result], ["a", "b"]);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should preserve RegExp state shape", () => {
    const marker = Symbol.for("@test/inherit-regexp");
    const source = { [annotationKey]: { [marker]: "ok" } };
    class TaggedRegExp extends RegExp {
      readonly label = "tagged";
    }
    const extraKey = Symbol.for("@test/inherit-regexp-extra");
    const target = new TaggedRegExp("ab+", "gi") as TaggedRegExp & {
      [extraKey]: { value: number };
    };
    target[extraKey] = { value: 1 };
    target.lastIndex = 4;
    const result = inheritAnnotations(source, target);

    assert.ok(result instanceof TaggedRegExp);
    assert.notEqual(result, target);
    assert.equal(result.source, "ab+");
    assert.equal(result.flags, "gi");
    assert.equal(result.lastIndex, 4);
    assert.equal(result.label, "tagged");
    assert.equal(result[extraKey], target[extraKey]);
    assert.equal(getAnnotations(result)?.[marker], "ok");
  });

  it("should not mutate extensible non-plain objects", () => {
    const marker = Symbol.for("@test/inherit-nonplain");
    const source = { [annotationKey]: { [marker]: "ok" } };
    class CustomState {
      value = 1;
    }
    const target = new CustomState();

    const result = inheritAnnotations(source, target);

    assert.equal(result, target);
    assert.equal(result.value, 1);
    assert.equal(getAnnotations(target), undefined);
  });
});

describe("unwrapInjectedAnnotationWrapper", () => {
  it("should unwrap pure injected wrappers back to the original value", () => {
    const wrapped = injectAnnotations(42, {
      [Symbol.for("@test/unwrap")]: "ok",
    });

    assert.equal(unwrapInjectedAnnotationWrapper(wrapped), 42);
  });

  it("should not unwrap wrappers with additional own keys", () => {
    const wrapped = injectAnnotations("value", {
      [Symbol.for("@test/unwrap-extra")]: "ok",
    });
    const wrapperObject = wrapped as unknown as Record<PropertyKey, unknown>;
    wrapperObject.extra = true;

    assert.equal(
      unwrapInjectedAnnotationWrapper(wrapperObject),
      wrapperObject,
    );
  });

  it("should return non-wrapper objects unchanged", () => {
    const value = { plain: true };

    assert.equal(unwrapInjectedAnnotationWrapper(value), value);
  });
});
