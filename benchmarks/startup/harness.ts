import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { arch, cpus, loadavg, platform, release, totalmem } from "node:os";
import { parse, stringify } from "yaml";
import {
  buildInputIdentity,
  type Command,
  type Expectation,
  inputIdentity,
  isInside,
  portableArtifact,
  portableCommand,
  record,
  runChecked,
  sha256,
  summarize,
  validateDenoGraph,
  verifyPreparedMap,
} from "./contract.ts";
import {
  consumerRoot,
  createConsumerRoot,
  removeConsumerRoot,
  verifyConsumerAncestors,
} from "./isolation.ts";
import {
  archiveIntegrity,
  classifyFile,
  inventoryTree,
  readTar,
  verifyInventory,
  verifyLock,
  verifyPackList,
} from "./inventory.ts";
import {
  type CaseResult,
  type RawSample,
  rawSample,
  readReport,
  type Report,
  writeReport,
} from "./results.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const directory = fileURLToPath(new URL("./", import.meta.url));
const work = join(root, "tmp/startup-baseline");
const marker = "optique-startup-baseline-v1\n";
const packages = ["core", "run", "discover"] as const;
const exclusions = [
  ".modules.yaml",
  ".pnpm/lock.yaml",
  ".pnpm-workspace-state-v1.json",
];

interface Request {
  readonly id: string;
  readonly args: readonly string[];
  readonly status: number;
}
interface Consumer {
  readonly id: string;
  readonly packages: readonly string[];
}
interface Manifest {
  readonly schemaVersion: 1;
  readonly pnpmVersion: string;
  readonly imports: readonly string[];
  readonly consumers: readonly Consumer[];
  readonly requests: readonly Request[];
  readonly minimalRequests: readonly Request[];
  readonly discoveryImports: readonly string[];
}
interface Archive {
  readonly name: string;
  readonly specifier: string;
  readonly integrity: string;
  readonly contentHash: string;
  readonly compressedBytes: number;
  readonly expandedBytes: number;
  readonly categories: Readonly<Record<string, number>>;
}
interface Prepared {
  readonly schemaVersion: 1;
  readonly runtimes: Readonly<Record<string, string>>;
  readonly binaries: Readonly<Record<string, string>>;
  readonly archives: readonly Archive[];
  readonly consumers: readonly Record<string, unknown>[];
  readonly preparationCommands: readonly Command[];
  readonly denoGraph: unknown;
  readonly importMapHash: string;
  readonly packageInputsHash: string;
}
interface Case {
  readonly id: string;
  readonly command: Command;
  readonly expected: Expectation;
  readonly loadingMode: string;
  readonly fixture: string;
  readonly request: string;
}

function strings(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError("Expected a string array.");
  }
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError("Expected nonempty text.");
  }
  return value;
}
function requests(value: unknown): readonly Request[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError("Missing fixture requests.");
  }
  const result = value.map((raw) => {
    const item = record(raw);
    if (item.status !== 0 && item.status !== 1) {
      throw new TypeError("Invalid expected status.");
    }
    return { id: text(item.id), args: strings(item.args), status: item.status };
  });
  if (new Set(result.map((item) => item.id)).size !== result.length) {
    throw new TypeError("Duplicate fixture request.");
  }
  return result;
}
function manifest(): Manifest {
  const value = record(
    JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8")),
  );
  if (value.schemaVersion !== 1 || !Array.isArray(value.consumers)) {
    throw new TypeError("Unsupported fixture manifest.");
  }
  const consumers = value.consumers.map((raw) => {
    const item = record(raw);
    return { id: text(item.id), packages: strings(item.packages) };
  });
  if (
    JSON.stringify(consumers) !==
      JSON.stringify([{
        id: "core-run",
        packages: ["@optique/core", "@optique/run"],
      }, {
        id: "discover",
        packages: ["@optique/core", "@optique/run", "@optique/discover"],
      }])
  ) throw new TypeError("Unexpected measured package graph.");
  return {
    schemaVersion: 1,
    pnpmVersion: text(value.pnpmVersion),
    imports: strings(value.imports),
    consumers,
    requests: requests(value.requests),
    minimalRequests: requests(value.minimalRequests),
    discoveryImports: strings(value.discoveryImports),
  };
}

