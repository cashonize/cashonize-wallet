<script setup lang="ts">
  // What a popup woken for an auto-approved transaction shows while it loads the wallet to sign
  // with: the action and the site, as the transaction request dialog names them
  import { useDialogPluginComponent } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import type { DappMetadata } from 'src/interfaces/interfaces'
  import { sanitizeUrl } from 'src/utils/utils'

  const props = defineProps<{
    dappMetadata: DappMetadata
    userPrompt?: string | undefined
  }>()

  defineEmits([
    ...useDialogPluginComponent.emits
  ])
  const { dialogRef, onDialogHide } = useDialogPluginComponent()
  const { t } = useI18n()

  const safeUrl = sanitizeUrl(props.dappMetadata.url)
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" persistent transition-show="scale" transition-hide="scale">
    <q-card class="dialogCard">
      <fieldset class="dialogFieldset">
        <legend style="font-size: large;">{{ t('dapp.autoApprovingTitle') }}</legend>

        <div v-if="userPrompt" style="display: flex; justify-content: center; font-size: large; margin-top: 1rem;">
          {{ userPrompt }}
        </div>

        <div style="font-size: large; margin-top: 1.5rem;">{{ t('walletConnect.transactionRequest.origin') }}</div>
        <div style="display: flex; align-items: center;">
          <img v-if="dappMetadata.icons[0]" :src="dappMetadata.icons[0]" style="display: flex; height: 55px; width: 55px;">
          <div style="margin-left: 10px;">
            <div>{{ dappMetadata.name }}</div>
            <a v-if="safeUrl" :href="safeUrl" target="_blank">{{ dappMetadata.url }}</a>
          </div>
        </div>

        <div class="auto-approving-progress">
          <q-spinner-dots size="2em" color="primary" />
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset {
    padding: .5rem 2rem;
    width: 500px;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
  .auto-approving-progress {
    display: flex;
    justify-content: center;
    margin: 2rem 0;
  }
</style>
