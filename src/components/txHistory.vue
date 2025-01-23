<script setup lang="ts">
  import { useStore } from 'src/stores/store'
  const store = useStore()
</script>

<template>
  <div>
    <fieldset class="item">
      <legend>Transaction History</legend>

      <div v-if="store.walletHistory == undefined" style="text-align: center;">Loading transaction history ...</div>
      <div v-if="store.walletHistory?.length == 0" style="text-align: center;">No transaction history</div>
    </fieldset>
  </div>
</template>