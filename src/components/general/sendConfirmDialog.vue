<script setup lang="ts">
  // The review before a send: what leaves the wallet and where it goes
  import { computed } from 'vue'
  import { useDialogPluginComponent } from 'quasar'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import type { SendSummary } from 'src/interfaces/interfaces'
  import SendAmount from './SendAmount.vue'
  import { useI18n } from 'vue-i18n'
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const props = defineProps<{
    summary: SendSummary,
  }>()

  defineEmits([
    ...useDialogPluginComponent.emits
  ])

  const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()

  // both ends of the address on one line, the parts a user compares against the one they meant
  const shortRecipient = computed(() => {
    const [prefix, payload] = props.summary.recipient.split(':')
    if (!payload) return `${props.summary.recipient.slice(0, 10)}…${props.summary.recipient.slice(-8)}`
    return `${prefix}:${payload.slice(0, 8)}…${payload.slice(-8)}`
  })
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide">
    <q-card class="sendConfirm">
      <q-card-section class="q-pb-none">
        <div class="text-h6">{{ t('sendConfirm.title') }}</div>
      </q-card-section>

      <q-card-section>
        <SendAmount :summary="summary" compact />
        <div class="recipient">
          <span class="label">{{ t('sendConfirm.to') }}</span>
          <span>{{ shortRecipient }}</span>
        </div>
      </q-card-section>

      <q-card-actions align="right">
        <q-btn flat :color="settingsStore.darkMode ? 'white' : 'dark'" :label="t('sendConfirm.cancel')" @click="onDialogCancel" />
        <q-btn color="primary" text-color="white" :label="t('common.actions.send')" @click="onDialogOK" />
      </q-card-actions>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .sendConfirm {
    width: 360px;
    max-width: 100%;
  }
  body.dark .sendConfirm {
    background-color: var(--bg-color);
  }
  .recipient {
    display: flex;
    gap: 8px;
    white-space: nowrap;
    margin-top: 14px;
    padding-top: 12px;
    border-top: 1px solid var(--surface-line);
  }
  .label {
    color: var(--color-grey);
  }
</style>
