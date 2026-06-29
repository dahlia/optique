<script setup lang="ts">
// An entry point for the evaluator who already has a CLI library in mind. The
// names are the content: a "Commander vs Optique" searcher scans the row, finds
// their library, and clicks straight to its page. Order follows the comparison
// overview, and the copy keeps the docs' honest framing (each page also shows
// where the other library wins) so the band invites scrutiny instead of dodging
// it.
const libraries = [
  { name: "Commander.js", link: "/compare/commander" },
  { name: "Yargs", link: "/compare/yargs" },
  { name: "Cliffy", link: "/compare/cliffy" },
  { name: "Gunshi", link: "/compare/gunshi" },
  { name: "Cleye", link: "/compare/cleye" },
  { name: "cmd-ts", link: "/compare/cmd-ts" },
  { name: "Stricli", link: "/compare/stricli" },
  { name: "oclif", link: "/compare/oclif" },
  { name: "Clipanion", link: "/compare/clipanion" },
];
</script>

<template>
  <section class="ol-compare">
    <div class="ol-compare__inner">
      <p class="ol-compare__eyebrow">Already using another parser?</p>
      <h2 class="ol-compare__title">See exactly how Optique compares.</h2>
      <p class="ol-compare__lead">
        Nine side-by-side comparisons, each honest about where the other library
        is the better choice, with working code on both sides.
      </p>
      <div class="ol-compare__libs">
        <a
          v-for="lib in libraries"
          :key="lib.name"
          class="ol-compare__lib"
          :href="lib.link"
        >{{ lib.name }}</a>
      </div>
      <p class="ol-compare__more">
        <a href="/compare/">Start with the overview</a>
      </p>
    </div>
  </section>
</template>

<style scoped>
.ol-compare {
  padding: 72px 24px;
  text-align: center;
  border-block: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
}

.ol-compare__inner {
  max-width: 720px;
  margin: 0 auto;
}

.ol-compare__eyebrow {
  margin: 0 0 14px;
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
}

.ol-compare__title {
  margin: 0;
  border: 0;
  padding: 0;
  font-family: var(--optique-font-display);
  font-size: clamp(1.55rem, 1.1rem + 1.8vw, 2.1rem);
  font-weight: 600;
  line-height: 1.14;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
}

.ol-compare__lead {
  margin: 16px auto 0;
  max-width: 52ch;
  font-size: 1.025rem;
  line-height: 1.58;
  color: var(--vp-c-text-2);
}

/* The competitor names double as navigation: each chip is a real route to its
   comparison page. Neutral by default; the single brand accent appears on
   hover, keeping the page's color budget on the prism. */
.ol-compare__libs {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 28px;
}

.ol-compare__lib {
  display: inline-flex;
  align-items: center;
  padding: 8px 16px;
  border: 1px solid var(--vp-c-border);
  border-radius: 999px;
  background: var(--vp-c-bg-elv);
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  font-weight: 500;
  color: var(--vp-c-text-1);
  text-decoration: none;
  transition: border-color 0.15s, color 0.15s, transform 0.15s,
    box-shadow 0.15s;
}

.ol-compare__lib:hover {
  border-color: var(--vp-c-brand-2);
  color: var(--vp-c-brand-1);
  transform: translateY(-2px);
  box-shadow: 0 6px 18px rgba(72, 40, 110, 0.12);
}

.ol-compare__more {
  margin: 30px 0 0;
}

.ol-compare__more a {
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

.ol-compare__more a::after {
  content: "→";
  transition: transform 0.15s;
}

.ol-compare__more a:hover {
  color: var(--vp-c-brand-2);
}

.ol-compare__more a:hover::after {
  transform: translateX(3px);
}

@media (min-width: 640px) {
  .ol-compare {
    padding: 88px 48px;
  }
}
</style>
