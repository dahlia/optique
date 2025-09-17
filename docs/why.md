---
description: >-
  Discover how Optique brings functional composition to TypeScript CLI
  development, enabling truly reusable parser components that other libraries
  can't match through configuration-based approaches.
---

Why Optique?
============

The TypeScript CLI ecosystem has come a long way from the early days of
commander.js. Today's libraries like Gunshi, Brocli, Cleye, and Deno Cliffy
all provide excellent type safety and developer-friendly APIs. Each has its
strengths: Gunshi offers declarative configurations with good type inference,
Brocli provides fluent option builders, and Cleye delivers strongly typed
parameters with automatic help generation.

Yet despite these advances, building complex CLI applications still feels like
assembling configurations rather than composing logic. You define options,
set up handlers, and coordinate between different command structures through
manual abstraction layers. Sharing common patterns requires copying
configuration objects or building helper functions that lose type information.

Optique takes a fundamentally different approach. Instead of configuring CLI
parsers, you compose them from small, reusable functions that naturally
combine while preserving full type information. This isn't just a different
API—it's a different way of thinking about CLI development that unlocks
possibilities other libraries simply can't achieve.


Complex option constraints made simple
---------------------------------------

To understand what makes Optique truly unique, consider a challenge that
stumps most CLI libraries: expressing complex relationships between option
groups. Imagine a deployment tool where certain options must be used together,
but different groups are mutually exclusive.

With traditional CLI libraries, you'd define all options individually and then
add runtime validation to check the relationships:

~~~~ typescript
// Traditional approach - validation scattered in business logic
const cli = require('some-cli-lib');

cli
  .option('--auth-token <token>')
  .option('--auth-key <key>')
  .option('--auth-secret <secret>')
  .option('--config-file <file>')
  .option('--config-host <host>')
  .option('--config-port <port>')
  .action((options) => {
    // Manual validation of complex relationships
    const hasAuthGroup = options.authToken && options.authKey && options.authSecret;
    const hasConfigGroup = options.configFile && options.configHost && options.configPort;

    if (!hasAuthGroup && !hasConfigGroup) {
      throw new Error('Must provide either auth options (token, key, secret) or config options (file, host, port)');
    }

    if (hasAuthGroup && hasConfigGroup) {
      throw new Error('Cannot use both auth and config options together');
    }

    // More validation...
  });
~~~~

This approach scatters constraint logic throughout your code, makes testing
difficult, and provides no compile-time guarantees about option relationships.

Optique's [`or()`](./concepts/constructs.md#or-parser) combinator lets you
express these constraints directly in the parser structure:

