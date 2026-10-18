import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import {
  cp,
  lstat,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve, sep } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { createCliRunner } from "@optique/testing/cli";
import { parseArgs } from "@optique/testing/parser";
import { createParser, parser, version } from "./parser.ts";

const bundleRoot = fileURLToPath(
  new URL("../skills/skill-notes/", import.meta.url),
);
interface Example {
  readonly id: string;
  readonly args: readonly string[];
  readonly stdin: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly parsed?: {
    readonly action: string;
    readonly input: string;
    readonly output?: string;
  };
  readonly redirect?: string;
  readonly output?: string;
}
interface Bundle {
  readonly skill: string;
  readonly reference: string;
  readonly examples: readonly Example[];
}
async function loadBundle(root = bundleRoot): Promise<Bundle> {
  return {
    skill: await readFile(join(root, "SKILL.md"), "utf8"),
    reference: await readFile(join(root, "references/commands.md"), "utf8"),
    examples: JSON.parse(
      await readFile(join(root, "references/examples.json"), "utf8"),
    ),
  };
}
function frontmatter(skill: string) {
  const match = /^---\n([\s\S]+?)\n---\n/.exec(skill);
  assert.ok(match, "YAML frontmatter is required.");
  const fields: Record<string, string> = {};
  const metadata: Record<string, string> = {};
  let inMetadata = false;
  // This specimen deliberately uses only JSON-quoted YAML string scalars.
  // Reject other YAML rather than pretending this is a general YAML parser.
  for (const line of match[1].split("\n")) {
    if (line === "metadata:") {
      assert.ok(!inMetadata, "Duplicate metadata map.");
      inMetadata = true;
      continue;
    }
    const field = /^( {2})?([a-z][a-z0-9-]*): (".*")$/.exec(line);
    assert.ok(field, `Unsupported scalar YAML: ${line}`);
    const target = field[1] ? metadata : fields;
    assert.equal(
      Boolean(field[1]),
      inMetadata,
      "Metadata must be the final map.",
    );
    assert.ok(!Object.hasOwn(target, field[2]), "Duplicate key.");
    const value: unknown = JSON.parse(field[3]);
    assert.equal(typeof value, "string");
    assert.ok(typeof value === "string");
    target[field[2]] = value;
  }
  return { fields, metadata };
}
function validateText(bundle: Bundle, directoryName = "skill-notes") {
  const { fields, metadata } = frontmatter(bundle.skill);
  assert.deepEqual(Object.keys(fields).sort(), [
    "description",
    "license",
    "name",
  ]);
  assert.match(fields.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(fields.name.length <= 64);
  assert.equal(fields.name, directoryName);
  assert.ok(
    [...fields.description].length >= 1 &&
      [...fields.description].length <= 1024,
  );
  assert.deepEqual(Object.keys(metadata), ["cli-version"]);
  assert.equal(metadata["cli-version"], version);
  assert.deepEqual(
    [...bundle.skill.matchAll(/^Tested with skill-notes (.+)\.$/gm)].map((m) =>
      m[1]
    ),
    [version],
  );
  const ids = new Set<string>();
  for (const example of bundle.examples) {
    assert.ok(!ids.has(example.id));
    ids.add(example.id);
    assert.ok(example.args.every((arg) => typeof arg === "string"));
    for (const value of [example.stdin, example.stdout, example.stderr]) {
      assert.equal(typeof value, "string");
    }
    assert.ok(Number.isInteger(example.exitCode));
  }
  const documented = [...(bundle.skill + "\n" + bundle.reference).matchAll(
    /<!-- example: ([a-z-]+) -->\n\n~~~~ bash\n(skill-notes [^\n]+)\n~~~~\n\n~~~~ text\n([\s\S]*?)\n~~~~\n\nExit status: ([01]) \((stdout|stderr)\)\./g,
  )];
  const shellFences = [
    ...(bundle.skill + "\n" + bundle.reference).matchAll(
      /~~~~ bash\n(skill-notes [^\n]+)\n~~~~/g,
    ),
  ];
  assert.equal(
    documented.length,
    shellFences.length,
    "Every command needs checked output/status.",
  );
  assert.deepEqual(
    documented.map((m) => m[1]).sort(),
    bundle.examples.map((e) => e.id).sort(),
  );
  for (const [, id, command, text, code, stream] of documented) {
    const example = bundle.examples.find((e) => e.id === id);
    assert.ok(example);
    const tokens = command.split(" ");
    assert.equal(tokens.shift(), "skill-notes");
    const redirectIndex = tokens.indexOf("<");
    if (redirectIndex >= 0) {
      assert.equal(tokens.length, redirectIndex + 2);
      assert.equal(tokens[redirectIndex + 1], example.redirect);
      tokens.splice(redirectIndex);
    } else assert.equal(example.redirect, undefined);
    assert.ok(tokens.every((token) => /^[a-zA-Z0-9._-]+$/.test(token)));
    assert.deepEqual(tokens, example.args);
    assert.equal(Number(code), example.exitCode);
    assert.equal(
      text + "\n",
      stream === "stdout" ? example.stdout : example.stderr,
    );
  }
}
async function validateLinks(root: string, bundle: Bundle) {
  const base = await realpath(root);
  assert.equal(basename(root), frontmatter(bundle.skill).fields.name);
  for (const document of [bundle.skill, bundle.reference]) {
    const targets = [...document.matchAll(/^\[[^\]]+\]: (\S+)$/gm)].map((m) =>
      m[1]
    );
    targets.push(...[...document.matchAll(/\]\(([^)]+)\)/g)].map((m) => m[1]));
    for (const target of targets) {
      assert.ok(
        !/^[a-z]+:|^[/\\]|[?#]/i.test(target),
        "Bundle links must be local files.",
      );
      const path = await realpath(resolve(root, target));
      assert.ok(path.startsWith(base + sep), `Escaping bundle link: ${target}`);
      assert.ok((await lstat(path)).isFile());
    }
  }
}
async function checkParsing(bundle: Bundle, candidate = parser) {
  for (const example of bundle.examples) {
    if (example.args[0]?.startsWith("--")) continue; // Runner-added grammar.
    const result = await parseArgs(candidate, example.args);
    if (example.parsed) {
      assert.ok(result.success, example.id);
      assert.deepEqual(result.value, example.parsed);
    } else assert.ok(!result.success, example.id);
  }
}
async function inputForExample(example: Example, cwd: string): Promise<string> {
  if (example.redirect != null) {
    assert.equal(
      example.stdin,
      await readFile(join(cwd, example.redirect), "utf8"),
      "Redirected input must match the documented file.",
    );
  }
  return example.stdin;
}
async function snapshot(root: string): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = {};
  async function visit(path: string) {
    const stat = await lstat(path);
    const name = relative(root, path) || ".";
    const mode = process.platform === "win32" ? undefined : stat.mode & 0o777;
    if (stat.isSymbolicLink()) {
      result[name] = { mode, link: await readlink(path) };
    } else if (stat.isDirectory()) {
      result[name] = { mode, directory: true };
      for (const child of (await readdir(path)).sort()) {
        await visit(join(path, child));
      }
    } else {result[name] = {
        mode,
        bytes: (await readFile(path)).toString("hex"),
      };}
  }
  await visit(root);
  return result;
}
const runtimeArgs = process.versions.deno
  ? ["--allow-read", "--allow-write", "--allow-env"]
  : process.versions.bun
  ? []
  : ["--no-warnings"];
