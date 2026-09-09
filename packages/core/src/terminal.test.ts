import { getDisplayWidth } from "./displaywidth.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createMessageFormatter,
  formatMessage,
  type Message,
  message,
  optionNames,
  values,
} from "@optique/core/message";
import type { TerminalTheme } from "@optique/core/terminal";

describe("terminal themes", () => {
  it("should apply scalar overrides to lists without losing quoting", () => {
    const theme: TerminalTheme = {
      value: (_term, context) => ({ type: "text", text: `<${context.text}>` }),
      optionName: (_term, context) => ({
        type: "text",
        text: `{${context.text}}`,
      }),
    };
    const format = createMessageFormatter(theme);
    assert.equal(
      format(message`${values(["a", "b"])} ${optionNames(["-x", "--extra"])}`),
      '<"a"> <"b"> {`-x`}/{`--extra`}',
    );
  });
  it("should let scalar themes remove list coloring", () => {
    for (const delegate of [false, true]) {
      const format = createMessageFormatter({
        value: (_term, context) => ({ type: "text", text: context.text }),
        ...(delegate ? { values: defaultTerminalTheme.values } : {}),
      });
      assert.equal(
        format(message`${values(["a", "b"])}`, { colors: true }),
        '"a" "b"',
      );
      assert.equal(
        format(message`${values(["a", "b"])}`, {
          colors: true,
          quotes: false,
          maxWidth: 2,
        }),
        "a \nb",
      );
    }
  });
  it("should account for initial width without adding padding", () => {
    assert.equal(
      formatMessage(message`one two`, { maxWidth: 7, initialWidth: 3 }),
      "one \ntwo",
    );
    assert.throws(
      () => formatMessage(message`x`, { initialWidth: -1 }),
      RangeError,
    );
  });
  it("should compose nested styles and hyperlinks before serialization", () => {
    const format = createMessageFormatter({
      value: (_term, context) => ({
        type: "style",
        style: { bold: true },
        children: [
          {
            type: "link",
            href: "https://example.com/",
            children: [
              {
                type: "style",
                style: { foreground: [12, 34, 56] },
                children: [{ type: "text", text: context.text }],
              },
            ],
          },
        ],
      }),
    });
    assert.equal(format(message`${"hello"}`, { colors: false }), '"hello"');
    const colored = format(message`${"hello"}`, { colors: true });
    assert.ok(colored.includes("\x1b[38;2;12;34;56m"));
    assert.ok(colored.includes("\x1b]8;;https://example.com/\x1b\\"));
    assert.ok(colored.endsWith("\x1b[0m"));
  });
});

import { formatDocPage } from "@optique/core/doc";
import { formatUsage, formatUsageTerm } from "@optique/core/usage";
import { defaultTerminalTheme } from "@optique/core/terminal";
import { lineBreak, type MessageFormatterOptions } from "@optique/core/message";
import { runParserAsync, runParserSync } from "@optique/core/facade";
import { option } from "@optique/core/primitives";
import { string } from "@optique/core/valueparser";

