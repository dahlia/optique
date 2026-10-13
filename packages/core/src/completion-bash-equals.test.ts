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
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { bash } from "./completion.ts";
import { object } from "./constructs.ts";
import { optional } from "./modifiers.ts";
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
const fields = {
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
    const current = args.at(-1) ?? "";
    const retry = /^[-/+]/.test(current) && current.includes("=")
      ? [
        ...args.slice(0, -1),
        current.slice(0, current.indexOf("=")),
        current.slice(current.indexOf("=") + 1),
      ]
      : undefined;
    const requests = retry === undefined ? [args] : [args, retry];
    const branches = requests.map((request) => {
      const [first, ...rest] = request;
      assert.ok(first !== undefined);
      const protocol = Array.from(
        bash.encodeSuggestions(
          omitPattern
            ? suggest(withoutPattern, [first, ...rest])
            : positional
            ? suggest(withPositionalFiles, [first, ...rest])
            : suggest(parser, [first, ...rest]),
        ),
      ).map((chunk) => chunk + "\n").join("");
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
  _eqapp "$@"
  [[ "$(declare -p COMP_WORDS)" == "$saved_words" && "$COMP_WORDBREAKS" == "$saved_breaks" ]] && printf unchanged > state
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
  for (const prefix of ["/", "+"]) {
    it(
      `completes a quoted ${prefix} option value`,
      { skip: !ptyAvailable },
      () => {
        if (!ptyAvailable) return;
        const current = `${prefix}mode=de`;
        const result = tab(`eqapp ${prefix}mode="de`, [current]);
        assert.deepEqual(result.calls, [[current]]);
        assert.deepEqual(result.replies, ["dev"]);
        assert.equal(result.line, `eqapp ${prefix}mode="dev" `);
      },
    );
    it(`reassembles ${prefix} option names without an equals word break`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const current = `${prefix}scope:name=d`;
      const result = tab(
        `eqapp ${current}`,
        [current],
        'COMP_WORDBREAKS="${COMP_WORDBREAKS//=}"',
      );
      assert.deepEqual(result.calls, [[current]]);
      assert.deepEqual(result.replies, ["name=dev"]);
      assert.equal(result.line, `eqapp ${prefix}scope:name=dev `);
    });
    it(
      `enumerates joined ${prefix} file values`,
      { skip: !ptyAvailable },
      () => {
        if (!ptyAvailable) return;
        const current = `${prefix}config=./name=f`;
        const result = tab(`eqapp ${current}`, [current]);
        assert.deepEqual(result.calls, [[current], [
          `${prefix}config`,
          "./name=f",
        ]]);
        assert.deepEqual(result.replies, ["foo.toml"]);
        assert.equal(result.line, `eqapp ${prefix}config=./name=foo.toml `);
      },
    );
    it(`expands a tilde after a split ${prefix} option name`, {
      skip: !ptyAvailable,
    }, () => {
      if (!ptyAvailable) return;
      const current = `${prefix}scope:file=~/name=f`;
      const result = tab(
        `eqapp ${current}`,
        [current],
        'COMP_WORDBREAKS="${COMP_WORDBREAKS//=}"; export HOME="$PWD"',
      );
      assert.deepEqual(result.calls, [[current], [
        `${prefix}scope:file`,
        "~/name=f",
      ]]);
      assert.equal(result.line, `eqapp ${prefix}scope:file=~/name=foo.toml `);
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
    assert.deepEqual(result.calls, [["--mixed=known"], ["--mixed", "known"]]);
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
      assert.deepEqual(result.calls, [["--scope:file=~/name=f"], [
        "--scope:file",
        "~/name=f",
      ]]);
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
    assert.deepEqual(result.calls, [["--config=~/name=f"], [
      "--config",
      "~/name=f",
    ]]);
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
      assert.deepEqual(result.calls, [["--config=~/name=f"], [
        "--config",
        "~/name=f",
      ]]);
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
      assert.deepEqual(result.calls, [["--config=./name=f"], [
        "--config",
        "./name=f",
      ]]);
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

  it("preserves prefix-dependent file metadata through the retry", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp --sensitive-config=name=fo", [
      "--sensitive-config=name=fo",
    ]);
    assert.deepEqual(result.calls, [["--sensitive-config=name=fo"], [
      "--sensitive-config",
      "name=fo",
    ]]);
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
    assert.deepEqual(result.calls, [["--config=./na"], ["--config", "./na"]]);
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
    assert.deepEqual(result.calls, [
      ["--label", "--", "--config=./name=f"],
      ["--label", "--", "--config", "./name=f"],
    ]);
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
      assert.deepEqual(result.calls, [["--config=./name"], [
        "--config",
        "./name",
      ]]);
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
  it("keeps completed literals when the retry has no file directive", {
    skip: !ptyAvailable,
  }, () => {
    if (!ptyAvailable) return;
    const result = tab("eqapp --mode=dev", ["--mode=dev"]);
    assert.deepEqual(result.calls, [["--mode=dev"], ["--mode", "dev"]]);
    assert.deepEqual(result.replies, ["dev"]);
    assert.equal(result.line, "eqapp --mode=dev ");
  });
  it("does not retry a joined flag", { skip: !ptyAvailable }, () => {
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
