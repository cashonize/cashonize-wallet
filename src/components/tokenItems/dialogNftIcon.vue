<script setup lang="ts">
  import { ref, watch, toRefs, computed } from 'vue';
  import { useSettingsStore } from 'src/stores/settingsStore'
  const settingsStore = useSettingsStore()

  const props = defineProps<{
    nftName: string | undefined,
    srcNftImage: string
  }>()
  const { srcNftImage } = toRefs(props);
  const showIcon = ref(true)
  const emit = defineEmits(['closeDialog']);
  watch(showIcon, () => emit('closeDialog'))

  const httpsUrlTokenImage = computed(() => {
    let nftImageUri = srcNftImage.value;
    if(nftImageUri?.startsWith('ipfs://')){
      return settingsStore.ipfsGateway + nftImageUri.slice(7);
    }
    return nftImageUri;
  })
</script>

<template>
  <q-dialog v-model="showIcon" style="background-color: rgba(0, 0, 0, 0.9)">
      <q-card>
        <q-card-section class="row items-center q-pb-none text-white">
          <q-space />
          <q-btn icon="close" flat round dense v-close-popup/>
        </q-card-section>

        <q-card-section>
          <img style="width: 400px;" :src="httpsUrlTokenImage">
          <div class="text-h4 text-white" style="max-width: 400px;">{{ nftName }}</div>
        </q-card-section>
      </q-card>
    </q-dialog>
</template>

<style>
.q-btn--round {
  color: white;
  background: none;
}
.row {
  margin-right: 0px;
}
</style>