---
description: >-
  Read secrets from the operating system credential store, with hidden password
  input for interactive commands and environment overrides for API keys.
---

Keyring password fallback
=========================

*This API is available since Optique 1.3.0.*

The *@optique/keyring* package reads secrets from the operating system
credential store and makes the resulting parser asynchronous. Combine it with
hidden password input for interactive commands or environment variables for
automation.

Use it for secrets that belong to one user and machine. Avoid secret-valued CLI
options: arguments can appear in shell history and process listings. Don't put
secrets in a config file or add a fallback password to the parser.

::: code-group

~~~~ bash [Deno]
deno add jsr:@optique/keyring jsr:@optique/run jsr:@optique/inquirer
~~~~

~~~~ bash [npm]
npm add @optique/keyring @optique/run @optique/inquirer
~~~~

~~~~ bash [pnpm]
pnpm add @optique/keyring @optique/run @optique/inquirer
~~~~

~~~~ bash [Yarn]
yarn add @optique/keyring @optique/run @optique/inquirer
~~~~

~~~~ bash [Bun]
bun add @optique/keyring @optique/run @optique/inquirer
~~~~

:::


Basic usage
-----------

Create one context, bind it to `fail<string>()`, then register the same context
with `runAsync()`. The inner `fail()` accepts no CLI value. Wrap the binding
with [Inquirer's `prompt()`](./inquirer.md) to ask for a password only when the
keyring has no stored value:

~~~~ typescript twoslash
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

The keyring is checked first. A stored password skips the prompt; a missing
password opens an input that does not echo typed characters. Credential-store
errors reject the parse without prompting. The entered password is used for
this run only: this package does not write or delete credentials.

> [!WARNING]
> `bindKeyring()` reads a credential only when its exact context is registered
> through `contexts: [keyringContext]`. Missing registration skips the lookup;
> a surrounding prompt can still run, but the keyring was not checked.
> Registering a different context does not enable this binding.


Priority with environment variables
-----------------------------------

For API keys in automated commands, put `bindEnv()` outside `bindKeyring()`
so an environment variable wins over the credential store. Install
*@optique/env* for this example. Using `fail<string>()` keeps the API key out
of CLI arguments; this parser never prompts:

~~~~ typescript twoslash
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
an API key. Register both contexts. Reverse the nesting only when the
credential store should win over the environment. See the
[environment variable guide](./env.md) for environment source options.

Environment variables are not protected storage: they can be inherited by
child processes or exposed to other processes, depending on the operating
system and permissions. Have your CI secret manager inject `MYAPP_API_KEY`
instead of typing a literal key into a shell command.


Custom sources and native loading
---------------------------------

`createKeyringContext()` accepts an injected async source for tests, custom
backends, or runtimes that provide their own credential bridge. Return
`undefined` only when the password is absent, and reject the promise on lookup
errors. The source is captured when the context is created and is called only
when a missing value needs completion. For example, tests can supply a fixed
password without accessing a credential store:

~~~~ typescript twoslash
import { createKeyringContext } from "@optique/keyring";

const keyringContext = createKeyringContext({
  source: () => Promise.resolve("test-password"),
});
~~~~

The built-in source loads its native addon lazily. Creating a context, parsing
CLI values, rendering help/version output, and generating completion
suggestions do not load the addon or query the credential store. An outer
environment binding that supplies the value also bypasses the addon.

For Deno, enable local `node_modules` so the npm native addon can be loaded.
The native loader reads environment variables and detects the operating
system in addition to loading the addon through FFI:

~~~~ bash
deno run --node-modules-dir=auto --allow-env --allow-sys \
  --allow-read=node_modules --allow-ffi=node_modules main.ts
~~~~

The default backend uses `@napi-rs/keyring`'s `AsyncEntry` API. On macOS it
uses the ordinary keychain store and does not provide Touch ID authentication.
Use a custom source for a backend with different authentication requirements.


Missing credentials and store errors
------------------------------------

When no credential exists, `bindKeyring()` lets the inner parser supply its
fallback or missing-value error. `optional(bindKeyring(...))` returns
`undefined` for a missing credential, and `withDefault(bindKeyring(...), value)`
uses the default only when the keyring cannot supply a value.

Locked, inaccessible, or ambiguous credential-store errors reject the parse
with the original error. They do not trigger an inner fallback or get replaced
by an optional value or static default. If the inner parser provides a
validation hook, it is applied to retrieved passwords. `fail<string>()` has
no value validation of its own.

Stored-password validation failures use a generic message so the password
cannot appear in error output. If a validation hook throws or rejects, it is
replaced with a `TypeError` without the original message or cause.
