import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/run.ts",
  ],
  dts: true,
  format: ["esm", "cjs"],
  platform: "node",
});
