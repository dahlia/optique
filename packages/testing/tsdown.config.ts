import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/cli.ts",
    "src/discover.ts",
    "src/index.ts",
    "src/parser.ts",
    "src/run.ts",
  ],
  dts: true,
  format: ["esm", "cjs"],
  platform: "neutral",
});
