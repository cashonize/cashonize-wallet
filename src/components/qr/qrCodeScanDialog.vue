<script setup lang="ts">
  import { computed, defineAsyncComponent, onMounted, ref } from 'vue'
  import { type DetectedBarcode } from 'vue-qrcode-reader'
  import ScannerUI from 'components/qr/qrScannerUi.vue'
  import type { CapacitorBarcodeScanner } from '@capacitor/barcode-scanner'
  import { caughtErrorToString } from 'src/utils/errorHandling';
  import { useWindowSize } from '@vueuse/core'

  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)
  const isCapacitor = (process.env.MODE == "capacitor");

  const props = defineProps<{
    filter?: (decoded: string) => string | true
  }>();

  const error = ref("");
  const filterHint = ref("");

  const showDialog = ref(true);

  const QrcodeStream = !isCapacitor ? defineAsyncComponent(
    () => import('vue-qrcode-reader').then(m => m.QrcodeStream)
  ) : undefined;

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
      error.value = CameraPermissionErrMsg5;
    } else {
      error.value = UnknownErrorOccurred + ': ' + err.message;
    }
  }
  const onScannerDecode = (content: DetectedBarcode[]) => {
    const decoded = content[0]!.rawValue;
    if (!props?.filter) {
      emit('decode', decoded);
      showDialog.value = false;
    } else {
      const filterResult = props.filter(decoded);
      if (filterResult === true) {
        emit('decode', decoded);
        showDialog.value = false;
      } else {
        filterHint.value = filterResult;
      }
    }
  }

  let capacitorBarcodeScanner: {
    scanBarcode: (typeof CapacitorBarcodeScanner)['scanBarcode']
  } | undefined

  const scanBarcode = async () => {
    if (!capacitorBarcodeScanner) return
    try {
      // plugin handles hideBackground / permission internally

      const QR_CODE = 0; // Html5QrcodeSupportedFormats.QR_CODE
      const result = await capacitorBarcodeScanner.scanBarcode({
        hint: QR_CODE,
        scanButton: true,
      })

      if (result?.ScanResult) {
        const decoded = result.ScanResult
        if (!props.filter) {
          emit('decode', decoded)
        } else {
          const filterResult = props.filter(decoded)
          if (filterResult === true) emit('decode', decoded)
          else filterHint.value = filterResult
        }
        showDialog.value = false
        emit('hide')
      } else {
        error.value = "Scan failed, try again.";
      }
    } catch (err) {
      const errorMessage = caughtErrorToString(err)
      error.value = "Error scanning barcode: " + errorMessage;
    }
  };

  onMounted(async() => {
    if(isCapacitor){
      const module = await import('@capacitor/barcode-scanner');
      // Dynamically import the capacitor plugin so Vite can tree-shake it for web & electron builds
      capacitorBarcodeScanner = module.CapacitorBarcodeScanner;
      scanBarcode();
    }
  });
</script>

<template>
  <q-dialog v-model="showDialog" transition-show="scale" transition-hide="scale" @before-hide="() => emit('hide')">
    <div v-if="error" class="scanner-error-dialog text-center bg-red-1 text-red q-pa-md">
      <q-icon name="error" left/>
      {{ error }}
    </div>
    <q-card v-else :style="isMobile ? 'width: 100%; height: 100%;' : 'width: 75%; height: 75%;'">
      <component :is="QrcodeStream"
          v-if="!isCapacitor"
          :formats="['qr_code']"
          @detect="onScannerDecode"
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
body.transparent-body {
  background-color: transparent;
}
body.transparent-body.dark {
  border: var(--vt-c-black) calc(6.125vw) solid;
}
body.transparent-body {
  border: var(--color-background-soft) calc(6.125vw) solid;
}
.scanner-active fieldset {
  display: none;
}
.scanner-active header {
  visibility: hidden;
}
.transparent-body .q-card{
  background: transparent !important;
}
.transparent-body .q-dialog__backdrop {
  backdrop-filter: none !important;
}
</style>