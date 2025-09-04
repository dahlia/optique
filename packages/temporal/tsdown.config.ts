import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
  ],
  dts: true,
  format: ["esm", "cjs"],
  platform: "neutral",
  outputOptions(outputOptions, format) {
    console.debug({format})
    if (format === "cjs") {
      outputOptions.banner = 'const { Temporal } = require("@js-temporal/polyfill");';
    } else {
      outputOptions.banner = 'import { Temporal } from "@js-temporal/polyfill";';
    }
    return outputOptions;
  },
});
