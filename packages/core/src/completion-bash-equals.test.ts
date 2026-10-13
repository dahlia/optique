import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { bash } from "./completion.ts";
import { merge, object } from "./constructs.ts";
import { multiple, optional } from "./modifiers.ts";
import { suggest } from "./parser.ts";
import { argument, option } from "./primitives.ts";
import { choice, string, type ValueParser } from "./valueparser.ts";

const files: ValueParser<"sync", string> = {
  ...string(),
  *suggest(prefix) {
    yield { kind: "file", type: "file", pattern: prefix };
  },
};
const prefixSensitiveFiles: ValueParser<"sync", string> = {
  ...string(),
  *suggest(prefix) {
    yield {
      kind: "file",
      type: prefix.includes("=") ? "file" : "directory",
      pattern: prefix,
      extensions: prefix.includes("=") ? [".toml"] : [".log"],
    };
  },
};
const scopeFiles: ValueParser<"sync", string> = {
  ...string(),
  *suggest() {
    yield { kind: "file", type: "file" };
  },
};
const mixedValues: ValueParser<"sync", string> = {
  ...string(),
  *suggest(prefix) {
    yield { kind: "literal", text: prefix };
    yield { kind: "file", type: "file", pattern: prefix };
  },
};
const dotValues: ValueParser<"sync", string> = {
  ...string(),
  *suggest() {
    yield { kind: "literal", text: ".env" };
    yield { kind: "file", type: "file", extensions: [".unmatched"] };
  },
};
const fields = {
  markerJoined: optional(
    option("--marker-joined", choice(["__JOINED_FILE__:foo"])),
  ),
  markerLiteral: optional(
    option("--marker-literal", choice(["__LITERAL__:foo"])),
  ),
  markerFile: optional(option("--marker-file", choice(["__FILE__:foo"]))),
  hiddenUnion: optional(option("--hidden-union", {
    ...string(),
    *suggest() {
      yield {
        kind: "file" as const,
        type: "file" as const,
        extensions: [".toml"],
        includeHidden: true,
      };
      yield {
        kind: "file" as const,
        type: "file" as const,
        extensions: [".log"],
        includeHidden: false,
      };
    },
  })),
  control: optional(option("--control", choice([String.raw`\c-tail`]))),
  ansiRedirect: optional(option("--ansi-redirect", choice(["dev'>output"]))),
  reverse: optional(
    option("/reverse", "/reverse:file", {
      ...string(),
      *suggest(prefix) {
        yield {
          kind: "file" as const,
          type: prefix.startsWith("file:")
            ? "directory" as const
            : "file" as const,
          pattern: prefix,
        };
      },
    }),
  ),
  repeatMixed: optional(multiple(option("--repeat-mixed", mixedValues))),
  multiFiles: optional(option("--multi-files", {
    ...string(),
    *suggest() {
      yield {
        kind: "file" as const,
        type: "file" as const,
        extensions: [".toml"],
      };
      yield {
        kind: "file" as const,
        type: "file" as const,
        extensions: [".log"],
      };
    },
  })),
  overlap: optional(
    option("/overlap:file", "/overlap", {
      ...string(),
      *suggest(prefix) {
        yield {
          kind: "file" as const,
          type: prefix.startsWith("file:")
            ? "directory" as const
            : "file" as const,
          pattern: prefix,
        };
      },
    }),
  ),
  redirect: optional(
    option("--redirect", choice(["dev>output", "dev<output"])),
  ),
  dot: optional(option("--dot", dotValues)),
  mixed: optional(option("--mixed", mixedValues)),
  scopeFile: optional(
    option("--scope:file", "/scope:file", "+scope:file", scopeFiles),
  ),
  scope: optional(
    option("--scope:name", "/scope:name", "+scope:name", choice(["dev"])),
  ),
  sensitiveConfig: optional(option("--sensitive-config", prefixSensitiveFiles)),
  url: optional(option("--url", choice(["https://example.com"]))),
  email: optional(option("--email", choice(["me@example.com"]))),
  tag: optional(option("--tag", choice([":example", "@example"]))),
  label: optional(option("--label", string())),
  mode: optional(option("--mode", "/mode", "+mode", choice(["dev", "prod"]))),
  transport: optional(
    option("--mail-transport", choice(["resend", "a=resend", "=resend"])),
  ),
  config: optional(option("--config", "/config", "+config", files)),
  region: optional(option("--region", choice(["remote", "relay"]))),
  verbose: option("--verbose"),
};
const parser = object(fields);
const withPositionalFiles = object({
  ...fields,
  positional: optional(argument(files)),
});
const patternlessFiles: ValueParser<"sync", string> = {
  ...string(),
  *suggest() {
    yield { kind: "file", type: "file" };
  },
};
const withoutPattern = object({
  ...fields,
  config: optional(option("--config", patternlessFiles)),
});
const fixedPatternFiles: ValueParser<"sync", string> = {
  ...string(),
  *suggest() {
    yield { kind: "file", type: "file", pattern: "src/*.toml" };
  },
};
const fixedDirectories: ValueParser<"sync", string> = {
  ...string(),
  *suggest() {
    yield { kind: "file", type: "directory", pattern: "src/*" };
  },
};
const fixedHiddenTomlFiles: ValueParser<"sync", string> = {
  ...string(),
  *suggest() {
    yield {
      kind: "file",
      type: "file",
      pattern: "src/*",
      extensions: [".toml"],
      includeHidden: true,
    };
  },
};
const withFixedPattern = object({
  ...fields,
  config: optional(option("--config", "-config", fixedPatternFiles)),
  directory: optional(option("--directory", fixedDirectories)),
  hidden: optional(option("--hidden", fixedHiddenTomlFiles)),
  prefixedPattern: optional(option("--prefixed-pattern", {
    ...string(),
    *suggest() {
      yield {
        kind: "file" as const,
        type: "file" as const,
        pattern: "./src/*.toml",
      };
    },
  })),
  nestedPattern: optional(option("--nested-pattern", {
    ...string(),
    *suggest() {
      yield {
        kind: "file" as const,
        type: "file" as const,
        pattern: "src/*/*.toml",
      };
    },
  })),
  rootPattern: optional(option("--root-pattern", {
    ...string(),
    *suggest() {
      yield { kind: "file" as const, type: "file" as const, pattern: "*" };
    },
  })),
  casing: optional(option("--casing", choice(["dev", "Dev"]))),
  overlapping: optional(option("--overlapping", {
    ...string(),
    *suggest() {
      yield {
        kind: "file" as const,
        type: "file" as const,
        pattern: "src/*.toml",
      };
      yield {
        kind: "file" as const,
        type: "file" as const,
        pattern: "src/main.*",
      };
    },
  })),
});
const withFixedPatternAndSibling = merge(
  withFixedPattern,
  object({ positional: optional(argument(files)) }),
);
const literalCollisionFiles: ValueParser<"sync", string> = {
  ...string(),
  *suggest() {
    yield { kind: "file", type: "file", pattern: "json" };
  },
};
const withLiteralCollision = merge(
  object({ format: optional(option("--format", choice(["json", "yaml"]))) }),
  object({ positional: optional(argument(literalCollisionFiles)) }),
);
const withDirectoryLiteralCollision = merge(
  object({ out: optional(option("--out", files)) }),
  object({ positional: optional(argument(choice(["build", "test"]))) }),
);
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
function hasPty(): boolean {
  if (process.platform === "win32") return false;
  try {
    execFileSync("bash", ["--version"], { stdio: "ignore" });
    execFileSync("python3", ["-c", "import pty, select"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
const ptyAvailable = hasPty();
const ptyDriver = String.raw`
import json, os, pty, re, select, signal, sys, time
pid, fd = pty.fork()
if pid == 0:
    os.environ['TERM'] = 'dumb'
    os.environ['INPUTRC'] = '/dev/null'
    os.execvp('bash', ['bash', '--noprofile', '--rcfile', sys.argv[1], '-i'])
def until(pattern):
    output = b''
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if select.select([fd], [], [], 0.1)[0]:
            try:
                output += os.read(fd, 65536)
            except OSError:
                break
            match = re.search(pattern, output)
            if match:
                return match
    raise RuntimeError('Bash PTY did not reach expected marker: ' + repr(output))
try:
    until(rb'__READY__> ')
    os.write(fd, sys.argv[2].encode() + b'\x1b[D' * int(sys.argv[3]) + b'\t\x18\x12')
    match = until(rb'__LINE__(.*?)\r?\n')
    print(json.dumps(match.group(1).decode()))
finally:
    os.kill(pid, signal.SIGKILL)
    os.close(fd)
    os.waitpid(pid, 0)
`;
function tab(
  input: string,
  args: readonly string[],
  setup = "",
  positional = false,
  omitPattern = false,
  cursorLeft = 0,
  fixedPattern = false,
  fixedPatternWithSibling = false,
  literalCollision = false,
  directoryLiteralCollision = false,
  commandBudget = 0,
  fixedGlobPattern?: string,
  fixedGlobType: "file" | "directory" = "file",
): {
  readonly line: string;
  readonly replies: readonly string[];
  readonly calls: readonly (readonly string[])[];
} {
  const dir = mkdtempSync(join(tmpdir(), "optique-bash-equals-"));
  try {
    writeFileSync(join(dir, "name with spaces.toml"), "");
    writeFileSync(join(dir, "name=foo.toml"), "");
    writeFileSync(join(dir, "=leading.toml"), "");
    mkdirSync(join(dir, "dir=x"));
    writeFileSync(join(dir, "dir=x", ".hidden.toml"), "");
    if (fixedPattern || fixedPatternWithSibling) {
      mkdirSync(join(dir, "src"));
      writeFileSync(join(dir, "src", "main.toml"), "");
      writeFileSync(join(dir, "src", "main.txt"), "");
      writeFileSync(join(dir, "src", ".hidden.toml"), "");
      mkdirSync(join(dir, "src", "nested"));
    }
    if (directoryLiteralCollision) {
      mkdirSync(join(dir, "build"));
      writeFileSync(join(dir, "build", "a.txt"), "");
    }
    const requests = [args];
    const branches = requests.map((request) => {
      const [first, ...rest] = request;
      assert.ok(first !== undefined);
      const protocol = Array.from(
        bash.encodeSuggestions(
          fixedGlobPattern !== undefined
            ? suggest(
              object({
                config: option("--config", {
                  ...string(),
                  *suggest() {
                    yield {
                      kind: "file" as const,
                      type: fixedGlobType,
                      pattern: fixedGlobPattern,
                    };
                  },
                }),
              }),
              [first, ...rest],
            )
            : omitPattern
            ? suggest(withoutPattern, [first, ...rest])
            : directoryLiteralCollision
            ? suggest(withDirectoryLiteralCollision, [first, ...rest])
            : literalCollision
            ? suggest(withLiteralCollision, [first, ...rest])
            : fixedPatternWithSibling
            ? suggest(withFixedPatternAndSibling, [first, ...rest])
            : fixedPattern
            ? suggest(withFixedPattern, [first, ...rest])
            : positional
            ? suggest(withPositionalFiles, [first, ...rest])
            : suggest(parser, [first, ...rest]),
        ),
      ).join("") + "\n";
      return `if [[ $# -eq ${request.length} ${
        request.map((arg, i) => `&& \${${i + 1}} == ${shellQuote(arg)}`).join(
          " ",
        )
      } ]]; then\n printf '%s' ${shellQuote(protocol)}\nfi\n`;
    }).join("");
    writeFileSync(
      join(dir, "eqapp"),
      `#!/bin/bash\nprintf '%s\\0' "$@" >> protocol-args\nprintf '\\n' >> protocol-args\n${branches}`,
    );
    chmodSync(join(dir, "eqapp"), 0o755);
    writeFileSync(
      join(dir, "init.bash"),
      `
PS1='__READY__> '
export PATH=${shellQuote(dir)}:"$PATH"
${bash.generateScript("eqapp")}
${setup}
capture() {
  local saved_words="$(declare -p COMP_WORDS)" saved_breaks="$COMP_WORDBREAKS"
  local saved_nocasematch="$(shopt -p nocasematch)" saved_nocaseglob="$(shopt -p nocaseglob)"
  local completion_steps=0
  if (( ${commandBudget} > 0 )); then
    set -T
    trap '((++completion_steps <= ${commandBudget})) || exit 83' DEBUG
  fi
  _eqapp "$@"
  if (( ${commandBudget} > 0 )); then
    trap - DEBUG
    set +T
  fi
  [[ "$(declare -p COMP_WORDS)" == "$saved_words" && "$COMP_WORDBREAKS" == "$saved_breaks" && "$(shopt -p nocasematch)" == "$saved_nocasematch" && "$(shopt -p nocaseglob)" == "$saved_nocaseglob" ]] && printf unchanged > state
  printf '%s\\n' "\${COMPREPLY[@]}" > replies
}
complete -F capture -- eqapp
bind -x '\"\\C-x\\C-r\":printf "\\n__LINE__%s\\n" "$READLINE_LINE"'

`,
    );
    const line: unknown = JSON.parse(
      execFileSync(
        "python3",
        ["-c", ptyDriver, join(dir, "init.bash"), input, String(cursorLeft)],
        { cwd: dir, encoding: "utf8", timeout: 15000 },
      ),
    );
    assert.equal(typeof line, "string");
    assert.ok(typeof line === "string");
    const lines = (file: string) =>
      readFileSync(join(dir, file), "utf8").trimEnd().split("\n");
    const calls = readFileSync(join(dir, "protocol-args"), "utf8").trimEnd()
      .split("\n").map((record) => record.split("\0").slice(0, -1));
    assert.equal(readFileSync(join(dir, "state"), "utf8"), "unchanged");
    assert.ok(!existsSync(join(dir, "marker")));
    return { line, replies: lines("replies"), calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("joined Bash option completion", () => {
  for (const prefix of ["src/nested/", "src/nested/de"]) {
    it(`navigates a fixed directory-only pattern at ${prefix}`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const result = tab(
        `eqapp --directory=${prefix}`,
        [`--directory=${prefix}`],
        "mkdir src/nested/deeper; touch src/nested/file.toml",
        false,
        false,
        0,
        true,
      );
      assert.deepEqual(result.replies, ["src/nested/deeper/"]);
      assert.equal(result.line, "eqapp --directory=src/nested/deeper/");
    });
  }
  it("navigates a fixed glob rooted directly at /", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const dir = mkdtempSync(join(tmpdir(), "optique-root-glob-"));
    try {
      writeFileSync(join(dir, "child.toml"), "");
      writeFileSync(join(dir, "child.txt"), "");
      const result = tab(
        `eqapp --config=${dir}/ch`,
        [`--config=${dir}/ch`],
        "",
        false,
        false,
        0,
        false,
        false,
        false,
        false,
        0,
        "/*.toml",
      );
      assert.deepEqual(result.replies, [`${dir}/child.toml`]);
      assert.equal(result.line, `eqapp --config=${dir}/child.toml `);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("navigates a directory-only glob ending in a slash", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=src/nested/de",
      ["--config=src/nested/de"],
      "mkdir src/nested/deeper; touch src/nested/file.toml",
      false,
      false,
      0,
      true,
      false,
      false,
      false,
      0,
      "src/*/",
      "directory",
    );
    assert.deepEqual(result.replies, ["src/nested/deeper/"]);
  });
  for (
    const input of [
      "eqapp --config=src/literal\\*",
      "eqapp --config=src/'literal*'",
      "eqapp --config=src/literal\\?",
      "eqapp --config=src/'literal?'",
    ]
  ) {
    it(`keeps echoed quoted or escaped wildcards literal in ${input}`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const wildcard = input.includes("?") ? "?" : "*";
      const result = tab(
        input,
        [`--config=src/literal${wildcard}`],
        `mkdir src; touch 'src/literal${wildcard}one.toml' src/literal-other.toml`,
      );
      assert.deepEqual(result.replies, [`src/literal${wildcard}one.toml`]);
      assert.ok(!result.line.includes("literal-other"));
    });
  }
  it("expands a fixed wildcard that equals the typed value", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=src/*.toml",
      ["--config=src/*.toml"],
      "",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual([...result.replies].sort(), [
      "src/main.toml",
      "src/nested/",
    ]);
    assert.equal(result.line, "eqapp --config=src/");
  });
  for (
    const prefix of [
      "src/nested/",
      "src/nested/ch",
      "./src/nested/ch",
      "src/nested/deeper/gr",
    ]
  ) {
    it(`keeps the fixed basename filter after navigating to ${prefix}`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const result = tab(
        `eqapp --config=${prefix}`,
        [`--config=${prefix}`],
        "touch src/nested/child.toml src/nested/child.txt; mkdir src/nested/deeper; touch src/nested/deeper/grandchild.toml src/nested/deeper/grandchild.txt",
        false,
        false,
        0,
        true,
      );
      assert.deepEqual(
        [...result.replies].sort(),
        prefix.endsWith("/")
          ? ["src/nested/child.toml", "src/nested/deeper/"]
          : prefix.endsWith("gr")
          ? ["src/nested/deeper/grandchild.toml"]
          : [`${prefix.startsWith("./") ? "./" : ""}src/nested/child.toml`],
      );
    });
  }
  it("navigates below wildcard directory components", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --nested-pattern=src/foo/nested/ch",
      ["--nested-pattern=src/foo/nested/ch"],
      "mkdir -p src/foo/nested; touch src/foo/nested/child.toml src/foo/nested/child.txt",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.replies, ["src/foo/nested/child.toml"]);
    assert.equal(
      result.line,
      "eqapp --nested-pattern=src/foo/nested/child.toml ",
    );
  });
  it("keeps wildcard characters literal in an entered directory", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=src/'child*[x]'/ch",
      ["--config=src/child*[x]/ch"],
      "mkdir 'src/child*[x]'; touch 'src/child*[x]/child.toml' 'src/child*[x]/child.txt'",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.replies, ["src/child*[x]/child.toml"]);
  });
  it(
    "navigates with a fixed basename pattern rooted at the current directory",
    {
      skip: !ptyAvailable,
    },
    () => {
      if (!ptyAvailable) return;
      const result = tab(
        "eqapp --config=dir=x/ch",
        ["--config=dir=x/ch"],
        "touch dir=x/child.toml dir=x/child.txt",
        false,
        false,
        0,
        false,
        false,
        false,
        false,
        0,
        "*.toml",
      );
      assert.deepEqual(result.replies, ["x/child.toml"]);
      assert.equal(result.line, "eqapp --config=dir=x/child.toml ");
    },
  );
  it("does not navigate outside matching fixed-pattern directories", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=src/other/ch",
      ["--config=src/other/ch"],
      "mkdir src/other; touch src/other/child.toml",
      false,
      false,
      0,
      true,
      false,
      false,
      false,
      0,
      "src/nested*/*.toml",
    );
    assert.deepEqual(result.replies.filter(Boolean), []);
    assert.equal(result.line, "eqapp --config=src/other/ch");
  });
  it("ignores nocasematch when checking navigation ancestry", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=src/NESTED/deeper/ch",
      ["--config=src/NESTED/deeper/ch"],
      "shopt -s nocasematch; mkdir -p src/NESTED/deeper; touch src/NESTED/deeper/child.toml",
      false,
      false,
      0,
      true,
      false,
      false,
      false,
      0,
      "src/nested*/*.toml",
    );
    assert.deepEqual(result.replies.filter(Boolean), []);
  });
  for (const patternUsesTilde of [false, true]) {
    it(
      `keeps typed tilde spelling with a fixed glob (patternUsesTilde=${patternUsesTilde})`,
      {
        skip: !ptyAvailable,
      },
      (t) => {
        if (!ptyAvailable) return;
        const root = fileURLToPath(new URL("../../../tmp/", import.meta.url));
        const homeRelative = relative(homedir(), root);
        if (homeRelative.startsWith("..")) {
          t.skip("The workspace is outside the home directory.");
          return;
        }
        mkdirSync(root, { recursive: true });
        const dir = mkdtempSync(join(root, "bash-tilde-pattern-"));
        try {
          writeFileSync(join(dir, "main.toml"), "");
          const tildeDir = `~/${relative(homedir(), dir)}`;
          const typedDir = patternUsesTilde ? dir : tildeDir;
          const patternDir = patternUsesTilde ? tildeDir : dir;
          const result = tab(
            `eqapp --config=${typedDir}/ma`,
            [`--config=${typedDir}/ma`],
            "",
            false,
            false,
            0,
            false,
            false,
            false,
            false,
            0,
            `${patternDir}/*.toml`,
          );
          assert.deepEqual(result.replies, [`${typedDir}/main.toml`]);
          assert.equal(result.line, `eqapp --config=${typedDir}/main.toml `);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
    );
  }
  for (
    const { pattern, prefix, setup, reply } of [
      {
        pattern: "src/foo[1]*.toml",
        prefix: "src/foo",
        setup: "touch 'src/foo[1]-a.toml' src/foo1-b.toml",
        reply: "src/foo[1]-a.toml",
      },
      {
        pattern: "src/foo\\*.toml",
        prefix: "src/foo",
        setup: "touch 'src/foo\\name.toml' src/fooname.toml",
        reply: "src/foo\\name.toml",
      },
      {
        pattern: "src/@(foo|bar)*.toml",
        prefix: "src/@",
        setup: "shopt -s extglob; touch 'src/@(foo|bar)-a.toml' src/foo-b.toml",
        // Readline replaces the part after its @ word break.
        reply: "@(foo|bar)-a.toml",
      },
      {
        pattern: "src/foo[1]*/file?.toml",
        prefix: "src/foo",
        setup: "mkdir -p 'src/foo[1]-a/nested' src/foo1-b/nested",
        reply: "src/foo[1]-a/nested/",
      },
    ]
  ) {
    it(`keeps unsupported glob syntax literal in ${pattern}`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const result = tab(
        `eqapp --config=${prefix}`,
        [`--config=${prefix}`],
        setup,
        false,
        false,
        0,
        true,
        false,
        false,
        false,
        0,
        pattern,
      );
      assert.deepEqual(result.replies, [reply]);
      assert.ok(result.line.startsWith("eqapp --config=src/"));
      assert.ok(!result.line.includes("foo1-b"));
    });
  }
  it("does not add a pattern-supplied ./ to an empty value", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --prefixed-pattern=",
      ["--prefixed-pattern="],
      "",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual([...result.replies].sort(), [
      "src/main.toml",
      "src/nested/",
    ]);
    assert.equal(result.line, "eqapp --prefixed-pattern=src/");
  });
  for (const prefix of ["s", "foo"]) {
    it(`filters a fixed glob for the nonextending prefix ${prefix}`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const result = tab(
        `eqapp --config=${prefix}`,
        [`--config=${prefix}`],
        "",
        false,
        false,
        0,
        true,
      );
      assert.deepEqual(
        result.replies.filter(Boolean).sort(),
        prefix === "s" ? ["src/main.toml", "src/nested/"] : [],
      );
      assert.equal(
        result.line,
        `eqapp --config=${prefix === "s" ? "src/" : prefix}`,
      );
    });
  }
  it("expands wildcard directory components for navigation", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --nested-pattern=src/f",
      ["--nested-pattern=src/f"],
      "mkdir -p 'src/foo space/nested dir'",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.replies, ["src/foo space/nested dir/"]);
    assert.equal(
      result.line,
      "eqapp --nested-pattern=src/foo\\ space/nested\\ dir/",
    );
  });
  it("completes thousands of files within a linear shell-command budget", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=bulk/",
      ["--config=bulk/"],
      "mkdir bulk; for i in {0001..2000}; do touch bulk/file-$i.toml; done",
      false,
      false,
      0,
      false,
      false,
      false,
      false,
      100000,
    );
    assert.equal(result.replies.length, 2000);
    assert.equal(result.line, "eqapp --config=bulk/file-");
  });
  it("completes thousands of root directories without quadratic rescans", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --root-pattern=",
      ["--root-pattern="],
      "for i in {0001..2000}; do mkdir folder-$i; done",
      false,
      false,
      0,
      true,
      false,
      false,
      false,
      120000,
    );
    assert.equal(
      result.replies.filter((reply) => reply.endsWith("/")).length,
      2002,
    );
    assert.equal(result.line, "eqapp --root-pattern=");
  });
  it("deduplicates control-bearing filenames without changing their order", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const dir = mkdtempSync(join(tmpdir(), "optique-bash-dedup-"));
    try {
      const names = ["z", "a", "A", "a\ttab", "a\nline", "$(touch marker)"];
      for (const name of names) writeFileSync(join(dir, name), "");
      const replies = execFileSync("bash", [
        "--noprofile",
        "--norc",
        "-c",
        `
export LC_ALL=C
${bash.generateScript("eqapp")}
eqapp() {
  printf '%s\\n' '__JOINED_FILE__:--config=:file:::0' '__JOINED_FILE__:--config=:file:::0'
}
COMP_WORDS=(eqapp --config=)
COMP_CWORD=1
COMP_LINE='eqapp --config='
COMP_POINT=\${#COMP_LINE}
COMP_WORDBREAKS=''
shopt -s nocasematch
_eqapp
shopt -q nocasematch || exit 84
printf '%s\\0' "\${COMPREPLY[@]}"
`,
      ], { cwd: dir, encoding: "utf8", timeout: 15000 }).split("\0").slice(
        0,
        -1,
      );
      assert.deepEqual(replies, names.sort().map((name) => `--config=${name}`));
      assert.ok(!existsSync(join(dir, "marker")));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("keeps the omission of ./ when a fixed pattern includes it", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --prefixed-pattern=src/ma",
      ["--prefixed-pattern=src/ma"],
      "",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.replies, ["src/main.toml"]);
    assert.equal(result.line, "eqapp --prefixed-pattern=src/main.toml ");
  });
  it("enumerates an explicitly typed hidden directory in a fixed glob", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --nested-pattern=src/.hidden/ma",
      ["--nested-pattern=src/.hidden/ma"],
      "mkdir src/.hidden; touch src/.hidden/main.toml",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.replies, ["src/.hidden/main.toml"]);
    assert.equal(result.line, "eqapp --nested-pattern=src/.hidden/main.toml ");
  });
  it("does not repeat root-glob directories with a ./ spelling", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --root-pattern=",
      ["--root-pattern="],
      "",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(
      result.replies.filter((reply) => reply.endsWith("/")).sort(),
      ["dir=x/", "src/"],
    );
  });
  it("keeps distinct literals when deduplicating with nocasematch enabled", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --casing=",
      ["--casing="],
      "shopt -s nocasematch",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.replies, ["dev", "Dev"]);
  });
  it("keeps the typed ./ prefix when narrowing a fixed glob", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=./src/ma",
      ["--config=./src/ma"],
      "",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.replies, ["./src/main.toml"]);
    assert.equal(result.line, "eqapp --config=./src/main.toml ");
  });
  it("deduplicates matches from overlapping fixed globs", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --overlapping=",
      ["--overlapping="],
      "",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual([...result.replies].sort(), [
      "src/main.toml",
      "src/main.txt",
      "src/nested/",
    ]);
  });
  for (const nocaseglob of [true, false]) {
    it(`narrows fixed globs using nocaseglob=${nocaseglob}`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const result = tab(
        "eqapp --config=src/ma",
        ["--config=src/ma"],
        `mv src/main.toml src/Main.toml; shopt ${
          nocaseglob ? "-s" : "-u"
        } nocaseglob; shopt ${nocaseglob ? "-u" : "-s"} nocasematch`,
        false,
        false,
        0,
        true,
      );
      assert.deepEqual(result.replies, nocaseglob ? ["src/Main.toml"] : [""]);
    });
  }
  it("includes explicitly typed hidden entries within a fixed glob", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=src/.h",
      ["--config=src/.h"],
      "",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.replies, ["src/.hidden.toml"]);
  });
  it("enumerates fixed globs without mapfile", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=",
      ["--config="],
      "enable -n mapfile 2>/dev/null || true",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.replies, ["src/main.toml", "src/nested/"]);
  });
  it("includes hidden fixed-glob matches without duplicate directories", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --hidden=",
      ["--hidden="],
      "",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual([...result.replies].sort(), [
      "src/.hidden.toml",
      "src/main.toml",
      "src/nested/",
    ]);
  });
  it("includes hidden fixed-glob matches when compgen ignores dotglob", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --hidden=",
      ["--hidden="],
      'compgen() { ( shopt -u dotglob; builtin compgen "$@" ); }',
      false,
      false,
      0,
      true,
    );
    assert.ok(result.replies.includes("src/.hidden.toml"));
  });
  it("enumerates a fixed file pattern for a joined value", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=src/ma",
      ["--config=src/ma"],
      "",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.calls, [
      ["--config=src/ma"],
    ]);
    assert.deepEqual(result.replies, ["src/main.toml"]);
    assert.equal(result.line, "eqapp --config=src/main.toml ");
  });
  it("enumerates a fixed pattern through a single-dash long option alias", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp -config=src/ma",
      ["-config=src/ma"],
      "",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.calls, [["-config=src/ma"]]);
    assert.deepEqual(result.replies, ["src/main.toml"]);
    assert.equal(result.line, "eqapp -config=src/main.toml ");
  });
  it("enumerates a fixed pattern for an empty joined value", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=",
      ["--config="],
      "",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.replies, ["src/main.toml", "src/nested/"]);
    assert.equal(result.line, "eqapp --config=src/");
  });
  it("preserves a fixed pattern when equals is not a word break", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=src/ma",
      ["--config=src/ma"],
      'COMP_WORDBREAKS="${COMP_WORDBREAKS//=}"',
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.replies, ["--config=src/main.toml"]);
    assert.equal(result.line, "eqapp --config=src/main.toml ");
  });
  it("preserves fixed directory suggestion metadata", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --directory=src/ne",
      ["--directory=src/ne"],
      "",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.replies, ["src/nested/"]);
    assert.equal(result.line, "eqapp --directory=src/nested/");
  });
  it("preserves fixed extension and hidden-file metadata", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --hidden=src/.h",
      ["--hidden=src/.h"],
      "",
      false,
      false,
      0,
      true,
    );
    assert.deepEqual(result.replies, ["src/.hidden.toml"]);
    assert.equal(result.line, "eqapp --hidden=src/.hidden.toml ");
  });
  it("does not accept an unrelated sibling file directive", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const retrySuggestions = Array.from(
      suggest(withFixedPatternAndSibling, ["--config", "src/ma"]),
    );
    assert.deepEqual(retrySuggestions, [
      { kind: "file", type: "file", pattern: "src/*.toml" },
      { kind: "file", type: "file", pattern: "src/ma" },
    ]);
    const result = tab(
      "eqapp --config=src/ma",
      ["--config=src/ma"],
      "",
      false,
      false,
      0,
      false,
      true,
    );
    assert.deepEqual(result.replies, ["src/main.toml"]);
    assert.equal(result.line, "eqapp --config=src/main.toml ");
  });
  it("preserves a literal that collides with a sibling file pattern", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    assert.deepEqual(
      Array.from(suggest(withLiteralCollision, ["--format", "j"])),
      [
        { kind: "literal", text: "json" },
        { kind: "file", type: "file", pattern: "json" },
      ],
    );
    const result = tab(
      "eqapp --format=j",
      ["--format=j"],
      "",
      false,
      false,
      0,
      false,
      false,
      true,
    );
    assert.deepEqual(result.replies, ["json"]);
    assert.equal(result.line, "eqapp --format=json ");
  });
  it("keeps files when a sibling literal matches their pattern", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    assert.deepEqual(
      Array.from(suggest(withDirectoryLiteralCollision, ["--out", "build"])),
      [
        { kind: "file", type: "file", pattern: "build" },
        { kind: "literal", text: "build" },
      ],
    );
    const result = tab(
      "eqapp --out=build",
      ["--out=build"],
      "",
      false,
      false,
      0,
      false,
      false,
      false,
      true,
    );
    assert.deepEqual(result.replies, ["build/"]);
    assert.equal(result.line, "eqapp --out=build/");
  });
  for (
    const word of [
      "'--mode'=de",
      '"--mode=de',
      "'--mode=de'",
      String.raw`\--mode=de`,
      "$'--mode'=de",
    ]
  ) {
    it(`decodes an option prefix beginning inside ${word}`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const result = tab(`eqapp ${word}`, ["--mode=de"]);
      assert.deepEqual(result.calls, [["--mode=de"]]);
      assert.ok(result.replies.some((reply) => reply.endsWith("dev")));
      const argv = execFileSync("bash", [
        "--noprofile",
        "--norc",
        "-c",
        `set -- ${result.line}; printf '%s\\0' "$@"`,
      ], { encoding: "utf8" }).split("\0").slice(0, -1);
      assert.deepEqual(argv, ["eqapp", "--mode=dev"]);
    });
  }

  for (const word of ["'--config=~/name=l'", '"--config=~/name=l']) {
    it(`retains quoted tilde policy for a fully quoted ${word}`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const result = tab(
        `eqapp ${word}`,
        ["--config=~/name=l"],
        String.raw`export HOME="$PWD"; mkdir '~'; touch '~/name=literal.toml'`,
      );
      assert.ok(result.replies.some((reply) => reply.endsWith("literal.toml")));
      const argv = execFileSync("bash", [
        "--noprofile",
        "--norc",
        "-c",
        `set -- ${result.line}; printf '%s\\0' "$@"`,
      ], { encoding: "utf8" }).split("\0").slice(0, -1);
      assert.deepEqual(argv, ["eqapp", "--config=./~/name=literal.toml"]);
    });
  }
  it("expands an unquoted tilde after a quoted delimiter", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config'='~/name=f",
      ["--config=~/name=f"],
      'export HOME="$PWD"',
    );
    assert.ok(result.replies.some((reply) => reply.endsWith("foo.toml")));
  });

  it("preserves earlier hidden candidates from their own file directive", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --hidden-union=",
      ["--hidden-union="],
      "touch .hidden.toml .hidden.log visible.log",
    );
    assert.ok(result.replies.includes(".hidden.toml"));
    assert.ok(result.replies.includes("visible.log"));
    assert.ok(!result.replies.includes(".hidden.log"));
  });
  for (
    const input of [
      String.raw`eqapp --scope\:na`,
      "eqapp --scope':'na",
      String.raw`eqapp +scope\:na`,
    ]
  ) {
    it(
      `dequotes incomplete option names in ${input}`,
      { skip: !ptyAvailable },
      () => {
        if (!ptyAvailable) return;
        const optionPrefix = input.includes("+scope")
          ? "+scope:na"
          : "--scope:na";
        const result = tab(input, [optionPrefix]);
        assert.deepEqual(result.calls, [[optionPrefix]]);
        assert.ok(result.replies.some((reply) => reply.endsWith("name")));
      },
    );
  }
  for (
    const [marker, name] of [["__JOINED_FILE__", "--marker-joined"], [
      "__LITERAL__",
      "--marker-literal",
    ], ["__FILE__", "--marker-file"]]
  ) {
    it(`keeps ${marker} literal values out of the file protocol`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const result = tab(`eqapp ${name} `, [name, ""]);
      assert.equal(result.line, `eqapp ${name} ${marker}:foo `);
    });
  }
  for (const suffix of ["'", ""]) {
    it(`keeps a tilde quoted across an ANSI-C delimiter literal (${suffix})`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const input = `eqapp --config$'=~/name=l${suffix}`;
      const result = tab(
        input,
        ["--config=~/name=l"],
        String.raw`export HOME="$PWD"; mkdir '~'; touch '~/name=literal.toml'`,
      );
      assert.ok(result.replies.some((reply) => reply.endsWith("literal.toml")));
      assert.deepEqual(result.calls, [["--config=~/name=l"]]);
    });
  }

  it("retains the originating slash option's file metadata", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp /overlap:file:name=f", ["/overlap:file:name=f"]);
    assert.ok(result.replies.includes("foo.toml"));
    assert.equal(result.line, "eqapp /overlap:file:name=foo.toml ");
  });
  it("preserves slash option order when the shorter name comes first", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp /reverse:file:name=f",
      ["/reverse:file:name=f"],
      "mkdir file:name=folder",
    );
    assert.deepEqual(result.calls, [["/reverse:file:name=f"]]);
    assert.deepEqual(result.replies, ["folder/"]);
    assert.equal(result.line, "eqapp /reverse:file:name=folder/ ");
  });
  it("retains native file metadata through repeated-value deduplication", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp --repeat-mixed=./name=f", [
      "--repeat-mixed=./name=f",
    ]);
    assert.deepEqual(result.replies, ["f", "foo.toml"]);
  });
  it("retains distinct metadata for identical joined file fallbacks", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --multi-files=./name",
      ["--multi-files=./name"],
      "touch name.log",
    );
    assert.deepEqual([...result.replies].sort(), [
      "./name with spaces.toml",
      "./name.log",
      "./name=foo.toml",
    ]);
  });
  it("preserves a closed incomplete ANSI-C control escape", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(String.raw`eqapp --control=$'\c'`, [
      String.raw`--control=\c`,
    ]);
    assert.deepEqual(result.calls, [[String.raw`--control=\c`]]);
    assert.ok(result.replies.some((reply) => reply.includes("-tail")));
  });
  it("honors escaped quotes before operators inside ANSI-C values", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(String.raw`eqapp --ansi-redirect=$'dev\'>ou`, [
      "--ansi-redirect=dev'>ou",
    ]);
    assert.deepEqual(result.calls, [["--ansi-redirect=dev'>ou"]]);
    assert.ok(result.replies.some((reply) => reply.endsWith("output")));
  });
  for (const name of ["--scope':'file", String.raw`--scope\:file`]) {
    it(
      `uses raw delimiter offsets after ${name}`,
      { skip: !ptyAvailable },
      () => {
        if (!ptyAvailable) return;
        const result = tab(
          `eqapp ${name}=~/name=f`,
          ["--scope:file=~/name=f"],
          'export HOME="$PWD"',
        );
        assert.ok(result.replies.includes("foo.toml"));
        assert.equal(result.line, `eqapp ${name}=~/name=foo.toml `);
      },
    );
  }

  for (const operator of [">", "<", ">>", "2>"]) {
    it(
      `stops joined reconstruction at ${operator}`,
      { skip: !ptyAvailable },
      () => {
        if (!ptyAvailable) return;
        const result = tab(`eqapp --redirect=dev${operator}ou`, [
          `--redirect=dev${operator}ou`,
        ]);
        assert.ok(
          !result.calls.some((args) =>
            args.includes(`--redirect=dev${operator}ou`)
          ),
        );
        assert.ok(!result.replies.includes("output"));
        assert.equal(result.line, `eqapp --redirect=dev${operator}ou`);
      },
    );
  }
  it("preserves quoted redirection characters in a joined value", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab('eqapp --redirect="dev>ou', ["--redirect=dev>ou"]);
    assert.deepEqual(result.calls, [["--redirect=dev>ou"]]);
    assert.equal(result.line, 'eqapp --redirect="dev>output" ');
  });

  it("preserves escaped redirection characters in a joined value", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(String.raw`eqapp --redirect=dev\>ou`, [
      "--redirect=dev>ou",
    ]);
    assert.deepEqual(result.calls, [["--redirect=dev>ou"]]);
    assert.ok(
      result.replies.includes("dev>output") ||
        result.replies.includes("output"),
    );
  });

  it(
    "keeps colons inside slash option file values",
    { skip: !ptyAvailable },
    () => {
      if (!ptyAvailable) return;
      const result = tab(
        "eqapp /config:./dir:name=f",
        ["/config:./dir:name=f"],
        "touch dir:name=foo.toml",
      );
      assert.deepEqual(result.calls, [["/config:./dir:name=f"]]);
      assert.equal(result.line, "eqapp /config:./dir:name=foo.toml ");
    },
  );

  it("preserves dot literals while filtering hidden file candidates", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --dot=",
      ["--dot="],
      "rm -- dir=x/.hidden.toml; rmdir dir=x; touch .env.unmatched",
    );
    assert.deepEqual(result.calls, [["--dot="]]);
    assert.deepEqual(result.replies, [".env"]);
    assert.equal(result.line, "eqapp --dot=.env ");
  });

  for (const prefix of ["/"]) {
    it(
      `completes a quoted ${prefix} option value`,
      { skip: !ptyAvailable },
      () => {
        if (!ptyAvailable) return;
        const current = `${prefix}mode:de`;
        const result = tab(`eqapp ${prefix}mode:"de`, [current]);
        assert.deepEqual(result.calls, [[current]]);
        assert.deepEqual(result.replies, ["dev"]);
        assert.equal(result.line, `eqapp ${prefix}mode:"dev" `);
      },
    );
    it(`reassembles ${prefix} option names without an equals word break`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const current = `${prefix}scope:name:d`;
      const result = tab(
        `eqapp ${current}`,
        [current],
        'COMP_WORDBREAKS="${COMP_WORDBREAKS//=}"',
      );
      assert.deepEqual(result.calls, [[current]]);
      assert.deepEqual(result.replies, ["dev"]);
      assert.equal(result.line, `eqapp ${prefix}scope:name:dev `);
    });
    it(
      `enumerates joined ${prefix} file values`,
      { skip: !ptyAvailable },
      () => {
        if (!ptyAvailable) return;
        const current = `${prefix}config:./name=f`;
        const result = tab(`eqapp ${current}`, [current]);
        assert.deepEqual(result.calls, [[current]]);
        assert.deepEqual(result.replies, ["foo.toml"]);
        assert.equal(result.line, `eqapp ${prefix}config:./name=foo.toml `);
      },
    );
    it(`expands a tilde after a split ${prefix} option name`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const current = `${prefix}scope:file:~/name=f`;
      const result = tab(
        `eqapp ${current}`,
        [current],
        'COMP_WORDBREAKS="${COMP_WORDBREAKS//=}"; export HOME="$PWD"',
      );
      assert.deepEqual(result.calls, [[current]]);
      assert.equal(result.line, `eqapp ${prefix}scope:file:~/name\\=foo.toml `);
    });
  }

  it("keeps an exact literal alongside matching native files", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp --mixed=./name=f", ["--mixed=./name=f"]);
    assert.deepEqual(result.replies, ["f", "foo.toml"]);
    assert.equal(result.line, "eqapp --mixed=./name=f");
  });

  it("retains an exact literal beside a file fallback with no matches", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp --mixed=known", ["--mixed=known"]);
    assert.deepEqual(result.calls, [["--mixed=known"]]);
    assert.deepEqual(result.replies, ["known"]);
    assert.equal(result.line, "eqapp --mixed=known ");
  });

  for (const setup of ["", 'COMP_WORDBREAKS="${COMP_WORDBREAKS//=}"']) {
    it(`keeps the raw value after split option names (${setup})`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const result = tab("eqapp --scope:file=~/name=f", [
        "--scope:file=~/name=f",
      ], `${setup}\nexport HOME="$PWD"`);
      assert.deepEqual(result.calls, [["--scope:file=~/name=f"]]);
      assert.equal(result.line, "eqapp --scope:file=~/name=foo.toml ");
    });
  }

  for (const input of ['eqapp --mode=$"de"', 'eqapp --mode=$"de']) {
    it(`decodes locale quotes in ${input}`, { skip: !ptyAvailable }, () => {
      if (!ptyAvailable) return;
      const result = tab(input, ["--mode=de"]);
      assert.deepEqual(result.calls, [["--mode=de"]]);
      assert.deepEqual(result.replies, ["dev"]);
      assert.equal(
        result.line,
        input.endsWith('"') ? "eqapp --mode=dev " : 'eqapp --mode=$"dev" ',
      );
    });
  }
  it("reassembles word breaks in option names", { skip: !ptyAvailable }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp --scope:name=d", ["--scope:name=d"]);
    assert.deepEqual(result.calls, [["--scope:name=d"]]);
    assert.deepEqual(result.replies, ["dev"]);
    assert.equal(result.line, "eqapp --scope:name=dev ");
  });
  it("expands a value-relative tilde without an equals word break", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=~/name=f",
      ["--config=~/name=f"],
      'COMP_WORDBREAKS="${COMP_WORDBREAKS//=}"; export HOME="$PWD"',
      false,
      true,
    );
    assert.deepEqual(result.calls, [["--config=~/name=f"]]);
    assert.equal(result.line, "eqapp --config=~/name=foo.toml ");
  });
  for (const omitPattern of [false, true]) {
    it(`keeps quoted joined tildes literal (patternless=${omitPattern})`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const result = tab(
        'eqapp --config="~/name=f',
        ["--config=~/name=f"],
        'COMP_WORDBREAKS="${COMP_WORDBREAKS//=}"; export HOME="$PWD"; mkdir -p "~"; touch "~/name=foo.toml"',
        false,
        omitPattern,
      );
      assert.deepEqual(result.calls, [["--config=~/name=f"]]);
      assert.equal(result.line, 'eqapp --config="./~/name=foo.toml" ');
    });
  }
  for (
    const c of [
      {
        input: 'eqapp --config="./name=f',
        line: 'eqapp --config="./name=foo.toml" ',
      },
      {
        input: 'eqapp --config=./na"me=f',
        line: 'eqapp --config=./na"me=foo.toml" ',
      },
      {
        input: 'eqapp --config=$"./name=f',
        line: 'eqapp --config=$"./name=foo.toml" ',
      },
    ]
  ) {
    it(`uses value-relative quote offsets in ${c.input}`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const result = tab(
        c.input,
        ["--config=./name=f"],
        'COMP_WORDBREAKS="${COMP_WORDBREAKS//=}"',
      );
      assert.deepEqual(result.calls, [["--config=./name=f"]]);
      assert.equal(result.line, c.line);
    });
  }

  for (
    const input of [
      "eqapp --mode=$'de'",
      String.raw`eqapp --mode=$'d\145'`,
      "eqapp --mode=$'de",
    ]
  ) {
    it(`decodes ANSI-C quoting in ${input}`, { skip: !ptyAvailable }, () => {
      if (!ptyAvailable) return;
      const result = tab(input, ["--mode=de"]);
      assert.deepEqual(result.calls, [["--mode=de"]]);
      assert.deepEqual(result.replies, ["dev"]);
      assert.equal(
        result.line,
        input.endsWith("'") ? "eqapp --mode=dev " : "eqapp --mode=$'dev' ",
      );
    });
  }
  for (
    const c of [
      {
        input: String.raw`eqapp --url=$'https://\x65xa'`,
        current: "--url=https://exa",
      },
      { input: String.raw`eqapp --url=$'a\cAb'`, current: "--url=a\x01b" },
      { input: String.raw`eqapp --url=$'a\q'`, current: String.raw`--url=a\q` },
      { input: String.raw`eqapp --url=$'a\0b'c`, current: "--url=ac" },
      { input: String.raw`eqapp --url=$'a\'b'`, current: "--url=a'b" },
      {
        input: "eqapp --url=$'$(touch marker)'",
        current: "--url=$(touch marker)",
      },
    ]
  ) {
    it(`decodes ANSI-C escapes without evaluation in ${c.input}`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      assert.deepEqual(tab(c.input, [c.current]).calls[0], [c.current]);
    });
  }
  it("uses COMP_POINT after a non-ASCII argument", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const args = ["--label=한글", "--mode=d"];
    const result = tab(
      "eqapp --label=한글 --mode=dx",
      args,
      "",
      false,
      false,
      1,
    );
    assert.deepEqual(result.calls, [args]);
    assert.deepEqual(result.replies, ["dev"]);
    assert.equal(result.line, "eqapp --label=한글 --mode=devx");
  });
  it("completes at the cursor before a joined value suffix", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp --mode=dev", ["--mode="], "", false, false, 3);
    assert.deepEqual(result.calls, [["--mode="]]);
    assert.deepEqual(result.replies, ["dev", "prod"]);
    assert.equal(result.line, "eqapp --mode=dev");
  });
  it("uses the current joined prefix before the cursor", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp --mode=dx", ["--mode=d"], "", false, false, 1);
    assert.deepEqual(result.calls, [["--mode=d"]]);
    assert.deepEqual(result.replies, ["dev"]);
    assert.equal(result.line, "eqapp --mode=devx");
  });

  it("preserves prefix-dependent file metadata", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp --sensitive-config=name=fo", [
      "--sensitive-config=name=fo",
    ]);
    assert.deepEqual(result.calls, [["--sensitive-config=name=fo"]]);
    assert.deepEqual(result.replies, ["foo.toml"]);
    assert.equal(result.line, "eqapp --sensitive-config=name=foo.toml ");
  });
  it(
    "stops reassembling joined values at whitespace",
    { skip: !ptyAvailable },
    () => {
      if (!ptyAvailable) return;
      const result = tab("eqapp --url=https: //exa", ["--url=https:", "//exa"]);
      assert.deepEqual(result.calls, [["--url=https:", "//exa"]]);
    },
  );
  for (
    const c of [
      {
        current: "--url=https://exa",
        reply: "//example.com",
        completed: "--url=https://example.com",
      },
      {
        current: "--url=https:",
        reply: "//example.com",
        completed: "--url=https://example.com",
      },
      {
        current: "--email=me@ex",
        reply: "@example.com",
        completed: "--email=me@example.com",
      },
      { current: "--tag=:ex", reply: "example", completed: "--tag=:example" },
      { current: "--tag=:", reply: "example", completed: "--tag=:example" },
      { current: "--tag=@ex", reply: "@example", completed: "--tag=@example" },
    ]
  ) {
    it(`reassembles all joined fragments in ${c.current}`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const result = tab(`eqapp ${c.current}`, [c.current]);
      assert.deepEqual(result.calls, [[c.current]]);
      assert.deepEqual(result.replies, [c.reply]);
      assert.equal(result.line, `eqapp ${c.completed} `);
    });
  }
  it(
    "reassembles breaks in previous joined arguments",
    { skip: !ptyAvailable },
    () => {
      if (!ptyAvailable) return;
      const result = tab(
        "eqapp --url=https://example.com --mail-transport=re",
        ["--url=https://example.com", "--mail-transport=re"],
      );
      assert.deepEqual(result.calls, [[
        "--url=https://example.com",
        "--mail-transport=re",
      ]]);
      assert.equal(
        result.line,
        "eqapp --url=https://example.com --mail-transport=resend ",
      );
    },
  );
  it("completes file suggestions without a pattern", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=./na",
      ["--config=./na"],
      "",
      false,
      true,
    );
    assert.deepEqual(result.calls, [["--config=./na"]]);
    assert.deepEqual([...result.replies].sort(), [
      "./name with spaces.toml",
      "./name=foo.toml",
    ]);
    assert.equal(result.line, "eqapp --config=./name");
  });
  it("does not mistake a consumed -- value for termination", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp --label -- --config=./name=f", [
      "--label",
      "--",
      "--config=./name=f",
    ]);
    assert.deepEqual(result.calls, [["--label", "--", "--config=./name=f"]]);
    assert.deepEqual(result.replies, ["foo.toml"]);
    assert.equal(result.line, "eqapp --label -- --config=./name=foo.toml ");
  });
  const cases = [
    {
      input: "eqapp --mail-transport=re",
      args: ["--mail-transport=re"],
      line: "eqapp --mail-transport=resend ",
      reply: "resend",
    },
    {
      input: "eqapp --mail-transport==re",
      args: ["--mail-transport==re"],
      line: "eqapp --mail-transport==resend ",
      reply: "resend",
    },
    {
      input: "eqapp --mail-transport=a=re",
      args: ["--mail-transport=a=re"],
      line: "eqapp --mail-transport=a=resend ",
      reply: "resend",
    },
    {
      input: "eqapp --mode=dev --mail-transport=re",
      args: ["--mode=dev", "--mail-transport=re"],
      line: "eqapp --mode=dev --mail-transport=resend ",
      reply: "resend",
    },
    {
      input: "eqapp --mail-transport re",
      args: ["--mail-transport", "re"],
      line: "eqapp --mail-transport resend ",
      reply: "resend",
    },
  ];
  for (const c of cases) {
    it(c.input, { skip: !ptyAvailable }, () => {
      if (!ptyAvailable) return;
      const result = tab(c.input, c.args);
      assert.deepEqual(result.calls, [c.args]);
      assert.deepEqual(result.replies, [c.reply]);
      assert.equal(result.line, c.line);
    });
  }
  it("completes an empty joined value", { skip: !ptyAvailable }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp --mode=", ["--mode="]);
    assert.deepEqual(result.calls, [["--mode="]]);
    assert.deepEqual(result.replies, ["dev", "prod"]);
    assert.equal(result.line, "eqapp --mode=");
  });
  for (
    const c of [
      {
        current: "--url=https://exa",
        reply: "//example.com",
        completed: "--url=https://example.com",
      },
      {
        current: "--url=https:",
        reply: "//example.com",
        completed: "--url=https://example.com",
      },
      {
        current: "--email=me@ex",
        reply: "@example.com",
        completed: "--email=me@example.com",
      },
    ]
  ) {
    it(`reassembles ${c.current} without an equals word break`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const result = tab(
        `eqapp ${c.current}`,
        [c.current],
        'COMP_WORDBREAKS="${COMP_WORDBREAKS//=}"',
      );
      assert.deepEqual(result.calls, [[c.current]]);
      assert.deepEqual(result.replies, [c.reply]);
      assert.equal(result.line, `eqapp ${c.completed} `);
    });
  }
  for (
    const c of [
      {
        input: 'eqapp --url="https://exa',
        current: "--url=https://exa",
        reply: "https://example.com",
        line: 'eqapp --url="https://example.com" ',
      },
      {
        input: "eqapp --url='https://exa",
        current: "--url=https://exa",
        reply: "https://example.com",
        line: "eqapp --url='https://example.com' ",
      },
      {
        input: String.raw`eqapp --url=https\://exa`,
        current: "--url=https://exa",
        reply: "https://example.com",
        line: "eqapp --url=https://example.com ",
      },
      {
        input: 'eqapp --url=https:"//exa',
        current: "--url=https://exa",
        reply: "//example.com",
        line: 'eqapp --url=https:"//example.com" ',
      },
      {
        input: String.raw`eqapp --url="https:\//exa`,
        current: String.raw`--url=https:\//exa`,
        reply: "",
        line: String.raw`eqapp --url="https:\//exa`,
      },
    ]
  ) {
    it(
      `dequotes joined protocol values in ${c.input}`,
      { skip: !ptyAvailable },
      () => {
        if (!ptyAvailable) return;
        const result = tab(c.input, [c.current]);
        assert.deepEqual(result.calls, [[c.current]]);
        assert.deepEqual(result.replies, [c.reply]);
        assert.equal(result.line, c.line);
      },
    );
  }
  for (
    const c of [
      {
        input: String.raw`eqapp --url="https://\$HOME`,
        current: "--url=https://$HOME",
      },
      {
        input: 'eqapp --url="https://$(touch marker)',
        current: "--url=https://$(touch marker)",
      },
      {
        input: 'eqapp --url="https://`touch marker`',
        current: "--url=https://`touch marker`",
      },
      { input: "eqapp --url='https://a b", current: "--url=https://a b" },
    ]
  ) {
    it(`decodes ${c.input} without expansion`, { skip: !ptyAvailable }, () => {
      if (!ptyAvailable) return;
      assert.deepEqual(tab(c.input, [c.current]).calls, [[c.current]]);
    });
  }
  it("dequotes previous joined values", { skip: !ptyAvailable }, () => {
    if (!ptyAvailable) return;
    const args = ["--url=https://example.com", "--mode=de"];
    const result = tab('eqapp --url="https://example.com" --mode=de', args);
    assert.deepEqual(result.calls, [args]);
    assert.equal(result.line, 'eqapp --url="https://example.com" --mode=dev ');
  });
  it("preserves whitespace without an equals word break", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const args = ["--url=https:", "//exa"];
    const result = tab(
      "eqapp --url=https: //exa",
      args,
      'COMP_WORDBREAKS="${COMP_WORDBREAKS//=}"',
    );
    assert.deepEqual(result.calls, [args]);
  });
  it("keeps the prefix when equals is not a word break", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --mail-transport=re",
      ["--mail-transport=re"],
      'COMP_WORDBREAKS="${COMP_WORDBREAKS//=}"',
    );
    assert.deepEqual(result.replies, ["--mail-transport=resend"]);
    assert.equal(result.line, "eqapp --mail-transport=resend ");
  });
  it(
    "enumerates joined file values, including spaces",
    { skip: !ptyAvailable },
    () => {
      if (!ptyAvailable) return;
      const result = tab("eqapp --config=./name", ["--config=./name"]);
      assert.deepEqual(result.calls, [["--config=./name"]]);
      assert.deepEqual([...result.replies].sort(), [
        "./name with spaces.toml",
        "./name=foo.toml",
      ]);
      // Filename quoting is separate; verify insertion retains the option prefix.
      assert.ok(result.line.startsWith("eqapp --config=./name"));
    },
  );
  it("inserts a shared value prefix without blank candidates", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp --region=r", ["--region=r"]);
    assert.deepEqual(result.replies, ["remote", "relay"]);
    assert.equal(result.line, "eqapp --region=re");
  });
  it("keeps completed literals without probing them as files", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp --mode=dev", ["--mode=dev"]);
    assert.deepEqual(result.calls, [["--mode=dev"]]);
    assert.deepEqual(result.replies, ["dev"]);
    assert.equal(result.line, "eqapp --mode=dev ");
  });
  it("does not treat a joined flag as a file", { skip: !ptyAvailable }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp --verbose=", ["--verbose="]);
    assert.deepEqual(result.calls, [["--verbose="]]);
    assert.equal(result.line, "eqapp --verbose=");
  });
  for (
    const c of [
      { current: "./name=f", reply: "foo.toml", value: "./name=foo.toml" },
      { current: "./name=", reply: "foo.toml", value: "./name=foo.toml" },
      { current: "=lead", reply: "leading.toml", value: "=leading.toml" },
      {
        current: "dir=x/.h",
        reply: "x/.hidden.toml",
        value: "dir=x/.hidden.toml",
      },
    ]
  ) {
    it(`completes file value ${c.current}`, { skip: !ptyAvailable }, () => {
      if (!ptyAvailable) return;
      const result = tab(`eqapp --config=${c.current}`, [
        `--config=${c.current}`,
      ]);
      assert.deepEqual(result.replies, [c.reply]);
      assert.equal(result.line, `eqapp --config=${c.value} `);
    });
  }
  for (
    const c of [
      {
        input: "eqapp --mail-transport =re",
        args: ["--mail-transport", "=re"],
      },
      {
        input: "eqapp --mail-transport= re",
        args: ["--mail-transport=", "re"],
      },
      {
        input: "eqapp --mail-transport = re",
        args: ["--mail-transport", "=", "re"],
      },
    ]
  ) {
    it(`preserves whitespace in ${c.input}`, { skip: !ptyAvailable }, () => {
      if (!ptyAvailable) return;
      assert.deepEqual(tab(c.input, c.args).calls, [c.args]);
    });
  }
  it("handles first-request positional file directives separately", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=./name=f",
      ["--config=./name=f"],
      "",
      true,
    );
    assert.deepEqual(result.replies, ["foo.toml"]);
    assert.equal(result.line, "eqapp --config=./name=foo.toml ");
  });
  it(
    "keeps literals alongside first-request files",
    { skip: !ptyAvailable },
    () => {
      if (!ptyAvailable) return;
      const result = tab(
        "eqapp --mode=dev",
        ["--mode=dev"],
        "touch -- --mode=dev-file",
        true,
      );
      assert.deepEqual(result.replies, ["dev", "dev-file"]);
    },
  );
  it("preserves the full prefix for files without an equals word break", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab(
      "eqapp --config=./name=f",
      ["--config=./name=f"],
      'COMP_WORDBREAKS="${COMP_WORDBREAKS//=}"',
    );
    assert.deepEqual(result.replies, ["--config=./name=foo.toml"]);
    assert.equal(result.line, "eqapp --config=./name=foo.toml ");
  });
  it("does not retry joined-looking positional values after --", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp -- --mode=dev", ["--", "--mode=dev"], "", true);
    assert.deepEqual(result.calls, [["--", "--mode=dev"]]);
  });
  it(
    "does not add a space for missing joined files",
    { skip: !ptyAvailable },
    () => {
      if (!ptyAvailable) return;
      const result = tab("eqapp --config=./missing", ["--config=./missing"]);
      assert.deepEqual(result.replies, [""]);
      assert.equal(result.line, "eqapp --config=./missing");
    },
  );
});
