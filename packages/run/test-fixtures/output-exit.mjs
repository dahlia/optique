// Subprocess fixture for packages/run/src/output-exit.test.ts.
//
// The case to run is selected by the OPTIQUE_FIXTURE_CASE environment
// variable.  When OPTIQUE_FIXTURE_RENDER is set to "1", the fixture captures
// what the case would write through custom stdout/stderr callbacks and then
// writes it through the streams, letting the process exit naturally; the
// test uses that as the expected output for the default writers.
import { object } from "@optique/core/constructs";
import { message } from "@optique/core/message";
import { argument, option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";
import { printError, run, runAsync, runSync } from "@optique/run";
import process from "node:process";

const caseName = process.env.OPTIQUE_FIXTURE_CASE;
const render = process.env.OPTIQUE_FIXTURE_RENDER === "1";
const payloadSize = Number(process.env.OPTIQUE_FIXTURE_PAYLOAD ?? "2097152");

function makePayload(separator) {
  const parts = ["BEGIN-MARKER"];
  let size = parts[0].length;
  for (let i = 0; size < payloadSize; i++) {
    const part = `line-${String(i).padStart(7, "0")}-✓-한글`;
    parts.push(part);
    size += part.length + separator.length;
  }
  parts.push("END-MARKER");
  return parts.join(separator);
}

function asyncString() {
  return {
    mode: "async",
    metavar: "STRING",
    placeholder: "",
    parse(input) {
      return Promise.resolve({ success: true, value: input });
    },
    format(value) {
      return value;
    },
  };
}

const syncParser = object({ name: option("--name", string()) });
const asyncParser = object({ name: option("--name", asyncString()) });
const description = message`${makePayload(" ")}`;
const base = {
  programName: "fixture",
  colors: false,
  maxWidth: 80,
};

let capturedStdout = "";
let capturedStderr = "";
const hooks = render
  ? {
    stdout(text) {
      capturedStdout += `${text}\n`;
    },
    stderr(text) {
      capturedStderr += `${text}\n`;
    },
    onExit(code) {
      throw new RenderExit(code);
    },
  }
  : {};

const bigShell = {
  name: "big",
  generateScript() {
    return makePayload("\n");
  },
  *encodeSuggestions() {
    const payload = makePayload("\n");
    const chunkSize = Math.ceil(payload.length / 64);
    for (let i = 0; i < payload.length; i += chunkSize) {
      yield payload.slice(i, i + chunkSize);
    }
  },
};

const cases = {
  "run-sync-help": () =>
    run(syncParser, {
      ...base,
      ...hooks,
      args: ["--help"],
      help: "option",
      description,
    }),
  "runsync-help": () =>
    runSync(syncParser, {
      ...base,
      ...hooks,
      args: ["--help"],
      help: "option",
      description,
    }),
  "run-async-help": () =>
    run(asyncParser, {
      ...base,
      ...hooks,
      args: ["--help"],
      help: "option",
      description,
    }),
  "runasync-help": () =>
    runAsync(asyncParser, {
      ...base,
      ...hooks,
      args: ["--help"],
      help: "option",
      description,
    }),
  "runsync-version": () =>
    runSync(syncParser, {
      ...base,
      ...hooks,
      args: ["--version"],
      version: makePayload(" "),
    }),
  "completion-script": () =>
    run(syncParser, {
      ...base,
      ...hooks,
      args: ["completion", "big"],
      completion: { command: true, shells: { big: bigShell } },
    }),
  "completion-suggestions": () =>
    run(syncParser, {
      ...base,
      ...hooks,
      args: ["completion", "big", "--"],
      completion: { command: true, shells: { big: bigShell } },
    }),
  "sync-error": () =>
    run(syncParser, {
      ...base,
      ...hooks,
      args: ["--bogus"],
      help: "option",
      aboveError: "help",
      errorExitCode: 3,
      description,
    }),
  "async-error": () =>
    runAsync(asyncParser, {
      ...base,
      ...hooks,
      args: ["--bogus"],
      help: "option",
      aboveError: "help",
      errorExitCode: 3,
      description,
    }),
  "contexts-error": () =>
    run(syncParser, {
      ...base,
      ...hooks,
      args: ["--bogus"],
      help: "option",
      aboveError: "help",
      errorExitCode: 3,
      description,
      contexts: [{
        id: Symbol("fixture"),
        phase: "single-pass",
        getAnnotations: () => ({}),
      }],
    }),
  "custom-on-exit": () =>
    run(syncParser, {
      ...base,
      ...hooks,
      args: ["--help"],
      help: "option",
      description,
      // A custom exit handler that terminates the process itself, while the
      // default writers are still in use:
      onExit: render ? hooks.onExit : (code) => process.exit(code + 5),
    }),
  "default-handlers": () =>
    run(object({ value: argument(string()) }), {
      ...hooks,
      help: "option",
      aboveError: "help",
      description,
    }),
  "print-error-stderr": () => printErrorCase("stderr", 4),
  "print-error-stdout": () => printErrorCase("stdout", 0),
};

function printErrorCase(stream, exitCode) {
  const msg = message`${makePayload(" ")}`;
  const options = { stream, colors: false, quotes: false, maxWidth: 80 };
  if (render) {
    // The non-exiting path shares the formatting, so it serves as the
    // expected output for the exiting path:
    printError(msg, options);
    throw new RenderExit(exitCode);
  }
  printError(msg, { ...options, exitCode });
}

function flushRendered(code) {
  process.stdout.write(capturedStdout);
  process.stderr.write(capturedStderr);
  // custom-on-exit adds 5 to the exit code in the real run:
  process.exitCode = caseName === "custom-on-exit" ? code + 5 : code;
}

class RenderExit extends Error {
  constructor(code) {
    super(`Render exit: ${code}`);
    this.code = code;
  }
}

const fn = cases[caseName];
if (fn == null) {
  process.stderr.write(`Unknown fixture case: ${caseName}\n`);
  process.exit(127);
}

try {
  const result = await fn();
  if (render) flushRendered(0);
  void result;
} catch (error) {
  if (!(error instanceof RenderExit)) throw error;
  flushRendered(error.code);
}
