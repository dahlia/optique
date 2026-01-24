import type { Annotations } from "@optique/core/annotations";
import { isStaticContext, type SourceContext } from "@optique/core/context";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

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
});
