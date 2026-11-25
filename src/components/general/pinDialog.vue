<script setup lang="ts">
  // The app lock's PIN asked before something sensitive: OK once the PIN was right
  import { useDialogPluginComponent } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import { useAppLockStore } from 'src/stores/appLockStore'
  import PinEntry from './PinEntry.vue'
  const appLock = useAppLockStore()
  const { t } = useI18n()

  defineEmits([
    ...useDialogPluginComponent.emits
  ])
  const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()
</script>

<template>
  <q-dialog ref="dialogRef" persistent @hide="onDialogHide">
    <q-card class="pin-dialog">
      <q-card-section class="q-pb-none">
        <div class="text-h6">{{ t('appLock.confirmTitle') }}</div>
      </q-card-section>
      <q-card-section class="pin-dialog-body">
        <PinEntry :check="appLock.checkPin" :submit-label="t('appLock.confirmButton')" cancellable @verified="onDialogOK" @cancel="onDialogCancel" />
      </q-card-section>
    </q-card>
  </q-dialog>
</template>

<style scoped>
.pin-dialog {
  width: 320px;
  max-width: 90vw;
}
.pin-dialog-body {
  display: flex;
  justify-content: center;
}
</style>
