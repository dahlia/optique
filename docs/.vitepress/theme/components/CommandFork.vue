<script setup lang="ts">
// One command line refracting into its subcommands — an echo of the hero prism.
// `$ myapp` enters, `or()` splits it into create/list/delete, and each branch
// emerges as one arm of the discriminated union, carrying its own color. The
// `action` discriminant is what narrows the union back down to a single arm.
//
// Geometry is fixed (46px rows, 18px gaps → 174px tall) so the SVG ray fan can
// terminate exactly at each branch's vertical center: 23, 87, 151.
const branches = [
  { cmd: "create", rest: "; name; role }" },
  { cmd: "list", rest: "; limit }" },
  { cmd: "delete", rest: "; id; force }" },
] as const;
</script>

<template>
  <figure class="ol-fork">
    <div class="ol-fork__diagram">
      <div class="ol-fork__trunk">
        <code class="ol-fork__prompt"><span class="ol-fork__dim">$</span> myapp</code>
        <span class="ol-fork__or">or()</span>
      </div>

      <svg
        class="ol-fork__rays"
        viewBox="0 0 72 174"
        fill="none"
        aria-hidden="true"
      >
        <path class="ol-fork__ray ol-fork__ray--0" d="M4 87 C 44 87, 30 23, 68 23" />
        <path class="ol-fork__ray ol-fork__ray--1" d="M4 87 L 68 87" />
        <path class="ol-fork__ray ol-fork__ray--2" d="M4 87 C 44 87, 30 151, 68 151" />
        <circle class="ol-fork__node" cx="4" cy="87" r="3.5" />
        <circle class="ol-fork__end ol-fork__end--0" cx="68" cy="23" r="3" />
        <circle class="ol-fork__end ol-fork__end--1" cx="68" cy="87" r="3" />
        <circle class="ol-fork__end ol-fork__end--2" cx="68" cy="151" r="3" />
      </svg>

      <ul class="ol-fork__branches">
        <li
          v-for="(b, i) in branches"
          :key="b.cmd"
          class="ol-fork__branch"
          :class="`ol-fork__branch--${i}`"
        >
          <span class="ol-fork__cmd">{{ b.cmd }}</span>
          <code
            class="ol-fork__arm"
          >{{ "{ action: " }}<span class="ol-fork__tag">"{{ b.cmd }}"</span>{{ b.rest }}</code>
        </li>
      </ul>
    </div>

    <figcaption class="ol-fork__caption">
      one discriminated union, narrowed by <code>action</code>
    </figcaption>
  </figure>
</template>

<style scoped>
.ol-fork {
  margin: 0;
  --c0: var(--vp-c-brand-1);
  --c1: var(--optique-spectrum-2);
  --c2: var(--optique-spectrum-3);
}

.dark .ol-fork {
  --c1: #8b9bf4;
  --c2: #5eead4;
}

.ol-fork__diagram {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0;
  font-family: var(--vp-font-family-mono);
}

/* Trunk: the entering command line and its or() junction. */
.ol-fork__trunk {
  flex: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 9px;
}

.ol-fork__prompt {
  padding: 8px 14px;
  border: 1px solid var(--vp-c-border);
  border-radius: 9px;
  background: var(--vp-c-bg-elv);
  font-size: 14px;
  color: var(--vp-c-text-1);
  white-space: nowrap;
}

.ol-fork__dim {
  color: var(--vp-c-text-3);
}

.ol-fork__or {
  font-size: 12px;
  letter-spacing: 0.02em;
  color: var(--vp-c-text-3);
}

/* Refracted rays, one per branch, in each branch's color. */
.ol-fork__rays {
  flex: none;
  width: 72px;
  height: 174px;
  overflow: visible;
}

.ol-fork__ray {
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
}

.ol-fork__ray--0 {
  stroke: var(--c0);
}
.ol-fork__ray--1 {
  stroke: var(--c1);
}
.ol-fork__ray--2 {
  stroke: var(--c2);
}

.ol-fork__node {
  fill: var(--vp-c-text-3);
}

.ol-fork__end--0 {
  fill: var(--c0);
}
.ol-fork__end--1 {
  fill: var(--c1);
}
.ol-fork__end--2 {
  fill: var(--c2);
}

/* Branches: each arm of the union. */
.ol-fork__branches {
  flex: none;
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.ol-fork__branch {
  height: 46px;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 12px;
}

.ol-fork__cmd {
  flex: none;
  min-width: 54px;
  font-size: 13.5px;
  font-weight: 600;
}

.ol-fork__branch--0 .ol-fork__cmd,
.ol-fork__branch--0 .ol-fork__tag {
  color: var(--c0);
}
.ol-fork__branch--1 .ol-fork__cmd,
.ol-fork__branch--1 .ol-fork__tag {
  color: var(--c1);
}
.ol-fork__branch--2 .ol-fork__cmd,
.ol-fork__branch--2 .ol-fork__tag {
  color: var(--c2);
}

.ol-fork__arm {
  padding: 0;
  background: none;
  border-radius: 0;
  font-size: 13px;
  color: var(--vp-c-text-2);
  white-space: nowrap;
}

.ol-fork__tag {
  font-weight: 600;
}

.ol-fork__caption {
  margin: 24px 0 0;
  text-align: center;
  font-size: 13px;
  color: var(--vp-c-text-3);
}

.ol-fork__caption code {
  font-family: var(--vp-font-family-mono);
  font-size: 0.92em;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  padding: 1px 5px;
  border-radius: 4px;
}

/* The rays draw themselves in on load, echoing the hero prism's reveal. */
@media (prefers-reduced-motion: no-preference) {
  .ol-fork__ray {
    stroke-dasharray: 130;
    stroke-dashoffset: 130;
    animation: ol-fork-draw 0.65s ease-out forwards;
  }
  .ol-fork__ray--0 {
    animation-delay: 0.05s;
  }
  .ol-fork__ray--1 {
    animation-delay: 0.16s;
  }
  .ol-fork__ray--2 {
    animation-delay: 0.27s;
  }

  @keyframes ol-fork-draw {
    to {
      stroke-dashoffset: 0;
    }
  }
}

/* Narrow screens: drop the horizontal ray fan and stack the branches as
   color-barred rows under the trunk. */
@media (max-width: 600px) {
  .ol-fork__diagram {
    flex-direction: column;
    align-items: stretch;
    gap: 16px;
  }

  .ol-fork__trunk {
    flex-direction: row;
    justify-content: center;
    gap: 10px;
  }

  .ol-fork__rays {
    display: none;
  }

  .ol-fork__branches {
    gap: 10px;
  }

  .ol-fork__branch {
    height: auto;
    padding: 11px 12px 11px 14px;
    border: 1px solid var(--vp-c-divider);
    border-left: 3px solid var(--bc, var(--vp-c-brand-1));
    border-radius: 8px;
    background: var(--vp-c-bg-elv);
    flex-wrap: wrap;
    gap: 6px 12px;
  }

  .ol-fork__branch--0 {
    --bc: var(--c0);
  }
  .ol-fork__branch--1 {
    --bc: var(--c1);
  }
  .ol-fork__branch--2 {
    --bc: var(--c2);
  }

  .ol-fork__arm {
    white-space: normal;
  }
}
</style>
