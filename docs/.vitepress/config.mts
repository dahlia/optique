import { transformerTwoslash } from "@shikijs/vitepress-twoslash";
import deflist from "markdown-it-deflist";
import process from "node:process";
import { ModuleKind, ModuleResolutionKind, ScriptTarget } from "typescript";
import { defineConfig } from "vitepress";
import {
  groupIconMdPlugin,
  groupIconVitePlugin,
} from "vitepress-plugin-group-icons";
import llmstxt from "vitepress-plugin-llms";

let extraNav: { text: string; link: string }[] = [];
if (process.env.EXTRA_NAV_TEXT && process.env.EXTRA_NAV_LINK) {
  extraNav = [
    {
      text: process.env.EXTRA_NAV_TEXT,
      link: process.env.EXTRA_NAV_LINK,
    },
  ];
}

let plausibleScript: [string, Record<string, string>][] = [];
if (process.env.PLAUSIBLE_DOMAIN) {
  plausibleScript = [
    [
      "script",
      {
        defer: "defer",
        "data-domain": process.env.PLAUSIBLE_DOMAIN,
        src: "https://plausible.io/js/plausible.js",
      },
    ],
  ];
}

const CONCEPTS = {
  text: "Concepts",
  items: [
    { text: "Primitive parsers", link: "/concepts/primitives" },
    { text: "Value parsers", link: "/concepts/valueparsers" },
    { text: "Modifying combinators", link: "/concepts/modifiers" },
    { text: "Construct combinators", link: "/concepts/constructs" },
    { text: "Messages", link: "/concepts/messages" },
    { text: "Runners and execution", link: "/concepts/runners" },
  ],
};

const REFERENCES = {
  text: "References",
  items: [
    { text: "@optique/core", link: "https://jsr.io/@optique/core/doc" },
    { text: "@optique/run", link: "https://jsr.io/@optique/run/doc" },
    { text: "@optique/temporal", link: "https://jsr.io/@optique/temporal/doc" },
  ],
};

const TOP_NAV = [
  { text: "Why Optique?", link: "/why" },
  { text: "Installation", link: "/install" },
  { text: "Tutorial", link: "/tutorial" },
  CONCEPTS,
  REFERENCES,
];

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Optique",
  description: "Type-safe combinatorial CLI parser for TypeScript",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: "/optique.svg",
    nav: [
      { text: "Home", link: "/" },
      ...TOP_NAV,
      ...extraNav,
    ],

    sidebar: [
      ...TOP_NAV,
      { text: "Changelog", link: "/changelog" },
    ],

    socialLinks: [
      { icon: "jsr", link: "https://jsr.io/@optique" },
      { icon: "npm", link: "https://npmjs.com/package/@optique/core" },
      { icon: "github", link: "https://github.com/dahlia/optique" },
    ],

    editLink: {
      pattern: "https://github.com/dahlia/optique/edit/main/docs/:path",
    },

    outline: "deep",
  },

  head: [
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "192x192",
        href: "/favicon-192x192.png",
      },
    ],
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "32x32",
        href: "/favicon-32x32.png",
      },
    ],
    [
      "link",
      {
        rel: "icon",
        type: "image/png",
        sizes: "16x16",
        href: "/favicon-16x16.png",
      },
    ],
    [
      "meta",
      {
        property: "og:image",
        content: "/og.png",
      },
    ],
    ...plausibleScript,
  ],

  cleanUrls: true,

  markdown: {
    codeTransformers: [
      transformerTwoslash({
        twoslashOptions: {
          compilerOptions: {
            moduleResolution: ModuleResolutionKind.Bundler,
            module: ModuleKind.ESNext,
            target: ScriptTarget.ESNext,
            lib: ["dom", "dom.iterable", "esnext"],
            types: ["dom", "dom.iterable", "esnext", "node"],
          },
        },
      }),
    ],
    config(md) {
      md.use(deflist);
      md.use(groupIconMdPlugin);
    },
  },

  sitemap: {
    hostname: process.env.SITEMAP_HOSTNAME,
  },

  vite: {
    plugins: [
      groupIconVitePlugin(),
      llmstxt({
        ignoreFiles: [
          "changelog.md",
        ],
      }),
    ],
  },

  async transformHead(context) {
    return [
      [
        "meta",
        { property: "og:title", content: context.title },
      ],
      [
        "meta",
        { property: "og:description", content: context.description },
      ],
    ];
  },
});
