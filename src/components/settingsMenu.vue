<script setup lang="ts">
  import Toggle from '@vueform/toggle'
  import EmojiItem from './general/emojiItem.vue'
  import backupWallet from './settings/backupWallet.vue'
  import walletsOverview from './settings/walletsOverview.vue'
  import { computed, ref } from 'vue'
  import { useQuasar } from 'quasar'
  import { Connection, type ElectrumNetworkProvider, Config, type BalanceResponse } from "mainnet-js"
  import { useStore } from '../stores/store'
  import { useSettingsStore } from '../stores/settingsStore'
  import { getElectrumCacheSize, clearElectrumCache } from "src/utils/cacheUtils";
  const store = useStore()
  const settingsStore = useSettingsStore()
  const $q = useQuasar()
  import { useWindowSize } from '@vueuse/core'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const isBrowser = (process.env.MODE == "spa");
  const isDesktop = (process.env.MODE == "electron");
  const isCapacitor = (process.env.MODE == "capacitor");
  const applicationVersion = process.env.version

  const settingsSection = ref<0 | 1 | 2 | 3 | 4 | 5>(0);
  const indexedDbCacheSizeMB = ref(undefined as undefined | number);
  const localStorageSizeMB = ref(undefined as undefined | number);
  
  // basic settings
  const selectedCurrency = ref(settingsStore.currency);
  const selectedUnit = ref(settingsStore.bchUnit);
  const qrAnimation = ref(settingsStore.qrAnimation);
  const dateFormat = ref(settingsStore.dateFormat);
  const selectedExplorer = ref(store.explorerUrl);
  // user options
  const selectedDarkMode = ref(settingsStore.darkMode);
  const confirmBeforeSending = ref(settingsStore.confirmBeforeSending);
  const selectedShowSwap = ref(settingsStore.showCauldronSwap);
  const selectedTokenBurn = ref(settingsStore.tokenBurn);
  const enableQrScan = ref(settingsStore.qrScan);
  // advanced settings
  const selectedElectrumServer = ref(settingsStore.electrumServerMainnet);
  const selectedElectrumServerChipnet = ref(settingsStore.electrumServerChipnet);
  const predefinedIpfsGateways = [
    "https://w3s.link/ipfs/",
    "https://ipfs.io/ipfs/",
    "https://dweb.link/ipfs/",
    "https://nftstorage.link/ipfs/"
  ];
  const storedIpfsGateway = settingsStore.ipfsGateway;
  const isCustomIpfsGateway = !predefinedIpfsGateways.includes(storedIpfsGateway);
  const selectedIpfsGateway = ref(isCustomIpfsGateway ? "custom" : storedIpfsGateway);
  const customIpfsGateway = ref(isCustomIpfsGateway ? storedIpfsGateway : "http://localhost:8080/ipfs/");
  const selectedChaingraph = ref(settingsStore.chaingraph);
  const selectedExchangeRateProvider = ref(settingsStore.exchangeRateProvider);
  // developer options
  const selectedNetwork = ref<"mainnet" | "chipnet">(store.network);
  const enableMintNfts = ref(settingsStore.mintNfts);
  const enableAuthchains = ref(settingsStore.authchains);
  const enableLoadTokenIcons = ref(settingsStore.loadTokenIcons);

  const utxosWithBchAndTokens = computed(() => {
    return store.walletUtxos?.filter(utxo => utxo.token?.tokenId && utxo.satoshis > 100_000n);
  });

  // Used to disable network options the current wallet doesn't exist on
  // Note: wallets are created for both networks by default, very old wallets may be the exception
  const currentWalletInfo = computed(() => {
    return store.availableWallets.find(w => w.name === store.activeWalletName);
  });

  const isPwaMode = window.matchMedia('(display-mode: standalone)').matches;
  const platformString = isBrowser ? (isPwaMode ? 'installed web app' : 'browser') : (isCapacitor ? 'app' : 'application');

  async function calculateIndexedDBSizeMB() {
    const totalSize = await getElectrumCacheSize();
    return totalSize / (1024 ** 2); // Convert to MB
  }

  function calculateLocalStorageSizeMB() {
    let totalSize = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('cachedFetch-')) {
        const value = localStorage.getItem(key);
        // Value is multiplied by 2 due to data being stored in `utf-16` format, which requires twice the space.
        if (value) totalSize += (key.length * 2) + (value.length * 2);
      }
    }
    return totalSize / (1024 ** 2); // Convert to MB
  }

  async function loadCacheSizes() {
    indexedDbCacheSizeMB.value = await calculateIndexedDBSizeMB();
    localStorageSizeMB.value = calculateLocalStorageSizeMB()
  };

  // Loading cache sizes during setup to have the sizes available immediately in the 'advanced settings' submenu.
  // Use as fire-and-forget to avoid blocking the setup process.
  void loadCacheSizes()

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
  function changeQrAnimation(){
    settingsStore.qrAnimation = qrAnimation.value;
    localStorage.setItem("qrAnimation", qrAnimation.value);
    settingsStore.hasPlayedAnimation = false;
    store.changeView(1)
  }
  function changeDateFormat(){
    settingsStore.dateFormat = dateFormat.value;
    localStorage.setItem("dateFormat", dateFormat.value);
  }
  function changeBlockExplorer(){
    const explorerNetwork = store.network == "mainnet" ? "explorerMainnet" : "explorerChipnet";
    settingsStore[explorerNetwork] = selectedExplorer.value;
    localStorage.setItem(explorerNetwork, selectedExplorer.value);
  }
  function changeElectrumServer(targetNetwork: "mainnet" | "chipnet"){
    if(!store._wallet) throw new Error('No wallet set in global store');
    store.changeView(1)
    store.resetWalletState()
    if(targetNetwork == "mainnet"){
      const newConnection = new Connection("mainnet",`wss://${selectedElectrumServer.value}:50004`)
      // @ts-ignore currently no other way to set a specific provider
      store._wallet.provider = newConnection.networkProvider as ElectrumNetworkProvider;
      settingsStore.electrumServerMainnet = selectedElectrumServer.value
      localStorage.setItem("electrum-mainnet", selectedElectrumServer.value);
    }
    if(targetNetwork == "chipnet"){
      const newConnection = new Connection("testnet",`wss://${selectedElectrumServerChipnet.value}:50004`)
      // @ts-ignore currently no other way to set a specific provider
      store._wallet.provider = newConnection.networkProvider as ElectrumNetworkProvider;
      settingsStore.electrumServerChipnet = selectedElectrumServerChipnet.value
      localStorage.setItem("electrum-chipnet", selectedElectrumServerChipnet.value);
    }
    // fire-and-forget promise does not wait on full wallet initialization
    void store.initializeWallet();
  }
  function changeIpfsGateway(){
    if (selectedIpfsGateway.value === "custom") return;
    settingsStore.ipfsGateway = selectedIpfsGateway.value;
    localStorage.setItem("ipfsGateway", selectedIpfsGateway.value);
  }
  function saveCustomIpfsGateway(){
    const trimmedGateway = customIpfsGateway.value.trim();
    if (!trimmedGateway) return;
    settingsStore.ipfsGateway = trimmedGateway;
    localStorage.setItem("ipfsGateway", trimmedGateway);
  }
  function changeChaingraph(){
    settingsStore.chaingraph = selectedChaingraph.value
    localStorage.setItem("chaingraph", selectedChaingraph.value);
  }
  function changeExchangeRateProvider(){
    settingsStore.exchangeRateProvider = selectedExchangeRateProvider.value;
    settingsStore.configureExchangeRateProvider(selectedExchangeRateProvider.value);
    localStorage.setItem("exchangeRateProvider", selectedExchangeRateProvider.value);
  }
  function changeDarkMode(){
    settingsStore.darkMode = selectedDarkMode.value;
    localStorage.setItem("darkMode", selectedDarkMode.value? "true" : "false");
    darkmodeTransition()
    selectedDarkMode.value ? document.body.classList.add("dark") : document.body.classList.remove("dark")
  }
  // work-around to not apply transitions for qr code scanning
  function darkmodeTransition() {
      document.body.classList.add('transition-enabled');
    setTimeout(() => {
      document.body.classList.remove('transition-enabled');
    }, 500);
  }
  function toggleConfirmBeforeSending(){
    localStorage.setItem("confirmBeforeSending", confirmBeforeSending.value? "true" : "false");
    settingsStore.confirmBeforeSending = confirmBeforeSending.value;
  }
  function toggleShowSwap(){
    localStorage.setItem("showCauldronSwap", selectedShowSwap.value? "true" : "false");
    settingsStore.showCauldronSwap = selectedShowSwap.value;
  }
  function changeTokenBurn(){
    settingsStore.tokenBurn = selectedTokenBurn.value;
  }
  function changeQrScan(){
    localStorage.setItem("qrScan", enableQrScan.value? "true" : "false");
    settingsStore.qrScan = enableQrScan.value;
  }
  async function confirmDeleteWallets(){
    let text = `You are about to delete all Cashonize wallets and data from this ${platformString}.<br>Are you sure you want to delete everything?`;
    if (isPwaMode) {
      text = `You are about to delete all Cashonize wallets and data from this ${platformString}.<br>This will also delete them from your browser!<br>Are you sure you want to delete everything?`;
    }
    const confirmed = await new Promise<boolean>((resolve) => {
      $q.dialog({
        title: 'Delete All Wallets',
        message: text,
        html: true,
        cancel: { flat: true, color: 'dark' },
        ok: { label: 'Delete All', color: 'red', textColor: 'white' },
        persistent: true
      }).onOk(() => resolve(true))
        .onCancel(() => resolve(false))
    })
    if (confirmed) {
      // TODO: see if we need 'resetWalletState' to cancel subscriptions, etc.
      indexedDB.deleteDatabase("bitcoincash");
      indexedDB.deleteDatabase("bchtest");
      indexedDB.deleteDatabase("WALLET_CONNECT_V2_INDEXED_DB");
      // TODO: should also clear CashConnect indexedDB
      indexedDB.deleteDatabase("ElectrumNetworkProviderCache");

      // Wipe all localStorage for privacy (includes preferences, dApp history, wallet names, etc.)
      // Note: IndexedDB deletion above is not exhaustive yet
      localStorage.clear();

      // TODO: see if we can reset the state without force-reloading
      location.reload();
    }
  }
  async function clearHistoryCache(){
    await clearElectrumCache();
    indexedDbCacheSizeMB.value = await calculateIndexedDBSizeMB();
  }
  function clearMetadataCache(){
    // remove cachedFetch- keys from localStorage
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('cachedFetch')) localStorage.removeItem(key);
    });
    localStorageSizeMB.value = calculateLocalStorageSizeMB();
  }

  function changeNetwork(){
    settingsStore.hasPlayedAnimation = false;
    // fire-and-forget promise does not wait on full wallet initialization
    void store.changeNetwork(selectedNetwork.value)
  }
  function changeMintNfts(){
    localStorage.setItem("mintNfts", enableMintNfts.value? "true" : "false");
    settingsStore.mintNfts = enableMintNfts.value;
  }
  async function changeAuthchains(){
    localStorage.setItem("authchains", enableAuthchains.value? "true" : "false");
    settingsStore.authchains = enableAuthchains.value;
    if(enableAuthchains.value) {
      try{
        await store.fetchAuthUtxos()
      } catch (error) {
        console.error("Error fetching auth UTXOs:", error)
      }
    }
  }
  function changeLoadTokenIcons(){
    localStorage.setItem("loadTokenIcons", enableLoadTokenIcons.value? "true" : "false");
    settingsStore.loadTokenIcons = enableLoadTokenIcons.value;
  }

