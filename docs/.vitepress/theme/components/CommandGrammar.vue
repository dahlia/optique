<script setup lang="ts">
// A command line mapped to the Optique parsers that capture each token, making
// the strip's claim concrete: the command-line grammar *is* your parser. The
// program name (argv[0]) isn't parsed, so it stays in the muted prompt; the
// subcommand onward is what Optique's combinators handle.
const tokens = [
  { text: "deploy", kind: "cmd", parser: "command()", value: "" },
  { text: "--env prod", kind: "opt", parser: "option()", value: 'choice(["dev", "prod"])' },
  { text: "--scale 3", kind: "opt", parser: "option()", value: "integer()" },
  { text: "app", kind: "arg", parser: "argument()", value: "string()" },
] as const;
</script>

<template>
  <div class="ol-grammar" aria-hidden="true">
    <span class="ol-grammar__prompt">$ myapp</span>
    <span
      v-for="t in tokens"
      :key="t.text"
      class="ol-grammar__tok"
      :class="`is-${t.kind}`"
    >
      <span class="ol-grammar__text">{{ t.text }}</span>
      <span class="ol-grammar__rule" />
      <span class="ol-grammar__parser">{{ t.parser }}</span>
      <span v-if="t.value" class="ol-grammar__value">{{ t.value }}</span>
    </span>
  </div>
</template>

<style scoped>
.ol-grammar {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: center;
  gap: 16px 18px;
  font-family: var(--vp-font-family-mono);
}

.ol-grammar__prompt {
  padding-top: 1px;
  font-size: 15px;
  color: var(--vp-c-text-3);
  white-space: nowrap;
  user-select: none;
}

.ol-grammar__tok {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
}

.ol-grammar__text {
  font-size: 15px;
  color: var(--vp-c-text-1);
  white-space: nowrap;
}

.ol-grammar__rule {
  width: 100%;
  height: 2px;
  border-radius: 2px;
  background: currentColor;
  opacity: 0.65;
}

.ol-grammar__parser {
  font-size: 13px;
  white-space: nowrap;
}

.ol-grammar__value {
  margin-top: -1px;
  font-size: 12px;
  color: var(--vp-c-text-3);
  white-space: nowrap;
}

.is-cmd { color: var(--vp-c-brand-1); }
.is-opt { color: var(--optique-spectrum-2); }
.is-arg { color: var(--optique-spectrum-3); }

.dark .is-opt { color: #8b9bf4; }
.dark .is-arg { color: #5eead4; }
</style>
