
<script setup lang="ts">
  import tokenItemNFT from './tokenItems/tokenItemNFT.vue'
  import tokenItemFT from './tokenItems/tokenItemFT.vue'
  import { useStore } from 'src/stores/store'
  const store = useStore()
</script>

<template>
  <div v-if="store.nrBcmrRegistries == undefined" style="text-align: center;">Loading tokendata ...</div>
  <div v-if="store.tokenList?.length == 0" style="text-align: center;"> No tokens in this wallet </div>
  <div v-if="store.nrBcmrRegistries != undefined" :key="(store.tokenList?.[0]?.tokenId ?? '') + (store.tokenList?.length ?? 0)">
    <div v-for="tokenData in store.tokenList" :key="tokenData.tokenId.slice(0,6)">
      <tokenItemFT v-if="'amount' in tokenData" :tokenData="tokenData" :key="store.bcmrRegistries?.[tokenData.tokenId]?.name"/>
      <tokenItemNFT v-else :tokenData="tokenData" :key="store.bcmrRegistries?.[tokenData.tokenId]?.description"/>
    </div>
  </div>
</template>