<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { useQuasar } from 'quasar';
  import { storeToRefs } from 'pinia';
  import { useI18n } from 'vue-i18n'
  import { useStore } from 'src/stores/store'
  import { useWalletconnectStore } from 'src/stores/walletconnectStore'
  import { useCashconnectStore } from 'src/stores/cashconnectStore';
  import { useWizardconnectStore } from 'src/stores/wizardconnectStore';
  import { waitForInitialized } from 'src/utils/utils'
  import QrCodeDialog from './qr/qrCodeScanDialog.vue';
  import { PROTOCOL_HANDLER as CASHCONNECT_PROTOCOL_HANDLER } from '@cashconnect-js/nostr';

  // Components.
  import WCSessions from 'src/components/walletconnect/WCSessions.vue'
  import CCSessions from 'src/components/cashconnect/CCSessions.vue'
  import WizSessions from 'src/components/wizardconnect/WizSessions.vue'
  import { useSettingsStore } from 'src/stores/settingsStore';
  import { caughtErrorToString } from 'src/utils/errorHandling';

  const $q = useQuasar();
  const store = useStore()
  const settingsStore = useSettingsStore();
  const { t } = useI18n()

  const walletconnectStore = useWalletconnectStore()
  const web3wallet = walletconnectStore.web3wallet
  const cashconnectStore = useCashconnectStore();
  const wizardconnectStore = useWizardconnectStore();

  // Props.
  const props = defineProps<{
    dappUriUrlParam: string | undefined
  }>()

  // Component references.
  const walletconnectRef = ref<InstanceType<typeof WCSessions> | null>(null);
  const cashconnectRef = ref<InstanceType<typeof CCSessions> | null>(null);
  const wizardconnectRef = ref<InstanceType<typeof WizSessions> | null>(null);

  // State.
  const dappUriInput = ref("");
  const showQrCodeDialog = ref(false);

  // Single shared empty state for the unified sessions box (the per-method
  // sections in the child components hide themselves when empty)
  const hasNoSessions = computed(() =>
    !Object.keys(walletconnectStore.activeSessions ?? {}).length &&
    !Object.keys(cashconnectStore.sessions).length &&
    !Object.keys(wizardconnectStore.connections).length
  );

  // WizardConnect requires an HD wallet (see wizardconnectStore.pair)
  const isHdWallet = computed(() => settingsStore.getWalletType(store.activeWalletName) === 'hd');

  // Handle Props.
  function isSessionRequest(uri: string): boolean {
    // Check if the URI contains the `?requestId=` parameter, which indicates a signing request
    const isSigningRequest = uri.includes("?requestId=");
    return !isSigningRequest;
  }

  async function checkDappUriUrlParam(){
    if(props.dappUriUrlParam?.startsWith('wc:') && isSessionRequest(props.dappUriUrlParam)){
      try {
        await web3wallet?.core.pairing.pair({ uri: props.dappUriUrlParam });
      } catch (error) {
        console.error("Error pairing URI:", error);
      }
    }
    if(props.dappUriUrlParam?.startsWith(CASHCONNECT_PROTOCOL_HANDLER)){
      try {
        const { dappConnectionStoresInitialized } = storeToRefs(store);
        await waitForInitialized(dappConnectionStoresInitialized);
        await cashconnectStore?.pair(props.dappUriUrlParam);
      } catch(error) {
        const errorMessage = caughtErrorToString(error);
        console.error(errorMessage);
        $q.notify({
          message: errorMessage,
          icon: 'warning',
          color: 'negative'
        });
      }
    }
    if(props.dappUriUrlParam?.toLowerCase().startsWith('wiz:')){
      const { dappConnectionStoresInitialized } = storeToRefs(store);
      await waitForInitialized(dappConnectionStoresInitialized);
      try {
        await wizardconnectStore.pair(props.dappUriUrlParam);
      } catch (error) {
        console.error("Error pairing WizardConnect URI:", error);
      }
    }
  }
  // Check for dappUriUrlParam on component mount and watch for changes.
  await checkDappUriUrlParam()
  watch(props, async() => {
    await checkDappUriUrlParam()
  })

  // Methods.
  async function connectDappUriInput(dappUri: string) {
    try {
      // Promise will wait for state indicating whether the dapp connection stores are initialized
      const { dappConnectionStoresInitialized } = storeToRefs(store);
      await waitForInitialized(dappConnectionStoresInitialized);

      // If the URI begins with "wc:" (walletconnect)...
      if(dappUri.startsWith('wc:')) {
        await walletconnectRef.value?.connectDappUriInput(dappUri);
      }

      // Otherwise, if the URI begins with "bch-cc-v1:" (cashconnect v1)...
      else if (dappUri.startsWith(CASHCONNECT_PROTOCOL_HANDLER)) {
        await cashconnectRef.value?.connectDappUriInput(dappUri);
      }

      // Otherwise, if the URI begins with "wiz:" (wizardconnect)...
      // The case-insensitive check is deliberate: WizardConnect QR codes use an
      // uppercased alphanumeric-mode form (WIZ://...)
      else if (dappUri.toLowerCase().startsWith('wiz:')) {
        await wizardconnectRef.value?.connectDappUriInput(dappUri);
      }

      // Otherwise, if it does not match CC, WC or WIZ, throw an error.
      else {
        throw new Error(t('dapp.errors.invalidUri'));
      }

      // Clear the input.
      dappUriInput.value = '';
    } catch(error) {
      const errorMessage = caughtErrorToString(error)
      console.error(errorMessage)
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: 'negative'
      })
    }
  }

  const qrDecode = async (content: string) => {
    await connectDappUriInput(content)
  }
  const qrFilter = (content: string) => {
    const matchWalletConnect = String(content).match(/^wc:([0-9a-fA-F]{64})@(\d+)\?([a-zA-Z0-9\-._~%!$&'()*+,;=:@/?=&]*)$/i);
    const matchCashConnect = content.startsWith(CASHCONNECT_PROTOCOL_HANDLER);
    // WizardConnect QR codes use an uppercased, percent-escaped alphanumeric-mode form
    // (WIZ://%3FP%3D...), so only the scheme is matched here; the full URI is validated on pairing
    const matchWizardConnect = String(content).match(/^wiz:\/\//i);

    if (!matchWalletConnect && !matchCashConnect && !matchWizardConnect) {
      return t('dapp.errors.notValidUri');
    }
    return true;
}
</script>

<template>
    <fieldset class="item">
      <legend>{{ t('dapp.title') }}</legend>
      <div style="margin-bottom: 10px;">
        <!-- WizardConnect requires an HD wallet, so the listed connection methods depend on the wallet type -->
        <i18n-t :keypath="isHdWallet ? 'dapp.exploreText' : 'dapp.exploreTextSingleAddress'" tag="span">
          <template #link>
            <a href="https://tokenaut.cash/dapps" target="_blank">Tokenaut.cash</a>
          </template>
        </i18n-t>
      </div>
      <div style="display: flex; gap: 0.5rem; ">
        <input @keyup.enter="() => connectDappUriInput(dappUriInput)" v-model="dappUriInput" :placeholder="t('dapp.uriPlaceholder')" style="margin-bottom: 10px;">
        <button v-if="settingsStore.qrScan" @click="() => showQrCodeDialog = true" style="padding: 12px; height: 43px;">
          <img src="images/qrscan.svg" />
        </button>
      </div>
      <div style="display: flex; flex-wrap: wrap; justify-content: center; gap: 2rem; margin-bottom: 5px">
        <input @click="() => connectDappUriInput(dappUriInput)" type="button" class="primaryButton" :value="t('dapp.connectButton')">
      </div>
    </fieldset>

    <fieldset class="item">
      <legend>{{ t('dapp.sessionsTitle') }}</legend>
      <WCSessions ref="walletconnectRef"/>
      <CCSessions ref="cashconnectRef" />
      <WizSessions ref="wizardconnectRef" />
      <div v-if="hasNoSessions" class="q-pa-md">{{ t('dapp.noActiveSessions') }}</div>
    </fieldset>

    <div v-if="showQrCodeDialog">
      <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
    </div>
</template>

<style>
  /* Shared heading style for the per-method sections rendered by the child components */
  .sessions-section-heading {
    font-weight: 600;
    margin: 8px 0 2px;
  }
</style>
