import { createInterface } from "node:readline/promises";
import type { Readable, Writable } from "node:stream";

/** The streams the question is asked on. */
export interface PromptStreams {
  readonly input: Readable;
  readonly output: Writable;
}

/**
 * Asks whether to replace an existing destination.
 *
 * Only `y` or `yes`, in any letter case, counts as consent.  Ending the input
 * without an answer, for example with Ctrl-D, declines instead of leaving the
 * question pending.
 *
 * @param output The destination path shown in the question.
 * @param streams Where to read the answer from and write the question to.
 * @returns Whether the user agreed to replace the destination.
 */
export async function confirmOverwrite(
  output: string,
  streams: PromptStreams,
): Promise<boolean> {
  const prompt = createInterface(streams);
  // Runtimes differ on whether question() settles when the input ends, so
  // treat the interface's close event as an empty answer:
  const closed = new Promise<string>((resolve) => {
    prompt.once("close", () => resolve(""));
  });
  try {
    const answer = await Promise.race([
      prompt.question(`Overwrite ${output}? [y/N] `).catch(() => ""),
      closed,
    ]);
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    prompt.close();
  }
}
