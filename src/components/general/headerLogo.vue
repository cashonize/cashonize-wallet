<script setup lang="ts">
  // The header logo, with a small easter egg: three quick clicks send a ripple down the dots
  // beside the mark. Copies of those dots lie over the image, invisible until they pulse.
  import { ref } from 'vue'
  import { useSettingsStore } from 'src/stores/settingsStore'

  const settingsStore = useSettingsStore()

  // The dots in the 850x270 logo, top to bottom: centre and colour, measured from the image. They
  // follow the mark's gradient, so each copy takes its own dot's colour.
  const logoWidth = 850, logoHeight = 270, dotDiameter = 17;
  const dots = [
    { cx: 192, cy: 79.1, color: '#0dd082' },
    { cx: 204.7, cy: 100.7, color: '#0dcd83' },
    { cx: 211, cy: 125.1, color: '#0ccb85' },
    { cx: 210, cy: 150.4, color: '#0cc988' },
    { cx: 201.8, cy: 174.3, color: '#0bc68a' },
    { cx: 187.3, cy: 194.9, color: '#0bc48b' },
  ].map((dot, index) => ({
    left: `${(dot.cx - dotDiameter / 2) / logoWidth * 100}%`,
    top: `${(dot.cy - dotDiameter / 2) / logoHeight * 100}%`,
    color: dot.color,
    delay: `${index * 70}ms`,
  }));
  const dotWidth = `${dotDiameter / logoWidth * 100}%`;

  const clicksNeeded = 3;
  const clickWindowMs = 800;
  // the last dot's delay plus one pulse
  const rippleMs = 5 * 70 + 600;

  const rippling = ref(false);
  let clickTimes: number[] = [];

  function onLogoClick() {
    const now = Date.now();
    clickTimes = [...clickTimes, now].filter(time => now - time < clickWindowMs);
    if (clickTimes.length < clicksNeeded || rippling.value) return;
    clickTimes = [];
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    rippling.value = true;
    setTimeout(() => { rippling.value = false }, rippleMs);
  }
</script>

<template>
  <span class="headerLogo" @click="onLogoClick">
    <img :src="settingsStore.darkMode ? 'images/cashonize-logo-dark.png' : 'images/cashonize-logo.png'" alt="Cashonize: a Bitcoin Cash Wallet">
    <span
      v-for="(dot, index) in dots"
      :key="index"
      class="logoDot"
      :class="{ rippling }"
      :style="{ left: dot.left, top: dot.top, width: dotWidth, backgroundColor: dot.color, animationDelay: dot.delay }"
    ></span>
  </span>
</template>

<style scoped>
.headerLogo {
  position: relative;
  display: inline-block;
  line-height: 0;
  user-select: none;
}
.headerLogo img {
  height: 85px;
}
.logoDot {
  position: absolute;
  aspect-ratio: 1;
  border-radius: 50%;
  opacity: 0;
  pointer-events: none;
}
.logoDot.rippling {
  animation: logoDotRipple 600ms ease-in-out backwards;
}
@keyframes logoDotRipple {
  0% { opacity: 1; transform: scale(1); }
  45% { opacity: 1; transform: scale(1.9); }
  100% { opacity: 1; transform: scale(1); }
}
</style>
