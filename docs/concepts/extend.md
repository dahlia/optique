Extending Optique with runtime context
======================================

This guide explains how to extend Optique parsers with runtime context.
Optique provides two complementary systems for this purpose:

 -  *Annotations*: A low-level primitive for passing runtime data to parsers
 -  *Source context*: A high-level system for composing multiple data sources
    with automatic priority handling

Together, these systems enable advanced use cases like config file fallbacks,
environment variable integration, and shared context across parsers.


Introduction
------------

Optique parsers typically operate in isolation, processing only command-line
arguments. However, real-world CLI applications often need access to external
runtime data that is not part of the command-line arguments:

 -  *Configuration files*: A parser might fall back to values from a config
    file whose path is determined by another option
 -  *Environment variables*: Options might have defaults from environment
    variables (e.g., `MYAPP_HOST` for `--host`)
 -  *Shared context*: Multiple parsers might need access to common runtime
    data such as user preferences or locale settings

The challenge is that this external data often becomes available only during
parsing (for example, the config file path is only known after parsing
`--config`), but parsers need access to it during their execution.

Optique solves this with two systems:

 -  Use *annotations* when you need direct, low-level control over how runtime
    data flows through parsers
 -  Use *source context* and `runWith()` when you need to compose multiple data
    sources with clear priority ordering


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

Annotations are passed to parsing functions via the `ParseOptions` parameter.
The third argument to `parse()` accepts an `annotations` object where each key
is a symbol and each value is the data you want to make available during
parsing:

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

In this example, we attach a `configData` object containing default values.
Custom parsers can later retrieve this data and use it as a fallback when
command-line arguments are not provided.

### Accessing annotations

Inside a parser, you can retrieve annotations using the `getAnnotations()`
helper function. This function extracts the annotations object from the parser
state, which is passed to the parser's `parse()` and `complete()` methods:

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

The function returns `undefined` if no annotations were provided, so always
use optional chaining (`?.`) when accessing annotation data. Since annotations
are typed as `unknown`, you need to cast them to your expected type.


Creating custom parsers with annotations
----------------------------------------

Custom parsers can access annotations during both `parse()` and `complete()`
phases. The `complete()` phase is particularly useful for annotations because
it runs after all command-line arguments have been processed, allowing you to
provide fallback values for missing options.

The following example creates a `configOption()` function that returns a parser
looking up values from a configuration object passed via annotations. If the
user doesn't provide the option on the command line, the parser falls back to
the config file value:

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

The key insight here is that `complete()` receives the accumulated parser state,
which includes any annotations passed to `parse()`. By calling
`getAnnotations(state)`, the parser can access the configuration data and use
it as a fallback. The `required` parameter controls whether a missing value
(both from CLI and config) should be treated as an error.


Use cases
---------

### Config file fallback pattern

A common pattern is *two-pass parsing*: first parse to extract the config file
path, then parse again with the loaded config data as annotations. This is
necessary because the config file path itself comes from command-line arguments,
creating a chicken-and-egg problem that two-pass parsing solves.

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

The first pass extracts just the `--config` option to determine which file to
load. After loading the config file, the second pass runs with the full parser,
now with config data available via annotations. Custom parsers for `--name` and
`--port` can then fall back to config values when the user doesn't provide them
on the command line.

### Environment-based validation

Annotations can provide runtime context that affects validation behavior. For
example, you might want stricter validation in production but more permissive
rules during development:

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

The caller passes environment information via annotations, and the validator
adapts its behavior accordingly. This keeps the validation logic decoupled from
how the environment is determined.

### Shared context across parsers

When building complex CLI applications with multiple subcommands or composed
parsers, you often need to share common data across all of them. Annotations
provide a clean way to inject this shared context once at the top level:

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

Any parser in the tree can access this shared context without explicit parameter
passing. This is particularly useful for feature flags, user session data, or
API configuration that many parts of your CLI might need.


Type safety
-----------

Since annotations are stored as `Record<symbol, unknown>`, you need to cast
them to your expected types when accessing. Define interfaces for your
annotation data and use type assertions:

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

The `as ConfigData | undefined` cast tells TypeScript what shape to expect.
Always include `undefined` in the union since the annotation might not be
present.

For better type safety and to avoid repeating the cast, create a typed helper
function:

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

Annotations enable validators that adapt to runtime conditions. This example
shows a port validator that enforces different rules based on the deployment
environment. In production, only specific whitelisted ports are allowed, while
development mode is more permissive:

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

The validator first checks for basic validity (is it a number?), then applies
environment-specific rules if available. When no environment data is provided,
it falls back to accepting any valid port number. This graceful degradation
ensures the validator works both with and without annotations.

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

### Types and symbols from `@optique/core/annotations`

`annotationKey`
:   Unique symbol for storing annotations in parser state. Use this symbol to
    access the raw annotations object from state if needed.

`Annotations`
:   Type alias for `Record<symbol, unknown>`. Represents the annotation data
    structure where each key is a symbol and each value can be any type.

