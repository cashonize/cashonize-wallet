<script setup lang="ts">
// copied from https://github.com/quasarframework/quasar/discussions/16621
  import { ref, useAttrs, computed } from 'vue';
  import { useDialogPluginComponent } from 'quasar';
  defineEmits([ ...useDialogPluginComponent.emits ])
  const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent();

  defineProps<{
    component: any,
  }>();

  const showDialog = ref(true);
  const attrs = useAttrs();

  const props = computed(() => ({
    ...attrs,
    onDialogHide,
    onDialogOK,
    onDialogCancel,
  }));
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" v-model="showDialog" persistent transition-show="scale" transition-hide="scale" style="width: auto;">
    <suspense>
      <component
        :is="component"
        class="q-dialog-plugin"
        v-bind="props"
      />
    </suspense>
  </q-dialog>
</template>

<style scoped>
.q-dialog-plugin{
  width: auto;
}
</style>