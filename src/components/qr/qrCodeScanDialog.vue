<script setup lang="ts">
  import { computed, onMounted, ref } from 'vue';
  import { QrcodeStream } from 'vue-qrcode-reader'
  import ScannerUI from 'components/qr/qrScannerUi.vue'
  import { BarcodeScanner } from '@capacitor-community/barcode-scanner';

  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)
  const isCapacitor = (process.env.MODE == "capacitor");

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

  const scanBarcode = async () => {
    try {
      document.body.classList.add('transparent-body')

      // Request camera permission
      const status = await BarcodeScanner.checkPermission({ force: true });
      if (!status.granted) {
        error.value = "Camera permission required";
        return;
      }

      // Hide background for better camera display
      BarcodeScanner.hideBackground();

      // Start scanning
      const result = await BarcodeScanner.startScan();
      // If a QR code is detected
      if (result.hasContent) {
        emit('decode', result.content);
      } else {
        error.value = "Scan failed, try again.";
      }

      // Restore background
      await BarcodeScanner.stopScan();
      document.body.classList.remove('transparent-body')
      BarcodeScanner.showBackground();
      emit('hide')
      showDialog.value = false;
    } catch (err) {
      console.error("Scan error:", err);
      error.value = "Error scanning barcode: " + err.message;
    }
  };

  async function handleBeforeHide() {
    if(isCapacitor) {
      await BarcodeScanner.stopScan();
      document.body.classList.remove('transparent-body')
      BarcodeScanner.showBackground();
    }

    emit('hide');
  } 

  onMounted(() => {
    if(isCapacitor) scanBarcode();
  });
</script>

<template>
  <q-dialog v-model="showDialog" transition-show="scale" transition-hide="scale" @before-hide="handleBeforeHide">
    <div v-if="error" class="scanner-error-dialog text-center bg-red-1 text-red q-pa-md">
      <q-icon name="error" left/>
      {{ error }}
    </div>
    <q-card v-else :style="isMobile ? 'width: 100%; height: 100%;' : 'width: 75%; height: 75%;'">
      <qrcode-stream
           v-if="!isCapacitor"
          :formats="['qr_code']"
          @detect="onScannerDecode"
          @init="onScannerInit"
          :style="{
            position: 'absolute',
            inset: 0,
            padding: '0.75rem',
            overflow: 'hidden'
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
body.transparent-body.dark {
  border: var(--vt-c-black) calc(6.125vw) solid;
}
body.transparent-body {
  background-color: transparent;
  border: var(--color-background-soft) calc(6.125vw) solid;
}
.transparent-body fieldset {
  display: none;
}
.transparent-body header {
  visibility: hidden;
}
.transparent-body .q-card {
  background: transparent !important;
}
</style>