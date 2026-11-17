import { spawn } from "node:child_process";
import { globSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

/** Extract only the current repository's known Node test-script grammar. */
export function parseTestScript(script, docs = false) {
  if (docs) {
    if (!/^tsc [\w./ *-]+ && node --test(?: |$)/.test(script)) {
      throw new TypeError(`Unsupported docs test script: ${script}`);
    }
    script = script.slice(script.indexOf(" && ") + 4);
  }
  if (!/^node --test(?: |$)/.test(script)) {
    throw new TypeError(`Unsupported test script: ${script}`);
  }
  const tokens = script.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
  const args = tokens
    .slice(1)
    .map((token) => token.replace(/^(['"])(.*)\1$/, "$2"));
  for (const token of args.slice(1)) {
    if (
      !/^[\w./*?-]+$/.test(token) ||
      token.startsWith("-") ||
      (!/\.[cm]?tsx?$/.test(token) && !/\.test\.mjs$/.test(token))
    ) {
      throw new TypeError(`Unsupported test argument: ${token}`);
    }
  }
  return args;
}

/** Select every existing root/workspace Node script without running pnpm. */
export function testPlans(root) {
  const manifests = new Set([
    "package.json",
    ...globSync(
      [
        "packages/*/package.json",
        "examples/*/package.json",
        "docs/package.json",
        "benchmarks/startup/package.json",
      ],
      { cwd: root },
    ),
  ]);
  return [...manifests].sort().flatMap((file) => {
    const manifest = JSON.parse(readFileSync(resolve(root, file), "utf8"));
    if (!manifest.scripts?.test) return [];
    const directory = file.slice(0, -"package.json".length) || ".";
    parseTestScript(manifest.scripts.test, directory === "docs/");
    return [{ directory, script: manifest.scripts.test }];
  });
}

/** Arguments and cwd are explicit; each worker gets its own JUnit report. */
export function testCommand(root, plan, index) {
  const tail = parseTestScript(
    plan.script,
    plan.directory.replace(/\/$/, "") === "docs",
  );
  return {
    cwd: resolve(root, plan.directory),
    args: [
      tail[0],
      "--test-reporter=spec",
      "--test-reporter=junit",
      "--test-reporter-destination=stdout",
      `--test-reporter-destination=${resolve(
        root,
        "coverage/junit",
        `${index}.xml`,
      )}`,
      ...tail.slice(1),
    ],
  };
}

/** Reject empty, test-only, distribution-only and unexecuted source reports. */
export function validateLcov(text, root) {
  let hit = false;
  let source = false;
  for (const record of text.split("end_of_record")) {
    const name = /^SF:(.+)$/m.exec(record)?.[1];
    if (!name) continue;
    const local = relative(root, resolve(root, name)).split(sep).join("/");
    if (
      isAbsolute(local) ||
      local.startsWith("../") ||
      !/^packages\/[^/]+\/src\/.+\.[cm]?tsx?$/.test(local) ||
      /(?:^|\/)(?:dist|node_modules|fixtures|test-fixtures|generated)(?:\/|$)/.test(
        local,
      ) ||
      /\.(?:test|fixture)\.[cm]?tsx?$/.test(local)
    ) {
      throw new Error(`Unexpected coverage source: ${name}`);
    }
    source = true;
    hit ||= [...record.matchAll(/^DA:\d+,(\d+)/gm)].some(
      (match) => Number(match[1]) > 0,
    );
  }
  if (!source || !hit) {
    throw new Error("Coverage must contain executed package source.");
  }
}

/** Node's own JUnit reporter must describe actual, nonfailing test cases. */
export function validateJunit(text) {
  if (
    !/<testsuites?\b/.test(text) ||
    !/<testcase\b/.test(text) ||
    /<(?:failure|error)\b/.test(text) ||
    /\b(?:failures|errors)="[1-9]\d*"/.test(text)
  ) {
    throw new Error("JUnit must contain real tests and no failures.");
  }
}

/** Run one direct Node child and stop it on cancellation, with bounded escalation. */
export function runChild(command, { env = process.env, signal } = {}) {
  return new Promise((fulfill, reject) => {
    const child = spawn("node", command.args, {
      cwd: command.cwd,
      env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    let timer;
    const kill = (force) => {
      if (child.pid === undefined) return;
      if (process.platform === "win32") {
        const killer = spawn(
          "taskkill.exe",
          ["/PID", String(child.pid), "/T", ...(force ? ["/F"] : [])],
          { stdio: "ignore" },
        );
        // A raced process exit can make taskkill fail; the child close event
        // remains authoritative and the forced retry is still bounded.
        killer.once("error", () => child.kill(force ? "SIGKILL" : "SIGTERM"));
      } else {
        try {
          process.kill(-child.pid, force ? "SIGKILL" : "SIGTERM");
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !("code" in error) ||
            error.code !== "ESRCH"
          )
            throw error;
        }
      }
    };
    const cancel = () => {
      kill(process.platform === "win32");
      timer = setTimeout(() => kill(true), 2000);
      timer.unref();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    child.once("error", (error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      reject(error);
    });
    child.once("close", (code) => {
      if (signal?.aborted && process.platform !== "win32") kill(true);
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
      if (signal?.aborted) reject(new Error("Coverage tests cancelled."));
      else if (code !== 0) {
        reject(new Error(`Node test child failed (${code ?? "signal"}).`));
      } else fulfill();
    });
  });
}
