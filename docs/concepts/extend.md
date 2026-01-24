Extending Optique with runtime context
======================================

This guide explains how to extend Optique parsers with runtime context using
the annotations system. This enables advanced use cases like config file
fallbacks, environment-based validation, and shared context across parsers.


Introduction
------------

Optique parsers typically operate in isolation, processing only command-line
arguments. However, real-world CLI applications often need access to external
runtime data that is not part of the command-line arguments:

 -  *Configuration files*: A parser might fall back to values from a config
    file whose path is determined by another option
 -  *Environment-based validation*: Value parsers might validate against
    external resources like databases, APIs, or filesystems
 -  *Shared context*: Multiple parsers might need access to common runtime
    data such as user preferences or locale settings

The challenge is that this external data often becomes available only during
parsing (for example, the config file path is only known after parsing
`--config`), but parsers need access to it during their execution.


The annotations system
----------------------

Optique's *annotations system* allows you to attach runtime data to a parsing
session. This data flows through the parser state and can be accessed during
both `parse()` and `complete()` phases.

### Key design principles

 -  *Non-invasive*: Fully backward compatible, existing parsers work unchanged
 -  *Symbol-keyed*: Packages use unique symbols to avoid naming conflicts
 -  *Type-safe*: Full TypeScript support for accessing typed annotation data
 -  *Opt-in*: Only parsers that need annotations access them
 -  *Low-level primitive*: Exposed only in low-level APIs (`parse()`,
    `parseSync()`, `parseAsync()`), not in high-level APIs like `runParser()`
    or `run()`


Basic usage
-----------

### Defining annotation keys

Each package should define its own annotation key using a unique symbol:

~~~~ typescript
// In your package
const configDataKey = Symbol.for("@myapp/config");
~~~~

> [!TIP]
> Use the `Symbol.for()` constructor with a namespaced string to create
> globally unique symbols. The namespace should match your package name to
> avoid conflicts with other packages.

### Passing annotations

Annotations are passed to parsing functions via the `ParseOptions` parameter:

~~~~ typescript twoslash
import { parse } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const parser = option("--name", string());
const configDataKey = Symbol.for("@myapp/config");
const configData = { defaultName: "Alice" };

const result = parse(parser, ["--name", "Bob"], {
  annotations: {
    [configDataKey]: configData,
  },
});
~~~~

### Accessing annotations

Use the `getAnnotations()` helper function to extract annotations from parser
state:

~~~~ typescript twoslash
import { getAnnotations } from "@optique/core/annotations";

const configDataKey = Symbol.for("@myapp/config");
// ---cut-before---
function myCustomComplete(state: unknown) {
  const annotations = getAnnotations(state);
  const configData = annotations?.[configDataKey] as
    | { defaultName: string }
    | undefined;

  // Use config data for fallback values
  const name = configData?.defaultName ?? "Unknown";
  return { success: true, value: name };
}
~~~~


Creating custom parsers with annotations
----------------------------------------

Custom parsers can access annotations during both `parse()` and `complete()`
phases. Here's an example of a parser that falls back to config file values:

~~~~ typescript twoslash
import type { Parser } from "@optique/core/parser";
import { getAnnotations } from "@optique/core/annotations";
import { type Message, message } from "@optique/core/message";

const configDataKey = Symbol.for("@myapp/config");
// ---cut-before---
function configOption(
  name: string,
  configKey: string,
  required: boolean = false,
): Parser<"sync", string | undefined> {
  return {
    $valueType: [] as const,
    $stateType: [] as const,
    $mode: "sync",
    priority: 0,
    usage: [],
    initialState: undefined,

    parse: (context) => ({
      success: true,
      next: { ...context, buffer: [] },
      consumed: [],
    }),

    complete: (state) => {
      // Try to get value from annotations
      const annotations = getAnnotations(state);
      const configData = annotations?.[configDataKey] as
        | Record<string, string>
        | undefined;

      const value = configData?.[configKey];

      if (value === undefined && required) {
        return {
          success: false,
          error: message`Missing required option ${name} and no config fallback.`,
        };
      }

      return { success: true, value };
    },

    suggest: () => [],
    getDocFragments: () => ({ fragments: [] }),
  };
}
~~~~


