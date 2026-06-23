import { defineConfig } from "tsdown";
import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/command.ts",
    "src/generator.ts",
    "src/cli.ts",
  ],
  dts: true,
  format: ["esm", "cjs"],
  platform: "node",
  hooks: {
    "build:done": () => {
      const shebang = "#!/usr/bin/env node\n";
      for (const file of ["cli.js", "cli.cjs"]) {
        const filePath = join("dist", file);
        const content = readFileSync(filePath, "utf-8");
        if (!content.startsWith("#!")) {
          writeFileSync(filePath, shebang + content);
        }
        chmodSync(filePath, 0o755);
      }
    },
  },
});
