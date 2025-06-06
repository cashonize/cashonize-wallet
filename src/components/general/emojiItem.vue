<script setup lang="ts">
const props = defineProps<{
  emoji: '✅' | '⏳' | '❌' | '⚠️',
  sizePx?: number 
}>()

const emojiSrc = (() => {switch (props.emoji) {
    case '✅':
      return `./emoji-icons/checkbox.svg`;
    case '⏳':
      return `./emoji-icons/hourglass.svg`;
    case '❌':
      return `./emoji-icons/cross.svg`;
    case '⚠️':
      return `./emoji-icons/warning.svg`;
  }}
)()
</script>

<template>
  <img
    :src="emojiSrc"
    :alt="emoji"
    :width="sizePx || 16"
    :height="sizePx || 16"
    class="emoji-icon"
  />
</template>


<style scoped>
.emoji-icon {
  vertical-align: middle;
}
</style>
