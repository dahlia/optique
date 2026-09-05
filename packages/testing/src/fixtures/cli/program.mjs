import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// Independent watchdog bounds orphan lifetime even if a test assertion fails.
setTimeout(() => process.exit(124), 15_000).unref();

const [mode, ...args] = process.argv.slice(2);
switch (mode) {
  case "output": {
    const bytes = Buffer.from("hello\r\n한글🌻\n");
    for (const byte of bytes) process.stdout.write(Buffer.from([byte]));
    process.stderr.write("warning\n");
    break;
  }
  case "args":
    console.log(JSON.stringify(args));
    break;
  case "context":
    console.log(JSON.stringify({
      cwd: process.cwd(),
      first: process.env.OPTIQUE_CLI_FIRST ?? null,
      second: process.env.OPTIQUE_CLI_SECOND ?? null,
      inherited: process.env.PATH ?? process.env.Path ?? null,
    }));
    break;
  case "stdin": {
    for await (const chunk of process.stdin) process.stdout.write(chunk);
    break;
  }
  case "duplex": {
    process.stdout.write("o".repeat(256 * 1024));
    process.stderr.write("e".repeat(256 * 1024));
    let count = 0;
    for await (const chunk of process.stdin) count += chunk.length;
    process.stdout.write(`\n${count}`);
    break;
  }
  case "early":
    process.exit(7);
    break;
  case "exit":
    process.exitCode = Number(args[0]);
    break;
  case "throw":
    throw new TypeError("Fixture handler failed.");
  case "signal":
    process.kill(process.pid, "SIGTERM");
    break;
  case "graceful":
    process.on("SIGTERM", () => {
      const runtimeArgs = "Deno" in globalThis ? ["run", "-A"] : [];
      const tail = spawn(process.execPath, [
        ...runtimeArgs,
        fileURLToPath(import.meta.url),
        "tail",
      ], { stdio: ["ignore", "inherit", "inherit"] });
      tail.unref();
      process.exit(0);
    });
    // Falls through to the ordinary readiness handshake.
  case "hang":
  case "stubborn":
    if (mode === "stubborn") process.on("SIGTERM", () => {});
    process.stdout.write("ready\n");
    process.stderr.write("waiting\n");
    if (args[0]) writeFileSync(args[0], String(process.pid));
    setInterval(() => {}, 1000);
    break;
  case "tail":
    setTimeout(() => process.stderr.write("final\n".repeat(10_000)), 20);
    break;
  case "tree": {
    if (args[2]) writeFileSync(args[2], String(process.pid));
    const runtimeArgs = "Deno" in globalThis ? ["run", "-A"] : [];
    const child = spawn(process.execPath, [
      ...runtimeArgs,
      fileURLToPath(import.meta.url),
      "stubborn",
      args[0],
    ], { stdio: ["ignore", "inherit", "inherit"] });
    child.unref();
    if (args[1] === "exit") {
      process.exitCode = 0;
    } else {
      setInterval(() => {}, 1000);
    }
    break;
  }
  default:
    throw new TypeError(`Unknown fixture mode: ${mode}`);
}
