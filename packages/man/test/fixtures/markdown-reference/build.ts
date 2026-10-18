import { writeFileSync } from "node:fs";
import process from "node:process";
import { formatCommandReference } from "@optique/man/markdown";
import { referenceEntries, referenceOptions } from "./pages.ts";

writeFileSync(
  process.argv[2] ?? "REFERENCE.md",
  formatCommandReference(referenceEntries, referenceOptions),
);
