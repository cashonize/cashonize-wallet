<script setup lang="ts">
import { emojiCheckbox, emojiRedCross, emojiWarning, emojiGreenHeart } from 'src/utils/icons/svgIcons';

const props = defineProps<{
  emoji: '✅' | '❌' | '⚠️' | '💚',
  sizePx?: number 
}>()

const emojiSrc = (() => {switch (props.emoji) {
    case '✅':
      return emojiCheckbox;
    case '❌':
      return emojiRedCross;
    case '⚠️':
      return emojiWarning;
    case '💚':
      return emojiGreenHeart;
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
