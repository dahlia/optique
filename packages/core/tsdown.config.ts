import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/message.ts",
    "src/parser.ts",
    "src/valueparser.ts",
  ],
  dts: true,
  format: ["esm", "cjs"],
  unbundle: true,
  platform: "neutral",
});
