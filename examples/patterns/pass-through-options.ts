import { object, or } from "@optique/core/constructs";
import {
  argument,
  command,
  constant,
  option,
  passThrough,
} from "@optique/core/primitives";
import { integer, string } from "@optique/core/valueparser";
import { message } from "@optique/core/message";
import { print, run } from "@optique/run";

const parser = or(
  command(
    "local",
    object({
      action: constant("local"),
      port: option(
        "-p",
        "--port",
        integer({ min: 1, max: 65535, metavar: "PORT" }),
      ),
      host: option("-h", "--host", string({ metavar: "HOST" })),
    }),
    {
      description: message`Run a local development server with known options.`,
    },
  ),
  command(
    "exec",
    object({
      action: constant("exec"),
      container: argument(string({ metavar: "CONTAINER" })),
      args: passThrough({
        format: "greedy",
        description: message`Arguments to pass to the container.`,
      }),
    }),
    {
      description:
        message`Execute a command in a container, passing all remaining arguments.`,
    },
  ),
  command(
    "wrap",
    object({
      action: constant("wrap"),
      debug: option("--debug", {
        description: message`Enable debug mode for the wrapper.`,
      }),
      extraOpts: passThrough({
        description: message`Extra options to pass to the underlying tool.`,
      }),
    }),
    {
      description: message`Wrap another tool, forwarding unrecognized options.`,
    },
  ),
);

const result = run(parser, {
  help: "both",
  version: { command: true, option: true, value: "1.0.0" },
});

if (result.action === "local") {
  print(
    message`Running local server on ${result.host ?? "localhost"}:${
      result.port?.toString() ?? "8080"
    }`,
  );
} else if (result.action === "exec") {
  print(message`Executing in container ${result.container}:`);
  print(message`  Args: ${JSON.stringify(result.args)}`);
} else if (result.action === "wrap") {
  print(message`Wrapping tool${result.debug ? " (debug mode)" : ""}:`);
  print(message`  Extra options: ${JSON.stringify(result.extraOpts)}`);
}
