---
layout: home
pageClass: optique-landing
title: "Optique: type-safe combinatorial CLI parser for TypeScript"
description: >-
  Model your command-line grammar with composable, type-safe parsers. Mutually
  exclusive modes, dependent options, inferred result types, help, completion,
  and man pages all come from the same parser definition.
---

<div class="ol-hero">
<div class="ol-hero__glow"></div>
<OptiquePrism class="ol-hero__prism" />
<p class="ol-hero__eyebrow">Type-safe CLI parser combinators</p>
<h1 class="ol-hero__title">Make impossible CLI states unrepresentable.</h1>
<p class="ol-hero__lead">Model your command-line grammar with composable parsers. Mutually exclusive modes, dependent options, inferred result types, and context-aware completion all come from the same structure.</p>
<div class="ol-hero__actions"><a class="ol-btn ol-btn--brand" href="/install">Get started</a><a class="ol-btn ol-btn--alt" href="/why">Why Optique?</a><a class="ol-btn ol-btn--alt" href="https://github.com/dahlia/optique">GitHub</a></div>

<div class="ol-hero__install">

::: code-group

~~~~ bash [npm]
npm add @optique/core @optique/run
~~~~

~~~~ bash [pnpm]
pnpm add @optique/core @optique/run
~~~~

~~~~ bash [Yarn]
yarn add @optique/core @optique/run
~~~~

~~~~ bash [Deno]
deno add --jsr @optique/core @optique/run
~~~~

~~~~ bash [Bun]
bun add @optique/core @optique/run
~~~~

:::

</div>

<RunsOn />

</div>

<section class="ol-proof">

<Cols>

<CodeCard label="Without Optique" tone="before">

~~~~ ts
// Validate the flag combination by hand.
const hasAuth =
  f.token && f.key && f.secret;
const hasConfig =
  f.file && f.host && f.port;

if (!hasAuth && !hasConfig) {
  throw new Error("Need auth or config.");
}

if (hasAuth && hasConfig) {
  throw new Error("Cannot use both.");
}

// `f` stays one wide, untyped object.
~~~~

</CodeCard>

<CodeCard label="With Optique" tone="after">

~~~~ ts twoslash
import { object, or } from "@optique/core/constructs";
import { constant, option } from "@optique/core/primitives";
import { firstOf, hostname, ip, port, string } from "@optique/core/valueparser";
import { path } from "@optique/run/valueparser";
// ---cut-before---
const auth = object({
  mode: constant("auth"),
  token: option("--auth-token", string()),
  key: option("--auth-key", string()),
  secret: option("--auth-secret", string()),
});

const config = object({
  mode: constant("config"),
  file: option("--config", path()),
  host: option("--host", firstOf(ip(), hostname())),
  port: option("--port", port()),
});

const deploy = or(auth, config);
~~~~

</CodeCard>

</Cols>

<CodeCard label="Inferred type" tone="result" class="ol-proof__result">

~~~~ ts
type Deploy =
  | { mode: "auth"; token: string; key: string; secret: string }
  | { mode: "config"; file: string; host: string; port: number };
~~~~

</CodeCard>

</section>

<div class="ol-strip"><p class="ol-strip__line">Not a friendlier option builder. A <em>parser-combinator library</em> whose result types are the grammar of your command line.</p><CommandGrammar /></div>

<LandingSection eyebrow="One parser, every surface" title="Define it once. Optique refracts the rest." lead="The same definition drives argument parsing, type inference, help text, shell completion, and Unix man pages. Add an option and every surface follows, with nothing to keep in sync by hand.">

<Cols center>

~~~~ ts twoslash
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { firstOf, hostname, ip, port } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
// ---cut-before---
const host = firstOf(ip(), hostname(), {
  metavar: "HOST",
});

const parser = object({
  host: option("--host", host, {
    description: message`Host to bind to.`,
  }),
  port: option("--port", port(), {
    description: message`Port to listen on.`,
  }),
});
~~~~

<OptiquePrism variant="dispersion" />

</Cols>

<SurfaceTabs />

</LandingSection>

<LandingSection eyebrow="Composition" title="Parsers are values you can share and transform." lead="Build small option groups once, then <a href='/concepts/constructs#merge-parser'><code>merge()</code></a> and <a href='/concepts/constructs#or-parser'><code>or()</code></a> them into larger commands without losing a single type. The same pieces compose across every tool you ship." tint>

