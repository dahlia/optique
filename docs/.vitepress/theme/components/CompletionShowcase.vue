<script setup lang="ts">
// One generated completion, always in sync with the parser: subcommands, then
// command-specific options, then values (including a parser-constrained choice).
// Mirrors the multi-command completion example in the cookbook.
const rows = [
  { cmd: "myapp", sug: ["server", "build", "help"] },
  { cmd: "myapp server --", sug: ["--port", "--host", "--env"] },
  { cmd: "myapp server --env", sug: ["dev", "staging", "prod"] },
  { cmd: "myapp build", sug: ["web", "mobile", "desktop"] },
] as const;
</script>

<template>
  <div class="ol-complete" aria-hidden="true">
    <div v-for="(r, i) in rows" :key="i" class="ol-complete__row">
      <p class="ol-complete__cmd">
        <span class="ol-complete__dim">$</span> {{ r.cmd }}<span class="ol-complete__tab">⇥</span>
      </p>
      <p class="ol-complete__sugs">
        <span v-for="s in r.sug" :key="s" class="ol-complete__sug">{{ s }}</span>
      </p>
    </div>
  </div>
</template>

<style scoped>
.ol-complete {
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  background: var(--vp-c-bg-elv);
  padding: 18px 20px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  line-height: 1.5;
}

.ol-complete__row + .ol-complete__row {
  margin-top: 16px;
}

.ol-complete__cmd {
  margin: 0;
  color: var(--vp-c-text-1);
  white-space: nowrap;
  overflow-x: auto;
}

.ol-complete__dim {
  color: var(--vp-c-text-3);
}

.ol-complete__tab {
  margin-left: 7px;
  color: var(--vp-c-text-3);
}

.ol-complete__sugs {
  display: flex;
  flex-wrap: wrap;
  gap: 5px 14px;
  margin: 5px 0 0;
}

.ol-complete__sug {
  color: var(--vp-c-brand-1);
}
</style>
