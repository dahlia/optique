import { withDefault } from "@optique/core/modifiers";
import { object, or } from "@optique/core/parser";
import { argument, constant, option } from "@optique/core/primitives";
import { integer, string, url } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";

const parser = or(
  object({
    mode: constant("server"),
    host: withDefault(
      option(
        "-h",
        "--host",
        string({ metavar: "HOST" }),
      ),
      "0.0.0.0",
    ),
    port: option(
      "-p",
      "--port",
      integer({ metavar: "PORT", min: 1, max: 0xffff }),
    ),
  }),
  object({
    mode: constant("client"),
    url: argument(url()),
  }),
);

const result = run(parser);
print(message`${JSON.stringify(result, null, 2)}`);
