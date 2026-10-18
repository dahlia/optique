import process from "node:process";

export function handler(value) {
  process.stdout.write(
    `${JSON.stringify({ command: "config set", ...value })}\n`,
  );
}
