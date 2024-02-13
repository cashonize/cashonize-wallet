<script setup lang="ts">
  import { ref, toRefs } from 'vue';
  import type { DappMetadata } from "src/interfaces/interfaces"
  import { useStore } from 'src/stores/store'
  const store = useStore()
  const emit = defineEmits(['approveSession']);

  const showDialog = ref(true);

  const props = defineProps<{
    sessionProposalWC: any
  }>()
  const { sessionProposalWC } = toRefs(props);

  const sessionProposal = sessionProposalWC.value;
  const dappMetadata = sessionProposal.params.proposer.metadata as DappMetadata;
  const { requiredNamespaces } = sessionProposal.params;
  let needsNetworkSwitch = false;

  const dappNetworkPrefix = requiredNamespaces.bch.chains[0]?.split(":")[1];
  const dappTargetNetwork = dappNetworkPrefix == "bitcoincash" ? "mainnet" : "chipnet";
  if(dappTargetNetwork !== store.network) needsNetworkSwitch = true

  function approveSessionWC() {
    emit('approveSession', sessionProposalWC.value);
  }
</script>

<template>
  <q-dialog v-model="showDialog" persistent transition-show="scale" transition-hide="scale">
    <q-card>
      <fieldset class="dialogFieldset"> 
        <legend style="font-size: large;">Approve Session?</legend>
        <div style="display: flex;">
          <img :src="dappMetadata.icons[0]" style="display: flex; height: 55px; width: 55px;">
          <div style="margin-left: 10px;">
            <div>{{ dappMetadata.name }}</div>
            <a :href="dappMetadata.url">{{ dappMetadata.url }}</a>
          </div>
        </div>
        <div style="margin-top: 2rem; display: flex; gap: 1rem;">
          <input type="button" class="primaryButton" value="Approve" @click="() => approveSessionWC()" v-close-popup>
          <input type="button" value="Reject" v-close-popup>
        </div>
      </fieldset>
    </q-card>
  </q-dialog>
</template>

<style>
  .dialogFieldset{
    padding: 3rem;
    width: 500px;
    height: 220px;
    background-color: white
  }
  .q-dialog__backdrop {
    backdrop-filter: blur(24px);
    background-color: transparent;
    pointer-events: all  !important;
  }
  .q-card{
    box-shadow: none;
    background: none;
  }
</style>