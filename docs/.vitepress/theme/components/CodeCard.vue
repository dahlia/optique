<script setup lang="ts">
// A code block with a real, visually distinct label badge instead of an
// in-code comment. Tone colors the badge to tell the before → after → result
// story: neutral (manual), brand (Optique), type-teal (inferred).
defineProps<{ label: string; tone?: "before" | "after" | "result" }>();
</script>

<template>
  <figure class="ol-card" :class="tone && `ol-card--${tone}`">
    <figcaption class="ol-card__label">{{ label }}</figcaption>
    <slot />
  </figure>
</template>
