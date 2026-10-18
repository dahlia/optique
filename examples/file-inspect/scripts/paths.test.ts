import assert from "node:assert/strict";
import { posix, win32 } from "node:path";
import { it } from "node:test";
import { isPathWithin } from "./paths.ts";

for (const style of [posix, win32]) {
  it(`checks bundle input containment with ${style === posix ? "POSIX" : "Windows"} paths`, () => {
    const root = style.resolve("/repo/example");
    assert.ok(isPathWithin(root, style.join(root, "src", "cli.ts"), style));
    assert.ok(!isPathWithin(root, root, style));
    assert.ok(
      !isPathWithin(root, style.resolve(root, "..", "other.ts"), style),
    );
    assert.ok(!isPathWithin(root, `${root}-other${style.sep}cli.ts`, style));
    assert.ok(isPathWithin(style.parse(root).root, root, style));
    if (style === win32) {
      assert.ok(!isPathWithin("C:\\repo", "D:\\repo\\cli.ts", style));
    }
  });
}
