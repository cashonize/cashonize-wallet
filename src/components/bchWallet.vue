<script setup lang="ts">
  import { ref, computed, watch } from 'vue'
  import { BalanceResponse, convert } from 'mainnet-js'
  import { decodeCashAddress } from "@bitauth/libauth"
  import { defineCustomElements } from '@bitjson/qr-code';
  import alertDialog from 'src/components/alertDialog.vue'
  import { CurrencySymbols, CurrencyShortNames } from 'src/interfaces/interfaces'
  import { copyToClipboard } from 'src/utils/utils';
  import { useWindowSize } from '@vueuse/core'
  import { useStore } from '../stores/store'
  import { useSettingsStore } from '../stores/settingsStore'
  import { useQuasar } from 'quasar'
  import QrCodeDialog from './qr/qrCodeScanDialog.vue';

  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()

  const props = defineProps<{
    bchSendRequest?: string
  }>()

  const { width } = useWindowSize();
  const isMobilePhone = computed(() => width.value < 480)
  const isBrowser = (process.env.MODE == "spa");

  const nrTokenCategories = computed(() => store.tokenList?.length)

  const numberFormatter = new Intl.NumberFormat('en-US', {maximumFractionDigits: 8});

  const bchDisplayUnit = computed(() => {
    if(store.network == "mainnet") return settingsStore.bchUnit == "bch"? " BCH" : " sats"
    else return settingsStore.bchUnit == "bch"? " tBCH" : " tsats"
  })
  const displayUnitLong = computed(() => {
    if(store.network == "mainnet") return settingsStore.bchUnit == "bch"? " BCH" : " satoshis"
    else return settingsStore.bchUnit == "bch"? " tBCH" : " testnet satoshis"
  })

  defineCustomElements(window);

  // reactive state
  const displayBchQr = ref(true);
  const bchSendAmount = ref(undefined as (number | undefined));
  const currencySendAmount = ref(undefined as (number | undefined));
  const destinationAddr = ref("");
  const showQrCodeDialog = ref(false);

  const addressQrcode = computed(() => displayBchQr.value ? store.wallet?.address : store.wallet?.tokenaddr)

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

  function switchAddressTypeQr(){
    displayBchQr.value = !displayBchQr.value;
  }
  async function parseAddrParams(){
    const addressInput = destinationAddr.value;
    if(addressInput.includes("?amount=")){
      const [address, params] = addressInput.split("?");
      destinationAddr.value = address;
      // set the bch amount field
      let bchAmount =  Number(params.split("amount=")[1]);
      if(settingsStore.bchUnit == "sat") bchAmount = Math.round(bchAmount * 100_000_000);
      bchSendAmount.value = bchAmount;
      setCurrencyAmount()
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
  async function updateCurrencyBalance(){
    if(store.balance && store.maxAmountToSend){
      const newFiatValue = await convert(
        store.maxAmountToSend[settingsStore.bchUnit], "bch", settingsStore.currency
      )
      const refreshedBalance: BalanceResponse = {
        ...store.balance,
        [settingsStore.currency]: newFiatValue
      }
      store.balance = refreshedBalance
    }
  }
  async function useMaxBchAmount(){
    if(store.maxAmountToSend && store.maxAmountToSend[settingsStore.bchUnit]){
      bchSendAmount.value = store.maxAmountToSend[settingsStore.bchUnit];
      // update currency balance & set currency amount
      updateCurrencyBalance()
      setCurrencyAmount()
    }
    else{
      $q.notify({
        message: "Wallet doesn't hold any Bitcoin Cash",
        icon: 'warning',
        color: "grey-7"
      })
    }
  }
  async function sendBch(){
    try{
      if(!store.wallet) return;
      // check for valid inputs
      if(!destinationAddr.value) throw("No destination address provided")
      if(!bchSendAmount.value) throw("No valid amount provided")
      if(bchSendAmount.value > (store.maxAmountToSend?.sat ?? 0)) throw("Not enough BCH in wallet")
      if(!destinationAddr.value.startsWith("bitcoincash:") && !destinationAddr.value.startsWith("bchtest:")){
        const networkPrefix = store.network == 'mainnet' ? "bitcoincash:" : "bchtest:"
        throw(`Address prefix ${networkPrefix} is required`)
      }
      const decodedAddress = decodeCashAddress(destinationAddr.value)
      if(typeof decodedAddress == 'string') throw("Invalid BCH address provided")
      const sendBchOutput = {cashaddr: destinationAddr.value, value: bchSendAmount.value, unit: settingsStore.bchUnit}
      $q.notify({
        spinner: true,
        message: 'Sending transaction...',
        color: 'grey-5',
        timeout: 1000
      })
      const { txId } = await store.wallet.send([ sendBchOutput ]);
      const alertMessage = `Sent ${bchSendAmount.value + displayUnitLong.value} to ${destinationAddr.value}`
      $q.dialog({
        component: alertDialog,
        componentProps: {
          alertInfo: { message: alertMessage, txid: txId as string } 
        }
      })
      $q.notify({
        type: 'positive',
        message: 'Transaction succesfully sent!'
      })
      console.log(alertMessage);
      // reset fields
      bchSendAmount.value = undefined;
      currencySendAmount.value = undefined;
      destinationAddr.value = "";
    } catch(error){
      console.log(error)
      const errorMessage = typeof error == 'string' ? error : "something went wrong";
      $q.notify({
        message: errorMessage,
        icon: 'warning',
        color: "red"
      })
    }
  }

  const qrDecode = (content: string) => {
    destinationAddr.value = content;
  }
  const qrFilter = (content: string) => {
    const decoded = decodeCashAddress(content);
    if (typeof decoded === "string" || decoded.prefix !== store.wallet?.networkPrefix) {
      return "Not a cashaddress on current network";
    }
    return true;
  }
</script>


<template>
  <fieldset style="margin-top: 20px; padding-top: 2rem; max-width: 75rem; margin: auto 10px;">
    <div v-if="store.network == 'mainnet'" style="font-size: 1.2em">
      {{ CurrencyShortNames[settingsStore.currency] }} balance:
      <span style="color: hsla(160, 100%, 37%, 1);">
        {{ store.balance && store.balance[settingsStore.currency] != undefined ?
          (store.balance[settingsStore.currency]).toFixed(2) + ` ${CurrencySymbols[settingsStore.currency]}`: "" 
        }}
      </span>
    </div>
    <span>
      BCH balance:  
      <span style="color: hsla(160, 100%, 37%, 1);">
        {{ store.balance && store.balance[settingsStore.bchUnit] != undefined 
          ? numberFormatter.format(store.balance[settingsStore.bchUnit] as number) + displayUnitLong : "" }}
      </span>
    </span>
    <div :style="!isMobilePhone ? 'display: in-line-block' : 'margin-bottom: 10px;'">
      <span v-if="!isMobilePhone">, </span>
      Tokens: 
      <span style="color: hsla(160, 100%, 37%, 1);">
        {{ nrTokenCategories != undefined ? nrTokenCategories + " different categories" : ""}}
      </span>
    </div>
    <div style="word-break: break-all;">
      BCH address: 
      <span @click="() => copyToClipboard(store.wallet?.address)" style="cursor:pointer;">
        <span class="depositAddr">{{ store.wallet?.address ?? "" }} </span>
        <img class="copyIcon" src="images/copyGrey.svg">
      </span>
    </div>
    <div style="word-break: break-all;">
      Token address:
      <span @click="() => copyToClipboard(store.wallet?.tokenaddr)" style="cursor:pointer;">
        <span class="depositAddr">{{ store.wallet?.tokenaddr ?? "" }}</span>
        <img class="copyIcon" src="images/copyGrey.svg"> 
      </span>
    </div>
    <qr-code :contents="addressQrcode" @click="copyToClipboard(addressQrcode)" class="qr-code">
      <img :src="displayBchQr? 'images/bch-icon.png':'images/tokenicon.png'" slot="icon" /> <!-- eslint-disable-line -->
    </qr-code>
    <div style="text-align: center;">
      <div class="icon" @click="switchAddressTypeQr()"
        style="font-size: 20px;font-weight: 700;width: fit-content; margin: auto; margin-top: -5px; cursor: pointer;">⇄
      </div>
    </div>
    <div style="margin-top: 5px;">
      Send BCH:
      <div style="display: flex; gap: 0.5rem;">
        <input v-model="destinationAddr" @input="parseAddrParams()" placeholder="address" name="addressInput">
        <button v-if="isBrowser" @click="() => showQrCodeDialog = true" style="padding: 12px">
            <img src="images/qrscan.svg" />
        </button>
      </div>
      <span class="sendAmountGroup">
        <span style="position: relative; width: 50%;">
          <input v-model="bchSendAmount" @input="setCurrencyAmount()" type="number" placeholder="amount" name="currencyInput">
          <i class="input-icon" style="color: black;">{{ bchDisplayUnit }}</i>
        </span>
        <span class="sendCurrencyInput">
          <input v-model="currencySendAmount" @input="setBchAmount()" type="number" placeholder="amount" name="bchAmountInput">
          <i class="input-icon" style="color: black;">
            {{(store.network == "mainnet"? "" : "t") + `${CurrencyShortNames[settingsStore.currency]} ${CurrencySymbols[settingsStore.currency]}`}}
          </i>
        </span> 
            <button @click="useMaxBchAmount()" class="fillInMaxBch">max</button>
      </span>
      <div v-if="(store.maxAmountToSend?.[settingsStore.bchUnit] ?? 0) < (bchSendAmount ?? 0)" style="color: red;">Not enough BCH in wallet to send</div>
      
    </div>
    <input @click="sendBch()" type="button" class="primaryButton" value="Send" style="margin-top: 8px;">
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
  height: 230px;
  margin: 5px auto 0 auto;
  background-color: #fff;
}
</style>