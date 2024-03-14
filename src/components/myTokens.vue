
<script setup lang="ts">
  import tokenItemNFT from './tokenItems/tokenItemNFT.vue'
  import tokenItemFT from './tokenItems/tokenItemFT.vue'
  import { useStore } from 'src/stores/store'
  const store = useStore()
</script>

<template>
  <div v-if="store.nrBcmrRegistries == undefined">Loading tokendata ...</div>
  <div v-if="store.tokenList?.length == 0"> No tokens in Wallet </div>
  <div v-if="store.nrBcmrRegistries != undefined">
    <div v-for="tokenData in store.tokenList" :key="tokenData.tokenId.slice(0,6)">
      <tokenItemFT v-if="tokenData.amount" :tokenData="tokenData"/>
      <tokenItemNFT v-else :tokenData="tokenData"/>
    </div>
  </div>
</template>