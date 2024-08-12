<script setup lang="ts">
  import { computed, ref } from 'vue';
  import { QrcodeStream } from 'vue-qrcode-reader'
  import ScannerUI from 'components/qr/qrScannerUi.vue'

  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const props = defineProps<{
    filter?: (decoded: string) => string | true
  }>();

  const error = ref("");
  const frontCamera = ref(false);
  const filterHint = ref("");

  const showDialog = ref(true);

  const CameraPermissionErrMsg1 = "Permission required to access the camera";
  const CameraPermissionErrMsg2 = "No camera found on this device";
  const CameraPermissionErrMsg3 = "Unable to acccess camera in non-secure context";
  const CameraPermissionErrMsg4 = "Unable to access camera";
  const CameraPermissionErrMsg5 = "Constraints don\"t match any installed camera. Did you ask for the front camera although there is none?";
  const UnknownErrorOccurred = "Unknown error occurred";

  const emit = defineEmits(['hide', 'decode']);

  const onScannerError = (err: Error) => {
    if (err.name === 'NotAllowedError') {
      error.value = CameraPermissionErrMsg1;
    } else if (err.name === 'NotFoundError') {
      error.value = CameraPermissionErrMsg2;
    } else if (err.name === 'NotSupportedError') {
      error.value = CameraPermissionErrMsg3;
    } else if (err.name === 'NotReadableError') {
      error.value = CameraPermissionErrMsg4;
    } else if (err.name === 'OverconstrainedError') {
      frontCamera.value = false;
      error.value = CameraPermissionErrMsg5;
    } else {
      error.value = UnknownErrorOccurred + ': ' + err.message;
    }
  }
  const onScannerInit = (promise: Promise<any>)  => {
    promise
      .then(() => {
        error.value = '';
      })
      .catch(error => {
        onScannerError(error);
      })
  }
  const onScannerDecode = (content: any) => {
    console.log(content[0].rawValue);
    if (!props?.filter) {
      emit('decode', content[0].rawValue);
      showDialog.value = false;
    } else {
      const filterResult = props.filter(content[0].rawValue);
      if (filterResult === true) {
        emit('decode', content[0].rawValue);
        showDialog.value = false;
      } else {
        filterHint.value = filterResult;
      }
    }
  }
</script>

<template>
  <q-dialog v-model="showDialog" transition-show="scale" transition-hide="scale" @hide="emit('hide')">
    <div v-if="error" class="scanner-error-dialog text-center bg-red-1 text-red q-pa-md">
      <q-icon name="error" left/>
      {{ error }}
    </div>
    <q-card v-else :style="isMobile ? 'width: 100%; height: 100%;' : 'width: 75%; height: 75%;'">
      <qrcode-stream
          :formats="['qr_code']"
          :camera="frontCamera ? 'front': 'auto'"
          :constraints="{
            video: {
              width: { min: 1080 },
              height: { min: 1080 },
              aspectRatio: { ideal: 1 },
              frameRate: { min: 20 }
            }
          }"
          @detect="onScannerDecode"
          @init="onScannerInit"
          :style="{
            position: 'absolute',
            inset: 0,
            padding: '0.75rem'
          }"
          @error="onScannerError"
        />
        <div style="display: flex; height: 100%;">
          <ScannerUI :filter-hint="filterHint" />
        </div>
    </q-card>
  </q-dialog>
</template>

<style>
div:has(> video#video) {
  display: none;
}
</style>