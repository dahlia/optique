import {
  type Annotations,
  getAnnotations,
  injectAnnotations,
} from "@optique/core/annotations";
import type {
  SourceContext,
  SourceContextRequest,
} from "@optique/core/context";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function getPhase2Parsed<T>(
  request?: SourceContextRequest,
): T | undefined {
  return request?.phase === "phase2" ? request.parsed as T : undefined;
}

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
        getAnnotations(request?: SourceContextRequest) {
          const parsed = getPhase2Parsed<{ config?: string }>(request);
          if (request == null || request.phase === "phase1") {
            return { [configKey]: { phase1: true } };
          }
          if (!parsed?.config) return {};
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
        phase: "phase2",
        parsed: { config: "config.json" },
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
        getAnnotations(request?: SourceContextRequest) {
          if (request == null || request.phase === "phase1") return {};
          return { [configKey]: { host: "config-host" } };
        },
      };

      const envAnnotations = envContext.getAnnotations();
      const configAnnotations = configContext.getAnnotations({
        phase: "phase2",
        parsed: { config: "test.json" },
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
        getInternalAnnotations(_request, _annotations) {
          return { [internalKey]: { value: "internal" } };
        },
      };

      const annotations = context.getAnnotations() as Annotations;
      const internal = context.getInternalAnnotations?.(
        { phase: "phase1" },
        annotations,
      );
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

    it("should allow read-only annotation views through context hooks", () => {
      const key = Symbol("@test/readonly-context");
      const seedState = injectAnnotations(undefined, {
        [key]: { value: 1 },
      });
      const readonlyAnnotations = getAnnotations(seedState);

      assert.ok(readonlyAnnotations !== undefined);

      const context: SourceContext = {
        id: key,
        phase: "single-pass",
        getAnnotations() {
          return readonlyAnnotations;
        },
        getInternalAnnotations(_request, annotations) {
          return annotations;
        },
      };

      const annotations = context.getAnnotations();

      assert.equal(annotations, readonlyAnnotations);
      assert.equal(
        context.getInternalAnnotations?.({ phase: "phase1" }, annotations),
        readonlyAnnotations,
      );
    });
  });

  describe("request contract", () => {
    it("should make phase 2 explicit even when parsed is undefined", () => {
      const request: SourceContextRequest = {
        phase: "phase2",
        parsed: undefined,
      };

      assert.equal(request.phase, "phase2");
      assert.equal(request.parsed, undefined);
    });
  });
});
