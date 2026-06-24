<script setup lang="ts">
// The published surface area, at a glance. Each card links to its docs (or the
// JSR reference for the two foundational packages).
const packages = [
  { name: "@optique/core", desc: "Parser combinators and shared types.", link: "https://jsr.io/@optique/core/doc", core: true },
  { name: "@optique/run", desc: "Process runner for Node.js, Deno, and Bun.", link: "https://jsr.io/@optique/run/doc", core: true },
  { name: "@optique/discover", desc: "File-based command discovery and dispatch.", link: "/concepts/discover" },
  { name: "@optique/config", desc: "Config-file values via Standard Schema.", link: "/integrations/config" },
  { name: "@optique/clack", desc: "Interactive prompt fallback via Clack.", link: "/integrations/clack" },
  { name: "@optique/env", desc: "Environment-variable fallbacks.", link: "/integrations/env" },
  { name: "@optique/inquirer", desc: "Inquirer.js prompt fallback.", link: "/integrations/inquirer" },
  { name: "@optique/prompt", desc: "Adapter foundation for prompt libraries.", link: "/integrations/prompt" },
  { name: "@optique/git", desc: "Git reference value parsers.", link: "/integrations/git" },
  { name: "@optique/logtape", desc: "Log-level options for LogTape.", link: "/integrations/logtape" },
  { name: "@optique/man", desc: "Unix man pages from parsers.", link: "/concepts/man" },
  { name: "@optique/temporal", desc: "Temporal date and time parsers.", link: "/integrations/temporal" },
  { name: "@optique/valibot", desc: "Valibot schemas as value parsers.", link: "/integrations/valibot" },
  { name: "@optique/zod", desc: "Zod schemas as value parsers.", link: "/integrations/zod" },
];
</script>

<template>
  <div class="ol-pkgs">
    <a
      v-for="p in packages"
      :key="p.name"
      class="ol-pkg"
      :class="{ 'ol-pkg--core': p.core }"
      :href="p.link"
    >
      <span class="ol-pkg__name">{{ p.name }}</span>
      <span class="ol-pkg__desc">{{ p.desc }}</span>
    </a>
  </div>
</template>

<style scoped>
.ol-pkgs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(248px, 1fr));
  gap: 12px;
}

.ol-pkg {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 18px;
  border: 1px solid var(--vp-c-border);
  border-radius: 10px;
  background: var(--vp-c-bg-elv);
  text-decoration: none;
  transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
}

.ol-pkg:hover {
  border-color: var(--vp-c-brand-2);
  transform: translateY(-2px);
  box-shadow: 0 6px 20px rgba(72, 40, 110, 0.1);
}

.ol-pkg--core {
  border-color: var(--vp-c-brand-soft);
  background: var(--vp-c-brand-soft);
}

.ol-pkg__name {
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

.ol-pkg__desc {
  font-size: 13.5px;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}
</style>
