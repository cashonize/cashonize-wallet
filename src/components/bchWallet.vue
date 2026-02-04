<script setup lang="ts">
  import { ref, computed, watch, shallowRef } from 'vue'
  import { convert, toBch, ExchangeRate } from 'mainnet-js'
  import { decodeCashAddress } from "@bitauth/libauth"
  import alertDialog from 'src/components/general/alertDialog.vue'
  import { CurrencySymbols, CurrencyShortNames, type QrCodeElement } from 'src/interfaces/interfaces'
  import { copyToClipboard, formatFiatAmount, convertToCurrency } from 'src/utils/utils';
  import { parseBip21Uri, isBip21Uri, getBip21ValidationError } from 'src/utils/bip21';
  import { useStore } from '../stores/store'
  import { useSettingsStore } from '../stores/settingsStore'
  import { useQuasar } from 'quasar'
  import { useI18n } from 'vue-i18n'
  import QrCodeDialog from './qr/qrCodeScanDialog.vue';

  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  const { t } = useI18n()

  const props = defineProps<{
    bchSendRequest: string | undefined
  }>()

  const numberFormatter = new Intl.NumberFormat('en-US', {maximumFractionDigits: 8});

  // Prefetch exchange rate for the selected fiat currency
  const exchangeRate = ref<number | undefined>(undefined);
  async function fetchExchangeRate() {
    exchangeRate.value = await ExchangeRate.get(settingsStore.currency, true);
  }
  void fetchExchangeRate();
  watch(() => settingsStore.currency, () => void fetchExchangeRate());

  // reactive state
  const displayBchQr = ref(true);
  const bchSendAmount = ref(undefined as (number | undefined));
  const currencySendAmount = ref(undefined as (number | undefined));
  const destinationAddr = ref("");
  const showQrCodeDialog = ref(false);
  const isSending = ref(false);
  // We keep the <qr-code> element in a ref so that we can call animateQrCode on codeRendered()
  // This event handler calls the animation after rendering the qr-code web component
  // Consecutive animations are only triggered when addressQrcode changes as reactive property of the qr-code
  // Using shallowRef avoids Vue’s deep reactivity re-activation when re-navigating to this view
  // This speeds up the rendering of the component
  const qrCodeRef = shallowRef<QrCodeElement | null>(null);

  const addressQrcode = computed(() => displayBchQr.value ? store.wallet.getDepositAddress() : store.wallet.getTokenDepositAddress())

  const bchDisplayNetwork = computed(() => {
    return (store.network == "mainnet") ? 'BCH' : 'tBCH'
  })
  const bchDisplayUnit = computed(() => {
    if(store.network == "mainnet") return settingsStore.bchUnit == "bch"? " BCH" : " sats"
    else return settingsStore.bchUnit == "bch"? " tBCH" : " tsats"
  })
  const displayUnitLong = computed(() => {
    if(store.network == "mainnet") return settingsStore.bchUnit == "bch"? " BCH" : " satoshis"
    else return settingsStore.bchUnit == "bch"? " tBCH" : " testnet satoshis"
  })
  const displayCurrencyBalance = computed(() => {
    if (exchangeRate.value === undefined || store.balance === undefined) return '';
    const balance = convertToCurrency(store.balance, exchangeRate.value);
    return formatFiatAmount(balance, settingsStore.currency);
  });
  const currencyDisplayShortName = computed(() => {
    return (store.network == "mainnet" ? "" : "t") + CurrencyShortNames[settingsStore.currency];
  });
  const balanceInBchUnit = computed(() => {
    if (store.balance === undefined) return undefined;
    const sats = Number(store.balance);
    return settingsStore.bchUnit === 'sat' ? sats : sats / 100_000_000;
  });
  const maxAmountToSendInBchUnit = computed(() => {
    if (store.maxAmountToSend === undefined) return undefined;
    const sats = Number(store.maxAmountToSend);
    return settingsStore.bchUnit === 'sat' ? sats : sats / 100_000_000;
  });

  // handle props
  if(props.bchSendRequest?.startsWith('bitcoincash:')){
    destinationAddr.value = props.bchSendRequest
    parseAddrParams()
  }
  watch(props, () => {
    if(props.bchSendRequest?.startsWith('bitcoincash:')){
      destinationAddr.value = props.bchSendRequest
      parseAddrParams()
    }
  })

  // general functions
  const animateQrCode = () => {
    if (qrCodeRef.value && !settingsStore.hasPlayedAnimation && settingsStore.qrAnimation != 'None') {
      qrCodeRef.value.animateQRCode(settingsStore.qrAnimation);
      settingsStore.hasPlayedAnimation = true;
    }
  };
  function switchAddressTypeQr(){
    displayBchQr.value = !displayBchQr.value;
    settingsStore.hasPlayedAnimation = false;
  }
  function parseAddrParams(){
    const addressInput = destinationAddr.value;
    if(!isBip21Uri(addressInput) || !addressInput.includes("?")) return;

    // Parse BIP21 URIs with query params (e.g. bitcoincash:qz...?amount=1&label=Shop)
    try {
      const parsed = parseBip21Uri(addressInput);

      const validationError = getBip21ValidationError(parsed);
      if (validationError) {
        $q.notify({ message: validationError, icon: 'warning', color: "red" });
        return;
      }

      // Warn if this is a CashToken payment request (has c= param)
      if(parsed.otherParams?.c){
        $q.notify({ message: t('wallet.errors.tokenPaymentRequest'), icon: 'warning', color: "grey-7" });
        return;
      }

      // Set the address (without query params)
      destinationAddr.value = parsed.address;

      // Set the amount if present
      if(parsed.amount !== undefined){
        let bchAmount = parsed.amount;
        if(settingsStore.bchUnit == "sat") bchAmount = Math.round(bchAmount * 100_000_000);
        bchSendAmount.value = bchAmount;
        void setCurrencyAmount();
      }
    } catch {
      // If parsing fails, leave the input as-is for manual handling
    }
  }
  async function setCurrencyAmount() {
    if(typeof bchSendAmount.value != 'number'){
      currencySendAmount.value = undefined
      return
    }
    const newCurrencyValue = await convert(bchSendAmount.value, settingsStore.bchUnit, settingsStore.currency);
    currencySendAmount.value = Number(newCurrencyValue.toFixed(2));
  }
  async function setBchAmount() {
    if(typeof currencySendAmount.value != 'number'){
      bchSendAmount.value = undefined
      return
    }
    const newBchValue = await convert(currencySendAmount.value, settingsStore.currency, settingsStore.bchUnit);
    bchSendAmount.value = Number(newBchValue);
  }
  async function useMaxBchAmount() {
    if(store.maxAmountToSend && store.balance){
      bchSendAmount.value = await convert(Number(store.maxAmountToSend), "sat", settingsStore.bchUnit);
      // update currency balance & set currency amount
      if (exchangeRate.value !== undefined) {
        currencySendAmount.value = convertToCurrency(store.maxAmountToSend, exchangeRate.value);
      }
    }
    else{
      $q.notify({
        message: t('wallet.errors.noBalance'),
        icon: 'warning',
        color: "grey-7"
      })
    }
  }
  async function sendBch(){
    if (isSending.value) return;
    isSending.value = true;
    try{
      // check for valid inputs
      if(!destinationAddr.value) throw(t('wallet.errors.noDestination'))
      if(!bchSendAmount.value) throw(t('wallet.errors.noAmount'))
      if(bchSendAmount.value > toBch(store.maxAmountToSend ?? 0n)) throw(t('wallet.errors.insufficientFunds'))
      if(!destinationAddr.value.startsWith("bitcoincash:") && !destinationAddr.value.startsWith("bchtest:")){
        const networkPrefix = store.network == 'mainnet' ? "bitcoincash:" : "bchtest:"
        destinationAddr.value = networkPrefix + destinationAddr.value
      }
      const decodedAddress = decodeCashAddress(destinationAddr.value)
      if(typeof decodedAddress == 'string') throw(t('wallet.errors.invalidAddress'))

      // confirm payment if setting is enabled
      if (settingsStore.confirmBeforeSending) {
        const truncatedAddr = `${destinationAddr.value.slice(0, 24)}...${destinationAddr.value.slice(-8)}`
        const fiatStr = currencySendAmount.value ? ` (${formatFiatAmount(currencySendAmount.value, settingsStore.currency)})` : ''
        const confirmed = await new Promise<boolean>((resolve) => {
          $q.dialog({
            title: t('wallet.confirmPayment'),
            message: `${t('wallet.confirmPaymentMessage', { amount: bchSendAmount.value?.toLocaleString("en-US"), unit: displayUnitLong.value, fiat: fiatStr })}<br>${truncatedAddr}`,
            html: true,
            cancel: { flat: true, color: 'dark' },
            ok: { label: t('common.actions.confirm'), color: 'primary', textColor: 'white' },
            persistent: true
          }).onOk(() => resolve(true))
            .onCancel(() => resolve(false))
        })
        if (!confirmed) return
      }

      const amountSats = BigInt(await convert(bchSendAmount.value, settingsStore.bchUnit, "sat"))
      const sendBchOutput = { cashaddr: destinationAddr.value, value:amountSats } ;
      $q.notify({
        spinner: true,
        message: t('wallet.sendingTransaction'),
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.send([ sendBchOutput ]);
      const alertMessage = t('wallet.sent', { amount: bchSendAmount.value + displayUnitLong.value, address: destinationAddr.value })
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId } 
        }
      })
      $q.notify({
        type: 'positive',
        message: t('wallet.transactionSuccess')
      })
      console.log(alertMessage);
      // reset fields
      bchSendAmount.value = undefined;
      currencySendAmount.value = undefined;
      destinationAddr.value = "";
      // update utxo list
      await store.updateWalletUtxos();
      // update wallet history as fire-and-forget promise
      void store.updateWalletHistory();
    } catch(error){
      console.log(error)
      const errorMessage = typeof error == 'string' ? error : t('common.errors.somethingWentWrong');
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      })
    } finally {
      isSending.value = false;
    }
  }

  const qrDecode = (content: string) => {
    destinationAddr.value = content;
    parseAddrParams()
  }
  const qrFilter = (content: string) => {
    // Extract address without query params if it's a BIP21 URI
    let addressInput = content;
    if(isBip21Uri(content) && content.includes("?")){
      try {
        const parsed = parseBip21Uri(content);
        addressInput = parsed.address;
      } catch {
        // If parsing fails, try with original content
      }
    }
    const decoded = decodeCashAddress(addressInput);
    if (typeof decoded === "string" || decoded.prefix !== store.wallet.networkPrefix) {
      return t('wallet.errors.notCashaddress');
    }
    return true;
  }

  // we want to play the animation when the user updates the qrAnimation setting
  // @codeRendered does not trigger on 'qrAnimation' so we use a watcher for it
  watch(() => settingsStore.qrAnimation, () => {
    if(!settingsStore.hasPlayedAnimation) animateQrCode()
  })
