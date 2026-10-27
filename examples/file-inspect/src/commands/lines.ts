import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { argument } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { defineCommand, type ProgramHookContext } from "@optique/discover";
import type { InputScope } from "../input.ts";

/**
 * Counts LF delimiters and a final nonempty unterminated segment.
 * @param chunks Input bytes, without text decoding or buffering the whole file.
 * @returns The number of lines, including zero for empty input.
 * @throws Any error raised by the input iterator.
 */
export async function countLines(
  chunks: AsyncIterable<Uint8Array>,
): Promise<number> {
  let count = 0;
  let last = 10;
  for await (const chunk of chunks) {
    for (const byte of chunk) {
      if (byte === 10) count++;
      last = byte;
    }
  }
  return count + (last === 10 ? 0 : 1);
}

/** A statically registered file/stdin command with an inferred path value. */
export const lines = defineCommand({
  path: ["file", "lines"],
  metadata: { brief: message`Count lines from a file, or use - for stdin.` },
  parser: object({
    path: argument(string({ metavar: "PATH", pattern: /.+/s })),
  }),
  async handler(value, context?: ProgramHookContext<InputScope>) {
    const scope = context?.resource;
    if (scope == null) throw new TypeError("Input resource is missing.");
    const input = await scope.open(value.path);
    scope.write(String(await countLines(input.chunks())));
  },
});