describe("theme integration", () => {
  const theme: TerminalTheme = {
    value: (_term, context) => ({
      type: "text",
      text: `VALUE(${context.text})`,
    }),
    optionName: (term) => ({
      type: "text",
      text: `OPTION(${term.optionName})`,
    }),
    programName: () => ({ type: "text", text: "PROGRAM" }),
    errorLabel: () => ({ type: "text", text: "Failure:" }),
    label: (term) => ({
      type: "text",
      text: term.kind === "usageSummary"
        ? "Invocation:"
        : `LABEL(${term.label})`,
    }),
    syntaxPunctuation: (term, context) =>
      term.kind === "optionalOpen"
        ? { type: "text", text: "OPTIONAL(" }
        : defaultTerminalTheme.syntaxPunctuation(term, context),
  };
  it("should theme usage leaves before measuring their widths", () => {
    assert.equal(
      formatUsage("app", [{ type: "option", names: ["-x"] }], {
        theme,
        maxWidth: 15,
      }),
      "PROGRAM\nOPTION(-x)",
    );
    assert.equal(
      formatUsageTerm({
        type: "optional",
        terms: [{ type: "argument", metavar: "X" }],
      }, { theme }),
      "OPTIONAL(X]",
    );
  });
  it("should preserve styled trailing separators at a wrapping boundary", () => {
    const term = { type: "option", names: ["-x", "--long"] } as const;
    assert.equal(
      formatUsageTerm(term, { maxWidth: 5, optionsSeparator: ", " }),
      "-x,\n--long",
    );
    assert.equal(
      formatUsageTerm(term, {
        colors: true,
        maxWidth: 5,
        optionsSeparator: ", ",
      }),
      "\x1b[3m-x\x1b[0m\x1b[2m, \x1b[0m\n\x1b[3m--long\x1b[0m",
    );
  });
  it("should pass the original description and occupied width to a custom formatter", () => {
    const description = message`description`;
    const calls: { message: unknown; options?: MessageFormatterOptions }[] = [];
    const rendered = formatDocPage("app", {
      sections: [{
        title: "Flags",
        entries: [{
          term: { type: "option", names: ["--long-option"] },
          description,
        }],
      }],
    }, {
      theme,
      termWidth: 4,
      maxWidth: 40,
      messageFormatter: (message, options) => {
        calls.push({ message, options });
        return "CUSTOM";
      },
    });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].message, description);
    assert.equal(calls[0].options?.initialWidth, 17);
    assert.ok(rendered.includes("LABEL(Flags:)"));
    assert.ok(rendered.includes("OPTION(--long-option)  CUSTOM"));
  });
  it("should theme defaults and choices while preserving formatter precedence", () => {
    const seen: MessageFormatterOptions[] = [];
    const output = formatDocPage("app", {
      sections: [{
        entries: [{
          term: { type: "option", names: ["-x"] },
          default: message`${"d"}`,
          choices: message`${"c"}`,
        }],
      }],
    }, {
      theme,
      colors: true,
      showDefault: true,
      showChoices: true,
      messageFormatter: (_message, options) => {
        seen.push(options ?? {});
        return "CUSTOM";
      },
    });
    assert.equal(seen.length, 2);
    assert.ok(seen.every((o) => o.colors === true));
    assert.ok(output.includes("CUSTOM"));
    assert.ok(!output.includes("VALUE("));
  });
  for (const async of [false, true]) {
    it(`should propagate themes and custom formatters through ${async ? "async" : "sync"} help and errors`, async () => {
      const parser = option("--name", string(), {
        description: message`Name description.`,
      });
      for (
        const args of [["--help"], [], ["help", "unknown"], ["--completion"], [
          "--completion",
          "unknown",
        ], ["--completion", "--help"]]
      ) {
        const output: string[] = [];
        const errors: unknown[] = [];
        const seen = new Map<unknown, MessageFormatterOptions | undefined>();
        const options = {
          theme,
          maxWidth: 50,
          help: {
            option: true as const,
            command: true as const,
            onShow: () => "help",
          },
          completion: { option: true as const, onShow: () => "completion" },
          messageFormatter: (
            error: Message,
            options?: MessageFormatterOptions,
          ) => {
            seen.set(error, options);
            return "CUSTOM MESSAGE";
          },
          stdout: (s: string) => output.push(s),
          stderr: (s: string) => output.push(s),
          onError: (_code: number, error: unknown) => {
            errors.push(error);
            assert.equal(seen.get(error)?.maxWidth, 50);
            assert.equal(seen.get(error)?.initialWidth, 9);
            return "error";
          },
        };
        if (async) await runParserAsync(parser, "app", args, options);
        else runParserSync(parser, "app", args, options);
        assert.ok(
          output.join("\n").includes("CUSTOM MESSAGE"),
          JSON.stringify(args),
        );
        if (errors.length) {
          assert.ok(output.join("\n").includes("Failure:"));
          assert.ok(Array.isArray(errors[0]));
        }
      }
    });
  }
});

