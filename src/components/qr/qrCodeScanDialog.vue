<script setup lang="ts">
  import { computed, defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue';
  import { type DetectedBarcode } from 'vue-qrcode-reader'
  import ScannerUI from 'components/qr/qrScannerUi.vue'
  import type { BarcodeScannerPlugin } from '@capacitor-community/barcode-scanner';
  import { caughtErrorToString } from 'src/utils/errorHandling';
  import { useI18n } from 'vue-i18n'

  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)
  const isCapacitor = (process.env.MODE == "capacitor");
  const { t } = useI18n()

  const props = defineProps<{
    filter?: (decoded: string) => string | true
  }>();

  const error = ref("");
  const frontCamera = ref(false);
  const filterHint = ref("");

  const showDialog = ref(true);
  const showScanner = ref(true);

  const QrcodeStream = !isCapacitor ? defineAsyncComponent(
    () => import('vue-qrcode-reader').then(m => m.QrcodeStream)
  ) : undefined;

  const emit = defineEmits(['hide', 'decode']);

  const onScannerError = (err: Error) => {
    if (err.name === 'NotAllowedError') {
      error.value = t('qrScanner.errors.permissionRequired');
    } else if (err.name === 'NotFoundError') {
      error.value = t('qrScanner.errors.noCamera');
    } else if (err.name === 'NotSupportedError') {
      error.value = t('qrScanner.errors.nonSecureContext');
    } else if (err.name === 'NotReadableError') {
      error.value = t('qrScanner.errors.unableToAccess');
    } else if (err.name === 'OverconstrainedError') {
      frontCamera.value = false;
      error.value = t('qrScanner.errors.constraintsMismatch');
    } else {
      error.value = t('qrScanner.errors.unknownError') + ': ' + err.message;
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

  let BarcodeScanner: BarcodeScannerPlugin | undefined;
  // TODO: investigate whether 'hideBackground' & 'showBackground' are best fire-and-forget or awaited
  const scanBarcode = async () => {
    try {
      if (!BarcodeScanner) return // should never happen
      void BarcodeScanner.hideBackground();

      // Request camera permission
      const status = await BarcodeScanner.checkPermission({ force: true });
      if (!status.granted) {
        error.value = t('qrScanner.errors.cameraPermissionRequired');
        return;
      }

      document.body.classList.add('scanner-active')
      document.body.classList.add('transparent-body')

      // Start scanning
      const result = await BarcodeScanner.startScan();
      // If a QR code is detected
      if (result.hasContent) {
        emit('decode', result.content);
      } else {
        error.value = t('qrScanner.errors.scanFailed');
      }

      // Restore background
      document.body.classList.remove('transparent-body')
      void BarcodeScanner.showBackground();
      document.body.classList.remove('scanner-active')
      await BarcodeScanner.stopScan();
      emit('hide')
      showDialog.value = false;
    } catch (err) {
      const errorMessage = caughtErrorToString(err)
      console.error("Scan error:", errorMessage);
      error.value = t('qrScanner.errors.errorScanning') + ' ' + errorMessage;
    }
  };

  function handleBeforeHide() {
    if(isCapacitor && BarcodeScanner) {
      document.body.classList.remove('transparent-body')
      void BarcodeScanner.showBackground();
      document.body.classList.remove('scanner-active')
    }

    emit('hide');
  } 

  onMounted(async() => {
    if(isCapacitor){
      if (!BarcodeScanner) {
      // Dynamically import the capacitor plugin so Vite can tree-shake it for web & electron builds
      const module = await import('@capacitor-community/barcode-scanner');
      BarcodeScanner = module.BarcodeScanner;
    }
    void scanBarcode();
    }
  });
  onUnmounted(() => {
    if(isCapacitor && BarcodeScanner) void BarcodeScanner.stopScan();
  });
</script>

<template>
  <q-dialog v-model="showDialog" transition-show="scale" transition-hide="scale" @before-hide="handleBeforeHide">
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
        <div v-if="showScanner" style="display: flex; height: 100%;">
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