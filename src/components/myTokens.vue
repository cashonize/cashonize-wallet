
<script setup lang="ts">
  import tokenItem from './tokenItem.vue'
  import { useStore } from '../stores/store'
  const store = useStore()
</script>

<template>
  <div v-if="store.nrBcmrRegistries == undefined">Loading tokendata ...</div>
  <div v-if="store.tokenList?.length == 0"> No tokens in Wallet </div>
  <div v-if="store.nrBcmrRegistries != undefined">
    <div v-for="tokenData in store.tokenList" :key="tokenData.tokenId.slice(0,6)">
      <tokenItem :tokenData="tokenData"/>
    </div>
  </div>
</template>../stores/store