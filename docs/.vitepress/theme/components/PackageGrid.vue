<script setup lang="ts">
// The published surface area, grouped by the role each package plays around the
// dependency-free core. The two foundational packages link to their JSR
// reference; the rest link to their guide. Adding a package means dropping a
// card into the right role group. Keep this in sync with the Packages table in
// README.md and the sidebar in .vitepress/config.mts.
const groups = [
  {
    role: "Foundation",
    packages: [
      { name: "@optique/core", desc: "Parser combinators and shared types.", link: "https://jsr.io/@optique/core/doc", core: true },
      { name: "@optique/run", desc: "Process runner for Node.js, Deno, and Bun.", link: "https://jsr.io/@optique/run/doc", core: true },
    ],
  },
  {
    role: "Value parsers",
    packages: [
      { name: "@optique/standard-schema", desc: "Portable schema-backed value parsers.", link: "/integrations/standard-schema" },
      { name: "@optique/zod", desc: "Zod schemas as value parsers.", link: "/integrations/zod" },
      { name: "@optique/valibot", desc: "Valibot schemas as value parsers.", link: "/integrations/valibot" },
      { name: "@optique/temporal", desc: "Temporal date and time parsers.", link: "/integrations/temporal" },
      { name: "@optique/git", desc: "Git reference value parsers.", link: "/integrations/git" },
    ],
  },
  {
    role: "Value sources",
    packages: [
      { name: "@optique/env", desc: "Environment-variable fallbacks.", link: "/integrations/env" },
      { name: "@optique/config", desc: "Config-file values via Standard Schema.", link: "/integrations/config" },
      { name: "@optique/derived-defaults", desc: "Defaults derived from parsed values.", link: "/concepts/derived-defaults" },
      { name: "@optique/prompt", desc: "Adapter foundation for prompt libraries.", link: "/integrations/prompt" },
      { name: "@optique/clack", desc: "Interactive prompt fallback via Clack.", link: "/integrations/clack" },
      { name: "@optique/inquirer", desc: "Inquirer.js prompt fallback.", link: "/integrations/inquirer" },
    ],
  },
  {
    role: "Surfaces & tooling",
    packages: [
      { name: "@optique/discover", desc: "File-based command discovery and dispatch.", link: "/concepts/discover" },
      { name: "@optique/man", desc: "Unix man pages from parsers.", link: "/concepts/man" },
      { name: "@optique/logtape", desc: "Log-level options for LogTape.", link: "/integrations/logtape" },
    ],
  },
];
</script>

<template>
  <div class="ol-eco">
    <div v-for="g in groups" :key="g.role" class="ol-eco__band">
      <p class="ol-eco__role">{{ g.role }}</p>
      <div class="ol-pkgs">
        <a
          v-for="p in g.packages"
          :key="p.name"
          class="ol-pkg"
          :class="{ 'ol-pkg--core': p.core }"
          :href="p.link"
        >
          <span class="ol-pkg__name">{{ p.name }}</span>
          <span class="ol-pkg__desc">{{ p.desc }}</span>
        </a>
      </div>
    </div>
  </div>
</template>

<style scoped>
.ol-eco {
  display: flex;
  flex-direction: column;
  gap: 30px;
}

/* Mirrors ParserCatalog's row grammar (a left rail label + a wrapping cluster)
   so the ecosystem reads as a sibling of the parser catalog above it. */
.ol-eco__band {
  display: grid;
  grid-template-columns: 116px 1fr;
  gap: 6px 16px;
  align-items: start;
}

.ol-eco__role {
  margin: 0;
  padding-top: 17px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--vp-c-text-2);
}

.ol-pkgs {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(244px, 1fr));
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

@media (max-width: 720px) {
  .ol-eco__band {
    grid-template-columns: 1fr;
    gap: 10px;
  }

  .ol-eco__role {
    padding-top: 0;
  }
}
</style>
