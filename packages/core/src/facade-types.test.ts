import assert from "node:assert/strict";
import test from "node:test";
import type { ParserValuePlaceholder, SourceContext } from "./context.ts";
import type { ExtractRequiredOptions } from "./facade.ts";

interface NoOptionsContext extends SourceContext {}

interface ConfigPathContext extends
  SourceContext<{
    readonly getConfigPath: (
      parsed: ParserValuePlaceholder,
    ) => string | undefined;
  }> {}

interface LocaleContext extends
  SourceContext<{
    readonly locale: string;
  }> {}

test("ExtractRequiredOptions keeps required options with void contexts", () => {
  type Required = ExtractRequiredOptions<
    readonly [NoOptionsContext, ConfigPathContext],
    { config: string }
  >;

  const options: Required = {
    getConfigPath: (parsed) => {
      // @ts-expect-error Parser value should not be any.
      void parsed.nonexistent;
      return parsed.config;
    },
  };

  assert.equal(
    options.getConfigPath({ config: "optique.json" }),
    "optique.json",
  );
});

test("ExtractRequiredOptions intersects required option objects", () => {
  type Required = ExtractRequiredOptions<
    readonly [ConfigPathContext, LocaleContext],
    { config: string }
  >;

  const options: Required = {
    getConfigPath: (parsed) => parsed.config,
    locale: "en-US",
  };

  assert.equal(options.locale, "en-US");
  assert.equal(options.getConfigPath({ config: "app.json" }), "app.json");
});
