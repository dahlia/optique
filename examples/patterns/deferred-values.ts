import { object } from "@optique/core/constructs";
import { deferredValue, withDefault } from "@optique/core/modifiers";
import { message } from "@optique/core/message";
import { flag, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { print, run } from "@optique/run";

// This example demonstrates deferredValue(): a parsed field that becomes a
// value-producing function resolved at handler time instead of during parsing.
//
// An API token is accepted from the command line when given, but is only
// resolved (here, prompted for) when the handler actually reaches the
// deployment branch.  Run without --deploy and the prompt never happens.
//
// Usage:
//   deno run -A examples/patterns/deferred-values.ts --service-name api
//   deno run -A examples/patterns/deferred-values.ts --deploy --service-name api
//   deno run -A examples/patterns/deferred-values.ts \
//     --deploy --service-name api --api-token sekret

// A stand-in for an interactive prompt or a credential lookup.  It runs only
// when the deferred value is called, never during parsing.
function promptForApiToken(serviceName: string): Promise<string> {
  print(message`Prompting for an API token for ${serviceName}…`);
  return Promise.resolve(`prompted-token-for-${serviceName}`);
}

// A stand-in for the deployment call.  It uses the token to authenticate but
// never logs it; secrets should not be written to stdout or logs.
function deploy(serviceName: string, _apiToken: string): Promise<void> {
  print(message`Authenticating and deploying ${serviceName}…`);
  return Promise.resolve();
}

const parser = object({
  deploy: withDefault(
    flag("--deploy", {
      description: message`Deploy after building.`,
    }),
    false,
  ),
  serviceName: option("--service-name", string({ metavar: "NAME" }), {
    description: message`The service to operate on.`,
  }),
  apiToken: deferredValue(
    option("--api-token", string({ metavar: "TOKEN" }), {
      description: message`API token; prompted for when omitted.`,
    }),
    ({ serviceName }: { readonly serviceName: string }) =>
      promptForApiToken(serviceName),
    { memoize: true },
  ),
});

// Parsing the sync option never runs the async fallback.  apiToken is a
// function, not a string, and its source tells which branch it will take.
const result = run(parser);

print(message`Service: ${result.serviceName}.`);
print(message`API token source: ${result.apiToken.source}.`);

if (result.deploy) {
  // The token (the specified value, or the prompt) is resolved only here.
  // With memoize: true, a second call would reuse the first resolved token.
  // Pass it to the deployment call; never print the token itself.
  const apiToken = await result.apiToken({ serviceName: result.serviceName });
  await deploy(result.serviceName, apiToken);
  print(message`Deployed ${result.serviceName}.`);
} else {
  print(message`Skipping deployment; the API token was never resolved.`);
}

// Examples:
//
//   $ deno run -A examples/patterns/deferred-values.ts --service-name api
//   Service: api.
//   API token source: fallback.
//   Skipping deployment; the API token was never resolved.
//
//   $ deno run -A examples/patterns/deferred-values.ts --deploy --service-name api
//   Service: api.
//   API token source: fallback.
//   Prompting for an API token for api…
//   Authenticating and deploying api…
//   Deployed api.
//
//   $ deno run -A examples/patterns/deferred-values.ts \
//       --deploy --service-name api --api-token sekret
//   Service: api.
//   API token source: specified.
//   Authenticating and deploying api…
//   Deployed api.