`ParseOptions`
:   Interface containing options for parse functions. Currently has one field:
    `annotations?: Annotations`.

### Types from `@optique/core/context`

`SourceContext`
:   Interface for data sources that provide annotations. Has two members:

     -  `id: symbol` - Unique identifier for the context
     -  `getAnnotations(parsed?: unknown): Promise<Annotations> | Annotations` -
        Returns annotations to inject into parsing

### Functions from `@optique/core/annotations`

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

`isStaticContext(context: SourceContext): boolean`
:   Checks whether a context is static (returns non-empty annotations without
    needing parsed results).

### Functions from `@optique/core/facade`

`runWith(parser, programName, contexts, options?): Promise<T>`
:   Runs a parser with multiple source contexts. Automatically handles
    static and dynamic contexts with two-phase parsing when needed.

`runWithSync(parser, programName, contexts, options?): T`
:   Synchronous variant of `runWith()`. All contexts must return annotations
    synchronously (not Promises).

`runWithAsync(parser, programName, contexts, options?): Promise<T>`
:   Explicit async variant of `runWith()`. Equivalent to `runWith()`.


The source context system
-------------------------

While annotations provide low-level control, the *source context* system offers
a higher-level abstraction for composing multiple data sources. This is
particularly useful when you need to implement priority-based fallback chains
like CLI > environment variables > configuration file > default values.

### What is a source context?

A `SourceContext` is an interface that represents a data source capable of
providing annotations to parsers. Each context has:

 -  A unique `id` symbol for identification
 -  A `getAnnotations()` method that returns annotations

Here's a simple context that provides environment variables to parsers:

~~~~ typescript
import type { SourceContext } from "@optique/core/context";

const envContext: SourceContext = {
  id: Symbol.for("@myapp/env"),
  getAnnotations() {
    return {
      [Symbol.for("@myapp/env")]: {
        HOST: process.env.MYAPP_HOST,
        PORT: process.env.MYAPP_PORT,
      }
    };
  }
};
~~~~

The `id` symbol identifies this context for debugging and priority resolution.
The `getAnnotations()` method returns an object mapping annotation keys to
their values. Parsers can then access these values using `getAnnotations()`.

### Static vs dynamic contexts

Contexts can be either *static* or *dynamic*:

 -  *Static contexts* return data immediately (e.g., environment variables)
 -  *Dynamic contexts* need parsing results first (e.g., config files whose
    path is determined by a CLI option)

The difference lies in whether `getAnnotations()` needs the parsed result to
do its work:

~~~~ typescript
import type { SourceContext } from "@optique/core/context";

// Static context: data is always available
const envContext: SourceContext = {
  id: Symbol.for("@myapp/env"),
  getAnnotations() {
    // Returns immediately - no need for parsing results
    return {
      [Symbol.for("@myapp/env")]: process.env
    };
  }
};

// Dynamic context: needs parsed result to load config
const configContext: SourceContext = {
  id: Symbol.for("@myapp/config"),
  async getAnnotations(parsed?: unknown) {
    if (!parsed) return {}; // Return empty on first pass
    
    const result = parsed as { config?: string };
    if (!result.config) return {};
    
    // Load config file asynchronously
    const data = await loadConfigFile(result.config);
    return {
      [Symbol.for("@myapp/config")]: data
    };
  }
};
~~~~

The static `envContext` reads environment variables directly and doesn't need
any parsed values. The dynamic `configContext`, however, needs to know the
config file path from the parsed `--config` option before it can load the file.
When `parsed` is `undefined` (first pass), it returns an empty object.


Using `runWith()`
-----------------

The `runWith()` function orchestrates multiple source contexts with automatic
priority handling and smart two-phase parsing.

### Basic usage

The `runWith()` function takes a parser, program name, array of contexts, and
options. It automatically collects annotations from all contexts, merges them
with proper priority handling, and runs the parser:

~~~~ typescript
import { runWith } from "@optique/core/facade";
import { object } from "@optique/core/constructs";
import { option, argument } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { withDefault } from "@optique/core/modifiers";
import type { SourceContext } from "@optique/core/context";

const envContext: SourceContext = {
  id: Symbol.for("@myapp/env"),
  getAnnotations() {
    return {
      [Symbol.for("@myapp/env")]: {
        HOST: process.env.MYAPP_HOST ?? "localhost",
      }
    };
  }
};

const parser = object({
  host: withDefault(option("--host", string()), "localhost"),
  name: argument(string()),
});

const result = await runWith(parser, "myapp", [envContext], {
  args: process.argv.slice(2),
  help: { mode: "option" },
  version: { mode: "option", value: "1.0.0" },
});
~~~~

The function handles all the complexity of collecting annotations from multiple
sources and injecting them into the parsing process. It also supports the same
help and version options as `runParser()`.

### Priority handling

When using multiple contexts, *earlier contexts have priority over later ones*.
This allows you to implement fallback chains naturally:

