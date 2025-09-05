/**
 * Key-Value Options Pattern
 *
 * Demonstrates how to parse key=value pairs commonly used in CLI tools
 * like Docker (-e KEY=VALUE) or Kubernetes (--set key=value).
 */
import { map, multiple, object, option, or } from "@optique/core/parser";
import { message, text } from "@optique/core/message";
import {
  type ValueParser,
  type ValueParserResult,
} from "@optique/core/valueparser";
import { run } from "@optique/run";

/**
 * Custom value parser for key-value pairs with configurable separator
 */
function keyValue(separator = "="): ValueParser<[string, string]> {
  return {
    metavar: `KEY${separator}VALUE`,
    parse(input: string): ValueParserResult<[string, string]> {
      const index = input.indexOf(separator);
      if (index === -1 || index === 0) {
        return {
          success: false,
          error: message`Invalid format. Expected KEY${
            text(separator)
          }VALUE, got ${input}`,
        };
      }
      const key = input.slice(0, index);
      const value = input.slice(index + separator.length);
      return { success: true, value: [key, value] };
    },
    format([key, value]: [string, string]): string {
      return `${key}${separator}${value}`;
    },
  };
}

// Docker-style environment variables
const dockerParser = object({
  env: map(
    multiple(option("-e", "--env", keyValue())),
    (pairs) => Object.fromEntries(pairs),
  ),
  labels: map(
    multiple(option("-l", "--label", keyValue(":"))),
    (pairs) => Object.fromEntries(pairs),
  ),
});

// Kubernetes-style configuration
const k8sParser = object({
  set: map(
    multiple(option("--set", keyValue())),
    (pairs) => Object.fromEntries(pairs),
  ),
  values: map(
    multiple(option("--values", keyValue(":"))),
    (pairs) => Object.fromEntries(pairs),
  ),
});

const parser = or(dockerParser, k8sParser);

const config = run(parser);

if ("env" in config) {
  // config.env and config.labels are now Record<string, string>
  console.log("Environment:", config.env);
  console.log("Labels:", config.labels);
} else {
  // config.set and config.values are now Record<string, string>
  console.log("Set:", config.set);
  console.log("Values:", config.values);
}
