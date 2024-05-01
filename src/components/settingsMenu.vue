<script setup lang="ts">
  import Toggle from '@vueform/toggle'
  import { ref } from 'vue'
  import { useStore } from '../stores/store'
  import { useSettingsStore } from '../stores/settingsStore'
  import { useQuasar } from 'quasar'
  const $q = useQuasar()
  const store = useStore()
  const settingsStore = useSettingsStore()

  const isBrowser = (process.env.MODE == "spa");
  const appVersion = process.env.version

  const displayeAdvanced = ref(false);
  const displayeSeedphrase = ref(false);
  const selectedNetwork = ref(store.network);
  const selectedUnit  = ref(settingsStore.bchUnit);
  const selectedDarkMode  = ref(settingsStore.darkMode);
  const selectedTokenBurn  = ref(settingsStore.tokenBurn);
  const selectedIpfsGateway  = ref(settingsStore.ipfsGateway);
  const selectedChaingraph  = ref(settingsStore.chaingraph);
  const emit = defineEmits(['changeView','changeNetwork']);

  function changeUnit(){
    settingsStore.bchUnit = selectedUnit.value;
    localStorage.setItem("unit", selectedUnit.value);
    emit('changeView', 1);
  }
  function changeNetwork(){
    emit('changeNetwork', selectedNetwork.value);
  }
  function changeIpfsGateway(){
    settingsStore.ipfsGateway = selectedIpfsGateway.value
    localStorage.setItem("ipfsGateway", selectedIpfsGateway.value);
  }
  function changeChaingraph(){
    settingsStore.chaingraph = selectedChaingraph.value
    localStorage.setItem("chaingraph", selectedChaingraph.value);
  }
  function changeDarkMode(){
    settingsStore.darkMode = selectedDarkMode.value;
    localStorage.setItem("darkMode", selectedDarkMode.value? "true" : "false");
    selectedDarkMode.value ? document.body.classList.add("dark") : document.body.classList.remove("dark")
  }
  function changeTokenBurn(){
    settingsStore.tokenBurn = selectedTokenBurn.value;
  }
  function toggleShowSeedphrase(){
    displayeSeedphrase.value = !displayeSeedphrase.value;
  }
  function copyToClipboard(copyText: string|undefined){
    if(!copyText) return
    navigator.clipboard.writeText(copyText);
    $q.notify({
      message: "Copied!",
      icon: 'info',
      timeout : 1000,
      color: "grey-6"
    })
  }
  function confirmDeleteWallet(){
    let text = "You are about to delete your Cashonize wallet info from this browser.\nAre you sure you want to delete?";
    if (confirm(text)){
      indexedDB.deleteDatabase("bitcoincash");
      indexedDB.deleteDatabase("bchtest");
      location.reload(); 
    }
  }
</script>

<template>
  <fieldset class="item">
    <legend>Settings</legend>
    <div v-if="!isBrowser" style="margin-bottom: 15px;">Version Cashonize App: {{ appVersion }}</div>

    <div style="margin-bottom: 15px; cursor: pointer;" @click="() => displayeAdvanced = !displayeAdvanced">
      {{!displayeAdvanced? '↳ Advanced settings' : '↲ All settings'}}
    </div>

    <div v-if="displayeAdvanced">
      <div style="margin-top: 15px;">Enable token-burn  
        <Toggle v-model="selectedTokenBurn" @change="changeTokenBurn()" style="vertical-align: middle;toggle-height: 5.25rem; display: inline-block;"/>
      </div>

      <div style="margin-top:15px">
        <label for="selectNetwork">Change network:</label>
        <select v-model="selectedNetwork" @change="changeNetwork()">
          <option value="mainnet">mainnet</option>
          <option value="chipnet">chipnet</option>
        </select>
      </div>

      <div style="margin-top:15px">
        <label for="selectNetwork">Change IPFS gateway:</label>
        <select v-model="selectedIpfsGateway" @change="changeIpfsGateway()">
          <option value="https://ipfs.io/ipfs/">ipfs.io (default)</option>
          <option value="https://dweb.link/ipfs/">dweb.link</option>
        </select>
      </div>

      <div style="margin-top:15px">
        <label for="selectNetwork">Change ChainGraph:</label>
        <select v-model="selectedChaingraph" @change="changeChaingraph()">
          <option value="https://gql.chaingraph.pat.mn/v1/graphql">Pat's Chaingraph (default)</option>
          <option value="https://demo.chaingraph.cash/v1/graphql">Demo Chaingraph</option>
        </select>
      </div>

      <div style="margin-top:15px">Remove wallet data from {{isBrowser? "browser": "application"}}</div>
      <input @click="confirmDeleteWallet()" type="button" id="burnNFT" value="Delete wallet" class="button error" style="display: block;">
    </div>
    <div v-else>
      <div>Dark mode
        <Toggle v-model="selectedDarkMode" @change="changeDarkMode()" style="vertical-align: middle;toggle-height: 5.25rem; display: inline-block;"/>
      </div>
      <div style="margin-top:15px">
        <label for="selectUnit">Select default unit:</label>
        <select v-model="selectedUnit" @change="changeUnit()">
          <option value="bch">BCH</option>
          <option value="sat">satoshis</option>
        </select>
      </div>
      <div style="margin-top:15px">Make backup of seed phrase (mnemonic)</div>
      <input @click="toggleShowSeedphrase()" class="button primary" type="button" style="padding: 1rem 1.5rem; display: block;" 
        :value="displayeSeedphrase? 'Hide seed phrase' : 'Show seed phrase'"
      >
      <div v-if="displayeSeedphrase" @click="copyToClipboard(store.wallet?.mnemonic)" style="cursor: pointer;">
        {{ store.wallet?.mnemonic }}
      </div>
      <br>
      <span style="margin-top:15px">Derivation path of this wallet is {{store.wallet?.derivationPath }}</span>
    </div>
  </fieldset>
</template>

<style src="@vueform/toggle/themes/default.css"></style>