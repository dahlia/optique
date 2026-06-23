<script setup lang="ts">
// The signature element: a prism echoing the logo, refracting one incoming
// beam into a fan of rays. The faint multi-hue spectrum lives only here.
// Motion is an orchestrated load reveal, disabled under reduced-motion.
import { useId } from "vue";

withDefaults(
  defineProps<{
    // Slightly denser ray fan for the standalone "dispersion" placement.
    variant?: "accent" | "dispersion";
  }>(),
  { variant: "accent" },
);

// The prism is rendered more than once per page, so the SVG gradient ids must
// be unique per instance (document-global ids would otherwise collide). useId()
// is stable across SSR and client hydration.
const uid = useId().replace(/[^\w-]/g, "");
const gid = (name: string) => `${uid}-${name}`;
const fill = (name: string) => `url(#${uid}-${name})`;
</script>

<template>
  <div class="ol-prism" :class="`ol-prism--${variant}`" aria-hidden="true">
    <svg
      class="ol-prism__svg"
      viewBox="0 0 720 360"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient :id="gid('beam')" x1="0" y1="180" x2="300" y2="180"
          gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="var(--optique-prism-7)" stop-opacity="0" />
          <stop offset="1" stop-color="var(--optique-prism-6)" stop-opacity="0.9" />
        </linearGradient>
        <linearGradient :id="gid('ray1')" x1="360" y1="180" x2="720" y2="70"
          gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="var(--optique-spectrum-1)" stop-opacity="0.85" />
          <stop offset="1" stop-color="var(--optique-spectrum-1)" stop-opacity="0" />
        </linearGradient>
        <linearGradient :id="gid('ray2')" x1="360" y1="180" x2="720" y2="140"
          gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="var(--optique-spectrum-2)" stop-opacity="0.8" />
          <stop offset="1" stop-color="var(--optique-spectrum-2)" stop-opacity="0" />
        </linearGradient>
        <linearGradient :id="gid('ray3')" x1="360" y1="180" x2="720" y2="220"
          gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="var(--optique-spectrum-3)" stop-opacity="0.8" />
          <stop offset="1" stop-color="var(--optique-spectrum-3)" stop-opacity="0" />
        </linearGradient>
        <linearGradient :id="gid('ray4')" x1="360" y1="180" x2="720" y2="290"
          gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="var(--optique-spectrum-4)" stop-opacity="0.8" />
          <stop offset="1" stop-color="var(--optique-spectrum-4)" stop-opacity="0" />
        </linearGradient>
        <linearGradient :id="gid('facel')" x1="300" y1="120" x2="360" y2="240"
          gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="var(--optique-prism-5)" />
          <stop offset="1" stop-color="var(--optique-prism-2)" />
        </linearGradient>
        <linearGradient :id="gid('facer')" x1="360" y1="110" x2="420" y2="250"
          gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="var(--optique-prism-4)" />
          <stop offset="1" stop-color="var(--optique-prism-1)" />
        </linearGradient>
      </defs>

      <!-- incoming beam -->
      <path class="ol-prism__beam" d="M0 180 H318" :stroke="fill('beam')"
        stroke-width="4" stroke-linecap="round" />

      <!-- refracted rays -->
      <path class="ol-prism__ray ol-prism__ray--1" d="M372 168 L720 64"
        :stroke="fill('ray1')" stroke-width="3" stroke-linecap="round" />
      <path class="ol-prism__ray ol-prism__ray--2" d="M384 176 L720 138"
        :stroke="fill('ray2')" stroke-width="3" stroke-linecap="round" />
      <path class="ol-prism__ray ol-prism__ray--3" d="M384 196 L720 222"
        :stroke="fill('ray3')" stroke-width="3" stroke-linecap="round" />
      <path class="ol-prism__ray ol-prism__ray--4" d="M372 204 L720 296"
        :stroke="fill('ray4')" stroke-width="3" stroke-linecap="round" />

      <!-- prism body: two facets, nodding to the 3D logo -->
      <g class="ol-prism__body">
        <path d="M360 96 L318 240 L360 240 Z" :fill="fill('facel')" />
        <path d="M360 96 L360 240 L408 228 Z" :fill="fill('facer')" />
        <path d="M360 96 L318 240 L408 228 Z" fill="none"
          stroke="var(--optique-prism-6)" stroke-opacity="0.5"
          stroke-width="1.25" stroke-linejoin="round" />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.ol-prism {
  width: 100%;
  display: flex;
  justify-content: center;
}

.ol-prism__svg {
  width: 100%;
  height: auto;
  overflow: visible;
}

.ol-prism--accent {
  max-width: 460px;
}

.ol-prism--dispersion {
  max-width: 620px;
}

.ol-prism__beam {
  stroke-dasharray: 320;
  stroke-dashoffset: 0;
}

.ol-prism__ray {
  opacity: 1;
}

@media (prefers-reduced-motion: no-preference) {
  .ol-prism__beam {
    stroke-dashoffset: 320;
    animation: ol-beam-draw 0.7s ease-out 0.1s forwards;
  }

  .ol-prism__body {
    opacity: 0;
    transform-box: fill-box;
    transform-origin: center;
    animation: ol-prism-pop 0.5s ease-out 0.55s forwards;
  }

  .ol-prism__ray {
    opacity: 0;
    transform-box: fill-box;
    transform-origin: 8% 50%;
    animation: ol-ray-fan 0.8s ease-out forwards;
  }

  .ol-prism__ray--1 { animation-delay: 0.8s; }
  .ol-prism__ray--2 { animation-delay: 0.92s; }
  .ol-prism__ray--3 { animation-delay: 1.04s; }
  .ol-prism__ray--4 { animation-delay: 1.16s; }

  @keyframes ol-beam-draw {
    to { stroke-dashoffset: 0; }
  }

  @keyframes ol-prism-pop {
    from { opacity: 0; transform: scale(0.9); }
    to { opacity: 1; transform: scale(1); }
  }

  @keyframes ol-ray-fan {
    from { opacity: 0; transform: rotate(-7deg); }
    to { opacity: 1; transform: rotate(0); }
  }
}
</style>
