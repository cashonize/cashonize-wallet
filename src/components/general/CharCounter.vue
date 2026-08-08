<script setup lang="ts">
  // Silent maxlength truncation is confusing, so the limit shows once writing gets close to it.
  // Used by the inline editors and by the note and label dialogs.
  defineProps<{
    length: number;
    maxLength: number;
  }>();
</script>

<template>
  <span
    v-if="length >= maxLength - 20"
    class="char-counter"
    :class="{ 'at-limit': length >= maxLength }"
  >{{ length }}/{{ maxLength }}</span>
</template>

<style scoped>
.char-counter {
  font-size: 0.75em;
  opacity: 0.6;
}

.char-counter.at-limit {
  color: #e6a23c;
  opacity: 1;
}
</style>
