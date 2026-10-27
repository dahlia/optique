#!/usr/bin/env node
import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";
import { run } from "@optique/run";
import { parser, version } from "./parser.ts";

const args = run(parser, {
  programName: "skill-notes",
  help: "option",
  version,
  aboveError: "none",
  colors: false,
  maxWidth: 80,
});

try {
  let bytes: Buffer;
  if (args.input === "-") {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
    bytes = Buffer.concat(chunks);
  } else bytes = await readFile(args.input);

  if (args.action === "count") {
    let lines = 0;
    for (const byte of bytes) if (byte === 0x0a) lines++;
    if (bytes.length > 0 && bytes.at(-1) !== 0x0a) lines++;
    console.log(JSON.stringify({ lines }));
  } else {
    await writeFile(args.output, bytes, { flag: "wx" });
    console.log(`Saved ${bytes.length} bytes.`);
  }
} catch (error) {
  const exists = error instanceof Error && "code" in error &&
    error.code === "EEXIST";
  console.error(
    exists
      ? "skill-notes: Destination already exists."
      : "skill-notes: File operation failed.",
  );
  process.exitCode = 1;
}
