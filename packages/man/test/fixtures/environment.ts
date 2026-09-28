import type { DocEntry } from "@optique/core/doc";
import { constant } from "@optique/core/primitives";
import { defineProgram } from "@optique/core/program";

const entry: DocEntry = {
  term: { type: "option", names: ["--name"] },
  envVars: ["APP_NAME"],
};
export const parser = {
  ...constant("unused"),
  getDocFragments: () => ({
    fragments: [{ type: "entry" as const, ...entry }],
  }),
};
export default defineProgram({ parser, metadata: { name: "env-example" } });
