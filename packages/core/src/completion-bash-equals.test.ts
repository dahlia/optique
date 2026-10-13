import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
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
const fields = {
  url: optional(option("--url", choice(["https://example.com"]))),
  email: optional(option("--email", choice(["me@example.com"]))),
  tag: optional(option("--tag", choice([":example", "@example"]))),
  label: optional(option("--label", string())),
  mode: optional(option("--mode", choice(["dev", "prod"]))),
  transport: optional(
    option("--mail-transport", choice(["resend", "a=resend", "=resend"])),
  ),
  config: optional(option("--config", files)),
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
    os.write(fd, sys.argv[2].encode() + b'\t\x18\x12')
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
    const retry = current.startsWith("--") && current.includes("=")
      ? [
        ...args.slice(0, -1),
        current.slice(0, current.indexOf("=")),
        current.slice(current.indexOf("=") + 1).split("=")[0],
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
        ["-c", ptyDriver, join(dir, "init.bash"), input],
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
    return { line, replies: lines("replies"), calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("joined Bash option completion", () => {
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
      ["--label", "--", "--config", "./name"],
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
