import { group, longestMatch, object, or, tuple } from "./constructs.ts";
import type { DocPage } from "./doc.ts";
import { optional } from "./modifiers.ts";
import { getDocPageAsync, getDocPageSync } from "./parser.ts";
import { command, constant, option } from "./primitives.ts";
import { cloneUsage, formatUsage, type HiddenVisibility } from "./usage.ts";
import { string, type ValueParser } from "./valueparser.ts";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

function synopsis(page: DocPage | undefined): string {
  assert.ok(page);
  assert.ok(page.usage);
  return formatUsage("myapp", page.usage, { expandCommands: true });
}

function projectCli(hidden: HiddenVisibility = "usage") {
  return longestMatch(
    group(
      "Projects",
      command(
        "project",
        longestMatch(command(
          "deploy",
          object({
            target: option("--target", string({ metavar: "TARGET" })),
          }),
        )),
        { hidden },
      ),
    ),
  );
}

describe("hidden command help synopsis", () => {
  for (const hidden of ["usage", true, "help", "doc", false] as const) {
    it(`retains the selected path with hidden: ${hidden}`, () => {
      const parser = projectCli(hidden);
      const root = hidden === "doc" || hidden === false
        ? "myapp project deploy --target TARGET"
        : "myapp";
      assert.equal(synopsis(getDocPageSync(parser)), root);
      for (const args of [["project"], ["project", "deploy"]]) {
        assert.equal(
          synopsis(getDocPageSync(parser, args)),
          "myapp project deploy --target TARGET",
        );
      }
    });
  }

  it("keeps unselected children and hidden options hidden", () => {
    const parser = longestMatch(command(
      "project",
      or(
        command(
          "deploy",
          object({
            target: option("--target", string({ metavar: "TARGET" })),
            secret: optional(option("--secret", string(), { hidden: "usage" })),
          }),
        ),
        command("secret", constant("secret"), { hidden: true }),
      ),
      { hidden: "usage" },
    ));
    assert.equal(
      synopsis(getDocPageSync(parser, ["project"])),
      "myapp project deploy --target TARGET",
    );
    assert.equal(
      synopsis(getDocPageSync(parser, ["project", "secret"])),
      "myapp project secret",
    );
  });

  it("does not reveal a command named by an option value or failed input", () => {
    const parser = object({
      name: option("--name", string()),
      action: optional(command("project", constant("project"), {
        hidden: "usage",
      })),
    });
    assert.ok(
      !synopsis(getDocPageSync(parser, ["--name", "project"]))
        .includes("project"),
    );
    assert.equal(
      synopsis(getDocPageSync(projectCli(), ["invalid", "project"])),
      "myapp",
    );
  });

  it("keeps same-named descendants of unselected commands hidden", () => {
    const parser = optional(or(
      command(
        "other",
        command("alpha", constant("nested"), {
          hidden: "usage",
        }),
      ),
      command("alpha", constant("selected"), { hidden: "usage" }),
    ));
    const root = synopsis(getDocPageSync(parser));
    assert.ok(!root.includes("alpha"));
    const selected = synopsis(getDocPageSync(parser, ["alpha"]));
    assert.equal(selected.match(/alpha/g)?.length, 1);
  });

  it("does not reuse a selected command for a later optional command", () => {
    const parser = tuple([
      optional(or(
        command("alpha", constant("first"), { hidden: "usage" }),
        command("beta", constant("beta"), { hidden: "usage" }),
      )),
      optional(command("alpha", constant("second"), { hidden: "usage" })),
    ]);
    const selected = synopsis(getDocPageSync(parser, ["alpha"]));
    assert.equal(selected.match(/alpha/g)?.length, 1);
  });

  it("preserves repeated names in a selected nested path", () => {
    const parser = longestMatch(command(
      "project",
      longestMatch(command("project", constant("nested"), { hidden: "usage" })),
      { hidden: "usage" },
    ));
    assert.equal(synopsis(getDocPageSync(parser)), "myapp");
    assert.equal(
      synopsis(getDocPageSync(parser, ["project"])),
      "myapp project",
    );
    assert.equal(
      synopsis(getDocPageSync(parser, ["project", "project"])),
      "myapp project project",
    );
  });

  it("retains the synthesized bare command path", () => {
    const parser = command("project", option("--target", string()), {
      hidden: "usage",
    });
    assert.equal(
      synopsis(getDocPageSync(parser)),
      "myapp project --target STRING",
    );
  });

  it("applies usageLine before revealing matched command terms", () => {
    let called = false;
    const parser = longestMatch(command(
      "project",
      command("deploy", constant("deploy"), { hidden: "usage" }),
      {
        hidden: "usage",
        usageLine(defaultUsage) {
          called = true;
          assert.equal(defaultUsage[0].type, "command");
          assert.equal(defaultUsage[0].hidden, "usage");
          return [{ type: "literal", value: "CUSTOM" }];
        },
      },
    ));
    assert.equal(
      synopsis(getDocPageSync(parser, ["project"])),
      "myapp project CUSTOM",
    );
    assert.ok(called);
  });

  it("does not change parser usage or later root help", () => {
    const parser = projectCli();
    const before = cloneUsage(parser.usage);
    const root = synopsis(getDocPageSync(parser));
    getDocPageSync(parser, ["project", "deploy"]);
    assert.deepEqual(parser.usage, before);
    assert.equal(synopsis(getDocPageSync(parser)), root);
  });

  it("retains the path with an actual async value parser", async () => {
    const valueParser: ValueParser<"async", string> = {
      mode: "async",
      metavar: "TARGET",
      placeholder: "",
      parse: (input) => Promise.resolve({ success: true, value: input }),
      format: (value) => value,
    };
    const parser = longestMatch(group(
      "Projects",
      command(
        "project",
        longestMatch(command("deploy", option("--target", valueParser))),
        { hidden: "usage" },
      ),
    ));
    assert.equal(parser.mode, "async");
    assert.equal(synopsis(await getDocPageAsync(parser)), "myapp");
    for (
      const args of [["project"], ["project", "deploy", "--target", "x86"]]
    ) {
      assert.equal(
        synopsis(await getDocPageAsync(parser, args)),
        "myapp project deploy --target TARGET",
      );
    }
  });
});
