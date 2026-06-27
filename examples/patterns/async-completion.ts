/**
 * Async completion sources pattern
 *
 * Demonstrates how to create async value parsers that provide completion
 * suggestions from remote or I/O-backed sources.  This pattern is
 * appropriate for Docker tags, Kubernetes resources, GitHub issues, or
 * any candidate set that cannot be known at parser-construction time.
 *
 * Usage:
 *   deno run -A examples/patterns/async-completion.ts --tag latest
 *   deno run -A examples/patterns/async-completion.ts --help
 *   deno run -A examples/patterns/async-completion.ts completion bash
 */
import { object } from "@optique/core/constructs";
import { optional } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { message } from "@optique/core/message";
import { string } from "@optique/core/valueparser";
import {
  type ValueParser,
  type ValueParserResult,
} from "@optique/core/valueparser";
import type { Suggestion } from "@optique/core/parser";
import { runAsync } from "@optique/run";

// Stub data — replace with a real fetch() to a registry API in production.
const SAMPLE_TAGS: ReadonlyArray<{
  readonly tag: string;
  readonly digest: string;
}> = [
  { tag: "latest", digest: "sha256:abc123" },
  { tag: "1.25.0", digest: "sha256:def456" },
  { tag: "1.24.0", digest: "sha256:ghi789" },
  { tag: "1.23.4", digest: "sha256:jkl012" },
  { tag: "stable", digest: "sha256:mno345" },
];

/**
 * Async value parser that accepts a Docker image tag and provides
 * completion suggestions from a container registry.
 */
function imageTag(image: string): ValueParser<"async", string> {
  return {
    mode: "async",
    metavar: "TAG",
    placeholder: "latest",
    parse(input: string): Promise<ValueParserResult<string>> {
      if (!/^[\w][\w.-]{0,127}$/.test(input)) {
        return Promise.resolve({
          success: false,
          error: message`Invalid image tag: ${input}.`,
        });
      }
      return Promise.resolve({ success: true, value: input });
    },
    format(value: string): string {
      return value;
    },
    async *suggest(prefix: string): AsyncIterable<Suggestion> {
      try {
        // In production, replace SAMPLE_TAGS with a real registry API call:
        // const resp = await fetch(
        //   `https://hub.docker.com/v2/repositories/${image}/tags/`,
        // );
        // const data = await resp.json();
        // const items = data.results as { name: string; digest: string }[];
        const items = await Promise.resolve(SAMPLE_TAGS);
        for (const { tag, digest } of items) {
          if (!tag.startsWith(prefix)) continue;
          yield {
            kind: "literal",
            text: tag,
            description: message`Digest: ${digest}`,
          };
        }
      } catch (error) {
        // Swallow errors — completion is best-effort.  Log via your preferred
        // logger so the developer can diagnose without breaking the user session.
        console.error(`Tag suggestion failed for ${image}:`, error);
      }
    },
  };
}

const parser = object({
  tag: option("--tag", "-t", imageTag("library/nginx"), {
    description: message`The image tag to deploy.`,
  }),
  registry: optional(
    option("--registry", "-r", string({ metavar: "URL" }), {
      description: message`Override the default container registry.`,
    }),
  ),
});

// Use runAsync() for parsers that contain async value parsers.
// The completion: "both" option enables both subcommand and option-based
// completion script generation.
const config = await runAsync(parser, {
  completion: "both",
  help: "option",
});

console.log(`Deploying tag: ${config.tag}`);
if (config.registry) {
  console.log(`Using registry: ${config.registry}`);
}
