@optique/derived-defaults
=========================

Derived default value support for [Optique].

This package lets CLI applications compute default values from the first-pass
parse result while keeping clear priority handling:

CLI arguments > derived defaults > static defaults.

[Optique]: https://optique.dev/


Installation
------------

~~~~ bash
deno add jsr:@optique/derived-defaults
npm add @optique/derived-defaults
pnpm add @optique/derived-defaults
yarn add @optique/derived-defaults
bun add @optique/derived-defaults
~~~~


Quick start
-----------

~~~~ typescript
import { object } from "@optique/core/constructs";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { runAsync } from "@optique/run";
import {
  bindDerivedDefault,
  createDerivedDefaults,
} from "@optique/derived-defaults";

const derived = createDerivedDefaults({
  workspaceRoot: (parsed: { readonly serviceRoot?: string }) =>
    parsed.serviceRoot == null
      ? undefined
      : `${parsed.serviceRoot}/workspace`,
});

const parser = object({
  serviceRoot: option("--service-root", string()),
  workspaceRoot: bindDerivedDefault(option("--workspace-root", string()), {
    context: derived.context,
    key: "workspaceRoot",
  }),
});

const result = await runAsync(parser, {
  args: ["--service-root", "/srv/app"],
  contexts: [derived.context],
});

console.log(result);
~~~~


Features
--------

 -  *Two-pass defaults* derived from already parsed CLI values
 -  *Async resolver support* with `runAsync()`/`runWith()`
 -  *Fallback validation* through the wrapped Optique parser
 -  *Custom help text* for values that are computed at runtime
 -  *Composable contexts* with `run()`/`runAsync()`/`runWith()`


Documentation
-------------

For full documentation, visit
<https://optique.dev/concepts/derived-defaults>.


License
-------

MIT License. See [LICENSE](../../LICENSE) for details.
