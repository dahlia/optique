import { runProgram } from "@optique/discover";
import { options } from "./grammar.js";

await runProgram({
  ...options,
  dir: new URL("./commands/", import.meta.url),
  extensions: [".js"],
  metadata: { name: "baseline", version: "1.0.0" },
});
