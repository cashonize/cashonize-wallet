<script setup lang="ts">
  // Camera scanning is qr-scanner's. Nothing in the media APIs asks for a phone's ordinary
  // wide lens: 'environment' resolves to whichever rear camera the browser lists first, which
  // on a multi-lens phone can be a telephoto or a macro, magnified and unable to focus on a
  // code held at arm's length. Only the user can tell which is which, hence the picker.
  import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
  import QrScanner from 'qr-scanner';
  import ScannerUI from 'components/qr/qrScannerUi.vue'
  import { caughtErrorToString } from 'src/utils/errorHandling';
  import { useI18n } from 'vue-i18n'
  import { useSettingsStore } from 'src/stores/settingsStore'

  import { useWindowSize } from 'src/utils/composables'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)
  const { t } = useI18n()
  const settingsStore = useSettingsStore()

  const props = defineProps<{
    filter?: (decoded: string) => string | true
  }>();

  const error = ref("");
  const filterHint = ref("");
  const showDialog = ref(true);
  const videoElement = ref<HTMLVideoElement | null>(null);
  const videoPlaying = ref(false);
  const fileInput = ref<HTMLInputElement | null>(null);
  const cameras = ref<QrScanner.Camera[]>([]);
  const activeCameraId = ref("");
  const switchingCamera = ref(false);

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

  async function handleError(err: Error | string) {
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
    } else if (errorObj.message === 'Camera not found.') {
      // qr-scanner catches every getUserMedia rejection and throws this one string instead,
      // so the reason has to be recovered here. A camera the browser still lists but will not
      // open is a refused permission in all but the rarest cases.
      const hasCamera = await QrScanner.hasCamera();
      error.value = hasCamera ? t('qrScanner.errors.permissionRequired') : t('qrScanner.errors.noCamera');
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
        // the library's own default is 25 and it never exceeds the camera's frame rate; this is
        // the throttle a handheld scan can afford while still catching a frame that is in focus
        maxScansPerSecond: 10,
        highlightScanRegion: false,
        highlightCodeOutline: false,
        preferredCamera: settingsStore.qrScannerCameraId || 'environment',
        calculateScanRegion: (video) => {
          // A centred square of the frame rather than the whole of it, downscaled for speed.
          // A share of the frame and not of the dialog on purpose: qr-scanner recalculates
          // this only on metadata and play, never on a resize or a rotation
          // (nimiq/qr-scanner#240). The preview is object-fit: cover, so the square can reach
          // past the edges of what is on screen, and the viewfinder must stay inside it.
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
      await handleError(err instanceof Error ? err : new Error(caughtErrorToString(err)));
      return;
    }
    // listing cameras is for the picker only; a browser that refuses to enumerate them must
    // not take down a scanner that is already running
    try {
      await loadCameras();
    } catch (err) {
      console.error('Could not list the available cameras', err);
    }
  }

  function runningCameraId() {
    const stream = videoElement.value?.srcObject;
    if (!(stream instanceof MediaStream)) return "";
    return stream.getVideoTracks()[0]?.getSettings().deviceId ?? "";
  }

  async function loadCameras() {
    // camera labels are only served once permission is granted, so this runs after start()
    cameras.value = await QrScanner.listCameras(true);
    const runningId = runningCameraId();
    activeCameraId.value = runningId;

    // A stored device id goes stale when the browser reissues them, and qr-scanner answers an
    // unavailable one by retrying without any camera preference at all, which hands back the
    // default camera: on a phone the front one. Ask for the rear camera again instead.
    const storedId = settingsStore.qrScannerCameraId;
    if (storedId && runningId && runningId !== storedId) {
      storeCameraId("");
      await scanner?.setCamera('environment');
      activeCameraId.value = runningCameraId();
    }
  }

  function storeCameraId(cameraId: string) {
    settingsStore.qrScannerCameraId = cameraId;
    if (cameraId) localStorage.setItem("qrScannerCameraId", cameraId);
    else localStorage.removeItem("qrScannerCameraId");
  }

  // No API tells us which way a camera points: getSettings().facingMode is absent on desktop
  // and on some Android browsers, and nothing else marks it. Reading the label is the same
  // fallback qr-scanner itself uses, rear winning over front when a label says both.
  function isFrontLabel(label: string) {
    if (/rear|back|environment/i.test(label)) return false;
    return /front|user|face/i.test(label);
  }

  function isFrontCamera(cameraId: string) {
    const stream = videoElement.value?.srcObject;
    const facingMode = stream instanceof MediaStream
      ? stream.getVideoTracks()[0]?.getSettings().facingMode
      : undefined;
    if (facingMode) return facingMode === 'user';
    return isFrontLabel(cameras.value.find((camera) => camera.id === cameraId)?.label ?? "");
  }

  // Most phones offer one rear camera and a selfie camera, and a QR scanner has no use for the
  // selfie one, so there is nothing to choose between and the picker stays out of the way. A
  // camera we cannot place counts as a real option, so unlabelled ones still get offered.
  const hasCameraChoice = computed(() => cameras.value.filter((camera) => !isFrontLabel(camera.label)).length > 1);

  async function selectCamera(cameraId: string) {
    // switching tears down the running stream before opening the next camera, so a second tap
    // arriving mid-switch would race the first one and can leave the video stopped
    if (!scanner || switchingCamera.value || cameraId === activeCameraId.value) return;
    switchingCamera.value = true;
    try {
      await scanner.setCamera(cameraId);
      activeCameraId.value = runningCameraId() || cameraId;
      // Remembering a front camera would make it the default for every later scan, and a
      // browser that reports no facing mode would not trip the check above either, so the
      // mistake would stick with no way back. A mirrored picture makes a mistap plain enough.
      if (!isFrontCamera(activeCameraId.value)) storeCameraId(activeCameraId.value);
    } catch (err) {
      // The old stream is already gone by now, so a camera that will not open leaves no
      // picture at all. Fall back to the rear camera rather than replacing the whole scanner
      // with an error the user can do nothing about but close.
      try {
        await scanner.setCamera('environment');
        activeCameraId.value = runningCameraId();
      } catch {
        await handleError(err instanceof Error ? err : new Error(caughtErrorToString(err)));
      }
    } finally {
      switchingCamera.value = false;
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
      <div v-if="hasCameraChoice" class="scanner-camera-picker">
        <q-btn
          v-for="(camera, index) in cameras"
          :key="camera.id"
          :label="String(index + 1)"
          :aria-label="t('qrScanner.switchCamera') + ' ' + (index + 1)"
          :class="{ 'camera-active': camera.id === activeCameraId }"
          :disable="switchingCamera"
          flat round dense
          @click="selectCamera(camera.id)"
        />
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
.scanner-camera-picker {
  position: absolute;
  bottom: 64px;
  left: 0;
  right: 0;
  margin: 0 auto;
  width: fit-content;
  display: flex;
  gap: 8px;
  z-index: 2001;
}
.scanner-camera-picker .q-btn {
  color: white;
  font-size: 13px;
  background: rgba(0, 0, 0, 0.45);
  border: 1px solid rgba(255, 255, 255, 0.25);
}
.scanner-camera-picker .camera-active {
  background: var(--color-primary);
  border-color: var(--color-primary);
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
