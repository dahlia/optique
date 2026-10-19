import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { builtinModules } from "node:module";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** An exact subprocess invocation, without a shell. */
export interface Command {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
}

/** Audited expected bytes, including line endings. */
export interface Expectation {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** One successfully validated process, measured from spawn to exit. */
export interface Measurement extends Expectation {
  readonly wallMs: number;
  readonly signal: null;
  readonly error: null;
}

/** Throws rather than treating a failed process as a timing sample. */
export function runChecked(
  command: Command,
  expected: Expectation,
  timeout = 10_000,
): Measurement {
  const start = process.hrtime.bigint();
  const result = spawnSync(command.executable, [...command.args], {
    cwd: command.cwd,
    env: command.env,
    encoding: "utf8",
    timeout,
    killSignal: "SIGKILL",
    maxBuffer: 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const wallMs = Number(process.hrtime.bigint() - start) / 1e6;
  if (
    result.error != null || result.signal != null ||
    result.status !== expected.status
  ) {
    const code = result.error != null && "code" in result.error
      ? result.error.code
      : null;
    throw new TypeError(
      `Invalid process status: ${
        JSON.stringify({
          status: result.status,
          signal: result.signal,
          error: code,
          stdout: result.stdout,
          stderr: result.stderr,
        })
      }`,
    );
  }
  if (result.stdout !== expected.stdout || result.stderr !== expected.stderr) {
    throw new TypeError(
      `Unexpected process output: ${
        JSON.stringify({
          expected,
          stdout: result.stdout,
          stderr: result.stderr,
        })
      }`,
    );
  }
  return {
    wallMs,
    status: result.status,
    signal: null,
    error: null,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

/** Midpoint median; nearest-rank p95 is withheld below 100 samples. */
export function summarize(samples: readonly number[]) {
  if (samples.length < 1 || samples.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new RangeError("Samples must be nonempty, finite and nonnegative.");
  }
  const sorted = samples.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    count: sorted.length,
    medianMs: sorted.length % 2 === 1
      ? sorted[middle]
      : sorted[middle - 1] / 2 + sorted[middle] / 2,
    p95Ms: sorted.length < 100
      ? null
      : sorted[Math.ceil(sorted.length * 0.95) - 1],
  };
}

/** SHA-256 of bytes, or UTF-8 text. */
export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Rejects nulls, arrays and primitive values at a data boundary. */
export function record(value: unknown): Record<string, unknown> {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Expected an object.");
  }
  return value as Record<string, unknown>;
}

/** Maps paths to explicit tokens without modifying argument boundaries. */
export function portableCommand(
  command: Command,
  tokens: Readonly<Record<string, string>>,
): Command {
  const replacements = Object.entries(tokens).toSorted((a, b) =>
    b[1].length - a[1].length
  );
  return mapCommand(command, (text) => {
    for (const [name, value] of replacements) {
      text = text.replaceAll(value, `\${${name}}`);
    }
    return text;
  });
}

/** Expands a portable invocation for the current host. */
export function expandCommand(
  command: Command,
  tokens: Readonly<Record<string, string>>,
): Command {
  return mapCommand(
    command,
    (text) =>
      text.replace(/\$\{([A-Z_]+)\}/g, (_, name: string) => {
        const value = tokens[name];
        if (value == null) {
          throw new TypeError(`Unresolved command token: ${name}`);
        }
        return value;
      }),
  );
}

function mapCommand(
  command: Command,
  transform: (text: string) => string,
): Command {
  return {
    executable: transform(command.executable),
    args: command.args.map(transform),
    cwd: transform(command.cwd),
    env: Object.fromEntries(
      Object.entries(command.env).map((
        [key, value],
      ) => [key, transform(value)]),
    ),
  };
}

/** Versioned selection of inputs that can change the measured artifacts. */
export function inputIdentity(root: string) {
  const paths: string[] = [];
  const add = (path: string) => {
    if (existsSync(join(root, path))) paths.push(path);
  };
  const walk = (path: string, include: (path: string) => boolean) => {
    if (!existsSync(join(root, path))) return;
    for (
      const entry of readdirSync(join(root, path), { withFileTypes: true })
    ) {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) walk(child, include);
      else if (entry.isFile() && include(child)) paths.push(child);
    }
  };
  for (
    const path of [
      "LICENSE",
      "package.json",
      "pnpm-workspace.yaml",
      "pnpm-lock.yaml",
      "deno.json",
      "deno.lock",
      "mise.toml",
    ]
  ) add(path);
  for (const name of ["core", "run", "discover"]) {
    const base = `packages/${name}`;
    for (
      const path of [
        "package.json",
        "deno.json",
        "tsdown.config.ts",
        "README.md",
      ]
    ) add(`${base}/${path}`);
    if (existsSync(join(root, base))) {
      for (const file of readdirSync(join(root, base))) {
        if (/^(license|licence|copying)(\..*)?$/i.test(file)) {
          add(`${base}/${file}`);
        }
      }
    }
    walk(`${base}/src`, (path) => !path.endsWith(".test.ts"));
    walk(`${base}/skills`, (path) => !path.endsWith(".test.ts"));
  }
  walk(
    "benchmarks/startup",
    (path) =>
      !path.includes("/results/") && !path.includes("/node_modules/") &&
      !path.endsWith(".test.ts") && !path.endsWith(".md"),
  );
  const files = [...new Set(paths)].sort().map((path) => ({
    path,
    executable: (statSync(join(root, path)).mode & 0o111) !== 0,
    sha256: sha256(readFileSync(join(root, path))),
  }));
  return { schemaVersion: 1, files, hash: sha256(JSON.stringify(files)) };
}

/** Validates Deno 2.x info graphs, permitting builtin modules without files. */
export function validateDenoGraph(
  value: unknown,
  roots: readonly string[],
): void {
  const graph = record(value);
  if (!Array.isArray(graph.modules) || graph.modules.length < 1) {
    throw new TypeError("Missing Deno graph modules.");
  }
  for (const raw of graph.modules) {
    const item = record(raw);
    if (item.error != null || typeof item.specifier !== "string") {
      throw new TypeError("Deno graph contains an error.");
    }
    if (
      item.specifier.startsWith("node:") &&
      builtinModules.includes(item.specifier.slice(5))
    ) continue;
    if (!item.specifier.startsWith("file:")) {
      throw new TypeError(`Unexpected Deno module: ${item.specifier}`);
    }
    const path = realpathSync(fileURLToPath(item.specifier));
    if (!roots.some((root) => isInside(path, realpathSync(root)))) {
      throw new TypeError(`Deno module escaped source roots: ${path}`);
    }
  }
}

/** Includes the root itself, without prefix-confusing sibling paths. */
export function isInside(path: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(path));
  return rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) &&
      !resolve(root, rel).startsWith(`${root}${sep}..`));
}

