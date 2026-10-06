// CommonJS subprocess fixture for packages/run/src/output-exit.test.ts.
// It exercises the CommonJS build of @optique/run under Node.js and Bun.
"use strict";

const { object } = require("@optique/core/constructs");
const { message } = require("@optique/core/message");
const { option } = require("@optique/core/primitives");
const { run } = require("@optique/run");
const process = require("node:process");

const render = process.env.OPTIQUE_FIXTURE_RENDER === "1";
const payloadSize = Number(process.env.OPTIQUE_FIXTURE_PAYLOAD ?? "2097152");
const parts = ["BEGIN-MARKER"];
for (let i = 0, size = 0; size < payloadSize; i++) {
  const part = `line-${String(i).padStart(7, "0")}-✓-한글`;
  parts.push(part);
  size += part.length + 1;
}
parts.push("END-MARKER");

let captured = "";
try {
  run(object({ verbose: option("--verbose") }), {
    programName: "fixture",
    args: ["--help"],
    help: "option",
    colors: false,
    maxWidth: 80,
    description: message`${parts.join(" ")}`,
    ...(render
      ? {
        stdout(text) {
          captured += `${text}\n`;
        },
        onExit(code) {
          throw Object.assign(new Error("Render exit."), { code });
        },
      }
      : {}),
  });
} catch (error) {
  if (!render || typeof error.code !== "number") throw error;
  process.stdout.write(captured);
  process.exitCode = error.code;
}