for (const async of [false, true]) {
  it(`wraps ${async ? "async" : "sync"} errors after the rendered prefix`, async () => {
    for (const label of ["Error:", "問題:", "Header\n問題:"]) {
      const output: string[] = [];
      let calls = 0;
      const options = {
        colors: true,
        maxWidth: 20,
        aboveError: "none" as const,
        theme: {
          errorLabel: () => {
            calls++;
            return {
              type: "style" as const,
              style: { foreground: "red" as const },
              children: [{ type: "text" as const, text: label }],
            };
          },
        },
        stderr: (line: string) => output.push(line),
        onError: () => "error",
      };
      const parser = option("--name", string());
      if (async) await runParserAsync(parser, "app", ["--unknown"], options);
      else runParserSync(parser, "app", ["--unknown"], options);
      assert.equal(calls, 1);
      assert.ok(output[0].startsWith("\x1b[31m" + label));
      for (const line of output[0].split("\n")) {
        assert.ok(getDisplayWidth(line) <= 20, JSON.stringify(line));
      }
    }
  });
}

describe("structured fragment boundaries", () => {
  it("should keep plural color scopes across wraps and close singleton scopes", () => {
    const format = createMessageFormatter({});
    assert.equal(
      createMessageFormatter(defaultTerminalTheme)(
        message`${values(["a", "b"])}`,
        { colors: true, quotes: false, maxWidth: 2 },
      ),
      "\x1b[32ma \nb\x1b[0m",
    );
    assert.equal(
      format(message`${values(["a", "b"])}`, {
        colors: true,
        quotes: false,
        maxWidth: 2,
      }),
      "\x1b[32ma \nb\x1b[0m",
    );
    assert.equal(
      format([{ type: "values", values: ["a"] }], {
        colors: true,
        quotes: false,
      }),
      "\x1b[32ma\x1b[0m",
    );
  });
  it("should validate occupied width and reset it after hard breaks", () => {
    for (const initialWidth of [NaN, Infinity, 1.5]) {
      assert.throws(
        () => formatMessage(message`x`, { initialWidth }),
        TypeError,
      );
    }
    assert.equal(
      formatMessage(message`x${lineBreak()}abcd`, {
        initialWidth: 3,
        maxWidth: 4,
      }),
      "x\nabcd",
    );
  });
  it("should validate colors even in plain output", () => {
    const format = createMessageFormatter({
      value: (_term, context) => ({
        type: "style",
        style: { foreground: [0, 256, 0] },
        children: [{ type: "text", text: context.text }],
      }),
    });
    assert.throws(() => format(message`${"x"}`), RangeError);
  });
  it("should snapshot the theme callback selection", () => {
    const theme = { value: () => ({ type: "text" as const, text: "before" }) };
    const format = createMessageFormatter(theme);
    theme.value = () => ({ type: "text", text: "after" });
    assert.equal(format(message`${"x"}`), "before");
  });
  it("should disable inherited attributes and restore the parent", () => {
    const format = createMessageFormatter({
      value: () => ({
        type: "style",
        style: { bold: true },
        children: [
          { type: "text", text: "a" },
          {
            type: "style",
            style: { bold: false, foreground: { index: 123 } },
            children: [{ type: "text", text: "b" }],
          },
          { type: "text", text: "c" },
        ],
      }),
    });
    assert.equal(
      format(message`${"x"}`, { colors: true }),
      "\x1b[1ma\x1b[0m\x1b[38;5;123mb\x1b[0m\x1b[1mc\x1b[0m",
    );
  });
  it("should preserve grapheme widths and atomic themed text leaves", () => {
    const format = createMessageFormatter({
      value: () => ({
        type: "concat",
        children: [{ type: "text", text: "한글" }, {
          type: "text",
          text: "👩‍💻",
        }],
      }),
    });
    assert.equal(format(message`${"x"}`, { maxWidth: 4 }), "한글\n👩‍💻");
  });
});