/** Fingerprints release-pack inputs and benchmark preparation sources. */
export function buildInputIdentity(root: string) {
  const files = inputIdentity(root).files;
  return { files, hash: sha256(JSON.stringify(files)) };
}

/**
 * Runs a synchronous operation without publishing results from changed inputs.
 *
 * @throws {TypeError} If inputs differ from preparation or change during the operation.
 */
export function withStableInputs<T>(
  root: string,
  operation: (identity: Readonly<ReturnType<typeof inputIdentity>>) => T,
  expectedHash?: string,
): T {
  const identity = inputIdentity(root);
  const initialHash = identity.hash;
  if (expectedHash !== undefined && initialHash !== expectedHash) {
    throw new TypeError(
      "Prepared inputs changed; run benchmark:prepare again.",
    );
  }
  const result = operation(identity);
  if (inputIdentity(root).hash !== initialHash) {
    throw new TypeError(
      "Benchmark inputs changed during the operation; run benchmark:prepare again.",
    );
  }
  return result;
}

/** Prevents a prepared Deno graph from being paired with a changed import map. */
export function verifyPreparedMap(path: string, expectedHash: string): void {
  if (sha256(readFileSync(path)) !== expectedHash) {
    throw new TypeError("Prepared Deno import map changed; prepare again.");
  }
}

/**
 * Replaces paths in nested JSON artifact values with a portable root token.
 *
 * @throws {TypeError} If the checkout root is empty or a filesystem root.
 */
export function portableArtifact(
  value: unknown,
  root: string,
  token = "${REPO_ROOT}",
): unknown {
  const prefix = root.replace(/[\\/]+$/, "");
  if (prefix === "" || /^[A-Za-z]:$/.test(prefix)) {
    throw new TypeError("Expected a checkout root.");
  }
  if (typeof value === "string") {
    return value.split(prefix).join(token);
  }
  if (Array.isArray(value)) {
    return value.map((item) => portableArtifact(item, prefix, token));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map((
        [key, item],
      ) => [key, portableArtifact(item, prefix, token)]),
    );
  }
  return value;
}

/**
 * Tokenizes checkout and external consumer paths in nested benchmark evidence.
 *
 * @throws {TypeError} If either root is empty or a filesystem root.
 */
export function portableEvidence(
  value: unknown,
  repoRoot: string,
  consumersRoot: string,
): unknown {
  return Object.entries({
    "${REPO_ROOT}": repoRoot.replace(/[\\/]+$/, ""),
    "${CONSUMERS_ROOT}": consumersRoot.replace(/[\\/]+$/, ""),
  }).sort(([, left], [, right]) => right.length - left.length)
    .reduce<unknown>(
      (artifact, [token, prefix]) => portableArtifact(artifact, prefix, token),
      value,
    );
}
