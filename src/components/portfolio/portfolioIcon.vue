<script setup lang="ts">
  defineProps<{ sizePx?: number }>()
</script>

<!-- Donut-chart icon used as the portfolio branding.
  Three flat segments (with small gaps) on a circle of radius 14,
  circumference ~87.96; dash lengths are fractions of that circumference. -->
<template>
  <svg :width="sizePx ?? 22" :height="sizePx ?? 22" viewBox="0 0 36 36" class="portfolio-icon" aria-hidden="true">
    <g transform="rotate(-90 18 18)" fill="none" stroke-width="7">
      <circle cx="18" cy="18" r="14" class="segment-primary" stroke-dasharray="41.5 87.96" stroke-dashoffset="0"/>
      <circle cx="18" cy="18" r="14" class="segment-tint" stroke-dasharray="24 87.96" stroke-dashoffset="-43.98"/>
      <circle cx="18" cy="18" r="14" class="segment-grey" stroke-dasharray="15 87.96" stroke-dashoffset="-70.37"/>
    </g>
  </svg>
</template>

<style scoped>
.segment-primary {
  stroke: var(--color-primary);
}
.segment-tint {
  stroke: #6fe3c0;
}
.segment-grey {
  stroke: var(--color-lightGrey);
}
</style>
