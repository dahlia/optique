import {
  argument,
  constant,
  object,
  option,
  or,
  withDefault,
} from "@optique/core/parser";
import { integer, string, url } from "@optique/core/valueparser";
import { run } from "@optique/run";

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
      integer({ metavar: "PORT", min: 1, max: 65535 }),
    ),
  }),
  object({
    mode: constant("client"),
    url: argument(url()),
  }),
);

const mode = run(parser);
console.log(mode);
