<script setup lang="ts">
// Self-contained completion demo for the dependency section. The content lives
// here (not passed through markdown) so whitespace and tokens stay intact.
import TerminalBlock from "./TerminalBlock.vue";
</script>

<template>
  <TerminalBlock title="completion">
    <span class="ln"><span class="prompt">$</span> app <span class="flag">--mode</span> dev <span class="flag">--log-level</span> <span class="tab">⇥</span></span>
    <span class="ln sug">debug · info · warn · error</span>
    <span class="ln gap" />
    <span class="ln"><span class="prompt">$</span> app <span class="flag">--mode</span> prod <span class="flag">--log-level</span> <span class="tab">⇥</span></span>
    <span class="ln sug">warn · error</span>
    <span class="ln gap" />
    <span class="ln dim"># suggestions follow the same dependency</span>
    <span class="ln dim"># Optique uses to validate.</span>
  </TerminalBlock>
</template>

<style scoped>
.ln {
  display: block;
}

.sug {
  padding-left: 1.6em;
  color: var(--vp-c-text-2);
}

.gap {
  height: 0.7em;
}
</style>
