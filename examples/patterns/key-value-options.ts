/**
 * Key-Value Options Pattern
 *
 * Demonstrates how to parse key=value pairs commonly used in CLI tools
 * like Docker (-e KEY=VALUE) or Kubernetes (--set key=value).
 */
import { multiple, object, option, or } from "@optique/core/parser";
import { message, text } from "@optique/core/message";
import {
  type ValueParser,
  type ValueParserResult,
} from "@optique/core/valueparser";
import { print, run } from "@optique/run";

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
  env: multiple(option("-e", "--env", keyValue())),
  labels: multiple(option("-l", "--label", keyValue(":"))),
});

// Kubernetes-style configuration
const k8sParser = object({
  set: multiple(option("--set", keyValue())),
  values: multiple(option("--values", keyValue(":"))),
});

const parser = or(dockerParser, k8sParser);

const config = run(parser);

if ("env" in config) {
  const envObject = Object.fromEntries(config.env);
  const labelObject = Object.fromEntries(config.labels);
  print(message`Environment: ${JSON.stringify(envObject, null, 2)}`);
  print(message`Labels: ${JSON.stringify(labelObject, null, 2)}`);
} else {
  const setObject = Object.fromEntries(config.set);
  const valuesObject = Object.fromEntries(config.values);
  print(message`Set: ${JSON.stringify(setObject, null, 2)}`);
  print(message`Values: ${JSON.stringify(valuesObject, null, 2)}`);
}