~~~~ typescript twoslash
import { object, or } from "@optique/core/parser";
import { constant, option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

const authOptions = object({
  mode: constant("auth"),
  token: option("--auth-token", string()),
  key: option("--auth-key", string()),
  secret: option("--auth-secret", string())
});

const configOptions = object({
  mode: constant("config"),
  file: option("--config-file", string()),
  host: option("--config-host", string()),
  port: option("--config-port", integer())
});

// Express complex constraints naturally
const deployParser = or(authOptions, configOptions);
//    ^?













// TypeScript automatically understands the relationship
~~~~

The constraints are embedded in the parser structure itself. You can't
accidentally use both auth and config options together—the parser simply
won't accept such input. The type system understands these relationships
and provides perfect autocompletion and error checking.

This scales to arbitrarily complex constraint patterns. Need three mutually
exclusive groups where each group requires multiple options? Just nest more
[`object()`](./concepts/constructs.md#object-parser) and `or()` combinators:

~~~~ typescript twoslash
import { object, or } from "@optique/core/parser";
import { constant, option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

const localDeploy = object({
  type: constant("local"),
  path: option("--path", string()),
  port: option("--port", integer())
});

const remoteDeploy = object({
  type: constant("remote"),
  host: option("--host", string()),
  user: option("--user", string()),
  key: option("--ssh-key", string())
});

const cloudDeploy = object({
  type: constant("cloud"),
  provider: option("--provider", string()),
  region: option("--region", string()),
  credentials: option("--credentials", string())
});

const deploymentStrategy = or(localDeploy, remoteDeploy, cloudDeploy);
//    ^?

















// Each option group is self-contained and mutually exclusive
~~~~

Try expressing this with configuration-based libraries and you'll quickly
find yourself writing complex validation functions. With Optique, the
constraints are the parser—clear, type-safe, and impossible to get wrong.


Natural parser composition
---------------------------

Beyond complex constraints, Optique excels at the more common challenge of
sharing option sets across multiple commands. While other libraries handle
this through object spreading or helper abstractions, Optique treats parsers
as first-class values that naturally compose.

Consider sharing common options across different commands:

~~~~ typescript twoslash
import { object, merge } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

const CommonOptions = object({
  verbose: option("--verbose"),
  config: option("--config", string())
});

const DeployOptions = object({
  environment: option("--env", string())
});

const deployParser = merge(CommonOptions, DeployOptions);
//    ^?



















// Natural composition with preserved type information
~~~~

The difference becomes more pronounced as your CLI grows. With configuration-based
libraries, shared logic requires increasingly complex abstractions. With Optique,
you just compose functions—the same way you'd compose any other logic in your
application.


Parser combinators in practice
-------------------------------

The power of Optique's approach becomes clear when building real CLI applications.
Consider a deployment tool that needs different option sets for different
environments, with some options shared and others specific to each context.

~~~~ typescript twoslash
import { merge, object, or } from "@optique/core/parser";
import { command, constant, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";

// Base components that capture common patterns
const databaseConfig = object({
  host: option("--db-host", string()),
  port: option("--db-port", integer({ min: 1000 })),
  database: option("--database", string())
});

const loggingConfig = object({
  verbose: option("--verbose"),
  logLevel: option("--log-level", string())
});

// Environment-specific variations
const productionConfig = object({
  ssl: option("--ssl"),
  backup: option("--backup")
});

const developmentConfig = object({
  watch: option("--watch"),
  hotReload: option("--hot-reload")
});

// Commands that compose these pieces differently
const prodDeploy = command(
  "production",
  merge(
    object({ type: constant("production") }),
    databaseConfig,
    loggingConfig,
    productionConfig
  )
);

const devDeploy = command(
  "development",
  merge(
    object({ type: constant("development") }),
    databaseConfig,
    loggingConfig,
    developmentConfig
  )
);

const deployCommand = command("deploy", or(prodDeploy, devDeploy));
~~~~

Each component remains independently testable and reusable. You can share
`databaseConfig` across multiple projects, modify `loggingConfig` for different
applications, or create new combinations without touching existing code. The
type system tracks everything automatically, ensuring your CLI evolves safely.


The functional advantage
------------------------

Traditional CLI libraries work within object-oriented or configuration patterns
that limit how you can transform and extend parsers. You might extract common
options into shared objects, but you can't easily create variations or apply
transformations while preserving type safety.

Optique's functional approach means parsers are just values you can transform
with standard functional programming techniques:

~~~~ typescript twoslash
import { object, withDefault } from "@optique/core/parser";
import { option } from "@optique/core/primitives";
import { string, integer } from "@optique/core/valueparser";

// Start with a base parser
const serverOptions = object({
  port: option("--port", integer()),
  host: option("--host", string())
});

// Transform it for different contexts
const withDefaults = object({
  port: withDefault(option("--port", integer()), 3000),
  host: withDefault(option("--host", string()), "localhost")
});

const forProduction = object({
  port: withDefault(option("--port", integer()), 80),
  host: withDefault(option("--host", string()), "0.0.0.0")
});

const config = forProduction;
//    ^?









// Each variation preserves full type information
~~~~

You can create parser libraries that export not just specific configurations,
but transformation functions that let consumers adapt parsers to their needs.
This enables a level of reusability that's impossible with configuration-based
approaches.


Type inference that scales
--------------------------

While modern CLI libraries provide good type safety, they typically require
manual type annotations for complex scenarios. You define your configuration,
then separately define types that hopefully match what the configuration
produces.

Optique's type inference scales naturally from simple to complex cases. The
same combinators that handle basic options automatically infer sophisticated
discriminated unions for complex command structures:

~~~~ typescript twoslash
import {
  type InferValue,
  object,
  optional,
  or,
  withDefault,
} from "@optique/core/parser";
import { argument, command, constant, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";

const userCommands = or(
  command("create", object({
    action: constant("create"),
    name: argument(string()),
    email: option("--email", string()),
    role: option("--role", string())
  })),
  command("list", object({
    action: constant("list"),
    filter: optional(option("--filter", string())),
    limit: withDefault(option("--limit", integer()), 10),
  })),
  command("delete", object({
    action: constant("delete"),
    id: argument(integer()),
    force: option("--force")
  }))
);

type UserAction = InferValue<typeof userCommands>;
//   ^?














// TypeScript automatically infers the perfect discriminated union
~~~~

This type is derived entirely from the parser structure. No manual annotations,
no separate type definitions, no risk of the types and implementation drifting
apart. The parser is the type, and the type is the parser.


When Optique makes sense
------------------------

Optique shines in scenarios where CLI complexity grows over time and where
consistency across related tools matters. If you're building a single simple
script, the configuration approach of other libraries might serve you better.
The functional programming concepts in Optique add value when you need the
flexibility and reusability they enable.

Choose Optique when you're building CLI applications that will evolve, when
you need to share patterns across multiple tools, or when you're working in
teams where consistent CLI patterns matter. The upfront investment in learning
parser combinators pays dividends as your CLI ecosystem grows.

Consider alternatives when you're building straightforward, one-off tools, when
your team strongly prefers configuration over composition, or when you need to
integrate with existing CLI frameworks that follow different patterns.

The future of CLI development increasingly demands the kind of modularity and
reusability that functional composition enables. Optique brings these
capabilities to TypeScript CLI development, opening possibilities that simply
aren't available with configuration-based approaches.


Starting with Optique
----------------------

Understanding Optique means understanding that CLI parsers can be more than
configurations—they can be composable functions that naturally combine to
create sophisticated interfaces. This shift in perspective, from configuring
to composing, unlocks new levels of reusability and maintainability in CLI
development.

The patterns you learn with Optique apply beyond CLI parsing. They're the same
functional composition techniques that make libraries like Zod so powerful for
validation and that enable the kind of type-safe, composable APIs that make
TypeScript development productive and reliable.
