import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/command.ts",
  ],
  dts: true,
  format: ["esm", "cjs"],
  platform: "node",
});
