
<script setup lang="ts">
  import tokenItemNFT from './tokenItems/tokenItemNFT.vue'
  import tokenItemFT from './tokenItems/tokenItemFT.vue'
  import { useStore } from 'src/stores/store'
  import { ref, watch } from 'vue';

  const store = useStore()

  const bcmrRefreshKey = ref(0);
  watch(store, () => {
    if (store.bcmrRegistries === undefined) {
      return;
    }
    bcmrRefreshKey.value++;
  });
</script>

<template>
  <div v-if="store.nrBcmrRegistries == undefined" style="text-align: center;">Loading tokendata ...</div>
  <div v-if="store.tokenList?.length == 0" style="text-align: center;"> No tokens in this wallet </div>
  <div v-if="store.nrBcmrRegistries != undefined" :key="bcmrRefreshKey">
    <div v-for="tokenData in store.tokenList" :key="tokenData.tokenId.slice(0,6)">
      <tokenItemFT v-if="'amount' in tokenData" :tokenData="tokenData"/>
      <tokenItemNFT v-else :tokenData="tokenData"/>
    </div>
  </div>
</template>