
<script setup lang="ts">
  import tokenItemNFT from './tokenItems/tokenItemNFT.vue'
  import tokenItemFT from './tokenItems/tokenItemFT.vue'
  import { useStore } from 'src/stores/store'
  import { ref, watch } from 'vue';
  import { useSettingsStore } from 'src/stores/settingsStore';

  const store = useStore()
  const settingsStore = useSettingsStore();
  const tokenList = ref([] as typeof store.tokenList);

  const updateTokenList = () => {
    const featuredTokenList = store.tokenList?.filter(token => settingsStore.featuredTokens.includes(token.tokenId)) ?? [];
    const otherTokenList = store.tokenList?.filter(token => !settingsStore.featuredTokens.includes(token.tokenId)) ?? [];

    tokenList.value = [...featuredTokenList, ...otherTokenList];
    console.log(123)
  }

  watch(settingsStore.featuredTokens, () => {
    console.log(1)
    updateTokenList();
  });

  updateTokenList();
</script>

<template>
  <div v-if="store.nrBcmrRegistries == undefined" style="text-align: center;">Loading tokendata ...</div>
  <div v-if="store.tokenList?.length == 0" style="text-align: center;"> No tokens in this wallet </div>
  <div v-if="store.nrBcmrRegistries != undefined">
    <div v-for="tokenData in store.tokenList" :key="tokenData.tokenId.slice(0,6)">
      <tokenItemFT v-if="'amount' in tokenData" :tokenData="tokenData"/>
      <tokenItemNFT v-else :tokenData="tokenData"/>
    </div>
  </div>
</template>