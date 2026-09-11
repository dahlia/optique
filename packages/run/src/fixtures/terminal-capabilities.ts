import type { SourceContext } from "@optique/core/context";
import { formatMessage, message } from "@optique/core/message";
import { option } from "@optique/core/primitives";
import { defineProgram } from "@optique/core/program";
import { string } from "@optique/core/valueparser";
import { run, runAsync, type RunOptions, runSync } from "@optique/run/run";
import process from "node:process";

interface Scenario {
  readonly mode?: string;
  readonly columns?: string;
  readonly tty?: boolean;
  readonly colors?: boolean;
  readonly width?: string;
  readonly request?:
    | "help"
    | "error"
    | "error-only"
    | "error-help"
    | "unsupported-shell"
    | "completion-error"
    | "success";
  readonly distinguishColors?: boolean;
  readonly formatterThrows?: boolean;
  readonly expectedError?: "RangeError" | "TypeError";
}

const scenario: Scenario = JSON.parse(process.argv[2]);
Object.defineProperty(process.stdout, "columns", {
  configurable: true,
  value: scenario.columns === undefined ? undefined : Number(scenario.columns),
});
Object.defineProperty(process.stdout, "isTTY", {
  configurable: true,
  value: scenario.tty,
});
// Deliberately disagree with stdout to check the runner's shared policy.
Object.defineProperty(process.stderr, "isTTY", {
  configurable: true,
  value: !scenario.tty,
});

const stdout: string[] = [];
const stderr: string[] = [];
const formatting: {
  readonly colors: boolean | null;
  readonly maxWidth: number | null;
}[] = [];
let exitCode: number | undefined;
let exitCalls = 0;
let failure: { readonly name: string; readonly message: string } | undefined;
let value: unknown;
const exit = new Error("Fixture runner exited.");
const context: SourceContext = {
  id: Symbol.for("@test/terminal-capabilities"),
  phase: "single-pass",
  getAnnotations() {
    return {};
  },
};
const options: RunOptions = {
  args: scenario.request === "success"
    ? ["--value", "ok"]
    : scenario.request === "unsupported-shell"
    ? ["--completion", "unknown-shell"]
    : scenario.request === "completion-error"
    ? ["--completion"]
    : scenario.request === "error" || scenario.request === "error-help" ||
        scenario.request === "error-only"
    ? ["--invalid"]
    : ["--help"],
  programName: "test",
  help: "option",
  completion: "option",
  aboveError: scenario.request === "error-help"
    ? "help"
    : scenario.request === "error-only"
    ? "none"
    : "usage",
  brief:
    message`One two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty.`,
  colors: scenario.colors,
  maxWidth: scenario.width === undefined ? undefined : Number(scenario.width),
  contexts: scenario.mode?.endsWith("-context") ? [context] : undefined,
  stdout: (text) => stdout.push(text),
  stderr: (text) => stderr.push(text),
  onExit(code) {
    exitCalls++;
    exitCode = code;
    throw exit;
  },
  messageFormatter(msg, options) {
    formatting.push({
      colors: options?.colors ?? null,
      maxWidth: options?.maxWidth ?? null,
    });
    if (scenario.formatterThrows) {
      throw new RangeError("Custom formatter failed.");
    }
    return scenario.distinguishColors
      ? options?.colors === undefined
        ? "UNSET"
        : options.colors
        ? "TRUE"
        : "FALSE"
      : formatMessage(msg, options);
  },
};
const parser = option("--value", string());
const asyncParser = option("--value", {
  mode: "async",
  metavar: "VALUE",
  placeholder: "",
  parse(input: string) {
    return Promise.resolve({ success: true as const, value: input });
  },
  format(value: string) {
    return value;
  },
});

try {
  switch (scenario.mode) {
    case "runSync":
    case "runSync-context":
      value = runSync(parser, options);
      break;
    case "runAsync":
      value = await runAsync(asyncParser, options);
      break;
    case "async-parser":
      value = await run(asyncParser, options);
      break;
    case "program":
      value = run(
        defineProgram({ parser, metadata: { name: "test" } }),
        options,
      );
      break;
    default:
      value = await run(parser, options);
  }
} catch (error) {
  if (error !== exit) {
    if (!(error instanceof Error) || error.name !== scenario.expectedError) {
      throw error;
    }
    failure = { name: error.name, message: error.message };
  }
}

process.stdout.write(
  JSON.stringify({
    observed: {
      columns: String(process.stdout.columns),
      tty: process.stdout.isTTY ?? null,
    },
    stdout: stdout.join("\n"),
    stderr: stderr.join("\n"),
    formatting,
    exitCode,
    exitCalls,
    stdoutCalls: stdout.length,
    stderrCalls: stderr.length,
    failure,
    value,
  }) + "\n",
);