Use cases
---------

### Config file fallback pattern

A common pattern is to perform two-pass parsing: first to extract the config
file path, then again with the loaded config data as annotations:

~~~~ typescript twoslash
import { parse } from "@optique/core/parser";
import { object } from "@optique/core/constructs";
import { option, argument } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { optional } from "@optique/core/modifiers";

const configDataKey = Symbol.for("@myapp/config");
// Placeholder for config loading function
declare function loadConfig(path: string): Promise<Record<string, unknown>>;
// ---cut-before---
// First pass: extract config path
const firstPassParser = object({
  config: optional(option("--config", string())),
  // ... other options
});

const firstResult = parse(firstPassParser, process.argv.slice(2));

if (!firstResult.success) {
  console.error(firstResult.error);
  process.exit(1);
}

// Load config file if provided
const configData = firstResult.value.config
  ? await loadConfig(firstResult.value.config)
  : {};

// Second pass: parse with config annotations
const finalParser = object({
  config: optional(option("--config", string())),
  name: option("--name", string()),
  port: option("--port", string()),
});

const finalResult = parse(finalParser, process.argv.slice(2), {
  annotations: {
    [configDataKey]: configData,
  },
});
~~~~

### Environment-based validation

Annotations can provide runtime context for validation:

~~~~ typescript twoslash
import { getAnnotations } from "@optique/core/annotations";

const envKey = Symbol.for("@myapp/env");
const isDevelopment = true;
// ---cut-before---
// Custom validator that checks against environment
function createEnvironmentValidator() {
  return {
    // ... parser implementation
    complete: (state: unknown) => {
      const annotations = getAnnotations(state);
      const env = annotations?.[envKey] as { isDevelopment: boolean } | undefined;

      // Different validation rules based on environment
      if (env?.isDevelopment) {
        // Allow more permissive values in development
        return { success: true, value: "debug" };
      } else {
        // Stricter validation in production
        return { success: true, value: "error" };
      }
    },
  };
}
~~~~

### Shared context across parsers

Multiple parsers can share common runtime data through annotations:

~~~~ typescript twoslash
import { parse } from "@optique/core/parser";
import { object } from "@optique/core/constructs";
import { constant } from "@optique/core/primitives";

const contextKey = Symbol.for("@myapp/context");

const parser = object({
  cmd: constant("test"),
});
// ---cut-before---
const sharedContext = {
  userId: "user123",
  apiUrl: "https://api.example.com",
  features: ["feature-a", "feature-b"],
};

const result = parse(parser, process.argv.slice(2), {
  annotations: {
    [contextKey]: sharedContext,
    // Multiple packages can add their own keys here
  },
});
~~~~


Type safety
-----------

TypeScript provides full type safety when working with annotations:

~~~~ typescript twoslash
import { getAnnotations } from "@optique/core/annotations";

// Define typed annotation key
const configKey = Symbol.for("@myapp/config");

interface ConfigData {
  readonly apiUrl: string;
  readonly timeout: number;
  readonly retries?: number;
}

// ---cut-before---
function parseWithConfig(state: unknown) {
  const annotations = getAnnotations(state);

  // Type assertion for your specific data
  const config = annotations?.[configKey] as ConfigData | undefined;

  if (config) {
    // TypeScript knows the shape of config
    const url: string = config.apiUrl;
    const timeout: number = config.timeout;
    const retries: number | undefined = config.retries;
  }
}
~~~~

For better type safety, you can create a typed helper function:

~~~~ typescript twoslash
import { getAnnotations, type Annotations } from "@optique/core/annotations";

const configKey = Symbol.for("@myapp/config");

interface ConfigData {
  readonly apiUrl: string;
  readonly timeout: number;
}

// ---cut-before---
function getConfigAnnotation(state: unknown): ConfigData | undefined {
  const annotations = getAnnotations(state);
  return annotations?.[configKey] as ConfigData | undefined;
}

// Usage in parser
function myParser(state: unknown) {
  const config = getConfigAnnotation(state);
  // config is typed as ConfigData | undefined
}
~~~~


