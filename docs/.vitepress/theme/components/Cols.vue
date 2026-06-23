<script setup lang="ts">
// A thin responsive grid. Its slotted children (code blocks, a prism, a
// terminal) sit side by side on wide screens and stack on narrow ones. Keeping
// it a single component with one default slot avoids interleaving manual <div>s
// with markdown fences, which the Vue/markdown compiler handles poorly.
//
// Columns top-align by default (right for code comparisons); pass `center` when
// the second column is a graphic that should sit beside the code's midpoint.
defineProps<{ center?: boolean }>();
</script>

<template>
  <div class="ol-cols" :class="{ 'ol-cols--center': center }"><slot /></div>
</template>
