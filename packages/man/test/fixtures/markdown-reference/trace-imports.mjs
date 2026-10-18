// Node-only import probe. Hooks and their state live only in this subprocess.
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
/** @type {string[]} */
const loaded = [];
registerHooks({
  load(url, context, nextLoad) {
    if (
      url.startsWith("file:") && /\/packages\/(core|run|man)\/dist\//.test(url)
    ) {
      if (/\/(?:doc-pages|markdown)(?:[.-])/.test(url)) {
        throw new Error(`Optional documentation entry loaded: ${url}`);
      }
      const source = readFileSync(fileURLToPath(url), "utf8");
      if (
        /(?:function|const|let|var)\s+(?:collectDocPages|formatCommandReference)\b/
          .test(source)
      ) throw new Error(`Optional implementation loaded: ${url}`);
      loaded.push(url);
    }
    return nextLoad(url, context);
  },
});
await import("@optique/core");
await import("@optique/run");
await import("@optique/man");
process.stdout.write(JSON.stringify(loaded) + "\n");
