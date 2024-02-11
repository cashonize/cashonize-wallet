<script setup lang="ts">
  import { ref, toRefs } from 'vue';
  import type { DappMetadata } from "src/interfaces/interfaces"
  import { useStore } from 'src/stores/store'
  const store = useStore()

  const showDialog = ref(true);

  const props = defineProps<{
    dappMetadata: DappMetadata
    dappTargetNetwork: "mainnet" | "chipnet"
  }>()
  const { dappMetadata, dappTargetNetwork } = toRefs(props);

  let needsNetworkSwitch = false;
  if(dappTargetNetwork.value !== store.network) needsNetworkSwitch = true
</script>

<template>
  <q-dialog v-model="showDialog" class="all-pointer-events">
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
          <input type="button" class="primaryButton" value="Approve">
          <input type="button" value="Reject" @click="() => showDialog = false">
        </div>
      </fieldset>
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
  input[type=button]:hover{
    cursor: pointer;
  }
</style>