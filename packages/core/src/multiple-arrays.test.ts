import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { annotationKey, getAnnotations } from "./internal/annotations.ts";
import { message } from "./message.ts";
import { multiple } from "./modifiers.ts";
import type { Mode, Parser, ParserContext } from "./parser.ts";

type Item = readonly string[];
type State = readonly Item[];
type RepeatedParser = Parser<Mode, readonly Item[], State>;

function createParser(mode: Mode): RepeatedParser {
  // Each item needs two calls, making multiple() both append and replace
  // array-valued child states before it starts the next item.
  const child = {
    mode: "sync",
    $valueType: [],
    $stateType: [],
    priority: 0,
    usage: [],
    leadingNames: new Set(),
    acceptingAnyToken: true,
    initialState: [],
    parse(context) {
      const token = context.buffer[0];
      if (context.state.length === 2 || token === undefined) {
        return { success: false, consumed: 0, error: message`Item is full.` };
      }
      return {
        success: true,
        consumed: [token],
        next: {
          ...context,
          state: [...context.state, token],
          buffer: context.buffer.slice(1),
        },
      };
    },
    complete: (state) => ({ success: true, value: state }),
    suggest: () => [],
    getDocFragments: () => ({ fragments: [] }),
  } satisfies Parser<"sync", Item, Item>;
  if (mode === "sync") return multiple(child);
  const asyncChild: Parser<"async", Item, Item> = {
    ...child,
    mode: "async",
    parse: (context) => Promise.resolve(child.parse(context)),
    complete: (state) => Promise.resolve(child.complete(state)),
    async *suggest() {},
  };
  return multiple(asyncChild);
}

function context(
  state: State,
  buffer: readonly string[] = ["next"],
): ParserContext<State> {
  return { state, buffer, optionsTerminated: false, usage: [] };
}

async function step(
  parser: RepeatedParser,
  state: State,
  buffer?: readonly string[],
): Promise<ParserContext<State>> {
  const result = await parser.parse(context(state, buffer));
  assert.ok(result.success);
  return result.next;
}

function assertPlainArray(state: State): void {
  assert.ok(Array.isArray(state));
  assert.equal(Object.getPrototypeOf(state), Array.prototype);
  for (let i = 0; i < state.length; i++) {
    assert.ok(Object.hasOwn(state, i));
  }
}

function fullState(length: number): Item[] {
  return Array.from({ length }, () => ["old", "item"]);
}

