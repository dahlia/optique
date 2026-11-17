import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
import { createSourceResolver, loadMembers } from "./source-resolver.mjs";
import { Temporal } from "@js-temporal/polyfill";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sourceURL = createSourceResolver(root, loadMembers(root));
registerHooks({
  resolve(specifier, context, nextResolve) {
    const url = sourceURL(specifier, context.parentURL);
    return url ? { url, shortCircuit: true } : nextResolve(specifier, context);
  },
});

// The coverage preload alone supplies Temporal. Tests may unset or replace it.
Object.defineProperty(globalThis, "Temporal", {
  value: Temporal,
  writable: true,
  configurable: true,
  enumerable: true,
});
