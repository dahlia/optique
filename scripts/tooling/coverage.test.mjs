import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseTestScript,
  runChild,
  testCommand,
  testPlans,
  validateJunit,
  validateLcov,
} from "./coverage.mjs";

test("direct runner preserves known flags/globs and rejects unsupported scripts", () => {
  assert.deepEqual(parseTestScript('node --test "src/**/*.test.ts"'), [
    "--test",
    "src/**/*.test.ts",
  ]);
  assert.deepEqual(
    parseTestScript(
      "tsc -p tsconfig.test.json && node --test .vitepress/theme/*.test.ts",
      true,
    ),
    ["--test", ".vitepress/theme/*.test.ts"],
  );
  for (const script of [
    "pnpm test",
    "node --test x; echo bad",
    "node --eval evil",
    "node --test x && echo bad",
  ]) {
    assert.throws(() => parseTestScript(script), /Unsupported/);
  }
  const command = testCommand(
    "/repo",
    {
      directory: "packages/a",
      script: "node --test src/*.test.ts",
    },
    3,
  );
  assert.equal(command.cwd, "/repo/packages/a");
  assert.ok(
    command.args.includes(
      "--test-reporter-destination=/repo/coverage/junit/3.xml",
    ),
  );
  assert.equal(command.args.at(-1), "src/*.test.ts");
});

test("discovery retains root, skills, docs, examples and benchmark assertions", () => {
  const plans = testPlans(process.cwd());
  assert.ok(plans.some((plan) => plan.directory === "."));
  for (const directory of [
    "packages/core/",
    "docs/",
    "examples/file-inspect/",
    "benchmarks/startup/",
  ]) {
    assert.ok(
      plans.some((plan) => plan.directory === directory),
      directory,
    );
  }
  // Core's unqualified --test retains its skills/optique/SKILL.test.ts.
  assert.equal(
    plans.find((plan) => plan.directory === "packages/core/").script,
    "node --test",
  );
});

test("direct child preserves cwd/env, propagates failure and cancels", async () => {
  await runChild(
    {
      cwd: process.cwd(),
      args: [
        "--eval",
        "if(process.cwd() !== process.env.EXPECT_CWD) process.exit(3)",
      ],
    },
    { env: { ...process.env, EXPECT_CWD: process.cwd() } },
  );
  await assert.rejects(
    runChild({ cwd: process.cwd(), args: ["--eval", "process.exit(7)"] }),
    /failed \(7\)/,
  );
  const controller = new AbortController();
  const promise = runChild(
    {
      cwd: process.cwd(),
      args: ["--eval", "setInterval(()=>{},1000)"],
    },
    { signal: controller.signal },
  );
  controller.abort();
  await assert.rejects(promise, /cancelled/);
});

test("reports require executed production source and nonempty successful JUnit", () => {
  const good = "SF:packages/core/src/parser.ts\nDA:1,1\nend_of_record\n";
  assert.doesNotThrow(() => validateLcov(good, "/repo"));
  for (const text of [
    "",
    "SF:packages/core/dist/parser.js\nDA:1,2\nend_of_record\n",
    good.replace("1,1", "1,0"),
    good.replace("parser.ts", "parser.test.ts"),
    good.replace("parser.ts", "parser.fixture.ts"),
    good.replace("packages/core", "../other/packages/core"),
  ]) {
    assert.throws(() => validateLcov(text, "/repo"));
  }
  assert.doesNotThrow(() =>
    validateJunit(
      '<testsuites><testsuite tests="1" failures="0"><testcase name="works"/></testsuite></testsuites>',
    ),
  );
  for (const text of [
    "",
    '<testsuite tests="0"/>',
    '<testsuite tests="1" failures="1"><testcase><failure/></testcase></testsuite>',
  ]) {
    assert.throws(() => validateJunit(text));
  }
});
