<script setup lang="ts">
  import { ref, onMounted, watch, nextTick } from 'vue';
  import { createIcon } from '@download/blockies';

  const props = withDefaults(defineProps<{
    tokenId: string;
    iconUrl?: string | undefined;
    size?: number;
  }>(), {
    size: 28
  });

  const imageLoadFailed = ref(false);
  const fallbackRef = ref<HTMLDivElement | null>(null);

  function appendBlockieIcon() {
    if (!fallbackRef.value) return;
    // Clear any existing content
    fallbackRef.value.innerHTML = '';
    const icon = createIcon({
      seed: props.tokenId,
      size: 12,
      scale: Math.ceil(props.size / 12),
      spotcolor: '#000'
    });
    icon.style.cssText = `display: block; border-radius: 50%; width: ${props.size}px; height: ${props.size}px;`;
    fallbackRef.value.appendChild(icon);
  }

  onMounted(() => {
    if (!props.iconUrl) {
      appendBlockieIcon();
    }
  });

  watch(imageLoadFailed, async (failedToLoad) => {
    if (failedToLoad) {
      await nextTick();
      appendBlockieIcon();
    }
  });
</script>

<template>
  <img
    v-if="iconUrl && !imageLoadFailed"
    class="token-icon"
    :style="{ width: `${size}px`, height: `${size}px` }"
    :src="iconUrl"
    @error="() => imageLoadFailed = true"
  >
  <div v-else ref="fallbackRef" class="token-icon-fallback"></div>
</template>

<style scoped>
.token-icon {
  border-radius: 50%;
  vertical-align: middle;
}
.token-icon-fallback {
  display: inline-block;
  vertical-align: middle;
}
</style>
