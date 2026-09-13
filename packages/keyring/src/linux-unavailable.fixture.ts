import assert from "node:assert/strict";
import { optional, withDefault } from "@optique/core/modifiers";
import { parseAsync } from "@optique/core/parser";
import { fail } from "@optique/core/primitives";
import { bindKeyring, createKeyringContext } from "#src/index.ts";

const context = createKeyringContext();
const annotations = await context.getAnnotations();
const parser = bindKeyring(fail<string>(), {
  context,
  service: "optique-test-unavailable-store",
  username: "optique-test-user",
});

for (
  const wrapped of [parser, optional(parser), withDefault(parser, "fallback")]
) {
  await assert.rejects(parseAsync(wrapped, [], { annotations }), {
    code: "ENOENT",
  });
}
