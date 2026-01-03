/**
 * Async Validation Pattern
 *
 * Demonstrates how to create async value parsers for scenarios requiring
 * I/O operations like API validation, DNS lookups, or file checks.
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
import { runAsync } from "@optique/run";

/**
 * Async value parser that validates a URL is reachable.
 */
function reachableUrl(): ValueParser<"async", URL> {
  return {
    $mode: "async",
    metavar: "URL",
    async parse(input: string): Promise<ValueParserResult<URL>> {
      // First validate URL format
      let url: URL;
      try {
        url = new URL(input);
      } catch {
        return {
          success: false,
          error: message`Invalid URL format: ${input}.`,
        };
      }

      // Then check if the URL is reachable
      try {
        const response = await fetch(url, { method: "HEAD" });
        if (!response.ok) {
          return {
            success: false,
            error: message`URL returned status ${response.status.toString()}.`,
          };
        }
      } catch {
        return {
          success: false,
          error:
            message`Could not reach URL ${input}. Check network connection or DNS resolution.`,
        };
      }

      return { success: true, value: url };
    },
    format(value: URL): string {
      return value.toString();
    },
  };
}

/**
 * Async value parser that validates an API key against a remote service.
 */
function apiKey(validationEndpoint: string): ValueParser<"async", string> {
  return {
    $mode: "async",
    metavar: "API_KEY",
    async parse(input: string): Promise<ValueParserResult<string>> {
      // Basic format validation
      if (input.length < 16) {
        return {
          success: false,
          error: message`API key must be at least 16 characters.`,
        };
      }

      // Validate against remote service
      try {
        const response = await fetch(validationEndpoint, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${input}`,
            "Content-Type": "application/json",
          },
        });

        if (response.status === 401) {
          return {
            success: false,
            error: message`Invalid API key.`,
          };
        }

        if (!response.ok) {
          return {
            success: false,
            error:
              message`API validation failed with status ${response.status.toString()}.`,
          };
        }
      } catch {
        return {
          success: false,
          error:
            message`Could not validate API key. Check your network connection.`,
        };
      }

      return { success: true, value: input };
    },
    format(value: string): string {
      // Mask the API key for display
      return value.slice(0, 4) + "..." + value.slice(-4);
    },
  };
}

// Example: A CLI tool that validates both endpoint URL and API key
const parser = object({
  endpoint: option("--endpoint", "-e", reachableUrl(), {
    description: message`The API endpoint URL (must be reachable).`,
  }),
  key: optional(
    option("--api-key", "-k", apiKey("https://api.example.com/validate"), {
      description: message`Your API key for authentication.`,
    }),
  ),
  name: optional(
    option("--name", "-n", string(), {
      description: message`Optional display name.`,
    }),
  ),
});

// Use runAsync() for parsers containing async value parsers
const config = await runAsync(parser, {
  help: "option",
});

console.log(`Connecting to: ${config.endpoint.toString()}`);
if (config.key) {
  console.log(`Authenticated with key: ${config.key.slice(0, 4)}...`);
}
if (config.name) {
  console.log(`Display name: ${config.name}`);
}
