<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { convert } from 'mainnet-js'
  import { defineCustomElements } from '@bitjson/qr-code';
  import { useStore } from '../stores/store'
  import { useSettingsStore } from '../stores/settingsStore'
  import { useQuasar } from 'quasar'
  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()
  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const nrTokenCategories = computed(() => store.tokenList?.length)

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
  const displayeBchQr = ref(true);
  const bchSendAmount = ref(undefined as (number | undefined));
  const usdSendAmount = ref(undefined as (number | undefined));
  const destinationAddr = ref("");

  function switchAddressTypeQr(){
    displayeBchQr.value = !displayeBchQr.value;
  }
  function copyToClipboard(item: string|undefined){
    if(item) navigator.clipboard.writeText(item);
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
      setUsdAmount()
    }
  }
  async function setUsdAmount() {
    if(typeof bchSendAmount.value != 'number'){
      usdSendAmount.value = undefined
      return
    }
    const newUsdValue = await convert(bchSendAmount.value, settingsStore.bchUnit, "usd");
    usdSendAmount.value = Number(newUsdValue.toFixed(2));
  }
  async function setBchAmount() {
    if(typeof usdSendAmount.value != 'number'){
      bchSendAmount.value = undefined
      return
    }
    const newBchValue = await convert(usdSendAmount.value, "usd", settingsStore.bchUnit);
    bchSendAmount.value = Number(newBchValue);
  }
  async function useMaxBchAmount(){
    if(store.maxAmountToSend && store.maxAmountToSend[settingsStore.bchUnit]){
      bchSendAmount.value = store.maxAmountToSend[settingsStore.bchUnit];
      setUsdAmount()
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
      const sendBchOutput = {cashaddr: destinationAddr.value, value: bchSendAmount.value, unit: settingsStore.bchUnit}
      const { txId } = await store.wallet.send([ sendBchOutput ]);
      alert(`Sent ${bchSendAmount.value, displayUnitLong.value} to ${destinationAddr.value} \n${store.explorerUrl}/tx/${txId}`);
      console.log(`Sent ${bchSendAmount.value, displayUnitLong.value} to ${destinationAddr.value} \n${store.explorerUrl}/tx/${txId}`);
      bchSendAmount.value = undefined;
      destinationAddr.value = "";
    } catch(error){
      if(typeof error == 'string'){
        $q.notify({
          message: error,
          icon: 'warning',
          color: "red"
        })
      }
    }
  }
</script>


<template>
  <fieldset style="margin-top: 20px; padding-top: 2rem; max-width: 75rem; margin: auto 10px;">
    <div v-if="store.network == 'mainnet'" style="font-size: 1.2em">
      USD balance:  
      <span style="color: hsla(160, 100%, 37%, 1);">
        {{ store.balance && store.balance.usd != undefined ?  (store.balance.usd).toFixed(2) + " $": "" }}
      </span>
    </div>
    <span>
      BCH balance:  
      <span style="color: hsla(160, 100%, 37%, 1);">
        {{ store.balance && store.balance[settingsStore.bchUnit] != undefined ? store.balance[settingsStore.bchUnit] + displayUnitLong : "" }}
      </span>
    </span>
    <span v-if="!isMobile">
      , Tokens: 
      <span style="color: hsla(160, 100%, 37%, 1);">
        {{ nrTokenCategories != undefined ? nrTokenCategories + " different categories" : ""}}
      </span>
    </span>
    <div v-else style="margin-bottom: 10px;">
      Tokens: 
      <span style="color: hsla(160, 100%, 37%, 1);">
        {{ nrTokenCategories != undefined ? nrTokenCategories + " different categories" : ""}}
      </span>
    </div>
    <div style="word-break: break-all;">
      BCH address: 
      <span class="depositAddr">{{ store.wallet?.address ?? "" }} </span>
      <img class="copyIcon" src="images/copyGrey.svg" @click="() => copyToClipboard(store.wallet?.address)">
    </div>
    <div style="word-break: break-all;">
      Token address:
      <span class="depositAddr">{{ store.wallet?.tokenaddr ?? "" }}</span>
      <img class="copyIcon" src="images/copyGrey.svg" @click="() => copyToClipboard(store.wallet?.tokenaddr)">
    </div>
    <qr-code id="qrCode" :contents="displayeBchQr? store.wallet?.address : store.wallet?.tokenaddr" 
      style="display: block; width: 230px; height: 230px; margin: 5px auto 0 auto; background-color: #fff;">
      <img :src="displayeBchQr? 'images/bch-icon.png':'images/tokenicon.png'" slot="icon" /> <!-- eslint-disable-line -->
    </qr-code>
    <div style="text-align: center;">
      <div id="switchAddress" class="icon" @click="switchAddressTypeQr()"
        style="font-size: 20px;font-weight: 700;width: fit-content; margin: auto; margin-top: -5px; cursor: pointer;">⇄
      </div>
    </div>
    <div style="margin-top: 5px;">
      Send BCH:
      <input v-model="destinationAddr" @input="parseAddrParams()" id="destinationAddr" placeholder="address">
      <span class="sendAmountGroup">
        <span style="position: relative; width: 50%;">
          <input v-model="bchSendAmount" @input="setUsdAmount()" id="sendAmount" type="number" placeholder="amount">
          <i class="input-icon" style="color: black;">{{ bchDisplayUnit }}</i>
        </span>
        <span class="sendUsdInput">
          <input v-model="usdSendAmount" @input="setBchAmount()" id="sendAmount" type="number" placeholder="amount">
          <i class="input-icon" style="color: black;">{{store.network == "mainnet"? "USD $":"tUsd $"}}</i>
        </span> 
            <button @click="useMaxBchAmount()" class="fillInMaxBch">max</button>
      </span>
      <div v-if="(store.maxAmountToSend?.sat ?? 0) < (bchSendAmount ?? 0)" style="color: red;" id="warningNoBCH">Not enough BCH in wallet to send</div>
      
    </div>
    <input @click="sendBch()" type="button" class="primaryButton" id="send" value="Send" style="margin-top: 8px;">
  </fieldset>
</template>