describe("ambient terminal composition", () => {
  it("should restore an enclosing OSC hyperlink after a child link", () => {
    const format = createMessageFormatter({
      value: () => ({
        type: "link",
        href: "https://a.example/",
        children: [
          { type: "text", text: "a" },
          {
            type: "link",
            href: "https://b.example/",
            children: [{ type: "text", text: "b" }],
          },
          { type: "text", text: "c" },
        ],
      }),
    });
    assert.equal(
      format(message`${"x"}`, { colors: true }),
      "\x1b]8;;https://a.example/\x1b\\a\x1b]8;;https://b.example/\x1b\\b\x1b]8;;\x1b\\\x1b]8;;https://a.example/\x1b\\c\x1b]8;;\x1b\\",
    );
  });
  it("should restore annotation styling after themed prefixes and labels", () => {
    const output = formatDocPage("app", {
      sections: [{
        entries: [{
          term: { type: "option", names: ["-x"] },
          default: message`default`,
          choices: message`choice`,
        }],
      }],
    }, {
      colors: true,
      showDefault: true,
      showChoices: true,
      theme: {
        syntaxPunctuation: (term, ctx) =>
          term.kind === "defaultPrefix"
            ? {
              type: "style",
              style: { foreground: "red" },
              children: [{ type: "text", text: ctx.text }],
            }
            : defaultTerminalTheme.syntaxPunctuation(term, ctx),
        label: (term, ctx) =>
          term.kind === "choices"
            ? {
              type: "style",
              style: { bold: true },
              children: [{ type: "text", text: ctx.text }],
            }
            : defaultTerminalTheme.label(term, ctx),
      },
    });
    assert.ok(output.includes("\x1b[31m [\x1b[0m\x1b[2mdefault]"));
    assert.ok(output.includes("\x1b[1mchoices: \x1b[0m\x1b[2mchoice)"));
  });
  it("should keep the legacy ambient reset suffix after annotation URLs", () => {
    const output = formatDocPage("app", {
      sections: [{
        entries: [{
          term: { type: "option", names: ["-x"] },
          default: [{ type: "url", url: new URL("https://example.com/") }],
        }],
      }],
    }, { colors: true, showDefault: true });
    assert.ok(output.includes("\x1b]8;;\x1b\\\x1b[2m]\x1b[0m"));
  });
  it("should restore annotation styling outside opaque formatter output", () => {
    const output = formatDocPage("app", {
      sections: [{
        entries: [{
          term: { type: "option", names: ["-x"] },
          default: message`default`,
        }],
      }],
    }, {
      colors: true,
      showDefault: true,
      messageFormatter: () => "CUSTOM\x1b[0m",
    });
    assert.ok(output.includes("CUSTOM\x1b[0m\x1b[2m]\x1b[0m"));
  });
});

it("keeps a canceled ambient attribute disabled after a link", () => {
  const output = formatDocPage("app", {
    sections: [{
      entries: [{
        term: { type: "option", names: ["-x"] },
        default: message`${"x"}`,
      }],
    }],
  }, {
    colors: true,
    showDefault: true,
    theme: {
      value: () => ({
        type: "style",
        style: { dim: false },
        children: [
          {
            type: "link",
            href: "https://example.com/",
            children: [{ type: "text", text: "b" }],
          },
          { type: "text", text: "c" },
        ],
      }),
    },
  });
  assert.ok(output.includes("b\x1b]8;;\x1b\\c"));
});

it("preserves enclosing foreground and background overrides after a link", () => {
  const output = formatDocPage("app", {
    sections: [{
      entries: [{
        term: { type: "option", names: ["-x"] },
        default: message`${"x"}`,
      }],
    }],
  }, {
    colors: true,
    showDefault: true,
    theme: {
      annotationStyles: { default: { foreground: "red", background: "blue" } },
      value: () => ({
        type: "style",
        style: { foreground: "green", background: "white" },
        children: [
          {
            type: "link",
            href: "https://example.com/",
            children: [{ type: "text", text: "b" }],
          },
          { type: "text", text: "c" },
        ],
      }),
    },
  });
  assert.ok(output.includes("b\x1b]8;;\x1b\\\x1b[32;47mc"));
});

