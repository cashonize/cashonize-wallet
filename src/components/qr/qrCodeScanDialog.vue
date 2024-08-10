<script setup lang="ts">
  import { computed, onBeforeUnmount, onDeactivated, onMounted, ref } from 'vue';
  import { useStore } from 'src/stores/store'
  import { useQuasar } from 'quasar'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { BarcodeScanner, SupportedFormat } from '@capacitor-community/barcode-scanner';
  import { QrcodeStream } from 'vue-qrcode-reader'
  import ScannerUI from 'components/qr/qrScannerUi.vue'

  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const props = defineProps<{
    filter?: (decoded: string) => boolean
  }>();

  const error = ref("");
  const frontCamera = ref(false);

  const showDialog = ref(true);

  const CameraPermissionErrMsg1 = "Permission required to access the camera";
  const CameraPermissionErrMsg2 = "No camera found on this device";
  const CameraPermissionErrMsg3 = "Unable to acccess camera in non-secure context";
  const CameraPermissionErrMsg4 = "Unable to access camera";
  const CameraPermissionErrMsg5 = "Constraints don\"t match any installed camera. Did you ask for the front camera although there is none?";
  const UnknownErrorOccurred = "Unknown error occurred";

  const emit = defineEmits(['hide', 'decode']);

  const stopScan = () => {
    BarcodeScanner.showBackground();
    BarcodeScanner.stopScan();
  }
  const prepareScanner = async () => {
    const status = await checkPermission();
    if (status) {
      BarcodeScanner.prepare();
      scanBarcode();
    }
  }
  const scanBarcode = async () => {
    BarcodeScanner.hideBackground();

    const res = await BarcodeScanner.startScan({ targetedFormats: [SupportedFormat.QR_CODE] });

    if (res.content) {
      BarcodeScanner.showBackground();
      emit('decode', res.content);
      showDialog.value = false;
    }
  }
  const checkPermission = async () => {
    const status = await BarcodeScanner.checkPermission({ force: false });
    // console.log('PERMISSION STATUS: ', JSON.stringify(status))

    if (status.granted) {
      // user granted permission
      return true;
    }

    if (status.denied) {
      // user denied permission
      return false;
    }

    if (status.asked) {
      // system requested the user for permission during this call
      // only possible when force set to true
      BarcodeScanner.openAppSettings();
    }

    if (status.neverAsked) {
      // user has not been requested this permission before
      // it is advised to show the user some sort of prompt
      // this way you will not waste your only chance to ask for the permission
      // const c = confirm('We need your permission to use your camera to be able to scan QR codes')
      BarcodeScanner.openAppSettings();
    }

    if (status.restricted || status.unknown) {
      // ios only
      // probably means the permission has been denied
      return false;
    }

    // user has not denied permission
    // but the user also has not yet granted the permission
    // so request it
    const statusRequest = await BarcodeScanner.checkPermission({ force: true })
    // console.log('PERMISSION STATUS 2: ', JSON.stringify(statusRequest))

    if (statusRequest.asked) {
      // system requested the user for permission during this call
      // only possible when force set to true
      if (statusRequest.granted) {
        return true;
      } else {
        return false;
      }
    }

    if (statusRequest.granted) {
      // the user did grant the permission now
      return true;
    }

    // user did not grant the permission, so he must have declined the request
    return false;
  }
  // DESKTOP
  const onScannerDecode = (content: any) => {
    console.log(content[0].rawValue);
    if (!props?.filter) {
      emit('decode', content[0].rawValue);
      showDialog.value = false;
    } else {
      if (props.filter(content[0].rawValue)) {
        emit('decode', content[0].rawValue);
        showDialog.value = false;
      }
    }
  }
  const onScannerError = (err: Error) => {
    console.log(err);
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
  onMounted(() => {
    prepareScanner();
  });
  onDeactivated(() => {
    stopScan();
  });
  onBeforeUnmount(() => {
    stopScan();
  });
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
          <ScannerUI />
        </div>
    </q-card>
  </q-dialog>
</template>

<style>
div:has(> video#video) {
  display: none;
}
</style>