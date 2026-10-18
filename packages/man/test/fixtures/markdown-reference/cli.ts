import process from "node:process";
import { run } from "@optique/run";
import { parser } from "./definitions.ts";

const result = run(parser, {
  programName: "ref-tool",
  help: "option",
  version: "1.0.0",
  completion: "command",
  colors: false,
});
if (result.action.type === "docs") {
  const [{ formatCommandReference }, { referenceEntries, referenceOptions }] =
    await Promise.all([
      import("@optique/man/markdown"),
      import("./pages.ts"),
    ]);
  process.stdout.write(
    formatCommandReference(referenceEntries, referenceOptions),
  );
} else {
  process.stdout.write(JSON.stringify(result) + "\n");
}
