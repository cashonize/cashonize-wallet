<script setup lang="ts">
  // Drop-in replacement for the <qr-code> web component of @bitjson/qr-code, rendering the
  // same svg (see qrCodeSvg.ts) and offering the same intro animations. The presets are the
  // library's, reimplemented as css keyframes over a per-element animation-delay.
  import { computed, nextTick, onMounted, ref, useSlots, watch } from 'vue'
  import { generateQrCodeSvg, iconWidthPercentage } from 'src/utils/qrCodeSvg'
  import type { QRCodeAnimationName } from 'src/interfaces/interfaces'

  const props = defineProps<{
    contents: string
    /** Describes what the code encodes, for screen readers; the modules themselves say nothing. */
    label: string
  }>()

  const emit = defineEmits<{ rendered: [] }>()

  // The slot holds the icon overlaid on the code's center; when it is filled the generator
  // punches a matching hole in the modules behind it.
  const hasIcon = Boolean(useSlots().default)

  const activeAnimation = ref<QRCodeAnimationName | 'None'>('None')
  const qrCode = computed(() => generateQrCodeSvg(props.contents, hasIcon, activeAnimation.value))

  // The parent animates a new code from the 'rendered' handler. onMounted announces the first
  // one, because an immediate watcher would run during setup, before the parent's ref is set.
  onMounted(() => emit('rendered'))
  watch(() => props.contents, () => {
    activeAnimation.value = 'None'
    void nextTick(() => emit('rendered'))
  })

  function animate(animation: QRCodeAnimationName) {
    activeAnimation.value = animation
  }

  defineExpose({ animate })
</script>

<template>
  <!-- role="img" collapses the hundreds of svg modules into one labelled image for
       assistive technology, which would otherwise read out nothing at all -->
  <div class="qrCode" role="img" :aria-label="label">
    <div class="qrContainer" :class="activeAnimation !== 'None' ? `animate-${activeAnimation}` : ''">
      <div class="iconContainer">
        <div
          class="iconWrapper"
          :style="{ width: `${iconWidthPercentage}%`, animationDelay: `${qrCode.iconDelayMs}ms` }"
        >
          <slot />
        </div>
      </div>
      <!-- safe as html: the generator interpolates only numbers, never the qr contents -->
      <div v-html="qrCode.svg"></div> <!-- eslint-disable-line vue/no-v-html -->
    </div>
  </div>
</template>

<style scoped lang="scss">
$rippleEasing: cubic-bezier(0.445, 0.05, 0.55, 0.95);

.qrCode {
  contain: content;
}
.iconContainer {
  position: absolute;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Each animated element carries its own animation-delay as an inline style, written into the
   svg by generateQrCodeSvg. The rules below add only the keyframes and the timing, so the
   browser runs the intro on its own without any javascript per frame. */
.qrContainer {
  position: relative;

  &.animate-FadeInTopDown {
    :deep(.module), :deep(.position-ring), :deep(.position-center), .iconWrapper {
      animation: qrFadeIn 300ms ease both;
    }
  }
  &.animate-FadeInCenterOut, &.animate-MaterializeIn {
    :deep(.module), :deep(.position-ring), :deep(.position-center), .iconWrapper {
      animation: qrFadeIn 200ms ease both;
    }
  }
  /* The two ripple presets pulse the icon down before the wave reaches it, so it gets its
     own keyframes; the scale is deliberately left to resolve around the svg's own center,
     which turns the size pulse into the outward wave. */
  &.animate-RadialRipple {
    :deep(.module), :deep(.position-ring), :deep(.position-center) {
      animation: qrRipple 1000ms $rippleEasing both;
    }
    .iconWrapper {
      animation: qrRippleIcon 1000ms $rippleEasing both;
    }
  }
  &.animate-RadialRippleIn {
    :deep(.module), :deep(.position-ring), :deep(.position-center) {
      animation: qrRippleIn 1000ms $rippleEasing both, qrRippleReveal 1000ms $rippleEasing both;
    }
    .iconWrapper {
      animation: qrRippleIcon 1000ms $rippleEasing both, qrRippleReveal 1000ms $rippleEasing both;
    }
  }
}

@keyframes qrFadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* The ripple offsets and scales come from the underdamped harmonic oscillation the library
   solved at runtime for an amplitude of 5, a stiffness of 50 and a damping of 3, scaled into
   the 20%-100% window of the animation. */
@keyframes qrRipple {
  0% { transform: scale(1); }
  20% { transform: scale(1.1); }
  34.164% { transform: scale(0.974484); }
  50.623% { transform: scale(1.005856); }
  67.082% { transform: scale(0.998656); }
  83.541% { transform: scale(1.000308); }
  100% { transform: scale(1); }
}
@keyframes qrRippleIn {
  0% { transform: scale(0); }
  20% { transform: scale(1.1); }
  34.164% { transform: scale(0.974484); }
  50.623% { transform: scale(1.005856); }
  67.082% { transform: scale(0.998656); }
  83.541% { transform: scale(1.000308); }
  100% { transform: scale(1); }
}
@keyframes qrRippleIcon {
  0% { transform: scale(1); }
  10% { transform: scale(0.7); }
  20% { transform: scale(1.1); }
  34.164% { transform: scale(0.974484); }
  50.623% { transform: scale(1.005856); }
  67.082% { transform: scale(0.998656); }
  83.541% { transform: scale(1.000308); }
  100% { transform: scale(1); }
}
@keyframes qrRippleReveal {
  0% { opacity: 0; }
  5% { opacity: 1; }
  100% { opacity: 1; }
}
</style>