Best practices
--------------

### Annotation key naming

Use the `Symbol.for()` constructor with a namespaced string that matches your
package name:

~~~~ typescript
// Good: package-namespaced
const myKey = Symbol.for("@myapp/config");
const dataKey = Symbol.for("@mycompany/user-data");

// Avoid: generic names that might conflict
const key = Symbol.for("config");
const data = Symbol.for("data");
~~~~

### Type definitions

Define clear TypeScript interfaces for your annotation data:

~~~~ typescript
// Define the shape of your annotation data
interface MyAppConfig {
  readonly apiUrl: string;
  readonly timeout: number;
  readonly retries?: number;
}

// Export the key and type together
export const configKey = Symbol.for("@myapp/config");
export type { MyAppConfig };
~~~~

### Error handling

Always handle the case where annotations might not be present:

~~~~ typescript twoslash
import { getAnnotations } from "@optique/core/annotations";

const configKey = Symbol.for("@myapp/config");

interface ConfigData {
  defaultValue: string;
}
// ---cut-before---
function safelyAccessAnnotations(state: unknown) {
  const annotations = getAnnotations(state);

  if (!annotations) {
    // No annotations provided - use sensible defaults
    return "default";
  }

  const config = annotations[configKey] as ConfigData | undefined;

  if (!config) {
    // Annotation key not present - use fallback
    return "fallback";
  }

  // Safe to use config data
  return config.defaultValue;
}
~~~~

### Documentation

Document that your parsers use annotations and which annotation keys they
expect:

~~~~ typescript
/**
 * Creates a parser that validates against API endpoints.
 *
 * This parser requires runtime context via annotations:
 * - `@myapp/api-client`: An API client instance for validation
 *
 * @example
 * ```typescript
 * import { parse } from "@optique/core/parser";
 *
 * const apiKey = Symbol.for("@myapp/api-client");
 * const result = parse(myParser, args, {
 *   annotations: { [apiKey]: apiClient }
 * });
 * ```
 */
export function createApiParser() {
  // ...
}
~~~~


Advanced patterns
-----------------

### Two-pass parsing

The most common pattern is two-pass parsing for config file loading:

~~~~ typescript twoslash
import { parse } from "@optique/core/parser";
import { object } from "@optique/core/constructs";
import { option, argument } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";
import { optional, withDefault } from "@optique/core/modifiers";

declare function loadConfigFile(path: string): Promise<{
  host?: string;
  port?: number;
}>;

const configKey = Symbol.for("@myapp/config");
// ---cut-before---
// Define the main parser
const parser = object({
  config: optional(option("--config", string())),
  host: withDefault(option("--host", string()), "localhost"),
  port: withDefault(option("--port", integer()), 3000),
  input: argument(string()),
});

// First pass: extract config path
const firstPass = parse(parser, process.argv.slice(2));

if (!firstPass.success) {
  console.error(firstPass.error);
  process.exit(1);
}

// Load config file if specified
const configData = firstPass.value.config
  ? await loadConfigFile(firstPass.value.config)
  : {};

// Second pass: parse with config annotations
// CLI args override config file values
const finalResult = parse(parser, process.argv.slice(2), {
  annotations: {
    [configKey]: configData,
  },
});

if (!finalResult.success) {
  console.error(finalResult.error);
  process.exit(1);
}

// finalResult.value contains merged CLI + config values
console.log(`Connecting to ${finalResult.value.host}:${finalResult.value.port}`);
~~~~

### Conditional validation based on runtime state

Annotations enable validators that adapt to runtime conditions:

~~~~ typescript twoslash
import type { ValueParser } from "@optique/core/valueparser";
import { getAnnotations } from "@optique/core/annotations";
import { message } from "@optique/core/message";

const envKey = Symbol.for("@myapp/env");

interface EnvironmentData {
  readonly mode: "development" | "production";
  readonly allowedPorts: readonly number[];
}

