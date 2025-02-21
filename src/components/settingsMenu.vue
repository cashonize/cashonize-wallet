<script setup lang="ts">
  import Toggle from '@vueform/toggle'
  import { computed, ref } from 'vue'
  import { Connection, ElectrumNetworkProvider, Config, BalanceResponse } from "mainnet-js"
  import { useStore } from '../stores/store'
  import { useSettingsStore } from '../stores/settingsStore'
  import { copyToClipboard } from 'src/utils/utils';
  const store = useStore()
  const settingsStore = useSettingsStore()
  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const isBrowser = (process.env.MODE == "spa");
  const isDesktop = (process.env.MODE == "electron");
  const appVersion = process.env.version

  const displaySettingsMenu = ref(0);
  const displaySeedphrase = ref(false);
  const selectedNetwork = ref(store.network as "mainnet" | "chipnet");
  const selectedCurrency = ref(settingsStore.currency);
  const selectedUnit = ref(settingsStore.bchUnit);
  const selectedExplorer = ref(store.explorerUrl);
  const selectedDarkMode = ref(settingsStore.darkMode);
  const showFiatValueHistory = ref(settingsStore.showFiatValueHistory);
  const selectedTokenBurn = ref(settingsStore.tokenBurn);
  const selectedElectrumServer = ref(settingsStore.electrumServerMainnet);
  const selectedElectrumServerChipnet = ref(settingsStore.electrumServerChipnet);
  const selectedIpfsGateway = ref(settingsStore.ipfsGateway);
  const selectedChaingraph = ref(settingsStore.chaingraph);

  const latestGithubRelease = ref(undefined as undefined | string);
  const localStorageSizeMB = ref('');
  localStorageSizeMB.value = calculateLocalStorageSizeMB();

  if(isDesktop) getLatestGithubRelease()

  async function getLatestGithubRelease(){
    try {
      const response = await fetch('https://api.github.com/repos/cashonize/cashonize-wallet/releases/latest');
      if (!response.ok) throw new Error('Network response was not ok');
        
      const releaseData = await response.json();
      // Extract the version tag (e.g., 'v0.2.4')
      latestGithubRelease.value = releaseData.tag_name;
      console.log(latestGithubRelease.value)
    } catch (error) {
      console.error('Error fetching latest GitHub release:', error);
    }
  }

  function calculateLocalStorageSizeMB() {
    const localStorageSizeBytes = Object.entries(localStorage).reduce((sum, [key, value]) => 
      sum + new Blob([key + value]).size, 0
    ) 
    return (localStorageSizeBytes / (1024 ** 2)).toFixed(2);
  }

  async function changeCurrency(){
    Config.DefaultCurrency = selectedCurrency.value;
    settingsStore.currency = selectedCurrency.value;
    localStorage.setItem("currency", selectedCurrency.value);
    store.changeView(1);
    if (store.wallet) {
      store.balance = await store.wallet.getBalance() as BalanceResponse;
    }
  }
  function changeUnit(){
    settingsStore.bchUnit = selectedUnit.value;
    localStorage.setItem("unit", selectedUnit.value);
    store.changeView(1)
  }
  function changeBlockExplorer(){
    const explorerNetwork = store.network == "mainnet" ? "explorerMainnet" : "explorerChipnet";
    settingsStore[explorerNetwork] = selectedExplorer.value;
    localStorage.setItem(explorerNetwork, selectedExplorer.value);
  }
  function changeNetwork(){
    store.changeNetwork(selectedNetwork.value)
  }
  function changeElectrumServer(){
    if(!store.wallet) return
    const newConnection = new Connection("mainnet",`wss://${selectedElectrumServer.value}:50004` )
    store.wallet.provider = newConnection.networkProvider as ElectrumNetworkProvider;
    settingsStore.electrumServerMainnet = selectedElectrumServer.value
    localStorage.setItem("electrum-mainnet", selectedElectrumServer.value);
  }
  function changeElectrumServerChipnet(){
    if(!store.wallet) return
    const newConnection = new Connection("testnet",`wss://${selectedElectrumServerChipnet.value}:50004` )
    store.wallet.provider = newConnection.networkProvider as ElectrumNetworkProvider;
    settingsStore.electrumServerChipnet = selectedElectrumServerChipnet.value
    localStorage.setItem("electrum-chipnet", selectedElectrumServerChipnet.value);
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
  function toggleShowFiatValueHistory(){
    localStorage.setItem("fiatValueHistory", showFiatValueHistory.value? "true" : "false");
    settingsStore.showFiatValueHistory = showFiatValueHistory.value;
  }
  function changeTokenBurn(){
    settingsStore.tokenBurn = selectedTokenBurn.value;
  }
  function toggleShowSeedphrase(){
    displaySeedphrase.value = !displaySeedphrase.value;
  }
  function confirmDeleteWallet(){
    const isBrowser = (process.env.MODE == "spa");
    const platformString = isBrowser ? 'browser' : 'application'
    const text = `You are about to delete your Cashonize wallet info from this ${platformString}.\nAre you sure you want to delete it?`;
    if (confirm(text)){
      indexedDB.deleteDatabase("bitcoincash");
      indexedDB.deleteDatabase("bchtest");
      location.reload(); 
    }
  }
  function clearHistoryCache(){
    // only remove tx- and header- keys
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('tx-') || key.startsWith('header-')) localStorage.removeItem(key);
    });
    localStorageSizeMB.value = calculateLocalStorageSizeMB();
  }
