<script setup lang="ts">
// Consistent chrome for each landing band: an eyebrow label, a display
// heading, an optional lead, and a slot for the body (markdown + components).
defineProps<{
  eyebrow?: string;
  title?: string;
  lead?: string;
  tint?: boolean;
  // An optional "read more" link to the in-depth doc for this section.
  moreHref?: string;
  moreText?: string;
}>();
</script>

<template>
  <section class="ol-section" :class="{ 'ol-section--tint': tint }">
    <div class="ol-section__inner">
      <header v-if="eyebrow || title || lead" class="ol-section__head">
        <p v-if="eyebrow" class="ol-section__eyebrow">{{ eyebrow }}</p>
        <h2 v-if="title" class="ol-section__title">{{ title }}</h2>
        <!-- lead is authored, static copy; v-html lets it carry inline <code>. -->
        <p v-if="lead" class="ol-section__lead" v-html="lead" />
      </header>
      <div class="ol-section__body">
        <slot />
      </div>
      <!-- moreText is authored, static copy; v-html lets it carry inline <code>. -->
      <p v-if="moreHref" class="ol-section__more">
        <a :href="moreHref" v-html="moreText" />
      </p>
    </div>
  </section>
</template>

<style scoped>
.ol-section {
  padding: 72px 24px;
}

.ol-section--tint {
  background: var(--vp-c-bg-alt);
  border-block: 1px solid var(--vp-c-divider);
}

.ol-section__inner {
  max-width: 1152px;
  margin: 0 auto;
}

.ol-section__head {
  max-width: 720px;
  margin-bottom: 36px;
}

.ol-section__eyebrow {
  margin: 0 0 14px;
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
}

.ol-section__title {
  margin: 0;
  font-family: var(--optique-font-display);
  font-size: clamp(1.7rem, 1.1rem + 2.4vw, 2.5rem);
  font-weight: 600;
  line-height: 1.12;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
}

.ol-section__lead {
  margin: 18px 0 0;
  font-size: 1.075rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

.ol-section__lead :deep(code) {
  font-family: var(--vp-font-family-mono);
  font-size: 0.86em;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  padding: 2px 6px;
  border-radius: 5px;
  transition: background-color 0.15s, color 0.15s;
}

/* API names link to their docs; the pill itself is the affordance. */
.ol-section__lead :deep(a) {
  text-decoration: none;
}

.ol-section__lead :deep(a:hover code) {
  background: var(--vp-c-brand-2);
  color: #fff;
}

.ol-section__lead :deep(kbd) {
  font-family: var(--vp-font-family-mono);
  font-size: 0.8em;
  line-height: 1;
  padding: 2px 7px 3px;
  border: 1px solid var(--vp-c-border);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-text-1);
}

/* "Read more" affordance linking the section to its in-depth doc. */
.ol-section__more {
  margin: 36px 0 0;
}

.ol-section__more a {
  display: inline-flex;
  align-items: baseline;
  gap: 7px;
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  font-weight: 500;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  transition: color 0.15s;
}

.ol-section__more a::after {
  content: "→";
  transition: transform 0.15s;
}

.ol-section__more a:hover {
  color: var(--vp-c-brand-2);
}

.ol-section__more a:hover::after {
  transform: translateX(3px);
}

/* Inline code in the link blends into the mono label rather than pilling. */
.ol-section__more a :deep(code) {
  font-family: inherit;
  font-size: 1em;
  color: inherit;
  background: none;
  padding: 0;
}

@media (min-width: 640px) {
  .ol-section {
    padding: 96px 48px;
  }
}
</style>
