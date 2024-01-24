<script setup lang="ts">
  import { ref, computed } from 'vue'
  import { convert } from 'mainnet-js'
  import { defineCustomElements } from '@bitjson/qr-code';
  import { useStore } from '../stores/store'
  import { useSettingsStore } from '../stores/settingsStore'
  const store = useStore()
  const settingsStore = useSettingsStore()

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
    try{
      if(store.maxAmountToSend && store.maxAmountToSend[settingsStore.bchUnit]){
        bchSendAmount.value = store.maxAmountToSend[settingsStore.bchUnit];
        setUsdAmount()
      }
      else throw("expected a number");
    } catch(error) {
      console.log(error)
    }
  }
  async function sendBch(){
    try{
      if(!store.wallet) return;
      if(!bchSendAmount.value) throw("No valid amount provided!")
      const sendBchOutput = {cashaddr: destinationAddr.value, value: bchSendAmount.value, unit: settingsStore.bchUnit}
      const { txId } = await store.wallet.send([ sendBchOutput ]);
      alert(`Sent ${bchSendAmount.value, displayUnitLong.value} to ${destinationAddr.value} \n${store.explorerUrl}/tx/${txId}`);
      console.log(`Sent ${bchSendAmount.value, displayUnitLong.value} to ${destinationAddr.value} \n${store.explorerUrl}/tx/${txId}`);
      bchSendAmount.value = undefined;
      destinationAddr.value = "";
    } catch(error){
      console.log(error)
    }
  }
</script>


<template>
  <fieldset style="margin-top: 20px; padding-top: 2rem; max-width: 75rem; margin: auto;">
    <div v-if="store.network == 'mainnet'" style="font-size: 1.2em">
      USD balance:  
      <span style="color: hsla(160, 100%, 37%, 1);">
        {{ store.balance && store.balance.usd != undefined ? store.balance.usd + " $": "" }}
      </span>
    </div>
    <span>
      BCH balance:  
      <span style="color: hsla(160, 100%, 37%, 1);">
        {{ store.balance && store.balance[settingsStore.bchUnit] != undefined ? store.balance[settingsStore.bchUnit] + displayUnitLong : "" }}
      </span>
    </span>
    <span>
      , Tokens: 
      <span style="color: hsla(160, 100%, 37%, 1);">
        {{ nrTokenCategories != undefined ? nrTokenCategories + " different categories" : ""}}
      </span>
    </span>
    <div>
      BCH address: 
      <span class="depositAddr">{{ store.wallet?.address ?? "" }} </span>
      <img class="copyIcon" src="/images/copyGrey.svg" @click="() => copyToClipboard(store.wallet?.address)">
    </div>
    <div>
      Token address:
      <span class="depositAddr">{{ store.wallet?.tokenaddr ?? "" }}</span>
      <img class="copyIcon" src="/images/copyGrey.svg" @click="() => copyToClipboard(store.wallet?.tokenaddr)">
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
      <input v-model="destinationAddr" id="destinationAddr" placeholder="address">
      <span class="sendAmountGroup">
        <span style="position: relative; width: 50%;">
          <input v-model="bchSendAmount" @input="setUsdAmount" id="sendAmount" type="number" placeholder="amount">
          <i class="input-icon" style="color: black;">{{ bchDisplayUnit }}</i>
        </span>
        <span style="position: relative; width: 50%; margin-left: 5px;">
          <input v-model="usdSendAmount" @input="setBchAmount" id="sendAmount" type="number" placeholder="amount">
          <i class="input-icon" style="color: black;">{{store.network == "mainnet"? "USD $":"tUsd $"}}</i>
        </span> 
            <button @click="useMaxBchAmount()" style="margin-left: 5px;">max</button>
      </span>
    </div>
    <input @click="sendBch()" type="button" class="primaryButton" id="send" value="Send" style="margin-top: 8px;">
  </fieldset>
</template>../stores/store