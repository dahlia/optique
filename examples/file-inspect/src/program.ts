import { message } from "@optique/core/message";
import type { ProgramHookContext } from "@optique/discover";
import manifest from "../package.json" with { type: "json" };
import { info } from "./commands/info.ts";
import { lines } from "./commands/lines.ts";
import { createInputScope, type InputScope } from "./input.ts";

/**
 * Builds static registration and hooks without executing the application.
 * @param options Optional scope factory for embedding and in-process tests.
 * @returns Program options; handlers receive only program-level resources.
 */
export function createFileProgram(options: {
  readonly createScope?: () => InputScope;
} = {}) {
  const close = (context: ProgramHookContext<InputScope>) =>
    context.resource?.close();
  return {
    commands: [info, lines],
    metadata: {
      name: "file-inspect",
      version: manifest.version,
      brief: message`Inspect local files without changing them.`,
    },
    hooks: {
      beforeEach() {
        return { resource: (options.createScope ?? createInputScope)() };
      },
      afterEach: close,
      onError: close,
    },
  };
}
