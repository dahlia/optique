<script setup lang="ts">
// A small terminal frame for shell snippets such as completion demos and
// accepted-vs-rejected command examples. Body is provided via the slot.
defineProps<{ title?: string }>();
</script>

<template>
  <div class="ol-term">
    <div class="ol-term__bar">
      <span class="ol-term__dot" /><span class="ol-term__dot" /><span
        class="ol-term__dot" />
      <span v-if="title" class="ol-term__title">{{ title }}</span>
    </div>
    <pre class="ol-term__body"><slot /></pre>
  </div>
</template>

<style scoped>
.ol-term {
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-c-bg-alt);
  box-shadow: 0 1px 2px rgba(72, 40, 110, 0.06);
}

.ol-term__bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
}

.ol-term__dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: var(--optique-prism-6);
  opacity: 0.55;
}

.ol-term__title {
  margin-left: 8px;
  font-size: 12px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
}

.ol-term__body {
  margin: 0;
  padding: 16px 18px;
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--vp-c-text-1);
  overflow-x: auto;
}

.ol-term__body :deep(.cmd) { color: var(--vp-c-text-1); }
.ol-term__body :deep(.prompt) { color: var(--optique-prism-5); user-select: none; }
.ol-term__body :deep(.flag) { color: var(--vp-c-brand-1); }
.ol-term__body :deep(.tab) {
  color: var(--vp-c-text-3);
  font-style: italic;
}
.ol-term__body :deep(.sug) {
  color: var(--vp-c-text-2);
}
.ol-term__body :deep(.ok) { color: #15803d; }
.ol-term__body :deep(.no) { color: var(--vp-c-danger-1); }
.dark .ol-term__body :deep(.ok) { color: #4ade80; }

.ol-term__body :deep(.dim) { color: var(--vp-c-text-3); }
</style>
