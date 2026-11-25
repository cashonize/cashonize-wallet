<script setup lang="ts">
  // One row of the More page and the pages under it: where it leads, with an optional line on
  // what is there. The slot carries what needs attention there.
  defineProps<{ label: string, icon: string, description?: string }>()
</script>

<template>
  <button type="button" class="menu-row">
    <q-icon :name="icon" size="20px" class="menu-row-icon" />
    <span class="menu-row-label">
      {{ label }}
      <span v-if="description" class="menu-row-description">{{ description }}</span>
    </span>
    <span class="menu-row-trailing"><slot /></span>
    <q-icon name="chevron_right" size="20px" class="menu-row-icon" />
  </button>
</template>

<style scoped>
/* a full-width row rather than chota's centered grey button */
.menu-row {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  min-height: 44px;
  padding: 8px 10px;
  border: none;
  border-radius: 0;
  background: none;
  color: var(--font-color);
  line-height: inherit;
  text-align: left;
}
.menu-row + .menu-row {
  border-top: 1px solid var(--surface-line);
}
.menu-row:hover {
  opacity: 1;
  background: var(--surface-strong);
}
.menu-row:active:not(:disabled) {
  transform: none;
}
.menu-row-icon {
  flex: none;
  opacity: 0.6;
}
.menu-row-label {
  flex: 1;
}
/* what the row leads to, on a line of its own under its name */
.menu-row-description {
  display: block;
  color: grey;
  font-size: smaller;
}
.menu-row-trailing {
  font-size: smaller;
  text-align: right;
}
</style>
