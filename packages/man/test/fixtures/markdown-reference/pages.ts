/** Inert, explicitly authored pages; importing this module starts no program. */
import { message } from "@optique/core/message";
import type { DocEntry } from "@optique/core/doc";
import type { Usage, UsageTerm } from "@optique/core/usage";
import type {
  MarkdownCommandEntry,
  MarkdownReferenceOptions,
} from "../../../src/markdown.ts";

const cmd = (name: string): Extract<UsageTerm, { type: "command" }> => ({
  type: "command",
  name,
});
const verbose: DocEntry = {
  term: { type: "option", names: ["-v", "--verbose"] },
  description: message`Include details.`,
};
const port: DocEntry = {
  term: { type: "option", names: ["--port"], metavar: "PORT" },
  description: message`Example port. No server is started.`,
  default: message`8080`,
  envVars: ["REF_PORT"],
};
const format: DocEntry = {
  term: { type: "option", names: ["--format"], metavar: "FORMAT" },
  choices: message`json, text`,
  default: message`json`,
};
const globals: Usage = [{ type: "optional", terms: [verbose.term] }];
export const referenceOptions: MarkdownReferenceOptions = {
  name: "ref-tool",
  version: "1.0.0",
  showAliases: true,
  coverage: {
    commands: "all-visible",
    help: "included",
    version: "included",
    completion: "included",
  },
  brief: message`A small documentation example.`,
};
export const referenceEntries: readonly MarkdownCommandEntry[] = [
  {
    path: [],
    page: {
      usage: [...globals, {
        type: "exclusive",
        terms: [[cmd("serve")], [cmd("config")], [cmd("docs")], [
          cmd("completion"),
        ]],
      }],
      sections: [
        {
          title: "Commands",
          entries: ["serve", "config", "docs", "completion"].map((name) => ({
            term: cmd(name),
          })),
        },
        { title: "Shared options", entries: [verbose] },
        {
          title: "Runner options",
          entries: [
            {
              term: { type: "option", names: ["-h", "--help"] },
              description: message`Show help for the selected command.`,
            },
            {
              term: { type: "option", names: ["--version"] },
              description: message`Show version 1.0.0.`,
            },
          ],
        },
      ],
    },
  },
  {
    path: ["serve"],
    page: {
      usage: [cmd("serve"), ...globals, {
        type: "optional",
        terms: [port.term],
      }, {
        type: "multiple",
        terms: [{ type: "option", names: ["--tag"], metavar: "TAG" }],
        min: 0,
      }],
      sections: [{ title: "Shared options", entries: [verbose] }, {
        title: "Inputs",
        entries: [port, {
          term: { type: "option", names: ["--tag"], metavar: "TAG" },
          description: message`Repeat to add example tags.`,
        }],
      }],
      examples: message`ref-tool serve --port 9000 --tag local --tag demo`,
      environmentBindings: [{
        name: "REF_PORT",
        description:
          message`An example documented binding; this fixture does not read it.`,
      }],
    },
  },
  {
    path: ["config"],
    page: {
      usage: [cmd("config"), ...globals, {
        type: "exclusive",
        terms: [[cmd("get")], [cmd("set")]],
      }],
      sections: [{ entries: [{ term: cmd("get") }, { term: cmd("set") }] }, {
        title: "Shared options",
        entries: [verbose],
      }],
    },
  },
  {
    path: ["config", "get"],
    aliases: ["g"],
    hiddenAliases: ["old-get"],
    page: {
      usage: [cmd("config"), cmd("get"), ...globals, {
        type: "multiple",
        terms: [{ type: "argument", metavar: "KEY" }],
        min: 1,
      }],
      sections: [{ title: "Shared options", entries: [verbose] }, {
        title: "Inputs",
        entries: [{
          term: { type: "argument", metavar: "KEY" },
          description: message`One or more keys to display.`,
        }],
      }],
    },
  },
  {
    path: ["config", "set"],
    page: {
      usage: [cmd("config"), cmd("set"), ...globals, {
        type: "argument",
        metavar: "KEY",
      }, { type: "optional", terms: [format.term] }],
      sections: [{ title: "Shared options", entries: [verbose] }, {
        title: "Inputs",
        entries: [{ term: { type: "argument", metavar: "KEY" } }, format],
      }],
      description: message`Prints the parsed example; it changes no settings.`,
    },
  },
  {
    path: ["docs"],
    page: {
      usage: [cmd("docs"), ...globals],
      sections: [{ entries: [verbose] }],
      description: message`Write this complete authored reference to stdout.`,
    },
  },
  {
    path: ["completion"],
    page: {
      usage: [cmd("completion"), { type: "argument", metavar: "SHELL" }, {
        type: "multiple",
        terms: [{ type: "argument", metavar: "ARG" }],
        min: 0,
      }],
      sections: [{
        entries: [{
          term: { type: "argument", metavar: "SHELL" },
          description:
            message`Generate a script, or pass completion query arguments.`,
        }, {
          term: { type: "argument", metavar: "ARG" },
          description: message`Runner completion query inputs, when provided.`,
        }],
      }],
    },
  },
];
