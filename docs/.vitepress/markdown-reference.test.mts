import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createMarkdownRenderer, disposeMdItInstance } from "vitepress";
import { formatCommandReference, getCommandReferenceAnchor, type MarkdownCommandEntry } from "@optique/man/markdown";
import { referenceEntries, referenceOptions } from "../../packages/man/test/fixtures/markdown-reference/pages.ts";
import type { Message } from "@optique/core/message";

const hostile = '[link](javascript:alert(1)) ![image](https://bad.invalid/x) <img src=x onerror=alert(1)> &copy; ` `` ~~~~ \" \\ |\n\n# injected\n    code\n---\n> quote';
const message: Message = [
  { type: "text", text: hostile }, { type: "lineBreak" },
  { type: "optionName", optionName: "`--flag`" }, { type: "optionNames", optionNames: ["--a", "--b"] },
  { type: "metavar", metavar: "<INPUT>" }, { type: "value", value: "`value`" }, { type: "values", values: ["left]", "[right"] },
  { type: "envVar", envVar: "BAD_<ENV>" }, { type: "commandLine", commandLine: "echo `a`\n~~~~" }, { type: "url", url: new URL("javascript:alert(1)") },
  { type: "url", url: new URL("https://url-term.invalid/") },
  { type: "value", value: "[owned](https://value-term.invalid/) <img>" },
];

function ids(html: string): readonly string[] {
  return Array.from(html.matchAll(/\bid="([^"]+)"/g), (match) => match[1]);
}
function hrefs(html: string): readonly string[] {
  return Array.from(html.matchAll(/\bhref="([^"]+)"/g), (match) => match[1]);
}

describe("Markdown reference HTML", () => {
  it("does not add a literal backslash for trailing message line breaks", async () => {
    const md = await createMarkdownRenderer(process.cwd(), { html: true });
    try {
      for (const [description, expected] of [
        [[{ type: "text", text: "Line one.\n" }], "Line one."],
        [[{ type: "text", text: "Line one." }, { type: "lineBreak" }], "Line one."],
        [[{ type: "text", text: "Literal\\\n" }], "Literal\\"],
      ] satisfies readonly (readonly [Message, string])[]) {
        const html = await md.renderAsync(formatCommandReference([
          { path: [], page: { sections: [], description } },
        ], referenceOptions));
        assert.ok(html.includes(`<p>${expected}</p>`), html);
      }
    } finally { disposeMdItInstance(); }
  });

  it("preserves all generated destinations in VitePress final HTML", async () => {
    const md = await createMarkdownRenderer(process.cwd(), { html: true, linkify: true });
    try {
      const output = formatCommandReference(referenceEntries, referenceOptions);
      const tokens = md.parse(output, {});
      assert.ok(tokens.some((token) => token.type === "heading_open"));
      const html = await md.renderAsync(output);
      const anchors = ids(html);
      assert.equal(new Set(anchors).size, anchors.length);
      for (const href of hrefs(html)) {
        if (href.startsWith("#")) assert.ok(anchors.includes(href.slice(1)), href);
      }
      for (const entry of referenceEntries) assert.ok(hrefs(html).includes("#" + getCommandReferenceAnchor(entry.path)));
      assert.ok(!html.includes("old-get"));
    } finally { disposeMdItInstance(); }
  });

  it("escapes every text-bearing context and resists heading/anchor collisions", async () => {
    const entries: readonly MarkdownCommandEntry[] = [
      { path: [], page: { brief: message, description: message, examples: message, author: message, bugs: message, footer: message, usage: [{ type: "literal", value: "~~~~\n</code><script>bad</script>\n~~~~~" }], sections: [{ title: hostile, entries: [
        { term: { type: "command", name: "optique-command" } },
        { term: { type: "option", names: ["--x`<img>"], metavar: "<VALUE>" }, description: message, choices: message, default: message, envVars: ["<script>ENV</script>"] },
      ] }], environmentBindings: [{ name: "<img>ENV", description: message }] } },
      { path: ["optique-command"], page: { sections: [{ entries: [{ term: { type: "command", name: "5b5d" } }] }] } },
      { path: ["optique-command", "5b5d"], aliases: ["a]`<img>", "**bold**", "`tick`"], page: { sections: [] } },
    ];
    const md = await createMarkdownRenderer(process.cwd(), { html: true, linkify: true });
    try {
      const output = formatCommandReference(entries, { ...referenceOptions, name: "x`<img>", version: hostile, brief: message });
      const tokens = md.parse(output, {});
      assert.ok(tokens.some((token) => token.type === "fence" && token.content.includes("</code><script>bad</script>")));
      for (const token of tokens.flatMap((token) => [token, ...token.children ?? []])) {
        if ((token.type === "html_inline" || token.type === "html_block") && token.content !== "&#8203;" && token.content !== "<!-- -->") assert.match(token.content, /^<(?:a\b[^>]*|\/a|code|\/code)>.*$/s);
      }
      const html = await md.renderAsync(output);
      assert.ok(!/<(?:script|img)\b/i.test(html));
      assert.ok(!/<(?:strong|em)>/.test(html));
      assert.ok(html.includes("**bold**"));
      assert.ok(html.includes("`tick`"));
      const anchors = ids(html);
      assert.equal(new Set(anchors).size, anchors.length);
      for (const href of hrefs(html)) {
        assert.ok(href.startsWith("#") || /^https?:\/\//.test(href) || href.startsWith("mailto:"), href);
        if (href.startsWith("#")) assert.ok(anchors.includes(href.slice(1)), href);
      }
      assert.ok(html.includes("&lt;img"));
      assert.ok(html.includes("javascript:alert(1)"));
      assert.ok(!hrefs(html).includes("https://url-term.invalid/"));
      assert.ok(!hrefs(html).includes("https://value-term.invalid/"));
    } finally { disposeMdItInstance(); }
  });
});
