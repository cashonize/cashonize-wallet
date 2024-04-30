<script setup lang="ts">
  import { ref, watch } from 'vue';
  import { useStore } from 'src/stores/store'
  import { useSettingsStore } from 'src/stores/settingsStore'
  import type { dialogInfo } from 'src/interfaces/interfaces'
  import { useQuasar } from 'quasar'
  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const emit = defineEmits(['closeDialog']);

  const showDialog = ref(true);

  defineProps<{
    alertInfo: dialogInfo,
  }>()

  function copyToClipboard(copyText: string|undefined){
    if(!copyText) return
    navigator.clipboard.writeText(copyText);
    $q.notify({
        message: "Copied!",
        icon: 'info',
        timeout : 1000,
        color: "grey-6"
      })
  }

  watch(showDialog, () => {
    if(!showDialog.value) emit('closeDialog')
  })
</script>

<template>
  <q-dialog v-model="showDialog" >
    <q-card style="width: 500px" class="alertDialog">

      <q-card-section class="row items-center q-pb-none">
        <div class="text-h6">Transaction Sent!</div>
        <q-space />
        <q-btn icon="close" :color="settingsStore.darkMode? 'white':'black'" flat round dense v-close-popup />
      </q-card-section>

      <q-card-section class="q-pt-none">
        {{ alertInfo.message }} <br><br>
        <span @click="copyToClipboard(alertInfo.txid)" style="cursor: pointer;">
          TransactionId: {{ alertInfo.txid.slice(0, 20) + "..." + alertInfo.txid.slice(-10) }}
          <img class="copyIcon icon" :src="settingsStore.darkMode? 'images/copyGrey.svg':'images/copy.svg'">
        </span>
        <br><br>
        <a :href="store.explorerUrl + `/tx/${alertInfo.txid}`" target="_blank">Link blockexplorer</a>
      </q-card-section>
      <br>
    </q-card>
  </q-dialog>
</template>

<style scoped>
  body.dark .alertDialog {
    background-color: #050a14;
  }
</style>