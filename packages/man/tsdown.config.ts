import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/roff.ts",
    "src/man.ts",
    "src/cli.ts",
  ],
  dts: true,
  format: ["esm", "cjs"],
  platform: "neutral",
  external: [
    // tsx is dynamically imported at runtime for Node.js TypeScript support
    "tsx",
    "tsx/esm/api",
  ],
  hooks: {
    "build:done": () => {
      // Add shebang to CLI entry points
      const shebang = "#!/usr/bin/env node\n";
      for (const file of ["cli.js", "cli.cjs"]) {
        const filePath = join("dist", file);
        const content = readFileSync(filePath, "utf-8");
        if (!content.startsWith("#!")) {
          writeFileSync(filePath, shebang + content);
        }
      }
    },
  },
});
