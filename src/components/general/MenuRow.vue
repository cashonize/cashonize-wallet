<script setup lang="ts">
  // One row of the More page: a destination, or with `expanded` set a group that opens in place.
  // The slot carries what needs attention there.
  // the default keeps `expanded` undefined for a plain row, where Vue would make a missing boolean false
  withDefaults(defineProps<{ label: string, icon?: string, expanded?: boolean | undefined }>(), { expanded: undefined })
</script>

<template>
  <button type="button" class="menu-row" :class="{ nested: !icon }" :aria-expanded="expanded">
    <q-icon v-if="icon" :name="icon" size="20px" class="menu-row-icon" />
    <span class="menu-row-label">{{ label }}</span>
    <span class="menu-row-trailing"><slot /></span>
    <q-icon v-if="expanded === undefined" name="chevron_right" size="20px" class="menu-row-icon" />
    <q-icon v-else :name="expanded ? 'keyboard_arrow_up' : 'keyboard_arrow_down'" size="20px" class="menu-row-icon" />
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
/* a row of an opened group, set in under the group's label */
.menu-row.nested {
  padding-left: 42px;
  background: var(--surface-faint);
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
.menu-row-trailing {
  font-size: smaller;
  text-align: right;
}
</style>
