import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/run.ts",
    "src/valueparser.ts",
  ],
  dts: true,
  format: ["esm", "cjs"],
  unbundle: true,
  platform: "node",
});
