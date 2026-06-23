import assert from "node:assert/strict";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  generateCommandsModule,
  watchCommandsModule,
  writeCommandsModule,
} from "#src/generator.ts";

describe("generateCommandsModule()", () => {
  it("should generate a default export from command files", async () => {
    const dir = await makeTempDir();
    try {
      const commandsDir = join(dir, "src", "commands");
      const outputFile = join(dir, "src", "generated.ts");
      await writeText(join(commandsDir, "build.ts"), "");
      await writeText(join(commandsDir, "user", "add.ts"), "");

      const result = await generateCommandsModule({
        dir: commandsDir,
        outputFile,
        extensions: [".ts"],
      });

      assert.deepEqual(result.files.map((file) => file.modulePath), [
        "./commands/build.ts",
        "./commands/user/add.ts",
      ]);
      assert.equal(
        result.code,
        `import { commandsFromModules } from "@optique/discover";
import * as cmd0 from "./commands/build.ts";
import * as cmd1 from "./commands/user/add.ts";

export default commandsFromModules(
  {
    "./commands/build.ts": cmd0,
    "./commands/user/add.ts": cmd1,
  },
  {
    base: "./commands",
    extensions: [".ts"],
  },
);
`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should ignore declaration files and non-matching extensions", async () => {
    const dir = await makeTempDir();
    try {
      const commandsDir = join(dir, "commands");
      const outputFile = join(dir, "generated.ts");
      await writeText(join(commandsDir, "add.ts"), "");
      await writeText(join(commandsDir, "add.d.ts"), "");
      await writeText(join(commandsDir, "notes.txt"), "");

      const result = await generateCommandsModule({
        dir: commandsDir,
        outputFile,
        extensions: [".ts"],
      });

      assert.deepEqual(result.files.map((file) => file.modulePath), [
        "./commands/add.ts",
      ]);
      assert.doesNotMatch(result.code, /add\.d\.ts/);
      assert.doesNotMatch(result.code, /notes\.txt/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should include custom entry file options", async () => {
    const dir = await makeTempDir();
    try {
      const commandsDir = join(dir, "commands");
      const outputFile = join(dir, "generated.ts");
      await writeText(join(commandsDir, "index.ts"), "");

      const result = await generateCommandsModule({
        dir: commandsDir,
        outputFile,
        extensions: [".ts"],
        entryFileName: false,
      });

      assert.match(result.code, /entryFileName: false/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should use an explicit base for module map keys", async () => {
    const dir = await makeTempDir();
    try {
      const commandsDir = join(dir, "src", "commands");
      const outputFile = join(dir, "src", "generated.ts");
      await writeText(join(commandsDir, "build.ts"), "");

      const result = await generateCommandsModule({
        dir: commandsDir,
        outputFile,
        base: "@commands",
        extensions: [".ts"],
      });

      assert.deepEqual(result.files.map((file) => file.modulePath), [
        "@commands/build.ts",
      ]);
      assert.match(result.code, /"@commands\/build\.ts": cmd0/);
      assert.match(result.code, /base: "@commands"/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should encode import specifiers without changing module map keys", async () => {
    const dir = await makeTempDir();
    try {
      const commandsDir = join(dir, "src", "commands");
      const outputFile = join(dir, "src", "generated.ts");
      await writeText(join(commandsDir, "user#name", "build%fast.ts"), "");

      const result = await generateCommandsModule({
        dir: commandsDir,
        outputFile,
        extensions: [".ts"],
      });

      assert.deepEqual(
        result.files.map((file) => ({
          importSpecifier: file.importSpecifier,
          modulePath: file.modulePath,
        })),
        [
          {
            importSpecifier: "./commands/user%23name/build%25fast.ts",
            modulePath: "./commands/user#name/build%fast.ts",
          },
        ],
      );
      assert.match(
        result.code,
        /import \* as cmd0 from "\.\/commands\/user%23name\/build%25fast\.ts";/,
      );
      assert.match(
        result.code,
        /"\.\/commands\/user#name\/build%fast\.ts": cmd0/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should exclude the generated output file from the module map", async () => {
    const dir = await makeTempDir();
    try {
      const commandsDir = join(dir, "commands");
      const outputFile = join(commandsDir, "commands.generated.ts");
      await writeText(join(commandsDir, "build.ts"), "");
      await writeText(outputFile, "old generated module");

      const result = await generateCommandsModule({
        dir: commandsDir,
        outputFile,
        extensions: [".ts"],
      });

      assert.deepEqual(result.files.map((file) => file.modulePath), [
        "./build.ts",
      ]);
      assert.doesNotMatch(result.code, /commands\.generated\.ts/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should reject duplicate generated command paths", async () => {
    const dir = await makeTempDir();
    try {
      const commandsDir = join(dir, "commands");
      const outputFile = join(dir, "generated.ts");
      await writeText(join(commandsDir, "user.ts"), "");
      await writeText(join(commandsDir, "user", "index.ts"), "");

      await assert.rejects(
        () =>
          generateCommandsModule({
            dir: commandsDir,
            outputFile,
            extensions: [".ts"],
          }),
        (error) => {
          assert.ok(error instanceof TypeError);
          assert.match(error.message, /Duplicate command path "user"/);
          assert.match(error.message, /\.\/commands\/user\.ts/);
          assert.match(error.message, /\.\/commands\/user\/index\.ts/);
          return true;
        },
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("writeCommandsModule()", () => {
  it("should write the generated module to disk", async () => {
    const dir = await makeTempDir();
    try {
      const commandsDir = join(dir, "commands");
      const outputFile = join(dir, "generated", "commands.ts");
      await writeText(join(commandsDir, "build.ts"), "");

      const result = await writeCommandsModule({
        dir: commandsDir,
        outputFile,
        extensions: [".ts"],
      });

      assert.equal(await readFile(outputFile, "utf-8"), result.code);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("watchCommandsModule()", () => {
  it("should regenerate for file set changes but not content changes", async () => {
    const dir = await makeTempDir();
    const controller = new AbortController();
    const activeAbortListeners = trackAbortListeners(controller.signal);
    try {
      const commandsDir = join(dir, "commands");
      const outputFile = join(dir, "generated.ts");
      await writeText(join(commandsDir, "build.ts"), "initial");

      const generatedCounts: number[] = [];
      const watching = watchCommandsModule({
        dir: commandsDir,
        outputFile,
        extensions: [".ts"],
        intervalMs: 20,
        signal: controller.signal,
        onGenerate(result) {
          generatedCounts.push(result.files.length);
        },
      });

      await waitFor(() => generatedCounts.length === 1);
      await writeText(join(commandsDir, "build.ts"), "changed");
      await delay(80);
      assert.deepEqual(generatedCounts, [1]);
      assert.ok(
        activeAbortListeners() <= 1,
        `Expected at most one active abort listener, got ${activeAbortListeners()}.`,
      );

      await writeText(join(commandsDir, "deploy.ts"), "");
      await waitFor(() => generatedCounts.length === 2);
      assert.deepEqual(generatedCounts, [1, 2]);

      await rm(join(commandsDir, "build.ts"));
      await rm(join(commandsDir, "deploy.ts"));
      await delay(80);
      assert.deepEqual(generatedCounts, [1, 2]);

      await writeText(join(commandsDir, "status.ts"), "");
      await waitFor(() => generatedCounts.length === 3);
      assert.deepEqual(generatedCounts, [1, 2, 1]);

      controller.abort();
      await watching;
    } finally {
      controller.abort();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("should report watch errors without stopping", async () => {
    const dir = await makeTempDir();
    const controller = new AbortController();
    try {
      const commandsDir = join(dir, "commands");
      const blockedPath = join(dir, "blocked");
      const outputFile = join(blockedPath, "generated.ts");
      await writeText(join(commandsDir, "build.ts"), "");
      await writeText(blockedPath, "not a directory");

      const errors: unknown[] = [];
      const generatedCounts: number[] = [];
      const watching = watchCommandsModule({
        dir: commandsDir,
        outputFile,
        extensions: [".ts"],
        intervalMs: 20,
        signal: controller.signal,
        onGenerate(result) {
          generatedCounts.push(result.files.length);
        },
        onError(error) {
          errors.push(error);
        },
      });

      await waitFor(() => errors.length > 0);
      await unlink(blockedPath);
      await waitFor(() => generatedCounts.length === 1);
      assert.deepEqual(generatedCounts, [1]);

      controller.abort();
      await watching;
    } finally {
      controller.abort();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

async function makeTempDir(): Promise<string> {
  const { mkdtemp } = await import("node:fs/promises");
  return await mkdtemp(join(tmpdir(), "optique-discover-generator-"));
}

async function writeText(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, "utf-8");
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function trackAbortListeners(signal: AbortSignal): () => number {
  const originalAdd = signal.addEventListener.bind(signal);
  const originalRemove = signal.removeEventListener.bind(signal);
  const listeners = new Map<
    EventListenerOrEventListenerObject,
    EventListener
  >();
  let activeCount = 0;

  function addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (type === "abort") {
      const wrapped: EventListener = (event) => {
        if (listeners.delete(listener)) activeCount--;
        if (typeof listener === "function") {
          listener.call(signal, event);
        } else {
          listener.handleEvent(event);
        }
      };
      listeners.set(listener, wrapped);
      activeCount++;
      originalAdd(type, wrapped, options);
      return;
    }
    originalAdd(type, listener, options);
  }

  function removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void {
    if (type === "abort") {
      const wrapped = listeners.get(listener);
      if (wrapped != null) {
        listeners.delete(listener);
        activeCount--;
        originalRemove(type, wrapped, options);
        return;
      }
    }
    originalRemove(type, listener, options);
  }

  Object.defineProperties(signal, {
    addEventListener: { value: addEventListener },
    removeEventListener: { value: removeEventListener },
  });

  return () => activeCount;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > 2000) {
      throw new Error("Timed out waiting for condition.");
    }
    await delay(10);
  }
}
