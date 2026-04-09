import type { Annotations } from "@optique/core/annotations";
import type { SourceContext } from "@optique/core/context";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("SourceContext", () => {
  describe("interface implementation", () => {
    it("should allow creating a single-pass context", () => {
      const envKey = Symbol.for("@test/env");
      const context: SourceContext = {
        id: envKey,
        phase: "single-pass",
        getAnnotations() {
          return {
            [envKey]: { HOST: "localhost", PORT: "3000" },
          };
        },
      };

      assert.equal(context.id, envKey);
      assert.equal(context.phase, "single-pass");
      const annotations = context.getAnnotations();
      assert.ok(!(annotations instanceof Promise));
      assert.deepEqual(annotations[envKey], {
        HOST: "localhost",
        PORT: "3000",
      });
    });

    it("should allow creating a two-pass context", async () => {
      const configKey = Symbol.for("@test/config");
      const context: SourceContext = {
        id: configKey,
        phase: "two-pass",
        getAnnotations(parsed?: unknown) {
          if (parsed === undefined) {
            return { [configKey]: { phase1: true } };
          }
          const result = parsed as { config?: string };
          if (!result.config) return {};
          return Promise.resolve({
            [configKey]: { host: "example.com", port: 8080 },
          });
        },
      };

      assert.equal(context.id, configKey);
      assert.equal(context.phase, "two-pass");

      const firstPass = context.getAnnotations();
      assert.ok(!(firstPass instanceof Promise));
      assert.deepEqual(firstPass[configKey], { phase1: true });

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
        phase: "single-pass",
        async getAnnotations() {
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

  describe("context composition patterns", () => {
    it("should allow multiple contexts with different keys", () => {
      const envKey = Symbol.for("@test/env");
      const configKey = Symbol.for("@test/config");

      const envContext: SourceContext = {
        id: envKey,
        phase: "single-pass",
        getAnnotations() {
          return { [envKey]: { HOST: "localhost" } };
        },
      };

      const configContext: SourceContext = {
        id: configKey,
        phase: "two-pass",
        getAnnotations(parsed?: unknown) {
          if (!parsed) return {};
          return { [configKey]: { host: "config-host" } };
        },
      };

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
        phase: "single-pass",
        getAnnotations() {
          return { [sharedKey]: { source: "context1", priority: 1 } };
        },
      };

      const context2: SourceContext = {
        id: Symbol.for("@test/context2"),
        phase: "single-pass",
        getAnnotations() {
          return { [sharedKey]: { source: "context2", priority: 2 } };
        },
      };

      const annotations1 = context1.getAnnotations() as Annotations;
      const annotations2 = context2.getAnnotations() as Annotations;

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
        phase: "single-pass",
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
        phase: "single-pass",
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
        phase: "two-pass",
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
        phase: "single-pass",
        getAnnotations() {
          return {};
        },
      };

      assert.equal(context.finalizeParsed, undefined);
    });
  });
});