for (const mode of ["sync", "async"] as const) {
  describe(`multiple() array compatibility (${mode})`, () => {
    it("retains frozen states and buffers across replacement and forks", async () => {
      const parser = createParser(mode);
      const initial = Object.freeze([] as Item[]);
      const buffer = Object.freeze(["first", "second"]);
      const first = await step(parser, initial, buffer);
      assert.deepEqual(initial, []);
      assert.deepEqual(buffer, ["first", "second"]);
      assert.deepEqual(first.buffer, ["second"]);
      assert.deepEqual(first.state, [["first"]]);
      Object.freeze(first.state[0]);
      Object.freeze(first.state);

      const left = await step(parser, first.state, ["left"]);
      const right = await step(parser, first.state, ["right"]);
      assert.deepEqual(first.state, [["first"]]);
      assert.deepEqual(left.state, [["first", "left"]]);
      assert.deepEqual(right.state, [["first", "right"]]);
      assert.notEqual(left.state, right.state);
      assert.notEqual(left.state[0], right.state[0]);

      const appended = await step(parser, left.state, ["next-item"]);
      assert.deepEqual(left.state, [["first", "left"]]);
      assert.deepEqual(appended.state, [["first", "left"], ["next-item"]]);
      assertPlainArray(appended.state);
      assert.deepEqual(await parser.complete(appended.state), {
        success: true,
        value: [["first", "left"], ["next-item"]],
      });
    });

    it("preserves outer and item annotations without changing earlier items", async () => {
      const parser = createParser(mode);
      const marker = Symbol("multiple-array-annotations");
      const outerAnnotations = { [marker]: "outer" };
      const itemAnnotations = { [marker]: "item" };
      const item = Object.assign(["first"], {
        [annotationKey]: itemAnnotations,
      });
      const state = Object.assign([item], {
        [annotationKey]: outerAnnotations,
      });
      const replaced = await step(parser, state, ["second"]);
      assert.equal(getAnnotations(replaced.state), outerAnnotations);
      assert.equal(getAnnotations(replaced.state[0]), itemAnnotations);
      assert.deepEqual([...item], ["first"]);

      const appended = await step(parser, replaced.state, ["third"]);
      assert.equal(getAnnotations(appended.state), outerAnnotations);
      assert.equal(getAnnotations(appended.state[0]), itemAnnotations);
      assert.equal(getAnnotations(appended.state[1]), outerAnnotations);
      assert.equal(appended.state[0], replaced.state[0]);
      assert.equal(getAnnotations(item), itemAnnotations);
    });

    for (const length of [1, 2048]) {
      describe(`custom source arrays (${length} complete items)`, () => {
        it("densifies holes when appending and replacing", async () => {
          const parser = createParser(mode);
          const state = fullState(length + 1);
          delete state[0];
          const appended = await step(parser, state);
          assert.ok(!Object.hasOwn(state, 0));
          assert.ok(Object.hasOwn(appended.state, 0));
          assert.equal(appended.state[0], undefined);
          assert.deepEqual(appended.state.slice(1), [
            ...fullState(length),
            ["next"],
          ]);
          assertPlainArray(appended.state);

          state.push(["partial"]);
          const replaced = await step(parser, state);
          assert.ok(!Object.hasOwn(state, 0));
          assert.equal(replaced.state[0], undefined);
          assert.deepEqual(replaced.state.slice(1), [
            ...fullState(length),
            ["partial", "next"],
          ]);
          assertPlainArray(replaced.state);
        });

        it("iterates the source on append and the sliced prefix on replacement", async () => {
          const parser = createParser(mode);
          let iterations = 0;
          const state = fullState(length);
          Object.defineProperty(state, Symbol.iterator, {
            value: function* () {
              iterations++;
              yield ["iterated", "item"];
            },
          });
          const appended = await step(parser, state);
          assert.equal(iterations, 1);
          assert.deepEqual(appended.state, [["iterated", "item"], ["next"]]);

          state.push(["partial"]);
          const replaced = await step(parser, state);
          assert.equal(iterations, 1);
          assert.deepEqual(replaced.state, [
            ...fullState(length),
            ["partial", "next"],
          ]);
          assertPlainArray(replaced.state);
        });

        it("ignores source concat spreadability", async () => {
          const parser = createParser(mode);
          const state = fullState(length);
          Object.defineProperty(state, Symbol.isConcatSpreadable, {
            value: false,
          });
          const appended = await step(parser, state);
          assert.deepEqual(appended.state, [...fullState(length), ["next"]]);
          assertPlainArray(appended.state);

          state.push(["partial"]);
          const replaced = await step(parser, state);
          assert.deepEqual(replaced.state, [
            ...fullState(length),
            ["partial", "next"],
          ]);
          assertPlainArray(replaced.state);
        });

        it("reads subclass species only when slicing the replacement prefix", async () => {
          let speciesReads = 0;
          class ItemStates extends Array<Item> {
            static override get [Symbol.species](): ArrayConstructor {
              speciesReads++;
              return Array;
            }
          }
          const parser = createParser(mode);
          const state = new ItemStates(...fullState(length));
          const appended = await step(parser, state);
          assert.equal(speciesReads, 0);
          assert.deepEqual(appended.state, [...fullState(length), ["next"]]);
          assertPlainArray(appended.state);

          state.push(["partial"]);
          const replaced = await step(parser, state);
          assert.equal(speciesReads, 1);
          assert.deepEqual(replaced.state, [
            ...fullState(length),
            ["partial", "next"],
          ]);
          assertPlainArray(replaced.state);
        });

        it("does not read an own constructor while appending", async () => {
          const state = fullState(length);
          Object.defineProperty(state, "constructor", {
            get() {
              throw new TypeError("The source constructor must not be read.");
            },
          });
          const next = await step(createParser(mode), state);
          assert.deepEqual(next.state, [...fullState(length), ["next"]]);
          assertPlainArray(next.state);
        });

        it("rejects invalid iterators on append but slices them away on replacement", async () => {
          const parser = createParser(mode);
          for (const iterator of [undefined, null, 1]) {
            const state = fullState(length);
            Object.defineProperty(state, Symbol.iterator, { value: iterator });
            await assert.rejects(async () => {
              await parser.parse(context(state));
            }, TypeError);

            state.push(["partial"]);
            const replaced = await step(parser, state);
            assert.deepEqual(replaced.state, [
              ...fullState(length),
              ["partial", "next"],
            ]);
            assertPlainArray(replaced.state);
          }
        });
      });
    }

    it("preserves append and replacement at copy threshold boundaries", async () => {
      const parser = createParser(mode);
      for (const length of [255, 256, 257]) {
        const prefix = Object.freeze(fullState(length));
        const appended = await step(parser, prefix, ["appended"]);
        assert.deepEqual(appended.state, [...prefix, ["appended"]]);
        assert.equal(prefix.length, length);
        assertPlainArray(appended.state);

        const source = Object.freeze([...prefix, Object.freeze(["partial"])]);
        const replaced = await step(parser, source, ["replaced"]);
        assert.deepEqual(replaced.state, [...prefix, ["partial", "replaced"]]);
        assert.deepEqual(source.at(-1), ["partial"]);
        assert.equal(source.length, length + 1);
        assertPlainArray(replaced.state);
      }
    });

    it("keeps large states cloneable, freezable ordinary arrays", async () => {
      const parser = createParser(mode);
      const state: State = Array.from(
        { length: 1025 },
        (_, i) => [`item-${i}`, "complete"],
      );
      const appended = await step(parser, state, ["partial"]);
      assert.equal(state.length, 1025);
      assert.equal(appended.state.length, 1026);
      assertPlainArray(appended.state);
      assert.deepEqual(structuredClone(appended.state), appended.state);
      Object.freeze(appended.state);
      assert.ok(Object.isFrozen(appended.state));

      const replaced = await step(parser, appended.state, ["complete"]);
      assert.deepEqual(appended.state.at(-1), ["partial"]);
      assert.deepEqual(replaced.state.at(-1), ["partial", "complete"]);
      assert.equal(replaced.state.length, 1026);
      assertPlainArray(replaced.state);
    });
  });
}
