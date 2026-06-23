<script setup lang="ts">
import { ref, useId } from "vue";

// The four surfaces a single parser definition refracts into. The panes show
// representative outputs (type, help, completion, man) rather than source, so
// they are presentational rather than twoslash-checked.
const tabs = [
  { id: "type", label: "Inferred type" },
  { id: "help", label: "--help" },
  { id: "completion", label: "<kbd>Tab</kbd>" },
  { id: "man", label: "man(1)" },
] as const;

type TabId = (typeof tabs)[number]["id"];

const active = ref<TabId>("type");

// Stable, unique ids so tabs and panels can reference each other via
// aria-controls / aria-labelledby.
const uid = useId().replace(/[^\w-]/g, "");
const tabId = (id: string) => `${uid}-tab-${id}`;
const panelId = (id: string) => `${uid}-panel-${id}`;

const tabEls = ref<(HTMLButtonElement | null)[]>([]);
const setTabEl = (el: Element | null, i: number) => {
  tabEls.value[i] = el as HTMLButtonElement | null;
};

// Arrow-key navigation with automatic activation, per the ARIA tabs pattern.
function onKeydown(e: KeyboardEvent) {
  const idx = tabs.findIndex((t) => t.id === active.value);
  let next = idx;
  switch (e.key) {
    case "ArrowRight":
    case "ArrowDown":
      next = (idx + 1) % tabs.length;
      break;
    case "ArrowLeft":
    case "ArrowUp":
      next = (idx - 1 + tabs.length) % tabs.length;
      break;
    case "Home":
      next = 0;
      break;
    case "End":
      next = tabs.length - 1;
      break;
    default:
      return;
  }
  e.preventDefault();
  active.value = tabs[next].id;
  tabEls.value[next]?.focus();
}
</script>

<template>
  <div class="ol-surf">
    <div
      class="ol-surf__tabs"
      role="tablist"
      aria-label="Generated surfaces"
      @keydown="onKeydown"
    >
      <button
        v-for="(t, i) in tabs"
        :key="t.id"
        :ref="(el) => setTabEl(el as Element | null, i)"
        :id="tabId(t.id)"
        class="ol-surf__tab"
        :class="{ 'is-active': active === t.id }"
        type="button"
        role="tab"
        :aria-selected="active === t.id"
        :aria-controls="panelId(t.id)"
        :tabindex="active === t.id ? 0 : -1"
        @click="active = t.id"
        v-html="t.label"
      />
    </div>

    <div
      v-show="active === 'type'"
      :id="panelId('type')"
      class="ol-surf__pane"
      role="tabpanel"
      :aria-labelledby="tabId('type')"
      tabindex="0"
    ><pre><code><span class="dim">// hover in your editor; no annotations needed</span>
<span class="kw">const</span> config: {
  <span class="kw">readonly</span> host: <span class="ty">string</span>;
  <span class="kw">readonly</span> port: <span class="ty">number</span>;
}</code></pre></div>

    <div
      v-show="active === 'help'"
      :id="panelId('help')"
      class="ol-surf__pane"
      role="tabpanel"
      :aria-labelledby="tabId('help')"
      tabindex="0"
    ><pre><code><span class="dim">$ myapp --help</span>
<span class="hd">Usage:</span> myapp [--host HOST] [--port PORT]

<span class="hd">Options:</span>
  <span class="fl">--host</span> HOST   Host to bind to.
  <span class="fl">--port</span> PORT   Port to listen on.
  <span class="fl">-h, --help</span>    Show this help.</code></pre></div>

    <div
      v-show="active === 'completion'"
      :id="panelId('completion')"
      class="ol-surf__pane"
      role="tabpanel"
      :aria-labelledby="tabId('completion')"
      tabindex="0"
    ><pre><code><span class="dim">$ myapp --</span><span class="tab">⇥</span>
<span class="fl">--host</span>  <span class="fl">--port</span>  <span class="fl">--help</span>
<span class="dim"># suggestions come straight from the parser</span></code></pre></div>

    <div
      v-show="active === 'man'"
      :id="panelId('man')"
      class="ol-surf__pane"
      role="tabpanel"
      :aria-labelledby="tabId('man')"
      tabindex="0"
    ><pre><code><span class="dim">MYAPP(1)            General Commands Manual</span>

<span class="hd">NAME</span>
       myapp

<span class="hd">SYNOPSIS</span>
       myapp [<span class="fl">--host</span> HOST] [<span class="fl">--port</span> PORT]

<span class="hd">DESCRIPTION</span>
       <span class="fl">--host</span> HOST   Host to bind to.
       <span class="fl">--port</span> PORT   Port to listen on.</code></pre></div>
  </div>
</template>

<style scoped>
.ol-surf {
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  overflow: hidden;
  background: var(--vp-c-bg-elv);
}

.ol-surf__tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding: 0 12px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.ol-surf__tab {
  appearance: none;
  border: 0;
  background: transparent;
  padding: 14px 8px 12px;
  margin-bottom: -1px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--vp-c-text-3);
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.ol-surf__tab:hover {
  color: var(--vp-c-text-1);
}

.ol-surf__tab.is-active {
  color: var(--vp-c-brand-1);
  border-bottom-color: var(--vp-c-brand-1);
}

.ol-surf__tab :deep(kbd) {
  font-family: inherit;
  font-size: 0.9em;
  line-height: 1;
  padding: 2px 6px 3px;
  border: 1px solid var(--vp-c-border);
  border-bottom-width: 2px;
  border-radius: 5px;
  background: var(--vp-c-bg-soft);
  color: inherit;
}

.ol-surf__pane {
  min-height: 232px;
}

.ol-surf__pane:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: -2px;
}

.ol-surf__pane pre {
  margin: 0;
  padding: 20px 22px;
  overflow-x: auto;
}

.ol-surf__pane code {
  font-family: var(--vp-font-family-mono);
  font-size: 13.5px;
  line-height: 1.7;
  color: var(--vp-c-text-1);
}

.ol-surf__pane .dim { color: var(--vp-c-text-3); }
.ol-surf__pane .kw { color: var(--vp-c-brand-1); }
.ol-surf__pane .ty { color: var(--optique-spectrum-3); }
.ol-surf__pane .hd { color: var(--vp-c-text-1); font-weight: 600; }
.ol-surf__pane .fl { color: var(--vp-c-brand-2); }
.dark .ol-surf__pane .ty { color: #5eead4; }
.ol-surf__pane .tab {
  color: var(--vp-c-text-3);
  padding: 0 2px;
}
</style>
