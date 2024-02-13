<script setup lang="ts">
  import type { DappMetadata } from "src/interfaces/interfaces"
  import { toRefs } from 'vue';

  const props = defineProps<{
    dappMetadata: DappMetadata
  }>()
  const { dappMetadata } = toRefs(props);
</script>

<template>
  <div style="padding: 7px; ">
    <div style="display: flex; align-items: center;">
      <img :src="dappMetadata.icons[0]" style="display: flex; height: 50px; width: 50px;">
      <div style="margin-left: 10px;">
        <div>{{ dappMetadata.name }}</div>
        <a :href="dappMetadata.url">{{ dappMetadata.url }}</a>
        <div>{{ dappMetadata.description }}</div>
      </div>
    </div>
  </div>
</template>