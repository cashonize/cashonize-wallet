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
          <video v-if="httpsUrlTokenImage?.endsWith('.mp4')" style="width: 400px;" autoplay>
            <source :src="httpsUrlTokenImage" type="video/mp4" />
          </video>
          <q-img v-else style="width: 400px; max-width: 100%; max-height: 100%;" :src="httpsUrlTokenImage" />
          <div class="text-h4 text-white" style="max-width: 400px;">{{ nftName }}</div>
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