</script>


<template>
  <fieldset style="margin-top: 20px; padding-top: 2rem; padding-bottom: 1rem; max-width: 75rem; margin: auto 10px;">
    <div style="font-size: 1.2em">
      {{ t('wallet.balance', { currency: currencyDisplayShortName }) }}
      <span style="color: hsla(160, 100%, 37%, 1);">{{ displayCurrencyBalance }}</span>
    </div>
    <span>
      {{ t('wallet.balance', { currency: bchDisplayNetwork }) }}
      <span style="color: hsla(160, 100%, 37%, 1);">
        {{ balanceInBchUnit !== undefined ? numberFormatter.format(balanceInBchUnit) + displayUnitLong : "" }}
      </span>
    </span>
    <div style="word-break: break-all;">
      {{ t('wallet.address', { network: bchDisplayNetwork }) }}
      <span @click="() => copyToClipboard(store.wallet.getDepositAddress())" style="cursor:pointer;">
        <span class="depositAddr">{{ store.wallet.getDepositAddress() }} </span>
        <img class="copyIcon" src="images/copyGrey.svg">
      </span>
    </div>
    <div style="word-break: break-all;">
      {{ t('wallet.tokenAddress') }}
      <span @click="() => copyToClipboard(store.wallet.getTokenDepositAddress())" style="cursor:pointer;">
        <span class="depositAddr">{{ store.wallet.getTokenDepositAddress() }}</span>
        <img class="copyIcon" src="images/copyGrey.svg">
      </span>
    </div>
    <qr-code ref="qrCodeRef" :contents="addressQrcode" @click="copyToClipboard(addressQrcode)" class="qr-code" @codeRendered="animateQrCode">
      <img :src="displayBchQr? 'images/bch-icon.png':'images/tokenicon.png'" slot="icon" /> <!-- eslint-disable-line -->
    </qr-code>
    <div style="text-align: center;">
      <div class="switchAddressButton icon" @click="switchAddressTypeQr()">⇄
      </div>
    </div>
    <div>
      {{ t('wallet.send', { network: bchDisplayNetwork }) }}
      <div style="display: flex; gap: 0.5rem;">
        <input v-model="destinationAddr" @input="parseAddrParams()" :placeholder="t('wallet.addressPlaceholder')" name="addressInput">
        <button v-if="settingsStore.qrScan" @click="() => showQrCodeDialog = true" style="padding: 12px">
            <img src="images/qrscan.svg" />
        </button>
      </div>
      <span class="sendAmountGroup">
        <span style="position: relative; width: 50%;">
          <input v-model="bchSendAmount" @input="setCurrencyAmount()" type="number" :placeholder="t('wallet.amountPlaceholder')" name="currencyInput">
          <i class="input-icon" style="color: black;">{{ bchDisplayUnit }}</i>
        </span>
        <span class="sendCurrencyInput">
          <input v-model="currencySendAmount" @input="setBchAmount()" type="number" :placeholder="t('wallet.amountPlaceholder')" name="bchAmountInput">
          <i class="input-icon" style="color: black;">
            {{`${currencyDisplayShortName} ${CurrencySymbols[settingsStore.currency]}`}}
          </i>
        </span>
            <button @click="useMaxBchAmount()" class="fillInMaxBch">{{ t('wallet.max') }}</button>
      </span>
      <div v-if="(maxAmountToSendInBchUnit ?? 0) < (bchSendAmount ?? 0)" style="color: red;">{{ t('wallet.notEnoughBch') }}</div>

    </div>
    <input @click="sendBch()" type="button" class="primaryButton" :value="isSending ? t('common.status.sending') : t('common.actions.send')" :disabled="isSending" style="margin-top: 8px;">
  </fieldset>
  <div v-if="showQrCodeDialog">
    <QrCodeDialog @hide="() => showQrCodeDialog = false" @decode="qrDecode" :filter="qrFilter"/>
  </div>
</template>

<style scoped>
.qr-code {
  display: block;
  cursor: pointer;
  width: 230px;
  height: 225px;
  margin: 5px auto 0 auto;
  background-color: #fff;
}
.switchAddressButton {
  font-size: 20px;
  font-weight: 700;
  width: fit-content;
  margin: auto;
  margin-top: -10px;
  padding: 5px;
  cursor: pointer;
  user-select: none;
}
</style>