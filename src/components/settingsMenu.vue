<script setup lang="ts">
  import EmojiItem from './general/emojiItem.vue'
  import InfoPopup from './general/InfoPopup.vue'
  import backupWallet from './settings/backupWallet.vue'
  import walletsOverview from './settings/walletsOverview.vue'
  import LanguageSelector from './general/LanguageSelector.vue'
  import { computed, ref } from 'vue'
  import { useI18n } from 'vue-i18n'
  import { Connection, type ElectrumNetworkProvider } from "mainnet-js"
  import { useStore } from '../stores/store'
  import { useSettingsStore } from '../stores/settingsStore'
  import { useWalletconnectStore } from '../stores/walletconnectStore'
  import { useCashconnectStore } from '../stores/cashconnectStore'
  import { getElectrumCacheSize, clearElectrumCache } from "src/utils/cacheUtils";
  import { displayAndLogError } from "src/utils/errorHandling";
  import { chaingraphGraphqlUrl, electrumWssUrl } from 'src/utils/utils'
  import { queryBlockHeight } from 'src/queryChainGraph'
  import { confirmDialog } from 'src/utils/txHelpers'
  const store = useStore()
  const settingsStore = useSettingsStore()
  const walletconnectStore = useWalletconnectStore()
  const cashconnectStore = useCashconnectStore()
  const { t } = useI18n()
  import { useWindowSize } from 'src/utils/composables'
  const { width } = useWindowSize();
  const isMobile = computed(() => width.value < 480)

  const isBrowser = import.meta.env.QUASAR_SPA_MODE;
  const isDesktop = import.meta.env.QUASAR_ELECTRON_MODE;
  const isCapacitor = import.meta.env.QUASAR_CAPACITOR_MODE;
  const applicationVersion = import.meta.env.version

  const settingsSection = ref<0 | 1 | 2 | 3 | 4 | 5 | 6>(0);
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
  const selectedShowCauldronFTValue = ref(settingsStore.showCauldronFTValue);
  const selectedTokenBurn = ref(settingsStore.tokenBurn);
  const enableQrScan = ref(settingsStore.qrScan);
  const tokenAddressQrDefault = ref(settingsStore.tokenAddressQrDefault);
  const enableAddressMarking = ref(settingsStore.enableAddressMarking);
  // advanced settings
  const predefinedElectrumServersMainnet = [
    "electrum.imaginary.cash",
    "bch.imaginary.cash",
    "cashnode.bch.ninja",
    "fulcrum.greyh.at",
    "electroncash.dk",
    "fulcrum.jettscythe.xyz",
    "bch.loping.net",
    "fulcrum.criptolayer.net"
  ];
  const storedElectrumServer = settingsStore.electrumServerMainnet;
  const isCustomElectrumServer = !predefinedElectrumServersMainnet.includes(storedElectrumServer);
  const selectedElectrumServer = ref(isCustomElectrumServer ? "custom" : storedElectrumServer);
  const customElectrumServer = ref(isCustomElectrumServer ? storedElectrumServer : "127.0.0.1");
  const predefinedElectrumServersChipnet = [
    "chipnet.bch.ninja",
    "chipnet.imaginary.cash"
  ];
  const storedElectrumServerChipnet = settingsStore.electrumServerChipnet;
  const isCustomElectrumServerChipnet = !predefinedElectrumServersChipnet.includes(storedElectrumServerChipnet);
  const selectedElectrumServerChipnet = ref(isCustomElectrumServerChipnet ? "custom" : storedElectrumServerChipnet);
  const customElectrumServerChipnet = ref(isCustomElectrumServerChipnet ? storedElectrumServerChipnet : "127.0.0.1");
  function isLocalServer(serverInput: string) {
    // The custom server may carry a ":port" suffix, the check is about the host
    const host = serverInput.trim().split(":")[0] ?? "";
    return host === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  }
  const isLocalElectrumServer = computed(() => isLocalServer(customElectrumServer.value));
  const isLocalElectrumServerChipnet = computed(() => isLocalServer(customElectrumServerChipnet.value));
  // the first entry is labeled as the default, keep it in sync with settingsStore
  const predefinedIpfsGateways = [
    "https://ipfs.io/ipfs/",
    "https://dweb.link/ipfs/",
    "https://ipfs.filebase.io/ipfs/",
    "https://ipfs.pat.mn/ipfs/"
  ];
  const storedIpfsGateway = settingsStore.ipfsGateway;
  const isCustomIpfsGateway = !predefinedIpfsGateways.includes(storedIpfsGateway);
  const selectedIpfsGateway = ref(isCustomIpfsGateway ? "custom" : storedIpfsGateway);
  const customIpfsGateway = ref(isCustomIpfsGateway ? storedIpfsGateway : "http://localhost:8080/ipfs/");
  const predefinedChaingraphs = [
    "https://gql.chaingraph.pat.mn/v1/graphql",
    "https://demo.chaingraph.cash/v1/graphql"
  ];
  const storedChaingraph = settingsStore.chaingraph;
  const isCustomChaingraph = !predefinedChaingraphs.includes(storedChaingraph);
  const selectedChaingraph = ref(isCustomChaingraph ? "custom" : storedChaingraph);
  const customChaingraph = ref(isCustomChaingraph ? storedChaingraph : "");
  const selectedCauldronIndexer = ref(settingsStore.cauldronIndexer);
  const predefinedBcmrIndexersMainnet = ["https://bcmr.paytaca.com/api"];
  const predefinedBcmrIndexersChipnet = ["https://bcmr-chipnet.paytaca.com/api"];
  const storedBcmrIndexer = settingsStore.bcmrIndexerMainnet;
  const isCustomBcmrIndexer = !predefinedBcmrIndexersMainnet.includes(storedBcmrIndexer);
  const selectedBcmrIndexer = ref(isCustomBcmrIndexer ? "custom" : storedBcmrIndexer);
  const customBcmrIndexer = ref(isCustomBcmrIndexer ? storedBcmrIndexer : "");
  const storedBcmrIndexerChipnet = settingsStore.bcmrIndexerChipnet;
  const isCustomBcmrIndexerChipnet = !predefinedBcmrIndexersChipnet.includes(storedBcmrIndexerChipnet);
  const selectedBcmrIndexerChipnet = ref(isCustomBcmrIndexerChipnet ? "custom" : storedBcmrIndexerChipnet);
  const customBcmrIndexerChipnet = ref(isCustomBcmrIndexerChipnet ? storedBcmrIndexerChipnet : "");
  const selectedExchangeRateProvider = ref(settingsStore.exchangeRateProvider);
  // developer options
  const selectedNetwork = ref<"mainnet" | "chipnet">(store.network);
  const enableMintNfts = ref(settingsStore.mintNfts);
  const enableAuthchains = ref(settingsStore.authchains);
  const disableTokenIcons = ref(settingsStore.disableTokenIcons);
  const strictWcSchema = ref(settingsStore.strictWcSchema);
  const showPrivateKeyWif = ref(settingsStore.showPrivateKeyWif);

  const utxosWithBchAndTokens = computed(() => {
    return store.walletUtxos?.filter(utxo => utxo.token?.category && utxo.satoshis > 100_000n);
  });

  // Used to disable network options the current wallet doesn't exist on
  // Note: wallets are created for both networks by default, very old wallets may be the exception
  const currentWalletInfo = computed(() => {
    return store.availableWallets.find(w => w.name === store.activeWalletName);
  });

  const isPwaMode = window.matchMedia('(display-mode: standalone)').matches;
  const platformString = isBrowser ? (isPwaMode ? 'installed web app' : 'browser') : (isCapacitor ? 'app' : 'application');


  function getHostname(url: string) {
    return new URL(url).hostname;
  }

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

  // store watches settingsStore.currency and refetches the exchange rate automatically
  async function changeCurrency(){
    settingsStore.currency = selectedCurrency.value;
    localStorage.setItem("currency", selectedCurrency.value);
    store.changeView(1);
    if (store.wallet) {
      store.balance = await store.wallet.getBalance();
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
  // Changing electrum servers resets wallet state and triggers a full wallet reinitialization
  async function changeElectrumServer(targetNetwork: "mainnet" | "chipnet"){
    if (targetNetwork === "mainnet" && selectedElectrumServer.value === "custom") return;
    if (targetNetwork === "chipnet" && selectedElectrumServerChipnet.value === "custom") return;
    if(!store._wallet) throw new Error('No wallet set in global store');
    store.changeView(1)
    // Only reset electrum state, keep WC/CC sessions alive
    await store.resetWalletState({ resetDappConnections: false })
    if(targetNetwork == "mainnet"){
      const newConnection = new Connection("mainnet", electrumWssUrl(selectedElectrumServer.value))
      // @ts-ignore currently no other way to set a specific provider
      store._wallet.provider = newConnection.networkProvider as ElectrumNetworkProvider;
      settingsStore.electrumServerMainnet = selectedElectrumServer.value
      localStorage.setItem("electrum-mainnet", selectedElectrumServer.value);
    }
    if(targetNetwork == "chipnet"){
      const newConnection = new Connection("testnet", electrumWssUrl(selectedElectrumServerChipnet.value))
      // @ts-ignore currently no other way to set a specific provider
      store._wallet.provider = newConnection.networkProvider as ElectrumNetworkProvider;
      settingsStore.electrumServerChipnet = selectedElectrumServerChipnet.value
      localStorage.setItem("electrum-chipnet", selectedElectrumServerChipnet.value);
    }
    // fire-and-forget promise does not wait on full wallet initialization
    void store.initializeWallet();
  }
  // Changing electrum servers resets wallet state and triggers a full wallet reinitialization
  async function saveCustomElectrumServer(targetNetwork: "mainnet" | "chipnet"){
    const customServer = targetNetwork == "mainnet" ? customElectrumServer.value : customElectrumServerChipnet.value;
    // server operators publish full urls like wss://fulcrum.pat.mn:443, strip a pasted scheme
    // and trailing slash so the stored value is always host or host:port
    const trimmedServer = customServer.trim().replace(/^(wss?|https?):\/\//i, "").replace(/\/+$/, "");
    if (!trimmedServer) return;
    if(!store._wallet) throw new Error('No wallet set in global store');
    store.changeView(1)
    // Only reset electrum state, keep WC/CC sessions alive
    await store.resetWalletState({ resetDappConnections: false })
    if(targetNetwork == "mainnet"){
      const newConnection = new Connection("mainnet", electrumWssUrl(trimmedServer))
      // @ts-ignore currently no other way to set a specific provider
      store._wallet.provider = newConnection.networkProvider as ElectrumNetworkProvider;
      settingsStore.electrumServerMainnet = trimmedServer;
      localStorage.setItem("electrum-mainnet", trimmedServer);
      customElectrumServer.value = trimmedServer;
    }
    if(targetNetwork == "chipnet"){
      const newConnection = new Connection("testnet", electrumWssUrl(trimmedServer))
      // @ts-ignore currently no other way to set a specific provider
      store._wallet.provider = newConnection.networkProvider as ElectrumNetworkProvider;
      settingsStore.electrumServerChipnet = trimmedServer;
      localStorage.setItem("electrum-chipnet", trimmedServer);
      customElectrumServerChipnet.value = trimmedServer;
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
    if (selectedChaingraph.value === "custom") return;
    applyChaingraph(selectedChaingraph.value);
  }
  const verifyingCustomChaingraph = ref(false);
  async function saveCustomChaingraph(){
    const trimmedChaingraph = customChaingraph.value.trim();
    if (!trimmedChaingraph || verifyingCustomChaingraph.value) return;
    let normalizedChaingraph: string;
    try {
      normalizedChaingraph = chaingraphGraphqlUrl(trimmedChaingraph);
    } catch {
      displayAndLogError(new Error(t('settings.advanced.chaingraphInvalidUrl')));
      return;
    }
    customChaingraph.value = normalizedChaingraph;
    // check the server actually answers Chaingraph queries before applying it
    verifyingCustomChaingraph.value = true;
    try {
      await queryBlockHeight(normalizedChaingraph);
    } catch (error) {
      displayAndLogError(error);
      return;
    } finally {
      verifyingCustomChaingraph.value = false;
    }
    applyChaingraph(normalizedChaingraph);
  }
  function applyChaingraph(chaingraphUrl: string){
    settingsStore.chaingraph = chaingraphUrl;
    localStorage.setItem("chaingraph", chaingraphUrl);
  }
  function changeCauldronIndexer(){
    settingsStore.cauldronIndexer = selectedCauldronIndexer.value;
    localStorage.setItem("cauldronIndexer", selectedCauldronIndexer.value);
    // refetch token prices from the newly selected indexer
    void store.fetchCauldronPricesForTokens();
  }
  function changeBcmrIndexer(targetNetwork: "mainnet" | "chipnet"){
    const selected = targetNetwork == "mainnet" ? selectedBcmrIndexer.value : selectedBcmrIndexerChipnet.value;
    if (selected === "custom") return;
    applyBcmrIndexer(targetNetwork, selected);
  }
  function saveCustomBcmrIndexer(targetNetwork: "mainnet" | "chipnet"){
    const customIndexer = targetNetwork == "mainnet" ? customBcmrIndexer.value : customBcmrIndexerChipnet.value;
    // the store appends /tokens/... paths, so strip any trailing slash
    let trimmedIndexer = customIndexer.trim().replace(/\/+$/, "");
    if (!trimmedIndexer) return;
    // without a scheme the value would be used as a path on the app's own origin
    if (!/^https?:\/\//i.test(trimmedIndexer)) trimmedIndexer = `https://${trimmedIndexer}`;
    if (targetNetwork == "mainnet") customBcmrIndexer.value = trimmedIndexer;
    if (targetNetwork == "chipnet") customBcmrIndexerChipnet.value = trimmedIndexer;
    applyBcmrIndexer(targetNetwork, trimmedIndexer);
  }
  function applyBcmrIndexer(targetNetwork: "mainnet" | "chipnet", indexerUrl: string){
    if(targetNetwork == "mainnet"){
      settingsStore.bcmrIndexerMainnet = indexerUrl;
      localStorage.setItem("bcmrIndexerMainnet", indexerUrl);
    }
    if(targetNetwork == "chipnet"){
      settingsStore.bcmrIndexerChipnet = indexerUrl;
      localStorage.setItem("bcmrIndexerChipnet", indexerUrl);
    }
    // refetch token metadata from the newly selected indexer
    store.bcmrRegistries = undefined;
    if (store.tokenList) void store.fetchTokenMetadata(store.tokenList, false);
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
  function toggleShowCauldronFTValue(){
    localStorage.setItem("showCauldronFTValue", selectedShowCauldronFTValue.value? "true" : "false");
    settingsStore.showCauldronFTValue = selectedShowCauldronFTValue.value;
    // Trigger fetch if enabling
    if (selectedShowCauldronFTValue.value) {
      void store.fetchCauldronPricesForTokens();
    }
  }
  function changeTokenBurn(){
    settingsStore.tokenBurn = selectedTokenBurn.value;
  }
  function changeQrScan(){
    localStorage.setItem("qrScan", enableQrScan.value? "true" : "false");
    settingsStore.qrScan = enableQrScan.value;
  }
  function toggleTokenAddressQrDefault(){
    localStorage.setItem("tokenAddressQrDefault", tokenAddressQrDefault.value? "true" : "false");
    settingsStore.tokenAddressQrDefault = tokenAddressQrDefault.value;
  }
  function toggleEnableAddressMarking(){
    localStorage.setItem("enableAddressMarking", enableAddressMarking.value? "true" : "false");
    settingsStore.enableAddressMarking = enableAddressMarking.value;
  }
  async function confirmDeleteWallets(){
    let text = t('settings.advanced.deleteAllWalletsConfirm', { platform: platformString });
    if (isPwaMode) {
      text = t('settings.advanced.deleteAllWalletsPwaWarning', { platform: platformString });
    }
    const confirmed = await confirmDialog(
      t('settings.advanced.deleteAllWalletsTitle'),
      text,
      t('settings.advanced.deleteAllButton'),
      'red'
    )
    if (confirmed) {
      // TODO: see if we need 'resetWalletState' to cancel subscriptions, etc.

      // mainnet-js databases: wallet keys, electrum cache, HD wallet address/UTXO cache
      indexedDB.deleteDatabase("bitcoincash");
      indexedDB.deleteDatabase("bchtest");
      indexedDB.deleteDatabase("ElectrumNetworkProviderCache");
      indexedDB.deleteDatabase("WalletCache");

      // WalletConnect session database
      indexedDB.deleteDatabase("WALLET_CONNECT_V2_INDEXED_DB");

      // CashConnect session databases (named "cashconnect-{publicKey}")
      if (indexedDB.databases) {
        const dbs = await indexedDB.databases();
        for (const db of dbs) {
          if (db.name?.startsWith("cashconnect-")) indexedDB.deleteDatabase(db.name);
        }
      }

      // Wipe all localStorage for privacy (includes preferences, dApp history, wallet names, etc.)
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
  async function clearDappConnections(){
    // Best-effort graceful disconnect so connected dApps are notified the session ended.
    // Bounded by a timeout: the IndexedDB wipe below is the source of truth, so we never
    // want an unreachable relay to block clearing a corrupted session state.
    const gracefulDisconnect = (async () => {
      try {
        const wcSessions = walletconnectStore.web3wallet?.getActiveSessions() ?? {};
        await Promise.allSettled(
          Object.keys(wcSessions).map(topic => walletconnectStore.deleteSession(topic))
        );
      } catch (error) {
        console.error("Failed to disconnect WalletConnect sessions:", error);
      }
      try {
        await cashconnectStore.cashConnectWallet?.disconnectAllSessions();
      } catch (error) {
        console.error("Failed to disconnect CashConnect sessions:", error);
      }
    })();
    const timeout = new Promise(resolve => setTimeout(resolve, 3000));
    await Promise.race([gracefulDisconnect, timeout]);

    // Wipe the dApp-connection databases. WalletKit/CashConnect keep these open, so the
    // delete is finalized on the reload below (same pattern as confirmDeleteWallets).
    indexedDB.deleteDatabase("WALLET_CONNECT_V2_INDEXED_DB");
    if (indexedDB.databases) {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (db.name?.startsWith("cashconnect-")) indexedDB.deleteDatabase(db.name);
      }
    }
    location.reload();
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
  function changeDisableTokenIcons(){
    localStorage.setItem("disableTokenIcons", disableTokenIcons.value ? "true" : "false");
    settingsStore.disableTokenIcons = disableTokenIcons.value;
  }
  function changeStrictWcSchema(){
    localStorage.setItem("strictWcSchema", strictWcSchema.value ? "true" : "false");
    settingsStore.strictWcSchema = strictWcSchema.value;
  }
  function changeShowPrivateKeyWif(){
    localStorage.setItem("showPrivateKeyWif", showPrivateKeyWif.value ? "true" : "false");
    settingsStore.showPrivateKeyWif = showPrivateKeyWif.value;
  }

</script>

<template>
  <fieldset class="item">
    <legend>{{ t('settings.title') }}</legend>
    <div v-if="!isBrowser" style="margin-bottom: 15px;">
      {{ t('settings.version', { version: applicationVersion }) }}
      <span v-if="isDesktop && store.latestGithubRelease && store.latestGithubRelease == 'v'+applicationVersion">{{ t('settings.latest') }}</span>
      <span v-if="isDesktop && store.latestGithubRelease && store.latestGithubRelease !== 'v'+applicationVersion">
        <i18n-t keypath="settings.latestRelease" tag="span">
          <template #version>
            <a href="https://github.com/cashonize/cashonize-wallet/releases/latest" target="_blank">{{store.latestGithubRelease}}</a>
          </template>
        </i18n-t>
      </span>
    </div>

    <div v-if="settingsSection != 0">
      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => settingsSection = 0">
        ↲ {{ t('settings.allSettings') }}
      </div>
    </div>

    <backupWallet v-if="settingsSection == 1" />
    <div v-else-if="settingsSection == 2">
      <div style="margin-bottom:15px;">
        {{ t('settings.userOptions.darkMode') }} <q-toggle v-model="selectedDarkMode" @update:model-value="changeDarkMode()" dense />
      </div>

      <div style="margin-top:15px">
        {{ t('settings.userOptions.confirmPayments') }} <q-toggle v-model="confirmBeforeSending" @update:model-value="toggleConfirmBeforeSending" dense />
        <div style="font-size: smaller; color: grey;">
          {{ t('settings.userOptions.confirmPaymentsHint') }}
        </div>
      </div>

      <div style="margin-top:15px">
        {{ t('settings.userOptions.showCauldronSwap') }} <q-toggle v-model="selectedShowSwap" @update:model-value="toggleShowSwap" dense />
      </div>

      <div style="margin-top:15px">
        {{ t('settings.userOptions.showCauldronFTValue') }}
        <InfoPopup style="margin-right: 6px;">
          <div style="max-width: 300px;">{{ t('settings.userOptions.showCauldronFTValueHint') }}</div>
          <div class="info-popup-note">{{ t('settings.userOptions.showCauldronFTValuePortfolioNote') }}</div>
        </InfoPopup>
        <q-toggle v-model="selectedShowCauldronFTValue" @update:model-value="toggleShowCauldronFTValue" dense />
      </div>

      <div style="margin-top: 15px; margin-bottom: 15px;">
        {{ t('settings.userOptions.enableTokenBurn') }} <q-toggle v-model="selectedTokenBurn" @update:model-value="changeTokenBurn()" dense />
      </div>

      <div v-if="!isCapacitor" style="margin-top: 15px;">
        {{ t('settings.userOptions.enableQrScan') }} <q-toggle v-model="enableQrScan" @update:model-value="changeQrScan()" dense />
      </div>

      <div style="margin-top:15px;">
        <label for="selectUnit">{{ t('settings.userOptions.selectUnit') }}</label>
        <select v-model="selectedUnit" @change="changeUnit()">
          <option value="bch">{{ t('settings.userOptions.bchUnit') }}</option>
          <option value="sat">{{ t('settings.userOptions.satUnit') }}</option>
        </select>
      </div>

      <div style="margin-top:15px;">
        <label for="selectExplorer">{{ t('settings.userOptions.blockExplorer') }}</label>
        <select v-if="store.network == 'mainnet'" v-model="selectedExplorer" @change="changeBlockExplorer()">
          <option value="https://blockchair.com/bitcoin-cash/transaction">Blockchair</option>
          <option value="https://explorer.salemkode.com/tx">SalemKode explorer</option>
          <option value="https://bchexplorer.info/tx">bchexplorer.info by Paytaca</option>
          <option value="https://blockbook.pat.mn/tx">BlockBook Pat</option>
          <option value="https://3xpl.com/bitcoin-cash/transaction">3xpl</option>
          <option value="https://bchexplorer.cash/tx">bchexplorer.cash by Melroy</option>
          <option value="https://explorer.bch.ninja/tx">explorer.bch.ninja (no Token Metadata)</option>
          <option value="https://bch.loping.net/tx">bch.loping.net (no Token Metadata)</option>
          <option value="https://explorer.coinex.com/bch/tx">CoinEx explorer (no CashTokens support)</option>
        </select>
        <select v-if="store.network == 'chipnet'" v-model="selectedExplorer" @change="changeBlockExplorer()">
          <option value="https://chipnet.bch.ninja/tx">chipnet.bch.ninja</option>
          <option value="https://chipnet.imaginary.cash/tx">chipnet.imaginary.cash</option>
          <option value="https://chipnet.chaingraph.cash/tx">chipnet.chaingraph.cash</option>
          <option value="https://chipnet.bchexplorer.info/tx">chipnet.bchexplorer.info</option>
        </select>
      </div>

      <div style="margin-top:15px; margin-bottom: 15px;">
        <label for="selectQrAnimation">{{ t('settings.userOptions.qrAnimation') }}</label>
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
        {{ t('settings.userOptions.tokenAddressQrDefault') }} <q-toggle v-model="tokenAddressQrDefault" @update:model-value="toggleTokenAddressQrDefault" dense />
      </div>

      <div style="margin-top:15px; margin-bottom: 15px;">
        {{ t('settings.userOptions.enableAddressMarking') }}
        <InfoPopup style="margin-right: 6px;">
          <div style="max-width: 300px;">{{ t('settings.userOptions.enableAddressMarkingHint') }}</div>
          <div class="info-popup-note">{{ t('addressManagement.markAddressUsedNote') }}</div>
        </InfoPopup>
        <q-toggle v-model="enableAddressMarking" @update:model-value="toggleEnableAddressMarking" dense />
      </div>

    </div>
    <div v-else-if="settingsSection == 3">
      <div v-if="store.network == 'mainnet'" style="margin-top:15px">
        <label for="selectNetwork">{{ t('settings.advanced.electrumMainnet') }}</label>
        <select v-model="selectedElectrumServer" @change="changeElectrumServer('mainnet')">
          <option v-for="(server, index) in predefinedElectrumServersMainnet" :key="server" :value="server">
            {{ server }}{{ index === 0 ? ' ' + t('settings.advanced.default') : '' }}
          </option>
          <option value="custom">{{ t('settings.advanced.custom') }}</option>
        </select>
        <div v-if="selectedElectrumServer === 'custom'" style="margin-top: 8px;">
          <input
            v-model="customElectrumServer"
            @blur="saveCustomElectrumServer('mainnet')"
            @keyup.enter="saveCustomElectrumServer('mainnet')"
            type="text"
            :placeholder="t('settings.advanced.electrumCustomPlaceholder')"
            style="width: 100%;"
          >
          <div style="font-size: smaller; color: grey;">
            {{ t('settings.advanced.electrumCustomHint') }}
            <span v-if="isLocalElectrumServer && isBrowser">
              <i18n-t keypath="settings.advanced.electrumSelfSignedBrowser" tag="span">
                <template #link>
                  <a :href="electrumWssUrl(customElectrumServer.trim()).replace('wss://', 'https://')" target="_blank">{{ t('settings.advanced.electrumSelfSignedVisit') }}</a>
                </template>
              </i18n-t>
            </span>
            <span v-if="isLocalElectrumServer && !isBrowser">
              {{ t('settings.advanced.electrumSelfSignedApp') }}
            </span>
          </div>
        </div>
      </div>

      <div v-if="store.network == 'chipnet'" style="margin-top:15px">
        <label for="selectNetwork">{{ t('settings.advanced.electrumChipnet') }}</label>
        <select v-model="selectedElectrumServerChipnet" @change="changeElectrumServer('chipnet')">
          <option v-for="(server, index) in predefinedElectrumServersChipnet" :key="server" :value="server">
            {{ server }}{{ index === 0 ? ' ' + t('settings.advanced.default') : '' }}
          </option>
          <option value="custom">{{ t('settings.advanced.custom') }}</option>
        </select>
        <div v-if="selectedElectrumServerChipnet === 'custom'" style="margin-top: 8px;">
          <input
            v-model="customElectrumServerChipnet"
            @blur="saveCustomElectrumServer('chipnet')"
            @keyup.enter="saveCustomElectrumServer('chipnet')"
            type="text"
            :placeholder="t('settings.advanced.electrumCustomPlaceholder')"
            style="width: 100%;"
          >
          <div style="font-size: smaller; color: grey;">
            {{ t('settings.advanced.electrumCustomHint') }}
            <span v-if="isLocalElectrumServerChipnet && isBrowser">
              <i18n-t keypath="settings.advanced.electrumSelfSignedBrowser" tag="span">
                <template #link>
                  <a :href="electrumWssUrl(customElectrumServerChipnet.trim()).replace('wss://', 'https://')" target="_blank">{{ t('settings.advanced.electrumSelfSignedVisit') }}</a>
                </template>
              </i18n-t>
            </span>
            <span v-if="isLocalElectrumServerChipnet && !isBrowser">
              {{ t('settings.advanced.electrumSelfSignedApp') }}
            </span>
          </div>
        </div>
      </div>

      <div style="margin-top:15px">
        <label for="selectNetwork">{{ t('settings.advanced.ipfsGateway') }}</label>
        <select v-model="selectedIpfsGateway" @change="changeIpfsGateway()">
          <option v-for="(gateway, index) in predefinedIpfsGateways" :key="gateway" :value="gateway">
            {{ getHostname(gateway) }}{{ index === 0 ? ' ' + t('settings.advanced.default') : '' }}
          </option>
          <option value="custom">{{ t('settings.advanced.custom') }}</option>
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
        <label for="selectExchangeRate">{{ t('settings.advanced.exchangeRate') }}</label>
        <select v-model="selectedExchangeRateProvider" @change="changeExchangeRateProvider()">
          <option value="default">{{ t('settings.advanced.exchangeRateDefault') }}</option>
          <option value="bitpay">BitPay</option>
          <option value="coingecko">CoinGecko</option>
          <option value="coinbase">Coinbase</option>
        </select>
      </div>

      <div style="margin-top:15px">
        <label for="selectNetwork">{{ t('settings.advanced.chaingraph') }}</label>
        <select v-model="selectedChaingraph" @change="changeChaingraph()">
          <option value="https://gql.chaingraph.pat.mn/v1/graphql">Pat's Chaingraph {{ t('settings.advanced.default') }}</option>
          <option value="https://demo.chaingraph.cash/v1/graphql">Demo Chaingraph</option>
          <option value="custom">{{ t('settings.advanced.custom') }}</option>
        </select>
        <div v-if="selectedChaingraph === 'custom'" style="margin-top: 8px;">
          <input
            v-model="customChaingraph"
            @blur="saveCustomChaingraph()"
            @keyup.enter="saveCustomChaingraph()"
            type="text"
            :placeholder="t('settings.advanced.chaingraphCustomPlaceholder')"
            style="width: 100%;"
          >
          <div style="font-size: smaller; color: grey;">
            <template v-if="verifyingCustomChaingraph">
              {{ t('settings.advanced.chaingraphChecking') }} <q-spinner-dots size="1em" />
            </template>
            <template v-else>
              {{ t('settings.advanced.chaingraphCustomHint') }}
            </template>
          </div>
        </div>
      </div>

      <div style="margin-top:15px">
        <label for="selectNetwork">{{ t('settings.advanced.cauldronIndexer') }}</label>
        <select v-model="selectedCauldronIndexer" @change="changeCauldronIndexer()">
          <option value="https://indexer.riften.net">indexer.riften.net {{ t('settings.advanced.default') }}</option>
          <option value="https://indexer.cauldron.quest">indexer.cauldron.quest</option>
        </select>
      </div>

      <div v-if="store.network == 'mainnet'" style="margin-top:15px">
        <label for="selectNetwork">{{ t('settings.advanced.bcmrIndexer') }}</label>
        <select v-model="selectedBcmrIndexer" @change="changeBcmrIndexer('mainnet')">
          <option v-for="(indexer, index) in predefinedBcmrIndexersMainnet" :key="indexer" :value="indexer">
            {{ getHostname(indexer) }}{{ index === 0 ? ' ' + t('settings.advanced.default') : '' }}
          </option>
          <option value="custom">{{ t('settings.advanced.custom') }}</option>
        </select>
        <div v-if="selectedBcmrIndexer === 'custom'" style="margin-top: 8px;">
          <input
            v-model="customBcmrIndexer"
            @blur="saveCustomBcmrIndexer('mainnet')"
            @keyup.enter="saveCustomBcmrIndexer('mainnet')"
            type="text"
            :placeholder="t('settings.advanced.bcmrIndexerCustomPlaceholder')"
            style="width: 100%;"
          >
        </div>
      </div>

      <div v-if="store.network == 'chipnet'" style="margin-top:15px">
        <label for="selectNetwork">{{ t('settings.advanced.bcmrIndexer') }}</label>
        <select v-model="selectedBcmrIndexerChipnet" @change="changeBcmrIndexer('chipnet')">
          <option v-for="(indexer, index) in predefinedBcmrIndexersChipnet" :key="indexer" :value="indexer">
            {{ getHostname(indexer) }}{{ index === 0 ? ' ' + t('settings.advanced.default') : '' }}
          </option>
          <option value="custom">{{ t('settings.advanced.custom') }}</option>
        </select>
        <div v-if="selectedBcmrIndexerChipnet === 'custom'" style="margin-top: 8px;">
          <input
            v-model="customBcmrIndexerChipnet"
            @blur="saveCustomBcmrIndexer('chipnet')"
            @keyup.enter="saveCustomBcmrIndexer('chipnet')"
            type="text"
            :placeholder="t('settings.advanced.bcmrIndexerCustomPlaceholder')"
            style="width: 100%;"
          >
        </div>
      </div>

      <div style="margin-top:15px;">{{ t('settings.advanced.deleteAllWallets', { platform: platformString }) }}
        <div v-if="isPwaMode" style="color: red">
          {{ t('settings.advanced.pwaDeleteWarning') }}
        </div>
        <div v-if="!isPwaMode && settingsStore.hasInstalledPWA" style="color: red">
          {{ t('settings.advanced.browserDeleteWarning') }}
        </div>
        <input @click="confirmDeleteWallets()" type="button" :value="t('settings.advanced.deleteAllWalletsButton')" class="button error" style="display: block;">
      </div>

      <div style="margin-top:15px; margin-bottom: 15px">
        {{ isMobile ? t('settings.advanced.clearHistoryCache') : t('settings.advanced.clearHistoryCacheFrom', { platform: platformString }) }}
        <span v-if="indexedDbCacheSizeMB != undefined" class="nowrap">({{ indexedDbCacheSizeMB.toFixed(2) }} MB)</span>
        <input @click="clearHistoryCache()" type="button" :value="t('settings.advanced.clearHistoryCacheButton')" class="button" style="display: block;">
      </div>

      <div style="margin-top:15px; margin-bottom: 15px">
        {{ isMobile ? t('settings.advanced.clearMetadataCache') : t('settings.advanced.clearMetadataCacheFrom', { platform: platformString }) }}
        <span v-if="localStorageSizeMB != undefined" class="nowrap">({{ localStorageSizeMB.toFixed(2) }} MB)</span>
        <input @click="clearMetadataCache()" type="button" :value="t('settings.advanced.clearMetadataCacheButton')" class="button" style="display: block;">
      </div>

      <div style="margin-top:15px; margin-bottom: 15px">
        {{ t('settings.advanced.clearDappConnections') }}
        <input @click="clearDappConnections()" type="button" :value="t('settings.advanced.clearDappConnectionsButton')" class="button" style="display: block;">
      </div>
    </div>
    <div v-else-if="settingsSection == 4">
      <div>
        <label for="selectNetwork">{{ t('settings.developer.changeNetwork') }}</label>
        <select v-model="selectedNetwork" @change="changeNetwork()">
          <option value="mainnet" :disabled="!currentWalletInfo?.hasMainnet">{{ t('settings.developer.mainnet') }}</option>
          <option value="chipnet" :disabled="!currentWalletInfo?.hasChipnet">{{ t('settings.developer.chipnet') }}</option>
        </select>
      </div>

      <div style="margin-top:15px">{{ t('settings.developer.tokenCreation') }}</div>
      <div style="margin: 0px 10px;">

        <div style="margin-top:15px">
          {{ t('settings.developer.enableMintNfts') }} <q-toggle v-model="enableMintNfts" @update:model-value="changeMintNfts()" dense />
          <div style="font-size: smaller; color: grey;">
            {{ t('settings.developer.enableMintNftsHint') }}
          </div>
        </div>

        <div style="margin-top:15px; margin-bottom: 15px">
          {{ t('settings.developer.enableAuthchains') }} <q-toggle v-model="enableAuthchains" @update:model-value="changeAuthchains()" dense />
          <div style="font-size: smaller; color: grey;">
            {{ t('settings.developer.enableAuthchainsHint') }}
          </div>
        </div>

        <div v-if="!isMobile" style="margin-top:15px; margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(6)">
          → {{ t('settings.menu.tokenCreationPage') }}
        </div>
      </div>

      <div style="margin-top:15px; margin-bottom: 15px">
        {{ t('settings.developer.disableTokenIcons') }} <q-toggle v-model="disableTokenIcons" @update:model-value="changeDisableTokenIcons()" dense />
        <div style="font-size: smaller; color: grey;">
          {{ t('settings.developer.disableTokenIconsHint') }}
        </div>
      </div>

      <div style="margin-top:15px; margin-bottom: 15px">
        {{ t('settings.developer.strictWcSchema') }} <q-toggle v-model="strictWcSchema" @update:model-value="changeStrictWcSchema()" dense />
        <div style="font-size: smaller; color: grey;">
          {{ t('settings.developer.strictWcSchemaHint') }}
        </div>
      </div>

      <div style="margin-top:15px; margin-bottom: 15px">
        {{ t('settings.developer.showPrivateKeyWif') }} <q-toggle v-model="showPrivateKeyWif" @update:model-value="changeShowPrivateKeyWif()" dense />
        <div style="font-size: smaller; color: grey;">
          {{ t('settings.developer.showPrivateKeyWifHint') }}
        </div>
      </div>
    </div>
    <div v-else-if="settingsSection == 5">
      <walletsOverview />
    </div>
    <div v-else-if="settingsSection == 6">
      <div style="margin-bottom:15px;">
        <label>{{ t('settings.localization.language') }}</label>
        <LanguageSelector />
      </div>

      <div style="margin-bottom:15px">
        <label for="selectCurrency">{{ t('settings.localization.currency') }}</label>
        <select v-model="selectedCurrency" @change="changeCurrency()">
          <option value="usd">USD</option>
          <option value="eur">EUR</option>
          <option value="gbp">GBP</option>
          <option value="cad">CAD</option>
          <option value="aud">AUD</option>
          <option value="chf">CHF</option>
          <option value="brl">BRL</option>
        </select>
      </div>

      <div style="margin-bottom: 15px;">
        <label for="dateFormat">{{ t('settings.localization.dateFormat') }}</label>
        <select v-model="dateFormat" @change="changeDateFormat()">
          <option value="DD/MM/YY">DD/MM/YY</option>
          <option value="MM/DD/YY">MM/DD/YY</option>
          <option value="YY-MM-DD">YY-MM-DD</option>
        </select>
      </div>
    </div>
    <!-- settingsSection === 0: main settings menu -->
    <div v-else>
      <div style="margin-bottom: 15px;">
        {{ t('settings.currentWallet') }} <span class="wallet-name-styled">{{ store.activeWalletName }}</span>
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => settingsSection = 1">
        ↳ {{ t('settings.menu.backupWallet') }} <span v-if="settingsStore.getBackupStatus(store.activeWalletName) === 'none'" style="color: var(--color-primary)">{{ t('settings.menu.important') }}</span>
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => settingsSection = 5">
        ↳ {{ t('settings.menu.manageWallets') }}
        <span style="color: grey; font-size: smaller;">
          ({{ store.availableWallets.length }} {{ store.availableWallets.length === 1 ? t('common.wallet') : t('common.wallets') }})
        </span>
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => settingsSection = 2">
        ↳ {{ t('settings.menu.userOptions') }}
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => settingsSection = 6">
        ↳ {{ t('settings.menu.localization') }}
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => settingsSection = 3">
        ↳ {{ t('settings.menu.advancedSettings') }}
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => settingsSection = 4">
        ↳ {{ t('settings.menu.developerSettings') }}
      </div>

      <div v-if="settingsStore.getWalletType(store.activeWalletName) === 'hd'" style="margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(10)">
        → {{ t('settings.menu.hdAddresses') }}
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(14)">
        → {{ t('settings.menu.tools') }} <span v-if="utxosWithBchAndTokens?.length" style="color: orange">{{ t('settings.menu.important') }}</span>
      </div>

      <div style="margin-bottom: 15px; cursor: pointer;" @click="() => store.changeView(11)">
        → {{ t('settings.menu.aboutCashonize') }}
      </div>

      <div style="margin-bottom:15px;">
        <a style="color: var(--font-color); cursor: pointer;" href="https://x.com/GeukensMathieu" target="_blank">
          <i18n-t keypath="settings.madeWith" tag="span">
            <template #heart>
              <EmojiItem emoji="💚" :sizePx="18" style="vertical-align: sub;" />
            </template>
          </i18n-t>
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
