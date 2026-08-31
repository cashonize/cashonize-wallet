<script setup lang="ts">
  import { ref } from 'vue';
  import { type QMenu } from 'quasar';

  const menu = ref<QMenu | null>(null);

  // Also open/close the popup on mouse hover. Guarded to real mouse pointers:
  // touch taps fire emulated mouse events and are handled by the menu's own
  // click toggle (with click-outside and Escape to close) instead.
  function showPopup(event: PointerEvent) {
    if (event.pointerType === 'mouse') menu.value?.show();
  }
  function hidePopup(event: PointerEvent) {
    if (event.pointerType === 'mouse') menu.value?.hide();
  }
</script>

<template>
  <!-- The trigger slot lets any element act as the popup target, the info icon is the default -->
  <span @pointerenter="showPopup" @pointerleave="hidePopup">
    <slot name="trigger">
      <q-icon name="info_outline" class="info-popup-icon" />
    </slot>
    <!-- QMenu instead of QTooltip so opening works by click/tap on all platforms
      (hover-only tooltips are awkward on touch devices) -->
    <q-menu ref="menu" no-focus anchor="bottom middle" self="top middle" :offset="[0, 6]" class="info-popup">
      <slot />
    </q-menu>
  </span>
</template>

<style>
  /* For text acting as the popup trigger (via the trigger slot): a dotted underline
     as the conventional "hover for an explanation" affordance */
  .info-popup-text-trigger {
    cursor: pointer;
    text-decoration: underline dotted;
    text-underline-offset: 2px;
  }
  /* the icon is taller than the lowercase text next to it, drop it slightly below the
     baseline so it reads as vertically centered rather than floating above the line */
  .info-popup-icon {
    font-size: 1.1em;
    color: grey;
    vertical-align: -0.2em;
    cursor: pointer;
  }
  /* Global (unscoped) on purpose: the popup is teleported outside this component */
  .info-popup {
    font-size: 13px;
    padding: 6px 12px;
    border-radius: 6px;
    background: #2d2d33;
    color: #f5f5f5;
  }
  /* For secondary lines in the slotted content */
  .info-popup-note {
    color: #bbb;
    font-size: 12px;
    margin-top: 2px;
  }
</style>
