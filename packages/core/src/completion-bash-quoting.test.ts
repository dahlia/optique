import { deepStrictEqual, ok } from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { describe, it } from "node:test";
import { bash } from "./completion.ts";

function hasBash(): boolean {
  try {
    execFileSync("bash", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const bashAvailable = hasBash();

function hasCompopt(): boolean {
  if (!bashAvailable) return false;
  try {
    return execFileSync("bash", ["-c", "type -t compopt"], {
      encoding: "utf8",
    }).trim() === "builtin";
  } catch {
    return false;
  }
}

const compoptAvailable = hasCompopt();

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

// Interactive Bash uses Readline even with piped input.  Unlike calling the
// completion function directly, Tab here exercises quoting and suffix insertion.
function completeAndExecute(
  input: string,
  files: readonly string[],
  options: {
    readonly errexit?: boolean;
    readonly omitHomeEntry?: boolean;
    readonly preserveReplyIndex?: boolean;
    readonly suggestions?: string;
    readonly withoutCompopt?: boolean;
  } = {},
): {
  readonly args: readonly string[];
  readonly marker: boolean;
  readonly home: string;
} {
  const dir = mkdtempSync(join(tmpdir(), "optique-bash-quoting-"));
  const cwd = options.omitHomeEntry ? join(dir, "work") : dir;
  const home = options.omitHomeEntry ? cwd : join(dir, "home");
  try {
    if (options.omitHomeEntry) mkdirSync(cwd);
    if (!options.omitHomeEntry) mkdirSync(home);
    for (const file of files) {
      const path = join(cwd, file);
      if (file.endsWith("/")) mkdirSync(path, { recursive: true });
      else {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, "");
      }
    }
    const scriptPath = join(dir, "completion.bash");
    writeFileSync(scriptPath, bash.generateScript("probecli", ["complete"]));
    const suggestionsPath = join(dir, "suggestions");
    writeFileSync(
      suggestionsPath,
      options.suggestions ?? "__FILE__:file:::0\n",
    );
    // path().suggest(prefix) returns the raw prefix as its file pattern.
    const transport = options.suggestions === undefined
      ? `local prefix="\${!#}"; prefix="\${prefix//%/%25}"; prefix="\${prefix//:/%3A}"; printf '__FILE__:file::%s:0\\n' "$prefix"`
      : `cat ${shellQuote(suggestionsPath)}`;
    const setup = `PS1= PS2=
set +o history
bind 'set enable-bracketed-paste off' 2>/dev/null
bind '"\\C-i": complete'
probecli() { if [[ "$1" == complete ]]; then ${transport}; else printf '%s\\0' "$@"; fi; }
${options.withoutCompopt ? "enable -n compopt 2>/dev/null || :" : ""}
source ${shellQuote(scriptPath)} || exit 1
${options.preserveReplyIndex ? "__reply_index=sentinel" : ""}
${options.errexit ? "set -e" : ""}
${input}
${
      options.preserveReplyIndex
        ? '[[ "$__reply_index" == sentinel ]] || exit 1'
        : ""
    }
exit
`;
    const stdout = execFileSync("bash", ["--noprofile", "--norc", "-i"], {
      input: setup,
      cwd,
      encoding: "utf8",
      timeout: 10_000,
      env: {
        ...process.env,
        HOME: home,
        INPUTRC: "/dev/null",
        TERM: "dumb",
        LC_ALL: "C",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    ok(
      stdout.endsWith("\0"),
      "The completed command must execute and log its arguments.",
    );
    return {
      args: stdout.slice(0, -1).split("\0"),
      marker: existsSync(join(cwd, "marker")),
      home,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Bash Readline file completion quoting", () => {
  for (
    const file of [
      "name with spaces.toml",
      "name;touch marker;#.toml",
      "name$(touch marker).toml",
      "name'quote\".toml",
      "name\\slash.toml",
      "name[glob]*.toml",
    ]
  ) {
    it(`inserts ${JSON.stringify(file)} as one literal argument`, {
      skip: !bashAvailable,
    }, () => {
      if (!bashAvailable) return;
      const result = completeAndExecute("probecli --config ./name\t", [file]);
      deepStrictEqual(result.args, ["--config", `./${file}`]);
      ok(!result.marker);
    });
  }

  it("continues into a directory containing spaces over two Tabs", {
    skip: !bashAvailable,
  }, () => {
    if (!bashAvailable) return;
    const result = completeAndExecute("probecli ./dir\tchild\t", [
      "dir with spaces/",
      "dir with spaces/child file.toml",
    ]);
    deepStrictEqual(result.args, ["./dir with spaces/child file.toml"]);
  });

  it("continues into a directory without inserting a space", {
    skip: !bashAvailable,
  }, () => {
    if (!bashAvailable) return;
    const result = completeAndExecute("probecli ./dir\tchild\t", [
      "directory/",
      "directory/child.toml",
    ]);
    deepStrictEqual(result.args, ["./directory/child.toml"]);
  });

  it(
    "completes multiple matches incrementally after escaping their common prefix",
    { skip: !bashAvailable },
    () => {
      if (!bashAvailable) return;
      const result = completeAndExecute("probecli ./name\tone\t", [
        "name with spaces one.toml",
        "name with spaces two.toml",
      ]);
      deepStrictEqual(result.args, ["./name with spaces one.toml"]);
    },
  );

  for (const quote of ["'", '"']) {
    it(
      `completes inside an opening ${quote} quote`,
      { skip: !bashAvailable },
      () => {
        if (!bashAvailable) return;
        const result = completeAndExecute(`probecli ${quote}./name\t`, [
          "name with spaces.toml",
        ]);
        deepStrictEqual(result.args, ["./name with spaces.toml"]);
      },
    );
  }

  for (const quote of ["'", '"']) {
    it(`completes after an opening ${quote} quote within a word`, {
      skip: !bashAvailable,
    }, () => {
      if (!bashAvailable) return;
      const file = "cfg/sub/a$(touch marker).toml";
      const result = completeAndExecute(
        `probecli cfg/${quote}sub/a\t`,
        [file],
      );
      deepStrictEqual(result.args, [file]);
      ok(!result.marker);
    });
  }

  for (
    const file of [
      "name$(touch marker).toml",
      "name`touch marker`.toml",
      "name\\$(touch marker).toml",
    ]
  ) {
    it(`keeps ${JSON.stringify(file)} literal inside double quotes`, {
      skip: !bashAvailable,
    }, () => {
      if (!bashAvailable) return;
      const result = completeAndExecute('probecli "./name\t', [file]);
      deepStrictEqual(result.args, [`./${file}`]);
      ok(!result.marker);
    });
  }

  it("keeps an embedded double quote literal inside double quotes", {
    skip: !bashAvailable,
  }, () => {
    if (!bashAvailable) return;
    const file = 'name"quote.toml';
    const result = completeAndExecute('probecli "./name\t', [file]);
    deepStrictEqual(result.args, [`./${file}`]);
  });

  it("keeps a backslash literal inside double quotes", {
    skip: !bashAvailable,
  }, () => {
    if (!bashAvailable) return;
    const file = "name\\slash.toml";
    const result = completeAndExecute('probecli "./name\t', [file]);
    deepStrictEqual(result.args, [`./${file}`]);
  });

  it("escapes each candidate once across multiple file directives", {
    skip: !bashAvailable,
  }, () => {
    if (!bashAvailable) return;
    const file = "name$(touch marker).toml";
    const result = completeAndExecute('probecli "./name\t', [file], {
      suggestions: "__FILE__:file:toml::0\n__FILE__:file:json::0\n",
    });
    deepStrictEqual(result.args, [`./${file}`]);
    ok(!result.marker);
  });

  it("escapes candidates after earlier replies are filtered out", {
    skip: !bashAvailable,
  }, () => {
    if (!bashAvailable) return;
    const file = "name$(touch marker).toml";
    const result = completeAndExecute('probecli "./\t', [
      ".a.hidden",
      file,
    ], {
      omitHomeEntry: true,
      suggestions: "__FILE__:file:hidden::1\n__FILE__:file:toml::0\n",
    });
    deepStrictEqual(result.args, [`./${file}`]);
    ok(!result.marker);
  });

  it("completes an initially escaped word under errexit", {
    skip: !bashAvailable,
  }, () => {
    if (!bashAvailable) return;
    const result = completeAndExecute("probecli \\ \t", [" leading.toml"], {
      errexit: true,
    });
    deepStrictEqual(result.args, [" leading.toml"]);
  });

  it(
    "continues a tilde path containing spaces",
    { skip: !bashAvailable },
    () => {
      if (!bashAvailable) return;
      const result = completeAndExecute("probecli ~/dir\tchild\t", [
        "home/dir with spaces/",
        "home/dir with spaces/child.toml",
      ]);
      deepStrictEqual(result.args, [
        `${result.home}/dir with spaces/child.toml`,
      ]);
    },
  );

  it("keeps a tilde supplied by the file pattern", {
    skip: !bashAvailable,
  }, () => {
    if (!bashAvailable) return;
    const result = completeAndExecute("probecli \t", [
      "home/cfg/result.toml",
    ], {
      suggestions: "__FILE__:file::~/cfg/:0\n",
    });
    deepStrictEqual(result.args, [`${result.home}/cfg/result.toml`]);
  });

  it("completes after an opening quote within a tilde path", {
    skip: !bashAvailable,
  }, () => {
    if (!bashAvailable) return;
    const result = completeAndExecute('probecli ~/"cfg/res\t', [
      "home/cfg/result.toml",
    ]);
    deepStrictEqual(result.args, [`${result.home}/cfg/result.toml`]);
  });

  it("keeps backticks literal in a quoted tilde pattern", {
    skip: !bashAvailable,
  }, () => {
    if (!bashAvailable) return;
    const result = completeAndExecute('probecli "\t', [
      "home/cfg/a`b`.toml",
    ], {
      suggestions: "__FILE__:file::~/cfg/:0\n",
    });
    deepStrictEqual(result.args, [`${result.home}/cfg/a\`b\`.toml`]);
  });

  it("preserves the shell's reply index for a quoted tilde pattern", {
    skip: !bashAvailable,
  }, () => {
    if (!bashAvailable) return;
    const result = completeAndExecute('probecli "\t', [
      "home/cfg/result.toml",
    ], {
      suggestions: "__FILE__:file::~/cfg/:0\n",
      preserveReplyIndex: true,
    });
    deepStrictEqual(result.args, [`${result.home}/cfg/result.toml`]);
  });

  for (const quote of ["'", '"']) {
    it(`uses one directory separator after an opening ${quote} quote`, {
      skip: !bashAvailable,
    }, () => {
      if (!bashAvailable) return;
      const result = completeAndExecute(`probecli ${quote}./dir\tchild\t`, [
        "dir with spaces/child.toml",
      ]);
      deepStrictEqual(result.args, ["./dir with spaces/child.toml"]);
    });
  }

  it("keeps a quoted tilde literal", { skip: !bashAvailable }, () => {
    if (!bashAvailable) return;
    const result = completeAndExecute("probecli '~/lit\t", [
      "~/",
      "~/literal.toml",
    ]);
    deepStrictEqual(result.args, ["./~/literal.toml"]);
  });

  it("keeps a quoted named-user tilde literal", {
    skip: !bashAvailable,
  }, () => {
    if (!bashAvailable) return;
    const result = completeAndExecute("probecli '~root/lit\t", [
      "~root/",
      "~root/literal.toml",
    ]);
    deepStrictEqual(result.args, ["./~root/literal.toml"]);
  });

  for (const quote of ["'", '"']) {
    it(`keeps a tilde candidate literal after an empty ${quote} quote`, {
      skip: !bashAvailable,
    }, () => {
      if (!bashAvailable) return;
      const result = completeAndExecute(`probecli ${quote}\t`, ["~root"], {
        omitHomeEntry: true,
      });
      deepStrictEqual(result.args, ["./~root"]);
    });
  }

  it("keeps ordinary literal suggestions separate from directory completion", {
    // Bash 3.2 uses the documented static filename-mode fallback.
    skip: !compoptAvailable,
  }, () => {
    if (!compoptAvailable) return;
    const result = completeAndExecute("probecli bu\tx", ["build/"], {
      suggestions: "build\n",
    });
    deepStrictEqual(result.args, ["build", "x"]);
  });

  it("quotes file candidates when compopt is unavailable", {
    skip: !bashAvailable,
  }, () => {
    if (!bashAvailable) return;
    const file = "name;touch marker;#.toml";
    const result = completeAndExecute("probecli ./name\t", [file], {
      withoutCompopt: true,
    });
    deepStrictEqual(result.args, [`./${file}`]);
    ok(!result.marker);
  });

  it(
    "keeps a literal candidate separate when a file directive has no matches",
    {
      skip: !compoptAvailable,
    },
    () => {
      if (!compoptAvailable) return;
      const result = completeAndExecute("probecli bu\tx", ["build/"], {
        suggestions: "build\n__FILE__:file::missing/:0\n",
      });
      deepStrictEqual(result.args, ["build", "x"]);
    },
  );
});