function binary(name: string): string {
  const result = spawnSync("mise", ["which", name], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new TypeError(`Cannot resolve runtime ${name}: ${result.stderr}`);
  }
  const path = realpathSync(result.stdout.trim());
  if (
    path.includes(`${sep}shims${sep}`) ||
    readFileSync(path).subarray(0, 2).toString() === "#!"
  ) throw new TypeError(`Runtime must be a real executable: ${path}`);
  return path;
}
function environment(
  binaries: Readonly<Record<string, string>>,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    PATH: [...new Set(Object.values(binaries).map(dirname)), "/usr/bin", "/bin"]
      .join(":"),
    HOME: join(work, "home"),
    PNPM_CONFIG_NPMRC_AUTH_FILE: join(work, "empty.npmrc"),
    XDG_CONFIG_HOME: join(work, "config"),
    TMPDIR: join(work, "temporary"),
    LANG: "C",
    LC_ALL: "C",
    TZ: "UTC",
    NO_COLOR: "1",
    TERM: "dumb",
    COLUMNS: "80",
    LINES: "24",
    NODE_DISABLE_COMPILE_CACHE: "1",
    DENO_DIR: join(work, "deno-cache"),
    DENO_NO_UPDATE_CHECK: "1",
    DENO_NO_PROMPT: "1",
    BUN_RUNTIME_TRANSPILER_CACHE_PATH: join(work, "bun-cache"),
    ...extra,
  };
}
function tokens(prepared: Pick<Prepared, "binaries">): Record<string, string> {
  const result: Record<string, string> = {
    REPO_ROOT: root.replace(/\/$/, ""),
    CONSUMERS_ROOT: consumerRoot(work),
  };
  for (const [name, path] of Object.entries(prepared.binaries)) {
    result[`${name.toUpperCase()}_BIN`] = path;
    result[`${name.toUpperCase()}_DIR`] = dirname(path);
  }
  return result;
}
function portableEvidence(value: unknown): unknown {
  return portableArtifact(
    portableArtifact(value, root),
    consumerRoot(work),
    "${CONSUMERS_ROOT}",
  );
}
function invoke(command: Command, commands?: Command[]): string {
  commands?.push(command);
  const result = spawnSync(command.executable, [...command.args], {
    cwd: command.cwd,
    env: command.env,
    encoding: "utf8",
    timeout: 180_000,
    killSignal: "SIGKILL",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error != null || result.status !== 0 || result.signal != null) {
    throw new TypeError(
      `Preparation failed: ${
        JSON.stringify({
          command,
          status: result.status,
          signal: result.signal,
          error: result.error?.message,
          stdout: result.stdout,
          stderr: result.stderr,
        })
      }`,
    );
  }
  return result.stdout;
}
function json(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}
function listFiles(base: string): readonly string[] {
  return readdirSync(base, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? listFiles(join(base, entry.name)).map((path) => `${entry.name}/${path}`)
      : [entry.name]
  ).sort();
}

function prepare(): void {
  const definition = manifest();
  const binaries = Object.fromEntries(
    ["node", "deno", "bun", "pnpm"].map((name) => [name, binary(name)]),
  );
  if (existsSync(work)) {
    if (
      !existsSync(join(work, ".owned")) ||
      readFileSync(join(work, ".owned"), "utf8") !== marker ||
      realpathSync(work) !== resolve(work)
    ) {
      throw new TypeError(
        "Refusing to remove an unowned preparation directory.",
      );
    }
    removeConsumerRoot(work);
    rmSync(work, { recursive: true });
  }
  for (
    const path of [
      "",
      "home",
      "config",
      "temporary",
      "tarballs",
      "store",
      "deno-cache",
      "bun-cache",
      "node-cache",
    ]
  ) mkdirSync(join(work, path), { recursive: true });
  writeFileSync(join(work, ".owned"), marker);
  createConsumerRoot(work);
  mkdirSync(join(consumerRoot(work), "tarballs"));
  writeFileSync(join(work, "empty.npmrc"), "");
  const env = environment(binaries);
  const commands: Command[] = [];
  const runtimes = Object.fromEntries(
    Object.entries(binaries).map((
      [name, executable],
    ) => [
      name,
      invoke({ executable, args: ["--version"], cwd: root, env }, commands)
        .trim(),
    ]),
  );
  if (runtimes.pnpm !== definition.pnpmVersion) {
    throw new TypeError(
      `Expected pnpm ${definition.pnpmVersion}, received ${runtimes.pnpm}.`,
    );
  }
  const archives: Archive[] = [];
  for (const name of packages) {
    const file = join(work, `tarballs/${name}.tgz`);
    const output = invoke({
      executable: binaries.pnpm,
      args: [
        "pack",
        "--out",
        file,
        "--json",
      ],
      cwd: join(root, `packages/${name}`),
      env,
    }, commands);
    writeFileSync(join(work, `tarballs/${name}-pack.json`), output);
    const bytes = readFileSync(file), files = readTar(bytes);
    copyFileSync(file, join(consumerRoot(work), `tarballs/${name}.tgz`));
    const structuredStart = output.lastIndexOf("\n{") + 1;
    verifyPackList(
      JSON.parse(output.slice(structuredStart)),
      files.map((file) => file.path),
    );
    const packed = record(
      JSON.parse(
        Buffer.from(
          files.find((file) => file.path === "package.json")?.bytes ?? [],
        ).toString(),
      ),
    );
    if (JSON.stringify(packed).includes("workspace:")) {
      throw new TypeError("Packed manifest retained a workspace dependency.");
    }
    const localLicense = readdirSync(join(root, `packages/${name}`)).find((
      path,
    ) => /^licen[cs]e(\..*)?$/i.test(path));
    const license = files.find((file) =>
      /^licen[cs]e(\..*)?$/i.test(file.path)
    );
    const expectedLicense = readFileSync(
      join(
        root,
        localLicense == null ? "LICENSE" : `packages/${name}/${localLicense}`,
      ),
    );
    if (license == null || license.sha256 !== sha256(expectedLicense)) {
      throw new TypeError(
        "Packed license does not match its inherited or local source.",
      );
    }
    const categories: Record<string, number> = {
      esm: 0,
      cjs: 0,
      declarations: 0,
      other: 0,
    };
    for (const file of files) categories[classifyFile(file.path)] += file.size;
    archives.push({
      name: `@optique/${name}`,
      specifier: `file:../tarballs/${name}.tgz`,
      integrity: archiveIntegrity(bytes),
      contentHash: sha256(
        JSON.stringify(
          files.map(({ path, size, sha256: hash }) => ({
            path,
            size,
            sha256: hash,
          })),
        ),
      ),
      compressedBytes: bytes.length,
      expandedBytes: files.reduce((sum, file) => sum + file.size, 0),
      categories,
    });
  }
  const consumers: Record<string, unknown>[] = [];
  for (const consumer of definition.consumers) {
    const cwd = join(consumerRoot(work), consumer.id);
    mkdirSync(cwd, { recursive: true });
    cpSync(join(directory, "fixtures"), join(cwd, "fixtures"), {
      recursive: true,
    });
    const selected = archives.filter((archive) =>
      consumer.packages.includes(archive.name)
    );
    const overrides = Object.fromEntries(
      selected.map((archive) => [archive.name, archive.specifier]),
    );
    json(join(cwd, "package.json"), {
      name: `startup-${consumer.id}`,
      private: true,
      type: "module",
      dependencies: overrides,
    });
    writeFileSync(
      join(cwd, "pnpm-workspace.yaml"),
      stringify({ packages: [], overrides }),
    );
    const install = {
      executable: binaries.pnpm,
      cwd,
      env,
      args: [
        "install",
        "--prod",
        "--offline",
        "--ignore-scripts",
        "--no-frozen-lockfile",
        "--package-import-method=copy",
        `--store-dir=${join(work, "store")}`,
        "--node-linker=isolated",
        "--config.enable-global-virtual-store=false",
        "--config.link-workspace-packages=false",
        "--config.shared-workspace-lockfile=false",
      ],
    };
    invoke(install, commands);
    const lockText = readFileSync(join(cwd, "pnpm-lock.yaml"), "utf8");
    verifyLock(parse(lockText), selected);
    const modules = record(
      parse(readFileSync(join(cwd, "node_modules/.modules.yaml"), "utf8")),
    );
    if (
      modules.nodeLinker !== "isolated" ||
      !isInside(text(modules.storeDir), join(work, "store")) ||
      text(modules.virtualStoreDir) !== ".pnpm"
    ) {
      throw new TypeError(
        "Installed pnpm layout differs from requested isolation settings.",
      );
    }
    const graph = JSON.parse(
      invoke({
        executable: binaries.pnpm,
        args: [
          "list",
          "--json",
          "--depth",
          "Infinity",
          "--prod",
        ],
        cwd,
        env,
      }, commands),
    );
    for (const archive of selected) {
      const path = realpathSync(join(cwd, `node_modules/${archive.name}`));
      if (!isInside(path, join(cwd, "node_modules"))) {
        throw new TypeError("Workspace link found in measured installation.");
      }
      const files = readTar(
        readFileSync(join(work, `tarballs/${archive.name.slice(9)}.tgz`)),
      );
      const actual = listFiles(path).filter((file) =>
        !file.startsWith("node_modules/")
      );
      if (
        actual.join("\0") !== files.map((file) => file.path).sort().join("\0")
      ) {
        throw new TypeError(
          `Installed package file list differs from archive: ${archive.name}`,
        );
      }
      for (const file of files) {
        const installed = join(path, file.path);
        if (
          statSync(installed).nlink !== 1 ||
          sha256(readFileSync(installed)) !== file.sha256
        ) {
          throw new TypeError(
            `Installed package differs from copied archive: ${installed}`,
          );
        }
      }
    }
    const inventory = inventoryTree(join(cwd, "node_modules"), exclusions);
    for (const file of inventory.files) {
      if (
        file.path.startsWith(".") && !file.path.startsWith(".pnpm/") &&
        !file.path.startsWith(".bin/")
      ) throw new TypeError(`Unknown installation metadata: ${file.path}`);
    }
    consumers.push({
      id: consumer.id,
      uniquePackageCount: selected.length,
      packages: selected.map((archive) => archive.name),
      graph,
      lockHash: sha256(lockText),
      packageImportMethod: "copy",
      nodeLinker: "isolated",
      modules,
      exclusions,
      symlinks: "followed, realpath-deduplicated, contained in node_modules",
      externalStoreExcluded: true,
      compressedBytes: selected.reduce(
        (sum, archive) => sum + archive.compressedBytes,
        0,
      ),
      expandedBytes: selected.reduce(
        (sum, archive) => sum + archive.expandedBytes,
        0,
      ),
      inventory,
    });
  }
  const imports: Record<string, string> = {};
  for (const name of ["core", "run"]) {
    const config = record(
      JSON.parse(
        readFileSync(join(root, `packages/${name}/deno.json`), "utf8"),
      ),
    );
    for (const [key, value] of Object.entries(record(config.exports))) {
      imports[`@optique/${name}${key === "." ? "" : key.slice(1)}`] =
        pathToFileURL(join(root, `packages/${name}`, text(value))).href;
    }
  }
  const mapFile = join(work, "deno-import-map.json");
  json(mapFile, { imports });
  const fixture = join(consumerRoot(work), "core-run/fixtures/three.js");
  invoke({
    executable: binaries.deno,
    args: [
      "cache",
      "--no-config",
      "--no-lock",
      "--import-map",
      mapFile,
      fixture,
    ],
    cwd: work,
    env,
  }, commands);
  const denoGraph = JSON.parse(
    invoke({
      executable: binaries.deno,
      args: [
        "info",
        "--json",
        "--no-config",
        "--no-lock",
        "--import-map",
        mapFile,
        fixture,
      ],
      cwd: work,
      env,
    }, commands),
  );
  validateDenoGraph(denoGraph, [
    join(root, "packages/core/src"),
    join(root, "packages/run/src"),
    join(consumerRoot(work), "core-run/fixtures"),
  ]);
  const prepared: Prepared = {
    schemaVersion: 1,
    binaries,
    runtimes,
    archives,
    consumers,
    preparationCommands: commands,
    denoGraph,
    importMapHash: sha256(readFileSync(mapFile)),
    packageInputsHash: packageInputsHash(),
  };
  json(join(work, "prepared.json"), prepared);
  console.log(
    `Prepared ${consumers.length} isolated consumers and ${archives.length} verified local tarballs.`,
  );
}

function prepared(): Prepared {
  verifyConsumerAncestors(consumerRoot(work));
  const value: Prepared = JSON.parse(
    readFileSync(join(work, "prepared.json"), "utf8"),
  );
  if (value.schemaVersion !== 1) {
    throw new TypeError("Unsupported preparation format.");
  }
  if (value.packageInputsHash !== packageInputsHash()) {
    throw new TypeError("Packed source inputs changed; prepare again.");
  }
  verifyPreparedMap(join(work, "deno-import-map.json"), value.importMapHash);
  for (const consumer of manifest().consumers) {
    const copied = join(consumerRoot(work), `${consumer.id}/fixtures`);
    if (
      listFiles(copied).join("\0") !==
        listFiles(join(directory, "fixtures")).join("\0")
    ) throw new TypeError("Prepared fixture file list changed.");
    for (const path of listFiles(copied)) {
      if (
        sha256(readFileSync(join(copied, path))) !==
          sha256(readFileSync(join(directory, "fixtures", path)))
      ) throw new TypeError("Prepared fixture changed; prepare again.");
    }
    const expected = value.consumers.find((item) => item.id === consumer.id);
    if (
      expected == null ||
      expected.lockHash !==
        sha256(
          readFileSync(
            join(consumerRoot(work), `${consumer.id}/pnpm-lock.yaml`),
          ),
        )
    ) throw new TypeError("Prepared consumer lock changed.");
    verifyInventory(
      inventoryTree(
        join(consumerRoot(work), `${consumer.id}/node_modules`),
        exclusions,
      ),
      expected.inventory,
    );
  }
  for (const archive of value.archives) {
    if (
      archive.integrity !==
        archiveIntegrity(
          readFileSync(join(work, `tarballs/${archive.name.slice(9)}.tgz`)),
        )
    ) throw new TypeError("Prepared tarball changed.");
  }
  return value;
}
function packageInputsHash(): string {
  return buildInputIdentity(root).hash;
}

function expectation(
  fixture: string,
  request: Request,
  audit: boolean,
): Expectation {
  if (audit) return { status: request.status, stdout: "", stderr: "" };
  return {
    status: request.status,
    stdout: readFileSync(
      join(directory, `golden/${fixture}-${request.id}.stdout`),
      "utf8",
    ),
    stderr: readFileSync(
      join(directory, `golden/${fixture}-${request.id}.stderr`),
      "utf8",
    ),
  };
}
function cases(state: Prepared, audit = false): readonly Case[] {
  const definition = manifest(), env = environment(state.binaries);
  const result: Case[] = [];
  const add = (
    id: string,
    runtime: string,
    consumer: string,
    fixture: string,
    request: Request,
    loadingMode: string,
    prefix: readonly string[] = [],
    entry = `${fixture}.js`,
    extraEnv: Readonly<Record<string, string>> = {},
  ) => {
    const cwd = join(consumerRoot(work), consumer);
    result.push({
      id,
      command: {
        executable: state.binaries[runtime],
        args: [...prefix, join(cwd, `fixtures/${entry}`), ...request.args],
        cwd,
        env: { ...env, ...extraEnv },
      },
      expected: expectation(fixture, request, audit),
      loadingMode,
      fixture,
      request: request.id,
    });
  };
  const core = join(consumerRoot(work), "core-run");
  result.push({
    id: "node-empty",
    command: {
      executable: state.binaries.node,
      args: [join(core, "fixtures/empty.mjs")],
      cwd: core,
      env,
    },
    expected: { status: 0, stdout: "", stderr: "" },
    loadingMode: "empty-esm",
    fixture: "empty",
    request: "import",
  });
  for (const specifier of definition.imports) {
    const consumer = specifier.startsWith("@optique/discover")
      ? "discover"
      : "core-run";
    const cwd = join(consumerRoot(work), consumer);
    result.push({
      id: `node-import:${specifier}`,
      command: {
        executable: state.binaries.node,
        args: [
          "--input-type=module",
          "-e",
          `import ${JSON.stringify(specifier)};`,
        ],
        cwd,
        env,
      },
      expected: { status: 0, stdout: "", stderr: "" },
      loadingMode: "packaged-esm-import-only",
      fixture: "import",
      request: specifier,
    });
  }
  for (const request of definition.minimalRequests) {
    add(
      `node-minimal-${request.id}`,
      "node",
      "core-run",
      "minimal",
      request,
      "packaged-esm",
    );
  }
  for (const fixture of ["three", "discovery"]) {
    for (const request of definition.requests) {
      add(
        `node-${fixture}-${request.id}`,
        "node",
        fixture === "discovery" ? "discover" : "core-run",
        fixture,
        request,
        fixture === "discovery"
          ? "packaged-esm-filesystem-discovery"
          : "packaged-esm",
      );
    }
  }
  for (
    const request of definition.requests.filter((request) =>
      ["root-help", "dispatch"].includes(request.id)
    )
  ) {
    add(
      `cjs-three-${request.id}`,
      "node",
      "core-run",
      "three",
      request,
      "packaged-cjs",
      [],
      "three.cjs",
    );
    add(
      `bun-three-${request.id}`,
      "bun",
      "core-run",
      "three",
      request,
      "packaged-esm-bun",
      ["--no-install", "--no-env-file"],
    );
    add(
      `deno-three-${request.id}`,
      "deno",
      "core-run",
      "three",
      request,
      "checkout-typescript-explicit-import-map",
      [
        "run",
        "--no-config",
        "--no-lock",
        "--cached-only",
        "--no-code-cache",
        "--no-prompt",
        "--allow-read",
        "--allow-env=COLUMNS,NO_COLOR,TERM,LANG,LC_ALL,TZ",
        "--import-map",
        join(work, "deno-import-map.json"),
      ],
    );
    const cacheEnv: Record<string, string> = {
      ...env,
      NODE_COMPILE_CACHE: join(work, "node-cache"),
    };
    delete cacheEnv.NODE_DISABLE_COMPILE_CACHE;
    add(
      `node-cache-three-${request.id}`,
      "node",
      "core-run",
      "three",
      request,
      "packaged-esm-prepopulated-node-compile-cache",
      [],
      "three.js",
      cacheEnv,
    );
    const cached = result.at(-1)!;
    result[result.length - 1] = {
      ...cached,
      command: { ...cached.command, env: cacheEnv },
    };
  }
  result.push({
    id: "cjs-import:@optique/core",
    command: {
      executable: state.binaries.node,
      args: ["-e", "require('@optique/core');"],
      cwd: core,
      env,
    },
    expected: { status: 0, stdout: "", stderr: "" },
    loadingMode: "packaged-cjs-import-only",
    fixture: "import",
    request: "@optique/core",
  });
  return result;
}

function validate(state: Prepared): void {
  const observations: Record<string, unknown>[] = [];
  for (const item of cases(state)) {
    const baseline = runChecked(item.command, item.expected);
    if (!item.id.startsWith("node-") && !item.id.startsWith("cjs-")) continue;
    const trace = join(work, "trace.jsonl");
    writeFileSync(trace, "");
    const command = {
      ...item.command,
      args: ["--import", join(directory, "trace.mjs"), ...item.command.args],
      env: { ...item.command.env, STARTUP_TRACE: trace },
    };
    runChecked(command, item.expected);
    const loaded = readFileSync(trace, "utf8").trim().split("\n").filter(
      Boolean,
    ).map((line) => record(JSON.parse(line)));
    for (const entry of loaded) {
      const path = fileURLToPath(text(entry.url));
      if (path.includes(`${sep}node_modules${sep}`)) {
        if (
          !isInside(realpathSync(path), join(item.command.cwd, "node_modules"))
        ) throw new TypeError("Runtime loaded a package outside its consumer.");
        if (!path.includes(`${sep}@optique${sep}`)) continue;
        if (
          item.id.startsWith("cjs-")
            ? !path.endsWith(".cjs")
            : !/\.(js|mjs)$/.test(path)
        ) throw new TypeError(`Wrong module condition loaded: ${path}`);
      }
    }
    if (item.fixture === "discovery") {
      const fixtureRoot = join(item.command.cwd, "fixtures");
      const imports = loaded.map((entry) =>
        relative(fixtureRoot, fileURLToPath(text(entry.url))).replaceAll(
          "\\",
          "/",
        )
      ).filter((path) =>
        path.startsWith("commands/") || path.startsWith("handlers/")
      ).sort();
      if (
        JSON.stringify(imports) !==
          JSON.stringify([...manifest().discoveryImports].sort())
      ) throw new TypeError("Discovery eager-import expectations changed.");
      observations.push({
        id: item.id,
        imports,
        handlerInvoked: item.request === "dispatch",
        output: { stdout: baseline.stdout, stderr: baseline.stderr },
      });
    }
  }
  const core = join(consumerRoot(work), "core-run");
  const bunResolution = invoke({
    executable: state.binaries.bun,
    args: [
      "--no-install",
      "--no-env-file",
      "-e",
      "console.log(Bun.resolveSync('@optique/run', process.cwd()))",
    ],
    cwd: core,
    env: environment(state.binaries),
  }).trim();
  if (
    !isInside(realpathSync(bunResolution), join(core, "node_modules")) ||
    !bunResolution.endsWith(".js")
  ) throw new TypeError("Bun resolved an unexpected installation.");
  json(
    join(work, "validation.json"),
    portableEvidence({
      schemaVersion: 1,
      observations,
      bunResolution,
      denoGraph: state.denoGraph,
      note:
        "Separate instrumented validation; no traced process contributes a timing sample.",
    }),
  );
  console.log(
    `Validated ${
      cases(state).length
    } runtime cases and all eager discovery imports.`,
  );
}

function audit(state: Prepared): void {
  for (
    const item of cases(state, true).filter((item) =>
      item.id.startsWith("node-minimal-") ||
      item.id.startsWith("node-three-") || item.id.startsWith("node-discovery-")
    )
  ) {
    const result = spawnSync(item.command.executable, [...item.command.args], {
      cwd: item.command.cwd,
      env: item.command.env,
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    if (
      result.status !== item.expected.status || result.error != null ||
      result.signal != null
    ) throw new TypeError(`Golden audit failed: ${JSON.stringify(result)}`);
    writeFileSync(
      join(directory, `golden/${item.fixture}-${item.request}.stdout`),
      result.stdout,
    );
    writeFileSync(
      join(directory, `golden/${item.fixture}-${item.request}.stderr`),
      result.stderr,
    );
  }
  console.log(
    "Wrote candidate goldens. Read and audit their bytes before measurement; this command never runs in CI.",
  );
}

function cacheProbe(state: Prepared): unknown {
  const command = {
    executable: state.binaries.node,
    args: [
      "-e",
      "console.log(require('node:module').getCompileCacheDir() ?? 'disabled')",
    ],
    cwd: work,
    env: environment(state.binaries),
  };
  const disabled = invoke(command).trim();
  const env: Record<string, string> = {
    ...command.env,
    NODE_COMPILE_CACHE: join(work, "node-cache"),
  };
  delete env.NODE_DISABLE_COMPILE_CACHE;
  const enabled = invoke({ ...command, env }).trim();
  if (disabled !== "disabled" || !isInside(enabled, join(work, "node-cache"))) {
    throw new TypeError(
      "Node compile-cache probe did not confirm requested cache modes.",
    );
  }
  return { disabled, prepopulated: relative(root, enabled) };
}

function measure(
  state: Prepared,
  mode: "smoke" | "baseline",
  path: string,
): Report {
  const sampleCount = mode === "baseline" ? 100 : 3,
    warmupCount = mode === "baseline" ? 5 : 1;
  const definitions = cases(state),
    replacements = tokens(state),
    initialIdentity = inputIdentity(root);
  rmSync(join(work, "node-cache"), { recursive: true, force: true });
  mkdirSync(join(work, "node-cache"));
  const probe = cacheProbe(state);
  for (
    const item of definitions.filter((item) =>
      item.id.startsWith("node-cache-")
    )
  ) runChecked(item.command, item.expected);
  const outputs: Record<string, { stdout: string; stderr: string }> = {};
  const samples = new Map<string, RawSample[]>(),
    warmups = new Map<string, RawSample[]>();
  for (const item of definitions) {
    samples.set(item.id, []);
    warmups.set(item.id, []);
  }
  const startedAt = new Date().toISOString();
  const beforeLoad = loadavg();
  for (let round = 0; round < warmupCount; round++) {
    for (const item of definitions) {
      warmups.get(item.id)!.push(
        rawSample(runChecked(item.command, item.expected), outputs),
      );
    }
  }
  const order: string[][] = [];
  for (let round = 0; round < sampleCount; round++) {
    const interleaved = [
      ...definitions.slice(round % definitions.length),
      ...definitions.slice(0, round % definitions.length),
    ];
    order.push(interleaved.map((item) => item.id));
    for (const item of interleaved) {
      samples.get(item.id)!.push(
        rawSample(runChecked(item.command, item.expected), outputs),
      );
    }
  }
  if (initialIdentity.hash !== inputIdentity(root).hash) {
    throw new TypeError("Measured inputs changed during the run.");
  }
  const results: CaseResult[] = definitions.map((item) => ({
    id: item.id,
    expectedStatus: item.expected.status,
    expectedOutputHash: sha256(
      JSON.stringify({
        stdout: item.expected.stdout,
        stderr: item.expected.stderr,
      }),
    ),
    command: portableCommand(item.command, replacements),
    loadingMode: item.loadingMode,
    warmups: warmups.get(item.id)!,
    samples: samples.get(item.id)!,
    summary: summarize(samples.get(item.id)!.map((sample) => sample.wallMs)),
  }));
  const revision = invoke({
    executable: "/usr/bin/git",
    args: ["rev-parse", "HEAD"],
    cwd: root,
    env: environment(state.binaries),
  }).trim();
  const metadata = {
    revision,
    startedAt,
    finishedAt: new Date().toISOString(),
    identity: initialIdentity.hash,
    inputSelection: initialIdentity,
    manifestHash: sha256(readFileSync(join(directory, "manifest.json"))),
    runtimes: state.runtimes,
    lockfiles: Object.fromEntries(
      ["pnpm-lock.yaml", "deno.lock"].map((
        path,
      ) => [path, sha256(readFileSync(join(root, path)))]),
    ),
    importMapHash: state.importMapHash,
    archives: state.archives,
    consumers: state.consumers,
    host: {
      platform: platform(),
      release: release(),
      arch: arch(),
      cpu: cpus()[0]?.model,
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
      loadBefore: beforeLoad,
      loadAfter: loadavg(),
    },
    outputMode: "bounded stdout/stderr pipes; stdin ignored",
    quantiles:
      "median: midpoint of middle pair; p95: nearest rank ceil(0.95*n), withheld below n=100",
    interleaving:
      "round-robin, case order rotated left by sample index; warmups in manifest order",
    caches: {
      node: "disabled except two explicitly prepopulated cases",
      probe,
      deno:
        "owned DENO_DIR; transpile dependencies prewarmed, V8 code cache disabled",
      bun:
        "owned runtime transpiler cache; only sufficiently large files use it",
      clearing:
        "prepare recreates marked tmp/startup-baseline and its owned external consumers; each run clears own node-cache before untimed prepopulation",
      filesystem:
        "warm/unspecified OS filesystem cache; fresh processes are not cold filesystem cache",
    },
    preparationCommands: state.preparationCommands.map((command) =>
      portableCommand(command, replacements)
    ),
    commandTokens:
      "REPO_ROOT=checkout; CONSUMERS_ROOT=owned external directory from consumer-root.json; *_BIN=mise which runtime; *_DIR=dirname of that binary",
  };
  const sanitized = record(portableEvidence(metadata));
  const report: Report = {
    schemaVersion: 1,
    mode,
    sampleCount,
    warmupCount,
    metadata: sanitized,
    order,
    outputs,
    cases: results,
  };
  writeReport(path, report);
  console.log(
    `${mode}: ${definitions.length} cases × ${sampleCount} samples -> ${
      relative(root, path)
    }`,
  );
  return report;
}

function main(): void {
  const operation = process.argv[2];
  if (operation === "prepare") return prepare();
  if (operation === "check") {
    readReport(process.argv[3]);
    return;
  }
  const state = prepared();
  if (operation === "audit") return audit(state);
  if (operation === "validate") return validate(state);
  if (operation === "smoke") {
    validate(state);
    measure(state, "smoke", join(work, "smoke.json"));
    return;
  }
  if (operation === "baseline") {
    validate(state);
    const reports = [1, 2, 3].map((index) =>
      measure(state, "baseline", join(work, `run-${index}.json`))
    );
    const identities = reports.map((report) =>
      JSON.stringify([
        report.metadata.identity,
        report.metadata.runtimes,
        report.metadata.archives,
        report.metadata.consumers,
      ])
    );
    if (new Set(identities).size !== 1) {
      throw new TypeError(
        "Cannot compare runs with different measured identities.",
      );
    }
    json(
      join(work, "spread.json"),
      reports[0].cases.map((item) => {
        const medians = reports.map((report) =>
          report.cases.find((candidate) => candidate.id === item.id)!.summary
            .medianMs
        );
        return {
          id: item.id,
          medians,
          spreadMs: Math.max(...medians) - Math.min(...medians),
          spreadPercent: 100 * (Math.max(...medians) - Math.min(...medians)) /
            summarize(medians).medianMs,
        };
      }),
    );
    return;
  }
  throw new TypeError(
    "Expected prepare, audit, validate, smoke, baseline or check.",
  );
}
if (
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) main();
