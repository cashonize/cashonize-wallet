<script setup lang="ts">
  import Toggle from '@vueform/toggle'
  import { ref } from 'vue'
  import { Connection, ElectrumNetworkProvider, Config, BalanceResponse } from "mainnet-js"
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
  const selectedCurrency = ref(settingsStore.currency);
  const selectedUnit = ref(settingsStore.bchUnit);
  const selectedExplorer = ref(store.explorerUrl);
  const selectedDarkMode = ref(settingsStore.darkMode);
  const selectedWalletConnect = ref(settingsStore.walletConnect);
  const selectedTokenCreation = ref(settingsStore.tokenCreation);
  const selectedTokenBurn = ref(settingsStore.tokenBurn);
  const selectedElectrumServer = ref(settingsStore.electrumServerMainnet);
  const selectedIpfsGateway = ref(settingsStore.ipfsGateway);
  const selectedChaingraph = ref(settingsStore.chaingraph);
  const emit = defineEmits(['changeView','changeNetwork']);

  async function changeCurrency(){
    Config.DefaultCurrency = selectedCurrency.value;
    settingsStore.currency = selectedCurrency.value;
    localStorage.setItem("currency", selectedCurrency.value);
    emit('changeView', 1);
    store.balance = await store.wallet!.getBalance() as BalanceResponse;
  }
  function changeUnit(){
    settingsStore.bchUnit = selectedUnit.value;
    localStorage.setItem("unit", selectedUnit.value);
    emit('changeView', 1);
  }
  function changeBlockExplorer(){
    const explorerNetwork = store.network == "mainnet" ? "explorerMainnet" : "explorerChipnet";
    settingsStore[explorerNetwork] = selectedExplorer.value;
    localStorage.setItem(explorerNetwork, selectedExplorer.value);
  }
  function changeNetwork(){
    emit('changeNetwork', selectedNetwork.value);
  }
  function changeElectrumServer(){
    if(!store.wallet) return
    const newConnection = new Connection("mainnet",`wss://${selectedElectrumServer.value}:50004` )
    store.wallet.provider = newConnection.networkProvider as ElectrumNetworkProvider;
    settingsStore.electrumServerMainnet = selectedElectrumServer.value
    localStorage.setItem("electrum-mainnet", selectedElectrumServer.value);
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
  function changeWalletConnect(){
    settingsStore.walletConnect = selectedWalletConnect.value;
    localStorage.setItem("walletConnect", selectedWalletConnect.value? "true" : "false");
  }
  function changeTokenCreation(){
    settingsStore.tokenCreation = selectedTokenCreation.value;
    localStorage.setItem("tokenCreation", selectedTokenCreation.value? "true" : "false");
  }
  function changeTokenBurn(){
    settingsStore.tokenBurn = selectedTokenBurn.value;
    localStorage.setItem("tokenBurn", selectedTokenBurn.value? "true" : "false");
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
    const text = "You are about to delete your Cashonize wallet info from this browser.\nAre you sure you want to delete?";
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
      <div style="margin-top: 15px;">Enable WalletConnect  
        <Toggle v-model="selectedWalletConnect" @change="changeWalletConnect()" style="vertical-align: middle;toggle-height: 5.25rem; display: inline-block;"/>
      </div>

      <div style="margin-top: 15px;">Enable token creation  
        <Toggle v-model="selectedTokenCreation" @change="changeTokenCreation()" style="vertical-align: middle;toggle-height: 5.25rem; display: inline-block;"/>
      </div>

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

      <div v-if="store.network == 'mainnet'" style="margin-top:15px">
        <label for="selectNetwork">Change Electrum server mainnet:</label>
        <select v-model="selectedElectrumServer" @change="changeElectrumServer()">
          <option value="electrum.imaginary.cash">electrum.imaginary.cash (default)</option>
          <option value="bch.imaginary.cash">bch.imaginary.cash</option>
          <option value="cashnode.bch.ninja">cashnode.bch.ninja</option>
          <option value="fulcrum.greyh.at">fulcrum.greyh.at</option>
          <option value="electroncash.dk">electroncash.dk</option>
          <option value="fulcrum.jettscythe.xyz">fulcrum.jettscythe.xyz</option>
          <option value="bch.loping.net">bch.loping.net</option>
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
        <label for="selectUnit">Select default currency:</label>
        <select v-model="selectedCurrency" @change="changeCurrency()">
          <option value="usd">USD</option>
          <option value="eur">EUR</option>
        </select>
      </div>
      <div style="margin-top:15px">
        <label for="selectUnit">Select default unit:</label>
        <select v-model="selectedUnit" @change="changeUnit()">
          <option value="bch">BCH</option>
          <option value="sat">satoshis</option>
        </select>
      </div>

      <div style="margin-top:15px">
        <label for="selectUnit">Select BlockExplorer:</label>
        <select v-model="selectedExplorer" @change="changeBlockExplorer()">
          <option v-if="store.network == 'mainnet'" value="https://blockchair.com/bitcoin-cash/transaction">Blockchair</option>
          <option v-if="store.network == 'mainnet'" value="https://explorer.bitcoinunlimited.info/tx">Bitcoinunlimited</option>
          <option v-if="store.network == 'mainnet'" value="https://3xpl.com/bitcoin-cash/transaction">3xpl</option>
          <option v-if="store.network == 'mainnet'" value="https://explorer.salemkode.com/tx">SalemKode explorer</option>
          <option v-if="store.network == 'mainnet'" value="https://explorer.coinex.com/bch/tx">CoinEx explorer (no CashTokens support)</option>
          <option v-if="store.network == 'mainnet'" value="https://explorer.melroy.org/tx">Melroy explorer (no CashTokens support)</option>

          <option v-if="store.network == 'chipnet'" value="https://chipnet.imaginary.cash/tx">chipnet imaginary</option>
          <option v-if="store.network == 'chipnet'" value="https://chipnet.chaingraph.cash/tx">chipnet chaingraph</option>
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