</script>

<template>
  <fieldset class="item">
    <legend>Settings</legend>
    <div v-if="!isBrowser" style="margin-bottom: 15px;">
      Version Cashonize App: {{ appVersion }}
      <span v-if="isDesktop && latestGithubRelease && latestGithubRelease == 'v'+appVersion">(latest)</span>
      <span v-if="isDesktop && latestGithubRelease && latestGithubRelease !== 'v'+appVersion">
        (latest release is 
          <a href="https://github.com/cashonize/cashonize-wallet/releases/latest" target="_blank">{{latestGithubRelease}}</a>)
      </span>
    </div>

    <div v-if="displaySettingsMenu != 0">
      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => displaySettingsMenu = 0">
        ↲ All settings
      </div>
    </div>

    <div v-if="displaySettingsMenu == 1">
      <div style="margin-top:15px">Make backup of seed phrase (mnemonic)</div>
        <input @click="toggleShowSeedphrase()" class="button primary" type="button" style="padding: 1rem 1.5rem; display: block;" 
          :value="displaySeedphrase? 'Hide seed phrase' : 'Show seed phrase'"
        >
        <div v-if="displaySeedphrase" @click="copyToClipboard(store.wallet?.mnemonic)" style="cursor: pointer;">
          {{ store.wallet?.mnemonic }}
        </div>
        <br>
        <div style="margin-bottom:15px;">
          Derivation path of this wallet is 
          <span @click="copyToClipboard(store.wallet?.derivationPath)" style="cursor: pointer;">
            {{ store.wallet?.derivationPath }}
            ({{ store.wallet?.derivationPath == "m/44'/145'/0'/0/0" ? "default on BCH" : "custom, non-default" }})
          </span>
        </div>
    </div>
    <div v-else-if="displaySettingsMenu == 2">
      <div style="margin-bottom:15px;">
        Dark mode <Toggle v-model="selectedDarkMode" @change="changeDarkMode()" style="vertical-align: middle;toggle-height: 5.25rem; display: inline-block;"/>
      </div>

      <div style="margin-top:15px">
        Show fiat value in History <Toggle v-model="showFiatValueHistory" @change="toggleShowFiatValueHistory" style="vertical-align: middle;toggle-height: 5.25rem; display: inline-block;"/>
      </div>

      <div style="margin-top: 15px; margin-bottom: 15px;">Enable token-burn  
        <Toggle v-model="selectedTokenBurn" @change="changeTokenBurn()" style="vertical-align: middle;toggle-height: 5.25rem; display: inline-block;"/>
      </div>
    </div>
    <div v-else-if="displaySettingsMenu == 3">
      <div>
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

      <div v-if="store.network == 'chipnet'" style="margin-top:15px">
        <label for="selectNetwork">Change Electrum server chipnet:</label>
        <select v-model="selectedElectrumServerChipnet" @change="changeElectrumServerChipnet()">
          <option value="chipnet.bch.ninja">chipnet.bch.ninja (default)</option>
          <option value="chipnet.imaginary.cash">chipnet.imaginary.cash</option>
          <option value="cbch.loping.net">cbch.loping.net</option>
        </select>
      </div>

      <div style="margin-top:15px">
        <label for="selectNetwork">Change IPFS gateway:</label>
        <select v-model="selectedIpfsGateway" @change="changeIpfsGateway()">
          <option value="https://w3s.link/ipfs/">w3s.link (default)</option>
          <option value="https://ipfs.io/ipfs/">ipfs.io</option>
          <option value="https://dweb.link/ipfs/">dweb.link</option>
          <option value="https://nftstorage.link/ipfs/">nftstorage.link</option>
        </select>
      </div>

      <div style="margin-top:15px">
        <label for="selectNetwork">Change ChainGraph:</label>
        <select v-model="selectedChaingraph" @change="changeChaingraph()">
          <option value="https://gql.chaingraph.pat.mn/v1/graphql">Pat's Chaingraph (default)</option>
          <option value="https://demo.chaingraph.cash/v1/graphql">Demo Chaingraph</option>
          <option value="https://gql.chaingraph.panmoni.com/v1/graphql">Panmoni Chaingraph </option>
        </select>
      </div>

      <div style="margin-top:15px;">Remove wallet from {{isBrowser? "browser": "application"}}
        <input @click="confirmDeleteWallet()" type="button" value="Delete wallet" class="button error" style="display: block;">
      </div>

      <div style="margin-top:15px; margin-bottom: 15px">
        Clear wallet history from {{isBrowser? "browser": "application"}} ({{ localStorageSizeMB }} MB)
        <input @click="clearHistoryCache()" type="button" value="Clear cache" class="button" style="display: block;">
      </div>
    </div>
    <div v-else>
      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => displaySettingsMenu = 1">
        ↳ Backup wallet
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => displaySettingsMenu = 2">
        ↳ User options
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => displaySettingsMenu = 3">
        ↳ Advanced settings
      </div>

      <div v-if="!isMobile" style="margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(6)">
        → Token Creation
      </div>

      <div style="margin-top:15px">
        <label for="selectUnit">Select fiat currency:</label>
        <select v-model="selectedCurrency" @change="changeCurrency()">
          <option value="usd">USD</option>
          <option value="eur">EUR</option>
        </select>
      </div>

      <div style="margin-top:15px">
        <label for="selectUnit">Select Bitcoin Cash unit:</label>
        <select v-model="selectedUnit" @change="changeUnit()">
          <option value="bch">BCH</option>
          <option value="sat">satoshis</option>
        </select>
      </div>

      <div style="margin-top:15px; margin-bottom:15px;">
        <label for="selectUnit">Select BlockExplorer:</label>
        <select v-model="selectedExplorer" @change="changeBlockExplorer()">
          <option v-if="store.network == 'mainnet'" value="https://blockchair.com/bitcoin-cash/transaction">Blockchair</option>
          <option v-if="store.network == 'mainnet'" value="https://3xpl.com/bitcoin-cash/transaction">3xpl</option>
          <option v-if="store.network == 'mainnet'" value="https://explorer.bch.ninja/tx">explorer.bch.ninja</option>
          <option v-if="store.network == 'mainnet'" value="https://bch.loping.net/tx">bch.loping.net</option>
          <option v-if="store.network == 'mainnet'" value="https://explorer.salemkode.com/tx">SalemKode explorer</option>
          <option v-if="store.network == 'mainnet'" value="https://explorer.coinex.com/bch/tx">CoinEx explorer (no CashTokens support)</option>
          <option v-if="store.network == 'mainnet'" value="https://explorer.melroy.org/tx">Melroy explorer (no CashTokens support)</option>

          <option v-if="store.network == 'chipnet'" value="https://chipnet.bch.ninja/tx">chipnet.bch.ninja</option>
          <option v-if="store.network == 'chipnet'" value="https://chipnet.imaginary.cash/tx">chipnet.imaginary.cash</option>
          <option v-if="store.network == 'chipnet'" value="https://chipnet.chaingraph.cash/tx">chipnet.chaingraph.cash</option>
          <option v-if="store.network == 'chipnet'" value="https://cbch.loping.net/tx">cbch.loping.net</option>
        </select>
      </div>

      <div v-if="isBrowser" style="margin-bottom:15px;">
        <a style="color: var(--font-color); cursor: pointer;" href="https://github.com/cashonize/cashonize-wallet/releases/latest" target="_blank">
          Download Cashonize
          <img :src="settingsStore.darkMode? '/images/external-link-grey.svg' : '/images/external-link.svg'" style="vertical-align: sub;"/>
        </a>
      </div>

    </div>
  </fieldset>
</template>

<style src="@vueform/toggle/themes/default.css"></style>