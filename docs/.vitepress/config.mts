import { transformerTwoslash } from "@shikijs/vitepress-twoslash";
import deflist from "markdown-it-deflist";
import process from "node:process";
import { ModuleKind, ModuleResolutionKind, ScriptTarget } from "typescript";
import { defineConfig } from "vitepress";

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

const REFERENCES = {
  text: "References",
  items: [
    { text: "@optique/core", link: "https://jsr.io/@optique/core/doc" },
    { text: "@optique/run", link: "https://jsr.io/@optique/run/doc" },
  ],
};

const TOP_NAV = [
  { text: "Installation", link: "/install" },
  { text: "Tutorial", link: "/tutorial" },
  REFERENCES,
];

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: "Optique",
  description: "Type-safe combinatorial CLI parser for TypeScript",
  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: "Home", link: "/" },
      ...TOP_NAV,
      ...extraNav,
    ],

    sidebar: [
      ...TOP_NAV,
      // {
      //   text: "Examples",
      //   items: [
      //     { text: "Markdown Examples", link: "/markdown-examples" },
      //     { text: "Runtime API Examples", link: "/api-examples" },
      //   ],
      // },
    ],

    socialLinks: [
      { icon: "jsr", link: "https://jsr.io/@optique" },
      { icon: "npm", link: "https://npmjs.com/package/@optique/core" },
      { icon: "github", link: "https://github.com/dahlia/optique" },
    ],
  },

  head: plausibleScript,

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
    },
  },

  sitemap: {
    hostname: process.env.SITEMAP_HOSTNAME,
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
