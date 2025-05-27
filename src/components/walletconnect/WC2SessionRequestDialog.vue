<script setup lang="ts">
  import { toRefs } from 'vue';
  import { useDialogPluginComponent } from 'quasar'
  import type { DappMetadata } from "src/interfaces/interfaces"
  import { type WalletKitTypes } from '@reown/walletkit';
  import { useStore } from 'src/stores/store'
  const store = useStore()

  const props = defineProps<{
    sessionProposalWC: WalletKitTypes.SessionProposal,
    dappTargetNetwork: "mainnet" | "chipnet"
  }>()
  const { sessionProposalWC } = toRefs(props);

  defineEmits([
  ...useDialogPluginComponent.emits
])

const { dialogRef, onDialogHide, onDialogOK, onDialogCancel } = useDialogPluginComponent()

  const sessionProposal = sessionProposalWC.value;
  const dappMetadata = sessionProposal.params.proposer.metadata as DappMetadata;

  const needsNetworkSwitch = (props.dappTargetNetwork !== store.network);
</script>

<template>
  <q-dialog ref="dialogRef" @hide="onDialogHide" persistent transition-show="scale" transition-hide="scale">
    <q-card>
      <fieldset class="dialogFieldset"> 
        <legend style="font-size: large;">Approve Session?</legend>
        <div style="display: flex;">
          <img :src="dappMetadata.icons?.[0] ?? ''" style="display: flex; height: 55px; width: 55px;">
          <div style="margin-left: 10px;">
            <div>{{ dappMetadata.name }}</div>
            <a :href="dappMetadata.url" target="_blank">{{ dappMetadata.url }}</a>
          </div>
        </div>
        <div style="margin-top: 2rem; display: flex; gap: 1rem;">
          <input type="button" class="primaryButton" :value="needsNetworkSwitch ?`Switch to ${dappTargetNetwork} and approve`: 'Approve'" @click="onDialogOK" v-close-popup>
          <input type="button" value="Reject" @click="onDialogCancel">
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  .dialogFieldset{
    padding: 3rem;
    width: 500px;
    max-width: 100%;
    height: 220px;
    background-color: white
  }
  body.dark .dialogFieldset {
    background-color: #050a14;
  }
  .q-card{
    box-shadow: none;
    background: none;
  }
</style>