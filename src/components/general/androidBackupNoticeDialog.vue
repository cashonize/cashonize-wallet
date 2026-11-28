<script setup lang="ts">
  import { useDialogPluginComponent } from 'quasar'
  import { useI18n } from 'vue-i18n'

  // The Android backup notice (utils/androidBackupNotice.ts). It interrupts the wallet at open,
  // so only what happened and what to do stand in the open; the rest waits behind three questions.
  // OK is "Got it", for good; every other way out leaves the notice snoozed.
  defineEmits([
    ...useDialogPluginComponent.emits
  ])

  const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()
  const { t } = useI18n()

  // where the release that made the change explains how to delete the old backup
  const releaseNotesUrl = 'https://github.com/cashonize/cashonize-wallet/releases/tag/v0.18.0'
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" transition-show="scale" transition-hide="scale">
    <q-card class="dialogCard">
      <fieldset class="dialogFieldset">
        <legend style="font-size: large;">{{ t('androidBackupNotice.title') }}</legend>
        <div>{{ t('androidBackupNotice.lead') }}</div>
        <div class="notice-action">{{ t('androidBackupNotice.action') }}</div>
        <details class="notice-question">
          <summary>{{ t('androidBackupNotice.backedUpQuestion') }}</summary>
          <div class="notice-answer">{{ t('androidBackupNotice.backedUpAnswer') }}</div>
        </details>
        <details class="notice-question">
          <summary>{{ t('androidBackupNotice.removeQuestion') }}</summary>
          <div class="notice-answer">
            {{ t('androidBackupNotice.removeAnswer') }}
            <div><a class="notice-link" :href="releaseNotesUrl" target="_blank">{{ t('androidBackupNotice.releaseNotes') }}</a></div>
          </div>
        </details>
        <details class="notice-question">
          <summary>{{ t('androidBackupNotice.newWalletQuestion') }}</summary>
          <div class="notice-answer">{{ t('androidBackupNotice.newWalletAnswer') }}</div>
        </details>
        <div class="notice-actions">
          <input type="button" class="primaryButton" :value="t('androidBackupNotice.dismiss')" @click="onDialogOK()">
          <input type="button" :value="t('androidBackupNotice.later')" @click="onDialogCancel()">
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset {
    padding: 2rem;
    width: 550px;
    max-width: 100%;
  }
  .notice-action {
    margin: 12px 0 16px;
    font-weight: 600;
  }
  .notice-question {
    border-top: 1px solid var(--surface-line);
  }
  .notice-question summary {
    display: list-item;
    /* a question that wraps continues under its text, not under the marker */
    padding: 10px 2px 10px 19px;
    text-indent: -17px;
    font-weight: 500;
    cursor: pointer;
  }
  .notice-answer {
    padding: 0 2px 12px 19px;
  }
  /* the only way to the steps, so it gets a tap target of its own */
  .notice-link {
    display: inline-block;
    padding: 8px 0;
  }
  .notice-actions {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    margin-top: 16px;
  }
</style>
