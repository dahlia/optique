@optique/keyring
================

Operating-system credential-store password fallback for [Optique].

Use this package to read secrets from the keyring, with hidden password input
for interactive commands or environment overrides for API keys. Avoid
secret-valued CLI options, which can expose values in shell history and
process listings.

[Optique]: https://optique.dev/


Installation
------------

~~~~ bash
deno add jsr:@optique/keyring jsr:@optique/run jsr:@optique/inquirer
npm add @optique/keyring @optique/run @optique/inquirer
pnpm add @optique/keyring @optique/run @optique/inquirer
yarn add @optique/keyring @optique/run @optique/inquirer
bun add @optique/keyring @optique/run @optique/inquirer
~~~~


Quick start
-----------

Keyring lookups are asynchronous. Register the context with `runAsync()`
through `contexts`, or the fallback cannot read the password. Use `fail()`
to accept no CLI value and prompt only when the keyring has no password:

~~~~ typescript
import { object } from "@optique/core/constructs";
import { fail } from "@optique/core/primitives";
import { prompt } from "@optique/inquirer";
import { bindKeyring, createKeyringContext } from "@optique/keyring";
import { runAsync } from "@optique/run";

const keyringContext = createKeyringContext();

const parser = object({
  password: prompt(
    bindKeyring(fail<string>(), {
      context: keyringContext,
      service: "com.example.myapp",
      username: "current-user",
    }),
    {
      type: "password",
      message: "Password:",
      mask: false,
    },
  ),
});

const options = await runAsync(parser, {
  contexts: [keyringContext],
});
~~~~

The keyring is checked first. A missing password opens a prompt with hidden
input; credential-store errors reject the parse without prompting. Entered
passwords are used for this run only. Store a password for your service and
username using your operating system's credential manager: this package does
not write or delete credentials.


Priority with environment variables
-----------------------------------

For API keys, put `bindEnv()` outside `bindKeyring()` so an environment
variable wins over the credential store. Install *@optique/env* for this
example. Using `fail<string>()` keeps the API key out of CLI arguments;
this parser never prompts:

~~~~ typescript
import { fail } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { bindEnv, createEnvContext } from "@optique/env";
import { bindKeyring, createKeyringContext } from "@optique/keyring";
import { runAsync } from "@optique/run";

const envContext = createEnvContext({ prefix: "MYAPP_" });
const keyringContext = createKeyringContext();

const apiKey = bindEnv(
  bindKeyring(fail<string>(), {
    context: keyringContext,
    service: "com.example.myapp.api-key",
    username: "current-user",
  }),
  {
    context: envContext,
    key: "API_KEY",
    parser: string(),
  },
);

const secret = await runAsync(apiKey, {
  contexts: [envContext, keyringContext],
});
~~~~

This checks `MYAPP_API_KEY`, then the keyring, and fails if neither supplies
an API key. Register both contexts. See the [API key example] for more detail.
Environment variables can still be exposed or inherited; inject them through
your automation's secret manager instead of typing literal keys into commands.

[API key example]: https://optique.dev/integrations/keyring#priority-with-environment-variables


Custom sources
--------------

Pass an asynchronous `source` to `createKeyringContext()` for tests, alternate
credential backends, or runtimes that supply their own password reader. Return
`undefined` only when that source has no password, and reject on lookup errors.

~~~~ typescript
import { createKeyringContext } from "@optique/keyring";

const keyringContext = createKeyringContext({
  source: () => Promise.resolve("test-password"),
});
~~~~


Runtime setup
-------------

Node.js and Bun load the native keyring addon only when a password lookup is
needed. Their normal package installations are enough.

Deno runs native Node addons from local `node_modules`. Run a Deno program with
local modules enabled and grant the permissions used by the native loader:

~~~~ bash
deno run --node-modules-dir=auto --allow-env --allow-sys \
  --allow-read=node_modules --allow-ffi=node_modules main.ts
~~~~


Missing credentials and errors
------------------------------

Missing credentials allow the inner parser to provide a fallback or its usual
missing-value error. Locked, inaccessible, or ambiguous credential-store errors
reject the parse unchanged, including under `optional()` or `withDefault()`.
If the inner parser provides a validation hook, it is applied to stored
passwords. `fail<string>()` has no value validation of its own.

Stored-password validation failures use a generic message so the password
cannot appear in error output. If a validation hook throws or rejects, it is
replaced with a `TypeError` without the original message or cause.

The default backend uses the asynchronous `@napi-rs/keyring` API. Its macOS
backend does not provide Touch ID authentication. A custom source can supply
an alternative backend.


Documentation
-------------

See the [keyring integration guide] for the complete usage guide.

[keyring integration guide]: https://optique.dev/integrations/keyring


License
-------

MIT License. See [LICENSE](../../LICENSE) for details.
