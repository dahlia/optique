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

<div class="ol-hero__split">

<div class="ol-hero__pitch">
<OptiquePrism class="ol-hero__prism" />
<p class="ol-hero__eyebrow">Type-safe CLI parser combinators</p>
<h1 class="ol-hero__title">Make impossible CLI states unrepresentable.</h1>
<p class="ol-hero__lead">Model your command-line grammar with composable parsers. Mutually exclusive modes, dependent options, inferred result types, and context-aware completion all come from the same structure.</p>
<div class="ol-hero__actions"><a class="ol-btn ol-btn--brand" href="/install">Get started</a><a class="ol-btn ol-btn--alt" href="/why">Why Optique?</a><a class="ol-btn ol-btn--alt" href="https://github.com/dahlia/optique">GitHub</a></div>
</div>

<div class="ol-hero__proof">

<CodeCard label="The parser is the rule" tone="after">

~~~~ ts twoslash
import { object, or } from "@optique/core/constructs";
import { constant, option } from "@optique/core/primitives";
import { firstOf, hostname, ip, port, string } from "@optique/core/valueparser";
// ---cut-before---
const auth = object({
  mode: constant("auth"),
  token: option("--token", string()),
  key: option("--key", string()),
});

const config = object({
  mode: constant("config"),
  host: option("--host", firstOf(ip(), hostname())),
  port: option("--port", port()),
});

const deploy = or(auth, config);
~~~~

</CodeCard>

<CodeCard label="Inferred type" tone="result">

~~~~ ts
type Deploy =
  | { mode: "auth"; token: string; key: string }
  | { mode: "config"; host: string; port: number };
~~~~

</CodeCard>

</div>

</div>

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

<LandingSection eyebrow="See it refuse" title="Don't take our word for it." lead="This is the exact <code>deploy</code> parser from above, not a mockup. Mix the two modes, pass an out-of-range port, or drop a required option, and it refuses each one at runtime with the same typed errors your users would see. (It runs right here because <code>@optique/core</code> is dependency-free ECMAScript.)">

<RunDemo />

</LandingSection>

<div class="ol-strip"><p class="ol-strip__line">Not a friendlier option builder. A <em>parser-combinator library</em> whose result types are the grammar of your command line.</p><CommandGrammar /></div>

<LandingSection eyebrow="One parser, every surface" title="Define it once. Optique refracts the rest." lead="The same definition drives argument parsing, type inference, help text, shell completion, and Unix man pages. Add an option and every surface follows, with nothing to keep in sync by hand.">

<Cols>

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

<SurfaceTabs />

</Cols>

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

<LandingSection eyebrow="Command structure" title="Subcommands become a union you can narrow." lead="Branch between subcommands with <a href='/concepts/constructs#command-alternatives'><code>or()</code></a>, and each <a href='/concepts/primitives#command-parser'><code>command()</code></a> becomes one arm of a discriminated union. TypeScript narrows every branch by its tag, so a handler only ever sees the options that subcommand actually defines.">

<Cols center>

~~~~ ts twoslash
import { object, or } from "@optique/core/constructs";
import { withDefault } from "@optique/core/modifiers";
import type { InferValue } from "@optique/core/parser";
import { argument, command, constant, option } from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
// ---cut-before---
const cli = or(
  command("create", object({
    action: constant("create"),
    name: argument(string()),
    role: option("--role", string()),
  })),
  command("list", object({
    action: constant("list"),
    limit: withDefault(option("--limit", integer()), 10),
  })),
  command("delete", object({
    action: constant("delete"),
    id: argument(integer()),
    force: option("--force"),
  })),
);

type Command = InferValue<typeof cli>;
~~~~

<CommandFork />

</Cols>

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

<LandingSection eyebrow="Shell completion" title="Completion your users install in one line." lead="The completion script comes from the same parser, so suggestions never drift from what the CLI accepts. It is context-aware: subcommands, options, and even values that depend on other options.">

<Cols>

<CompletionShowcase />

::: code-group

~~~~ bash [Bash]
myapp completion bash >> ~/.bashrc
~~~~

~~~~ bash [zsh]
myapp completion zsh > ~/.zsh/completions/_myapp
~~~~

~~~~ bash [fish]
myapp completion fish > ~/.config/fish/completions/myapp.fish
~~~~

~~~~ bash [PowerShell]
myapp completion pwsh > myapp-completion.ps1
~~~~

~~~~ bash [Nushell]
myapp completion nu | save myapp-completion.nu
~~~~

:::

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
<LandingSection eyebrow="From the cookbook" title="The awkward parts of real CLIs, already solved." lead="Mutually exclusive modes, options that gate others, key–value pairs, pass-through, verbosity, negatable flags. Each hard requirement is a small composition, and each one has a recipe in the cookbook.">
<PatternShowcase />
</LandingSection>
<LandingSection eyebrow="Batteries included" title="Reach for a parser before you write one." lead="Forty built-in value parsers, from <code>integer()</code> and <code>ip()</code> to Temporal dates and async Git refs, plus the combinators that assemble them. Every one returns an ordinary parser that composes with the rest.">
<ParserCatalog />
<PackageGrid />
</LandingSection>
<div class="ol-closing"><h2 class="ol-closing__title">Start modeling your CLI.</h2><div class="ol-hero__actions"><a class="ol-btn ol-btn--brand" href="/tutorial">Start the tutorial</a><a class="ol-btn ol-btn--alt" href="/why">Why Optique?</a><a class="ol-btn ol-btn--alt" href="/cookbook">Cookbook</a><a class="ol-btn ol-btn--alt" href="https://github.com/dahlia/optique">GitHub</a></div><a class="ol-sponsor" href="https://github.com/sponsors/dahlia" target="_blank" rel="noopener"><svg class="ol-sponsor__heart" viewBox="0 0 16 16" aria-hidden="true"><path d="M4.25 2.5c-1.336 0-2.75 1.164-2.75 3 0 2.15 1.58 4.144 3.365 5.682A20.565 20.565 0 0 0 8 13.393a20.561 20.561 0 0 0 3.135-2.211C12.92 9.644 14.5 7.65 14.5 5.5c0-1.836-1.414-3-2.75-3-1.373 0-2.609.986-3.029 2.456a.75.75 0 0 1-1.442 0C6.859 3.486 5.623 2.5 4.25 2.5Z"></path></svg>Sponsor Optique on GitHub</a></div>
