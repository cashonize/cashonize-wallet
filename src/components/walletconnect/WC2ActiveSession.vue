<script setup lang="ts">
  import type { DappMetadata } from "src/interfaces/interfaces"
  const emit = defineEmits(['deleteSession']);

  defineProps<{
    dappMetadata: DappMetadata,
    sessionId: string
  }>()
</script>

<template>
  <div style="padding: 7px; ">
    <div style="display: flex; align-items: center;">
      <img :src="dappMetadata.icons[0]" style="display: flex; height: 50px; width: 50px;">
      <div style="margin-left: 10px; width: 100%;">
        <div>{{ dappMetadata.name }}</div>
        <a :href="dappMetadata.url">{{ dappMetadata.url }}</a>
        <div>{{ dappMetadata.description }}</div>
      </div>
      <div>
        <img src="images/trash.svg" style="cursor: pointer;" @click="emit('deleteSession', sessionId)"/>
      </div>
    </div>
  </div>
</template>