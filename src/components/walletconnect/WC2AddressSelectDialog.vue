<script setup lang="ts">
  import { useDialogPluginComponent } from 'quasar'
  import { type WalletKitTypes } from '@reown/walletkit';
  import type { DappMetadata } from "src/interfaces/interfaces"
  import { useStore } from 'src/stores/store'
  import { useI18n } from 'vue-i18n'
  import HdAddresses from 'src/components/settings/hdAddresses.vue'

  const store = useStore()
  const { t } = useI18n()

  const props = defineProps<{
    sessionProposalWC: WalletKitTypes.SessionProposal,
    dappTargetNetwork: "mainnet" | "chipnet"
  }>()

  defineEmits([
    ...useDialogPluginComponent.emits
  ])

  const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()

  const dappMetadata = props.sessionProposalWC.params.proposer.metadata as DappMetadata;
  const needsNetworkSwitch = (props.dappTargetNetwork !== store.network);

  function onAddressSelected(address: string) {
    onDialogOK(address);
  }
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" persistent transition-show="scale" transition-hide="scale">
    <q-card>
      <fieldset class="dialogFieldset">
        <legend style="font-size: large;">{{ t('walletConnect.addressSelect.title') }}</legend>
        <div style="display: flex;">
          <img :src="dappMetadata.icons?.[0] ?? ''" style="display: flex; height: 55px; width: 55px;">
          <div style="margin-left: 10px;">
            <div>{{ dappMetadata.name }}</div>
            <a :href="dappMetadata.url" target="_blank">{{ dappMetadata.url }}</a>
          </div>
        </div>

        <div v-if="needsNetworkSwitch" style="margin-top: 0.5rem; color: orange;">
          {{ t('walletConnect.sessionRequest.switchAndApprove', { network: dappTargetNetwork }) }}
        </div>

        <div style="margin-top: 1rem; color: #888;">{{ t('walletConnect.addressSelect.hint') }}</div>

        <div style="margin-top: 0.5rem; max-height: 350px; overflow-y: auto;">
          <HdAddresses :selectable="true" :default-hide-zero-balances="true" :default-show-used="true" @address-selected="onAddressSelected" />
        </div>

        <div style="margin-top: 1rem; display: flex; gap: 1rem;">
          <input type="button" :value="t('walletConnect.sessionRequest.rejectButton')" @click="onDialogCancel">
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset{
    padding: 2rem;
    width: 550px;
    max-width: 100%;
    background-color: white;
  }
  body.dark .dialogFieldset {
    background-color: #050a14;
  }
  .q-card{
    box-shadow: none;
    background: none;
  }
</style>