async function withFixture(body: (cwd: string) => Promise<void>) {
  const cwd = await mkdtemp(join(tmpdir(), "optique-skill-test-"));
  try {
    await writeFile(join(cwd, "notes.txt"), "alpha\nbeta\n");
    await body(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
function runner(cwd: string) {
  return createCliRunner({
    entrypoint: new URL("cli.ts", import.meta.url),
    runtimeArgs,
    cwd,
    env: {
      NO_COLOR: "1",
      FORCE_COLOR: undefined,
      CLICOLOR_FORCE: undefined,
      NODE_OPTIONS: undefined,
      COLUMNS: "80",
      TERM: "dumb",
    },
  });
}

describe("consumer skill bundle", () => {
  it("validates the copied bundle, its local links, version and examples", async () => {
    await withFixture(async (cwd) => {
      const copy = join(cwd, "skill-notes");
      await cp(bundleRoot, copy, { recursive: true });
      assert.deepEqual(await snapshot(copy), await snapshot(bundleRoot));
      const bundle = await loadBundle(copy);
      validateText(bundle, basename(copy));
      await validateLinks(copy, bundle);
      await checkParsing(bundle);
      const result = await runner(cwd).invoke({
        args: ["--version"],
        stdin: "",
      });
      assert.deepEqual([result.stdout, result.stderr, result.exitCode], [
        version + "\n",
        "",
        0,
      ]);
    });
  });
  it("detects option, output, version, metadata and directory drift", async () => {
    const bundle = await loadBundle();
    await assert.rejects(() =>
      checkParsing(bundle, createParser("--destination"))
    );
    assert.throws(() =>
      validateText({
        ...bundle,
        examples: bundle.examples.map((e) =>
          e.id === "count-file" ? { ...e, stdout: "wrong\n" } : e
        ),
      })
    );
    assert.throws(() =>
      validateText({
        ...bundle,
        skill: bundle.skill.replace(
          'cli-version: "' + version + '"',
          'cli-version: "0.0.0"',
        ),
      })
    );
    assert.throws(() =>
      validateText({
        ...bundle,
        skill: bundle.skill.replace(
          'cli-version: "' + version + '"',
          "cli-version: 14",
        ),
      })
    );
    assert.throws(() => validateText(bundle, "different-directory"));
    for (const name of ["", "A", "-a", "a-", "a--b", "a".repeat(65)]) {
      assert.throws(() =>
        validateText({
          ...bundle,
          skill: bundle.skill.replace(
            'name: "skill-notes"',
            "name: " + JSON.stringify(name),
          ),
        }, name)
      );
    }
    for (const description of ["", "a".repeat(1025)]) {
      assert.throws(() =>
        validateText({
          ...bundle,
          skill: bundle.skill.replace(
            /^description: .*$/m,
            "description: " + JSON.stringify(description),
          ),
        })
      );
    }
  });
  it("rejects missing and escaping local references", async () => {
    const bundle = await loadBundle();
    await assert.rejects(() =>
      validateLinks(bundleRoot, {
        ...bundle,
        skill: bundle.skill + "\n[missing]: missing.md\n",
      })
    );
    await assert.rejects(() =>
      validateLinks(bundleRoot, {
        ...bundle,
        skill: bundle.skill + "\n[escape]: ../../README.md\n",
      })
    );
  });
  it("rejects links escaping a copied bundle through symlinks", {
    skip: process.platform === "win32",
  }, async () => {
    if (process.platform === "win32") return;
    await withFixture(async (cwd) => {
      const copy = join(cwd, "skill-notes");
      await cp(bundleRoot, copy, { recursive: true });
      await symlink(join(cwd, "notes.txt"), join(copy, "outside.txt"));
      const bundle = await loadBundle(copy);
      await assert.rejects(() =>
        validateLinks(copy, {
          ...bundle,
          skill: bundle.skill + "\n[escape]: outside.txt\n",
        })
      );
    });
  });
});

describe("documented workflows", () => {
  it("executes every maintained example with exact streams/status and effects", async () => {
    const bundle = await loadBundle();
    for (const example of bundle.examples) {
      await withFixture(async (cwd) => {
        const before = await snapshot(cwd);
        const result = await runner(cwd).invoke({
          args: example.args,
          stdin: await inputForExample(example, cwd),
        });
        assert.deepEqual(
          [result.stdout, result.stderr, result.exitCode, result.signal],
          [example.stdout, example.stderr, example.exitCode, null],
          example.id,
        );
        const after = await snapshot(cwd);
        if (example.output) {
          assert.deepEqual(
            await readFile(join(cwd, example.output)),
            Buffer.from(
              example.args[1] === "-" ? example.stdin : "alpha\nbeta\n",
            ),
          );
          delete after[example.output];
        }
        assert.deepEqual(after, before, example.id);
      });
    }
  });
  it("detects a mismatch between documented redirection and stdin bytes", async () => {
    const bundle = await loadBundle();
    const example = bundle.examples.find((item) => item.redirect != null);
    assert.ok(example);
    await withFixture(async (cwd) => {
      await assert.rejects(
        () => inputForExample({ ...example, stdin: "stale input" }, cwd),
        /Redirected input/,
      );
    });
  });
  it("handles LF boundaries, UTF-8 and byte-preserving file copies", async () => {
    for (
      const [input, lines] of [
        ["", 0],
        ["alpha", 1],
        ["\n", 1],
        ["a\n\n", 2],
        ["a\r\nb\r\n", 2],
        ["a\rb", 1],
        ["한글\n", 1],
      ] as const
    ) {
      await withFixture(async (cwd) => {
        const before = await snapshot(cwd);
        const result = await runner(cwd).invoke({
          args: ["count", "-"],
          stdin: input,
        });
        assert.deepEqual([result.stdout, result.stderr, result.exitCode], [
          JSON.stringify({ lines }) + "\n",
          "",
          0,
        ]);
        assert.deepEqual(await snapshot(cwd), before);
      });
    }
    await withFixture(async (cwd) => {
      const bytes = Buffer.from([0xff, 0x00, 0x0a, 0xc3]);
      await writeFile(join(cwd, "binary"), bytes);
      const result = await runner(cwd).invoke({
        args: ["save", "binary", "--output", "copy"],
        stdin: "",
      });
      assert.equal(result.exitCode, 0);
      assert.deepEqual(await readFile(join(cwd, "copy")), bytes);
    });
  });
  it("selects file input even when supplied stdin differs", async () => {
    await withFixture(async (cwd) => {
      const before = await snapshot(cwd);
      const result = await runner(cwd).invoke({
        args: ["count", "notes.txt"],
        stdin: "different",
      });
      assert.deepEqual([result.stdout, result.stderr, result.exitCode], [
        '{"lines":2}\n',
        "",
        0,
      ]);
      assert.deepEqual(await snapshot(cwd), before);
    });
  });
  it("accepts an input beginning with a hyphen after --", async () => {
    await withFixture(async (cwd) => {
      await writeFile(join(cwd, "-notes.txt"), "one\ntwo");
      const before = await snapshot(cwd);
      const result = await runner(cwd).invoke({
        args: ["count", "--", "-notes.txt"],
        stdin: "",
      });
      assert.deepEqual(
        [result.stdout, result.stderr, result.exitCode],
        ['{"lines":2}\n', "", 0],
      );
      assert.deepEqual(await snapshot(cwd), before);
    });
  });
  it("fails safely for invalid syntax and file-operation failures", async () => {
    for (
      const args of [
        ["save", "missing", "--output", "notes.txt", "--bad"],
        ["count", "notes.txt", "excess"],
        ["count", "missing"],
        ["save", "notes.txt", "--output", "notes.txt"],
        ["save", "notes.txt", "--output", "missing/output"],
        ["count", "."],
        ["save", ".", "--output", "new"],
        ["save", "notes.txt", "--output", "."],
      ]
    ) {
      await withFixture(async (cwd) => {
        const before = await snapshot(cwd);
        const result = await runner(cwd).invoke({ args, stdin: "" });
        assert.equal(result.exitCode, 1, args.join(" "));
        assert.equal(result.stdout, "");
        assert.ok(result.stderr.length > 0);
        if (args.includes("--bad")) {
          assert.match(result.stderr, /--bad/);
          assert.ok(!result.stderr.includes("File operation"));
        } else if (!args.includes("excess")) {
          const existingDestination = args[0] === "save" &&
            ["notes.txt", "."].includes(args.at(-1) ?? "");
          assert.equal(
            result.stderr,
            existingDestination
              ? "skill-notes: Destination already exists.\n"
              : "skill-notes: File operation failed.\n",
          );
        }
        assert.deepEqual(await snapshot(cwd), before);
      });
    }
  });
  it("does not overwrite an existing destination symlink", {
    skip: process.platform === "win32",
  }, async () => {
    if (process.platform === "win32") return;
    await withFixture(async (cwd) => {
      await symlink("notes.txt", join(cwd, "link"));
      const before = await snapshot(cwd);
      const result = await runner(cwd).invoke({
        args: ["save", "-", "--output", "link"],
        stdin: "changed",
      });
      assert.equal(result.exitCode, 1);
      assert.deepEqual(await snapshot(cwd), before);
    });
  });
  it("shows help without touching workflow files", async () => {
    await withFixture(async (cwd) => {
      const before = await snapshot(cwd);
      const result = await runner(cwd).invoke({ args: ["--help"], stdin: "" });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stderr, "");
      assert.match(result.stdout, /skill-notes/);
      assert.match(result.stdout, /count/);
      assert.match(result.stdout, /save/);
      assert.deepEqual(await snapshot(cwd), before);
    });
  });
});