it("wraps themed program leaves and uses the final line's remaining width", () => {
  assert.equal(
    formatUsage("app", [], {
      maxWidth: 3,
      theme: {
        programName: () => ({
          type: "concat",
          children: [{ type: "text", text: "abc" }, {
            type: "text",
            text: "def",
          }],
        }),
      },
    }),
    "abc\ndef",
  );
  assert.equal(
    formatUsage("app", [{ type: "option", names: ["-x"] }], {
      maxWidth: 6,
      theme: {
        programName: () => ({
          type: "concat",
          children: [{ type: "text", text: "abcdef" }, {
            type: "text",
            text: "b",
          }],
        }),
      },
    }),
    "abcdef\nb -x",
  );
  assert.equal(
    formatUsage("app", [], {
      maxWidth: 3,
      colors: true,
      theme: {
        programName: () => ({
          type: "style",
          style: { foreground: "blue" },
          children: [{ type: "text", text: "abc" }, {
            type: "text",
            text: "def",
          }],
        }),
      },
    }),
    "\x1b[34mabc\ndef\x1b[0m",
  );
});

it("allows help widths that fit the individual themed program leaves", () => {
  assert.equal(
    formatDocPage("app", { usage: [], sections: [] }, {
      maxWidth: 10,
      theme: {
        programName: () => ({
          type: "concat",
          children: [{ type: "text", text: "abc" }, {
            type: "text",
            text: "def",
          }],
        }),
      },
    }),
    "Usage: abc\n       def\n",
  );
});

it("wraps usage summaries beneath the themed label", () => {
  const output: string[] = [];
  runParserSync(option("--name", string()), "app", [], {
    colors: false,
    maxWidth: 20,
    theme: {
      label: (term, context) =>
        term.kind === "usageSummary"
          ? { type: "text", text: "Invocation:" }
          : defaultTerminalTheme.label(term, context),
    },
    stderr: (text) => output.push(text),
    onError: () => undefined,
  });
  assert.equal(output[0].split("\n")[0], "Invocation: app");
  assert.equal(output[0].split("\n")[1], "            --name");
});

it("measures only the final line of a multiline usage label", () => {
  const theme: TerminalTheme = {
    label: (term, context) =>
      term.kind === "usage"
        ? { type: "text", text: "Header\nUse:" }
        : defaultTerminalTheme.label(term, context),
  };
  assert.equal(
    formatDocPage("app", { usage: [], sections: [] }, { theme, maxWidth: 8 }),
    "Header\nUse: app\n",
  );
  assert.equal(
    formatDocPage("app", {
      usage: [{ type: "literal", value: "x" }],
      sections: [],
    }, {
      theme,
      maxWidth: 8,
    }),
    "Header\nUse: app\n     x\n",
  );
});

for (const async of [false, true]) {
  it(`measures multiline usage labels in ${async ? "async" : "sync"} runner errors`, async () => {
    for (const args of [[], ["help", "unknown"]]) {
      const output: string[] = [];
      let calls = 0;
      const options = {
        maxWidth: 20,
        help: { command: true as const, onShow: () => "help" },
        theme: {
          label: (
            term: Parameters<typeof defaultTerminalTheme.label>[0],
            context: Parameters<typeof defaultTerminalTheme.label>[1],
          ) => {
            if (term.kind !== "usageSummary") {
              return defaultTerminalTheme.label(term, context);
            }
            calls++;
            return { type: "text" as const, text: "Header\nUse:" };
          },
        },
        stderr: (line: string) => output.push(line),
        onError: () => "error",
      };
      const parser = option("--name", string());
      if (async) await runParserAsync(parser, "app", args, options);
      else runParserSync(parser, "app", args, options);
      assert.equal(calls, 1);
      assert.ok(output[0].startsWith("Header\nUse: app"));
      assert.equal(output[0].split("\n")[2]?.match(/^ */)?.[0].length, 5);
      for (const line of output[0].split("\n")) {
        assert.ok(getDisplayWidth(line) <= 20, JSON.stringify(line));
      }
    }
  });
}
