<script setup lang="ts">
// Real-world CLI requirements, each phrased as a need with a one-line gloss and
// the combinator(s) that model it. The whole row links to its cookbook recipe,
// so "can Optique handle my CLI?" has a concrete, typed answer. Option names in
// the titles are marked up as inline code. Anchors mirror the cookbook headings
// (the key-value one keeps its en dash, as the slug does).
const patterns = [
  {
    need: "Two modes that can't be combined",
    desc: "Each mode is a complete parser branch; the result is a discriminated union.",
    combos: ["or()", "constant()"],
    to: "mutually-exclusive-options",
  },
  {
    need: "Options that apply only with a flag",
    desc: "Dependent options enter the type only when their gate flag is set.",
    combos: ["merge()", "withDefault()"],
    to: "dependent-options",
  },
  {
    need: "Valid values that depend on another option",
    desc: "Derive one option's accepted values from another option's parsed value.",
    combos: ["dependency()"],
    to: "inter-option-value-dependencies",
  },
  {
    need: "Options chosen by a discriminator",
    desc: "A <code>--reporter</code>-style choice decides which extra options are valid.",
    combos: ["conditional()"],
    to: "conditional-options-based-on-discriminator",
  },
  {
    need: "Repeatable <code>KEY=VALUE</code> pairs",
    desc: "Collect many pairs and map them straight into a typed record.",
    combos: ["keyValue()", "multiple()"],
    to: "key–value-pair-options",
  },
  {
    need: "Stacked <code>-v</code>, <code>-vv</code>, <code>-vvv</code> verbosity",
    desc: "Count repeated flags and map the total to a level.",
    combos: ["multiple()", "map()"],
    to: "verbosity-levels",
  },
  {
    need: "<code>--color</code> paired with <code>--no-color</code>",
    desc: "One setting, both directions, with an explicit default.",
    combos: ["negatableFlag()"],
    to: "negatable-boolean-options",
  },
  {
    need: "Forward unknown flags to a wrapped tool",
    desc: "Capture unrecognized arguments and pass them through untouched.",
    combos: ["passThrough()"],
    to: "pass-through-options-for-wrapper-clis",
  },
  {
    need: "Deprecated flags that still work, but hidden",
    desc: "Keep old names parsing while hiding them from help and completion.",
    combos: ["hidden"],
    to: "hidden-and-deprecated-options",
  },
  {
    need: "A profile before the subcommand",
    desc: "Consume an optional positional before the command, in declaration order.",
    combos: ["seq()"],
    to: "positional-prefixes-before-subcommands",
  },
] as const;
</script>

<template>
  <div class="ol-patterns">
    <a
      v-for="p in patterns"
      :key="p.to"
      class="ol-pattern"
      :href="`/cookbook#${p.to}`"
    >
      <span class="ol-pattern__need" v-html="p.need" />
      <span class="ol-pattern__desc" v-html="p.desc" />
      <span class="ol-pattern__combos">
        <code v-for="c in p.combos" :key="c" class="ol-pattern__combo">{{ c }}</code>
      </span>
    </a>
  </div>
</template>

<style scoped>
.ol-patterns {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0 40px;
  margin-top: 4px;
}

.ol-pattern {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 18px 2px;
  border-bottom: 1px solid var(--vp-c-divider);
  text-decoration: none;
  color: inherit;
  transition: border-color 0.15s;
}

.ol-pattern:hover {
  border-bottom-color: var(--vp-c-brand-2);
}

.ol-pattern__need {
  font-size: 14.5px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--vp-c-text-1);
  transition: color 0.15s;
}

.ol-pattern:hover .ol-pattern__need {
  color: var(--vp-c-brand-1);
}

.ol-pattern__need :deep(code),
.ol-pattern__desc :deep(code) {
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--vp-c-bg-soft);
  font-family: var(--vp-font-family-mono);
  font-size: 0.86em;
  color: var(--vp-c-text-1);
}

.ol-pattern__desc {
  font-size: 13px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

.ol-pattern__desc :deep(code) {
  color: var(--vp-c-text-2);
}

.ol-pattern__combos {
  margin-top: auto;
  padding-top: 4px;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.ol-pattern__combo {
  padding: 2px 8px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

@media (max-width: 720px) {
  .ol-patterns {
    grid-template-columns: 1fr;
    gap: 0;
  }
}
</style>