~~~~ typescript
// Priority: envContext > configContext
// Environment variables override config file values
const result = await runWith(
  parser,
  "myapp",
  [envContext, configContext],  // env has higher priority
  { args: process.argv.slice(2) }
);
~~~~

### Two-phase parsing

When dynamic contexts are present, `runWith()` automatically performs two-phase
parsing:

1.  *Phase 1*: Parse with static context data to get initial result
2.  *Phase 2*: Call `getAnnotations(parsed)` on all contexts with the parsed
    result, then parse again with merged annotations

This ensures that:

 -  Static contexts (like environment variables) are available immediately
 -  Dynamic contexts (like config files) can extract information from the
    first parse pass

### Sync and async variants

Three function variants are available:

`runWith()`
:   Always returns a Promise. Handles both sync and async contexts.

`runWithSync()`
:   Returns the result directly. All contexts must be synchronous.

`runWithAsync()`
:   Same as `runWith()`. Explicit async variant for clarity.

~~~~ typescript
import { runWith, runWithSync, runWithAsync } from "@optique/core/facade";

// Async (recommended for most cases)
const result1 = await runWith(parser, "myapp", contexts, options);

// Sync (only for sync contexts and parsers)
const result2 = runWithSync(parser, "myapp", syncContexts, options);

// Explicit async
const result3 = await runWithAsync(parser, "myapp", contexts, options);
~~~~


Building custom source contexts
-------------------------------

### Creating a simple environment context

A reusable environment context can be created with a factory function that
accepts a prefix. This pattern allows different applications to use their own
environment variable naming conventions:

~~~~ typescript
import type { SourceContext, Annotations } from "@optique/core/context";

const envKey = Symbol.for("@myapp/env");

interface EnvData {
  readonly HOST?: string;
  readonly PORT?: string;
  readonly DEBUG?: string;
}

export function createEnvContext(prefix: string = ""): SourceContext {
  return {
    id: envKey,
    getAnnotations(): Annotations {
      const data: EnvData = {
        HOST: process.env[`${prefix}HOST`],
        PORT: process.env[`${prefix}PORT`],
        DEBUG: process.env[`${prefix}DEBUG`],
      };
      return { [envKey]: data };
    }
  };
}

// Usage
const envContext = createEnvContext("MYAPP_");
~~~~

When called with `"MYAPP_"`, the context reads `MYAPP_HOST`, `MYAPP_PORT`, and
`MYAPP_DEBUG` from the environment. This is a static context since it doesn't
need any parsed values.

### Creating a config file context

A config file context is dynamic because it needs to know the file path from
parsed arguments. The `getAnnotations()` method receives the parsed result and
uses it to load the configuration:

~~~~ typescript
import type { SourceContext, Annotations } from "@optique/core/context";

const configKey = Symbol.for("@myapp/config");

interface ConfigData {
  readonly host?: string;
  readonly port?: number;
  readonly debug?: boolean;
}

export function createConfigContext(): SourceContext {
  return {
    id: configKey,
    async getAnnotations(parsed?: unknown): Promise<Annotations> {
      if (!parsed) return {}; // First pass - no config yet
      
      const result = parsed as { config?: string };
      if (!result.config) return {}; // No config file specified
      
      try {
        const content = await Deno.readTextFile(result.config);
        const data: ConfigData = JSON.parse(content);
        return { [configKey]: data };
      } catch {
        return {}; // Config file not found or invalid
      }
    }
  };
}

// Usage
const configContext = createConfigContext();
~~~~

Note the defensive checks: when `parsed` is `undefined` (first pass), return
empty. When the user didn't specify `--config`, return empty. When the file
can't be read or parsed, return empty. This ensures the context never throws
and gracefully degrades when config isn't available.

### Best practices for custom contexts

 -  *Use unique symbols*: Always use `Symbol.for()` with a namespaced string
    matching your package name
 -  *Handle missing data gracefully*: Return empty objects instead of throwing
    errors
 -  *Keep contexts focused*: Each context should handle one data source
 -  *Document the annotation key*: Make it clear what data your context provides


Limitations and considerations
------------------------------

### Low-level API only

Annotations are only available in low-level parsing functions:

 -  ✅ Available: `parse()`, `parseSync()`, `parseAsync()`
 -  ✅ Available via contexts: `runWith()`, `runWithSync()`, `runWithAsync()`
 -  ❌ Not directly available: `runParser()`, `run()` from *@optique/run*

This is intentional. Annotations are a low-level primitive for building
advanced parsers. For high-level usage, use the SourceContext system with
`runWith()`.

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

For `runWith()` with dynamic contexts, two parse passes are performed. This
is necessary for the two-phase approach but doubles the parsing overhead.
For performance-critical applications:

 -  Use only static contexts when possible (single pass)
 -  Cache parsed results rather than re-parsing multiple times
 -  Consider using `runWithSync()` for sync-only contexts to avoid Promise
    overhead
