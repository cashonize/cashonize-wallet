<script setup lang="ts">
  import { ref, toRefs } from 'vue';
  import type { DappMetadata } from "src/interfaces/interfaces"
  import { useStore } from 'src/stores/store'
  const store = useStore()
  const emit = defineEmits(['approveSession','rejectSession']);

  const showDialog = ref(true);

  const props = defineProps<{
    sessionProposalWC: any
  }>()
  const { sessionProposalWC } = toRefs(props);

  const sessionProposal = sessionProposalWC.value;
  const dappMetadata = sessionProposal.params.proposer.metadata as DappMetadata;
  const { requiredNamespaces } = sessionProposal.params;

  const dappNetworkPrefix = requiredNamespaces.bch.chains[0]?.split(":")[1];
  const dappTargetNetwork = dappNetworkPrefix == "bitcoincash" ? "mainnet" : "chipnet";
  const needsNetworkSwitch = (dappTargetNetwork !== store.network);

  async function approveSessionWC() {
    emit('approveSession', sessionProposalWC.value, dappTargetNetwork);
  }

  function rejectSessionWC() {
    emit('rejectSession');
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
          <input type="button" class="primaryButton" :value="needsNetworkSwitch ?`Switch to ${dappTargetNetwork} and approve`: 'Approve'" @click="() => approveSessionWC()" v-close-popup>
          <input type="button" value="Reject" v-close-popup @click="() => rejectSessionWC()">
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