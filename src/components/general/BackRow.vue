<script setup lang="ts">
  import { useI18n } from 'vue-i18n'
  const { t } = useI18n()
</script>

<template>
  <button type="button" class="back-row">
    <q-icon name="arrow_back" size="18px" />
    {{ t('common.actions.back') }}
  </button>
</template>

<style scoped>
/* a quiet text row rather than chota's grey button */
.back-row {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 15px -6px;
  padding: 6px;
  border: none;
  background: none;
  color: var(--font-color);
}
.back-row:hover {
  opacity: 1;
  background: var(--surface-strong);
}
</style>
