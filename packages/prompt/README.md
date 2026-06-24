@optique/prompt
===============

Generic prompt adapter support for [Optique].

This package contains the shared machinery used by interactive prompt
integrations.  Most applications should use a concrete integration such as
*@optique/inquirer* or *@optique/clack* instead.

[Optique]: https://optique.dev/


Installation
------------

~~~~ bash
deno add jsr:@optique/prompt
npm add @optique/prompt
pnpm add @optique/prompt
yarn add @optique/prompt
bun add @optique/prompt
~~~~


Documentation
-------------

For full documentation, visit <https://optique.dev/integrations/prompt>.


Quick start
-----------

~~~~ typescript
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { createPromptAdapter } from "@optique/prompt";

const prompt = createPromptAdapter<{ readonly message: string }>({
  async execute<TValue>(config) {
    const value = globalThis.prompt?.(config.message) ?? "";
    return { success: true, value: value as TValue };
  },
});

const name = prompt(option("--name", string()), {
  message: "Name:",
});
~~~~


License
-------

MIT License. See [LICENSE](../../LICENSE) for details.