// ---cut-before---
function portValidator(): ValueParser<"sync", number> {
  return {
    $mode: "sync",
    metavar: "PORT",

    // Validation using runtime environment data from annotations
    parse: (input: string, state?: unknown) => {
      const port = parseInt(input, 10);
      if (isNaN(port)) {
        return { success: false, error: message`Invalid port number.` };
      }

      const annotations = getAnnotations(state);
      const env = annotations?.[envKey] as EnvironmentData | undefined;

      if (!env) {
        // No environment data - allow any valid port
        return port >= 1 && port <= 65535
          ? { success: true, value: port }
          : { success: false, error: message`Port must be between 1 and 65535.` };
      }

      // Validate against environment-specific allowed ports
      if (!env.allowedPorts.includes(port)) {
        return {
          success: false,
          error: message`Port ${String(port)} is not allowed in ${env.mode} mode.`,
        };
      }

      return { success: true, value: port };
    },

    format: (port: number) => port.toString(),
  };
}
~~~~

### Multiple annotation sources

Different packages can use different annotation keys simultaneously:

~~~~ typescript twoslash
import { parse } from "@optique/core/parser";
import { constant } from "@optique/core/primitives";

const configKey = Symbol.for("@myapp/config");
const userKey = Symbol.for("@myapp/user");
const featureKey = Symbol.for("@myapp/features");

const parser = constant("test");
// ---cut-before---
const result = parse(parser, process.argv.slice(2), {
  annotations: {
    [configKey]: { apiUrl: "https://api.example.com" },
    [userKey]: { id: "user123", name: "Alice" },
    [featureKey]: { experimental: true },
  },
});
~~~~

Each package can independently access its own annotation data without
interfering with others.


API reference
-------------

### Types and symbols

`annotationKey`
:   Unique symbol for storing annotations in parser state. Use this symbol to
    access the raw annotations object from state if needed.

`Annotations`
:   Type alias for `Record<symbol, unknown>`. Represents the annotation data
    structure where each key is a symbol and each value can be any type.

`ParseOptions`
:   Interface containing options for parse functions. Currently has one field:
    `annotations?: Annotations`.

### Functions

`getAnnotations(state: unknown): Annotations | undefined`
:   Extracts annotations from parser state. Returns `undefined` if the state
    does not contain annotations or if the state is not an object.

    ~~~~ typescript twoslash
    import { getAnnotations } from "@optique/core/annotations";

    const myKey = Symbol.for("@myapp/data");
    declare const state: unknown;
    // ---cut-before---
    const annotations = getAnnotations(state);
    const myData = annotations?.[myKey];
    ~~~~

### Updated function signatures

The following functions now accept an optional `ParseOptions` parameter:

 -  `parse(parser, args, options?)`
 -  `parseSync(parser, args, options?)`
 -  `parseAsync(parser, args, options?)`
 -  `suggest(parser, args, options?)`
 -  `suggestSync(parser, args, options?)`
 -  `suggestAsync(parser, args, options?)`
 -  `getDocPage(parser, args?, options?)`
 -  `getDocPageSync(parser, args?, options?)`
 -  `getDocPageAsync(parser, args?, options?)`

All existing code continues to work as the `options` parameter is optional.


Limitations and considerations
------------------------------

### Low-level API only

Annotations are only available in low-level parsing functions:

 -  ✅ Available: `parse()`, `parseSync()`, `parseAsync()`
 -  ❌ Not available: `runParser()`, `run()` from *@optique/run*

This is intentional. Annotations are a low-level primitive for building
advanced parsers. High-level APIs remain simple and focused on common use
cases.

### State immutability

Annotations are injected into the initial state and should be treated as
read-only. Do not modify annotation data during parsing:

~~~~ typescript
// Good: read-only access
const annotations = getAnnotations(state);
const value = annotations?.[myKey];

// Bad: modifying annotations (undefined behavior)
const annotations = getAnnotations(state);
if (annotations) {
  annotations[myKey] = newValue; // Don't do this
}
~~~~

### Performance considerations

Annotation injection creates a shallow copy of the initial state. This has
minimal performance impact, but be aware that it happens on every call to
`parse()`, `suggest()`, or `getDocPage()` when annotations are provided.

For performance-critical applications, consider caching parsed results rather
than re-parsing with annotations multiple times.
