<script setup lang="ts">
  import { ref, watch, toRefs, computed } from 'vue';
  import { useSettingsStore } from 'src/stores/settingsStore'
  const settingsStore = useSettingsStore()

  const props = defineProps<{
    nftName: string | undefined,
    srcNftImage: string,
    tokenId?: string,
    commitment?: string,
  }>()
  const { srcNftImage } = toRefs(props);
  const showIcon = ref(true)
  const emit = defineEmits(['closeDialog']);
  watch(showIcon, () => emit('closeDialog'))

  const httpsUrlTokenImage = computed(() => {
    const nftImageUri = srcNftImage.value;
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
          <q-btn icon="close" color="white" flat round dense v-close-popup/>
        </q-card-section>

        <q-card-section>
          <video v-if="httpsUrlTokenImage?.endsWith('.mp4')" id="tokenIcon" class="tokenIcon" style="width: 400px;" autoPlay loop muted :controls="false">
            <source :src="httpsUrlTokenImage" type="video/mp4" />
          </video>
          <img v-else style="width: 400px;" :src="httpsUrlTokenImage">
          <div class="text-h4 text-white" style="max-width: 400px;">{{ nftName }}</div>
          <div v-if="tokenId" class="text-h4 text-white" style="max-width: 400px; word-break: break-all; margin-top: 1rem;">TokenId: {{ tokenId }}</div>
          <div v-if="commitment" class="text-h4 text-white" style="max-width: 400px; word-break: break-all; margin-top: 1rem;">Commitment: {{ commitment }}</div>
        </q-card-section>
      </q-card>
    </q-dialog>
</template>

<style scoped>
.q-card{
  box-shadow: none;
  background: none;
}
.row {
  margin-right: 0px;
}
</style>