<script setup lang="ts">
// One structured Message (the example from the section's code), rendered two
// ways: styled for a terminal, and the plain quoted fallback Optique emits when
// output is piped or running in CI. Same data, two renderings — the segments
// mirror the message's term types (metavar, optionName, value, plain text).
const segments = [
  { text: "Expected " },
  { text: "PORT", cls: "meta" },
  { text: " for " },
  { text: "--port", cls: "opt" },
  { text: ", but got " },
  { text: "99999", cls: "val" },
  { text: "." },
] as const;
</script>

<template>
  <div class="ol-msg">
    <figure class="ol-msg__pane">
      <figcaption class="ol-msg__label">In a terminal</figcaption>
      <p class="ol-msg__out"><span
        v-for="(s, i) in segments"
        :key="i"
        :class="s.cls ? `ol-msg-${s.cls}` : undefined"
      >{{ s.text }}</span></p>
    </figure>
    <figure class="ol-msg__pane">
      <figcaption class="ol-msg__label">Piped, or in CI</figcaption>
      <p
        class="ol-msg__out ol-msg__out--plain"
      >Expected `PORT` for `--port`, but got "99999".</p>
    </figure>
  </div>
</template>

<style scoped>
.ol-msg {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 4px;
}

.ol-msg__pane {
  margin: 0;
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  background: var(--vp-c-bg-elv);
  padding: 16px 18px;
}

.ol-msg__label {
  margin: 0 0 10px;
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.ol-msg__out {
  margin: 0;
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--vp-c-text-1);
  overflow-wrap: anywhere;
}

.ol-msg__out--plain {
  color: var(--vp-c-text-2);
}

.ol-msg-meta {
  color: var(--optique-spectrum-2);
  font-weight: 700;
}

.ol-msg-opt {
  color: var(--vp-c-brand-1);
  font-style: italic;
}

.ol-msg-val {
  color: #b45309;
}

.dark .ol-msg-meta {
  color: #8b9bf4;
}

.dark .ol-msg-val {
  color: #fbbf24;
}

@media (max-width: 600px) {
  .ol-msg {
    grid-template-columns: 1fr;
  }
}
</style>
