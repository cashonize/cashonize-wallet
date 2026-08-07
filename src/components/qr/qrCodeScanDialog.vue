<script setup lang="ts">
  import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
  import QrScanner from 'qr-scanner';
  import ScannerUI from 'components/qr/qrScannerUi.vue'
  import { caughtErrorToString } from 'src/utils/errorHandling';
  import { useI18n } from 'vue-i18n'

  import { useWindowSize } from 'src/utils/composables'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)
  const { t } = useI18n()

  const props = defineProps<{
    filter?: (decoded: string) => string | true
  }>();

  const error = ref("");
  const filterHint = ref("");
  const showDialog = ref(true);
  const videoElement = ref<HTMLVideoElement | null>(null);
  const videoPlaying = ref(false);
  const fileInput = ref<HTMLInputElement | null>(null);

  let scanner: QrScanner | null = null;
  let didDecode = false;

  const emit = defineEmits(['hide', 'decode']);

  function handleDecode(result: QrScanner.ScanResult) {
    if (didDecode) return;
    const decoded = result.data;
    if (!props?.filter) {
      didDecode = true;
      scanner?.stop();
      emit('decode', decoded);
      showDialog.value = false;
    } else {
      const filterResult = props.filter(decoded);
      if (filterResult === true) {
        didDecode = true;
        scanner?.stop();
        emit('decode', decoded);
        showDialog.value = false;
      } else {
        filterHint.value = filterResult;
      }
    }
  }

  function handleError(err: Error | string) {
    const errorObj = typeof err === 'string' ? new Error(err) : err;
    // qr-scanner emits "No QR code found" on every non-detecting frame; ignore it
    if (errorObj.message === 'No QR code found') return;

    if (errorObj.name === 'NotAllowedError') {
      error.value = t('qrScanner.errors.permissionRequired');
    } else if (errorObj.name === 'NotFoundError') {
      error.value = t('qrScanner.errors.noCamera');
    } else if (errorObj.name === 'NotSupportedError') {
      error.value = t('qrScanner.errors.nonSecureContext');
    } else if (errorObj.name === 'NotReadableError') {
      error.value = t('qrScanner.errors.unableToAccess');
    } else if (errorObj.name === 'OverconstrainedError') {
      error.value = t('qrScanner.errors.constraintsMismatch');
    } else {
      error.value = t('qrScanner.errors.unknownError') + ': ' + errorObj.message;
    }
  }

  async function initScanner() {
    if (scanner || !videoElement.value) return;

    scanner = new QrScanner(
      videoElement.value,
      handleDecode,
      {
        returnDetailedScanResult: true,
        maxScansPerSecond: 4,
        highlightScanRegion: false,
        highlightCodeOutline: false,
        preferredCamera: 'environment',
        calculateScanRegion: (video) => {
          // Crop to center region and downscale for performance (from Selene MR #241)
          const smallestDimension = Math.min(video.videoWidth, video.videoHeight);
          const scanSize = Math.round(smallestDimension * 0.8);
          const downScaled = Math.min(scanSize, 480);
          return {
            x: Math.round((video.videoWidth - scanSize) / 2),
            y: Math.round((video.videoHeight - scanSize) / 2),
            width: scanSize,
            height: scanSize,
            downScaledWidth: downScaled,
            downScaledHeight: downScaled,
          };
        },
      }
    );
    scanner.setInversionMode('both');

    try {
      await scanner.start();
    } catch (err) {
      handleError(err instanceof Error ? err : new Error(caughtErrorToString(err)));
    }
  }

  function openImagePicker() {
    fileInput.value?.click();
  }

  async function handleImageSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    // reset so selecting the same file again re-triggers the change event
    input.value = '';
    if (!file) return;
    let result: QrScanner.ScanResult;
    try {
      result = await QrScanner.scanImage(file, { returnDetailedScanResult: true });
    } catch (err) {
      // the library rejects with "No QR code found" when the image has no readable QR;
      // anything else (worker load failure, unreadable file) should surface as-is
      const message = caughtErrorToString(err);
      filterHint.value = message.includes('No QR code found') ? t('qrScanner.noQrCodeInImage') : message;
      return;
    }
    handleDecode(result);
  }

  // Use watch to handle cases where the video ref isn't available at onMounted
  // (QDialog portal/transition timing can delay ref binding)
  watch(videoElement, (el) => {
    if (el && !scanner) void initScanner();
  });

  onMounted(async () => {
    await nextTick();
    void initScanner();
  });

  onUnmounted(() => {
    scanner?.destroy();
    scanner = null;
  });

  function handleBeforeHide() {
    scanner?.stop();
    emit('hide');
  }
</script>

<template>
  <q-dialog v-model="showDialog" class="scanner-dialog" transition-show="fade" transition-hide="fade" @before-hide="handleBeforeHide">
    <div v-if="error" class="scanner-error-dialog text-center bg-red-1 text-red q-pa-md">
      <div>
        <q-icon name="error" left/>
        {{ error }}
      </div>
      <q-btn class="q-mt-md" color="primary" icon="image" :label="t('qrScanner.chooseImage')" no-caps @click="openImagePicker" />
      <div v-if="filterHint" class="q-mt-sm">{{ filterHint }}</div>
      <input ref="fileInput" type="file" accept="image/*" style="display: none;" @change="handleImageSelected">
    </div>
    <q-card v-else class="scanner-card" :style="isMobile ? 'width: 100%; height: 100%;' : 'width: 75%; height: 75%;'">
      <video
        ref="videoElement"
        class="scanner-video"
        :class="{ 'video-ready': videoPlaying }"
        autoplay muted playsinline
        webkit-playsinline
        @playing="videoPlaying = true"
        @pause="videoPlaying = false"
      />
      <div style="display: flex; height: 100%;">
        <ScannerUI :filter-hint="filterHint" />
      </div>
      <q-btn class="scanner-close-btn" icon="close" color="white" flat round dense v-close-popup />
      <q-btn class="scanner-upload-btn" icon="image" :label="t('qrScanner.chooseImage')" no-caps flat rounded dense @click="openImagePicker" />
      <input ref="fileInput" type="file" accept="image/*" style="display: none;" @change="handleImageSelected">
    </q-card>
  </q-dialog>
</template>

<style scoped>
.scanner-card {
  position: relative;
  overflow: hidden;
  /* black viewfinder while the camera starts up */
  background-color: #000;
}
.scanner-video {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  /* Hide until camera frames arrive — prevents Android WebView play button flash */
  opacity: 0;
}
.scanner-video.video-ready {
  opacity: 1;
}
/* z-index 2001 puts the buttons above the scanner-box overlay shadow (z-index 2000) */
.scanner-close-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 2001;
  font-size: 14px;
  background: rgba(0, 0, 0, 0.45);
}
.scanner-upload-btn {
  position: absolute;
  bottom: 20px;
  /* centered with auto margins instead of translateX, because the global
     button:active scale transform would replace a transform while pressed */
  left: 0;
  right: 0;
  margin: 0 auto;
  width: fit-content;
  z-index: 2001;
  font-size: 13px;
  padding: 4px 14px;
  color: white;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.25);
}
</style>

<style>
/* Backdrop blur interferes with the camera video compositing on mobile, so disable
   it there; desktop keeps the blurred backdrop like other dialogs */
body.mobile .scanner-dialog .q-dialog__backdrop {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}
</style>
