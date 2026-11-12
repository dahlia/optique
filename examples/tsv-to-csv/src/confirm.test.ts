import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { describe, it } from "node:test";
import { confirmOverwrite } from "./confirm.ts";

async function ask(answer: string | null): Promise<boolean> {
  const input = new PassThrough();
  const output = new PassThrough();
  const result = confirmOverwrite("data.csv", { input, output });
  if (answer == null) input.end();
  else input.write(answer);
  return await result;
}

describe("confirmOverwrite()", () => {
  it("accepts y and yes in any letter case", async () => {
    for (const answer of ["y\n", "Y\n", "yes\n", " YES \n"]) {
      assert.ok(await ask(answer), JSON.stringify(answer));
    }
  });

  it("declines any other answer", async () => {
    for (const answer of ["\n", "n\n", "no\n", "yep\n"]) {
      assert.ok(!await ask(answer), JSON.stringify(answer));
    }
  });

  it("declines when input ends before an answer", async () => {
    assert.ok(!await ask(null));
  });

  it("writes the question to the given output", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: string[] = [];
    output.on("data", (chunk) => chunks.push(String(chunk)));
    const result = confirmOverwrite("data.csv", { input, output });
    input.write("n\n");
    await result;
    assert.equal(chunks.join(""), "Overwrite data.csv? [y/N] ");
  });
});