</script>

<template>
  <fieldset class="item">
    <legend>Settings</legend>
    <div v-if="!isBrowser" style="margin-bottom: 15px;">
      Version Cashonize App: {{ applicationVersion }}
      <span v-if="isDesktop && store.latestGithubRelease && store.latestGithubRelease == 'v'+applicationVersion">(latest)</span>
      <span v-if="isDesktop && store.latestGithubRelease && store.latestGithubRelease !== 'v'+applicationVersion">
        (latest release is
          <a href="https://github.com/cashonize/cashonize-wallet/releases/latest" target="_blank">{{store.latestGithubRelease}}</a>)
      </span>
    </div>

    <div v-if="settingsSection != 0">
      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => settingsSection = 0">
        ↲ All settings
      </div>
    </div>

    <backupWallet v-if="settingsSection == 1" />
    <div v-else-if="settingsSection == 2">
      <div style="margin-bottom:15px;">
        Dark mode <Toggle v-model="selectedDarkMode" @change="changeDarkMode()"/>
      </div>


      <div style="margin-top:15px">
        Confirm payments before sending <Toggle v-model="confirmBeforeSending" @change="toggleConfirmBeforeSending"/>
        <div style="font-size: smaller; color: grey;">
          Ask for confirmation after clicking send (recommended)
        </div>
      </div>

      <div style="margin-top:15px">
        Show Cauldron Swap Button <Toggle v-model="selectedShowSwap" @change="toggleShowSwap"/>
      </div>

      <div style="margin-top: 15px; margin-bottom: 15px;">
        Enable token-burn <Toggle v-model="selectedTokenBurn" @change="changeTokenBurn()"/>
      </div>

      <div v-if="!isCapacitor" style="margin-top: 15px;">
        Enable QR scan <Toggle v-model="enableQrScan" @change="changeQrScan()"/>
      </div>

      <div style="margin-top:15px">
        <label for="selectUnit">Select fiat currency:</label>
        <select v-model="selectedCurrency" @change="changeCurrency()">
          <option value="usd">USD</option>
          <option value="eur">EUR</option>
          <option value="gbp">GBP</option>
          <option value="cad">CAD</option>
          <option value="aud">AUD</option>
        </select>
      </div>

      <div style="margin-top:15px;">
        <label for="selectUnit">Select Bitcoin Cash unit:</label>
        <select v-model="selectedUnit" @change="changeUnit()">
          <option value="bch">BCH</option>
          <option value="sat">satoshis</option>
        </select>
      </div>
      
      <div style="margin-top:15px;">
        <label for="selectUnit">Qr code animation:</label>
        <select v-model="qrAnimation" @change="changeQrAnimation()">
          <option value="MaterializeIn">MaterializeIn</option>
          <option value="FadeInTopDown">FadeInTopDown</option>
          <option value="FadeInCenterOut">FadeInCenterOut</option>
          <option value="RadialRipple">RadialRipple</option>
          <option value="RadialRippleIn">RadialRippleIn</option>
          <option value="None">None</option>
        </select>
      </div>

      <div style="margin-top:15px; margin-bottom: 15px;">
        <label for="dateFormat">Date format:</label>
        <select v-model="dateFormat" @change="changeDateFormat()">
          <option value="DD/MM/YY">DD/MM/YY</option>
          <option value="MM/DD/YY">MM/DD/YY</option>
          <option value="YY-MM-DD">YY-MM-DD</option>
        </select>
      </div>
    </div>
    <div v-else-if="settingsSection == 3">
      <div v-if="store.network == 'mainnet'" style="margin-top:15px">
        <label for="selectNetwork">Change Electrum server mainnet:</label>
        <select v-model="selectedElectrumServer" @change="changeElectrumServer('mainnet')">
          <option value="electrum.imaginary.cash">electrum.imaginary.cash (default)</option>
          <option value="bch.imaginary.cash">bch.imaginary.cash</option>
          <option value="cashnode.bch.ninja">cashnode.bch.ninja</option>
          <option value="fulcrum.greyh.at">fulcrum.greyh.at</option>
          <option value="electroncash.dk">electroncash.dk</option>
          <option value="fulcrum.jettscythe.xyz">fulcrum.jettscythe.xyz</option>
          <option value="bch.loping.net">bch.loping.net</option>
          <option value="fulcrum.criptolayer.net">fulcrum.criptolayer.net</option>
        </select>
      </div>

      <div v-if="store.network == 'chipnet'" style="margin-top:15px">
        <label for="selectNetwork">Change Electrum server chipnet:</label>
        <select v-model="selectedElectrumServerChipnet" @change="changeElectrumServer('chipnet')">
          <option value="chipnet.bch.ninja">chipnet.bch.ninja (default)</option>
          <option value="chipnet.imaginary.cash">chipnet.imaginary.cash</option>
        </select>
      </div>

      <div style="margin-top:15px">
        <label for="selectNetwork">Change IPFS gateway:</label>
        <select v-model="selectedIpfsGateway" @change="changeIpfsGateway()">
          <option value="https://w3s.link/ipfs/">w3s.link (default)</option>
          <option value="https://ipfs.io/ipfs/">ipfs.io</option>
          <option value="https://dweb.link/ipfs/">dweb.link</option>
          <option value="https://nftstorage.link/ipfs/">nftstorage.link</option>
          <option value="custom">Custom</option>
        </select>
        <div v-if="selectedIpfsGateway === 'custom'" style="margin-top: 8px;">
          <input
            v-model="customIpfsGateway"
            @blur="saveCustomIpfsGateway()"
            @keyup.enter="saveCustomIpfsGateway()"
            type="text"
            style="width: 100%;"
          >
        </div>
      </div>

      <div style="margin-top:15px">
        <label for="selectNetwork">Change ChainGraph:</label>
        <select v-model="selectedChaingraph" @change="changeChaingraph()">
          <option value="https://gql.chaingraph.pat.mn/v1/graphql">Pat's Chaingraph (default)</option>
          <option value="https://demo.chaingraph.cash/v1/graphql">Demo Chaingraph</option>
        </select>
      </div>

      <div style="margin-top:15px">
        <label for="selectExchangeRate">Exchange rate provider:</label>
        <select v-model="selectedExchangeRateProvider" @change="changeExchangeRateProvider()">
          <option value="default">Default (bitcoin.com for USD, BitPay for rest)</option>
          <option value="bitpay">BitPay</option>
          <option value="coingecko">CoinGecko</option>
          <option value="coinbase">Coinbase</option>
        </select>
      </div>

      <div style="margin-top:15px;">Remove all wallets and all data from {{ platformString }}
        <div v-if="isPwaMode" style="color: red">
          Deleting all wallets from the 'Installed web-app' will also delete them from your browser!
        </div>
        <div v-if="!isPwaMode && settingsStore.hasInstalledPWA" style="color: red">
          Deleting all wallets from the browser will also remove them from any 'Installed web-app'.
        </div>
        <input @click="confirmDeleteWallets()" type="button" value="Delete all wallets" class="button error" style="display: block;">
      </div>

      <div style="margin-top:15px; margin-bottom: 15px">
        Clear wallet history cache {{ isMobile? '' : 'from ' + platformString }}
        <span v-if="indexedDbCacheSizeMB != undefined" class="nowrap">({{ indexedDbCacheSizeMB.toFixed(2) }} MB)</span>
        <input @click="clearHistoryCache()" type="button" value="Clear history cache" class="button" style="display: block; color: black;">
      </div>

      <div style="margin-top:15px; margin-bottom: 15px">
        Clear token-metadata cache {{ isMobile? '' : 'from ' + platformString }}
        <span v-if="localStorageSizeMB != undefined" class="nowrap">({{ localStorageSizeMB.toFixed(2) }} MB)</span>
        <input @click="clearMetadataCache()" type="button" value="Clear token cache" class="button" style="display: block; color: black;">
      </div>
    </div>
    <div v-else-if="settingsSection == 4">
      <div>
        <label for="selectNetwork">Change network:</label>
        <select v-model="selectedNetwork" @change="changeNetwork()">
          <option value="mainnet" :disabled="!currentWalletInfo?.hasMainnet">mainnet</option>
          <option value="chipnet" :disabled="!currentWalletInfo?.hasChipnet">chipnet</option>
        </select>
      </div>

      <div  style="margin-top:15px">Token Creation Functionality:</div>
      <div style="margin: 0px 10px;">

        <div style="margin-top:15px">
          Enable mint NFTs <Toggle v-model="enableMintNfts" @change="changeMintNfts()"/>
          <div style="font-size: smaller; color: grey;">
            Adds a mint action to minting NFTs, allowing you to create more NFTs in the same category
          </div>
        </div>

        <div style="margin-top:15px; margin-bottom: 15px">
          Enable authchain resolution <Toggle v-model="enableAuthchains" @change="changeAuthchains()"/>
          <div style="font-size: smaller; color: grey;">
            Checks if you hold the AuthHead (authority to update token metadata) and enables transferring it
          </div>
        </div>

        <div v-if="!isMobile" style="margin-top:15px; margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(6)">
          → Token Creation Page
        </div>
      </div>

      <div style="margin-top:15px">Privacy:</div>
      <div style="margin: 0px 10px;">
        <div style="margin-top:15px; margin-bottom: 15px">
          Load token icons <Toggle v-model="enableLoadTokenIcons" @change="changeLoadTokenIcons()"/>
          <div style="font-size: smaller; color: grey;">
            Disabling this prevents loading images from untrusted sources
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="settingsSection == 5">
      <walletsOverview />
    </div>
    <!-- settingsSection === 0: main settings menu -->
    <div v-else>
      <div style="margin-bottom: 15px;">
        Current wallet: <span class="wallet-name-styled">{{ store.activeWalletName }}</span>
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => settingsSection = 1">
        ↳ Backup wallet <span v-if="settingsStore.getBackupStatus(store.activeWalletName) === 'none'" style="color: var(--color-primary)">(important)</span>
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => settingsSection = 5">
        ↳ Manage wallets
        <span style="color: grey; font-size: smaller;">
          ({{ store.availableWallets.length }} {{ store.availableWallets.length === 1 ? 'wallet' : 'wallets' }})
        </span>
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => settingsSection = 2">
        ↳ User options
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => settingsSection = 3">
        ↳ Advanced settings
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => settingsSection = 4">
        ↳ Developer settings
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(7)">
        → UTXO Management <span v-if="utxosWithBchAndTokens?.length" style="color: orange">(important)</span>
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(8)">
        → Sweep Private Key
      </div>

      <div style="margin-top:15px; margin-bottom:15px;">
        <label for="selectUnit">Select BlockExplorer:</label>
        <select v-if="store.network == 'mainnet'" v-model="selectedExplorer" @change="changeBlockExplorer()">
          <option value="https://blockchair.com/bitcoin-cash/transaction">Blockchair</option>
          <option value="https://explorer.salemkode.com/tx">SalemKode explorer</option>
          <option value="https://blockbook.pat.mn/tx">BlockBook Pat</option>
          <option value="https://3xpl.com/bitcoin-cash/transaction">3xpl</option>
          <option value="https://explorer.bch.ninja/tx">explorer.bch.ninja (no Token Metadata)</option>
          <option value="https://bch.loping.net/tx">bch.loping.net (no Token Metadata)</option>
          <option value="https://explorer.coinex.com/bch/tx">CoinEx explorer (no CashTokens support)</option>
          <option value="https://explorer.melroy.org/tx">Melroy explorer (no CashTokens support)</option>
        </select>
        <select v-if="store.network == 'chipnet'" v-model="selectedExplorer" @change="changeBlockExplorer()">
          <option value="https://chipnet.bch.ninja/tx">chipnet.bch.ninja</option>
          <option value="https://chipnet.imaginary.cash/tx">chipnet.imaginary.cash</option>
          <option value="https://chipnet.chaingraph.cash/tx">chipnet.chaingraph.cash</option>
          <option value="https://cbch.loping.net/tx">cbch.loping.net</option>
        </select>
      </div>

      <div v-if="isBrowser" style="margin-bottom:15px;">
        <a style="color: var(--font-color); cursor: pointer;" href="https://github.com/cashonize/cashonize-wallet/releases/latest" target="_blank">
          Download Cashonize
          <img :src="settingsStore.darkMode? '/images/external-link-grey.svg' : '/images/external-link.svg'" style="vertical-align: sub;"/>
        </a>
      </div>
      
      <div style="margin-bottom:15px;">
        <a style="color: var(--font-color); cursor: pointer;" href="https://x.com/GeukensMathieu" target="_blank">
          Made with <EmojiItem emoji="💚" :sizePx="18" style="vertical-align: sub;" /> by Mathieu G.
        </a>
      </div>

    </div>
  </fieldset>
</template>

<style scoped>
.nowrap {
  white-space: nowrap;
}
</style>