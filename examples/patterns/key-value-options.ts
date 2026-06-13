/**
 * Key–value options pattern
 *
 * Demonstrates how to parse key=value pairs commonly used in CLI tools
 * like Docker (-e KEY=VALUE) or Kubernetes (--set key=value).
 */
import { object, or } from "@optique/core/constructs";
import { map, multiple } from "@optique/core/modifiers";
import { option } from "@optique/core/primitives";
import { keyValue } from "@optique/core/valueparser";
import { run } from "@optique/run";

// Docker-style environment variables
const dockerParser = object({
  env: map(
    multiple(option("-e", "--env", keyValue())),
    (pairs) => Object.fromEntries(pairs),
  ),
  labels: map(
    multiple(option("-l", "--label", keyValue({ separator: ":" }))),
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
    multiple(option("--values", keyValue({ separator: ":" }))),
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
