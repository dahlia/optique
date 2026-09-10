import { spawn } from "node:child_process";

// The delay deliberately exceeds the former one-second helper limit.
const watchdog = setTimeout(() => process.exit(124), 10_000);
setTimeout(() => {
  const helper = spawn(process.argv[2], process.argv.slice(3), {
    stdio: ["ignore", "inherit", "inherit"],
    windowsHide: true,
  });
  helper.on("error", (error) => {
    console.error(error);
    clearTimeout(watchdog);
    process.exitCode = 1;
  });
  helper.on("close", (code) => {
    clearTimeout(watchdog);
    process.exitCode = code ?? 1;
  });
}, 1200);
