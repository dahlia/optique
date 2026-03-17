import type { Annotations } from "@optique/core/annotations";
import {
  isPlaceholderValue,
  isStaticContext,
  placeholder,
  type SourceContext,
} from "@optique/core/context";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as fc from "fast-check";

describe("SourceContext", () => {
  describe("interface implementation", () => {
    it("should allow creating a static context", () => {
      const envKey = Symbol.for("@test/env");
      const context: SourceContext = {
        id: envKey,
        getAnnotations() {
          return {
            [envKey]: { HOST: "localhost", PORT: "3000" },
          };
        },
      };

      assert.equal(context.id, envKey);
      const annotations = context.getAnnotations();
      assert.ok(!(annotations instanceof Promise));
      assert.deepEqual(annotations[envKey], {
        HOST: "localhost",
        PORT: "3000",
      });
    });

    it("should allow creating a dynamic context", async () => {
      const configKey = Symbol.for("@test/config");
      const context: SourceContext = {
        id: configKey,
        getAnnotations(parsed?: unknown) {
          if (!parsed) return {};
          const result = parsed as { config?: string };
          if (!result.config) return {};
          // Simulate async config loading
          return Promise.resolve({
            [configKey]: { host: "example.com", port: 8080 },
          });
        },
      };

      assert.equal(context.id, configKey);

      // First call without parsed result should return empty
      const firstPass = context.getAnnotations();
      assert.ok(!(firstPass instanceof Promise));
      assert.deepEqual(firstPass, {});

      // Second call with parsed result should return config data
      const secondPass = await context.getAnnotations({
        config: "config.json",
      });
      assert.deepEqual(secondPass[configKey], {
        host: "example.com",
        port: 8080,
      });
    });

    it("should allow creating a context with async getAnnotations", async () => {
      const asyncKey = Symbol.for("@test/async");
      const context: SourceContext = {
        id: asyncKey,
        async getAnnotations() {
          // Simulate async operation
          await new Promise((resolve) => setTimeout(resolve, 1));
          return {
            [asyncKey]: { data: "async-value" },
          };
        },
      };

      const annotations = await context.getAnnotations();
      assert.deepEqual(annotations[asyncKey], { data: "async-value" });
    });
  });

  describe("isStaticContext", () => {
    it("should return true for static contexts that return non-empty annotations", () => {
      const staticKey = Symbol.for("@test/static");
      const context: SourceContext = {
        id: staticKey,
        getAnnotations() {
          return {
            [staticKey]: { value: "static" },
          };
        },
      };

      assert.ok(isStaticContext(context));
    });

    it("should return false for dynamic contexts that return empty annotations", () => {
      const dynamicKey = Symbol.for("@test/dynamic");
      const context: SourceContext = {
        id: dynamicKey,
        getAnnotations(parsed?: unknown) {
          if (!parsed) return {};
          return {
            [dynamicKey]: { value: "dynamic" },
          };
        },
      };

      assert.ok(!isStaticContext(context));
    });

    it("should return false for contexts that return promises", () => {
      const asyncKey = Symbol.for("@test/async");
      const context: SourceContext = {
        id: asyncKey,
        getAnnotations() {
          return Promise.resolve({
            [asyncKey]: { value: "async" },
          });
        },
      };

      assert.ok(!isStaticContext(context));
    });

    it("should return false for contexts that return empty object synchronously", () => {
      const emptyKey = Symbol.for("@test/empty");
      const context: SourceContext = {
        id: emptyKey,
        getAnnotations() {
          return {};
        },
      };

      assert.ok(!isStaticContext(context));
    });

    it("should only check symbol-keyed annotations (ignore string keys)", () => {
      // isStaticContext checks Object.getOwnPropertySymbols().length,
      // so annotations with only string keys should return false
      const stringKeyContext: SourceContext = {
        id: Symbol.for("@test/string-keys"),
        getAnnotations() {
          return { someStringKey: "value" } as Annotations;
        },
      };

      assert.ok(!isStaticContext(stringKeyContext));
    });

    it('does not call getAnnotations() when mode field is "static"', () => {
      // isStaticContext() should not call getAnnotations() as a side effect
      // when the context declares its own mode field.  This matters for
      // contexts like EnvContext whose getAnnotations() mutates global state.
      let getAnnotationsCalled = false;
      const contextId = Symbol("@test/side-effect-check");

      const context: SourceContext = {
        id: contextId,
        mode: "static",
        getAnnotations() {
          getAnnotationsCalled = true;
          return { [contextId]: { value: "x" } };
        },
      };

      const result = isStaticContext(context);
      assert.ok(result, 'Expected mode: "static" to report as static');
      assert.ok(
        !getAnnotationsCalled,
        "isStaticContext() must not call getAnnotations() when mode field is set",
      );
    });

    it('returns false without calling getAnnotations() for mode: "dynamic"', () => {
      let getAnnotationsCalled = false;
      const contextId = Symbol("@test/side-effect-false");

      const context: SourceContext = {
        id: contextId,
        mode: "dynamic",
        getAnnotations() {
          getAnnotationsCalled = true;
          return { [contextId]: { value: "x" } };
        },
      };

      const result = isStaticContext(context);
      assert.ok(!result, 'Expected mode: "dynamic" to report as dynamic');
      assert.ok(
        !getAnnotationsCalled,
        "isStaticContext() must not call getAnnotations() when mode field is set",
      );
    });
  });

  describe("context composition patterns", () => {
    it("should allow multiple contexts with different keys", () => {
      const envKey = Symbol.for("@test/env");
      const configKey = Symbol.for("@test/config");

      const envContext: SourceContext = {
        id: envKey,
        getAnnotations() {
          return { [envKey]: { HOST: "localhost" } };
        },
      };

      const configContext: SourceContext = {
        id: configKey,
        getAnnotations(parsed?: unknown) {
          if (!parsed) return {};
          return { [configKey]: { host: "config-host" } };
        },
      };

      // Both contexts can coexist
      const envAnnotations = envContext.getAnnotations();
      const configAnnotations = configContext.getAnnotations({
        config: "test.json",
      });

      assert.ok(!(envAnnotations instanceof Promise));
      assert.ok(!(configAnnotations instanceof Promise));
      assert.deepEqual(envAnnotations[envKey], { HOST: "localhost" });
      assert.deepEqual(configAnnotations[configKey], { host: "config-host" });
    });

    it("should allow contexts to use the same annotation key with different data", () => {
      const sharedKey = Symbol.for("@test/shared");

      const context1: SourceContext = {
        id: Symbol.for("@test/context1"),
        getAnnotations() {
          return { [sharedKey]: { source: "context1", priority: 1 } };
        },
      };

      const context2: SourceContext = {
        id: Symbol.for("@test/context2"),
        getAnnotations() {
          return { [sharedKey]: { source: "context2", priority: 2 } };
        },
      };

      const annotations1 = context1.getAnnotations() as Annotations;
      const annotations2 = context2.getAnnotations() as Annotations;

      // Different contexts can provide data for the same annotation key
      // Priority handling is done by runWith()
      assert.deepEqual(annotations1[sharedKey], {
        source: "context1",
        priority: 1,
      });
      assert.deepEqual(annotations2[sharedKey], {
        source: "context2",
        priority: 2,
      });
    });
  });

  describe("getInternalAnnotations", () => {
    it("should allow a context to provide internal annotations", () => {
      const key = Symbol("@test/internal");
      const internalKey = Symbol("@test/internal-extra");
      const context: SourceContext = {
        id: key,
        getAnnotations() {
          return { [key]: { value: "primary" } };
        },
        getInternalAnnotations(_parsed, _annotations) {
          return { [internalKey]: { value: "internal" } };
        },
      };

      const annotations = context.getAnnotations() as Annotations;
      const internal = context.getInternalAnnotations?.(undefined, annotations);
      assert.ok(internal != null);
      assert.deepEqual(internal[internalKey], { value: "internal" });
    });

    it("should be optional on SourceContext", () => {
      const key = Symbol("@test/no-internal");
      const context: SourceContext = {
        id: key,
        getAnnotations() {
          return { [key]: { value: "only" } };
        },
      };

      assert.equal(context.getInternalAnnotations, undefined);
    });
  });

  describe("finalizeParsed", () => {
    it("should allow a context to transform parsed values", () => {
      const key = Symbol("@test/finalize");
      const marker = Symbol("undefined-marker");
      const context: SourceContext = {
        id: key,
        getAnnotations() {
          return {};
        },
        finalizeParsed(parsed) {
          return parsed === undefined ? { [marker]: true } : parsed;
        },
      };

      assert.deepEqual(
        context.finalizeParsed?.(undefined),
        { [marker]: true },
      );
      assert.equal(context.finalizeParsed?.("hello"), "hello");
    });

    it("should be optional on SourceContext", () => {
      const key = Symbol("@test/no-finalize");
      const context: SourceContext = {
        id: key,
        getAnnotations() {
          return {};
        },
      };

      assert.equal(context.finalizeParsed, undefined);
    });
  });

  describe("placeholder values", () => {
    it("should detect objects carrying the placeholder", () => {
      const sentinel = { [placeholder]: true };

      assert.ok(isPlaceholderValue(sentinel));
      assert.ok(!isPlaceholderValue({}));
      assert.ok(!isPlaceholderValue("string"));
      assert.ok(!isPlaceholderValue(null));
      assert.ok(!isPlaceholderValue(undefined));
      assert.ok(!isPlaceholderValue(42));
    });

    it("should work with class instances", () => {
      class MyPlaceholder {
        readonly [placeholder] = true;
      }

      assert.ok(isPlaceholderValue(new MyPlaceholder()));
      assert.ok(!isPlaceholderValue({ unrelated: true }));
    });
  });

  describe("property-based tests", () => {
    const propertyParameters = { numRuns: 150 } as const;

    it("mode should determine static-ness without calling getAnnotations", () => {
      fc.assert(
        fc.property(
          fc.constantFrom<"static" | "dynamic">("static", "dynamic"),
          fc.boolean(),
          (mode: "static" | "dynamic", asyncResult: boolean) => {
            let calls = 0;
            const marker = Symbol("@test/mode-controlled");
            const context: SourceContext = {
              id: marker,
              mode,
              getAnnotations() {
                calls++;
                if (asyncResult) {
                  return Promise.resolve({ [marker]: true });
                }
                return { [marker]: true };
              },
            };

            assert.equal(isStaticContext(context), mode === "static");
            assert.equal(calls, 0);
          },
        ),
        propertyParameters,
      );
    });

    it("fallback static detection should depend on sync symbol annotations", () => {
      fc.assert(
        fc.property(
          fc.boolean(),
          fc.integer({ min: 0, max: 3 }),
          fc.integer({ min: 0, max: 3 }),
          (
            asyncResult: boolean,
            symbolKeyCount: number,
            stringKeyCount: number,
          ) => {
            let calls = 0;
            const symbolEntries = Array.from(
              { length: symbolKeyCount },
              (_unused, i) => [Symbol(`@test/symbol-${i}`), i] as const,
            );
            const stringEntries = Array.from(
              { length: stringKeyCount },
              (_unused, i) => [`k${i}`, i] as const,
            );

            const syncAnnotations: Annotations = {};
            for (const [key, value] of symbolEntries) {
              syncAnnotations[key] = value;
            }
            for (const [key, value] of stringEntries) {
              (syncAnnotations as unknown as Record<string, unknown>)[key] =
                value;
            }

            const context: SourceContext = {
              id: Symbol("@test/fallback"),
              getAnnotations() {
                calls++;
                return asyncResult
                  ? Promise.resolve(syncAnnotations)
                  : syncAnnotations;
              },
            };

            const result = isStaticContext(context);
            assert.equal(calls, 1);
            assert.equal(result, !asyncResult && symbolKeyCount > 0);
          },
        ),
        propertyParameters,
      );
    });
  });
});
