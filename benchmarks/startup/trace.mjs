import { registerHooks } from "node:module";
import { appendFileSync } from "node:fs";
import process from "node:process";

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url.startsWith("file:")) {
      appendFileSync(
        process.env.STARTUP_TRACE,
        `${JSON.stringify({ url, format: result.format })}\n`,
      );
    }
    return result;
  },
});
