import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/roff.ts",
    "src/man.ts",
  ],
  dts: true,
  format: ["esm", "cjs"],
  platform: "neutral",
});