~~~~ ts twoslash
import { object, merge } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
// ---cut-before---
const CommonOptions = object({
  verbose: option("--verbose"),
  config: option("--config", string()),
});

const DeployOptions = object({
  environment: option("--env", string()),
});

// One value, fully typed. Share these groups across every command.
const deployParser = merge(CommonOptions, DeployOptions);
~~~~

</LandingSection>

<LandingSection eyebrow="Inter-option dependencies" title="Options can depend on values, not just presence." lead="When one option's valid values depend on another, Optique resolves that relationship after parsing, then uses the very same graph to power context-aware completion. The values <kbd>Tab</kbd> offers are the values your parser will accept.">

<Cols>

~~~~ ts twoslash
import { object } from "@optique/core/constructs";
import { dependency } from "@optique/core/dependency";
import { option } from "@optique/core/primitives";
import { choice } from "@optique/core/valueparser";
// ---cut-before---
const mode = dependency(
  choice(["dev", "prod"] as const),
);

const logLevel = mode.derive({
  metavar: "LEVEL",
  mode: "sync",
  factory: (m) =>
    m === "dev"
      ? choice(["debug", "info", "warn", "error"])
      : choice(["warn", "error"]),
  defaultValue: () => "dev" as const,
});

const parser = object({
  mode: option("--mode", mode),
  logLevel: option("--log-level", logLevel),
});
~~~~

<CompletionDemo />

</Cols>

</LandingSection>

<LandingSection eyebrow="Every value, one model" title="The same parser for CLI, environment, config, and prompts." lead="Integration packages are parser wrappers. Stack them and the priority is just the wrapping order: CLI over environment over config over an interactive prompt." tint>

~~~~ ts twoslash
import { z } from "zod";
import { bindConfig, createConfigContext } from "@optique/config";
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { prompt } from "@optique/inquirer";
// ---cut-before---
const envContext = createEnvContext({ prefix: "MYAPP_" });
const configContext = createConfigContext({
  schema: z.object({ host: z.string().optional() }),
});

// CLI > env > config > interactive prompt
const host = prompt(
  bindEnv(
    bindConfig(option("--host", string()), {
      context: configContext,
      key: "host",
    }),
    { context: envContext, key: "HOST", parser: string() },
  ),
  { type: "input", message: "Host:", default: "localhost" },
);
~~~~

</LandingSection>
<LandingSection eyebrow="Batteries included" title="A mature ecosystem, not a single package." lead="Thirty-plus built-in value parsers, schema validation through Zod or Valibot, async Git references, and Temporal dates. Every integration returns an ordinary parser that composes with the rest.">
<div class="ol-runtimes"><span class="ol-chip"><b>Deno</b></span><span class="ol-chip"><b>Node.js</b></span><span class="ol-chip"><b>Bun</b></span><span class="ol-chip">JSR&nbsp; <b>+</b> &nbsp;npm</span></div>
<PackageGrid />
</LandingSection>
<div class="ol-closing"><h2 class="ol-closing__title">Start modeling your CLI.</h2><div class="ol-hero__actions"><a class="ol-btn ol-btn--brand" href="/tutorial">Start the tutorial</a><a class="ol-btn ol-btn--alt" href="/why">Why Optique?</a><a class="ol-btn ol-btn--alt" href="/cookbook">Cookbook</a><a class="ol-btn ol-btn--alt" href="https://github.com/dahlia/optique">GitHub</a></div><a class="ol-sponsor" href="https://github.com/sponsors/dahlia" target="_blank" rel="noopener"><svg class="ol-sponsor__heart" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.25 2.5c-1.336 0-2.75 1.164-2.75 3 0 2.15 1.58 4.144 3.365 5.682A20.565 20.565 0 0 0 8 13.393a20.561 20.561 0 0 0 3.135-2.211C12.92 9.644 14.5 7.65 14.5 5.5c0-1.836-1.414-3-2.75-3-1.373 0-2.609.986-3.029 2.456a.75.75 0 0 1-1.442 0C6.859 3.486 5.623 2.5 4.25 2.5Z"></path></svg>Sponsor Optique on GitHub</a></div>
